// POST /api/debate/round
// 반론 라운드 1개를 실행한다. 두 모델을 병렬로 호출하고, 각 모델은
// "최초 분석 + 직전 라운드" 까지만 받는다. 같은 라운드의 상대 응답은 요청 구조상 전달될 수 없다.
//
// 전체 토론을 한 요청으로 묶지 않고 라운드마다 따로 호출한다.
// → 요청 하나의 실행 시간이 배포 환경 제한(maxDuration) 안에 들어오고, 실패해도 이전 라운드는 보존된다.

import { analyzeWithAnthropic } from "@/lib/ai/anthropic";
import { dedupe, dedupeKey } from "@/lib/ai/dedupe";
import { AiError } from "@/lib/ai/errors";
import { MAX_OUTPUT_TOKENS_ROUND } from "@/lib/ai/models";
import { analyzeWithOpenAI } from "@/lib/ai/openai";
import { runModel } from "@/lib/ai/run-model";
import { readJsonBody, requestError } from "@/lib/api/http";
import { parseRoundRequest } from "@/lib/debate/config";
import { buildRebuttalPrompt } from "@/lib/debate/prompts";
import { parseRebuttalJson, REBUTTAL_JSON_SCHEMA } from "@/lib/debate/rebuttal";
import type { RoundResponse } from "@/types/api";
import type { ModelId, RoundTurn } from "@/types/debate";

export const maxDuration = 90;

// 주제(2000자) + 최초 분석 2개(각 8000자) + 직전 라운드 2개. 한글은 UTF-8에서 글자당 3바이트.
const MAX_BODY_BYTES = 96_000;

const CALLERS = { gpt: analyzeWithOpenAI, claude: analyzeWithAnthropic } as const;

export async function POST(request: Request) {
  const read = await readJsonBody(request, MAX_BODY_BYTES);
  if (!read.ok) return read.response;

  const parsed = parseRoundRequest(read.body);
  if (!parsed.ok) return requestError(400, "invalid_input", parsed.message);
  const { round, initial, previous, models, ...debateRequest } = parsed.value;

  const payload = await dedupe(dedupeKey("round", parsed.value), async () => {
    const entries = await Promise.all(
      models.map(async (id) => {
        // 각 모델의 프롬프트는 요청에 담긴 이전 단계 데이터만으로 만든다.
        const prompt = buildRebuttalPrompt({ request: debateRequest, round, self: id, initial, previous });
        const turn: RoundTurn = await runModel(
          id,
          `round${round}`,
          () =>
            CALLERS[id](prompt, {
              maxOutputTokens: MAX_OUTPUT_TOKENS_ROUND,
              jsonSchema: { name: "rebuttal", schema: REBUTTAL_JSON_SCHEMA },
            }),
          (out) => {
            const content = parseRebuttalJson(out.text);
            if (!content) {
              throw new AiError("invalid_format", {
                message: out.truncated
                  ? "출력 토큰 상한에 도달해 응답이 중간에 잘렸습니다. 다시 시도해 주세요."
                  : undefined,
              });
            }
            return { content };
          },
        );
        return [id, turn] as const;
      }),
    );
    const results: Partial<Record<ModelId, RoundTurn>> = Object.fromEntries(entries);
    const allFailed = entries.every(([, r]) => r.status === "error");
    return { round, results, allFailed } satisfies RoundResponse;
  });

  return Response.json(payload, { status: payload.allFailed ? 502 : 200 });
}
