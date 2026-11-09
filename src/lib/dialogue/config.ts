// 대화형 토론 요청 검증과 설정값 (서버·클라이언트 공용, 비밀 정보 없음).
// 주제·목적·라운드와 models 필터는 분석형 검증 함수를 그대로 재사용하고, 분석형 로직은 수정하지 않는다.

import { MODEL_IDS, parseDebateRequest, parseModelsFilter } from "@/lib/debate/config";
import type { ApiRequestError } from "@/types/api";
import type { DebateRequest, ModelId, RoundCount } from "@/types/debate";
import type {
  DialogueSlot,
  DialogueTranscriptEntry,
  DialogueTurnKind,
} from "@/types/dialogue";
import { parseClosing, parseSpeech } from "./schema";
import { dialogueTurnCount, expectedTurn, selectSlots } from "./sequence";

export const DIALOGUE_TURN_KINDS: readonly DialogueTurnKind[] = ["opening", "reply", "closing"];

/** 대화형 모델 호출 수 = 전체 발언 수 (2라운드 8 · 3라운드 10 · 5라운드 14) */
export function dialogueModelCalls(rounds: RoundCount): number {
  return dialogueTurnCount(rounds);
}

/**
 * 요청 본문 전체의 상한 (라우트에서 본문을 읽을 때 사용, P5-3).
 * 근거: 발언 1개 최대 ≈ 1,500 + 2×4×300 = 3,900자, 5라운드 closing 직전 transcript 최대 13개,
 *       한글 UTF-8 3바이트 → 약 152KB + 주제(2,000자 ≈ 6KB) + JSON 여유.
 */
export const DIALOGUE_MAX_BODY_BYTES = 200_000;

/**
 * 단계별 transcript 크기 상한 (JSON 직렬화 후 UTF-8 바이트).
 * opening은 transcript가 최대 1개(한쪽 재시도)뿐이므로 작게 제한한다.
 */
export const DIALOGUE_TRANSCRIPT_MAX_BYTES: Record<DialogueTurnKind, number> = {
  opening: 16_000,
  reply: 170_000,
  closing: 180_000,
};

/** debateId 형식: UUID v4 (crypto.randomUUID()). 대소문자 무관, 소문자로 정규화해 사용한다. */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isDebateId(value: unknown): value is string {
  return typeof value === "string" && UUID_V4.test(value);
}

/**
 * firstSpeaker 계산 함수. 서버 전용 구현(HMAC, 이후 DB)을 라우트가 주입한다.
 * 이 파일은 클라이언트와 공용이라 비밀키를 다루는 코드를 직접 import하지 않는다.
 */
export type FirstSpeakerLookup = (
  debateId: string,
) => { ok: true; firstSpeaker: ModelId } | { ok: false };

export interface ParsedDialogueTurn {
  request: DebateRequest;
  debateId: string; // 소문자로 정규화된 UUID
  firstSpeaker: ModelId; // 서버가 debateId로 계산한 값
  kind: DialogueTurnKind;
  index: number;
  transcript: DialogueTranscriptEntry[];
  /** 이번 요청에서 실제로 호출할 칸 (발언 index·발언자) */
  slots: DialogueSlot[];
}

type ErrorCode = ApiRequestError["error"]["code"];
export type DialogueParseResult =
  | { ok: true; value: ParsedDialogueTurn }
  | { ok: false; code: ErrorCode; message: string };

const ENTRY_KEYS = ["index", "kind", "speaker", "content"];

/**
 * POST /api/dialogue/turn 요청 검증.
 * 검사 순서: 기본 요청(주제·목적·라운드) → debateId 형식 → (firstSpeaker를 보냈으면 거부)
 *           → 서버가 firstSpeaker 계산 → kind·index 형식 → transcript 크기·구조·내용
 *           → 순서 규칙(expectedTurn) → 요청한 차례가 정확히 다음 차례인지 → models 필터
 * 이 함수가 ok를 반환하기 전에는 어떤 AI 호출도 일어나지 않는다.
 */
