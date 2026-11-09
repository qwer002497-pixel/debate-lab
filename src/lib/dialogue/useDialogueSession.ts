// 대화형 토론 진행 훅. 진행 로직은 DialogueSessionController(session.ts)에 있고,
// 이 훅은 컨트롤러를 React 화면 상태에 연결하기만 한다. 분석형 훅(useDebateSession)과 독립적이다.
//
// - 컨트롤러는 컴포넌트마다 한 번만 만든다 (useState 초기화 함수).
// - 상태는 useSyncExternalStore로 구독한다 → 진행 중 상태 변경이 화면에 빠짐없이 반영된다.
// - 화면을 떠나면 detach: 진행 중인 요청을 끊고(비용 확인 불가로 기록) 이후 진행을 멈춘다.
//   React StrictMode의 개발 모드 재마운트(cleanup → 다시 effect)에서도 attach로 다시 연결된다.
// - 최종 비교(P5-8)는 앱에서 기본으로 켠다: Closing 2개가 성공하면 /api/dialogue/compare를 1회 호출한다.
//   끄려면 options에 finalComparison: undefined를 넘긴다 (컨트롤러는 옵션이 없으면 P5-4와 같게 동작).

import { useEffect, useState, useSyncExternalStore } from "react";
import { postDialogueCompare, postDialogueTurn } from "@/lib/debate/client-api";
import {
  DialogueSessionController,
  type DialogueSessionOptions,
  type DialogueSessionState,
} from "./session";

export interface UseDialogueSession {
  state: DialogueSessionState;
  start: DialogueSessionController["start"];
  pause: DialogueSessionController["pause"];
  resume: DialogueSessionController["resume"];
  retry: DialogueSessionController["retry"];
  stop: DialogueSessionController["stop"];
}

export function useDialogueSession(options: Partial<DialogueSessionOptions> = {}): UseDialogueSession {
  const [controller] = useState(
    () =>
      new DialogueSessionController({
        transport: postDialogueTurn,
        finalComparison: { transport: postDialogueCompare },
        ...options,
      }),
  );
  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);

  useEffect(() => {
    controller.attach();
    return () => controller.detach();
  }, [controller]);

  return {
    state,
    start: controller.start,
    pause: controller.pause,
    resume: controller.resume,
    retry: controller.retry,
    stop: controller.stop,
  };
}
