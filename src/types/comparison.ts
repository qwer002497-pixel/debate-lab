// 최종 비교(Final Comparison, Phase 5-8)의 도메인 타입.
// 마무리(Closing)까지 끝난 대화형 토론의 전체 transcript를, 두 참여 모델 중 하나(비교 담당)가 읽고
// 두 모델의 최종 결론을 비교한 결과다. 비교 담당은 토론 참여자이므로 중립을 보장하지 않는다.
//
// 형식은 두 단계로 나뉜다.
// - ComparisonOutput: 모델이 출력하는 형식. 모델은 참여자를 "A/B"로만 안다 (제조사 이름 없음).
// - ComparisonContent: 서버가 검증 후 A/B를 GPT/Claude로 되돌려 저장·표시하는 형식.

import type { ModelId, ModelTurn } from "./debate";

/**
 * 전체 관계 (각 목록의 항목 수로 일관성을 검증한다).
 * aligned: 합의점 ≥1, 남은 차이 0 / partially_aligned: 합의점 ≥1, 남은 차이 ≥1
 * divergent: 남은 차이 ≥1 (합의점 0 가능) / undetermined: 합의점 0, 남은 차이 0, 판단 불가 ≥1
 */
export type ComparisonRelation = "aligned" | "partially_aligned" | "divergent" | "undetermined";

/**
 * 해소 시점의 종류.
 * reply: 응답 발언(index 2…2N+1)에서 해소 / closing: 한 모델의 마무리(2N+2 또는 2N+3)에서 해소
 * closings_combined: 두 마무리를 함께 봐야 해소를 알 수 있음 (index는 마무리 단계 시작 2N+2로 고정)
 * opening(0, 1)은 상호작용 전 독립 의견이므로 해소 시점이 될 수 없다.
 */
export type ResolvedStage = "reply" | "closing" | "closings_combined";

/** 해소된 차이 (모델 출력·저장 형식 공통: A/B 정보가 없다) */
export interface ResolvedDisagreement {
  issue: string;
  initialDifference: string; // 처음에 어떻게 달랐는지
  howResolved: string; // 어떻게 해소되었는지
  resolvedStage: ResolvedStage;
  resolvedAtIndex: number;
}

/** 판단 불가 항목: 대화 기록만으로는 차이가 있는지, 어느 쪽이 맞는지 정할 수 없음 */
export interface UndeterminedItem {
  issue: string;
  missingEvidence: string; // 판단에 필요한데 없는 근거
}

// ---------------------------------------------------------------------------
// 모델 출력 형식 (A/B)
// ---------------------------------------------------------------------------

export interface DisagreementAB {
  issue: string;
  positionA: string;
  positionB: string;
  difference: string;
  basisOrCondition: string; // 갈린 기준·조건
}

export interface EquivalentStatementAB {
  meaning: string; // 공통된 의미
  wordingA: string;
  wordingB: string;
}

export interface ComparisonOutput {
  relation: ComparisonRelation;
  agreedPoints: string[];
  disagreements: DisagreementAB[];
  resolvedDisagreements: ResolvedDisagreement[];
  equivalentStatements: EquivalentStatementAB[];
  undetermined: UndeterminedItem[];
  verificationNeeded: string[];
}

// ---------------------------------------------------------------------------
// 저장·표시 형식 (GPT/Claude)
// ---------------------------------------------------------------------------

export interface Disagreement {
  issue: string;
  gptPosition: string;
  claudePosition: string;
  difference: string;
  basisOrCondition: string;
}

export interface EquivalentStatement {
  meaning: string;
  gptWording: string;
  claudeWording: string;
}

export interface ComparisonContent {
  relation: ComparisonRelation;
  agreedPoints: string[];
  disagreements: Disagreement[];
  resolvedDisagreements: ResolvedDisagreement[];
  equivalentStatements: EquivalentStatement[];
  undetermined: UndeterminedItem[];
  verificationNeeded: string[];
}

/** 프롬프트의 참여자 A/B가 실제로 어느 모델인지. 서버가 debateId로 계산한다 (P5-8b). */
export interface AbOrder {
  A: ModelId;
  B: ModelId;
}

/** 비교 호출 1회의 결과 (기존 ModelTurn 재사용 → 비용 장부와 호환) */
export type ComparisonTurn = ModelTurn<{ content: ComparisonContent }>;
