// AI API가 아직 연결되지 않았다는 사실을 화면 상단에 항상 표시한다.
// Phase 3에서 API를 연결하면 이 안내는 제거하거나 실제 연결 상태를 보여주도록 바꾼다.

export default function ApiStatusNotice() {
  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100"
    >
      <span
        aria-hidden
        className="mt-1.5 size-2 shrink-0 rounded-full bg-amber-400"
      />
      <p className="leading-6">
        <strong className="font-semibold text-amber-300">API 미연결 상태</strong>{" "}
        — 화면 구성 단계입니다. OpenAI·Anthropic API가 아직 연결되지 않아{" "}
        <strong className="font-semibold">분석 시작을 눌러도 AI가 호출되지 않으며</strong>,
        결과 패널에 AI 답변이 표시되지 않습니다.
      </p>
    </div>
  );
}
