// 단계(최초 분석 또는 라운드)의 두 모델 칸 상태를 하나의 단계 상태로 요약한다.

import type { Slot } from "@/lib/debate/useDebateSession";
import type { ModelId, ModelTurn } from "@/types/debate";

export type StageStatus = "waiting" | "running" | "done" | "partial" | "failed";

export function stageStatus(turns: Record<ModelId, Slot<ModelTurn<object>>>): StageStatus {
  const slots = Object.values(turns);
  if (slots.some((s) => s.status === "loading")) return "running";
  if (slots.every((s) => s.status === "idle")) return "waiting";
  const ok = slots.filter((s) => s.status === "done" && s.turn.status === "success").length;
  if (ok === slots.length) return "done";
  if (ok === 0 && slots.every((s) => s.status === "done")) return "failed";
  return "partial";
}

export const STAGE_STATUS_STYLE: Record<StageStatus, { label: string; className: string }> = {
  waiting: { label: "대기", className: "bg-white/10 text-slate-300" },
  running: { label: "진행 중", className: "bg-indigo-400/20 text-indigo-200" },
  done: { label: "완료", className: "bg-emerald-400/20 text-emerald-200" },
  partial: { label: "부분 실패", className: "bg-amber-400/20 text-amber-200" },
  failed: { label: "실패", className: "bg-red-400/20 text-red-200" },
};
