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
  | "invalid_format" // 응답이 요구한 JSON 구조가 아님 (반론 라운드)
  | "unknown";

export interface ModelError {
  code: AnalysisErrorCode;
  message: string;
}

/**
 * 모델 호출 1회의 결과(턴). 최초 분석과 반론 라운드가 같은 틀을 쓰고,
 * 성공 시 내용(T)만 다르다. 향후 DB의 "turn" 테이블 한 행에 대응한다.
 */
export type ModelTurn<T extends object> =
  | ({
      status: "success";
      model: string; // 실제 호출한 모델 ID
      usage: TokenUsage;
      estimatedCostUsd: number; // 공개 단가 기준 추정치 (실제 청구액 아님)
      truncated: boolean; // 출력 토큰 상한에 걸려 잘렸는지
      durationMs: number;
    } & T)
  | {
      status: "error";
      model: string;
      error: ModelError;
      durationMs: number;
      // 응답은 받았지만 형식이 잘못된 경우처럼, 실패해도 과금된 경우에만 채워진다.
      usage?: TokenUsage;
      estimatedCostUsd?: number;
    };

/** 최초 독립 분석 결과 */
export type ModelAnalysis = ModelTurn<{ text: string }>;

/** 상대 주장에 대한 평가 */
export type Stance = "agree" | "partially_agree" | "disagree";

/** 반론 라운드에서 모델이 작성하는 구조화된 응답 (9개 항목) */
export interface RebuttalContent {
  opponentSummary: string; // 1. 상대방 주장 요약
  stance: Stance; // 2. 평가
  stanceReason: string; // 3. 평가 근거
  logicalGaps: string[]; // 4. 논리적 허점
  counterpoints: string[]; // 5. 반례 및 다른 관점
  acceptedPoints: string[]; // 6. 상대방 주장 중 수용할 내용
  maintainedPoints: string[]; // 7. 기존 입장에서 유지할 내용
  revisedPosition: string; // 8. 수정된 입장
  verificationNeeded: string[]; // 9. 추가 검증이 필요한 사항
}

/** 반론 라운드의 모델 턴 */
export type RoundTurn = ModelTurn<{ content: RebuttalContent }>;

/** 라운드 하나의 기록. 라운드 번호는 1부터 (최초 분석은 라운드에 포함하지 않음) */
export interface DebateRoundRecord {
  round: number;
  turns: Partial<Record<ModelId, RoundTurn>>;
}

export type DebateStatus = "idle" | "running" | "paused" | "completed" | "stopped";

/**
 * 토론 한 건의 전체 기록. 지금은 브라우저 메모리에만 있고,
 * DB 단계에서 이 구조를 그대로 저장할 수 있도록 화면 상태(로딩 등)와 분리해 둔다.
 */
export interface DebateSession {
  request: DebateRequest;
  initial: Partial<Record<ModelId, ModelAnalysis>>;
  rounds: DebateRoundRecord[];
  status: DebateStatus;
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
      estimatedCostUsd: number;
      truncated: boolean;
      durationMs: number;
    };
