// POST /api/analyze
// 주제를 검증한 뒤 GPT와 Claude를 병렬로 호출해 각각의 독립 분석을 반환한다.
// API 키는 이 서버 코드 안에서만 사용되며 브라우저로 전달되지 않는다.

import { analyzeWithAnthropic } from "@/lib/ai/anthropic";
import { AiError } from "@/lib/ai/errors";
import { AI_MODELS, type ProviderOutput } from "@/lib/ai/models";
import { analyzeWithOpenAI } from "@/lib/ai/openai";
import { parseDebateRequest } from "@/lib/debate/config";
import { buildIndependentAnalysisPrompt } from "@/lib/debate/prompts";
import type {
  AnalyzeRequestError,
  AnalyzeResponse,
  ModelAnalysis,
  ModelId,
} from "@/types/debate";

// 서버 함수 최대 실행 시간(초). 모델별 타임아웃(60초)보다 여유 있게 둔다.
// Vercel 등 배포 플랫폼이 이 값을 사용한다.
export const maxDuration = 90;

// 주제 2000자를 JSON으로 감싸도 충분한 크기. 이보다 큰 요청은 읽기 전에 거부한다.
const MAX_BODY_BYTES = 20_000;

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) {
    return requestError(413, "payload_too_large", "요청 크기가 너무 큽니다.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return requestError(400, "invalid_json", "요청 본문이 올바른 JSON이 아닙니다.");
  }

  const parsed = parseDebateRequest(body);
  if (!parsed.ok) return requestError(400, "invalid_input", parsed.message);

  const prompt = buildIndependentAnalysisPrompt(parsed.value);

  // 두 모델을 동시에 호출한다. runModel은 예외를 던지지 않고 항상 결과 객체를 반환하므로
  // 한쪽이 실패해도 다른 쪽 결과는 그대로 유지된다.
  const [gpt, claude] = await Promise.all([
    runModel("gpt", () => analyzeWithOpenAI(prompt)),
    runModel("claude", () => analyzeWithAnthropic(prompt)),
  ]);

  const allFailed = gpt.status === "error" && claude.status === "error";
  const payload: AnalyzeResponse = { results: { gpt, claude }, allFailed };
  return Response.json(payload, { status: allFailed ? 502 : 200 });
}

async function runModel(
  modelId: ModelId,
  call: () => Promise<ProviderOutput>,
): Promise<ModelAnalysis> {
  const model = AI_MODELS[modelId].id;
  const startedAt = Date.now();
  try {
    const output = await call();
    const durationMs = Date.now() - startedAt;
    // 사용량 기록. 주제 원문이나 키는 남기지 않는다.
    console.info(
      `[analyze] ${modelId} ok model=${model} in=${output.usage.inputTokens} out=${output.usage.outputTokens} truncated=${output.truncated} ${durationMs}ms`,
    );
    return { status: "success", model, durationMs, ...output };
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const aiError = err instanceof AiError ? err : new AiError("unknown");
    // SDK 원본 메시지는 키 일부를 담을 수 있으므로 코드와 HTTP 상태만 기록한다.
    console.warn(
      `[analyze] ${modelId} fail model=${model} code=${aiError.code} status=${aiError.httpStatus ?? "-"} ${durationMs}ms`,
    );
    return {
      status: "error",
      model,
      durationMs,
      error: { code: aiError.code, message: aiError.message },
    };
  }
}

function requestError(
  status: number,
  code: AnalyzeRequestError["error"]["code"],
  message: string,
) {
  const payload: AnalyzeRequestError = { error: { code, message } };
  return Response.json(payload, { status });
}
