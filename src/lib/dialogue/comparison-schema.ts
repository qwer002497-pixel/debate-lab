// 최종 비교 결과의 JSON 스키마와 검증기 (서버·클라이언트 공용, 비밀 정보 없음, P5-8a).
//
// 원칙 (P5-2 대화형 스키마와 같음)
// - 모든 객체는 additionalProperties:false, 모든 필드 필수.
// - 길이·개수 제한은 Anthropic structured outputs가 지원하지 않으므로 스키마에 넣지 않고
//   description으로 안내만 하며, COMPARISON_LIMITS로 코드에서 강제한다.
// - 검증기는 스키마의 properties 키 목록으로 필드를 검사하므로 스키마와 어긋날 수 없다.
//
// 검증 규칙 (하나라도 어기면 형식 오류)
// 1. 관계 유형(relation)과 목록 항목 수의 일관성 (relationMatchesCounts)
// 2. 분류 목록 5개(agreedPoints, disagreements, resolvedDisagreements, equivalentStatements, undetermined)
//    사이의 대표 문장 중복 금지 (공백·줄바꿈 차이 무시). 같은 목록 안 중복은 첫 항목만 남긴다.
//    - 합의점(최종 결론)과 해소된 차이(경과)는 같은 "쟁점"을 다룰 수 있다 (P5-8 재생 검증 후 정의).
//      의미가 겹치는 것은 허용하고 코드로 막지 않지만, 같은 문장을 그대로 반복하는 것은 막는다:
//      해소 항목의 issue·initialDifference·howResolved 중 하나가 합의점 문장과 같으면 형식 오류.
//    - 같은 의미 항목의 표현(wordingA/B)이 합의점 문장과 그대로 같으면 형식 오류 (이미 합의점에 있는 의미의 반복).
// 3. 항목 자체의 모순: 차이 항목의 두 입장이 같은 문장 / 같은 의미 항목의 두 표현이 같은 문장
//    / 해소 항목의 처음 차이와 해소 과정이 같은 문장
// 3-1. 확인되지 않은 입장 금지: 차이 항목의 입장이 "명시하지 않았다", "입장을 밝히지 않았다" 같은
//    '말하지 않음'에 대한 서술이면 형식 오류 (침묵을 반대 의견으로 추정한 분류. 이런 쟁점은 undetermined).
//    문구 기반 휴리스틱이라 실제 입장 문장을 잘못 거부할 가능성이 있다 (거부 시 재시도 과금).
// 4. 해소 시점(resolvedStage + resolvedAtIndex)의 범위 (resolutionTarget — 화면 링크도 같은 함수를 쓴다)
// 5. undetermined가 1개 이상이면 verificationNeeded도 1개 이상
// verificationNeeded는 검증할 사실·질문이라 다른 목록과 겹쳐도 되며, 목록 안 중복만 제거한다.
// 한계: 의미가 같고 표현이 다른 중복은 코드로 판별할 수 없다.

import type { RoundCount } from "@/types/debate";
import type {
  AbOrder,
  ComparisonContent,
  ComparisonOutput,
  ComparisonRelation,
  DisagreementAB,
  EquivalentStatementAB,
  ResolvedDisagreement,
  ResolvedStage,
  UndeterminedItem,
} from "@/types/comparison";
import { normalizeForCompare } from "./schema";

export const COMPARISON_RELATIONS: readonly ComparisonRelation[] = [
  "aligned",
  "partially_aligned",
  "divergent",
  "undetermined",
];

export const RESOLVED_STAGES: readonly ResolvedStage[] = ["reply", "closing", "closings_combined"];

export const COMPARISON_LIMITS = {
  agreedPoints: { maxItems: 8, itemMaxChars: 300 },
  verificationNeeded: { maxItems: 8, itemMaxChars: 300 },
  objectListMaxItems: 6,
  issueMaxChars: 200,
  positionMaxChars: 400,
  textMaxChars: 300,
} as const;

