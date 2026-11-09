// 토론 진행 단계(최초 분석 → 1R → … → NR)와 현재 상태, 중단·재시도 버튼.

import { stageLabel, type DebateView } from "@/lib/debate/useDebateSession";
import { stageStatus, STAGE_STATUS_STYLE } from "./stage-status";

const STATUS_TEXT: Record<DebateView["status"], string> = {
  idle: "대기",
  running: "진행 중",
  paused: "일시정지",
  completed: "토론 완료",
  stopped: "중단됨",
};

export default function DebateProgress({
  view,
  onStop,
  onRetry,
}: {
  view: DebateView;
  onStop: () => void;
  onRetry: () => void;
}) {
  const steps = [
    { key: "initial", label: "최초 분석", status: stageStatus(view.initial) },
    ...view.rounds.map((r) => ({ key: `r${r.round}`, label: `${r.round}R`, status: stageStatus(r.turns) })),
  ];
  const current =
    view.status === "running" && view.stage
      ? `${stageLabel(view.stage)} 진행 중${view.stopRequested ? " · 이 단계가 끝나면 중단합니다" : ""}`
      : STATUS_TEXT[view.status];

  return (
    <section
      aria-label="토론 진행 상황"
      className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/5 px-5 py-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-300" aria-live="polite">
          <span className="font-semibold text-white">진행 상태</span> · {current}
        </p>
        <div className="flex flex-wrap gap-2">
          {view.status === "running" && (
            <button
              type="button"
              onClick={onStop}
              disabled={view.stopRequested}
              className="rounded-lg border border-white/20 px-3 py-1.5 text-sm text-slate-200 hover:bg-white/10 disabled:opacity-50"
            >
              {view.stopRequested ? "중단 예약됨" : "이 단계 후 중단"}
            </button>
          )}
          {view.status === "paused" && (
            <>
              <button
                type="button"
                onClick={onRetry}
                className="rounded-lg bg-indigo-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-400"
              >
                실패한 모델 재시도
              </button>
              <button
                type="button"
                onClick={onStop}
                className="rounded-lg border border-white/20 px-3 py-1.5 text-sm text-slate-200 hover:bg-white/10"
              >
                토론 중단
              </button>
            </>
          )}
        </div>
      </div>

      <ol className="flex flex-wrap items-center gap-2">
        {steps.map((step, i) => {
          const style = STAGE_STATUS_STYLE[step.status];
          return (
            <li key={step.key} className="flex items-center gap-2">
              <span
                className={`rounded-lg px-2.5 py-1 text-xs font-medium ${style.className}`}
                title={style.label}
              >
                {step.label} · {style.label}
              </span>
              {i < steps.length - 1 && (
                <span aria-hidden className="text-slate-600">
                  →
                </span>
              )}
            </li>
          );
        })}
      </ol>

      {view.notice && (
        <p
          role="alert"
          className={`rounded-xl px-4 py-3 text-sm leading-6 ${
            view.status === "paused"
              ? "border border-amber-400/40 bg-amber-400/10 text-amber-100"
              : "border border-white/15 bg-white/5 text-slate-200"
          }`}
        >
          {view.notice}
        </p>
      )}
    </section>
  );
}
