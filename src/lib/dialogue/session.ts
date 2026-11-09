// 대화형 토론 진행 관리(Orchestrator, 클라이언트 측) — React와 무관한 순수 TypeScript.
// React 훅(useDialogueSession)은 이 컨트롤러를 화면 상태에 연결하는 얇은 래퍼다.
// 이렇게 나누면 진행 로직 전체를 브라우저 없이 Node에서 테스트할 수 있다.
//
// 진행 규칙
// - 다음 차례는 항상 sequence.ts의 expectedTurn(서버와 같은 규칙)으로 계산한다.
// - 한 번에 한 단계만 실행한다 (opening·closing은 서버가 두 모델을 병렬 호출, reply는 1명).
// - 단계가 끝나면 결과를 한 번에 반영한다: 성공한 발언은 transcript에 추가, 사용량은 장부에 누적.
// - 한 모델이라도 실패하면 "error" 상태로 멈춘다. 재시도는 실패한 칸만 다시 요청한다.
//
// 일시정지·중단과 진행 중인 요청
// - 현재 API는 진행 중인 모델 호출을 서버에서 취소할 수 없다. 브라우저 요청을 끊어도 서버는 끝까지 호출하고
//   과금되며 결과만 잃는다. 그래서 일시정지·중단은 진행 중인 요청을 끊지 않고, 결과를 반영한 뒤 다음 호출부터 멈춘다.
// - 요청을 끊는 것은 화면을 떠날 때(detach)뿐이며, 그 호출은 "비용 확인 불가"로 기록한다.
//
// 이 컨트롤러가 해결하지 못하는 것 (DB 단계 과제)
// - 새로고침하면 세션이 사라진다.
// - 응답이 유실된 호출을 다시 요청하면 서버는 이전 호출을 모르므로 다시 과금될 수 있다.
//
// 최종 비교 (P5-8, 선택 기능: options.finalComparison이 있을 때만)
// - 두 Closing이 모두 성공해 expectedTurn이 done이 된 뒤, 비교 API를 1회 호출한다.
// - 비교 결과는 transcript·turns와 분리해 state.comparison에만 저장한다.
// - 비교가 성공해야 completed가 된다. 실패해도 transcript·Closing은 그대로이며, 재시도는 비교만 다시 요청한다.
// - 비교 재시도 소진은 저장하지 않고 isComparisonExhausted로 계산한다 (발언용 retryExhausted와 분리).
// - 옵션이 없으면 comparison은 null이고 P5-4와 완전히 같은 경로로 동작한다.

import { RequestFailure, type RequestFailureReason } from "@/lib/debate/client-api";
import { MODEL_IDS } from "@/lib/debate/config";
import { addToLedger, emptyLedger, sumLedgers, type UsageLedger } from "@/lib/debate/ledger";
import type {
  DialogueCompareRequestBody,
  DialogueCompareResponse,
  DialogueTurnRequestBody,
  DialogueTurnResponse,
} from "@/types/api";
import type { AbOrder, ComparisonTurn } from "@/types/comparison";
import type { DebateRequest, ModelError, ModelId } from "@/types/debate";
import type {
  ClosingTurn,
  DialogueTranscriptEntry,
  DialogueTurnKind,
  SpeechTurn,
} from "@/types/dialogue";
import { dialogueModelCalls, isDebateId } from "./config";
import { expectedTurn, type ExpectedTurn } from "./sequence";

// ---------------------------------------------------------------------------
// 상태 타입
// ---------------------------------------------------------------------------

/**
 * idle: 시작 전 / running: 자동 진행 중 / paused: 사용자가 일시정지 / error: 단계 실패로 멈춤(재시도 가능)
 * stopped: 사용자가 중단(재개·재시도 불가) / completed: closing까지 완료
 */
export type DialogueRunStatus = "idle" | "running" | "paused" | "error" | "stopped" | "completed";

/** 진행 중인 요청이 끝난 뒤 적용할 사용자 요청 */
export type PendingAction = "pause" | "stop" | null;

/** transcript 칸(발언 1개) 하나의 진행 상태 */
export interface DialogueTurnState {
  index: number;
  kind: DialogueTurnKind;
  speaker: ModelId;
  status: "loading" | "success" | "error";
  attempts: number; // 이 칸에 보낸 요청 수 (재시도 포함)
  turn: SpeechTurn | ClosingTurn | null; // 서버가 보고한 마지막 결과 (성공 또는 모델 오류)
  error: ModelError | null; // 마지막 실패 사유 (클라이언트 측 실패 포함)
  costUnknown: boolean; // 마지막 시도가 과금됐는지 알 수 없음 (응답 유실 등)
}

