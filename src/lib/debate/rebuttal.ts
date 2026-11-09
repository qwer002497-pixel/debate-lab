// 반론 라운드 응답(RebuttalContent)의 JSON 스키마, 검증, 화면 표시용 라벨.
// 서버(모델 응답 검증, 요청의 이전 라운드 검증)와 클라이언트(라벨)가 함께 쓴다. 비밀 정보 없음.

import type { RebuttalContent, Stance } from "@/types/debate";

export const STANCE_LABELS: Record<Stance, string> = {
  agree: "동의",
  partially_agree: "일부 동의",
  disagree: "반대",
};

const STANCES = Object.keys(STANCE_LABELS) as Stance[];

/** 화면과 프롬프트에서 같은 순서·이름을 쓰기 위한 항목 정의 */
export const REBUTTAL_FIELDS = [
  { key: "opponentSummary", label: "상대방 주장 요약", kind: "text" },
  { key: "stance", label: "평가", kind: "stance" },
  { key: "stanceReason", label: "평가 근거", kind: "text" },
  { key: "logicalGaps", label: "논리적 허점", kind: "list" },
  { key: "counterpoints", label: "반례 및 다른 관점", kind: "list" },
  { key: "acceptedPoints", label: "상대방 주장 중 수용할 내용", kind: "list" },
  { key: "maintainedPoints", label: "기존 입장에서 유지할 내용", kind: "list" },
  { key: "revisedPosition", label: "수정된 입장", kind: "text" },
  { key: "verificationNeeded", label: "추가 검증이 필요한 사항", kind: "list" },
] as const satisfies readonly { key: keyof RebuttalContent; label: string; kind: string }[];

const TEXT_KEYS = ["opponentSummary", "stanceReason", "revisedPosition"] as const;
const LIST_KEYS = [
  "logicalGaps",
  "counterpoints",
  "acceptedPoints",
  "maintainedPoints",
  "verificationNeeded",
] as const;

const stringList = (description: string) => ({
  type: "array",
  items: { type: "string" },
  description,
});

/**
 * 모델에 강제할 JSON 스키마 (OpenAI strict 모드와 Anthropic structured outputs 공통 지원 범위).
 * 모든 객체는 additionalProperties:false, 모든 필드 required. 길이 제약은 지원되지 않아 코드에서 검사한다.
 */
export const REBUTTAL_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: REBUTTAL_FIELDS.map((f) => f.key),
  properties: {
    opponentSummary: { type: "string", description: "상대방 최신 주장의 공정한 요약" },
    stance: { type: "string", enum: STANCES, description: "상대 주장에 대한 평가" },
    stanceReason: { type: "string", description: "그 평가를 내린 근거" },
    logicalGaps: stringList("상대 주장의 논리적 허점. 없으면 빈 배열"),
    counterpoints: stringList("반례 또는 다른 관점. 없으면 빈 배열"),
    acceptedPoints: stringList("상대 주장 중 타당해서 수용하는 내용. 없으면 빈 배열"),
    maintainedPoints: stringList("자신의 기존 입장 중 유지하는 내용"),
    revisedPosition: { type: "string", description: "이번 라운드를 반영해 수정한 자신의 입장" },
    verificationNeeded: stringList("외부 자료로 추가 검증이 필요한 사항"),
  },
};

// 응답·요청 크기 상한 (스키마로는 강제할 수 없어 코드에서 확인)
const MAX_TEXT_CHARS = 3000;
const MAX_LIST_ITEMS = 10;
const MAX_ITEM_CHARS = 1500;

/** unknown 값이 올바른 RebuttalContent인지 검사한다. 올바르면 정리된 값을, 아니면 null을 반환. */
export function parseRebuttal(value: unknown): RebuttalContent | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;

  if (!STANCES.includes(v.stance as Stance)) return null;
  for (const key of TEXT_KEYS) {
    const s = v[key];
    if (typeof s !== "string" || s.trim() === "" || s.length > MAX_TEXT_CHARS) return null;
  }
  for (const key of LIST_KEYS) {
    const list = v[key];
    if (!Array.isArray(list) || list.length > MAX_LIST_ITEMS) return null;
    if (!list.every((item) => typeof item === "string" && item.length <= MAX_ITEM_CHARS)) return null;
  }

  const list = (key: (typeof LIST_KEYS)[number]) =>
    (v[key] as string[]).map((s) => s.trim()).filter(Boolean);
  return {
    opponentSummary: (v.opponentSummary as string).trim(),
    stance: v.stance as Stance,
    stanceReason: (v.stanceReason as string).trim(),
    logicalGaps: list("logicalGaps"),
    counterpoints: list("counterpoints"),
    acceptedPoints: list("acceptedPoints"),
    maintainedPoints: list("maintainedPoints"),
    revisedPosition: (v.revisedPosition as string).trim(),
    verificationNeeded: list("verificationNeeded"),
  };
}

/** 모델이 반환한 JSON 텍스트를 파싱한다. 실패하면 null. */
export function parseRebuttalJson(text: string): RebuttalContent | null {
  try {
    return parseRebuttal(JSON.parse(text));
  } catch {
    return null;
  }
}
