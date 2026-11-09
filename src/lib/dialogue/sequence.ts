// 대화형 토론의 발언 순서 규칙 (순수 함수, 서버·클라이언트 공용).
// - 클라이언트: "다음에 무엇을 요청할지" 계산
// - 서버: 받은 요청이 정확히 다음 차례인지 검증
// 같은 함수를 쓰므로 양쪽의 순서 규칙이 어긋날 수 없다. 무작위 선정은 여기서 하지 않는다.

import { MODEL_IDS } from "@/lib/debate/config";
import type { ModelId, RoundCount } from "@/types/debate";
import type {
  DialogueConfig,
  DialogueSlot,
  DialogueTurnKey,
  DialogueTurnKind,
} from "@/types/dialogue";

/** 전체 발언 수 = 모델 호출 수 (opening 2 + reply 2N + closing 2) */
export function dialogueTurnCount(rounds: RoundCount): number {
  return 2 * rounds + 4;
}

export function otherModel(id: ModelId): ModelId {
  return id === "gpt" ? "claude" : "gpt";
}

/** 전체 일정표: index 0부터 2N+3까지 각 칸의 종류·발언자·소속 단계 */
export function buildSchedule({ rounds, firstSpeaker }: DialogueConfig): DialogueSlot[] {
  const slots: DialogueSlot[] = [];
  // 병렬 단계 안의 자리는 MODEL_IDS 순서(gpt → claude)로 고정
  MODEL_IDS.forEach((speaker, i) => slots.push({ index: i, kind: "opening", speaker, step: 0 }));
  for (let k = 0; k < rounds * 2; k++) {
    const index = 2 + k;
    const speaker = k % 2 === 0 ? firstSpeaker : otherModel(firstSpeaker);
    slots.push({ index, kind: "reply", speaker, step: index });
  }
  const closingStep = 2 + rounds * 2;
  MODEL_IDS.forEach((speaker, i) =>
    slots.push({ index: closingStep + i, kind: "closing", speaker, step: closingStep }),
  );
  return slots;
}

/**
 * 다음에 실행할 단계.
 * - opening/closing: 한 요청에서 두 모델을 병렬 호출 → slots에 "아직 성공하지 못한" 칸이 1~2개
 * - reply: 한 요청에서 한 모델만 호출 → slots에 칸 1개
 * - index: 이 단계의 시작 index = API 요청에 넣는 index
 */
export type ExpectedTurn =
  | { kind: "done" }
  | { kind: Exclude<DialogueTurnKind, "reply">; index: number; slots: DialogueSlot[] }
  | { kind: "reply"; index: number; slots: [DialogueSlot] };

export type SequenceErrorCode =
  | "index_out_of_range"
  | "duplicate_index"
  | "out_of_order"
  | "kind_mismatch"
  | "speaker_mismatch"
  | "missing_turn";

export type SequenceResult =
  | { ok: true; next: ExpectedTurn }
  | { ok: false; code: SequenceErrorCode; message: string };

/**
 * transcript(성공한 발언 목록, index 오름차순)를 일정표와 대조해 다음 단계를 계산한다.
 *
 * 허용하는 transcript 모양: 완료된 단계들 + (마지막에) 일부만 성공한 병렬 단계 하나.
 * 예) opening에서 Claude만 성공 → [1] 허용, 다음은 opening(slots: GPT 0번)
 * 검출하는 오류: 범위 밖 index, 중복, 순서 뒤바뀜, 종류·발언자 불일치, 앞 단계 누락 상태에서 뒤 발언 존재
 */
export function expectedTurn(config: DialogueConfig, transcript: readonly DialogueTurnKey[]): SequenceResult {
  const schedule = buildSchedule(config);
  const present = new Set<number>();

  for (let i = 0; i < transcript.length; i++) {
    const entry = transcript[i];
    if (!Number.isInteger(entry.index) || entry.index < 0 || entry.index >= schedule.length) {
      return fail("index_out_of_range", `transcript[${i}].index ${entry.index}가 0~${schedule.length - 1} 범위를 벗어났습니다.`);
    }
    if (i > 0) {
      const prev = transcript[i - 1].index;
      if (entry.index === prev) return fail("duplicate_index", `index ${entry.index} 발언이 중복되었습니다.`);
      if (entry.index < prev) return fail("out_of_order", `transcript가 index 순서대로 정렬되어 있지 않습니다 (${prev} 다음에 ${entry.index}).`);
    }
    const slot = schedule[entry.index];
    if (entry.kind !== slot.kind) {
      return fail("kind_mismatch", `index ${entry.index}는 ${slot.kind} 차례인데 ${entry.kind}로 기록되었습니다.`);
    }
    if (entry.speaker !== slot.speaker) {
      return fail("speaker_mismatch", `index ${entry.index}의 발언자는 ${slot.speaker}여야 하는데 ${entry.speaker}로 기록되었습니다.`);
    }
    present.add(entry.index);
  }

  // 단계별로 묶어 앞에서부터 확인한다.
  const steps = new Map<number, DialogueSlot[]>();
  for (const slot of schedule) steps.set(slot.step, [...(steps.get(slot.step) ?? []), slot]);

  for (const [stepIndex, stepSlots] of steps) {
    const missing = stepSlots.filter((s) => !present.has(s.index));
    if (missing.length === 0) continue;

    // 이 단계가 아직 끝나지 않았는데 뒤 단계 발언이 있으면 누락이다.
    const lastIndexOfStep = stepSlots[stepSlots.length - 1].index;
    const later = transcript.find((t) => t.index > lastIndexOfStep);
    if (later) {
      return fail("missing_turn", `index ${missing[0].index} 발언이 없는데 이후 발언(index ${later.index})이 있습니다.`);
    }
    const kind = stepSlots[0].kind;
    return {
      ok: true,
      next:
        kind === "reply"
          ? { kind, index: stepIndex, slots: [missing[0]] }
          : { kind, index: stepIndex, slots: missing },
    };
  }
  return { ok: true, next: { kind: "done" } };
}

/**
 * 요청의 models 필터를 다음 단계와 대조해 실제로 호출할 칸을 고른다.
 * - reply: models는 생략하거나 [그 차례의 발언자]만 허용
 * - opening/closing: 생략하면 아직 성공하지 못한 칸 전부, 지정하면 그 일부(이미 성공한 모델은 불가)
 */
export function selectSlots(
  next: Exclude<ExpectedTurn, { kind: "done" }>,
  models: readonly ModelId[] | undefined,
): { ok: true; slots: DialogueSlot[] } | { ok: false; message: string } {
  if (!models) return { ok: true, slots: next.slots };
  const allowed = new Set(next.slots.map((s) => s.speaker));
  const invalid = models.filter((m) => !allowed.has(m));
  if (invalid.length) {
    return {
      ok: false,
      message: `이번 차례(index ${next.index}, ${next.kind})에 호출할 수 있는 모델은 ${[...allowed].join(", ")}입니다.`,
    };
  }
  return { ok: true, slots: next.slots.filter((s) => models.includes(s.speaker)) };
}

function fail(code: SequenceErrorCode, message: string): SequenceResult {
  return { ok: false, code, message };
}
