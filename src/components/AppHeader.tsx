// 서비스 제목과 설명. 상태가 없으므로 서버 컴포넌트로 둔다(브라우저로 JS를 보내지 않음).

const FLOW_STEPS = ["독립 분석", "상호 반론", "재검토", "최종 보고서"];

export default function AppHeader() {
  return (
    <header className="flex flex-col gap-5">
      <span className="w-fit rounded-full border border-sky-400/30 bg-sky-400/10 px-3 py-1 text-xs font-medium text-sky-300">
        실험 프로젝트
      </span>
      <div className="flex flex-col gap-3">
        <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
          AI Debate Lab
        </h1>
        <p className="max-w-2xl text-base leading-7 text-slate-300">
          주제를 입력하면 GPT와 Claude가 각자 독립적으로 분석한 뒤 서로의 주장을
          검토하고 반박합니다. 합의한 내용, 끝까지 남은 의견 차이, 논리적 허점을
          정리해 하나의 AI만으로는 놓칠 수 있는 문제를 찾는 것이 목표입니다.
        </p>
      </div>
      <ol className="flex flex-wrap items-center gap-2 text-sm text-slate-400">
        {FLOW_STEPS.map((step, index) => (
          <li key={step} className="flex items-center gap-2">
            <span className="flex items-center gap-2 rounded-md bg-white/5 px-2.5 py-1">
              <span className="font-mono text-xs text-slate-500">
                {index + 1}
              </span>
              {step}
            </span>
            {index < FLOW_STEPS.length - 1 && (
              <span aria-hidden className="text-slate-600">
                →
              </span>
            )}
          </li>
        ))}
      </ol>
    </header>
  );
}
