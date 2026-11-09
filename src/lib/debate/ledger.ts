// 누적 사용량 장부 (분석형·대화형 공통).
// 재시도하면 화면의 칸은 새 결과로 덮어쓰지만, 이전 시도도 과금되었을 수 있으므로
// 호출 결과가 도착할 때마다 장부에 더한다. (Phase 4 useDebateSession.ts에서 그대로 옮김)

import type { ModelId, ModelTurn } from "@/types/debate";

export interface UsageLedger {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  succeeded: number;
  failed: number;
}

export const emptyLedger = (): UsageLedger => ({
  inputTokens: 0,
  outputTokens: 0,
  costUsd: 0,
  succeeded: 0,
  failed: 0,
});

export function addToLedger(ledger: UsageLedger, turn: ModelTurn<object>): UsageLedger {
  return {
    inputTokens: ledger.inputTokens + (turn.usage?.inputTokens ?? 0),
    outputTokens: ledger.outputTokens + (turn.usage?.outputTokens ?? 0),
    costUsd: ledger.costUsd + (turn.estimatedCostUsd ?? 0),
    succeeded: ledger.succeeded + (turn.status === "success" ? 1 : 0),
    failed: ledger.failed + (turn.status === "error" ? 1 : 0),
  };
}

/** 모델별 장부를 합친다 (화면의 "합계" 행). */
export function sumLedgers(ledgers: Record<ModelId, UsageLedger>): UsageLedger {
  return Object.values(ledgers).reduce<UsageLedger>(
    (sum, l) => ({
      inputTokens: sum.inputTokens + l.inputTokens,
      outputTokens: sum.outputTokens + l.outputTokens,
      costUsd: sum.costUsd + l.costUsd,
      succeeded: sum.succeeded + l.succeeded,
      failed: sum.failed + l.failed,
    }),
    emptyLedger(),
  );
}
