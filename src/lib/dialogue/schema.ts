// 대화형 토론 모델 응답의 JSON 스키마와 검증기 (서버·클라이언트 공용, 비밀 정보 없음).
//
// 스키마와 검증 규칙을 일치시키는 방법:
// - 필드 이름·필수 여부: SPEECH_FIELDS / CLOSING_FIELDS 한 목록에서 스키마와 검증기를 함께 만든다.
// - 길이·개수 제한: Anthropic structured outputs는 maxLength·배열 개수 제약을 지원하지 않으므로
//   스키마에는 넣지 않고(description으로 모델에게 안내만), DIALOGUE_LIMITS로 코드에서 강제한다.
// - 추가 필드: 스키마 additionalProperties:false 와 같게, 검증기도 정의되지 않은 필드를 거부한다.

import type { ClosingContent, SpeechContent } from "@/types/dialogue";

export const DIALOGUE_LIMITS = {
  speech: {
    messageMaxChars: 1500, // 프롬프트에서는 이보다 짧게(약 700자) 요청할 예정
    listMaxItems: 4,
    itemMaxChars: 300,
  },
  closing: {
    finalPositionMaxChars: 2000,
    listMaxItems: 6,
    itemMaxChars: 300,
    // P5-7: 남은 의견 차이는 "나/상대/차이/갈린 기준·조건" 네 줄 형식이라 다른 목록보다 길게 허용한다.
    disagreementItemMaxChars: 500,
  },
} as const;

/** closing 목록 항목의 최대 길이 (필드별) */
function closingItemMax(key: string): number {
  return key === "remainingDisagreements"
    ? DIALOGUE_LIMITS.closing.disagreementItemMaxChars
    : DIALOGUE_LIMITS.closing.itemMaxChars;
}

type SpeechListKey = "acknowledged" | "openIssues";
type ClosingListKey = "agreedPoints" | "remainingDisagreements" | "positionChanges" | "verificationNeeded";

export const SPEECH_FIELDS = [
  { key: "message", kind: "text", description: "상대에게 직접 하는 자연스러운 대화체 발언 (핵심)" },
  { key: "acknowledged", kind: "list", description: "상대 주장 중 타당하다고 인정한 점. 없으면 빈 배열" },
  { key: "openIssues", kind: "list", description: "아직 해결되지 않았다고 보는 쟁점. 없으면 빈 배열" },
] as const satisfies readonly { key: keyof SpeechContent; kind: "text" | "list"; description: string }[];

export const CLOSING_FIELDS = [
  { key: "finalPosition", kind: "text", description: "토론 전체를 반영한 최종 입장" },
  { key: "agreedPoints", kind: "list", description: "상대와 실제로 합의했다고 보는 점" },
  {
    key: "remainingDisagreements",
    kind: "list",
    description:
      "실제로 남은 의견 차이. 항목마다 '나: … / 상대: … / 차이: … / 갈린 기준·조건: …' 네 줄 형식. 차이가 없으면 빈 배열 (agreedPoints와 겹치지 않게)",
  },
  { key: "positionChanges", kind: "list", description: "토론 중 바뀐 자신의 입장. 없으면 빈 배열" },
  { key: "verificationNeeded", kind: "list", description: "외부 자료로 검증이 필요한 사항" },
] as const satisfies readonly { key: keyof ClosingContent; kind: "text" | "list"; description: string }[];

function buildSchema(
  fields: readonly { key: string; kind: "text" | "list"; description: string }[],
  limits: { textMax: number; listMaxItems: number; itemMaxChars: number | ((key: string) => number) },
): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const f of fields) {
    const itemMax = typeof limits.itemMaxChars === "function" ? limits.itemMaxChars(f.key) : limits.itemMaxChars;
    properties[f.key] =
      f.kind === "text"
        ? { type: "string", description: `${f.description} (최대 ${limits.textMax}자)` }
        : {
            type: "array",
            items: { type: "string" },
            description: `${f.description} (최대 ${limits.listMaxItems}개, 각 ${itemMax}자 이내)`,
          };
  }
  return { type: "object", additionalProperties: false, required: fields.map((f) => f.key), properties };
}

