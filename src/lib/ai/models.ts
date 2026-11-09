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

export const AI_MODELS = {
  gpt: {
    provider: "OpenAI",
    id: "gpt-6.1-sol",
    apiKeyEnv: "OPENAI_API_KEY",
    // 추론(reasoning) 토큰도 출력 토큰 상한에 포함된다.
    // 추론에 토큰을 많이 쓰면 실제 답변이 잘리므로 낮게 둔다.
    reasoningEffort: "low",
  },
  claude: {
    provider: "Anthropic",
    id: "claude-sonnet-5-5",
    apiKeyEnv: "ANTHROPIC_API_KEY",
  },
} as const satisfies Record<
  ModelId,
  { provider: string; id: string; apiKeyEnv: string; reasoningEffort?: string }
>;

/**
 * 모델별 최대 출력 토큰. 비용 상한 역할을 한다.
 * 두 모델을 공정하게 비교하기 위해 같은 값을 쓴다.
 */
export const MAX_OUTPUT_TOKENS = 2000;

/** AI 제공사 API 한 번의 응답 대기 시간 상한 (밀리초) */
export const REQUEST_TIMEOUT_MS = 60_000;

/**
 * SDK 자동 재시도 횟수. SDK 기본값은 2회인데, 타임아웃 후 재시도하면
 * 같은 요청이 중복 과금될 수 있으므로 0으로 끈다. 재시도는 사용자가 직접 한다.
 */
export const MAX_RETRIES = 0;