/** 과금 여부를 확인할 수 없는 호출 (응답을 받지 못함). 장부에는 0으로 넣지 않고 여기에 따로 남긴다. */
export type UnverifiedCall =
  | {
      index: number;
      kind: DialogueTurnKind;
      speaker: ModelId;
      attempt: number;
      reason: UnverifiedReason;
    }
  | {
      // 최종 비교 호출. transcript 칸이 아니므로 index가 없다.
      // 비교 담당은 서버가 정하므로 첫 응답을 받기 전에 유실되면 어느 모델인지 알 수 없다(null).
      index: null;
      kind: "comparison";
      speaker: ModelId | null;
      attempt: number;
      reason: UnverifiedReason;
    };

type UnverifiedReason = RequestFailureReason | "server_error" | "invalid_response";

/** 최종 비교 진행 상태 (finalComparison 옵션이 있을 때만 존재) */
export interface ComparisonRunState {
  status: "idle" | "loading" | "success" | "error";
  attempts: number; // 비교 API에 보낸 요청 수 (재시도 포함)
  maxAttempts: number;
  /** 서버가 정한 비교 담당. 첫 응답에서 기록하고, 이후 응답이 다르면 신뢰하지 않는다. */
  comparator: ModelId | null;
  /** 서버가 공개한 본문 A/B의 실제 모델. 첫 응답에서 기록하고, 이후 응답이 다르면 신뢰하지 않는다. 클라이언트는 계산하지 않는다. */
  abOrder: AbOrder | null;
  turn: ComparisonTurn | null; // 서버가 보고한 마지막 결과 (성공 또는 모델 오류)
  error: ModelError | null;
  costUnknown: boolean;
  /** 비교 호출만의 사용량 누적 (전체 장부 state.ledger에도 함께 들어간다) */
  ledger: UsageLedger;
}

export interface DialogueStep {
  kind: DialogueTurnKind;
  index: number; // 요청 index (단계 시작 index)
  speakers: ModelId[]; // 이번에 호출하는(또는 실패해 다시 호출할) 모델
}

export interface DialogueSessionState {
  debateId: string | null;
  request: DebateRequest | null;
  firstSpeaker: ModelId | null; // 서버가 debateId로 계산해 응답한 값
  status: DialogueRunStatus;
  pendingAction: PendingAction;
  currentStep: DialogueStep | null; // 진행 중이거나, 실패해 멈춘 단계
  inFlight: (DialogueStep & { requestId: number; startedAt: number }) | null;
  transcript: DialogueTranscriptEntry[]; // 성공한 발언만, index 오름차순
  turns: Record<number, DialogueTurnState>; // 실행한 칸별 상태 (index 기준)
  modelErrors: Record<ModelId, (ModelError & { index: number }) | null>; // 모델별 마지막 오류 (성공하면 지움)
  ledger: Record<ModelId, UsageLedger>; // 서버가 사용량을 보고한 호출만 누적 (재시도·실패 포함)
  unverifiedCalls: UnverifiedCall[];
  retryCount: number; // 재시도로 보낸 요청 수
  retryExhausted: boolean; // 어떤 칸이 최대 시도 횟수에 도달해 더 재시도할 수 없음
  elapsedMs: number; // 단계별 실제 대기 시간의 합
  plannedCalls: number; // 예정된 모델 호출 수 (2라운드 8 · 3라운드 10 · 5라운드 14, 최종 비교를 켜면 +1)
  notice: string | null; // 멈춘 이유 등 안내 문구
  comparison: ComparisonRunState | null; // 최종 비교 (옵션이 없으면 null)
}

export type DialogueTransport = (
  body: DialogueTurnRequestBody,
  signal: AbortSignal,
) => Promise<DialogueTurnResponse>;

export type DialogueCompareTransport = (
  body: DialogueCompareRequestBody,
  signal: AbortSignal,
) => Promise<DialogueCompareResponse>;

export interface DialogueSessionOptions {
  transport: DialogueTransport;
  createDebateId?: () => string;
  now?: () => number;
  maxAttemptsPerTurn?: number; // 발언 칸과 최종 비교에 같은 상한을 쓴다
  /** 최종 비교(P5-8). 주면 Closing 뒤에 비교를 실행하고, 생략하면 P5-4와 같다. */
  finalComparison?: { transport: DialogueCompareTransport };
}

