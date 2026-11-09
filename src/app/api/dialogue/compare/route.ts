// POST /api/dialogue/compare  (최종 비교, Phase 5-8)
// 마무리(Closing) 2개까지 모두 성공한 대화형 토론의 전체 transcript를, 비교 담당 모델 1개가 비교한다.
// 비교 담당은 두 참여 모델 중 하나(debateId로 서버가 결정)이며 중립적인 제3자가 아니다.
//
// 처리 순서 (1~6단계를 모두 통과해야 AI를 호출한다)
//   1. 본문 크기 제한(256KB) + JSON 파싱
//   2. 기본 요청 형식 (주제·목적·라운드, 허용 필드, 자료형) — 서버가 정하는 값(firstSpeaker·comparator·abOrder) 거부
//   3. debateId(UUID v4) → firstSpeaker 서버 계산 (비밀키 없으면 503)
//   4. transcript 크기(240KB)·항목 구조·내용 스키마 + 발언 순서 검증
//   5. Closing까지 모두 끝났는지 (아니면 409)
//   6. 비교 담당 모델·A/B 순서 서버 계산 (HMAC, firstSpeaker와 다른 domain)
//   7. 중복 요청 합치기 (같은 검증된 요청이 동시에 오면 한 번만 호출)
//   8. 비교 프롬프트 생성 → 모델 호출(구조화 JSON) → 결과 검증 → A/B를 GPT/Claude로 변환
// 서버는 상태를 저장하지 않는다. 비교가 실패해도 클라이언트가 가진 Closing 결과에는 영향이 없다.

import { analyzeWithAnthropic } from "@/lib/ai/anthropic";
import { dedupe, dedupeKey } from "@/lib/ai/dedupe";
import { AiError } from "@/lib/ai/errors";
import { MAX_OUTPUT_TOKENS_DIALOGUE_COMPARISON, type ProviderOutput } from "@/lib/ai/models";
import { analyzeWithOpenAI } from "@/lib/ai/openai";
import { runModel } from "@/lib/ai/run-model";
import { readJsonBody, requestError } from "@/lib/api/http";
import { DIALOGUE_COMPARE_MAX_BODY_BYTES, parseDialogueCompareRequest } from "@/lib/dialogue/compare-request";
import { hmacComparisonRoleResolver } from "@/lib/dialogue/comparator";
import { buildComparisonPrompt } from "@/lib/dialogue/comparison-prompts";
import { COMPARISON_JSON_SCHEMA, parseComparisonJson, toComparisonContent } from "@/lib/dialogue/comparison-schema";
import { hmacFirstSpeakerResolver } from "@/lib/dialogue/first-speaker";
import type { ApiRequestError, DialogueCompareResponse } from "@/types/api";
import type { AbOrder, ComparisonContent } from "@/types/comparison";
import type { RoundCount } from "@/types/debate";

export const maxDuration = 90;

const CALLERS = { gpt: analyzeWithOpenAI, claude: analyzeWithAnthropic } as const;

const STATUS_BY_CODE: Record<ApiRequestError["error"]["code"], number> = {
  invalid_json: 400,
  invalid_input: 400,
  payload_too_large: 413,
  sequence_error: 409,
  dialogue_complete: 409,
  server_misconfigured: 503,
};

const MISCONFIGURED_MESSAGE = "서버 설정 문제로 최종 비교를 진행할 수 없습니다. 관리자에게 문의해 주세요.";

export async function POST(request: Request) {
  // 1
  const read = await readJsonBody(request, DIALOGUE_COMPARE_MAX_BODY_BYTES);
  if (!read.ok) return read.response;

  // 2~5
  const parsed = parseDialogueCompareRequest(read.body, (id) => hmacFirstSpeakerResolver.resolve(id));
  if (!parsed.ok) {
    if (parsed.code === "server_misconfigured") logMisconfigured();
    return requestError(STATUS_BY_CODE[parsed.code], parsed.code, parsed.message);
  }
  const { request: debateRequest, debateId, firstSpeaker, transcript } = parsed.value;

  // 6. 같은 비밀키를 쓰므로 3단계를 통과했다면 실패하지 않지만, 구현이 바뀌어도 AI 호출 전에 막도록 확인한다.
  const roles = hmacComparisonRoleResolver.resolve(debateId);
  if (!roles.ok) {
    logMisconfigured();
    return requestError(503, "server_misconfigured", MISCONFIGURED_MESSAGE);
  }
  const { comparator, abOrder } = roles;

  // 7. 키 = 검증된 요청 전체(debateId 포함). comparator·A/B는 debateId로 결정되므로 키에 이미 반영된다.
  const key = dedupeKey("dialogue-compare", parsed.value);
  const payload = await dedupe(key, async () => {
    // 8
    const prompt = buildComparisonPrompt({ request: debateRequest, transcript, abOrder });
    const turn = await runModel<{ content: ComparisonContent }>(
      comparator,
      "dialogue-compare",
      () =>
        CALLERS[comparator](prompt, {
          maxOutputTokens: MAX_OUTPUT_TOKENS_DIALOGUE_COMPARISON,
          jsonSchema: { name: "dialogue_comparison", schema: COMPARISON_JSON_SCHEMA },
        }),
      (out) => ({ content: toContent(out, debateRequest.rounds, abOrder) }),
    );
    return {
      debateId,
      firstSpeaker,
      comparator,
      abOrder, // 사후 공개: 모델 호출이 끝난 뒤 응답에만 넣는다 (프롬프트에는 A/B만)
      results: { [comparator]: turn },
      allFailed: turn.status === "error",
    } satisfies DialogueCompareResponse;
  });

  return Response.json(payload, { status: payload.allFailed ? 502 : 200 });
}

/** 모델 응답을 검증하고 A/B를 GPT/Claude로 되돌린다. 형식이 틀리면 invalid_format (과금 사용량은 runModel이 보존). */
function toContent(out: ProviderOutput, rounds: RoundCount, abOrder: AbOrder): ComparisonContent {
  const parsed = parseComparisonJson(out.text, rounds);
  if (!parsed.ok) {
    // 검증 실패 사유는 필드 이름·개수·index만 담고 응답 원문은 담지 않는다 (서버 로그 전용).
    console.warn(`[dialogue-compare] invalid_format: ${parsed.reason}`);
    throw new AiError("invalid_format", {
      message: out.truncated ? "출력 토큰 상한에 도달해 응답이 중간에 잘렸습니다. 다시 시도해 주세요." : undefined,
    });
  }
  return toComparisonContent(parsed.value, abOrder);
}

function logMisconfigured() {
  // 어떤 설정이 빠졌는지만 서버 로그에 남긴다 (값은 남기지 않음).
  console.error("[dialogue-compare] DIALOGUE_SEED_SECRET이 없거나 너무 짧아 최종 비교를 진행할 수 없습니다.");
}
