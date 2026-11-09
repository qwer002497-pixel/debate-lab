// 반론 라운드에서 모델 하나의 구조화된 응답(9개 항목)을 보여주는 패널.

import { REBUTTAL_FIELDS, STANCE_LABELS } from "@/lib/debate/rebuttal";
import type { Slot } from "@/lib/debate/useDebateSession";
import type { ModelId, RebuttalContent, RoundTurn, Stance } from "@/types/debate";
import {
  MODEL_META,
  ModelPanelShell,
  PanelLoading,
  PanelMessage,
  TruncatedNotice,
  TurnMetrics,
  type BadgeKind,
} from "./ModelPanel";

export const STANCE_CLASS: Record<Stance, string> = {
  agree: "bg-emerald-100 text-emerald-800",
  partially_agree: "bg-sky-100 text-sky-800",
  disagree: "bg-rose-100 text-rose-800",
};

export function StanceChip({ stance }: { stance: Stance }) {
  return (
    <span className={`rounded-md px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${STANCE_CLASS[stance]}`}>
      {STANCE_LABELS[stance]}
    </span>
  );
}

export default function RebuttalPanel({
  model,
  round,
  slot,
}: {
  model: ModelId;
  round: number;
  slot: Slot<RoundTurn>;
}) {
  const name = MODEL_META[model].name;
  const turn = slot.status === "done" ? slot.turn : null;
  const badge: { kind: BadgeKind; label: string } =
    slot.status === "idle"
      ? { kind: "idle", label: "대기 중" }
      : slot.status === "loading"
        ? { kind: "loading", label: "검토 중" }
        : turn?.status === "success"
          ? { kind: "success", label: "검토 완료" }
          : turn?.error.code === "missing_api_key"
            ? { kind: "not_connected", label: "API 미연결" }
            : { kind: "error", label: "실패" };

  return (
    <ModelPanelShell
      model={model}
      panelId={`round${round}-${model}`}
      subtitle={`${round}라운드 반론`}
      modelIdLabel={turn?.status === "success" ? turn.model : undefined}
      badge={badge}
      className="min-h-48"
    >
      {slot.status === "idle" && (
        <p className="m-auto text-sm text-slate-400">이전 단계가 끝나면 시작됩니다.</p>
      )}
      {slot.status === "loading" && (
        <PanelLoading message={`${name}가 상대 모델의 주장을 검토하고 있습니다…`} />
      )}
      {turn?.status === "error" && (
        <div className="flex flex-col gap-4">
          <PanelMessage
            tone={turn.error.code === "missing_api_key" ? "warning" : "error"}
            title="이 라운드 응답을 받지 못했습니다"
            message={turn.error.message}
          />
          {turn.usage && (
            <TurnMetrics usage={turn.usage} estimatedCostUsd={turn.estimatedCostUsd} durationMs={turn.durationMs} />
          )}
        </div>
      )}
      {turn?.status === "success" && (
        <div className="flex flex-col gap-4">
          {turn.truncated && <TruncatedNotice />}
          <RebuttalBody content={turn.content} />
          <TurnMetrics usage={turn.usage} estimatedCostUsd={turn.estimatedCostUsd} durationMs={turn.durationMs} />
        </div>
      )}
    </ModelPanelShell>
  );
}

/** 9개 항목을 순서대로 표시. 모델 응답은 일반 텍스트로만 렌더링한다(HTML로 해석하지 않음). */
function RebuttalBody({ content }: { content: RebuttalContent }) {
  return (
    <ol className="flex flex-col gap-4 text-[15px] leading-7 text-slate-800">
      {REBUTTAL_FIELDS.map((field, index) => {
        const value = content[field.key];
        const highlight = field.key === "revisedPosition";
        return (
          <li
            key={field.key}
            className={highlight ? "rounded-xl border border-indigo-100 bg-indigo-50/60 p-3" : undefined}
          >
            <p className="mb-1 flex items-center gap-2 text-sm font-semibold text-slate-600">
              <span className="font-mono text-xs text-slate-400">{index + 1}</span>
              {field.label}
              {field.kind === "stance" && <StanceChip stance={value as Stance} />}
            </p>
            {field.kind === "text" && <p className="whitespace-pre-wrap">{value as string}</p>}
            {field.kind === "list" &&
              ((value as string[]).length ? (
                <ul className="flex list-disc flex-col gap-1 pl-5">
                  {(value as string[]).map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-slate-400">(없음)</p>
              ))}
          </li>
        );
      })}
    </ol>
  );
}