/** 한 칸(발언)에 보낼 수 있는 최대 요청 수 (첫 시도 + 재시도 2회). 무한 재시도를 막는다. */
export const MAX_ATTEMPTS_PER_TURN = 3;

const emptyModelRecord = <T,>(make: () => T): Record<ModelId, T> =>
  Object.fromEntries(MODEL_IDS.map((id) => [id, make()])) as Record<ModelId, T>;

export function initialDialogueState(): DialogueSessionState {
  return {
    debateId: null,
    request: null,
    firstSpeaker: null,
    status: "idle",
    pendingAction: null,
    currentStep: null,
    inFlight: null,
    transcript: [],
    turns: {},
    modelErrors: emptyModelRecord(() => null),
    ledger: emptyModelRecord(emptyLedger),
    unverifiedCalls: [],
    retryCount: 0,
    retryExhausted: false,
    elapsedMs: 0,
    plannedCalls: 0,
    notice: null,
    comparison: null,
  };
}

function initialComparisonState(maxAttempts: number): ComparisonRunState {
  return {
    status: "idle",
    attempts: 0,
    maxAttempts,
    comparator: null,
    abOrder: null,
    turn: null,
    error: null,
    costUnknown: false,
    ledger: emptyLedger(),
  };
}

/** 비교 재시도 소진 여부 (저장하지 않고 계산한다). 발언용 retryExhausted와 별개다. */
export function isComparisonExhausted(c: ComparisonRunState): boolean {
  return c.status === "error" && c.attempts >= c.maxAttempts;
}

/** 재시도 버튼을 쓸 수 있는지: 발언 재시도 소진과 비교 재시도 소진을 모두 확인한다. */
export function selectCanRetry(state: DialogueSessionState): boolean {
  return (
    state.status === "error" &&
    !state.retryExhausted &&
    !(state.comparison !== null && isComparisonExhausted(state.comparison))
  );
}

/**
 * 진행률. 완료 호출 = 성공한 발언 수 + (비교 성공 시 1).
 * 비교가 실패·진행 중이면 실제 완료된 발언만 센다 → 비교 성공 전에는 100%가 되지 않는다.
 */
export function selectProgress(state: DialogueSessionState): { done: number; total: number; percent: number } {
  const total = state.plannedCalls;
  const done = Math.min(total, state.transcript.length + (state.comparison?.status === "success" ? 1 : 0));
  return { done, total, percent: total > 0 ? Math.round((done / total) * 100) : 0 };
}

/** UUID v4. crypto.randomUUID가 없는 환경(HTTP로 접속한 LAN 주소 등)에서는 getRandomValues로 만든다. */
export function generateDebateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// ---------------------------------------------------------------------------
// 화면에서 쓰는 선택 함수
// ---------------------------------------------------------------------------

export function selectTurns(state: DialogueSessionState, kind: DialogueTurnKind): DialogueTurnState[] {
  return Object.values(state.turns)
    .filter((t) => t.kind === kind)
    .sort((a, b) => a.index - b.index);
}

/** 모델별·전체 비용 요약. unverifiedCalls는 과금됐을 수도 있는(확인 불가) 호출 수다. */
export function selectUsage(state: DialogueSessionState) {
  const byModel = emptyModelRecord(() => ({ ledger: emptyLedger(), unverifiedCalls: 0 }));
  for (const id of MODEL_IDS) {
    byModel[id] = {
      ledger: state.ledger[id],
      unverifiedCalls: state.unverifiedCalls.filter((c) => c.speaker === id).length,
    };
  }
  return {
    byModel,
    total: { ledger: sumLedgers(state.ledger), unverifiedCalls: state.unverifiedCalls.length },
    // 최종 비교만 따로 본 값 (위 모델별·합계에도 이미 포함되어 있다).
    // 비교 담당을 알기 전에 유실된 호출(speaker null)은 모델별에는 없고 합계와 여기에만 있다.
    comparison: {
      ledger: state.comparison?.ledger ?? emptyLedger(),
      unverifiedCalls: state.unverifiedCalls.filter((c) => c.kind === "comparison").length,
    },
  };
}

// ---------------------------------------------------------------------------
// 컨트롤러
// ---------------------------------------------------------------------------

export class DialogueSessionController {
  private state: DialogueSessionState = initialDialogueState();
  private readonly listeners = new Set<() => void>();
  private readonly transport: DialogueTransport;
  private readonly createDebateId: () => string;
  private readonly now: () => number;
  private readonly maxAttempts: number;
  private readonly compareTransport: DialogueCompareTransport | null;

