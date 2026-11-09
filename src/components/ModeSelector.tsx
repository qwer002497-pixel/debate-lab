// 토론 모드 선택 (분석형 / 대화형). 두 모드의 세션은 DebateWorkspace가 모두 유지하므로
// 모드를 바꿔도 다른 모드의 결과는 사라지지 않는다. 진행 중에는 실수로 바꾸지 않도록 비활성화한다.

export type DebateMode = "analysis" | "dialogue";

const MODES: { value: DebateMode; label: string; description: string }[] = [
  {
    value: "analysis",
    label: "분석형 토론",
    description: "각자 독립 분석한 뒤, 라운드마다 구조화된 형식으로 서로의 주장을 검토합니다.",
  },
  {
    value: "dialogue",
    label: "대화형 토론",
    description: "각자 첫 의견을 낸 뒤, 번갈아 상대의 직전 발언에 답하고 마지막에 각자 정리합니다.",
  },
];

export default function ModeSelector({
  mode,
  disabled,
  onChange,
}: {
  mode: DebateMode;
  disabled: boolean;
  onChange: (mode: DebateMode) => void;
}) {
  return (
    <fieldset aria-label="토론 모드" className="flex flex-col gap-2" disabled={disabled}>
      <legend className="sr-only">토론 모드</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        {MODES.map((m) => (
          <label
            key={m.value}
            className="flex cursor-pointer flex-col gap-1 rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-slate-200 transition-colors hover:border-white/30 has-[:checked]:border-sky-400 has-[:checked]:bg-sky-400/10 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-sky-400"
          >
            <input
              type="radio"
              name="mode"
              value={m.value}
              checked={mode === m.value}
              onChange={() => onChange(m.value)}
              className="sr-only"
            />
            <span className="text-sm font-semibold text-white">{m.label}</span>
            <span className="text-xs leading-5 text-slate-400">{m.description}</span>
          </label>
        ))}
      </div>
      {disabled && (
        <p className="text-xs text-slate-400">
          토론이 진행 중일 때는 모드를 바꿀 수 없습니다. 일시정지하거나 끝난 뒤 바꿔 주세요.
        </p>
      )}
    </fieldset>
  );
}
