// 토론 기능 전반에서 공유하는 타입 정의.
// UI(컴포넌트)와 이후 Phase 3의 서버 코드(Route Handler)가 같은 타입을 쓰도록 한 곳에 둔다.

/** 토론 목적 */
export type DebatePurpose =
  | "idea_validation" // 아이디어 검증
  | "problem_solving" // 문제 해결
  | "comparison" // 비교 분석
  | "free"; // 자유 주제

/** 상호 검토 라운드 수. 비용 관리를 위해 허용 값을 고정한다. */
export type RoundCount = 2 | 3 | 5;

/** 토론에 참여하는 AI */
export type ModelId = "gpt" | "claude";

/** 사용자가 제출한 토론 요청 */
export interface DebateRequest {
  topic: string;
  purpose: DebatePurpose;
  rounds: RoundCount;
}

/** 토큰 사용량. 비용 계산과 실험 비교(Phase 6)의 기초 데이터다. */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

/**
 * 브라우저에 보여줘도 안전한 오류 코드.
 * SDK의 원본 오류 메시지는 키 일부 등 민감 정보를 담을 수 있어 그대로 전달하지 않는다.
 */
export type AnalysisErrorCode =
  | "missing_api_key" // 서버 환경변수에 키가 없음
  | "auth_failed" // 키가 잘못되었거나 권한 없음 (401/403)
  | "rate_limited" // 호출 한도 초과 (429)
  | "timeout" // 응답 시간 초과
  | "network_error" // 네트워크 연결 실패
  | "invalid_request" // 요청 형식/모델 ID 문제 (400/404/422)
  | "provider_error" // AI 제공사 서버 오류 (5xx)
  | "refused" // 모델이 안전 정책상 응답 거부
  | "empty_response" // 응답에 텍스트가 없음
  | "unknown";

/** 모델 하나의 독립 분석 결과 (POST /api/analyze 응답의 일부) */
export type ModelAnalysis =
  | {
      status: "success";
      model: string; // 실제 호출한 모델 ID
      text: string;
      usage: TokenUsage;
      truncated: boolean; // 출력 토큰 상한에 걸려 잘렸는지
      durationMs: number;
    }
  | {
      status: "error";
      model: string;
      error: { code: AnalysisErrorCode; message: string };
      durationMs: number;
    };

/** POST /api/analyze 의 응답 (입력이 유효해 두 모델을 호출한 경우) */
export interface AnalyzeResponse {
  results: Record<ModelId, ModelAnalysis>;
  /** 두 모델 모두 실패했는지. 이 경우 HTTP 502로 응답한다. */
  allFailed: boolean;
}

/** POST /api/analyze 의 요청 자체가 잘못된 경우의 응답 (HTTP 400/413) */
export interface AnalyzeRequestError {
  error: { code: "invalid_json" | "invalid_input" | "payload_too_large"; message: string };
}

/** 결과 패널 하나의 상태 */
export type PanelState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "not_connected"; message: string }
  | { status: "error"; message: string }
  | {
      status: "success";
      model: string;
      text: string;
      usage: TokenUsage;
      truncated: boolean;
      durationMs: number;
    };
