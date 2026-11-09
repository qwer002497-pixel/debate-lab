import "server-only";

// 두 AI 제공사의 서로 다른 오류를 하나의 안전한 형식(AiError)으로 통일한다.
// 브라우저에는 code와 미리 정해 둔 한국어 메시지만 보내고,
// SDK 원본 메시지(키 일부가 포함될 수 있음)나 스택 트레이스는 보내지 않는다.

import type { AnalysisErrorCode } from "@/types/debate";

const MESSAGES: Record<AnalysisErrorCode, string> = {
  missing_api_key: "서버에 API 키가 설정되지 않았습니다.",
  auth_failed: "API 키 인증에 실패했습니다. 키가 올바른지, 사용 권한이 있는지 확인해 주세요.",
  rate_limited: "API 호출 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.",
  timeout: "AI 응답 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.",
  network_error: "AI 서버에 연결하지 못했습니다. 네트워크 상태를 확인해 주세요.",
  invalid_request: "AI 서버가 요청을 거부했습니다. 모델 ID나 요청 설정을 확인해야 합니다.",
  provider_error: "AI 제공사 서버에 일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
  refused: "모델이 이 주제에 대한 응답을 거부했습니다.",
  empty_response: "AI가 빈 응답을 반환했습니다. 다시 시도해 주세요.",
  unknown: "알 수 없는 오류가 발생했습니다.",
};

export class AiError extends Error {
  readonly code: AnalysisErrorCode;
  /** 서버 로그용 HTTP 상태 (응답에는 포함하지 않음) */
  readonly httpStatus?: number;

  constructor(code: AnalysisErrorCode, options?: { message?: string; httpStatus?: number }) {
    super(options?.message ?? MESSAGES[code]);
    this.name = "AiError";
    this.code = code;
    this.httpStatus = options?.httpStatus;
  }
}

/** HTTP 상태 코드를 안전한 오류 코드로 변환 */
export function aiErrorFromStatus(status: number | undefined): AiError {
  let code: AnalysisErrorCode = "unknown";
  if (status === 401 || status === 403) code = "auth_failed";
  else if (status === 429) code = "rate_limited";
  else if (status === 408) code = "timeout";
  else if (status === 400 || status === 404 || status === 422) code = "invalid_request";
  else if (status !== undefined && status >= 500) code = "provider_error";
  return new AiError(code, { httpStatus: status });
}

/** 환경변수에서 API 키를 읽는다. 없으면 어떤 변수를 설정해야 하는지만 알려준다(값은 절대 노출하지 않음). */
export function readApiKey(envName: string): string {
  const key = process.env[envName]?.trim();
  if (!key) {
    throw new AiError("missing_api_key", {
      message: `서버에 ${envName}가 설정되지 않았습니다. .env.local 파일에 키를 추가한 뒤 개발 서버를 다시 시작해 주세요.`,
    });
  }
  return key;
}
