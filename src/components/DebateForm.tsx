// 주제 입력, 토론 목적, 라운드 선택, 토론 시작 버튼.
// 상태를 직접 갖지 않고 props로만 동작한다(값은 DebateWorkspace가 관리).
// 이렇게 하면 폼은 "어떻게 보이는가"만, Workspace는 "무엇을 할 것인가"만 책임진다.

import type { FormEvent } from "react";
import type { DebatePurpose, RoundCount } from "@/types/debate";
import {
  PURPOSE_OPTIONS,
  ROUND_OPTIONS,
  TOPIC_MAX_LENGTH,
  totalModelCalls,
} from "@/lib/debate/config";
import { dialogueModelCalls } from "@/lib/dialogue/config";

interface DebateFormProps {
  /** 라운드 라벨과 호출 수 안내만 모드에 따라 바뀐다 (기본: 분석형, 분석형 화면은 기존과 동일) */
  mode?: "analysis" | "dialogue";
  topic: string;
  purpose: DebatePurpose;
  rounds: RoundCount;
  topicError: string | null;
  isSubmitting: boolean;
  onTopicChange: (value: string) => void;
  onPurposeChange: (value: DebatePurpose) => void;
  onRoundsChange: (value: RoundCount) => void;
  onSubmit: () => void;
}

const optionCardClass =
  "flex cursor-pointer flex-col gap-1 rounded-xl border border-slate-200 bg-white transition-colors hover:border-slate-300 has-[:checked]:border-indigo-500 has-[:checked]:bg-indigo-50 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-indigo-400";

export default function DebateForm({
  mode = "analysis",
  topic,
  purpose,
  rounds,
  topicError,
  isSubmitting,
  onTopicChange,
  onPurposeChange,
  onRoundsChange,
  onSubmit,
}: DebateFormProps) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); // 페이지 새로고침 방지
    if (isSubmitting) return; // 중복 제출 방지
    onSubmit();
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="flex flex-col gap-7 rounded-2xl bg-white p-5 text-slate-900 shadow-xl shadow-black/20 sm:p-7"
    >
      {/* 1. 주제 입력 */}
      <div className="flex flex-col gap-2">
        <label htmlFor="topic" className="text-sm font-semibold">
          검증할 주제 또는 아이디어
        </label>
        <textarea
          id="topic"
          value={topic}
          onChange={(e) => onTopicChange(e.target.value)}
          maxLength={TOPIC_MAX_LENGTH}
          rows={5}
          placeholder="예: 대학 강의에 AI 튜터를 전면 도입하면 학습 효과가 높아질까?"
          aria-invalid={topicError ? true : undefined}
          aria-describedby="topic-help"
          className={`w-full resize-y rounded-xl border bg-slate-50 px-4 py-3 text-base leading-7 outline-none transition-colors placeholder:text-slate-400 focus:bg-white focus:ring-2 ${
            topicError
              ? "border-red-400 focus:ring-red-300"
              : "border-slate-200 focus:border-indigo-400 focus:ring-indigo-200"
          }`}
        />
        <div
          id="topic-help"
          className="flex items-start justify-between gap-4 text-sm"
        >
          {topicError ? (
            <p role="alert" className="text-red-600">
              {topicError}
            </p>
          ) : (
            <p className="text-slate-500">
              구체적으로 적을수록 쟁점이 분명해집니다.
            </p>
          )}
          <span className="shrink-0 font-mono text-xs text-slate-400">
            {topic.length} / {TOPIC_MAX_LENGTH}
          </span>
        </div>
      </div>

      {/* 2. 토론 목적 */}
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-3 text-sm font-semibold">토론 목적</legend>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {PURPOSE_OPTIONS.map((option) => (
            <label
              key={option.value}
              className={`${optionCardClass} px-4 py-3`}
            >
              <input
                type="radio"
                name="purpose"
                value={option.value}
                checked={purpose === option.value}
                onChange={() => onPurposeChange(option.value)}
                className="sr-only"
              />
              <span className="text-sm font-semibold">{option.label}</span>
              <span className="text-xs leading-5 text-slate-500">
                {option.description}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {/* 3. 라운드 선택 + 시작 버튼 */}
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <fieldset className="flex flex-col">
          <legend className="mb-3 text-sm font-semibold">
            {mode === "dialogue" ? "모델별 응답 횟수" : "상호 검토 라운드"}
          </legend>
          <div className="flex gap-2">
            {ROUND_OPTIONS.map((value) => (
              <label
                key={value}
                className={`${optionCardClass} min-w-16 items-center px-4 py-2`}
              >
                <input
                  type="radio"
                  name="rounds"
                  value={value}
                  checked={rounds === value}
                  onChange={() => onRoundsChange(value)}
                  className="sr-only"
                />
                <span className="text-sm font-semibold">{value}회</span>
              </label>
            ))}
          </div>
          {mode === "dialogue" ? (
            <p className="mt-2 text-xs text-slate-500">
              첫 의견 2회 + 응답 {rounds * 2}회 + 마무리 2회 + 최종 비교 1회 = 모델 호출 총 {dialogueModelCalls(rounds) + 1}회. 응답은 한 번에 한 모델씩 진행되어 분석형보다 오래 걸립니다.
            </p>
          ) : (
            <p className="mt-2 text-xs text-slate-500">
              최초 분석 2회 + 라운드당 2회 = 모델 호출 총 {totalModelCalls(rounds)}회. 라운드가 많을수록 비용과 시간이 늘어납니다.
            </p>
          )}
        </fieldset>

        <button
          type="submit"
          disabled={isSubmitting}
          className="h-12 rounded-xl bg-indigo-600 px-8 text-base font-semibold text-white transition-colors hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {isSubmitting ? "토론 진행 중…" : "토론 시작"}
        </button>
      </div>
    </form>
  );
}
