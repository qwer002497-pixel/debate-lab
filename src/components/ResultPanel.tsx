// 최초 분석 결과 패널. GPT와 Claude가 같은 컴포넌트를 쓰고 model prop으로만 구분한다.
// 상태(대기/로딩/미연결/오류/성공)마다 다른 화면을 보여준다. 공통 틀은 ModelPanel.tsx.

import type { ModelId, PanelState } from "@/types/debate";
import {
  MODEL_META,
  ModelPanelShell,
  PanelLoading,
  PanelMessage,
  TruncatedNotice,
  TurnMetrics,
  type BadgeKind,
} from "./ModelPanel";

const BADGE_LABEL: Record<PanelState["status"], string> = {
  idle: "대기 중",
  loading: "분석 중",
  not_connected: "API 미연결",
  error: "오류",
  success: "분석 완료",
};

interface ResultPanelProps {
  model: ModelId;
  state: PanelState;
}

export default function ResultPanel({ model, state }: ResultPanelProps) {
  const name = MODEL_META[model].name;
  return (
    <ModelPanelShell
      model={model}
      panelId={`initial-${model}`}
      subtitle="독립 분석"
      modelIdLabel={state.status === "success" ? state.model : undefined}
      badge={{ kind: state.status as BadgeKind, label: BADGE_LABEL[state.status] }}
    >
      <PanelBody name={name} state={state} />
    </ModelPanelShell>
  );
}

function PanelBody({ name, state }: { name: string; state: PanelState }) {
  switch (state.status) {
    case "idle":
      return (
        <div className="m-auto max-w-xs text-center text-sm leading-6 text-slate-500">
          주제를 입력하고 토론을 시작하면 이곳에 {name}의 독립 분석이 표시됩니다.
        </div>
      );
    case "loading":
      return <PanelLoading message={`${name}가 분석하고 있습니다…`} />;
    case "not_connected":
      return <PanelMessage tone="warning" title="분석이 실행되지 않았습니다" message={state.message} />;
    case "error":
      return <PanelMessage tone="error" title="분석 중 오류가 발생했습니다" message={state.message} />;
    case "success":
      return (
        <div className="flex flex-col gap-4">
          {state.truncated && <TruncatedNotice />}
          {/* 모델 응답은 일반 텍스트로만 렌더링한다(HTML로 해석하지 않음). */}
          <div className="whitespace-pre-wrap text-[15px] leading-7 text-slate-800">{state.text}</div>
          <TurnMetrics
            usage={state.usage}
            estimatedCostUsd={state.estimatedCostUsd}
            durationMs={state.durationMs}
          />
        </div>
      );
  }
}
