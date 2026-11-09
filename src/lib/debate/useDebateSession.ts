// 토론 진행 관리(Orchestrator, 클라이언트 측).
//
// - 단계 순서: 최초 분석 → 1라운드 → … → N라운드
// - 각 단계에서 두 모델을 병렬 호출(서버가 처리)하고, 두 모델이 모두 성공해야 다음 단계로 간다.
// - 한쪽이라도 실패하면 일시정지. 성공한 결과는 그대로 두고, "재시도"는 실패한 모델만 다시 호출한다.
// - 결과는 [단계 × 모델] 칸에 저장되므로 재시도해도 같은 칸을 덮어쓸 뿐 중복 저장되지 않는다.
// - "중단"은 진행 중인 단계가 끝난 뒤 다음 단계를 시작하지 않는다(이미 시작된 호출은 과금되므로 끊지 않음).

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  DebateRequest,
  DebateStatus,
  ModelAnalysis,
  ModelId,
  ModelTurn,
  RebuttalContent,
  RoundTurn,
} from "@/types/debate";
import { postAnalyze, postRound, RequestFailure } from "./client-api";
import { MODEL_IDS } from "./config";

export type Slot<T> = { status: "idle" } | { status: "loading" } | { status: "done"; turn: T };
export type Stage = { kind: "initial" } | { kind: "round"; round: number };

export interface RoundView {
  round: number;
  turns: Record<ModelId, Slot<RoundTurn>>;
}

export interface DebateView {
  request: DebateRequest | null;
  status: DebateStatus;
  stage: Stage | null; // 진행 중이거나 멈춘 단계
  initial: Record<ModelId, Slot<ModelAnalysis>>;
  rounds: RoundView[];
  notice: string | null; // 일시정지·중단 사유
  stopRequested: boolean;
  elapsedMs: number; // 단계별 실제 대기 시간의 합
  /**
   * 누적 사용량 장부. 재시도하면 화면의 칸은 새 결과로 덮어쓰지만,
   * 이전 시도도 과금되었을 수 있으므로 호출 결과가 도착할 때마다 여기에 더한다.
   */
  ledger: Record<ModelId, UsageLedger>;
}

export interface UsageLedger {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  succeeded: number;
  failed: number;
}

/** 요청을 만들 때 쓰는 원본 데이터 (DebateSession과 같은 모양, 향후 DB 저장 단위) */
interface SessionData {
  request: DebateRequest | null;
  initial: Partial<Record<ModelId, ModelAnalysis>>;
  rounds: Partial<Record<ModelId, RoundTurn>>[];
}

const IDLE = { status: "idle" } as const;
const idleSlots = <T,>(): Record<ModelId, Slot<T>> => ({ gpt: IDLE, claude: IDLE });
const emptyLedger = (): UsageLedger => ({ inputTokens: 0, outputTokens: 0, costUsd: 0, succeeded: 0, failed: 0 });

const EMPTY_VIEW: DebateView = {
  request: null,
  status: "idle",
  stage: null,
  initial: idleSlots(),
  rounds: [],
  notice: null,
  stopRequested: false,
  elapsedMs: 0,
  ledger: { gpt: emptyLedger(), claude: emptyLedger() },
};

function addToLedger(ledger: UsageLedger, turn: ModelTurn<object>): UsageLedger {
  return {
    inputTokens: ledger.inputTokens + (turn.usage?.inputTokens ?? 0),
    outputTokens: ledger.outputTokens + (turn.usage?.outputTokens ?? 0),
    costUsd: ledger.costUsd + (turn.estimatedCostUsd ?? 0),
    succeeded: ledger.succeeded + (turn.status === "success" ? 1 : 0),
    failed: ledger.failed + (turn.status === "error" ? 1 : 0),
  };
}

export function stageLabel(stage: Stage): string {
  return stage.kind === "initial" ? "최초 분석" : `${stage.round}라운드`;
}

