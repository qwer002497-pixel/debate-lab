import "server-only";

// 대화형 토론의 첫 발언 모델(firstSpeaker) 결정.
//
// 현재(DB 없음): HMAC-SHA256(서버 비밀키, debateId)로 결정적으로 계산한다.
//  - 같은 debateId → 항상 같은 결과 (응답 유실·재시도에도 바뀌지 않음)
//  - 비밀키가 없으면 클라이언트가 결과를 미리 계산할 수 없음
//  - 서버는 모든 요청에서 다시 계산하며, 클라이언트가 보낸 값을 신뢰하지 않는다
//
// DB 연동 후: debates.first_speaker를 서버가 저장·조회하는 구현으로 교체한다.
// 라우트는 FirstSpeakerResolver 인터페이스에만 의존하므로 이 파일의 구현만 바꾸면 된다.

import { createHmac } from "node:crypto";
import type { ModelId } from "@/types/debate";

export type FirstSpeakerResult =
  | { ok: true; firstSpeaker: ModelId }
  | { ok: false; reason: "missing_secret" };

export interface FirstSpeakerResolver {
  resolve(debateId: string): FirstSpeakerResult;
}

export const FIRST_SPEAKER_SECRET_ENV = "DIALOGUE_SEED_SECRET";
/** 짧은 비밀키는 추측 가능하므로 최소 길이를 둔다 (32자 이상 무작위 문자열 권장) */
export const MIN_SECRET_LENGTH = 32;

// 계산 방식이 바뀌면 같은 debateId라도 결과가 달라지므로 버전을 입력에 포함한다.
const DERIVATION_LABEL = "ai-debate-lab:dialogue:first-speaker:v1:";

/** 비밀키 값과 debateId(정규화된 소문자 UUID)로 첫 발언 모델을 계산한다 (테스트용으로 분리). */
export function deriveFirstSpeaker(secret: string, debateId: string): ModelId {
  const digest = createHmac("sha256", secret).update(DERIVATION_LABEL + debateId.toLowerCase()).digest();
  return (digest[0] & 1) === 0 ? "gpt" : "claude";
}

/** 현재 구현: 환경변수의 비밀키로 HMAC 계산. 비밀키 값은 로그·응답에 절대 남기지 않는다. */
export const hmacFirstSpeakerResolver: FirstSpeakerResolver = {
  resolve(debateId) {
    const secret = process.env[FIRST_SPEAKER_SECRET_ENV]?.trim();
    if (!secret || secret.length < MIN_SECRET_LENGTH) return { ok: false, reason: "missing_secret" };
    return { ok: true, firstSpeaker: deriveFirstSpeaker(secret, debateId) };
  },
};