export function parseDialogueTurnRequest(
  body: unknown,
  lookupFirstSpeaker: FirstSpeakerLookup,
): DialogueParseResult {
  const base = parseDebateRequest(body);
  if (!base.ok) return bad("invalid_input", base.message);
  const b = body as Record<string, unknown>;
  const total = dialogueTurnCount(base.value.rounds);

  if (!isDebateId(b.debateId)) {
    return bad("invalid_input", "debateId는 UUID v4 형식이어야 합니다.");
  }
  const debateId = b.debateId.toLowerCase();
  if ("firstSpeaker" in b) {
    return bad("invalid_input", "firstSpeaker는 서버가 debateId로 정하므로 요청에 포함할 수 없습니다.");
  }
  const resolved = lookupFirstSpeaker(debateId);
  if (!resolved.ok) {
    return bad("server_misconfigured", "서버 설정 문제로 대화형 토론을 진행할 수 없습니다. 관리자에게 문의해 주세요.");
  }
  const firstSpeaker = resolved.firstSpeaker;

  if (!DIALOGUE_TURN_KINDS.includes(b.kind as DialogueTurnKind)) {
    return bad("invalid_input", 'kind는 "opening", "reply", "closing" 중 하나여야 합니다.');
  }
  const kind = b.kind as DialogueTurnKind;

  if (typeof b.index !== "number" || !Number.isInteger(b.index) || b.index < 0 || b.index >= total) {
    return bad("invalid_input", `index는 0~${total - 1} 사이의 정수여야 합니다.`);
  }
  const index = b.index;

  if (!Array.isArray(b.transcript)) return bad("invalid_input", "transcript는 배열이어야 합니다.");
  if (b.transcript.length > total) {
    return bad("invalid_input", `transcript는 최대 ${total}개 발언까지만 보낼 수 있습니다.`);
  }
  const bytes = new TextEncoder().encode(JSON.stringify(b.transcript)).byteLength;
  if (bytes > DIALOGUE_TRANSCRIPT_MAX_BYTES[kind]) {
    return bad("payload_too_large", `${kind} 단계의 transcript가 너무 큽니다 (${bytes}바이트).`);
  }

  const transcript: DialogueTranscriptEntry[] = [];
  for (let i = 0; i < b.transcript.length; i++) {
    const parsed = parseEntry(b.transcript[i]);
    if (typeof parsed === "string") return bad("invalid_input", `transcript[${i}]: ${parsed}`);
    transcript.push(parsed);
  }

  const seq = expectedTurn({ rounds: base.value.rounds, firstSpeaker }, transcript);
  if (!seq.ok) return bad("sequence_error", seq.message);
  const next = seq.next;
  if (next.kind === "done") {
    return bad("dialogue_complete", "closing까지 모든 발언이 끝나 더 실행할 차례가 없습니다.");
  }
  if (next.kind !== kind || next.index !== index) {
    return bad("sequence_error", `다음 차례는 ${next.kind} (index ${next.index})입니다. 요청: ${kind} (index ${index})`);
  }

  let models: ModelId[] | undefined;
  if (b.models !== undefined) {
    const m = parseModelsFilter(b.models);
    if (!m.ok) return bad("invalid_input", m.message);
    models = m.value;
  }
  const selected = selectSlots(next, models);
  if (!selected.ok) return bad("sequence_error", selected.message);

  return {
    ok: true,
    value: { request: base.value, debateId, firstSpeaker, kind, index, transcript, slots: selected.slots },
  };
}

/** transcript 항목 1개 검증. 올바르면 항목, 아니면 오류 메시지 문자열 */
export function parseEntry(value: unknown): DialogueTranscriptEntry | string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "객체여야 합니다.";
  const v = value as Record<string, unknown>;
  if (!Object.keys(v).every((k) => ENTRY_KEYS.includes(k)) || !ENTRY_KEYS.every((k) => k in v)) {
    return `필드는 ${ENTRY_KEYS.join(", ")}만 허용됩니다.`;
  }
  if (typeof v.index !== "number" || !Number.isInteger(v.index)) return "index는 정수여야 합니다.";
  if (!DIALOGUE_TURN_KINDS.includes(v.kind as DialogueTurnKind)) return "kind가 올바르지 않습니다.";
  if (!MODEL_IDS.includes(v.speaker as ModelId)) return "speaker가 올바르지 않습니다.";
  const speaker = v.speaker as ModelId;

  if (v.kind === "closing") {
    const content = parseClosing(v.content);
    if (!content) return "closing 내용 형식이 올바르지 않습니다.";
    return { index: v.index, kind: "closing", speaker, content };
  }
  const content = parseSpeech(v.content);
  if (!content) return `${v.kind} 내용 형식이 올바르지 않습니다.`;
  return { index: v.index, kind: v.kind as "opening" | "reply", speaker, content };
}

function bad(code: ErrorCode, message: string): DialogueParseResult {
  return { ok: false, code, message };
}
