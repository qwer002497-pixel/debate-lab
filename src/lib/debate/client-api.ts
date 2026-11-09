// 브라우저 → 우리 서버(/api/*) 호출 도우미. AI 제공사에는 직접 접근하지 않는다.

import type {
  AnalyzeRequestBody,
  AnalyzeResponse,
  RoundRequestBody,
  RoundResponse,
} from "@/types/api";

// 서버 쪽 최대 실행 시간(90초)보다 조금 길게 기다린 뒤 포기한다.
const CLIENT_TIMEOUT_MS = 100_000;

/** 모델 호출까지 가지 못한 실패(네트워크, 시간 초과, 입력 검증 실패 등) */
export class RequestFailure extends Error {}

export function postAnalyze(body: AnalyzeRequestBody, signal: AbortSignal) {
  return postJson<AnalyzeResponse>("/api/analyze", body, signal);
}

export function postRound(body: RoundRequestBody, signal: AbortSignal) {
  return postJson<RoundResponse>("/api/debate/round", body, signal);
}

async function postJson<T extends { results: object }>(
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
    throw new RequestFailure(message);
  } catch (err) {
    if (err instanceof RequestFailure) throw err;
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new RequestFailure(
        outerSignal.aborted ? "요청이 취소되었습니다." : "응답을 기다리는 시간이 초과되었습니다.",
      );
    }
    throw new RequestFailure("서버에 연결하지 못했습니다. 개발 서버가 실행 중인지 확인해 주세요.");
  } finally {
    clearTimeout(timeoutId);
    outerSignal.removeEventListener("abort", onAbort);
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}
