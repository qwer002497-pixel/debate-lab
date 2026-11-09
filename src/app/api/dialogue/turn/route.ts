// POST /api/dialogue/turn  (대화형 토론, Phase 5)
// 다음 차례 하나를 실행한다.
//   opening: GPT·Claude 병렬 (서로를 보지 않음)
//   reply:   그 차례의 발언자 1명 (전체 대화 + 상대의 직전 발언 기준)
//   closing: GPT·Claude 병렬 (같은 대화 기록, 서로의 closing은 보지 않음)
//
// 순서: 본문 크기 제한 → 요청·transcript 검증 → firstSpeaker 서버 계산 → 순서 규칙 확인
//       → (여기까지 통과해야) 중복 요청 합치기 → 모델 호출
// 서버는 상태를 저장하지 않는다. 기록 보관은 클라이언트(이후 DB) 몫이다.

import { analyzeWithAnthropic } from "@/lib/ai/anthropic";
import { dedupe, dedupeKey } from "@/lib/ai/dedupe";
import { AiError } from "@/lib/ai/errors";
import {
  MAX_OUTPUT_TOKENS_DIALOGUE_CLOSING,
  MAX_OUTPUT_TOKENS_DIALOGUE_SPEECH,
  type ProviderOutput,
} from "@/lib/ai/models";
import { analyzeWithOpenAI } from "@/lib/ai/openai";
import { runModel } from "@/lib/ai/run-model";
import { readJsonBody, requestError } from "@/lib/api/http";
import { DIALOGUE_MAX_BODY_BYTES, parseDialogueTurnRequest } from "@/lib/dialogue/config";
import { hmacFirstSpeakerResolver } from "@/lib/dialogue/first-speaker";
import { buildDialoguePrompt } from "@/lib/dialogue/prompts";
import {
  CLOSING_JSON_SCHEMA,
  parseClosingJson,
  parseSpeechJson,
  SPEECH_JSON_SCHEMA,
} from "@/lib/dialogue/schema";
import type { ApiRequestError, DialogueTurnResponse, DialogueTurnResult } from "@/types/api";
import type { ModelId } from "@/types/debate";
import type { ClosingContent, SpeechContent } from "@/types/dialogue";

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

export async function POST(request: Request) {
  const read = await readJsonBody(request, DIALOGUE_MAX_BODY_BYTES);
  if (!read.ok) return read.response;

  // firstSpeaker는 클라이언트 값을 쓰지 않고 debateId로 서버가 매번 계산한다.
  const parsed = parseDialogueTurnRequest(read.body, (id) => hmacFirstSpeakerResolver.resolve(id));
  if (!parsed.ok) {
    if (parsed.code === "server_misconfigured") {
      // 어떤 설정이 빠졌는지는 서버 로그에만 남긴다 (값은 남기지 않음).
      console.error("[dialogue] DIALOGUE_SEED_SECRET이 없거나 너무 짧아 firstSpeaker를 계산할 수 없습니다.");
    }
    return requestError(STATUS_BY_CODE[parsed.code], parsed.code, parsed.message);
  }
  const { request: debateRequest, debateId, firstSpeaker, kind, index, transcript, slots } = parsed.value;

  // 같은 토론(debateId)의 같은 차례·같은 기록으로 동시에 들어온 요청은 한 번만 호출한다.
  // 키에 검증된 요청 전체(debateId, kind, index, 호출할 칸, transcript, 주제 등)를 넣는다.
  const key = dedupeKey("dialogue", parsed.value);
  const payload = await dedupe(key, async () => {
    const entries = await Promise.all(
      slots.map(async (slot) => {
        const prompt = buildDialoguePrompt({ request: debateRequest, firstSpeaker, slot, transcript });
        const isClosing = slot.kind === "closing";
        const turn = await runModel<{ content: SpeechContent | ClosingContent }>(
          slot.speaker,
          `dialogue-${slot.kind}${slot.index}`,
          () =>
            CALLERS[slot.speaker](prompt, {
              maxOutputTokens: isClosing ? MAX_OUTPUT_TOKENS_DIALOGUE_CLOSING : MAX_OUTPUT_TOKENS_DIALOGUE_SPEECH,
              jsonSchema: isClosing
                ? { name: "dialogue_closing", schema: CLOSING_JSON_SCHEMA }
                : { name: "dialogue_speech", schema: SPEECH_JSON_SCHEMA },
            }),
          (out) => ({ content: toContent(slot.kind, out) }),
        );
        const result: DialogueTurnResult = { index: slot.index, turn: turn as DialogueTurnResult["turn"] };
        return [slot.speaker, result] as const;
      }),
    );
    const results: Partial<Record<ModelId, DialogueTurnResult>> = Object.fromEntries(entries);
    const allFailed = entries.every(([, r]) => r.turn.status === "error");
    return { debateId, firstSpeaker, kind, index, results, allFailed } satisfies DialogueTurnResponse;
  });

  return Response.json(payload, { status: payload.allFailed ? 502 : 200 });
}

/** 모델 응답 텍스트를 검증된 내용으로 변환한다. 형식이 틀리면 invalid_format (과금 사용량은 runModel이 보존). */
function toContent(kind: "opening" | "reply" | "closing", out: ProviderOutput): SpeechContent | ClosingContent {
  const content = kind === "closing" ? parseClosingJson(out.text) : parseSpeechJson(out.text);
  if (!content) {
    throw new AiError("invalid_format", {
      message: out.truncated ? "출력 토큰 상한에 도달해 응답이 중간에 잘렸습니다. 다시 시도해 주세요." : undefined,
    });
  }
  // opening에는 인정할 상대 발언이 없다. 프롬프트로 빈 배열을 요구하고, 그래도 채워 오면 비운다
  // (독립 발언이 존재하지 않는 상대 의견을 "인정"한 것처럼 기록되지 않도록).
  if (kind === "opening" && "acknowledged" in content && content.acknowledged.length) {
    return { ...content, acknowledged: [] };
  }
  return content;
}
