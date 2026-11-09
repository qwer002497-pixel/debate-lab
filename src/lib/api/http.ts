import "server-only";

// Route Handler 공통: 요청 본문 크기 제한 + JSON 파싱 + 안전한 오류 응답.

import type { ApiRequestError } from "@/types/api";

export function requestError(
  status: number,
  code: ApiRequestError["error"]["code"],
  message: string,
): Response {
  const payload: ApiRequestError = { error: { code, message } };
  return Response.json(payload, { status });
}

/**
 * 본문을 maxBytes까지만 읽어 JSON으로 파싱한다.
 * content-length 헤더는 생략(chunked 전송)·위조될 수 있으므로, 스트림으로 읽으면서
 * 실제 바이트 수가 한도를 넘는 즉시 중단한다 (전체를 메모리에 올리지 않음).
 */
export async function readJsonBody(
  request: Request,
  maxBytes: number,
): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
  const tooLarge = () => ({
    ok: false as const,
    response: requestError(413, "payload_too_large", "요청 크기가 너무 큽니다."),
  });

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > maxBytes) return tooLarge();

  let text: string;
  try {
    const chunks: Uint8Array[] = [];
    let received = 0;
    const reader = request.body?.getReader();
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > maxBytes) {
          await reader.cancel();
          return tooLarge();
        }
        chunks.push(value);
      }
    }
    const buffer = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      buffer.set(chunk, offset);
      offset += chunk.byteLength;
    }
    text = new TextDecoder().decode(buffer);
  } catch {
    return { ok: false, response: requestError(400, "invalid_json", "요청 본문을 읽지 못했습니다.") };
  }

  try {
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: false, response: requestError(400, "invalid_json", "요청 본문이 올바른 JSON이 아닙니다.") };
  }
}
