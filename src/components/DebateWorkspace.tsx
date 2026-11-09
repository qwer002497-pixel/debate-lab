"use client";

// 화면에서 "상태"를 가진 유일한 컴포넌트.
// 입력값과 검증은 여기서, 토론 진행(최초 분석 → 라운드 반복)은 useDebateSession 훅이 관리한다.
// 브라우저는 우리 서버(/api/*)만 호출하며, AI 제공사 API와 키에는 직접 접근하지 않는다.

import { useState } from "react";
import type { DebatePurpose, ModelAnalysis, PanelState, RoundCount } from "@/types/debate";
import { DEFAULT_ROUNDS, getPurposeLabel, MODEL_IDS, validateTopic } from "@/lib/debate/config";
import { useDebateSession, type Slot } from "@/lib/debate/useDebateSession";
import DebateForm from "./DebateForm";
import DebateProgress from "./DebateProgress";
import DebateStats from "./DebateStats";
import DebateConclusion from "./DebateConclusion";
import ResultPanel from "./ResultPanel";
import RoundSection from "./RoundSection";

export default function DebateWorkspace() {
  const [topic, setTopic] = useState("");
  const [purpose, setPurpose] = useState<DebatePurpose>("idea_validation");
  const [rounds, setRounds] = useState<RoundCount>(DEFAULT_ROUNDS);
  const [topicError, setTopicError] = useState<string | null>(null);
  const { view, start, retry, stop } = useDebateSession();

  const isRunning = view.status === "running";
  const request = view.request;

  function handleTopicChange(value: string) {
    setTopic(value);
    if (topicError) setTopicError(validateTopic(value));
  }

  function handleSubmit() {
    if (isRunning) return; // 중복 제출 방지 (훅 내부에서도 한 번 더 막는다)
    const error = validateTopic(topic);
    setTopicError(error);
    if (error) return;
    start({ topic: topic.trim(), purpose, rounds });
  }

  // 가장 최근에 시작된(대기 아닌) 라운드를 펼쳐 둔다.
  const latestActiveRound = [...view.rounds]
    .reverse()
    .find((r) => MODEL_IDS.some((id) => r.turns[id].status !== "idle"))?.round;

  return (
    <div className="flex flex-col gap-6">
      <DebateForm
        topic={topic}
        purpose={purpose}
        rounds={rounds}
        topicError={topicError}
        isSubmitting={isRunning}
        onTopicChange={handleTopicChange}
        onPurposeChange={setPurpose}
        onRoundsChange={setRounds}
        onSubmit={handleSubmit}
      />

      {request && (
        <>
          <section
            aria-label="요청 내용"
            className="rounded-xl border border-white/10 bg-white/5 px-5 py-4 text-sm text-slate-300"
          >
            <p className="mb-2 font-semibold text-white">요청 내용</p>
            <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[auto_1fr]">
              <dt className="text-slate-400">목적</dt>
              <dd>{getPurposeLabel(request.purpose)}</dd>
              <dt className="text-slate-400">라운드</dt>
              <dd>{request.rounds}회 (최초 분석 제외)</dd>
              <dt className="text-slate-400">주제</dt>
              <dd className="whitespace-pre-wrap break-words">{request.topic}</dd>
            </dl>
          </section>
          <DebateProgress view={view} onStop={stop} onRetry={retry} />
          <DebateStats view={view} />
        </>
      )}

      <section aria-labelledby="initial-heading" className="flex flex-col gap-3">
        <h2 id="initial-heading" className="text-base font-semibold text-white">
          최초 독립 분석 <span className="text-sm font-normal text-slate-400">· 서로의 답변을 보지 않고 작성</span>
        </h2>
        <div className="grid gap-6 md:grid-cols-2">
          {MODEL_IDS.map((id) => (
            <ResultPanel key={id} model={id} state={toPanelState(view.initial[id])} />
          ))}
        </div>
      </section>

      {view.rounds.length > 0 && (
        <section aria-labelledby="rounds-heading" className="flex flex-col gap-3">
          <h2 id="rounds-heading" className="text-base font-semibold text-white">
            상호 검토 라운드{" "}
            <span className="text-sm font-normal text-slate-400">
              · 각 라운드에서 두 모델은 상대의 직전 응답만 보고 동시에 작성
            </span>
          </h2>
          {view.rounds.map((r) => (
            <RoundSection
              key={r.round}
              view={r}
              totalRounds={view.rounds.length}
              defaultOpen={r.round === latestActiveRound}
            />
          ))}
        </section>
      )}

      <DebateConclusion view={view} />
    </div>
  );
}

/** 최초 분석 칸 상태를 기존 결과 패널 상태로 변환한다. 키 미설정은 "미연결"로 구분해 보여준다. */
function toPanelState(slot: Slot<ModelAnalysis>): PanelState {
  if (slot.status !== "done") return { status: slot.status };
  const result = slot.turn;
  if (result.status === "success") {
    return {
      status: "success",
      model: result.model,
      text: result.text,
      usage: result.usage,
      estimatedCostUsd: result.estimatedCostUsd,
      truncated: result.truncated,
      durationMs: result.durationMs,
    };
  }
  if (result.error.code === "missing_api_key") {
    return { status: "not_connected", message: result.error.message };
  }
  return { status: "error", message: result.error.message };
}
