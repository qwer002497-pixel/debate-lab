// POST /api/analyze
// 주제를 검증한 뒤 GPT와 Claude를 병렬로 호출해 각각의 독립 분석(최초 분석)을 반환한다.
// models를 지정하면 그 모델만 호출한다 (한쪽만 실패했을 때 재시도용, Phase 4).
// API 키는 이 서버 코드 안에서만 사용되며 브라우저로 전달되지 않는다.

import { analyzeWithAnthropic } from "@/lib/ai/anthropic";
import { dedupe, dedupeKey } from "@/lib/ai/dedupe";
import { analyzeWithOpenAI } from "@/lib/ai/openai";
import { runModel } from "@/lib/ai/run-model";
import { readJsonBody, requestError } from "@/lib/api/http";
import { parseAnalyzeRequest } from "@/lib/debate/config";
import { buildIndependentAnalysisPrompt } from "@/lib/debate/prompts";
import type { AnalyzeResponse } from "@/types/api";
import type { ModelAnalysis, ModelId } from "@/types/debate";

// 서버 함수 최대 실행 시간(초). 모델별 타임아웃(기본 60초)보다 여유 있게 둔다.
// Vercel 등 배포 플랫폼이 이 값을 사용한다.
export const maxDuration = 90;

// 주제 2000자를 JSON으로 감싸도 충분한 크기. 이보다 큰 요청은 거부한다.
const MAX_BODY_BYTES = 20_000;

const CALLERS = { gpt: analyzeWithOpenAI, claude: analyzeWithAnthropic } as const;

export async function POST(request: Request) {
  const read = await readJsonBody(request, MAX_BODY_BYTES);
  if (!read.ok) return read.response;

  const parsed = parseAnalyzeRequest(read.body);
  if (!parsed.ok) return requestError(400, "invalid_input", parsed.message);
  const { models, ...debateRequest } = parsed.value;

  // 같은 내용의 요청이 동시에 들어오면 한 번만 호출한다.
  const payload = await dedupe(dedupeKey("analyze", parsed.value), async () => {
    const prompt = buildIndependentAnalysisPrompt(debateRequest);
    // 요청한 모델을 동시에 호출한다. runModel은 예외를 던지지 않으므로 한쪽 실패가 다른 쪽에 영향을 주지 않는다.
    const entries = await Promise.all(
      models.map(
        async (id) =>
          [
            id,
            await runModel(id, "analyze", () => CALLERS[id](prompt), (out) => ({ text: out.text })),
          ] as const,
      ),
    );
    const results: Partial<Record<ModelId, ModelAnalysis>> = Object.fromEntries(entries);
    const allFailed = entries.every(([, r]) => r.status === "error");
    return { results, allFailed } satisfies AnalyzeResponse;
  });

  return Response.json(payload, { status: payload.allFailed ? 502 : 200 });
}
