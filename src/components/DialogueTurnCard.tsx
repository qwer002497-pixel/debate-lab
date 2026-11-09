// 대화형 토론의 발언 카드 1개 (opening·reply·closing).
// message가 가장 잘 보이도록 크게, 인정한 점·남은 쟁점은 내용이 있을 때만 작게 보조 정보로 표시한다.
// GPT는 왼쪽, Claude는 오른쪽(데스크톱)으로 정렬하고 색으로도 구분한다. 모바일은 세로 목록.

import type { DialogueTurnState } from "@/lib/dialogue/session";
import type { ModelId } from "@/types/debate";
import type { ClosingContent, SpeechContent } from "@/types/dialogue";
import { MODEL_META, PanelLoading, TruncatedNotice, TurnMetrics } from "./ModelPanel";

const SIDE: Record<ModelId, { align: string; border: string; chip: string }> = {
  gpt: { align: "md:self-start", border: "border-l-emerald-500", chip: "bg-emerald-50 text-emerald-800" },
  claude: { align: "md:self-end", border: "border-l-orange-500", chip: "bg-orange-50 text-orange-800" },
};

export function turnLabel(turn: Pick<DialogueTurnState, "kind">, replyNumber: number | null, rounds: number): string {
  if (turn.kind === "opening") return "첫 의견";
  if (turn.kind === "closing") return "마무리";
  return replyNumber ? `응답 ${replyNumber}/${rounds}` : "응답";
}

export default function DialogueTurnCard({
  turn,
  label,
}: {
  turn: DialogueTurnState;
  label: string;
}) {
  const meta = MODEL_META[turn.speaker];
  const side = SIDE[turn.speaker];
  const result = turn.turn?.status === "success" ? turn.turn : null;

  return (
    <article
      id={`dialogue-turn-${turn.index}`}
      aria-label={`#${turn.index} ${meta.name} ${label}`}
      data-index={turn.index}
      data-speaker={turn.speaker}
      className={`w-full rounded-2xl border-l-4 bg-white text-slate-900 shadow-lg shadow-black/20 md:w-[88%] ${side.align} ${side.border}`}
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className={`flex size-7 items-center justify-center rounded-md text-xs font-bold text-white ${meta.avatarClass}`}
          >
            {meta.name[0]}
          </span>
          <span className="font-semibold">{meta.name}</span>
          <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${side.chip}`}>{label}</span>
          <span className="font-mono text-xs text-slate-400">#{turn.index}</span>
        </div>
        <TurnStatus turn={turn} />
      </header>

      <div className="flex flex-col gap-3 px-4 py-4">
        {turn.status === "loading" && <PanelLoading message={`${meta.name}가 ${label}을(를) 작성하고 있습니다…`} />}

        {turn.status === "error" && (
          <div role="alert" className="flex flex-col gap-1 rounded-xl border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-900">
            <p className="font-semibold">이 발언을 받지 못했습니다 (시도 {turn.attempts}회)</p>
            <p>{turn.error?.message}</p>
            {turn.costUnknown && (
              <p className="text-xs text-amber-800">
                응답을 받지 못해 이 시도의 과금 여부를 알 수 없습니다 (비용 확인 불가).
              </p>
            )}
          </div>
        )}

        {result && turn.kind !== "closing" && <SpeechBody content={result.content as SpeechContent} />}
        {result && turn.kind === "closing" && (
          <p className="whitespace-pre-wrap text-[15px] leading-7 text-slate-800">
            {(result.content as ClosingContent).finalPosition}
          </p>
        )}
        {result?.truncated && <TruncatedNotice />}

        {/* 성공·실패 모두 서버가 보고한 사용량이 있으면 표시 (실패했지만 과금된 경우 포함) */}
        {turn.turn?.usage && turn.status !== "loading" && (
          <TurnMetrics
            usage={turn.turn.usage}
            estimatedCostUsd={turn.turn.estimatedCostUsd}
            durationMs={turn.turn.durationMs}
          />
        )}
      </div>
    </article>
  );
}

function SpeechBody({ content }: { content: SpeechContent }) {
  return (
    <>
      {/* 모델 응답은 일반 텍스트로만 렌더링한다(HTML로 해석하지 않음). */}
      <p className="whitespace-pre-wrap text-[15px] leading-7 text-slate-800">{content.message}</p>
      {content.acknowledged.length > 0 && <AuxList title="인정한 점" items={content.acknowledged} />}
      {content.openIssues.length > 0 && <AuxList title="남은 쟁점" items={content.openIssues} />}
    </>
  );
}

function AuxList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-600">
      <p className="mb-0.5 text-xs font-semibold text-slate-500">{title}</p>
      <ul className="flex list-disc flex-col gap-0.5 pl-5">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function TurnStatus({ turn }: { turn: DialogueTurnState }) {
  const map = {
    loading: { label: "작성 중", cls: "bg-indigo-100 text-indigo-700" },
    success: { label: "완료", cls: "bg-emerald-100 text-emerald-800" },
    error: { label: turn.costUnknown ? "실패 · 비용 확인 불가" : "실패", cls: "bg-red-100 text-red-700" },
  } as const;
  const s = map[turn.status];
  return (
    <span className={`flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${s.cls}`}>
      {turn.status === "loading" && (
        <span aria-hidden className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
      )}
      {s.label}
    </span>
  );
}
