// 최종 비교 (P5-8). 두 모델의 마무리(DialogueConclusion)와 별도 영역으로, 비교 담당 모델 1개가
// 대화 전체를 읽고 분류한 결과를 보여준다.
//
// 표시 원칙
// - 비교 담당은 토론 참여 모델 중 하나이며 중립적인 제3자가 아니다. 결과는 사실·정답을 보장하지 않는다.
// - 해소 시점 링크는 resolutionTarget(서버 검증과 같은 기준)으로 계산하고, 실제 transcript에 그 발언이
//   있을 때만 연결한다. 맞지 않으면 임의의 발언에 연결하지 않고 "확인할 수 없음"으로 표시한다.
// - 상태: 대기 / 진행 중 / 성공 / 실패(재시도 가능) / 재시도 소진 / 실행 안 됨(중단)
// - 본문 A/B 표기의 실제 모델은 서버가 응답에 담아 준 abOrder로만 표시한다 (클라이언트가 계산하지 않음).
//   비교가 성공한 뒤에만 보여주며, "비교 담당"(누가 비교했는지)과는 별개의 정보임을 구분해 적는다.

import { MODEL_IDS } from "@/lib/debate/config";
import { resolutionTarget } from "@/lib/dialogue/comparison-schema";
import {
  isComparisonExhausted,
  selectCanRetry,
  type DialogueSessionState,
} from "@/lib/dialogue/session";
import type { ComparisonContent, ComparisonRelation, ResolvedDisagreement } from "@/types/comparison";
import type { ModelId, RoundCount } from "@/types/debate";
import type { DialogueTranscriptEntry } from "@/types/dialogue";
import { MODEL_META } from "./ModelPanel";

const RELATION: Record<ComparisonRelation, { label: string; desc: string; cls: string }> = {
  aligned: { label: "결론 일치", desc: "확인된 결론이 같고 남은 의견 차이가 없습니다.", cls: "bg-emerald-100 text-emerald-800" },
  partially_aligned: { label: "부분 일치", desc: "합의한 부분과 남은 의견 차이가 함께 있습니다.", cls: "bg-sky-100 text-sky-800" },
  divergent: { label: "결론 불일치", desc: "핵심 결론에 남은 의견 차이가 있습니다.", cls: "bg-rose-100 text-rose-800" },
  undetermined: { label: "판단 불가", desc: "대화 기록만으로는 합의나 차이를 확정할 수 없습니다.", cls: "bg-amber-100 text-amber-800" },
};

const name = (id: ModelId) => MODEL_META[id].name;

