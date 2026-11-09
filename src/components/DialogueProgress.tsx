// 대화형 토론의 진행 상태·진행률·현재 발언 모델과 제어 버튼(일시정지·재개·재시도·중단).
// 버튼은 세션 상태에 맞을 때만 활성화하고, 진행 중 중단은 한 번 더 확인한다.
// 진행률은 selectProgress(최종 비교 성공 전에는 100%가 되지 않음), 재시도 가능 여부는 selectCanRetry를 쓴다.

import { useState } from "react";
import {
  selectCanRetry,
  selectProgress,
  type DialogueRunStatus,
  type DialogueSessionState,
} from "@/lib/dialogue/session";
import { MODEL_META } from "./ModelPanel";

const STATUS_STYLE: Record<DialogueRunStatus, { label: string; cls: string }> = {
  idle: { label: "대기", cls: "bg-white/10 text-slate-300" },
  running: { label: "진행 중", cls: "bg-indigo-400/20 text-indigo-200" },
  paused: { label: "일시정지", cls: "bg-amber-400/20 text-amber-200" },
  error: { label: "오류로 멈춤", cls: "bg-red-400/20 text-red-200" },
  stopped: { label: "중단됨", cls: "bg-slate-400/20 text-slate-200" },
  completed: { label: "토론 완료", cls: "bg-emerald-400/20 text-emerald-200" },
};

const KIND_LABEL = { opening: "첫 의견", reply: "응답", closing: "마무리" } as const;

export default function DialogueProgress({
  state,
  onPause,
  onResume,
  onRetry,
  onStop,
}: {
  state: DialogueSessionState;
  onPause: () => void;
  onResume: () => void;
  onRetry: () => void;
  onStop: () => void;
}) {
  const [confirmingStop, setConfirmingStop] = useState(false);
  const { status, pendingAction, inFlight, currentStep } = state;
  const style = STATUS_STYLE[status];
  const { done, total, percent } = selectProgress(state);
  const comparison = state.comparison;
  const comparatorName = comparison?.comparator ? MODEL_META[comparison.comparator].name : null;

  const step = inFlight ?? currentStep;
  const speakers = step?.speakers.map((s) => MODEL_META[s].name).join(" · ");
  const comparing = comparison?.status === "loading";
  const current =
    inFlight && step
      ? `${speakers} ${KIND_LABEL[step.kind]} 작성 중 (#${step.index})`
      : comparing
        ? `최종 비교 중${comparatorName ? ` (비교 담당: ${comparatorName})` : ""} · ${comparison.attempts}/${comparison.maxAttempts}회째`
        : status === "error" && step
          ? `${speakers} ${KIND_LABEL[step.kind]}에서 멈춤 (#${step.index})`
          : status === "error" && comparison?.status === "error"
            ? "최종 비교에서 멈춤 (토론 발언과 마무리는 보존됨)"
            : null;

  const canPause = status === "running" && pendingAction === null;
  const canResume = status === "paused";
  const canRetry = selectCanRetry(state);
  const canStop = (status === "running" || status === "paused" || status === "error") && pendingAction !== "stop";

  function handleStop() {
    if (status === "running") {
      setConfirmingStop(true); // 진행 중에는 한 번 더 확인
      return;
    }
    onStop();
  }

  return (
    <section aria-label="대화 진행 상황" className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/5 px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-300" aria-live="polite">
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${style.cls}`} data-status={status}>
            {style.label}
          </span>
          {current && <span>{current}</span>}
          {pendingAction === "pause" && <span className="text-amber-200">· 일시정지 예약됨 ({comparing ? "최종 비교가" : "현재 발언이"} 끝나면 멈춥니다)</span>}
          {pendingAction === "stop" && <span className="text-slate-200">· 중단 예약됨 ({comparing ? "최종 비교가" : "현재 발언이"} 끝나면 멈춥니다)</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          <ControlButton onClick={onPause} disabled={!canPause}>일시정지</ControlButton>
          <ControlButton onClick={onResume} disabled={!canResume} primary>재개</ControlButton>
          <ControlButton onClick={onRetry} disabled={!canRetry} primary>실패한 단계 재시도</ControlButton>
          <ControlButton onClick={handleStop} disabled={!canStop || confirmingStop}>토론 중단</ControlButton>
        </div>
      </div>

      {confirmingStop && (
        <div role="alertdialog" aria-label="중단 확인" className="flex flex-wrap items-center gap-3 rounded-xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-100">
          <span>진행 중인 토론을 중단할까요? 현재 발언이 끝난 뒤 멈추며, 이후 다시 이어서 진행할 수 없습니다.</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setConfirmingStop(false);
                onStop();
              }}
              className="rounded-lg bg-red-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-400"
            >
              중단 확정
            </button>
            <button
              type="button"
              onClick={() => setConfirmingStop(false)}
              className="rounded-lg border border-white/20 px-3 py-1.5 text-sm text-slate-200 hover:bg-white/10"
            >
              취소
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <div className="flex justify-between text-xs text-slate-400">
          <span>진행률</span>
          <span>
            모델 호출 {done} / {total} ({percent}%){comparison && comparison.status !== "success" && done === total - 1 ? " · 최종 비교 남음" : ""}
          </span>
        </div>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={done}
          className="h-2 overflow-hidden rounded-full bg-white/10"
        >
          <div className="h-full rounded-full bg-sky-400 transition-[width]" style={{ width: `${percent}%` }} />
        </div>
      </div>

      {state.notice && (
        <p
          role="status"
          className={`rounded-xl px-4 py-3 text-sm leading-6 ${
            status === "error"
              ? "border border-red-400/40 bg-red-500/10 text-red-100"
              : status === "paused"
                ? "border border-amber-400/40 bg-amber-400/10 text-amber-100"
                : "border border-white/15 bg-white/5 text-slate-200"
          }`}
        >
          {state.notice}
        </p>
      )}
    </section>
  );
}

function ControlButton({
  children,
  onClick,
  disabled,
  primary,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled: boolean;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg px-3 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        primary
          ? "bg-indigo-500 font-semibold text-white enabled:hover:bg-indigo-400"
          : "border border-white/20 text-slate-200 enabled:hover:bg-white/10"
      }`}
    >
      {children}
    </button>
  );
}
