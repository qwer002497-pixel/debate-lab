// 최종 정리: 입장(수정된 입장·유지한 입장)은 가장 최근에 두 모델이 모두 응답한 라운드 기준,
// 수용한 내용과 추가 검증 사항은 앞 라운드 내용이 빠지지 않도록 모든 완료 라운드에서 모아 보여준다.
// 추가 모델 호출 없이 모델들이 스스로 밝힌 내용을 모은 것이며, 자동 판정이 아니다.

import { MODEL_IDS } from "@/lib/debate/config";
import type { DebateView } from "@/lib/debate/useDebateSession";
import type { ModelId, RebuttalContent, RoundTurn } from "@/types/debate";
import { MODEL_META } from "./ModelPanel";
import { StanceChip } from "./RebuttalPanel";

type Success = Extract<RoundTurn, { status: "success" }>;

export default function DebateConclusion({ view }: { view: DebateView }) {
  // 두 모델이 모두 성공한 라운드들
  const complete = view.rounds
    .map((r) => {
      const contents = {} as Record<ModelId, RebuttalContent>;
      for (const id of MODEL_IDS) {
        const slot = r.turns[id];
        if (slot.status !== "done" || slot.turn.status !== "success") return null;
        contents[id] = (slot.turn as Success).content;
      }
      return { round: r.round, contents };
    })
    .filter((r): r is CompleteRound => r !== null);

  if (complete.length === 0) return null;
  const last = complete[complete.length - 1];
  const isFinal = view.status === "completed" && last.round === view.request?.rounds;

  return (
    <section
      aria-labelledby="conclusion-title"
      className="flex flex-col gap-5 rounded-2xl bg-white p-5 text-slate-900 shadow-xl shadow-black/20 sm:p-7"
    >
      <div className="flex flex-col gap-1">
        <h2 id="conclusion-title" className="text-lg font-bold">
          {isFinal ? "토론 정리" : `현재까지의 정리 (${last.round}라운드 기준)`}
        </h2>
        <p className="text-sm leading-6 text-slate-500">
          각 모델이 스스로 밝힌 내용을 모은 것이며 자동 판정이 아닙니다. 입장은 가장 최근에 두 모델이
          모두 응답한 라운드 기준이고, 수용 내용과 검증 사항은 전 라운드를 모았습니다. 두 모델이 합의한
          내용도 사실로 확정된 것은 아니며, 외부 자료로 검증되지 않았습니다.
        </p>
      </div>

      {/* 평가 추이 */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[18rem] text-sm">
          <caption className="mb-2 text-left text-sm font-semibold text-slate-700">
            라운드별 평가 (각 모델 → 상대 주장)
          </caption>
          <thead className="text-left text-xs text-slate-500">
            <tr>
              <th className="py-1 pr-3 font-normal">모델</th>
              {complete.map((r) => (
                <th key={r.round} className="py-1 pr-3 font-normal">
                  {r.round}R
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MODEL_IDS.map((id) => (
              <tr key={id}>
                <td className="py-1 pr-3 font-medium">{MODEL_META[id].name}</td>
                {complete.map((r) => (
                  <td key={r.round} className="py-1 pr-3">
                    <StanceChip stance={r.contents[id].stance} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Block title={isFinal ? "최종 입장" : "현재 입장"} description={`${last.round}라운드의 '수정된 입장'`}>
        {MODEL_IDS.map((id) => (
          <ModelCard key={id} id={id}>
            <p className="whitespace-pre-wrap">{last.contents[id].revisedPosition}</p>
          </ModelCard>
        ))}
      </Block>

      {/* 수용한 내용은 라운드마다 새로 나오므로 마지막 라운드만 보면 앞 라운드의 수용 내용이 빠진다. 전 라운드를 모은다. */}
      <Block
        title="합의 가능성이 있는 부분"
        description="각 모델이 상대 주장에서 수용한다고 밝힌 내용 (전 라운드)"
      >
        {MODEL_IDS.map((id) => (
          <ModelCard key={id} id={id}>
            <TaggedList
              items={collectAcrossRounds(complete, id, "acceptedPoints")}
              empty="수용한다고 밝힌 내용 없음"
            />
          </ModelCard>
        ))}
      </Block>

      {/* 실제 토론에서 "유지한 내용"에 상대와 같은 의견도 섞여 나오므로 "의견 차이"라고 부르지 않는다.
          어떤 항목이 진짜 쟁점인지 가려내는 일은 Phase 5 종합 보고서에서 다룬다. */}
      <Block
        title="각 모델이 유지한 입장"
        description="상대와 같은 의견일 수도 있음 · 실제 쟁점 구분은 종합 보고서 단계에서"
      >
        {MODEL_IDS.map((id) => (
          <ModelCard key={id} id={id}>
            <List items={last.contents[id].maintainedPoints} empty="유지한다고 밝힌 내용 없음" />
          </ModelCard>
        ))}
      </Block>

      {/* 검증 필요 사항은 앞 라운드에서 제기된 것도 누락되면 안 되므로 전 라운드를 모은다. */}
      <Block title="추가 검증이 필요한 사항" description="외부 자료로 확인해야 할 내용 (전 라운드)">
        {MODEL_IDS.map((id) => (
          <ModelCard key={id} id={id}>
            <TaggedList items={collectAcrossRounds(complete, id, "verificationNeeded")} empty="없음" />
          </ModelCard>
        ))}
      </Block>
    </section>
  );
}

function Block({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-slate-700">
        {title} <span className="font-normal text-slate-400">· {description}</span>
      </h3>
      <div className="grid gap-3 md:grid-cols-2">{children}</div>
    </div>
  );
}

function ModelCard({ id, children }: { id: ModelId; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 p-3 text-[15px] leading-7 text-slate-800">
      <p className="mb-1 text-xs font-semibold text-slate-500">{MODEL_META[id].name}</p>
      {children}
    </div>
  );
}

type CompleteRound = { round: number; contents: Record<ModelId, RebuttalContent> };

/** 모든 완료 라운드에서 한 모델의 목록 항목을 모은다. 완전히 같은 문장은 처음 나온 라운드만 남긴다. */
function collectAcrossRounds(
  rounds: CompleteRound[],
  id: ModelId,
  key: "acceptedPoints" | "verificationNeeded",
): { round: number; text: string }[] {
  const seen = new Set<string>();
  const items: { round: number; text: string }[] = [];
  for (const r of rounds) {
    for (const text of r.contents[id][key]) {
      if (seen.has(text)) continue;
      seen.add(text);
      items.push({ round: r.round, text });
    }
  }
  return items;
}

function TaggedList({ items, empty }: { items: { round: number; text: string }[]; empty: string }) {
  if (!items.length) return <p className="text-sm text-slate-400">{empty}</p>;
  return (
    <ul className="flex flex-col gap-1">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2">
          <span className="mt-1 shrink-0 rounded bg-slate-100 px-1.5 font-mono text-[11px] leading-5 text-slate-500">
            {item.round}R
          </span>
          <span>{item.text}</span>
        </li>
      ))}
    </ul>
  );
}

function List({ items, empty }: { items: string[]; empty: string }) {
  if (!items.length) return <p className="text-sm text-slate-400">{empty}</p>;
  return (
    <ul className="flex list-disc flex-col gap-1 pl-5">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}