// ---------------------------------------------------------------------------
// 해소 시점 규칙 (서버 검증기와 화면 링크가 함께 쓰는 단일 기준)
// ---------------------------------------------------------------------------

/** 해소 시점이 가리키는 화면 위치. null이면 허용 범위 밖. */
export type ResolutionTarget =
  | { kind: "turn"; index: number } // 응답 발언 카드 1개
  | { kind: "closing"; index: number } // 한 모델의 마무리 원문 카드
  | { kind: "closings" }; // 마무리 원문 섹션 전체 (두 카드 함께)

/**
 * reply: 2 … 2N+1 / closing: 2N+2 또는 2N+3 / closings_combined: 2N+2만.
 * opening(0, 1)은 상호작용 전이라 해소 시점이 될 수 없다.
 */
export function resolutionTarget(stage: ResolvedStage, index: number, rounds: RoundCount): ResolutionTarget | null {
  if (!Number.isInteger(index)) return null;
  const closingStart = 2 * rounds + 2;
  switch (stage) {
    case "reply":
      return index >= 2 && index <= closingStart - 1 ? { kind: "turn", index } : null;
    case "closing":
      return index === closingStart || index === closingStart + 1 ? { kind: "closing", index } : null;
    case "closings_combined":
      return index === closingStart ? { kind: "closings" } : null;
    default:
      return null;
  }
}