  /** 한 번에 하나의 진행 루프만 돌도록 막는 잠금. 첫 await 전에 동기적으로 설정한다. */
  private busy = false;
  /** 새 세션을 시작할 때마다 증가. 이전 세션의 응답이 늦게 와도 반영하지 않는다. */
  private sessionToken = 0;
  private requestSeq = 0;
  private abortController: AbortController | null = null;
  private attached = true;

  constructor(options: DialogueSessionOptions) {
    this.transport = options.transport;
    this.createDebateId = options.createDebateId ?? generateDebateId;
    this.now = options.now ?? Date.now;
    this.maxAttempts = options.maxAttemptsPerTurn ?? MAX_ATTEMPTS_PER_TURN;
    this.compareTransport = options.finalComparison?.transport ?? null;
  }

  // --- 외부 구독 (useSyncExternalStore와 호환) ---
  getState = (): DialogueSessionState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private update(patch: Partial<DialogueSessionState> | ((s: DialogueSessionState) => Partial<DialogueSessionState>)) {
    const next = typeof patch === "function" ? patch(this.state) : patch;
    this.state = { ...this.state, ...next };
    for (const l of this.listeners) l();
  }

  // --- 사용자 동작 (반환값: 실제로 받아들였는지) ---

  /** 새 토론 시작. 진행 중인 요청이 있으면(중단 예약 상태 포함) 끝날 때까지 받지 않는다. */
  start = (request: DebateRequest): boolean => {
    if (this.busy) return false;
    const debateId = this.createDebateId().toLowerCase();
    if (!isDebateId(debateId)) throw new Error("debateId 생성 실패: UUID v4 형식이 아닙니다.");
    this.sessionToken++;
    this.state = {
      ...initialDialogueState(),
      debateId,
      request,
      plannedCalls: dialogueModelCalls(request.rounds) + (this.compareTransport ? 1 : 0),
      // 불변 조건: 비교 옵션이 있으면 comparison은 반드시 초기화된다 (advance에서도 null을 방어한다).
      comparison: this.compareTransport ? initialComparisonState(this.maxAttempts) : null,
    };
    for (const l of this.listeners) l();
    void this.advance();
    return true;
  };

  /** 자동 진행을 멈춘다. 진행 중인 요청은 끊지 않고, 결과를 반영한 뒤 멈춘다. */
  pause = (): boolean => {
    if (!this.busy || this.state.status !== "running" || this.state.pendingAction === "stop") return false;
    this.update({ pendingAction: "pause" });
    return true;
  };

  /** 일시정지한 지점부터 이어서 진행한다 (같은 debateId·firstSpeaker·transcript). */
  resume = (): boolean => {
    if (this.busy || this.state.status !== "paused") return false;
    void this.advance();
    return true;
  };

  /**
   * 실패한 칸만 다시 요청한다. 칸마다 최대 시도 횟수를 넘으면 받지 않는다.
   * 최종 비교가 실패한 상태라면 비교만 다시 요청한다 (transcript가 그대로이므로 다음 차례가 비교다).
   */
  retry = (): boolean => {
    if (this.busy || !selectCanRetry(this.state)) return false;
    void this.advance();
    return true;
  };

  /** 중단. 진행 중인 요청은 결과를 반영한 뒤 멈추며, 이후 자동으로 다시 진행하지 않는다. */
  stop = (): boolean => {
    const s = this.state.status;
    if (!this.state.debateId || s === "stopped" || s === "completed") return false;
    if (this.busy) {
      this.update({ pendingAction: "stop" });
    } else {
      this.update({ status: "stopped", pendingAction: null, notice: "토론을 중단했습니다. 지금까지의 발언과 비용은 보존됩니다." });
    }
    return true;
  };

  /** 화면에 붙을 때 (React StrictMode의 재마운트에도 대응) */
  attach = (): void => {
    this.attached = true;
  };

  /** 화면을 떠날 때: 진행 중인 요청을 끊는다. 그 호출은 비용 확인 불가로 기록된다. */
  detach = (): void => {
    this.attached = false;
    this.abortController?.abort();
  };

  // --- 진행 루프 ---

