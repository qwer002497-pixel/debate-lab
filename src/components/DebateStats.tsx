// 누적 토큰·예상 비용·응답 시간 (분석형·대화형 공통).
// 재시도로 덮어쓴 이전 시도와, 실패했지만 과금된 호출(형식 오류 등)도 포함한다(lib/debate/ledger.ts).
// 모드마다 진행 상태 구조가 다르므로, 표시에 필요한 값만 props로 받는다.

import { MODEL_IDS } from "@/lib/debate/config";
import { sumLedgers, type UsageLedger } from "@/lib/debate/ledger";
import type { ModelId } from "@/types/debate";
import { MODEL_META } from "./ModelPanel";

interface DebateStatsProps {
  ledger: Record<ModelId, UsageLedger>;
  plannedCalls: number; // 이 토론에서 예정된 모델 호출 수
  elapsedMs: number; // 단계별 실제 대기 시간의 합
}

export default function DebateStats({ ledger, plannedCalls, elapsedMs }: DebateStatsProps) {
  const all = sumLedgers(ledger);
  const rows = [
    ...MODEL_IDS.map((id) => ({ key: id, label: MODEL_META[id].name, t: ledger[id] })),
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
          모델 호출 {all.succeeded + all.failed} / 예정 {plannedCalls}회 · 대기 시간{" "}
          {(elapsedMs / 1000).toFixed(1)}초
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
