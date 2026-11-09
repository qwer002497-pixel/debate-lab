// 라운드 하나(GPT·Claude 반론 2개)를 접고 펼 수 있는 섹션으로 보여준다.
// 라운드가 많아지면 화면이 길어지므로, 진행 중이거나 가장 최근 라운드만 펼친다.

import type { RoundView } from "@/lib/debate/useDebateSession";
import { MODEL_IDS } from "@/lib/debate/config";
import RebuttalPanel, { StanceChip } from "./RebuttalPanel";
import { MODEL_META } from "./ModelPanel";
import { stageStatus, STAGE_STATUS_STYLE } from "./stage-status";

export default function RoundSection({
  view,
  totalRounds,
  defaultOpen,
}: {
  view: RoundView;
  totalRounds: number;
  defaultOpen: boolean;
}) {
  const status = stageStatus(view.turns);
  const style = STAGE_STATUS_STYLE[status];
  return (
    <details open={defaultOpen} className="group rounded-2xl border border-white/10 bg-white/5">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-2 px-5 py-4 text-white">
        <span aria-hidden className="text-slate-400 transition-transform group-open:rotate-90">
          ▸
        </span>
        <span className="font-semibold">
          {view.round}라운드
          {view.round === totalRounds && <span className="ml-1 text-sm font-normal text-slate-400">(마지막)</span>}
        </span>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${style.className}`}>{style.label}</span>
        <span className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
          {MODEL_IDS.map((id) => {
            const slot = view.turns[id];
            if (slot.status !== "done" || slot.turn.status !== "success") return null;
            return (
              <span key={id} className="flex items-center gap-1">
                {MODEL_META[id].name}→상대: <StanceChip stance={slot.turn.content.stance} />
              </span>
            );
          })}
        </span>
      </summary>
      <div className="grid gap-6 px-3 pb-5 sm:px-5 md:grid-cols-2">
        {MODEL_IDS.map((id) => (
          <RebuttalPanel key={id} model={id} round={view.round} slot={view.turns[id]} />
        ))}
      </div>
    </details>
  );
}