  private async advance(): Promise<void> {
    if (this.busy) return;
    this.busy = true; // 여기까지는 동기 실행이므로 같은 순간의 두 번째 호출은 위에서 막힌다.
    const token = this.sessionToken;
    this.update({ status: "running", pendingAction: null, notice: null });
    try {
      while (true) {
        if (token !== this.sessionToken || !this.attached) return;
        const pending = this.state.pendingAction;
        if (pending === "stop") {
          this.update({ status: "stopped", pendingAction: null, inFlight: null, notice: "토론을 중단했습니다. 지금까지의 발언과 비용은 보존됩니다." });
          return;
        }
        if (pending === "pause") {
          this.update({ status: "paused", pendingAction: null, notice: "일시정지했습니다. 재개하면 다음 차례부터 이어서 진행합니다." });
          return;
        }

        const next = this.computeNext();
        if (!next.ok) {
          this.update({ status: "error", notice: next.message });
          return;
        }
        if (next.step.kind === "done") {
          // 비교 옵션이 없으면 P5-4와 같은 완료 처리
          if (!this.compareTransport) {
            this.update({ status: "completed", currentStep: null, notice: null });
            return;
          }
          const c = this.state.comparison;
          if (c === null) {
            // 불변 조건 위반 (start가 항상 초기화함). 완료나 AI 호출로 넘어가지 않는다.
            this.update({ status: "error", notice: "세션 상태 오류로 최종 비교를 진행할 수 없습니다. 새 토론을 시작해 주세요." });
            return;
          }
          if (c.status === "success") {
            this.update({ status: "completed", currentStep: null, notice: null });
            return;
          }
          if (isComparisonExhausted(c)) {
            this.update({ status: "error", notice: this.comparisonExhaustedNotice() });
            return;
          }
          const ok = await this.runComparison(token);
          if (ok === "stale") return;
          if (ok) continue; // 루프 맨 위에서 대기 중인 일시정지·중단을 먼저 적용하고, 없으면 completed
          if (this.state.pendingAction === "stop") continue; // 중단 요청이 우선 (P5-4와 같은 규칙)
          this.update({
            status: "error",
            pendingAction: null,
            notice: isComparisonExhausted(this.state.comparison!)
              ? this.comparisonExhaustedNotice()
              : this.comparisonFailureNotice(),
          });
          return;
        }
        const step = next.step;
        const exhausted = step.slots.filter((s) => (this.state.turns[s.index]?.attempts ?? 0) >= this.maxAttempts);
        if (exhausted.length) {
          this.update({
            status: "error",
            retryExhausted: true,
            notice: `index ${exhausted.map((s) => s.index).join(", ")} 발언이 최대 시도 횟수(${this.maxAttempts}회)에 도달했습니다. 더 재시도하지 않습니다.`,
          });
          return;
        }

        const ok = await this.runStep(step, token);
        if (ok === "stale") return;
        if (!ok) {
          if (this.state.pendingAction === "stop") continue; // 중단 요청이 우선
          this.update({
            status: "error",
            pendingAction: null,
            notice: this.failureNotice(step),
          });
          return;
        }
      }
    } finally {
      this.busy = false;
    }
  }

  /** 다음 차례 계산 (서버와 같은 expectedTurn). firstSpeaker를 모르면 opening만 가능하다. */
  private computeNext(): { ok: true; step: ExpectedTurn } | { ok: false; message: string } {
    const { request, firstSpeaker, transcript } = this.state;
    if (!request) return { ok: false, message: "토론 요청 정보가 없습니다." };
    if (!firstSpeaker && transcript.some((t) => t.kind !== "opening")) {
      return { ok: false, message: "첫 발언 모델 정보가 없어 다음 차례를 계산할 수 없습니다." };
    }
    // opening 단계는 firstSpeaker와 무관하므로, 아직 모르면 임시 값으로 계산해도 결과가 같다.
    const seq = expectedTurn({ rounds: request.rounds, firstSpeaker: firstSpeaker ?? MODEL_IDS[0] }, transcript);
    if (!seq.ok) return { ok: false, message: `대화 기록이 순서 규칙과 맞지 않습니다: ${seq.message}` };
    return { ok: true, step: seq.next };
  }

