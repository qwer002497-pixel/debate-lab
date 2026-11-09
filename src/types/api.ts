// HTTP API의 요청/응답 형식 (DTO).
// 도메인 타입(types/debate.ts)과 분리해, API 형식이 바뀌어도 도메인 구조는 유지되게 한다.

import type {
  DebateRequest,
  ModelAnalysis,
  ModelId,
  RebuttalContent,
  RoundTurn,
} from "./debate";
import type {
  ClosingTurn,
  DialogueTranscriptEntry,
  DialogueTurnKind,
  SpeechTurn,
} from "./dialogue";
import type { AbOrder, ComparisonTurn } from "./comparison";

/** POST /api/analyze 요청. models를 생략하면 두 모델 모두 호출한다. */
export interface AnalyzeRequestBody extends DebateRequest {
  models?: ModelId[];
}

/** POST /api/analyze 응답. 요청한 모델의 결과만 들어 있다. */
export interface AnalyzeResponse {
  results: Partial<Record<ModelId, ModelAnalysis>>;
  /** 요청한 모델이 모두 실패했는지. 이 경우 HTTP 502로 응답한다. */
  allFailed: boolean;
}

/**
 * POST /api/debate/round 요청.
 * 서버는 상태를 저장하지 않으므로, 클라이언트가 이전 단계 결과를 함께 보낸다.
 * "현재 라운드"의 상대 응답이 들어갈 자리는 일부러 두지 않는다(같은 라운드 상호 참조 차단).
 */
export interface RoundRequestBody extends DebateRequest {
  round: number; // 1..rounds
  initial: Record<ModelId, string>; // 두 모델의 최초 분석 텍스트
  previous: Record<ModelId, RebuttalContent> | null; // round-1 라운드의 두 모델 응답 (round=1이면 null)
  models?: ModelId[]; // 재시도 시 실패한 모델만 지정
}

/** POST /api/debate/round 응답 */
export interface RoundResponse {
  round: number;
  results: Partial<Record<ModelId, RoundTurn>>;
  allFailed: boolean;
}

/** 요청 자체가 잘못된 경우의 응답 (HTTP 400/409/413) */
export interface ApiRequestError {
  error: {
    code:
      | "invalid_json"
      | "invalid_input"
      | "payload_too_large"
      | "sequence_error" // 대화형: 발언 순서·transcript가 순서 규칙과 맞지 않음
      | "dialogue_complete" // 대화형: closing까지 끝나 더 실행할 차례가 없음
      | "server_misconfigured"; // 서버 설정 누락(예: 대화형 비밀키). 상세 내용은 응답에 넣지 않는다.
    message: string;
  };
}

// ---------------------------------------------------------------------------
// 대화형 토론 (Phase 5) — POST /api/dialogue/turn
// ---------------------------------------------------------------------------

/**
 * 대화형 발언 요청.
 * - debateId: 클라이언트가 토론 시작 시 만든 UUID(v4). 서버는 이 값으로 firstSpeaker를 매번 다시 계산한다.
 *   (firstSpeaker는 요청에 넣지 않는다. 보내면 400으로 거부한다.)
 * - index: 실행할 "단계의 시작 index" (opening 0, reply 그 발언의 index, closing 2N+2)
 * - transcript: 지금까지 성공한 발언 전체 (index 오름차순). 서버가 순서 규칙으로 다음 차례인지 검증한다.
 * - models: opening/closing 재시도 시 실패한 모델만 지정. reply는 생략하거나 그 차례 발언자만.
 */
export interface DialogueTurnRequestBody extends DebateRequest {
  debateId: string;
  kind: DialogueTurnKind;
  index: number;
  transcript: DialogueTranscriptEntry[];
  models?: ModelId[];
}

/** 모델 1개의 발언 결과. index는 이 발언이 transcript에서 차지할 자리 */
export interface DialogueTurnResult {
  index: number;
  turn: SpeechTurn | ClosingTurn;
}

/**
 * POST /api/dialogue/turn 응답. reply는 발언자 1명, opening/closing은 요청한 모델의 결과만 담는다.
 * firstSpeaker는 서버가 debateId로 계산한 값이다 (클라이언트는 화면 표시용으로만 사용).
 */
export interface DialogueTurnResponse {
  debateId: string;
  firstSpeaker: ModelId;
  kind: DialogueTurnKind;
  index: number;
  results: Partial<Record<ModelId, DialogueTurnResult>>;
  allFailed: boolean;
}

// ---------------------------------------------------------------------------
// 최종 비교 (Phase 5-8) — POST /api/dialogue/compare
// ---------------------------------------------------------------------------

/**
 * 최종 비교 요청. transcript는 Closing 2개까지 포함한 2N+4개 전체.
 * firstSpeaker·comparator·abOrder는 서버가 debateId로 계산하므로 보내면 400으로 거부한다.
 */
export interface DialogueCompareRequestBody extends DebateRequest {
  debateId: string;
  transcript: DialogueTranscriptEntry[];
}

/** 최종 비교 응답. results의 키는 비교 담당 모델 1개뿐이다. */
export interface DialogueCompareResponse {
  debateId: string;
  firstSpeaker: ModelId;
  comparator: ModelId; // 비교 담당 (토론 참여자 중 하나 — 중립을 보장하지 않음)
  /**
   * 비교 프롬프트에서 참여자 A/B가 실제로 어느 모델이었는지 (서버가 debateId로 계산, P5-8 재생 검증 후 추가).
   * 비교 결과 본문의 "A는 …", "B가 …" 같은 서술을 사용자가 읽을 수 있게 하려는 사후 공개이며,
   * 비교 담당 모델에게는 여전히 알려주지 않는다. comparator(누가 비교했는지)와는 별개의 정보다.
   */
  abOrder: AbOrder;
  results: Partial<Record<ModelId, ComparisonTurn>>;
  allFailed: boolean;
}
