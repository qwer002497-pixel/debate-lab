// 대화형 토론(Phase 5)의 도메인 타입.
// 분석형(types/debate.ts)과 분리하되, 모델 호출 1회의 공통 틀(ModelTurn)과 기본 요청(DebateRequest)은 재사용한다.
//
// index 규칙 (라운드 N = 모델별 응답 발언 횟수, 전체 발언 수 = 2N + 4):
//   0, 1              opening  (GPT, Claude — 병렬, 서로를 보지 않음)
//   2 … 2N+1          reply    (firstSpeaker부터 번갈아 1명씩)
//   2N+2, 2N+3        closing  (GPT, Claude — 병렬, 서로의 closing을 보지 않음)
// 병렬 단계 안에서의 자리는 MODEL_IDS 순서(gpt → claude)로 고정한다.

import type { DebateRequest, DebateStatus, ModelId, ModelTurn, RoundCount } from "./debate";

export type DialogueTurnKind = "opening" | "reply" | "closing";

/** opening·reply 발언 내용. message가 핵심이고 나머지는 보조 데이터(빈 배열 허용). */
export interface SpeechContent {
  message: string; // 자연스러운 대화체 발언
  acknowledged: string[]; // 상대 주장 중 인정한 점 (없으면 빈 배열)
  openIssues: string[]; // 아직 해결되지 않았다고 보는 쟁점 (없으면 빈 배열)
}

/** closing(마무리) 내용. 합의점과 남은 의견 차이를 서로 다른 필드로 분리한다. */
export interface ClosingContent {
  finalPosition: string; // 최종 입장
  agreedPoints: string[]; // 상대와 합의했다고 보는 점
  remainingDisagreements: string[]; // 끝까지 의견이 다른 쟁점 (agreedPoints와 겹치면 안 됨)
  positionChanges: string[]; // 토론 중 바뀐 자기 입장
  verificationNeeded: string[]; // 외부 자료로 검증이 필요한 사항
}

/** 순서 계산에 필요한 발언 식별 정보 (내용 제외) */
export interface DialogueTurnKey {
  index: number; // 전체 transcript 기준 순번 (0부터)
  kind: DialogueTurnKind;
  speaker: ModelId;
}

/** transcript에 저장되는 "성공한" 발언 1개. 실패한 시도는 transcript에 넣지 않는다. */
export type DialogueTranscriptEntry =
  | (DialogueTurnKey & { kind: "opening" | "reply"; content: SpeechContent })
  | (DialogueTurnKey & { kind: "closing"; content: ClosingContent });

/** 모델 호출 1회의 결과 (성공·실패, 토큰·비용·시간 포함) */
export type SpeechTurn = ModelTurn<{ content: SpeechContent }>;
export type ClosingTurn = ModelTurn<{ content: ClosingContent }>;

/** 순서 규칙의 입력. firstSpeaker는 토론 시작 시 한 번 정해지고 바뀌지 않는다. */
export interface DialogueConfig {
  rounds: RoundCount;
  firstSpeaker: ModelId;
}

/** 일정표의 칸 1개 */
export interface DialogueSlot extends DialogueTurnKey {
  /** 이 칸이 속한 단계의 시작 index = API 요청의 index (opening 0, reply 자기 index, closing 2N+2) */
  step: number;
}

/**
 * 대화형 토론 한 건의 기록. 지금은 브라우저 메모리에만 있고,
 * DB 단계에서 이 구조를 저장 단위로 쓸 수 있도록 화면 상태와 분리해 둔다.
 */
export interface DialogueSession {
  request: DebateRequest;
  firstSpeaker: ModelId;
  transcript: DialogueTranscriptEntry[]; // 성공한 발언만, index 오름차순
  status: DebateStatus;
}