/** relation과 항목 수의 일관성 (중복 제거 후 개수 기준) */
export function relationMatchesCounts(
  relation: ComparisonRelation,
  counts: { agreed: number; disagreements: number; undetermined: number },
): boolean {
  const { agreed, disagreements, undetermined } = counts;
  switch (relation) {
    case "aligned":
      return agreed >= 1 && disagreements === 0;
    case "partially_aligned":
      return agreed >= 1 && disagreements >= 1;
    case "divergent":
      return disagreements >= 1;
    case "undetermined":
      return agreed === 0 && disagreements === 0 && undetermined >= 1;
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// JSON 스키마 (모델 출력 형식, A/B)
// ---------------------------------------------------------------------------

const L = COMPARISON_LIMITS;
const text = (description: string, max: number) => ({ type: "string", description: `${description} (최대 ${max}자)` });
const object = (properties: Record<string, unknown>) => ({
  type: "object",
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});
const array = (items: unknown, description: string) => ({ type: "array", items, description });

const DISAGREEMENT_ITEM = object({
  issue: text("쟁점 (한 문장)", L.issueMaxChars),
  positionA: text("참여자 A의 최종 입장", L.positionMaxChars),
  positionB: text("참여자 B의 최종 입장", L.positionMaxChars),
  difference: text("두 입장이 실제로 어떻게 다른지", L.textMaxChars),
  basisOrCondition: text("판단이 갈린 기준이나 적용 조건", L.textMaxChars),
});

const RESOLVED_ITEM = object({
  issue: text("쟁점 (한 문장)", L.issueMaxChars),
  initialDifference: text("처음에 어떻게 달랐는지", L.textMaxChars),
  howResolved: text("어떻게 해소되었는지", L.textMaxChars),
  resolvedStage: {
    type: "string",
    enum: [...RESOLVED_STAGES],
    description:
      "해소가 드러난 단계. reply: 응답 발언에서 해소 / closing: 한 참여자의 마무리에서 해소 / closings_combined: 두 마무리를 함께 봐야 해소를 알 수 있음",
  },
  resolvedAtIndex: {
    type: "integer",
    description:
      "해소가 드러난 발언의 index. reply는 2…2N+1, closing은 그 마무리의 index(2N+2 또는 2N+3), closings_combined는 2N+2. 첫 의견(0, 1)은 쓸 수 없음",
  },
});

const EQUIVALENT_ITEM = object({
  meaning: text("두 표현이 공통으로 뜻하는 내용", L.textMaxChars),
  wordingA: text("참여자 A의 표현", L.textMaxChars),
  wordingB: text("참여자 B의 표현 (A와 다른 표현이어야 함)", L.textMaxChars),
});

const UNDETERMINED_ITEM = object({
  issue: text("판단할 수 없는 쟁점 (한 문장)", L.issueMaxChars),
  missingEvidence: text("판단에 필요한데 대화에 없는 근거", L.textMaxChars),
});

const stringItem = { type: "string" };

export const COMPARISON_JSON_SCHEMA = object({
  relation: {
    type: "string",
    enum: [...COMPARISON_RELATIONS],
    description:
      "전체 관계. aligned: 합의점 1개 이상·남은 차이 0개 / partially_aligned: 합의점과 남은 차이 모두 1개 이상 / divergent: 남은 차이 1개 이상 / undetermined: 합의점·남은 차이 0개이고 판단 불가 항목만 있음",
  },
  agreedPoints: array(
    stringItem,
    `두 참여자가 최종적으로 합의한 점 (최대 ${L.agreedPoints.maxItems}개, 각 ${L.agreedPoints.itemMaxChars}자 이내)`,
  ),
  disagreements: array(
    DISAGREEMENT_ITEM,
    `마지막까지 남은 실질적 차이. 없으면 빈 배열 (최대 ${L.objectListMaxItems}개)`,
  ),
  resolvedDisagreements: array(
    RESOLVED_ITEM,
    `토론 중 해소된 차이. 없으면 빈 배열 (최대 ${L.objectListMaxItems}개)`,
  ),
  equivalentStatements: array(
    EQUIVALENT_ITEM,
    `표현만 다르고 실질적으로 같은 주장. 없으면 빈 배열 (최대 ${L.objectListMaxItems}개)`,
  ),
  undetermined: array(
    UNDETERMINED_ITEM,
    `대화 기록만으로 판단할 수 없는 쟁점. 없으면 빈 배열 (최대 ${L.objectListMaxItems}개)`,
  ),
  verificationNeeded: array(
    stringItem,
    `외부 자료로 확인해야 할 사실이나 질문. undetermined가 있으면 1개 이상 (최대 ${L.verificationNeeded.maxItems}개, 각 ${L.verificationNeeded.itemMaxChars}자 이내)`,
  ),
});

// ---------------------------------------------------------------------------
// 검증기
// ---------------------------------------------------------------------------

export type ComparisonParseResult = { ok: true; value: ComparisonOutput } | { ok: false; reason: string };

/** 스키마의 필드 목록 (검증기가 같은 목록을 쓴다) */
const keysOf = (schema: { properties: Record<string, unknown> }) => Object.keys(schema.properties);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function hasOnlyKeys(v: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(v).every((k) => keys.includes(k)) && keys.every((k) => k in v);
}

class Invalid extends Error {}
const fail = (reason: string): never => {
  throw new Invalid(reason);
};

/** 필수 문자열: 앞뒤 공백 제거, 빈 문자열·길이 초과는 형식 오류 */
function reqText(v: unknown, max: number, where: string): string {
  if (typeof v !== "string") fail(`${where}: 문자열이어야 합니다.`);
  const s = (v as string).trim();
  if (s === "") fail(`${where}: 비어 있습니다.`);
  if ((v as string).length > max) fail(`${where}: ${max}자를 넘었습니다.`);
  return s;
}

/** 문자열 목록: 개수·길이 초과는 형식 오류, 빈 항목은 제거, 공백만 다른 중복은 첫 항목만 남김 */
function strList(v: unknown, maxItems: number, itemMax: number, where: string): string[] {
  if (!Array.isArray(v)) fail(`${where}: 배열이어야 합니다.`);
  const arr = v as unknown[];
  if (arr.length > maxItems) fail(`${where}: 최대 ${maxItems}개입니다.`);
  const out: string[] = [];
  const seen = new Set<string>();
  arr.forEach((item, i) => {
    if (typeof item !== "string") fail(`${where}[${i}]: 문자열이어야 합니다.`);
    if ((item as string).length > itemMax) fail(`${where}[${i}]: ${itemMax}자를 넘었습니다.`);
    const s = (item as string).trim();
    if (!s) return;
    const key = normalizeForCompare(s);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(s);
  });
  return out;
}

/** 객체 목록: 항목마다 parse, 대표 문장(keyOf)이 같은 항목은 첫 항목만 남김 */
function objList<T>(
  v: unknown,
  schema: { properties: Record<string, unknown> },
  where: string,
  parse: (o: Record<string, unknown>, at: string) => T,
  keyOf: (item: T) => string,
): T[] {
  if (!Array.isArray(v)) fail(`${where}: 배열이어야 합니다.`);
  const arr = v as unknown[];
  if (arr.length > L.objectListMaxItems) fail(`${where}: 최대 ${L.objectListMaxItems}개입니다.`);
  const keys = keysOf(schema);
  const out: T[] = [];
  const seen = new Set<string>();
  arr.forEach((raw, i) => {
    const at = `${where}[${i}]`;
    if (!isPlainObject(raw) || !hasOnlyKeys(raw, keys)) fail(`${at}: 필드는 ${keys.join(", ")}만 허용됩니다.`);
    const item = parse(raw as Record<string, unknown>, at);
    const key = normalizeForCompare(keyOf(item));
    if (seen.has(key)) return;
    seen.add(key);
    out.push(item);
  });
  return out;
}

const same = (a: string, b: string) => normalizeForCompare(a) === normalizeForCompare(b);

/**
 * 입장이 아니라 "말하지 않음"을 서술한 문장인지 (P5-8 재생 검증에서 실제로 나온 형태).
 * 예: "…별도 항목으로 둘지는 명시하지 않았다", "이 쟁점에 대한 입장을 밝히지 않았다", "언급 없음".
 * "효과가 확인되지 않았다고 본다"처럼 실제 입장일 수 있는 일반 표현은 포함하지 않도록 좁게 잡는다.
 */
const UNSTATED_PATTERNS: readonly RegExp[] = [
  /(명시|언급|표명)하지\s*않았/,
  /(입장|견해|의견)[을를이가은는]?\s*(명시|언급|표명|밝히|드러내|제시)(하)?지\s*않/,
  /(입장|견해|의견|언급)[이은는]?\s*없(음|다|었)/,
  /(입장|견해|의견)[이가은는]?\s*(확인되지|나타나지|드러나지)\s*않/,
];
export function looksLikeUnstatedPosition(text: string): boolean {
  return UNSTATED_PATTERNS.some((re) => re.test(text));
}

/**
 * 모델이 출력한 비교 결과(A/B 형식)를 검증한다.
 * rounds는 해소 시점 index의 허용 범위를 계산하는 데 쓴다.
 */
export function parseComparisonOutput(value: unknown, rounds: RoundCount): ComparisonParseResult {
  try {
    if (!isPlainObject(value) || !hasOnlyKeys(value, keysOf(COMPARISON_JSON_SCHEMA))) {
      fail(`최상위 필드는 ${keysOf(COMPARISON_JSON_SCHEMA).join(", ")}만 허용됩니다.`);
    }
    const v = value as Record<string, unknown>;

    if (!COMPARISON_RELATIONS.includes(v.relation as ComparisonRelation)) fail("relation 값이 올바르지 않습니다.");
    const relation = v.relation as ComparisonRelation;

    const agreedPoints = strList(v.agreedPoints, L.agreedPoints.maxItems, L.agreedPoints.itemMaxChars, "agreedPoints");
    const verificationNeeded = strList(
      v.verificationNeeded,
      L.verificationNeeded.maxItems,
      L.verificationNeeded.itemMaxChars,
      "verificationNeeded",
    );

    const disagreements = objList<DisagreementAB>(
      v.disagreements,
      DISAGREEMENT_ITEM,
      "disagreements",
      (o, at) => {
        const item = {
          issue: reqText(o.issue, L.issueMaxChars, `${at}.issue`),
          positionA: reqText(o.positionA, L.positionMaxChars, `${at}.positionA`),
          positionB: reqText(o.positionB, L.positionMaxChars, `${at}.positionB`),
          difference: reqText(o.difference, L.textMaxChars, `${at}.difference`),
          basisOrCondition: reqText(o.basisOrCondition, L.textMaxChars, `${at}.basisOrCondition`),
        };
        if (same(item.positionA, item.positionB)) fail(`${at}: 두 입장이 같은 문장이면 차이가 아닙니다.`);
        for (const side of ["positionA", "positionB"] as const) {
          if (looksLikeUnstatedPosition(item[side])) {
            fail(`${at}.${side}: 입장이 아니라 '밝히지 않음'에 대한 서술입니다. 입장이 확인되지 않은 쟁점은 undetermined로 분류해야 합니다.`);
          }
        }
        return item;
      },
      (d) => d.issue,
    );

    const resolvedDisagreements = objList<ResolvedDisagreement>(
      v.resolvedDisagreements,
      RESOLVED_ITEM,
      "resolvedDisagreements",
      (o, at) => {
        if (!RESOLVED_STAGES.includes(o.resolvedStage as ResolvedStage)) fail(`${at}.resolvedStage 값이 올바르지 않습니다.`);
        const stage = o.resolvedStage as ResolvedStage;
        const index = o.resolvedAtIndex;
        if (typeof index !== "number" || !resolutionTarget(stage, index, rounds)) {
          // 사유에는 모델이 쓴 문자열을 넣지 않는다 (숫자일 때만 값 표시, 서버 로그에 남을 수 있음).
          fail(`${at}.resolvedAtIndex ${typeof index === "number" ? index : `(${typeof index})`}는 ${stage} 단계에서 허용되지 않는 값입니다.`);
        }
        const item = {
          issue: reqText(o.issue, L.issueMaxChars, `${at}.issue`),
          initialDifference: reqText(o.initialDifference, L.textMaxChars, `${at}.initialDifference`),
          howResolved: reqText(o.howResolved, L.textMaxChars, `${at}.howResolved`),
          resolvedStage: stage,
          resolvedAtIndex: index as number,
        };
        if (same(item.initialDifference, item.howResolved)) fail(`${at}: 처음 차이와 해소 과정이 같은 문장입니다.`);
        return item;
      },
      (r) => r.issue,
    );

    const equivalentStatements = objList<EquivalentStatementAB>(
      v.equivalentStatements,
      EQUIVALENT_ITEM,
      "equivalentStatements",
      (o, at) => {
        const item = {
          meaning: reqText(o.meaning, L.textMaxChars, `${at}.meaning`),
          wordingA: reqText(o.wordingA, L.textMaxChars, `${at}.wordingA`),
          wordingB: reqText(o.wordingB, L.textMaxChars, `${at}.wordingB`),
        };
        if (same(item.wordingA, item.wordingB)) fail(`${at}: 두 표현이 같으면 합의점(agreedPoints)에 넣어야 합니다.`);
        return item;
      },
      (e) => e.meaning,
    );

    const undetermined = objList<UndeterminedItem>(
      v.undetermined,
      UNDETERMINED_ITEM,
      "undetermined",
      (o, at) => ({
        issue: reqText(o.issue, L.issueMaxChars, `${at}.issue`),
        missingEvidence: reqText(o.missingEvidence, L.textMaxChars, `${at}.missingEvidence`),
      }),
      (u) => u.issue,
    );

    // 분류 목록 5개 사이의 중복 금지 (verificationNeeded 제외)
    const owner = new Map<string, string>();
    const claim = (list: string, sentences: string[]) => {
      for (const s of sentences) {
        const key = normalizeForCompare(s);
        const prev = owner.get(key);
        if (prev && prev !== list) fail(`같은 문장이 ${prev}와 ${list}에 함께 있습니다.`);
        owner.set(key, list);
      }
    };
    claim("agreedPoints", agreedPoints);
    claim("disagreements", disagreements.map((d) => d.issue));
    claim("resolvedDisagreements", resolvedDisagreements.map((r) => r.issue));
    claim("equivalentStatements", equivalentStatements.map((e) => e.meaning));
    claim("undetermined", undetermined.map((u) => u.issue));

    // 합의점(최종 결론) 문장을 해소 경과나 같은 의미 표현에 그대로 반복하지 않는다 (의미의 겹침은 허용).
    const agreedKeys = new Set(agreedPoints.map(normalizeForCompare));
    resolvedDisagreements.forEach((r, i) => {
      for (const k of ["initialDifference", "howResolved"] as const) {
        if (agreedKeys.has(normalizeForCompare(r[k]))) fail(`resolvedDisagreements[${i}].${k}: 합의점 문장을 그대로 반복했습니다.`);
      }
    });
    equivalentStatements.forEach((e, i) => {
      for (const k of ["wordingA", "wordingB"] as const) {
        if (agreedKeys.has(normalizeForCompare(e[k]))) fail(`equivalentStatements[${i}].${k}: 이미 합의점에 있는 문장입니다.`);
      }
    });

    if (undetermined.length > 0 && verificationNeeded.length === 0) {
      fail("판단 불가 항목이 있으면 verificationNeeded가 1개 이상 필요합니다.");
    }

    const counts = { agreed: agreedPoints.length, disagreements: disagreements.length, undetermined: undetermined.length };
    if (!relationMatchesCounts(relation, counts)) {
      fail(
        `relation "${relation}"이 항목 수(합의점 ${counts.agreed}, 남은 차이 ${counts.disagreements}, 판단 불가 ${counts.undetermined})와 맞지 않습니다.`,
      );
    }

    return {
      ok: true,
      value: {
        relation,
        agreedPoints,
        disagreements,
        resolvedDisagreements,
        equivalentStatements,
        undetermined,
        verificationNeeded,
      },
    };
  } catch (e) {
    if (e instanceof Invalid) return { ok: false, reason: e.message };
    throw e;
  }
}

/** 모델이 반환한 JSON 텍스트를 파싱·검증한다. */
export function parseComparisonJson(textValue: string, rounds: RoundCount): ComparisonParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(textValue);
  } catch {
    return { ok: false, reason: "JSON 형식이 아닙니다." };
  }
  return parseComparisonOutput(raw, rounds);
}

