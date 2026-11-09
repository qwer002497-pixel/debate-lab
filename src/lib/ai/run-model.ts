import "server-only";

// 모델 호출 1회를 실행하고, 성공이든 실패든 항상 ModelTurn 객체로 돌려준다(예외를 던지지 않음).
// 그래서 두 모델을 Promise.all로 병렬 호출해도 한쪽 실패가 다른 쪽 결과를 지우지 않는다.
// /api/analyze 와 /api/debate/round 가 같은 함수를 쓴다.

import type { ModelId, ModelTurn } from "@/types/debate";
import { AiError } from "./errors";
import { AI_MODELS, estimateCostUsd, type ProviderOutput } from "./models";

export async function runModel<T extends object>(
  modelId: ModelId,
  label: string, // 로그 구분용 (예: "analyze", "round2")
  call: () => Promise<ProviderOutput>,
  /** 응답 텍스트를 결과 내용으로 변환. 형식이 잘못되면 AiError("invalid_format")를 던진다. */
  transform: (output: ProviderOutput) => T,
): Promise<ModelTurn<T>> {
  const model = AI_MODELS[modelId].id;
  const startedAt = Date.now();
  let output: ProviderOutput | undefined;
  try {
    output = await call();
    const content = transform(output);
    const durationMs = Date.now() - startedAt;
    const estimatedCostUsd = estimateCostUsd(modelId, output.usage);
    // 사용량 기록. 주제 원문, 응답 원문, 키는 남기지 않는다.
    console.info(
      `[${label}] ${modelId} ok model=${model} in=${output.usage.inputTokens} out=${output.usage.outputTokens} truncated=${output.truncated} cost=$${estimatedCostUsd.toFixed(4)} ${durationMs}ms`,
    );
    return {
      status: "success",
      model,
      usage: output.usage,
      estimatedCostUsd,
      truncated: output.truncated,
      durationMs,
      ...content,
    };
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const aiError = err instanceof AiError ? err : new AiError("unknown");
    // 응답을 받은 뒤 형식 검증에서 실패했다면 이미 과금되었으므로 사용량을 함께 남긴다.
    const billed = output
      ? { usage: output.usage, estimatedCostUsd: estimateCostUsd(modelId, output.usage) }
      : {};
    // SDK 원본 메시지는 키 일부를 담을 수 있으므로 코드와 HTTP 상태만 기록한다.
    console.warn(
      `[${label}] ${modelId} fail model=${model} code=${aiError.code} status=${aiError.httpStatus ?? "-"}${output ? ` in=${output.usage.inputTokens} out=${output.usage.outputTokens} truncated=${output.truncated}` : ""} ${durationMs}ms`,
    );
    return {
      status: "error",
      model,
      durationMs,
      error: { code: aiError.code, message: aiError.message },
      ...billed,
    };
  }
}
