"use client";

import dynamic from "next/dynamic";

const TeacherDashboard = dynamic(() => import("@/components/TeacherDashboard"), {
  ssr: false,
  loading: () => <div className="grid min-h-dvh place-items-center text-slate-400">대시보드를 불러오는 중…</div>,
});

export default function TeacherPage() {
  return <TeacherDashboard />;
}