/** 검증된 A/B 형식을 GPT/Claude 형식으로 되돌린다 (순수 함수). */
export function toComparisonContent(output: ComparisonOutput, ab: AbOrder): ComparisonContent {
  if (ab.A === ab.B) throw new Error("A와 B는 서로 다른 모델이어야 합니다.");
  const pick = <T,>(a: T, b: T) => (ab.A === "gpt" ? { gpt: a, claude: b } : { gpt: b, claude: a });
  return {
    relation: output.relation,
    agreedPoints: [...output.agreedPoints],
    disagreements: output.disagreements.map((d) => {
      const p = pick(d.positionA, d.positionB);
      return {
        issue: d.issue,
        gptPosition: p.gpt,
        claudePosition: p.claude,
        difference: d.difference,
        basisOrCondition: d.basisOrCondition,
      };
    }),
    resolvedDisagreements: output.resolvedDisagreements.map((r) => ({ ...r })),
    equivalentStatements: output.equivalentStatements.map((e) => {
      const w = pick(e.wordingA, e.wordingB);
      return { meaning: e.meaning, gptWording: w.gpt, claudeWording: w.claude };
    }),
    undetermined: output.undetermined.map((u) => ({ ...u })),
    verificationNeeded: [...output.verificationNeeded],
  };
}
