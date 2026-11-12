"use client";

import dynamic from "next/dynamic";
import MobileOnly from "@/components/MobileOnly";

// Three.js / Canvas API는 브라우저에서만 동작하므로 서버 렌더링 제외
const CreateStudio = dynamic(() => import("@/components/CreateStudio"), {
  ssr: false,
  loading: () => (
    <div className="grid h-dvh place-items-center font-display text-2xl text-pink-400">3D 작업대를 준비하고 있어요…</div>
  ),
});

export default function CreatePage() {
  return (
    <MobileOnly>
      <CreateStudio />
    </MobileOnly>
  );
}
