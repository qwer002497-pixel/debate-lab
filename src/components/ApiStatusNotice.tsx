// 현재 구현 범위와 비용 발생 사실을 화면 상단에 표시한다.
// Phase 5(최종 보고서)가 구현되면 문구를 갱신한다.

export default function ApiStatusNotice() {
  return (
    <div
      role="note"
      className="flex items-start gap-3 rounded-xl border border-sky-400/30 bg-sky-400/10 px-4 py-3 text-sm text-sky-100"
    >
      <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-sky-400" />
      <p className="leading-6">
        <strong className="font-semibold text-sky-300">현재 단계: 독립 분석 + 상호 반론</strong>{" "}
        — GPT와 Claude가 먼저 각자 분석한 뒤, 선택한 라운드만큼 서로의 주장을 검토합니다. 종합
        보고서와 결과 저장은 아직 구현되지 않았습니다.{" "}
        <strong className="font-semibold">
          모델 호출마다 비용이 발생합니다 (2라운드 6회 · 3라운드 8회 · 5라운드 12회).
        </strong>
      </p>
    </div>
  );
}