export function useDebateSession() {
  const [view, setView] = useState<DebateView>(EMPTY_VIEW);
  const dataRef = useRef<SessionData>({ request: null, initial: {}, rounds: [] });
  const busyRef = useRef(false); // 같은 순간의 중복 실행(더블 클릭) 방지
  const stopRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  // 화면을 떠나면 진행 중인 요청을 취소한다.
  useEffect(() => () => abortRef.current?.abort(), []);

  /** 아직 성공하지 못한 첫 번째 단계와, 그 단계에서 호출해야 할 모델 */
  const nextStage = useCallback((): { stage: Stage; models: ModelId[] } | null => {
    const data = dataRef.current;
    if (!data.request) return null;
    const missingInitial = MODEL_IDS.filter((id) => data.initial[id]?.status !== "success");
    if (missingInitial.length) return { stage: { kind: "initial" }, models: missingInitial };
    for (let round = 1; round <= data.request.rounds; round++) {
      const turns = data.rounds[round - 1] ?? {};
      const missing = MODEL_IDS.filter((id) => turns[id]?.status !== "success");
      if (missing.length) return { stage: { kind: "round", round }, models: missing };
    }
    return null;
  }, []);

  /** 한 단계를 실행하고 결과를 저장한다. 요청한 모델이 모두 성공하면 true. */
  const runStage = useCallback(async (stage: Stage, models: ModelId[]): Promise<boolean> => {
    const data = dataRef.current;
    const request = data.request!;
    setView((v) => withSlots(v, stage, models, () => ({ status: "loading" })));

    const controller = new AbortController();
    abortRef.current = controller;
    const startedAt = Date.now();
    let results: Partial<Record<ModelId, ModelTurn<object>>>;

    try {
      if (stage.kind === "initial") {
        results = (await postAnalyze({ ...request, models }, controller.signal)).results;
      } else {
        const r = stage.round;
        const initial = {} as Record<ModelId, string>;
        for (const id of MODEL_IDS) initial[id] = (data.initial[id] as Extract<ModelAnalysis, { status: "success" }>).text;
        let previous: Record<ModelId, RebuttalContent> | null = null;
        if (r > 1) {
          previous = {} as Record<ModelId, RebuttalContent>;
          for (const id of MODEL_IDS) previous[id] = (data.rounds[r - 2][id] as Extract<RoundTurn, { status: "success" }>).content;
        }
        results = (await postRound({ ...request, round: r, initial, previous, models }, controller.signal)).results;
      }
    } catch (err) {
      const message = err instanceof RequestFailure ? err.message : "알 수 없는 오류가 발생했습니다.";
      results = Object.fromEntries(models.map((id) => [id, clientError(message)]));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }

    const elapsed = Date.now() - startedAt;
    const turns = {} as Record<ModelId, ModelTurn<object>>;
    for (const id of models) {
      turns[id] = results[id] ?? clientError("서버 응답에 이 모델의 결과가 없습니다.");
      if (stage.kind === "initial") data.initial[id] = turns[id] as ModelAnalysis;
      else (data.rounds[stage.round - 1] ??= {})[id] = turns[id] as RoundTurn;
    }
    setView((v) => {
      const ledger = { ...v.ledger };
      for (const id of models) ledger[id] = addToLedger(ledger[id], turns[id]);
      return {
        ...withSlots(v, stage, models, (id) => ({ status: "done", turn: turns[id] })),
        elapsedMs: v.elapsedMs + elapsed,
        ledger,
      };
    });
    return models.every((id) => results[id]?.status === "success");
  }, []);

  /** 첫 미완료 단계부터 끝까지(또는 실패·중단까지) 진행한다. 시작과 재시도가 같은 함수를 쓴다. */
  const advance = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setView((v) => ({ ...v, status: "running", notice: null }));
    try {
      while (true) {
        const next = nextStage();
        if (!next) {
          setView((v) => ({ ...v, status: "completed", stage: null, notice: null }));
          return;
        }
        if (stopRef.current) {
          setView((v) => ({ ...v, status: "stopped", notice: `${stageLabel(next.stage)} 전에 토론을 중단했습니다. 지금까지의 결과는 보존됩니다.` }));
          return;
        }
        setView((v) => ({ ...v, stage: next.stage }));
        const ok = await runStage(next.stage, next.models);
        if (!ok) {
          const failed = failedModels(dataRef.current, next.stage);
          const all = failed.length === MODEL_IDS.length;
          setView((v) => ({
            ...v,
            status: "paused",
            notice: all
              ? `${stageLabel(next.stage)}에서 두 모델 모두 실패해 토론을 멈췄습니다. 이전 단계 결과는 보존됩니다.`
              : `${stageLabel(next.stage)}에서 ${failed.map(modelName).join(", ")} 호출이 실패해 토론을 멈췄습니다(부분 실패). 성공한 결과는 보존되며, 재시도하면 실패한 모델만 다시 호출합니다.`,
          }));
          return;
        }
      }
    } finally {
      busyRef.current = false;
    }
  }, [nextStage, runStage]);

  const start = useCallback(
    (request: DebateRequest) => {
      if (busyRef.current) return;
      stopRef.current = false;
      dataRef.current = { request, initial: {}, rounds: [] };
      setView({
        ...EMPTY_VIEW,
        request,
        rounds: Array.from({ length: request.rounds }, (_, i) => ({ round: i + 1, turns: idleSlots() })),
      });
      void advance();
    },
    [advance],
  );

  const retry = useCallback(() => {
    if (busyRef.current || !dataRef.current.request) return;
    stopRef.current = false;
    setView((v) => ({ ...v, stopRequested: false }));
    void advance();
  }, [advance]);

  const stop = useCallback(() => {
    stopRef.current = true;
    setView((v) =>
      busyRef.current
        ? { ...v, stopRequested: true }
        : { ...v, stopRequested: true, status: "stopped", notice: "토론을 중단했습니다. 지금까지의 결과는 보존됩니다." },
    );
  }, []);

  return { view, start, retry, stop };
}

/** 지정한 단계·모델의 칸(slot)을 바꾼 새 화면 상태를 만든다 (불변 업데이트). */
function withSlots(
  v: DebateView,
  stage: Stage,
  models: ModelId[],
  make: (id: ModelId) => Slot<ModelTurn<object>>,
): DebateView {
  if (stage.kind === "initial") {
    const initial = { ...v.initial };
    for (const id of models) initial[id] = make(id) as Slot<ModelAnalysis>;
    return { ...v, initial };
  }
  const rounds = v.rounds.map((r) => {
    if (r.round !== stage.round) return r;
    const turns = { ...r.turns };
    for (const id of models) turns[id] = make(id) as Slot<RoundTurn>;
    return { ...r, turns };
  });
  return { ...v, rounds };
}

function failedModels(data: SessionData, stage: Stage): ModelId[] {
  const turns = stage.kind === "initial" ? data.initial : (data.rounds[stage.round - 1] ?? {});
  return MODEL_IDS.filter((id) => turns[id]?.status !== "success");
}

function clientError(message: string): ModelTurn<object> {
  return { status: "error", model: "-", durationMs: 0, error: { code: "network_error", message } };
}

function modelName(id: ModelId): string {
  return id === "gpt" ? "GPT" : "Claude";
}
