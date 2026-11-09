"use client";

// 화면에서 "상태"를 가진 유일한 컴포넌트.
// 입력값, 검증 오류, 두 결과 패널의 상태를 관리하고 폼과 패널에 내려준다.
// "use client"는 useState와 이벤트 처리를 위해 필요하며, 이 파일에만 둔다.

import { useState } from "react";
import type {
  DebatePurpose,
  DebateRequest,
  ModelId,
  PanelState,
  RoundCount,
} from "@/types/debate";
import {
  DEFAULT_ROUNDS,
  getPurposeLabel,
  validateTopic,
} from "@/lib/debate/config";
import DebateForm from "./DebateForm";
import ResultPanel from "./ResultPanel";

const IDLE: PanelState = { status: "idle" };

const NOT_CONNECTED_MESSAGE =
  "AI API가 아직 연결되지 않아 분석을 요청하지 않았습니다. 입력한 내용은 위 '요청 내용'에서 확인할 수 있습니다.";

export default function DebateWorkspace() {
  const [topic, setTopic] = useState("");
  const [purpose, setPurpose] = useState<DebatePurpose>("idea_validation");
  const [rounds, setRounds] = useState<RoundCount>(DEFAULT_ROUNDS);
  const [topicError, setTopicError] = useState<string | null>(null);
  const [lastRequest, setLastRequest] = useState<DebateRequest | null>(null);
  const [panels, setPanels] = useState<Record<ModelId, PanelState>>({
    gpt: IDLE,
    claude: IDLE,
  });

  // 한쪽이라도 분석 중이면 버튼을 비활성화해 중복 요청을 막는다.
  const isSubmitting =
    panels.gpt.status === "loading" || panels.claude.status === "loading";

  function handleTopicChange(value: string) {
    setTopic(value);
    // 이미 오류가 표시된 상태라면 입력하는 동안 다시 검사해 오류를 바로 지운다.
    if (topicError) setTopicError(validateTopic(value));
  }

  function handleSubmit() {
    const error = validateTopic(topic);
    setTopicError(error);
    if (error) return;

    const request: DebateRequest = { topic: topic.trim(), purpose, rounds };
    setLastRequest(request);

    // Phase 3에서는 이 자리에서 서버 API(/api/analyze)를 호출하고
    // 패널을 loading → 결과 또는 error 상태로 바꾼다.
    // 지금은 API가 없으므로 호출하지 않고 미연결 상태만 표시한다.
    setPanels({
      gpt: { status: "not_connected", message: NOT_CONNECTED_MESSAGE },
      claude: { status: "not_connected", message: NOT_CONNECTED_MESSAGE },
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <DebateForm
        topic={topic}
        purpose={purpose}
        rounds={rounds}
        topicError={topicError}
        isSubmitting={isSubmitting}
        onTopicChange={handleTopicChange}
        onPurposeChange={setPurpose}
        onRoundsChange={setRounds}
        onSubmit={handleSubmit}
      />

      {lastRequest && (
        <section
          aria-label="요청 내용"
          className="rounded-xl border border-white/10 bg-white/5 px-5 py-4 text-sm text-slate-300"
        >
          <p className="mb-2 font-semibold text-white">요청 내용</p>
          <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[auto_1fr]">
            <dt className="text-slate-400">목적</dt>
            <dd>{getPurposeLabel(lastRequest.purpose)}</dd>
            <dt className="text-slate-400">라운드</dt>
            <dd>{lastRequest.rounds}회</dd>
            <dt className="text-slate-400">주제</dt>
            <dd className="whitespace-pre-wrap break-words">
              {lastRequest.topic}
            </dd>
          </dl>
        </section>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <ResultPanel model="gpt" state={panels.gpt} />
        <ResultPanel model="claude" state={panels.claude} />
      </div>
    </div>
  );
}
