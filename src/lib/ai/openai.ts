import "server-only"; // 브라우저 번들에 포함되면 빌드 오류가 나도록 막는다.

// OpenAI Responses API 호출. 응답 텍스트와 토큰 사용량을 공통 형식으로 반환한다.

import OpenAI from "openai";
import { AiError, aiErrorFromStatus, readApiKey } from "./errors";
import {
  AI_MODELS,
  MAX_OUTPUT_TOKENS,
  MAX_RETRIES,
  REQUEST_TIMEOUT_MS,
  type PromptInput,
  type ProviderOutput,
} from "./models";

const config = AI_MODELS.gpt;

export async function analyzeWithOpenAI({ system, user }: PromptInput): Promise<ProviderOutput> {
  const client = new OpenAI({
    apiKey: readApiKey(config.apiKeyEnv),
    timeout: REQUEST_TIMEOUT_MS,
    maxRetries: MAX_RETRIES,
  });

  let response: OpenAI.Responses.Response;
  try {
    response = await client.responses.create({
      model: config.id,
      instructions: system,
      input: user,
      max_output_tokens: MAX_OUTPUT_TOKENS,
      reasoning: { effort: config.reasoningEffort },
      store: false, // 대화 내용을 OpenAI 쪽에 저장하지 않는다 (이어서 대화할 필요가 없음)
    });
  } catch (err) {
    throw toAiError(err);
  }

  const incompleteReason = response.incomplete_details?.reason;
  if (incompleteReason === "content_filter") throw new AiError("refused");
  if (response.status === "failed" || response.error) {
    throw new AiError("provider_error");
  }

  const text = response.output_text?.trim() ?? "";
  if (!text) {
    // 추론에 토큰을 모두 써 버려 답변이 비는 경우도 여기에 해당한다.
    throw new AiError("empty_response", {
      message:
        incompleteReason === "max_output_tokens"
          ? "출력 토큰 상한에 도달해 답변이 생성되지 않았습니다."
          : undefined,
    });
  }

  return {
    text,
    usage: {
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
    },
    truncated: incompleteReason === "max_output_tokens",
  };
}

function toAiError(err: unknown): AiError {
  if (err instanceof AiError) return err;
  // 타임아웃은 연결 오류의 하위 클래스이므로 먼저 확인한다.
  if (err instanceof OpenAI.APIConnectionTimeoutError) return new AiError("timeout");
  if (err instanceof OpenAI.APIConnectionError) return new AiError("network_error");
  if (err instanceof OpenAI.APIError) return aiErrorFromStatus(err.status);
  return new AiError("unknown");
}
