"use client";

import dynamic from "next/dynamic";
import { Suspense } from "react";
import MobileOnly from "@/components/MobileOnly";

const CompleteView = dynamic(() => import("@/components/CompleteView"), { ssr: false });

export default function CompletePage() {
  return (
    <MobileOnly>
      <Suspense>
        <CompleteView />
      </Suspense>
    </MobileOnly>
  );
}
