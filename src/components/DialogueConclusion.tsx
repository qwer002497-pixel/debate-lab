// 대화형 토론 최종 결과: 두 모델의 closing(마무리)을 나란히 보여준다.
// 합의점과 남은 의견 차이는 모델이 서로 다른 필드로 낸 값이며(schema에서 겹침 금지),
// 두 모델이 합의했더라도 사실이 검증된 것으로 표현하지 않는다.

import type { DialogueSessionState } from "@/lib/dialogue/session";
import { selectTurns } from "@/lib/dialogue/session";
import { MODEL_IDS } from "@/lib/debate/config";
import type { ModelId } from "@/types/debate";
import type { ClosingContent } from "@/types/dialogue";
import { MODEL_META } from "./ModelPanel";

export default function DialogueConclusion({ state }: { state: DialogueSessionState }) {
  const closings = {} as Partial<Record<ModelId, ClosingContent>>;
  for (const t of selectTurns(state, "closing")) {
    if (t.turn?.status === "success") closings[t.speaker] = t.turn.content as ClosingContent;
  }
  const available = MODEL_IDS.filter((id) => closings[id]);
  if (available.length === 0) return null;
  const complete = available.length === MODEL_IDS.length;

  const card = (id: ModelId, body: React.ReactNode) => (
    <div key={id} className="rounded-xl border border-slate-200 p-3 text-[15px] leading-7 text-slate-800">
      <p className="mb-1 text-xs font-semibold text-slate-500">{MODEL_META[id].name}</p>
      {closings[id] ? body : <p className="text-sm text-slate-400">마무리를 받지 못했습니다.</p>}
    </div>
  );
  const list = (items: string[] | undefined, empty: string) =>
    items && items.length ? (
      <ul className="flex list-disc flex-col gap-1 pl-5">
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    ) : (
      <p className="text-sm text-slate-400">{empty}</p>
    );
  const anyChanges = available.some((id) => closings[id]!.positionChanges.length > 0);

  return (
    <section
      aria-labelledby="dialogue-conclusion-title"
      className="flex flex-col gap-5 rounded-2xl bg-white p-5 text-slate-900 shadow-xl shadow-black/20 sm:p-7"
    >
      <div className="flex flex-col gap-1">
        <h2 id="dialogue-conclusion-title" className="text-lg font-bold">
          {complete ? "토론 정리" : "토론 정리 (일부 모델만 마무리 완료)"}
        </h2>
        <p className="text-sm leading-6 text-slate-500">
          각 모델이 대화 전체를 보고 따로 작성한 마무리입니다. 두 모델이 합의한 내용도 사실로 확정된 것은
          아니며, 외부 자료로 검증되지 않았습니다.
        </p>
      </div>

      <Block title="최종 입장">{MODEL_IDS.map((id) => card(id, <p className="whitespace-pre-wrap">{closings[id]?.finalPosition}</p>))}</Block>
      <Block title="합의점" note="각 모델이 대화에서 합의했다고 본 점">
        {MODEL_IDS.map((id) => card(id, list(closings[id]?.agreedPoints, "합의했다고 밝힌 점 없음")))}
      </Block>
      <DisagreementBlock closings={closings} available={available} card={card} />
      {anyChanges && (
        <Block title="대화 중 바뀐 입장">
          {MODEL_IDS.map((id) => card(id, list(closings[id]?.positionChanges, "바뀐 입장 없음")))}
        </Block>
      )}
      <Block title="추가 사실 검증이 필요한 내용" note="합의 여부와 관계없이 외부 자료로 확인해야 할 사항">
        {MODEL_IDS.map((id) => card(id, list(closings[id]?.verificationNeeded, "없음")))}
      </Block>
    </section>
  );
}

/**
 * 남은 의견 차이 (P5-7).
 * - 모두 0개: 빈 카드를 강조하지 않고 한 줄로 안내 (최종 입장을 직접 비교하도록 권함)
 * - 한쪽만 기록: 한쪽 결과만으로 "차이 없음"이라고 보지 않도록, 양쪽 카드를 유지하고 비어 있는 쪽은 "기록하지 않음"으로 표시
 * - 항목은 "나/상대/차이/갈린 기준·조건" 네 줄 형식일 수 있으므로 줄바꿈을 그대로 보여준다
 */
function DisagreementBlock({
  closings,
  available,
  card,
}: {
  closings: Partial<Record<ModelId, ClosingContent>>;
  available: ModelId[];
  card: (id: ModelId, body: React.ReactNode) => React.ReactNode;
}) {
  const recorded = available.filter((id) => closings[id]!.remainingDisagreements.length > 0);

  if (recorded.length === 0) {
    return (
      <div className="flex flex-col gap-1" data-section="disagreements" data-state="none">
        <h3 className="text-sm font-semibold text-slate-700">남은 의견 차이</h3>
        <p className="text-sm leading-6 text-slate-500">
          {available.length === MODEL_IDS.length ? "두 모델 모두" : available.map((id) => MODEL_META[id].name).join(", ") + "은(는)"}{" "}
          남은 의견 차이를 기록하지 않았습니다. 적용 조건이나 강조점의 차이가 있는지는 위 최종 입장을 직접 비교해 확인해 주세요.
        </p>
      </div>
    );
  }

  const oneSided = recorded.length < MODEL_IDS.length;
  return (
    <div className="flex flex-col gap-2" data-section="disagreements" data-state={oneSided ? "one-sided" : "both"}>
      <h3 className="text-sm font-semibold text-slate-700">
        남은 의견 차이
        <span className="font-normal text-slate-400"> · 각 모델이 본 실제 차이 (‘나’는 해당 모델, ‘상대’는 다른 모델)</span>
      </h3>
      {oneSided && (
        <p className="text-xs leading-5 text-amber-700">
          {recorded.map((id) => MODEL_META[id].name).join(", ")}만 남은 차이를 기록했습니다. 한쪽이 기록하지 않았다고 해서
          차이가 없다는 뜻은 아니므로, 양쪽 최종 입장을 함께 비교해 주세요.
        </p>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {MODEL_IDS.map((id) =>
          card(
            id,
            closings[id]?.remainingDisagreements.length ? (
              <ul className="flex flex-col gap-2">
                {closings[id]!.remainingDisagreements.map((d, i) => (
                  <li key={i} className="whitespace-pre-line rounded-lg bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-800">
                    {d}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-400">이 모델은 남은 의견 차이를 기록하지 않았습니다.</p>
            ),
          ),
        )}
      </div>
    </div>
  );
}

function Block({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-slate-700">
        {title}
        {note && <span className="font-normal text-slate-400"> · {note}</span>}
      </h3>
      <div className="grid gap-3 md:grid-cols-2">{children}</div>
    </div>
  );
}
