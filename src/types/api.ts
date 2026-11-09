// HTTP API의 요청/응답 형식 (DTO).
// 도메인 타입(types/debate.ts)과 분리해, API 형식이 바뀌어도 도메인 구조는 유지되게 한다.

import type {
  DebateRequest,
  ModelAnalysis,
  ModelId,
  RebuttalContent,
  RoundTurn,
} from "./debate";

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

/** 요청 자체가 잘못된 경우의 응답 (HTTP 400/413) */
export interface ApiRequestError {
  error: {
    code: "invalid_json" | "invalid_input" | "payload_too_large";
    message: string;
  };
}
