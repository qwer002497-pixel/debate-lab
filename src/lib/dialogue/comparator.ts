import "server-only";

// 최종 비교(P5-8)의 비교 담당 모델(comparator)과 참여자 A/B 순서 결정.
//
// 현재(DB 없음): firstSpeaker와 같은 서버 비밀키(DIALOGUE_SEED_SECRET)로 HMAC-SHA256을 계산하되,
// 결정마다 서로 다른 domain 문자열을 입력 앞에 붙인다 (domain separation).
//  - 비밀키가 안전하고 HMAC이 의사난수 함수처럼 동작한다는 가정 아래, domain이 다른 출력은
//    서로 실질적으로 상관없는 값으로 취급한다. 수학적으로 완전히 독립이라고 주장하지는 않는다.
//  - 같은 비밀키 + 같은 debateId → 항상 같은 결과 (재시도해도 담당 모델·A/B 순서가 바뀌지 않음)
//  - 클라이언트는 비밀키가 없으므로 결과를 미리 계산하거나 지정할 수 없다.
//
// 비교 담당은 토론 참여 모델 중 하나다. 토론마다 바꾸고 A/B로 익명화해 편향을 "완화"할 뿐,
// 중립적인 제3자가 아니며 중립성을 보장하지 않는다.
//
// DB 연동 후: debates.comparator, debates.ab_order를 저장·조회하는 구현으로 교체한다
// (라우트는 ComparisonRoleResolver 인터페이스에만 의존한다).

import { createHmac } from "node:crypto";
import type { AbOrder } from "@/types/comparison";
import type { ModelId } from "@/types/debate";
import { FIRST_SPEAKER_SECRET_ENV, MIN_SECRET_LENGTH } from "./first-speaker";

/** 결정별 domain 문자열. firstSpeaker는 "ai-debate-lab:dialogue:first-speaker:v1:" (first-speaker.ts) */
export const COMPARATOR_DOMAIN = "ai-debate-lab:dialogue:comparator:v1:";
export const AB_ORDER_DOMAIN = "ai-debate-lab:dialogue:ab-order:v1:";

export interface ComparisonRoles {
  comparator: ModelId;
  abOrder: AbOrder;
}

export type ComparisonRolesResult = ({ ok: true } & ComparisonRoles) | { ok: false; reason: "missing_secret" };

export interface ComparisonRoleResolver {
  resolve(debateId: string): ComparisonRolesResult;
}

function firstBit(secret: string, domain: string, debateId: string): 0 | 1 {
  const digest = createHmac("sha256", secret).update(domain + debateId.toLowerCase()).digest();
  return (digest[0] & 1) as 0 | 1;
}

/** 비교 담당 모델 (테스트용으로 분리) */
export function deriveComparator(secret: string, debateId: string): ModelId {
  return firstBit(secret, COMPARATOR_DOMAIN, debateId) === 0 ? "gpt" : "claude";
}

/** 프롬프트의 참여자 A가 어느 모델인지 (B는 나머지). comparator와 다른 domain으로 계산한다. */
export function deriveAbOrder(secret: string, debateId: string): AbOrder {
  return firstBit(secret, AB_ORDER_DOMAIN, debateId) === 0 ? { A: "gpt", B: "claude" } : { A: "claude", B: "gpt" };
}

/** 현재 구현: 환경변수의 비밀키로 HMAC 계산. 비밀키 값은 로그·응답에 절대 남기지 않는다. */
export const hmacComparisonRoleResolver: ComparisonRoleResolver = {
  resolve(debateId) {
    const secret = process.env[FIRST_SPEAKER_SECRET_ENV]?.trim();
    if (!secret || secret.length < MIN_SECRET_LENGTH) return { ok: false, reason: "missing_secret" };
    return { ok: true, comparator: deriveComparator(secret, debateId), abOrder: deriveAbOrder(secret, debateId) };
  },
};
