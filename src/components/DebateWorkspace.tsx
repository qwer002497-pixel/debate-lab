"use client";

// 화면에서 "상태"를 가진 유일한 컴포넌트.
// - 입력값과 검증은 여기서 공통으로 처리한다.
// - 분석형(useDebateSession)과 대화형(useDialogueSession) 세션을 "둘 다" 여기서 유지한다.
//   모드를 바꾸면 보이는 화면만 바뀌고, 다른 모드의 진행 상황·비용 기록은 사라지지 않는다.
// - 진행 중에는 모드 변경을 막고, 멈춘(일시정지·오류) 대화를 새 대화로 덮어쓰기 전에는 한 번 확인한다.
// 브라우저는 우리 서버(/api/*)만 호출하며, AI 제공사 API와 키에는 직접 접근하지 않는다.

import { useState } from "react";
import type { DebatePurpose, DebateRequest, RoundCount } from "@/types/debate";
import { DEFAULT_ROUNDS, validateTopic } from "@/lib/debate/config";
import { useDebateSession } from "@/lib/debate/useDebateSession";
import { useDialogueSession } from "@/lib/dialogue/useDialogueSession";
import AnalysisDebateView from "./AnalysisDebateView";
import DebateForm from "./DebateForm";
import DialogueDebateView from "./DialogueDebateView";
import ModeSelector, { type DebateMode } from "./ModeSelector";

export default function DebateWorkspace() {
  const [mode, setMode] = useState<DebateMode>("analysis");
  const [topic, setTopic] = useState("");
  const [purpose, setPurpose] = useState<DebatePurpose>("idea_validation");
  const [rounds, setRounds] = useState<RoundCount>(DEFAULT_ROUNDS);
  const [topicError, setTopicError] = useState<string | null>(null);
  const [pendingReplace, setPendingReplace] = useState<DebateRequest | null>(null);
  const { view, start, retry, stop } = useDebateSession();
  const dialogue = useDialogueSession();

  const analysisRunning = view.status === "running";
  const dialogueRunning = dialogue.state.status === "running";
  const isRunning = mode === "analysis" ? analysisRunning : dialogueRunning;

  function handleTopicChange(value: string) {
    setTopic(value);
    if (topicError) setTopicError(validateTopic(value));
  }

  function handleSubmit() {
    if (isRunning) return; // 중복 제출 방지 (훅 내부에서도 한 번 더 막는다)
    const error = validateTopic(topic);
    setTopicError(error);
    if (error) return;
    const request: DebateRequest = { topic: topic.trim(), purpose, rounds };
    if (mode === "analysis") {
      start(request);
      return;
    }
    // 멈춘 대화가 남아 있으면 덮어쓰기 전에 확인한다.
    const s = dialogue.state.status;
    if (s === "paused" || s === "error") {
      setPendingReplace(request);
      return;
    }
    dialogue.start(request);
  }

  return (
    <div className="flex flex-col gap-6">
      <ModeSelector
        mode={mode}
        disabled={analysisRunning || dialogueRunning}
        onChange={(m) => {
          setMode(m);
          setPendingReplace(null);
        }}
      />
      <DebateForm
        mode={mode}
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
      {pendingReplace && (
        <div role="alertdialog" aria-label="새 대화 시작 확인" className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
          <span>멈춘 대화가 있습니다. 새로 시작하면 이전 대화 기록과 비용 표시가 화면에서 사라집니다. 새로 시작할까요?</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                const request = pendingReplace;
                setPendingReplace(null);
                dialogue.start(request);
              }}
              className="rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-semibold text-slate-900 hover:bg-amber-400"
            >
              새로 시작
            </button>
            <button
              type="button"
              onClick={() => setPendingReplace(null)}
              className="rounded-lg border border-white/20 px-3 py-1.5 text-sm text-slate-200 hover:bg-white/10"
            >
              취소
            </button>
          </div>
        </div>
      )}
      {mode === "analysis" ? (
        <AnalysisDebateView view={view} onStop={stop} onRetry={retry} />
      ) : (
        <DialogueDebateView session={dialogue} />
      )}
    </div>
  );
}
