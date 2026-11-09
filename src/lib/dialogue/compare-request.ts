// 최종 비교 요청(POST /api/dialogue/compare) 검증 (서버·클라이언트 공용, 비밀 정보 없음, P5-8a).
//
// 라우트(P5-8b)의 처리 순서 중 이 함수가 맡는 부분은 2~5단계다.
//   1. 본문 크기 제한(DIALOGUE_COMPARE_MAX_BODY_BYTES) + JSON 파싱      ← 라우트
//   2. 기본 요청 형식 (주제·목적·라운드, 허용 필드, 필드 자료형)          ← 여기
//   3. debateId(UUID v4) 검증 → 서버가 firstSpeaker 계산                  ← 여기 (계산 함수는 주입)
//   4. transcript 크기·항목 구조·내용 스키마 + expectedTurn 순서 검증     ← 여기
//   5. expectedTurn이 done(Closing 2개 포함 2N+4개 모두 성공)인지 확인     ← 여기
//   6~8. 비교 담당·A/B 계산, dedupe, AI 호출·결과 검증                    ← 라우트
// 이 함수가 ok를 반환하기 전에는 어떤 AI 호출도 일어나지 않는다.
//
// 검증 범위의 한계: 구조(순서·종류·발언자·필드·길이)가 잘못된 transcript는 거부하지만,
// 형식은 정상이고 문장 내용만 바꾼 transcript는 서버가 원본을 저장하지 않으므로 검출할 수 없다.
// (DB 단계에서 저장된 transcript와 대조하는 방식으로 해결할 과제)

import type { ApiRequestError } from "@/types/api";
import { parseDebateRequest } from "@/lib/debate/config";
import type { DebateRequest, ModelId } from "@/types/debate";
import type { DialogueTranscriptEntry } from "@/types/dialogue";
import { isDebateId, parseEntry, type FirstSpeakerLookup } from "./config";
import { dialogueTurnCount, expectedTurn } from "./sequence";

/** 비교 요청 본문 상한. 5라운드 최악의 경우(약 211KB)가 대화형 한도 200KB를 넘으므로 별도로 둔다. */
export const DIALOGUE_COMPARE_MAX_BODY_BYTES = 256_000;

/** transcript 단독 상한 (JSON 직렬화 후 UTF-8 바이트) */
export const DIALOGUE_COMPARE_TRANSCRIPT_MAX_BYTES = 240_000;

/** 요청에 허용하는 필드 */
const ALLOWED_KEYS = ["topic", "purpose", "rounds", "debateId", "transcript"];

/** 서버가 debateId로 계산하는 값. 요청에 있으면 거부한다. */
const SERVER_DECIDED_KEYS = ["firstSpeaker", "comparator", "abOrder"];

export interface ParsedDialogueCompare {
  request: DebateRequest;
  debateId: string; // 소문자로 정규화된 UUID
  firstSpeaker: ModelId; // 서버가 debateId로 계산한 값
  transcript: DialogueTranscriptEntry[]; // 2N+4개 전체, index 오름차순
}

type ErrorCode = ApiRequestError["error"]["code"];
export type DialogueCompareParseResult =
  | { ok: true; value: ParsedDialogueCompare }
  | { ok: false; code: ErrorCode; message: string };

export function parseDialogueCompareRequest(
  body: unknown,
  lookupFirstSpeaker: FirstSpeakerLookup,
): DialogueCompareParseResult {
  // 2. 기본 요청 형식
  const base = parseDebateRequest(body);
  if (!base.ok) return bad("invalid_input", base.message);
  const b = body as Record<string, unknown>;

  const serverDecided = SERVER_DECIDED_KEYS.filter((k) => k in b);
  if (serverDecided.length) {
    return bad("invalid_input", `${serverDecided.join(", ")}는 서버가 debateId로 정하므로 요청에 포함할 수 없습니다.`);
  }
  const unknownKeys = Object.keys(b).filter((k) => !ALLOWED_KEYS.includes(k));
  if (unknownKeys.length) {
    return bad("invalid_input", `허용되지 않는 필드입니다: ${unknownKeys.join(", ")}`);
  }
  if (typeof b.debateId !== "string") return bad("invalid_input", "debateId는 문자열이어야 합니다.");
  if (!Array.isArray(b.transcript)) return bad("invalid_input", "transcript는 배열이어야 합니다.");

  // 3. debateId → firstSpeaker (서버 계산)
  if (!isDebateId(b.debateId)) return bad("invalid_input", "debateId는 UUID v4 형식이어야 합니다.");
  const debateId = b.debateId.toLowerCase();
  const resolved = lookupFirstSpeaker(debateId);
  if (!resolved.ok) {
    return bad("server_misconfigured", "서버 설정 문제로 최종 비교를 진행할 수 없습니다. 관리자에게 문의해 주세요.");
  }
  const firstSpeaker = resolved.firstSpeaker;

  // 4. transcript 크기·구조·순서
  const total = dialogueTurnCount(base.value.rounds);
  if (b.transcript.length > total) {
    return bad("invalid_input", `transcript는 최대 ${total}개 발언까지만 보낼 수 있습니다.`);
  }
  const bytes = new TextEncoder().encode(JSON.stringify(b.transcript)).byteLength;
  if (bytes > DIALOGUE_COMPARE_TRANSCRIPT_MAX_BYTES) {
    return bad("payload_too_large", `transcript가 너무 큽니다 (${bytes}바이트).`);
  }
  const transcript: DialogueTranscriptEntry[] = [];
  for (let i = 0; i < b.transcript.length; i++) {
    const parsed = parseEntry(b.transcript[i]);
    if (typeof parsed === "string") return bad("invalid_input", `transcript[${i}]: ${parsed}`);
    transcript.push(parsed);
  }
  const seq = expectedTurn({ rounds: base.value.rounds, firstSpeaker }, transcript);
  if (!seq.ok) return bad("sequence_error", seq.message);

  // 5. 마무리까지 모두 끝났는지
  if (seq.next.kind !== "done") {
    return bad(
      "sequence_error",
      `마무리까지 끝난 토론만 비교할 수 있습니다. 다음 차례: ${seq.next.kind} (index ${seq.next.index})`,
    );
  }

  return { ok: true, value: { request: base.value, debateId, firstSpeaker, transcript } };
}

function bad(code: ErrorCode, message: string): DialogueCompareParseResult {
  return { ok: false, code, message };
}
