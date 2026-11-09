import "server-only";

// 같은 내용의 요청이 동시에 두 번 들어오면(더블 클릭, 네트워크 재전송 등)
// AI를 두 번 호출하지 않고 첫 번째 호출의 결과를 함께 돌려준다 → 중복 과금 방지.
//
// 한계: 서버 프로세스 메모리에 보관하므로 같은 서버 인스턴스 안에서만 동작한다.
// 서버리스 환경에서 여러 인스턴스로 나뉘면 막지 못한다. (DB 단계에서 요청 ID로 보완 예정)

import { createHash } from "node:crypto";

const inFlight = new Map<string, Promise<unknown>>();

export function dedupeKey(scope: string, payload: unknown): string {
  return scope + ":" + createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export async function dedupe<T>(key: string, run: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key);
  if (existing) {
    console.info(`[dedupe] joined in-flight request ${key.slice(0, 24)}…`);
    return existing as Promise<T>;
  }
  const promise = run().finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}
