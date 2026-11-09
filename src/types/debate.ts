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

/**
 * 결과 패널 하나의 상태.
 * 성공(실제 분석 결과) 상태는 API를 연결하는 Phase 3에서 추가한다.
 * 지금 추가하면 보여줄 실제 데이터가 없기 때문이다.
 */
export type PanelState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "not_connected"; message: string }
  | { status: "error"; message: string };
