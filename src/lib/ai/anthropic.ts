import "server-only"; // 브라우저 번들에 포함되면 빌드 오류가 나도록 막는다.

// Anthropic Messages API 호출. 응답 텍스트와 토큰 사용량을 공통 형식으로 반환한다.

import Anthropic from "@anthropic-ai/sdk";
import { AiError, aiErrorFromStatus, readApiKey } from "./errors";
import {
  AI_MODELS,
  MAX_OUTPUT_TOKENS,
  MAX_RETRIES,
  REQUEST_TIMEOUT_MS,
  type CallOptions,
  type PromptInput,
  type ProviderOutput,
} from "./models";

const config = AI_MODELS.claude;

export async function analyzeWithAnthropic(
  { system, user }: PromptInput,
  options: CallOptions = {},
): Promise<ProviderOutput> {
  const client = new Anthropic({
    apiKey: readApiKey(config.apiKeyEnv),
    timeout: REQUEST_TIMEOUT_MS,
    maxRetries: MAX_RETRIES,
  });

  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: config.id,
      max_tokens: options.maxOutputTokens ?? MAX_OUTPUT_TOKENS,
      // 사고(thinking) 토큰도 max_tokens에 포함된다. 도구를 쓰지 않는 요청에서
      // between_tools는 사고를 끄는 설정이라, 출력 상한 전체를 답변에 쓸 수 있다.
      thinking: { type: "between_tools" },
      system,
      messages: [{ role: "user", content: user }],
      ...(options.jsonSchema && {
        output_config: {
          format: { type: "json_schema", schema: options.jsonSchema.schema },
        },
      }),
    });
  } catch (err) {
    throw toAiError(err);
  }

  // 안전 정책상 응답을 거부하면 HTTP 200이지만 stop_reason이 refusal이다.
  if (response.stop_reason === "refusal") throw new AiError("refused");

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
  if (!text) throw new AiError("empty_response");

  return {
    text,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
    truncated: response.stop_reason === "max_tokens",
  };
}

function toAiError(err: unknown): AiError {
  if (err instanceof AiError) return err;
  // 타임아웃은 연결 오류의 하위 클래스이므로 먼저 확인한다.
  if (err instanceof Anthropic.APIConnectionTimeoutError) return new AiError("timeout");
  if (err instanceof Anthropic.APIConnectionError) return new AiError("network_error");
  if (err instanceof Anthropic.APIError) return aiErrorFromStatus(err.status);
  return new AiError("unknown");
}
