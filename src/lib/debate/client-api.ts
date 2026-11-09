// 브라우저 → 우리 서버(/api/*) 호출 도우미. AI 제공사에는 직접 접근하지 않는다.

import type {
  AnalyzeRequestBody,
  AnalyzeResponse,
  DialogueCompareRequestBody,
  DialogueCompareResponse,
  DialogueTurnRequestBody,
  DialogueTurnResponse,
  RoundRequestBody,
  RoundResponse,
} from "@/types/api";

// 서버 쪽 최대 실행 시간(90초)보다 조금 길게 기다린 뒤 포기한다.
const CLIENT_TIMEOUT_MS = 100_000;

/**
 * 모델별 결과(results)를 받지 못한 실패.
 * reason으로 과금 여부를 구분한다 (Phase 5에서 추가, 기존 사용처는 message만 사용하므로 영향 없음):
 * - rejected: 서버가 응답했지만 results가 없음 (입력 검증 400, 순서 409, 크기 413, 설정 503 등).
 *             이 경우 서버는 모델을 호출하기 전에 끝났다. 단, httpStatus가 500 이상이면 확인할 수 없다.
 * - network / timeout / aborted: 응답을 받지 못함 → 서버가 모델을 호출했는지(과금됐는지) 알 수 없다.
 */
export type RequestFailureReason = "rejected" | "network" | "timeout" | "aborted";

export class RequestFailure extends Error {
  readonly reason: RequestFailureReason;
  readonly httpStatus?: number;

  constructor(message: string, reason: RequestFailureReason = "rejected", httpStatus?: number) {
    super(message);
    this.reason = reason;
    this.httpStatus = httpStatus;
  }
}

export function postAnalyze(body: AnalyzeRequestBody, signal: AbortSignal) {
  return postJson<AnalyzeResponse>("/api/analyze", body, signal);
}

export function postRound(body: RoundRequestBody, signal: AbortSignal) {
  return postJson<RoundResponse>("/api/debate/round", body, signal);
}

export function postDialogueTurn(body: DialogueTurnRequestBody, signal: AbortSignal) {
  return postJson<DialogueTurnResponse>("/api/dialogue/turn", body, signal);
}

/** 최종 비교 (P5-8). 200(성공)·502(비교 담당 실패)는 응답으로, 그 밖의 실패는 RequestFailure로 받는다. */
export function postDialogueCompare(body: DialogueCompareRequestBody, signal: AbortSignal) {
  return postJson<DialogueCompareResponse>("/api/dialogue/compare", body, signal);
}

/**
 * 공통 POST 도우미 (분석형·대화형 API 공용).
 * - 100초 시간 제한, 외부 취소 신호(화면 이탈 등) 연결
 * - 200(성공/부분 실패)과 502(요청한 모델 모두 실패)는 모델별 결과(results)를 담은 응답으로 반환
 * - 그 밖의 실패(입력 검증 400, 네트워크, 시간 초과)는 RequestFailure로 던진다
 */
export async function postJson<T extends { results: object }>(
  url: string,
  body: unknown,
  outerSignal: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  outerSignal.addEventListener("abort", onAbort);
  const timeoutId = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data: unknown = await res.json().catch(() => null);
    // 200(성공/부분 실패)과 502(요청한 모델 모두 실패) 모두 모델별 결과를 담고 있다.
    if (isObject(data) && isObject(data.results)) return data as T;
    const message = isObject(data) && isObject(data.error) && typeof data.error.message === "string"
      ? data.error.message
      : `서버 오류가 발생했습니다. (HTTP ${res.status})`;
    throw new RequestFailure(message, "rejected", res.status);
  } catch (err) {
    if (err instanceof RequestFailure) throw err;
    if (err instanceof DOMException && err.name === "AbortError") {
      throw outerSignal.aborted
        ? new RequestFailure("요청이 취소되었습니다.", "aborted")
        : new RequestFailure("응답을 기다리는 시간이 초과되었습니다.", "timeout");
    }
    throw new RequestFailure("서버에 연결하지 못했습니다. 개발 서버가 실행 중인지 확인해 주세요.", "network");
  } finally {
    clearTimeout(timeoutId);
    outerSignal.removeEventListener("abort", onAbort);
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}
