// 대화형 토론 화면 (요청 내용 · 진행 상황 · 비용 · 시간순 발언 · 최종 결과 · 최종 비교).
// 상태는 갖지 않고 useDialogueSession의 결과만 받는다. 세션 자체는 DebateWorkspace가 유지하므로
// 모드를 바꿔 이 화면이 사라졌다 다시 나타나도 진행 상황과 비용 기록은 보존된다.

import { getPurposeLabel, MODEL_IDS } from "@/lib/debate/config";
import { buildSchedule } from "@/lib/dialogue/sequence";
import { selectUsage, type DialogueTurnState } from "@/lib/dialogue/session";
import type { UseDialogueSession } from "@/lib/dialogue/useDialogueSession";
import DebateStats from "./DebateStats";
import DialogueComparison from "./DialogueComparison";
import DialogueConclusion from "./DialogueConclusion";
import DialogueProgress from "./DialogueProgress";
import DialogueTurnCard, { turnLabel } from "./DialogueTurnCard";
import { MODEL_META } from "./ModelPanel";

export default function DialogueDebateView({ session }: { session: UseDialogueSession }) {
  const { state } = session;
  const request = state.request;

  if (!request) {
    return (
      <section className="rounded-2xl border border-dashed border-white/15 bg-white/5 px-5 py-8 text-center text-sm leading-6 text-slate-400">
        주제를 입력하고 토론 시작을 누르면 GPT와 Claude가 각자 첫 의견을 낸 뒤 번갈아 대화합니다.
        <br />
        발언은 이곳에 시간순으로 표시됩니다.
      </section>
    );
  }

  const turns = Object.values(state.turns).sort((a, b) => a.index - b.index);
  const replyNumbers = new Map<number, number>();
  if (state.firstSpeaker) {
    for (const id of MODEL_IDS) {
      buildSchedule({ rounds: request.rounds, firstSpeaker: state.firstSpeaker })
        .filter((s) => s.kind === "reply" && s.speaker === id)
        .forEach((s, i) => replyNumbers.set(s.index, i + 1));
    }
  }
  const usage = selectUsage(state);
  // 비교 담당을 알기 전에 유실된 최종 비교 호출: 어느 모델 비용인지 알 수 없으므로 모델별로 나누지 않는다.
  const unknownComparator = state.unverifiedCalls.filter((c) => c.kind === "comparison" && c.speaker === null).length;
  const comparisonReported = usage.comparison.ledger.succeeded + usage.comparison.ledger.failed;
  const label = (t: DialogueTurnState) => turnLabel(t, replyNumbers.get(t.index) ?? null, request.rounds);

  return (
    <>
      <section aria-label="요청 내용" className="rounded-xl border border-white/10 bg-white/5 px-5 py-4 text-sm text-slate-300">
        <p className="mb-2 font-semibold text-white">요청 내용 · 대화형</p>
        <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[auto_1fr]">
          <dt className="text-slate-400">목적</dt>
          <dd>{getPurposeLabel(request.purpose)}</dd>
          <dt className="text-slate-400">응답 횟수</dt>
          <dd>
            모델별 {request.rounds}회 (모델 호출 총 {state.plannedCalls}회{state.comparison ? ", 최종 비교 1회 포함" : ""})
          </dd>
          <dt className="text-slate-400">첫 응답</dt>
          <dd>{state.firstSpeaker ? `${MODEL_META[state.firstSpeaker].name} (서버가 무작위로 결정)` : "첫 의견 이후 결정"}</dd>
          <dt className="text-slate-400">주제</dt>
          <dd className="whitespace-pre-wrap break-words">{request.topic}</dd>
        </dl>
      </section>

      <DialogueProgress
        state={state}
        onPause={session.pause}
        onResume={session.resume}
        onRetry={session.retry}
        onStop={session.stop}
      />

      <div className="flex flex-col gap-2">
        <DebateStats ledger={state.ledger} plannedCalls={state.plannedCalls} elapsedMs={state.elapsedMs} />
        {state.comparison && (state.comparison.attempts > 0 || usage.comparison.unverifiedCalls > 0) && (
          <p data-field="comparison-cost" className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-xs leading-5 text-slate-300">
            <strong className="font-semibold text-white">그중 최종 비교</strong>
            {state.comparison.comparator ? ` (비교 담당 ${MODEL_META[state.comparison.comparator].name})` : ""}:{" "}
            {comparisonReported > 0 ? (
              <>
                사용량 보고 {comparisonReported}회 (성공 {usage.comparison.ledger.succeeded} / 실패 {usage.comparison.ledger.failed}) · 입력{" "}
                {usage.comparison.ledger.inputTokens.toLocaleString()} · 출력 {usage.comparison.ledger.outputTokens.toLocaleString()} ·
                예상 비용 ${usage.comparison.ledger.costUsd.toFixed(4)} — 위 모델별·합계에 이미 포함된 값이며 따로 더하지 않습니다.
              </>
            ) : (
              <>사용량을 보고받은 호출이 아직 없습니다.</>
            )}
            {usage.comparison.unverifiedCalls > 0 && (
              <> 비용 확인 불가 {usage.comparison.unverifiedCalls}회는 금액을 알 수 없어 포함하지 않았으며, 0원으로 간주하지 않습니다.</>
            )}
          </p>
        )}
        {usage.total.unverifiedCalls > 0 && (
          <p role="note" className="rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-xs leading-5 text-amber-100">
            <strong className="font-semibold">비용 확인 불가 호출 {usage.total.unverifiedCalls}회</strong> (
            {MODEL_IDS.map((id) => `${MODEL_META[id].name} ${usage.byModel[id].unverifiedCalls}회`).join(" · ")}
            {unknownComparator > 0 ? ` · 비교 담당 미확인 ${unknownComparator}회` : ""}
            {usage.comparison.unverifiedCalls > 0 ? `, 그중 최종 비교 ${usage.comparison.unverifiedCalls}회` : ""}) — 응답을
            받지 못해 실제 과금 여부를 알 수 없습니다. 위 예상 비용에는 포함되지 않았으며, 0원으로 간주하지 않습니다.
          </p>
        )}
      </div>

      <section aria-labelledby="dialogue-transcript-heading" className="flex flex-col gap-3">
        <h2 id="dialogue-transcript-heading" className="text-base font-semibold text-white">
          대화 기록{" "}
          <span className="text-sm font-normal text-slate-400">
            · 시간순 · <span className="text-emerald-300">GPT</span> 왼쪽 / <span className="text-orange-300">Claude</span> 오른쪽
          </span>
        </h2>
        <div className="flex flex-col gap-4">
          {turns.map((t) => (
            <DialogueTurnCard key={t.index} turn={t} label={label(t)} />
          ))}
        </div>
      </section>

      <DialogueConclusion state={state} />

      <DialogueComparison state={state} onRetry={session.retry} />
    </>
  );
}
