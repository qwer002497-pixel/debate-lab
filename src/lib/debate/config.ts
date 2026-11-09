// 토론 옵션 목록과 입력 검증 규칙.
// Phase 3에서 서버도 같은 규칙으로 요청을 검증해야 하므로 컴포넌트 밖에 둔다.
// (브라우저 검증은 우회될 수 있으므로 서버 검증이 반드시 필요하다.)

import type { DebatePurpose, DebateRequest, RoundCount } from "@/types/debate";

export const PURPOSE_OPTIONS: {
  value: DebatePurpose;
  label: string;
  description: string;
}[] = [
  {
    value: "idea_validation",
    label: "아이디어 검증",
    description: "실현 가능성, 위험 요소, 반례를 검토합니다.",
  },
  {
    value: "problem_solving",
    label: "문제 해결",
    description: "원인을 분석하고 해결책을 비교합니다.",
  },
  {
    value: "comparison",
    label: "비교 분석",
    description: "여러 선택지의 장단점을 비교합니다.",
  },
  {
    value: "free",
    label: "자유 주제",
    description: "형식 없이 주제를 자유롭게 토론합니다.",
  },
];

export const ROUND_OPTIONS: RoundCount[] = [2, 3, 5];

/** 기본 라운드는 비용이 가장 적은 2회로 둔다. */
export const DEFAULT_ROUNDS: RoundCount = 2;

/** 너무 짧은 주제는 분석이 의미 없고, 너무 긴 주제는 토큰 비용이 커진다. */
export const TOPIC_MIN_LENGTH = 5;
export const TOPIC_MAX_LENGTH = 2000;

export function getPurposeLabel(purpose: DebatePurpose): string {
  return PURPOSE_OPTIONS.find((o) => o.value === purpose)?.label ?? purpose;
}

/** 주제 입력값을 검사한다. 문제가 없으면 null, 있으면 사용자에게 보여줄 메시지를 반환한다. */
export function validateTopic(topic: string): string | null {
  const length = topic.trim().length;
  if (length === 0) return "검증할 주제나 아이디어를 입력해 주세요.";
  if (length < TOPIC_MIN_LENGTH)
    return `주제를 ${TOPIC_MIN_LENGTH}자 이상 입력해 주세요.`;
  if (length > TOPIC_MAX_LENGTH)
    return `주제는 ${TOPIC_MAX_LENGTH}자 이하로 입력해 주세요.`;
  return null;
}

export function isDebatePurpose(value: unknown): value is DebatePurpose {
  return PURPOSE_OPTIONS.some((o) => o.value === value);
}

export function isRoundCount(value: unknown): value is RoundCount {
  return ROUND_OPTIONS.includes(value as RoundCount);
}

/**
 * 서버용 요청 검증. 브라우저에서 온 JSON은 어떤 모양이든 올 수 있으므로
 * 타입을 믿지 않고(unknown) 필드 하나하나를 확인한다.
 */
export function parseDebateRequest(
  body: unknown,
): { ok: true; value: DebateRequest } | { ok: false; message: string } {
  if (typeof body !== "object" || body === null) {
    return { ok: false, message: "요청 본문이 올바른 JSON 객체가 아닙니다." };
  }
  const { topic, purpose, rounds } = body as Record<string, unknown>;

  if (typeof topic !== "string") {
    return { ok: false, message: "topic은 문자열이어야 합니다." };
  }
  const topicError = validateTopic(topic);
  if (topicError) return { ok: false, message: topicError };

  if (!isDebatePurpose(purpose)) {
    return { ok: false, message: "purpose 값이 허용된 토론 목적이 아닙니다." };
  }
  if (!isRoundCount(rounds)) {
    return { ok: false, message: "rounds는 2, 3, 5 중 하나여야 합니다." };
  }

  return { ok: true, value: { topic: topic.trim(), purpose, rounds } };
}
