// 모델 결과 패널의 공통 틀(헤더·상태 배지·로딩·오류·사용량 표시).
// 최초 분석 패널(ResultPanel)과 반론 라운드 패널(RebuttalPanel)이 같은 모양을 쓰도록 분리했다.

import type { ReactNode } from "react";
import type { ModelId, TokenUsage } from "@/types/debate";

export const MODEL_META: Record<ModelId, { name: string; provider: string; avatarClass: string }> = {
  gpt: { name: "GPT", provider: "OpenAI", avatarClass: "bg-emerald-600" },
  claude: { name: "Claude", provider: "Anthropic", avatarClass: "bg-orange-600" },
};

export type BadgeKind = "idle" | "loading" | "not_connected" | "error" | "success";

const BADGE_CLASS: Record<BadgeKind, string> = {
  idle: "bg-slate-100 text-slate-600",
  loading: "bg-indigo-100 text-indigo-700",
  not_connected: "bg-amber-100 text-amber-800",
  error: "bg-red-100 text-red-700",
  success: "bg-emerald-100 text-emerald-800",
};

interface ModelPanelShellProps {
  model: ModelId;
  panelId: string; // 페이지 안에서 고유한 id (aria-labelledby 용)
  subtitle: string;
  modelIdLabel?: string; // 실제 호출한 모델 ID
  badge: { kind: BadgeKind; label: string };
  children: ReactNode;
  className?: string;
}

export function ModelPanelShell({
  model,
  panelId,
  subtitle,
  modelIdLabel,
  badge,
  children,
  className = "min-h-72",
}: ModelPanelShellProps) {
  const meta = MODEL_META[model];
  return (
    <section
      aria-labelledby={`${panelId}-title`}
      className={`flex flex-col rounded-2xl bg-white text-slate-900 shadow-xl shadow-black/20 ${className}`}
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
            <h3 id={`${panelId}-title`} className="font-semibold leading-5">
              {meta.name}
            </h3>
            <p className="text-xs text-slate-500">
              {meta.provider} · {subtitle}
            </p>
            {modelIdLabel && (
              <p className="font-mono text-xs whitespace-nowrap text-slate-400">{modelIdLabel}</p>
            )}
          </div>
        </div>
        <span
          className={`flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap ${BADGE_CLASS[badge.kind]}`}
        >
          {badge.kind === "loading" && (
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
        {children}
      </div>
    </section>
  );
}

/** 내용이 들어올 자리를 회색 막대로 보여준다(스켈레톤). 실제 텍스트는 아니다. */
export function PanelLoading({ message }: { message: string }) {
  return (
    <div className="flex flex-col gap-3" aria-label={message}>
      <p className="text-sm text-slate-500">{message}</p>
      {["w-full", "w-11/12", "w-4/5", "w-full", "w-2/3"].map((w, i) => (
        <div key={i} className={`h-3 animate-pulse rounded bg-slate-200 ${w}`} />
      ))}
    </div>
  );
}

export function PanelMessage({
  tone,
  title,
  message,
}: {
  tone: "error" | "warning";
  title: string;
  message: string;
}) {
  const cls =
    tone === "error"
      ? "border-red-200 bg-red-50 text-red-900"
      : "border-amber-200 bg-amber-50 text-amber-900";
  return (
    <div
      role={tone === "error" ? "alert" : undefined}
      className={`m-auto flex max-w-sm flex-col gap-2 rounded-xl border p-4 text-sm leading-6 ${cls}`}
    >
      <p className="font-semibold">{title}</p>
      <p>{message}</p>
    </div>
  );
}

/** 토큰·예상 비용·소요 시간 표시 */
export function TurnMetrics({
  usage,
  estimatedCostUsd,
  durationMs,
}: {
  usage: TokenUsage;
  estimatedCostUsd?: number;
  durationMs: number;
}) {
  return (
    <dl className="mt-auto flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-100 pt-3 font-mono text-xs text-slate-500">
      <div className="flex gap-1">
        <dt>입력</dt>
        <dd>{usage.inputTokens.toLocaleString()} 토큰</dd>
      </div>
      <div className="flex gap-1">
        <dt>출력</dt>
        <dd>{usage.outputTokens.toLocaleString()} 토큰</dd>
      </div>
      {estimatedCostUsd !== undefined && (
        <div className="flex gap-1">
          <dt>예상</dt>
          <dd>${estimatedCostUsd.toFixed(4)}</dd>
        </div>
      )}
      <div className="flex gap-1">
        <dt>소요</dt>
        <dd>{(durationMs / 1000).toFixed(1)}초</dd>
      </div>
    </dl>
  );
}

export function TruncatedNotice() {
  return (
    <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
      출력 토큰 상한에 도달해 답변 끝부분이 잘렸을 수 있습니다.
    </p>
  );
}