  /** 한 단계를 실행하고 결과를 한 번에 반영한다. 요청한 칸이 모두 성공하면 true. */
  private async runStep(
    step: Exclude<ExpectedTurn, { kind: "done" }>,
    token: number,
  ): Promise<boolean | "stale"> {
    const requestId = ++this.requestSeq;
    const speakers = step.slots.map((s) => s.speaker);
    const isRetry = step.slots.some((s) => (this.state.turns[s.index]?.attempts ?? 0) > 0);
    const startedAt = this.now();
    const stepInfo: DialogueStep = { kind: step.kind, index: step.index, speakers };

    this.update((s) => {
      const turns = { ...s.turns };
      for (const slot of step.slots) {
        const prev = turns[slot.index];
        turns[slot.index] = {
          index: slot.index,
          kind: slot.kind,
          speaker: slot.speaker,
          status: "loading",
          attempts: (prev?.attempts ?? 0) + 1,
          turn: prev?.turn ?? null,
          error: prev?.error ?? null,
          costUnknown: false,
        };
      }
      return {
        turns,
        currentStep: stepInfo,
        inFlight: { ...stepInfo, requestId, startedAt },
        retryCount: s.retryCount + (isRetry ? 1 : 0),
      };
    });

    const { request, debateId, transcript } = this.state;
    const body: DialogueTurnRequestBody = {
      topic: request!.topic,
      purpose: request!.purpose,
      rounds: request!.rounds,
      debateId: debateId!,
      kind: step.kind,
      index: step.index,
      transcript,
      // opening/closing에서 일부 모델만 남았으면 그 모델만 지정한다 (성공한 모델은 다시 부르지 않음).
      ...(step.kind !== "reply" && speakers.length < MODEL_IDS.length ? { models: speakers } : {}),
    };

    const controller = new AbortController();
    this.abortController = controller;
    let response: DialogueTurnResponse | null = null;
    let failure: RequestFailure | null = null;
    try {
      response = await this.transport(body, controller.signal);
    } catch (err) {
      failure = err instanceof RequestFailure ? err : new RequestFailure("알 수 없는 오류가 발생했습니다.", "network");
    } finally {
      if (this.abortController === controller) this.abortController = null;
    }

    // 그 사이 새 세션이 시작됐다면 이 결과는 버린다 (start는 busy 중에 거부되므로 정상 흐름에서는 일어나지 않음).
    if (token !== this.sessionToken) return "stale";
    const elapsed = this.now() - startedAt;

    // ---- 결과 반영: 이 블록은 동기적으로 한 번만 실행된다 (같은 응답이 두 번 장부에 들어가지 않음) ----
    let allOk = true;
    this.update((s) => {
      const turns = { ...s.turns };
      const ledger = { ...s.ledger };
      const modelErrors = { ...s.modelErrors };
      const unverifiedCalls = [...s.unverifiedCalls];
      let transcriptNext = s.transcript;
      let firstSpeaker = s.firstSpeaker;
      let notice: string | null = null;

      const markClientFailure = (
        slot: (typeof step.slots)[number],
        error: ModelError,
        costUnknown: boolean,
        reason: UnverifiedCall["reason"],
      ) => {
        allOk = false;
        const prev = turns[slot.index];
        turns[slot.index] = { ...prev, status: "error", error, costUnknown };
        modelErrors[slot.speaker] = { ...error, index: slot.index };
        if (costUnknown) {
          unverifiedCalls.push({ index: slot.index, kind: slot.kind, speaker: slot.speaker, attempt: prev.attempts, reason });
        }
      };

      if (failure) {
        // 서버가 거부(4xx)했다면 모델 호출 전에 끝난 것이므로 과금 없음. 그 밖에는 확인할 수 없다.
        const known = failure.reason === "rejected" && (failure.httpStatus ?? 500) < 500;
        const reason: UnverifiedCall["reason"] = failure.reason === "rejected" ? "server_error" : failure.reason;
        const code: ModelError["code"] =
          failure.reason === "timeout" ? "timeout" : failure.reason === "rejected" ? "invalid_request" : "network_error";
        for (const slot of step.slots) markClientFailure(slot, { code, message: failure.message }, !known, reason);
        if (failure.httpStatus === 409) {
          notice = "서버가 요청 순서를 거부했습니다. 대화 기록이 서버 규칙과 맞지 않을 수 있습니다.";
        }
      } else if (response) {
        const mismatch =
          response.debateId !== s.debateId || response.kind !== step.kind || response.index !== step.index;
        const fsConflict = !!firstSpeaker && response.firstSpeaker !== firstSpeaker;
        if (mismatch || fsConflict) {
          // 응답을 신뢰할 수 없으므로 내용을 반영하지 않고, 과금 여부도 확인 불가로 남긴다.
          for (const slot of step.slots) {
            markClientFailure(
              slot,
              { code: "unknown", message: fsConflict ? "서버가 계산한 첫 발언 모델이 이전과 다릅니다." : "응답이 요청과 일치하지 않습니다." },
              true,
              "invalid_response",
            );
          }
          notice = fsConflict
            ? "서버의 첫 발언 모델 계산이 바뀌었습니다 (서버 비밀값 변경 가능성). 새 토론을 시작해 주세요."
            : "서버 응답이 요청과 일치하지 않습니다.";
        } else {
          firstSpeaker = firstSpeaker ?? response.firstSpeaker;
          for (const slot of step.slots) {
            const r = response.results[slot.speaker];
            if (!r || r.index !== slot.index) {
              markClientFailure(slot, { code: "unknown", message: "서버 응답에 이 모델의 결과가 없습니다." }, true, "invalid_response");
              continue;
            }
            const t = r.turn;
            ledger[slot.speaker] = addToLedger(ledger[slot.speaker], t);
            if (t.status === "success") {
              turns[slot.index] = { ...turns[slot.index], status: "success", turn: t, error: null, costUnknown: false };
              modelErrors[slot.speaker] = null;
              if (!transcriptNext.some((e) => e.index === slot.index)) {
                const entry = { index: slot.index, kind: slot.kind, speaker: slot.speaker, content: t.content } as DialogueTranscriptEntry;
                transcriptNext = [...transcriptNext, entry].sort((a, b) => a.index - b.index);
              }
            } else {
              allOk = false;
              turns[slot.index] = { ...turns[slot.index], status: "error", turn: t, error: t.error, costUnknown: false };
              modelErrors[slot.speaker] = { ...t.error, index: slot.index };
            }
          }
        }
      }

      return {
        turns,
        ledger,
        modelErrors,
        unverifiedCalls,
        transcript: transcriptNext,
        firstSpeaker,
        inFlight: null,
        currentStep: allOk ? null : stepInfo,
        elapsedMs: s.elapsedMs + elapsed,
        notice: notice ?? s.notice,
      };
    });
    if (!this.attached) return false;
    return allOk;
  }