export const SPEECH_JSON_SCHEMA = buildSchema(SPEECH_FIELDS, {
  textMax: DIALOGUE_LIMITS.speech.messageMaxChars,
  listMaxItems: DIALOGUE_LIMITS.speech.listMaxItems,
  itemMaxChars: DIALOGUE_LIMITS.speech.itemMaxChars,
});

export const CLOSING_JSON_SCHEMA = buildSchema(CLOSING_FIELDS, {
  textMax: DIALOGUE_LIMITS.closing.finalPositionMaxChars,
  listMaxItems: DIALOGUE_LIMITS.closing.listMaxItems,
  itemMaxChars: closingItemMax,
});

// ---------------------------------------------------------------------------
// 검증기: 올바르면 정리된 값(앞뒤 공백 제거, 빈 목록 항목 제거), 아니면 null
// ---------------------------------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function hasOnlyKeys(v: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(v).every((k) => keys.includes(k)) && keys.every((k) => k in v);
}

function readText(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s === "" || v.length > max ? null : s;
}

function readList(v: unknown, maxItems: number, itemMax: number): string[] | null {
  if (!Array.isArray(v) || v.length > maxItems) return null;
  if (!v.every((item) => typeof item === "string" && item.length <= itemMax)) return null;
  return (v as string[]).map((s) => s.trim()).filter(Boolean);
}

export function parseSpeech(value: unknown): SpeechContent | null {
  if (!isPlainObject(value) || !hasOnlyKeys(value, SPEECH_FIELDS.map((f) => f.key))) return null;
  const L = DIALOGUE_LIMITS.speech;
  const message = readText(value.message, L.messageMaxChars);
  const lists = {} as Record<SpeechListKey, string[]>;
  for (const key of ["acknowledged", "openIssues"] as const) {
    const list = readList(value[key], L.listMaxItems, L.itemMaxChars);
    if (!list) return null;
    lists[key] = list;
  }
  if (!message) return null;
  return { message, ...lists };
}

export function parseClosing(value: unknown): ClosingContent | null {
  if (!isPlainObject(value) || !hasOnlyKeys(value, CLOSING_FIELDS.map((f) => f.key))) return null;
  const L = DIALOGUE_LIMITS.closing;
  const finalPosition = readText(value.finalPosition, L.finalPositionMaxChars);
  if (!finalPosition) return null;
  const lists = {} as Record<ClosingListKey, string[]>;
  for (const key of ["agreedPoints", "remainingDisagreements", "positionChanges", "verificationNeeded"] as const) {
    const list = readList(value[key], L.listMaxItems, closingItemMax(key));
    if (!list) return null;
    // 같은 목록 안에서 공백만 다른 중복 항목은 하나만 남긴다 (의미가 같은 다른 표현은 코드로 판별할 수 없음).
    const seen = new Set<string>();
    lists[key] = list.filter((item) => {
      const k = normalizeForCompare(item);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }
  // 합의점과 남은 의견 차이는 분리되어야 한다: 같은 문장(공백 차이 무시)이 양쪽에 있으면 형식 오류로 본다.
  const agreed = new Set(lists.agreedPoints.map(normalizeForCompare));
  if (lists.remainingDisagreements.some((d) => agreed.has(normalizeForCompare(d)))) return null;
  return { finalPosition, ...lists };
}

/** 비교용 정규화: 줄바꿈·연속 공백을 공백 하나로 */
export function normalizeForCompare(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** 모델이 반환한 JSON 텍스트를 파싱한다. 실패하면 null. */
export function parseSpeechJson(text: string): SpeechContent | null {
  try {
    return parseSpeech(JSON.parse(text));
  } catch {
    return null;
  }
}

export function parseClosingJson(text: string): ClosingContent | null {
  try {
    return parseClosing(JSON.parse(text));
  } catch {
    return null;
  }
}
