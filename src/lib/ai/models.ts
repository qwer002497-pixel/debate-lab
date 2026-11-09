// AI 모델 ID와 호출 공통 설정을 한 곳에서 관리한다.
// 모델을 바꾸거나 비용 상한을 조정할 때는 이 파일만 수정하면 된다.

import type { ModelId, TokenUsage } from "@/types/debate";

/** openai.ts / anthropic.ts 가 공통으로 반환하는 형식. 제공사 차이를 여기서 감춘다. */
export interface ProviderOutput {
  text: string;
  usage: TokenUsage;
  truncated: boolean;
}

/** 각 제공사 호출 함수에 넘기는 프롬프트 (두 모델에 동일한 값을 넘긴다) */
export interface PromptInput {
  system: string;
  user: string;
}

/** 호출별로 달라지는 옵션 */
export interface CallOptions {
  maxOutputTokens?: number; // 기본값: MAX_OUTPUT_TOKENS
  /** 지정하면 응답을 이 JSON 스키마로 강제한다 (structured outputs). */
  jsonSchema?: { name: string; schema: Record<string, unknown> };
}

export const AI_MODELS = {
  gpt: {
    provider: "OpenAI",
    id: "gpt-6.1-sol",
    apiKeyEnv: "OPENAI_API_KEY",
    // 추론(reasoning) 토큰도 출력 토큰 상한에 포함된다.
    // 추론에 토큰을 많이 쓰면 실제 답변이 잘리므로 낮게 둔다.
    reasoningEffort: "low",
    // 공개 단가 (USD / 100만 토큰). 2026-11-09 developers.openai.com/api/docs/pricing 기준, 272K 이하 구간.
    pricePerMTok: { input: 2, output: 10 },
  },
  claude: {
    provider: "Anthropic",
    id: "claude-sonnet-5-5",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    // 공개 단가 (USD / 100만 토큰). 2026-11-09 platform.claude.com/docs/en/about-claude/pricing 기준.
    pricePerMTok: { input: 2, output: 10 },
  },
} as const satisfies Record<
  ModelId,
  {
    provider: string;
    id: string;
    apiKeyEnv: string;
    reasoningEffort?: string;
    pricePerMTok: { input: number; output: number };
  }
>;

/**
 * 최초 분석의 최대 출력 토큰. 비용 상한 역할을 한다.
 * 두 모델을 공정하게 비교하기 위해 같은 값을 쓴다.
 */
export const MAX_OUTPUT_TOKENS = 2000;

/**
 * 반론 라운드의 최대 출력 토큰.
 * 9개 항목을 JSON으로 써야 해서 최초 분석보다 길고, JSON이 중간에 잘리면
 * 응답 전체를 쓸 수 없으므로 여유를 둔다.
 */
export const MAX_OUTPUT_TOKENS_ROUND = 3000;

/**
 * 대화형 토론의 최대 출력 토큰 (Phase 5).
 * 발언(opening·reply)은 짧은 대화체(약 700자 요청, 검증 상한 1,500자)라 반론보다 작게,
 * closing은 5개 항목 JSON이라 분석형 라운드에 가깝게 둔다.
 */
export const MAX_OUTPUT_TOKENS_DIALOGUE_SPEECH = 1500;
export const MAX_OUTPUT_TOKENS_DIALOGUE_CLOSING = 2500;

/**
 * 최종 비교(P5-8)의 최대 출력 토큰.
 * 목록 6개에 객체 배열이 섞여 있고, 실측에서 Claude closing이 이미 약 2,000 토큰을 썼으므로 여유를 둔다.
 * 실제 측정(P5-8 재생 검증) 후 조정한다.
 */
export const MAX_OUTPUT_TOKENS_DIALOGUE_COMPARISON = 4000;

/**
 * AI 제공사 API 한 번의 응답 대기 시간 상한 (밀리초).
 * 환경변수 AI_REQUEST_TIMEOUT_MS로 조정할 수 있다 (배포 환경 제한, 테스트용).
 */
export const REQUEST_TIMEOUT_MS = readTimeout();

function readTimeout(): number {
  const value = Number(process.env.AI_REQUEST_TIMEOUT_MS);
  return Number.isFinite(value) && value >= 1000 && value <= 120_000 ? value : 60_000;
}

/**
 * SDK 자동 재시도 횟수. SDK 기본값은 2회인데, 타임아웃 후 재시도하면
 * 같은 요청이 중복 과금될 수 있으므로 0으로 끈다. 재시도는 사용자가 직접 한다.
 */
export const MAX_RETRIES = 0;

/** 공개 단가 기준 예상 비용(USD). 실제 청구액은 각 사 대시보드에서 확인해야 한다. */
export function estimateCostUsd(modelId: ModelId, usage: TokenUsage): number {
  const price = AI_MODELS[modelId].pricePerMTok;
  return (usage.inputTokens * price.input + usage.outputTokens * price.output) / 1_000_000;
}