  /**
   * 최종 비교를 1회 실행하고 결과를 한 번에 반영한다. 성공하면 true.
   * transcript·turns는 건드리지 않는다 (비교는 발언이 아니다).
   */
  private async runComparison(token: number): Promise<boolean | "stale"> {
    const transport = this.compareTransport!;
    const isRetry = (this.state.comparison?.attempts ?? 0) > 0;
    const startedAt = this.now();
    this.update((s) => ({
      comparison: { ...s.comparison!, status: "loading", attempts: s.comparison!.attempts + 1, costUnknown: false },
      retryCount: s.retryCount + (isRetry ? 1 : 0),
    }));

    const { request, debateId, transcript } = this.state;
    const body: DialogueCompareRequestBody = {
      topic: request!.topic,
      purpose: request!.purpose,
      rounds: request!.rounds,
      debateId: debateId!,
      transcript, // 2N+4개 전체. comparator·A/B는 보내지 않는다 (서버가 debateId로 계산)
    };

    const controller = new AbortController();
    this.abortController = controller;
    let response: DialogueCompareResponse | null = null;
    let failure: RequestFailure | null = null;
    try {
      response = await transport(body, controller.signal);
    } catch (err) {
      failure = err instanceof RequestFailure ? err : new RequestFailure("알 수 없는 오류가 발생했습니다.", "network");
    } finally {
      if (this.abortController === controller) this.abortController = null;
    }

    if (token !== this.sessionToken) return "stale";
    const elapsed = this.now() - startedAt;

    // ---- 결과 반영: 동기적으로 한 번만 실행 (같은 응답이 장부에 두 번 들어가지 않음) ----
    let ok = false;
    this.update((s) => {
      const c: ComparisonRunState = { ...s.comparison! };
      const ledger = { ...s.ledger };
      const unverifiedCalls = [...s.unverifiedCalls];
      let notice: string | null = null;

      const markFailure = (error: ModelError, costUnknown: boolean, reason: UnverifiedReason) => {
        c.status = "error";
        c.error = error;
        c.costUnknown = costUnknown;
        if (costUnknown) {
          unverifiedCalls.push({ index: null, kind: "comparison", speaker: c.comparator, attempt: c.attempts, reason });
        }
      };

      if (failure) {
        // runStep과 같은 기준: 서버가 4xx로 거부했으면 모델 호출 전이므로 과금 없음. 그 밖에는 확인할 수 없다.
        const known = failure.reason === "rejected" && (failure.httpStatus ?? 500) < 500;
        const reason: UnverifiedReason = failure.reason === "rejected" ? "server_error" : failure.reason;
        const code: ModelError["code"] =
          failure.reason === "timeout" ? "timeout" : failure.reason === "rejected" ? "invalid_request" : "network_error";
        markFailure({ code, message: failure.message }, !known, reason);
        if (failure.httpStatus === 409) {
          notice = "서버가 최종 비교 요청을 거부했습니다. 대화 기록이 서버 규칙과 맞지 않을 수 있습니다. 토론 발언과 마무리는 그대로 보존됩니다.";
        }
      } else if (response) {
        const comparator = response.comparator;
        const keys = Object.keys(response.results ?? {});
        const turn = MODEL_IDS.includes(comparator) ? response.results[comparator] : undefined;
        const ab = response.abOrder;
        const abValid =
          !!ab && MODEL_IDS.includes(ab.A) && MODEL_IDS.includes(ab.B) && ab.A !== ab.B && Object.keys(ab).length === 2;
        const valid =
          response.debateId === s.debateId &&
          (!s.firstSpeaker || response.firstSpeaker === s.firstSpeaker) &&
          keys.length === 1 &&
          !!turn &&
          abValid;
        const conflict =
          valid &&
          ((c.comparator !== null && c.comparator !== comparator) || (c.abOrder !== null && c.abOrder.A !== ab.A));
        if (!valid || conflict) {
          // 응답을 신뢰할 수 없으므로 내용·사용량을 반영하지 않고, 과금 여부는 확인 불가로 남긴다.
          markFailure(
            { code: "unknown", message: conflict ? "서버가 정한 비교 담당 모델 또는 A/B 순서가 이전과 다릅니다." : "비교 응답이 요청과 일치하지 않습니다." },
            true,
            "invalid_response",
          );
          notice = conflict
            ? "서버의 비교 담당 모델 계산이 바뀌었습니다 (서버 비밀값 변경 가능성). 토론 발언과 마무리는 보존됩니다. 새 토론을 시작해 주세요." // A/B 순서 변경도 같은 원인
            : "최종 비교 응답이 요청과 일치하지 않습니다. 토론 발언과 마무리는 그대로 보존됩니다.";
        } else {
          const t = turn!;
          c.comparator = comparator;
          c.abOrder = { A: ab.A, B: ab.B };
          ledger[comparator] = addToLedger(ledger[comparator], t);
          c.ledger = addToLedger(c.ledger, t);
          c.turn = t;
          if (t.status === "success") {
            c.status = "success";
            c.error = null;
            c.costUnknown = false;
            ok = true;
          } else {
            c.status = "error";
            c.error = t.error;
            c.costUnknown = false;
          }
        }
      }

      return {
        comparison: c,
        ledger,
        unverifiedCalls,
        elapsedMs: s.elapsedMs + elapsed,
        notice: notice ?? s.notice,
      };
    });
    if (!this.attached) return false;
    return ok;
  }

