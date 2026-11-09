// 메인 페이지(/). 서버 컴포넌트로 두고 화면의 큰 구조만 잡는다.
// 상태가 필요한 부분은 DebateWorkspace(클라이언트 컴포넌트)에 맡긴다.

import AppHeader from "@/components/AppHeader";
import ApiStatusNotice from "@/components/ApiStatusNotice";
import DebateWorkspace from "@/components/DebateWorkspace";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-4 py-10 sm:px-6 sm:py-14">
      <AppHeader />
      <ApiStatusNotice />
      <DebateWorkspace />
    </main>
  );
}