export default function DialogueComparison({
  state,
  onRetry,
}: {
  state: DialogueSessionState;
  onRetry: () => void;
}) {
  const c = state.comparison;
  const request = state.request;
  if (!c || !request) return null; // 최종 비교를 쓰지 않는 세션

  const total = 2 * request.rounds + 4;
  const closingsDone = state.transcript.length === total;
  const comparatorText = c.comparator
    ? `${name(c.comparator)} (토론 참여 모델 중 하나 · 중립적인 제3자가 아님)`
    : "서버가 토론마다 두 참여 모델 중 하나로 정합니다 (응답 후 표시)";

  let phase: "waiting" | "idle" | "loading" | "success" | "error" | "exhausted" | "not_run";
  if (c.status === "success") phase = "success";
  else if (c.status === "loading") phase = "loading";
  else if (isComparisonExhausted(c)) phase = "exhausted";
  else if (c.status === "error") phase = "error";
  // 발언 단계가 재시도 가능한 오류면 아직 비교 전(대기)이고, 중단·발언 재시도 소진이면 비교가 실행되지 않는다.
  else if (!closingsDone) phase = state.status === "stopped" || state.retryExhausted ? "not_run" : "waiting";
  else phase = state.status === "stopped" ? "not_run" : "idle";
  // 비교가 실패한 뒤 중단한 경우는 "실행 안 됨"이 아니라 실패 상태를 그대로 보여준다 (위에서 먼저 판정).

  return (
    <section
      aria-labelledby="dialogue-comparison-title"
      data-comparison={phase}
      className="flex flex-col gap-5 rounded-2xl border-2 border-indigo-300 bg-white p-5 text-slate-900 shadow-xl shadow-black/20 sm:p-7"
    >
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="dialogue-comparison-title" className="text-lg font-bold">
            최종 비교
          </h2>
          {phase === "success" && c.turn?.status === "success" && (
            <span
              data-relation={c.turn.content.relation}
              className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${RELATION[c.turn.content.relation].cls}`}
            >
              {RELATION[c.turn.content.relation].label}
            </span>
          )}
        </div>
        <p className="text-sm text-slate-700" data-field="comparator">
          <span className="font-semibold">비교 담당:</span> {comparatorText}
        </p>
        <p className="text-xs leading-5 text-slate-500" data-field="limits">
          비교 담당 모델이 대화 전체와 두 마무리를 읽고 분류한 결과입니다. 비교 담당은 이 토론에 참여한 모델이므로
          중립을 보장하지 않으며(발언자를 A/B로 가려 편향을 줄이려 했을 뿐입니다), 이 결과가 사실이나 정답을 보장하지도
          않습니다. 외부 자료로 검증되지 않았습니다.
        </p>
      </div>

      {phase === "waiting" && <StatusLine tone="muted">두 모델의 마무리가 모두 끝나면 최종 비교를 실행합니다.</StatusLine>}
      {phase === "idle" && (
        <StatusLine tone="muted">
          마무리가 끝났고 최종 비교를 아직 실행하지 않았습니다.{state.status === "paused" ? " 재개하면 최종 비교를 실행합니다." : ""}
        </StatusLine>
      )}
      {phase === "not_run" && (
        <StatusLine tone="muted">토론이 끝까지 진행되지 않아 최종 비교를 실행하지 않았습니다.</StatusLine>
      )}
      {phase === "loading" && (
        <StatusLine tone="info">
          최종 비교 중입니다 ({c.attempts}/{c.maxAttempts}회째). 비교가 끝나야 토론이 완료됩니다.
        </StatusLine>
      )}
      {phase === "error" && (
        <div className="flex flex-col gap-2">
          <StatusLine tone="error">
            최종 비교가 실패했습니다 ({c.attempts}/{c.maxAttempts}회 시도){c.error ? `: ${c.error.message}` : ""} 위의 대화 기록과
            두 모델의 마무리는 그대로 보존됩니다.
          </StatusLine>
          {selectCanRetry(state) && (
            <button
              type="button"
              onClick={onRetry}
              className="self-start rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500"
            >
              최종 비교 재시도
            </button>
          )}
        </div>
      )}
      {phase === "exhausted" && (
        <StatusLine tone="error">
          최종 비교가 최대 시도 횟수({c.maxAttempts}회)에 도달해 더 재시도하지 않습니다. 위의 대화 기록과 두 모델의 마무리는
          보존되어 있으므로 마무리 원문으로 직접 비교해 주세요.
        </StatusLine>
      )}

      {phase === "success" && c.turn?.status === "success" && c.abOrder && (
        <div data-field="ab-legend" className="flex flex-col gap-1 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          <p className="font-semibold text-slate-800">본문 표기 안내</p>
          <ul className="flex flex-wrap gap-x-5 gap-y-1">
            <li data-ab="A">본문에서 A = {name(c.abOrder.A)}</li>
            <li data-ab="B">본문에서 B = {name(c.abOrder.B)}</li>
          </ul>
          <p className="text-xs leading-5 text-slate-500">
            비교 담당 모델은 두 참여자를 A/B로 가린 기록을 읽고 비교했습니다. 이 표기는 비교가 끝난 뒤 서버가 알려 준
            대응 관계이며, 위의 비교 담당 모델과는 별개입니다.
          </p>
        </div>
      )}
      {phase === "success" && c.turn?.status === "success" && (
        <ComparisonBody content={c.turn.content} transcript={state.transcript} rounds={request.rounds} />
      )}
    </section>
  );
}

function ComparisonBody({
  content,
  transcript,
  rounds,
}: {
  content: ComparisonContent;
  transcript: DialogueTranscriptEntry[];
  rounds: RoundCount;
}) {
  const r = RELATION[content.relation];
  return (
    <>
      <p className="text-sm text-slate-600" data-field="relation-desc">
        관계: <span className="font-semibold text-slate-800">{r.label}</span> — {r.desc}
      </p>

      <Section id="agreed" title="합의된 내용" count={content.agreedPoints.length} empty="비교 담당이 기록한 합의된 내용이 없습니다.">
        <Bullets items={content.agreedPoints} />
      </Section>

      <Section
        id="disagreements"
        title="남아 있는 의견 차이"
        count={content.disagreements.length}
        empty="비교 담당이 남은 의견 차이를 기록하지 않았습니다."
      >
        <div className="flex flex-col gap-3">
          {content.disagreements.map((d, i) => (
            <article key={i} data-item="disagreement" className="rounded-xl border border-rose-200 bg-rose-50/50 p-3 text-sm leading-6">
              <p className="mb-2 font-semibold text-slate-900">쟁점: {d.issue}</p>
              <div className="grid gap-2 md:grid-cols-2">
                <Side id="gpt" label="입장" text={d.gptPosition} />
                <Side id="claude" label="입장" text={d.claudePosition} />
              </div>
              <dl className="mt-2 grid gap-x-3 gap-y-1 text-slate-700 sm:grid-cols-[auto_1fr]">
                <dt className="font-medium text-slate-500">차이점</dt>
                <dd data-field="difference">{d.difference}</dd>
                <dt className="font-medium text-slate-500">갈린 기준·조건</dt>
                <dd data-field="basis">{d.basisOrCondition}</dd>
              </dl>
            </article>
          ))}
        </div>
      </Section>

      <Section
        id="resolved"
        title="해소된 의견 차이"
        note="토론의 경과: 처음에는 실제로 달랐던 입장이 대화 중 조정된 과정 (최종 결론은 '합의된 내용'에 있으며 같은 쟁점이 양쪽에 나올 수 있습니다)"
        count={content.resolvedDisagreements.length}
        empty="해소된 의견 차이로 기록된 쟁점이 없습니다."
      >
        <ul className="flex flex-col gap-2">
          {content.resolvedDisagreements.map((x, i) => (
            <li key={i} data-item="resolved" className="rounded-xl border border-slate-200 p-3 text-sm leading-6">
              <p className="font-semibold text-slate-900">{x.issue}</p>
              <p className="text-slate-700">
                <span className="text-slate-500">처음 차이:</span> {x.initialDifference}
              </p>
              <p className="text-slate-700">
                <span className="text-slate-500">해소 방법:</span> {x.howResolved}
              </p>
              <ResolvedWhere item={x} transcript={transcript} rounds={rounds} />
            </li>
          ))}
        </ul>
      </Section>

      <Section
        id="equivalent"
        title="같은 의미를 가진 표현"
        note="표현은 다르지만 실질적으로 같은 주장"
        count={content.equivalentStatements.length}
        empty="표현만 다른 같은 주장으로 기록된 항목이 없습니다."
      >
        <ul className="flex flex-col gap-2">
          {content.equivalentStatements.map((e, i) => (
            <li key={i} data-item="equivalent" className="rounded-xl border border-slate-200 p-3 text-sm leading-6">
              <p className="mb-2 font-semibold text-slate-900">공통 의미: {e.meaning}</p>
              <div className="grid gap-2 md:grid-cols-2">
                <Side id="gpt" label="표현" text={e.gptWording} />
                <Side id="claude" label="표현" text={e.claudeWording} />
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        id="undetermined"
        title="판단이 어려운 항목"
        note="한쪽 입장이 기록에서 확인되지 않거나, 대화 기록만으로는 차이 여부나 옳고 그름을 정할 수 없음 (전체 관계 판정에는 쓰지 않음)"
        count={content.undetermined.length}
        empty="판단이 어려운 항목으로 기록된 것이 없습니다."
      >
        <ul className="flex flex-col gap-2">
          {content.undetermined.map((u, i) => (
            <li key={i} data-item="undetermined" className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-sm leading-6">
              <p className="font-semibold text-slate-900">{u.issue}</p>
              <p className="text-slate-700">
                <span className="text-slate-500">필요한 근거:</span> {u.missingEvidence}
              </p>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        id="verification"
        title="추가 검증이 필요한 내용"
        note="합의 여부와 관계없이 외부 자료로 확인해야 할 사항"
        count={content.verificationNeeded.length}
        empty="없음"
      >
        <Bullets items={content.verificationNeeded} />
      </Section>
    </>
  );
}

/** 해소 시점 표시. 서버 검증과 같은 기준(resolutionTarget) + 실제 transcript 존재 여부를 모두 확인한 경우에만 링크한다. */
function ResolvedWhere({
  item,
  transcript,
  rounds,
}: {
  item: ResolvedDisagreement;
  transcript: DialogueTranscriptEntry[];
  rounds: RoundCount;
}) {
  const target = resolutionTarget(item.resolvedStage, item.resolvedAtIndex, rounds);
  const entryAt = (index: number) => transcript.find((t) => t.index === index);
  let link: { href: string; text: string; target: string } | null = null;

  if (target?.kind === "turn") {
    const e = entryAt(target.index);
    if (e && e.kind === "reply") link = { href: `#dialogue-turn-${e.index}`, text: `#${e.index} ${name(e.speaker)} 응답에서 해소`, target: `turn-${e.index}` };
  } else if (target?.kind === "closing") {
    const e = entryAt(target.index);
    if (e && e.kind === "closing") link = { href: `#dialogue-turn-${e.index}`, text: `#${e.index} ${name(e.speaker)} 마무리에서 해소`, target: `turn-${e.index}` };
  } else if (target?.kind === "closings") {
    const both = transcript.filter((t) => t.kind === "closing");
    if (both.length === MODEL_IDS.length) {
      link = { href: "#dialogue-conclusion-title", text: `두 마무리(#${both.map((t) => t.index).join(" · #")})를 함께 보면 해소`, target: "closings" };
    }
  }

  return link ? (
    <p className="mt-1 text-xs">
      <a href={link.href} data-resolved-target={link.target} className="font-medium text-indigo-700 underline underline-offset-2 hover:text-indigo-500">
        {link.text}
      </a>
    </p>
  ) : (
    <p className="mt-1 text-xs text-slate-400" data-resolved-target="unknown">
      해소 시점을 확인할 수 없습니다 (대화 기록과 맞지 않는 위치).
    </p>
  );
}

function Side({ id, label, text }: { id: ModelId; label: string; text: string }) {
  return (
    <div data-side={id} className={`rounded-lg border-l-4 bg-white px-3 py-2 ${id === "gpt" ? "border-l-emerald-500" : "border-l-orange-500"}`}>
      <p className="text-xs font-semibold text-slate-500">
        {name(id)} {label}
      </p>
      <p className="whitespace-pre-line text-slate-800">{text}</p>
    </div>
  );
}

function Section({
  id,
  title,
  note,
  count,
  empty,
  children,
}: {
  id: string;
  title: string;
  note?: string;
  count: number;
  empty: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2" data-section={`cmp-${id}`} data-count={count}>
      <h3 className="text-sm font-semibold text-slate-700">
        {title}
        {count > 0 && <span className="font-normal text-slate-400"> · {count}개</span>}
        {note && <span className="font-normal text-slate-400"> · {note}</span>}
      </h3>
      {count > 0 ? children : <p className="text-sm text-slate-400">{empty}</p>}
    </div>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="flex list-disc flex-col gap-1 pl-5 text-[15px] leading-7 text-slate-800">
      {items.map((x, i) => (
        <li key={i}>{x}</li>
      ))}
    </ul>
  );
}

function StatusLine({ tone, children }: { tone: "muted" | "info" | "error"; children: React.ReactNode }) {
  const cls =
    tone === "error"
      ? "border-red-300 bg-red-50 text-red-800"
      : tone === "info"
        ? "border-indigo-200 bg-indigo-50 text-indigo-800"
        : "border-slate-200 bg-slate-50 text-slate-600";
  return (
    <p role="status" className={`rounded-xl border px-4 py-3 text-sm leading-6 ${cls}`}>
      {children}
    </p>
  );
}
