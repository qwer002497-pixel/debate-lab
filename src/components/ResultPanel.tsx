// AI 한 개의 결과 패널. GPT와 Claude가 같은 컴포넌트를 쓰고 model prop으로만 구분한다.
// 상태(대기/로딩/미연결/오류/성공)마다 다른 화면을 보여준다.

import type { ModelId, PanelState } from "@/types/debate";

const MODEL_META: Record<
  ModelId,
  { name: string; provider: string; avatarClass: string }
> = {
  gpt: { name: "GPT", provider: "OpenAI", avatarClass: "bg-emerald-600" },
  claude: { name: "Claude", provider: "Anthropic", avatarClass: "bg-orange-600" },
};

const STATUS_BADGE: Record<
  PanelState["status"],
  { label: string; className: string }
> = {
  idle: { label: "대기 중", className: "bg-slate-100 text-slate-600" },
  loading: { label: "분석 중", className: "bg-indigo-100 text-indigo-700" },
  not_connected: { label: "API 미연결", className: "bg-amber-100 text-amber-800" },
  error: { label: "오류", className: "bg-red-100 text-red-700" },
  success: { label: "분석 완료", className: "bg-emerald-100 text-emerald-800" },
};

interface ResultPanelProps {
  model: ModelId;
  state: PanelState;
}

export default function ResultPanel({ model, state }: ResultPanelProps) {
  const meta = MODEL_META[model];
  const badge = STATUS_BADGE[state.status];

  return (
    <section
      aria-labelledby={`${model}-title`}
      className="flex min-h-72 flex-col rounded-2xl bg-white text-slate-900 shadow-xl shadow-black/20"
    >
      <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className={`flex size-9 items-center justify-center rounded-lg text-sm font-bold text-white ${meta.avatarClass}`}
          >
            {meta.name[0]}
          </span>
          <div>
            <h2 id={`${model}-title`} className="font-semibold leading-5">
              {meta.name}
            </h2>
            <p className="text-xs text-slate-500">{meta.provider} · 독립 분석</p>
            {state.status === "success" && (
              <p className="font-mono text-xs whitespace-nowrap text-slate-400">
                {state.model}
              </p>
            )}
          </div>
        </div>
        <span
          className={`flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap ${badge.className}`}
        >
          {state.status === "loading" && (
            <span
              aria-hidden
              className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent"
            />
          )}
          {badge.label}
        </span>
      </header>

      {/* aria-live: 상태가 바뀌면 스크린리더가 새 내용을 읽어준다 */}
      <div aria-live="polite" className="flex flex-1 flex-col p-5">
        <PanelBody name={meta.name} state={state} />
      </div>
    </section>
  );
}

function PanelBody({ name, state }: { name: string; state: PanelState }) {
  switch (state.status) {
    case "idle":
      return (
        <div className="m-auto max-w-xs text-center text-sm leading-6 text-slate-500">
          주제를 입력하고 분석을 시작하면 이곳에 {name}의 독립 분석이
          표시됩니다.
        </div>
      );
    case "loading":
      // 내용이 들어올 자리를 회색 막대로 보여준다(스켈레톤). 실제 텍스트는 아니다.
      return (
        <div className="flex flex-col gap-3" aria-label={`${name} 분석 중`}>
          <p className="text-sm text-slate-500">{name}가 분석하고 있습니다…</p>
          {["w-full", "w-11/12", "w-4/5", "w-full", "w-2/3"].map((w, i) => (
            <div
              key={i}
              className={`h-3 animate-pulse rounded bg-slate-200 ${w}`}
            />
          ))}
        </div>
      );
    case "not_connected":
      return (
        <div className="m-auto flex max-w-sm flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
          <p className="font-semibold">분석이 실행되지 않았습니다</p>
          <p>{state.message}</p>
        </div>
      );
    case "error":
      return (
        <div
          role="alert"
          className="m-auto flex max-w-sm flex-col gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-900"
        >
          <p className="font-semibold">분석 중 오류가 발생했습니다</p>
          <p>{state.message}</p>
        </div>
      );
    case "success":
      return (
        <div className="flex flex-col gap-4">
          {state.truncated && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
              출력 토큰 상한에 도달해 답변 끝부분이 잘렸을 수 있습니다.
            </p>
          )}
          {/* 모델 응답은 일반 텍스트로만 렌더링한다(HTML로 해석하지 않음). */}
          <div className="whitespace-pre-wrap text-[15px] leading-7 text-slate-800">
            {state.text}
          </div>
          <dl className="mt-auto flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-100 pt-3 font-mono text-xs text-slate-500">
            <div className="flex gap-1">
              <dt>입력</dt>
              <dd>{state.usage.inputTokens.toLocaleString()} 토큰</dd>
            </div>
            <div className="flex gap-1">
              <dt>출력</dt>
              <dd>{state.usage.outputTokens.toLocaleString()} 토큰</dd>
            </div>
            <div className="flex gap-1">
              <dt>소요</dt>
              <dd>{(state.durationMs / 1000).toFixed(1)}초</dd>
            </div>
          </dl>
        </div>
      );
  }
}
