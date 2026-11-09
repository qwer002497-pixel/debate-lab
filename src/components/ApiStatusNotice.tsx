// 현재 구현 범위와 비용 발생 사실을 화면 상단에 표시한다.
// Phase 4(상호 반론)가 구현되면 문구를 갱신한다.

export default function ApiStatusNotice() {
  return (
    <div
      role="note"
      className="flex items-start gap-3 rounded-xl border border-sky-400/30 bg-sky-400/10 px-4 py-3 text-sm text-sky-100"
    >
      <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-sky-400" />
      <p className="leading-6">
        <strong className="font-semibold text-sky-300">현재 단계: 독립 분석</strong>{" "}
        — GPT와 Claude가 서로의 답변을 보지 않고 각자 분석합니다. 상호 반론과
        최종 보고서는 아직 구현되지 않았습니다.{" "}
        <strong className="font-semibold">
          분석 시작을 누를 때마다 두 API가 각각 1회 호출되어 비용이 발생합니다.
        </strong>
      </p>
    </div>
  );
}
