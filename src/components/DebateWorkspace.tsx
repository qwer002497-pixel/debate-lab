"use client";

// 화면에서 "상태"를 가진 유일한 컴포넌트.
// 입력값, 검증 오류, 두 결과 패널의 상태를 관리하고 서버 API(/api/analyze)를 호출한다.
// 브라우저는 우리 서버만 호출하며, AI 제공사 API와 키에는 직접 접근하지 않는다.

import { useEffect, useRef, useState } from "react";
import type {
  AnalyzeResponse,
  DebatePurpose,
  DebateRequest,
  ModelAnalysis,
  ModelId,
  PanelState,
  RoundCount,
} from "@/types/debate";
import {
  DEFAULT_ROUNDS,
  getPurposeLabel,
  validateTopic,
} from "@/lib/debate/config";
import DebateForm from "./DebateForm";
import ResultPanel from "./ResultPanel";

const IDLE: PanelState = { status: "idle" };
const LOADING: PanelState = { status: "loading" };

// 서버 쪽 최대 실행 시간(90초)보다 조금 길게 기다린 뒤 포기한다.
const CLIENT_TIMEOUT_MS = 100_000;

export default function DebateWorkspace() {
  const [topic, setTopic] = useState("");
  const [purpose, setPurpose] = useState<DebatePurpose>("idea_validation");
  const [rounds, setRounds] = useState<RoundCount>(DEFAULT_ROUNDS);
  const [topicError, setTopicError] = useState<string | null>(null);
  const [lastRequest, setLastRequest] = useState<DebateRequest | null>(null);
  const [panels, setPanels] = useState<Record<ModelId, PanelState>>({
    gpt: IDLE,
    claude: IDLE,
  });
  const [globalError, setGlobalError] = useState<string | null>(null);

  // 상태 업데이트는 다음 렌더링에 반영되므로, 빠른 연속 클릭을 막기 위해 ref로도 잠근다.
  const inFlightRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  // 화면을 떠나면 진행 중인 요청을 취소한다.
  useEffect(() => () => abortRef.current?.abort(), []);

  const isSubmitting =
    panels.gpt.status === "loading" || panels.claude.status === "loading";

  function handleTopicChange(value: string) {
    setTopic(value);
    if (topicError) setTopicError(validateTopic(value));
  }

  async function handleSubmit() {
    if (inFlightRef.current) return; // 중복 제출 방지

    const error = validateTopic(topic);
    setTopicError(error);
    if (error) return;

    const request: DebateRequest = { topic: topic.trim(), purpose, rounds };
    inFlightRef.current = true;
    setLastRequest(request);
    setGlobalError(null);
    setPanels({ gpt: LOADING, claude: LOADING });

    const controller = new AbortController();
    abortRef.current = controller;
    const timeoutId = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
      const data: unknown = await res.json().catch(() => null);

      if (isAnalyzeResponse(data)) {
        setPanels({
          gpt: toPanelState(data.results.gpt),
          claude: toPanelState(data.results.claude),
        });
        if (data.allFailed) {
          setGlobalError(
            "두 AI 모두 분석에 실패했습니다. 각 패널의 오류 내용을 확인한 뒤 '분석 시작'을 다시 눌러 주세요.",
          );
        }
      } else {
        // 입력 검증 실패(400) 등 모델 호출 전에 끝난 경우
        const message =
          getErrorMessage(data) ?? `서버 오류가 발생했습니다. (HTTP ${res.status})`;
        failBoth(message);
      }
    } catch (err) {
      const aborted = err instanceof DOMException && err.name === "AbortError";
      failBoth(
        aborted
          ? "응답을 기다리는 시간이 초과되었습니다. 다시 시도해 주세요."
          : "서버에 연결하지 못했습니다. 개발 서버가 실행 중인지 확인해 주세요.",
      );
    } finally {
      clearTimeout(timeoutId);
      inFlightRef.current = false;
      abortRef.current = null;
    }
  }

  function failBoth(message: string) {
    setPanels({
      gpt: { status: "error", message },
      claude: { status: "error", message },
    });
    setGlobalError(`${message} 입력 내용은 유지되어 있으니 다시 시도할 수 있습니다.`);
  }

  return (
    <div className="flex flex-col gap-6">
      <DebateForm
        topic={topic}
        purpose={purpose}
        rounds={rounds}
        topicError={topicError}
        isSubmitting={isSubmitting}
        onTopicChange={handleTopicChange}
        onPurposeChange={setPurpose}
        onRoundsChange={setRounds}
        onSubmit={handleSubmit}
      />

      {globalError && (
        <div
          role="alert"
          className="rounded-xl border border-red-400/40 bg-red-500/10 px-5 py-4 text-sm leading-6 text-red-100"
        >
          {globalError}
        </div>
      )}

      {lastRequest && (
        <section
          aria-label="요청 내용"
          className="rounded-xl border border-white/10 bg-white/5 px-5 py-4 text-sm text-slate-300"
        >
          <p className="mb-2 font-semibold text-white">요청 내용</p>
          <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[auto_1fr]">
            <dt className="text-slate-400">목적</dt>
            <dd>{getPurposeLabel(lastRequest.purpose)}</dd>
            <dt className="text-slate-400">라운드</dt>
            <dd>{lastRequest.rounds}회 (상호 검토는 다음 단계에서 적용)</dd>
            <dt className="text-slate-400">주제</dt>
            <dd className="whitespace-pre-wrap break-words">
              {lastRequest.topic}
            </dd>
          </dl>
        </section>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <ResultPanel model="gpt" state={panels.gpt} />
        <ResultPanel model="claude" state={panels.claude} />
      </div>
    </div>
  );
}

/** 서버의 모델별 결과를 패널 상태로 변환한다. 키 미설정은 "미연결"로 구분해 보여준다. */
function toPanelState(result: ModelAnalysis): PanelState {
  if (result.status === "success") {
    return {
      status: "success",
      model: result.model,
      text: result.text,
      usage: result.usage,
      truncated: result.truncated,
      durationMs: result.durationMs,
    };
  }
  if (result.error.code === "missing_api_key") {
    return { status: "not_connected", message: result.error.message };
  }
  return { status: "error", message: result.error.message };
}

function isAnalyzeResponse(data: unknown): data is AnalyzeResponse {
  if (typeof data !== "object" || data === null || !("results" in data)) return false;
  const results = (data as { results: unknown }).results;
  return typeof results === "object" && results !== null && "gpt" in results && "claude" in results;
}

function getErrorMessage(data: unknown): string | null {
  if (typeof data !== "object" || data === null || !("error" in data)) return null;
  const error = (data as { error: unknown }).error;
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message: unknown }).message;
    return typeof message === "string" ? message : null;
  }
  return null;
}
