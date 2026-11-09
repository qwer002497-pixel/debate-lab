// 누적 토큰·예상 비용·응답 시간.
// 재시도로 덮어쓴 이전 시도와, 실패했지만 과금된 호출(형식 오류 등)도 포함한다(useDebateSession의 ledger).

import { MODEL_IDS, totalModelCalls } from "@/lib/debate/config";
import type { DebateView, UsageLedger } from "@/lib/debate/useDebateSession";
import { MODEL_META } from "./ModelPanel";

export default function DebateStats({ view }: { view: DebateView }) {
  if (!view.request) return null;
  const all = MODEL_IDS.reduce<UsageLedger>(
    (sum, id) => {
      const l = view.ledger[id];
      return {
        inputTokens: sum.inputTokens + l.inputTokens,
        outputTokens: sum.outputTokens + l.outputTokens,
        costUsd: sum.costUsd + l.costUsd,
        succeeded: sum.succeeded + l.succeeded,
        failed: sum.failed + l.failed,
      };
    },
    { inputTokens: 0, outputTokens: 0, costUsd: 0, succeeded: 0, failed: 0 },
  );
  const planned = totalModelCalls(view.request.rounds);
  const rows = [
    ...MODEL_IDS.map((id) => ({ key: id, label: MODEL_META[id].name, t: view.ledger[id] })),
    { key: "all", label: "합계", t: all },
  ];

  return (
    <section
      aria-label="누적 사용량"
      className="overflow-x-auto rounded-2xl border border-white/10 bg-white/5 px-5 py-4 text-sm text-slate-300"
    >
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-semibold text-white">누적 사용량</p>
        <p className="text-xs text-slate-400">
          모델 호출 {all.succeeded + all.failed} / 예정 {planned}회 · 대기 시간{" "}
          {(view.elapsedMs / 1000).toFixed(1)}초
        </p>
      </div>
      <table className="w-full min-w-[22rem] font-mono text-xs">
        <thead className="text-left text-slate-400">
          <tr>
            <th className="py-1 pr-3 font-normal">모델</th>
            <th className="py-1 pr-3 text-right font-normal">성공/실패</th>
            <th className="py-1 pr-3 text-right font-normal">입력</th>
            <th className="py-1 pr-3 text-right font-normal">출력</th>
            <th className="py-1 text-right font-normal">예상 비용</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ key, label, t }) => (
            <tr key={key} className={key === "all" ? "border-t border-white/10 text-white" : undefined}>
              <td className="py-1 pr-3 font-sans">{label}</td>
              <td className="py-1 pr-3 text-right">
                {t.succeeded}/{t.failed}
              </td>
              <td className="py-1 pr-3 text-right">{t.inputTokens.toLocaleString()}</td>
              <td className="py-1 pr-3 text-right">{t.outputTokens.toLocaleString()}</td>
              <td className="py-1 text-right">${t.costUsd.toFixed(4)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-slate-500">
        예상 비용은 공개 단가(입력 $2 · 출력 $10 / 100만 토큰) 기준 추정치이며 실제 청구액과 다를 수 있습니다.
        재시도로 대체된 이전 시도도 포함합니다.
      </p>
    </section>
  );
}