  /** 최종 비교 실패 안내 (발언용 failureNotice와 별도) */
  private comparisonFailureNotice(): string {
    if (this.state.notice) return this.state.notice;
    const c = this.state.comparison;
    const who = c?.comparator ? ` (비교 담당: ${c.comparator === "gpt" ? "GPT" : "Claude"})` : "";
    return `최종 비교${who}가 실패해 멈췄습니다. 토론 발언과 두 모델의 마무리는 그대로 보존됩니다. 재시도하면 최종 비교만 다시 요청합니다 (${c?.attempts ?? 0}/${c?.maxAttempts ?? this.maxAttempts}회 시도).`;
  }

  /** 비교 재시도 소진 안내 (발언 재시도 소진 안내와 구분) */
  private comparisonExhaustedNotice(): string {
    return `최종 비교가 최대 시도 횟수(${this.state.comparison?.maxAttempts ?? this.maxAttempts}회)에 도달해 더 재시도하지 않습니다. 토론 발언과 두 모델의 마무리는 그대로 보존되므로, 마무리 원문으로 직접 비교할 수 있습니다.`;
  }

  private failureNotice(step: Exclude<ExpectedTurn, { kind: "done" }>): string {
    if (this.state.notice) return this.state.notice;
    const failed = step.slots.filter((s) => this.state.turns[s.index]?.status !== "success");
    // 화면의 발언 카드 표기(#index)와 같게 쓴다. index는 0부터 세므로 "n번째"로 쓰면 혼동된다.
    const label = step.kind === "opening" ? "첫 의견" : step.kind === "reply" ? `#${step.index} 응답` : "마무리";
    const who = failed.map((s) => (s.speaker === "gpt" ? "GPT" : "Claude")).join(", ");
    const partial = failed.length < step.slots.length;
    return `${label}에서 ${who} 호출이 실패해 멈췄습니다${partial ? "(부분 실패). 성공한 결과는 보존됩니다" : ""}. 재시도하면 실패한 차례만 다시 요청합니다.`;
  }
}
