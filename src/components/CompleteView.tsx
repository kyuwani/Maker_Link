"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Home, Loader2, PlusCircle } from "lucide-react";
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { parse3MF } from "@/lib/export3mf";
import { loadFile } from "@/lib/types";
import ModelViewer from "./ModelViewer";
import { FILAMENT_COLORS, LAST_SUBMISSION_KEY, MODE_LABEL } from "@/lib/constants";
import { getClassroomService } from "@/lib/services";
import { formatTime } from "@/lib/session";
import type { Submission } from "@/lib/types";

const CONFETTI_COLORS = ["#f472b6", "#facc15", "#38bdf8", "#4ade80", "#a78bfa", "#fb923c"];

function Confetti() {
  const pieces = useMemo(
    () =>
      Array.from({ length: 36 }, (_, i) => ({
        left: Math.random() * 100,
        dx: `${(Math.random() - 0.5) * 120}px`,
        delay: `${Math.random() * 0.8}s`,
        dur: `${2.4 + Math.random() * 1.6}s`,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        round: i % 3 === 0,
      })),
    [],
  );
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-40 overflow-hidden">
      {pieces.map((p, i) => (
        <span
          key={i}
          className="confetti"
          style={
            {
              left: `${p.left}%`,
              background: p.color,
              borderRadius: p.round ? "999px" : undefined,
              "--dx": p.dx,
              "--delay": p.delay,
              "--dur": p.dur,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}

export default function CompleteView() {
  const router = useRouter();
  const params = useSearchParams();
  const [sub, setSub] = useState<Submission | null>(null);
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
  const [colored, setColored] = useState<{ geometry: THREE.BufferGeometry; hex: string }[] | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let id = params.get("id");
    if (!id) {
      try {
        id = localStorage.getItem(LAST_SUBMISSION_KEY);
      } catch {}
    }
    if (!id) {
      setMissing(true);
      return;
    }
    let alive = true;
    let geo: THREE.BufferGeometry | null = null;
    let parts: { geometry: THREE.BufferGeometry; hex: string }[] = [];
    getClassroomService()
      .getSubmission(id)
      .then(async (s) => {
        if (!alive) return;
        if (!s) return setMissing(true);
        setSub(s);
        // 색칠한 작품은 3MF에서 색별 조각을 읽어 칠한 색 그대로 보여 줌
        if (s.model3mf) {
          try {
            parts = await parse3MF(await loadFile(s.model3mf));
            const box = new THREE.Box3();
            for (const p of parts) {
              p.geometry.computeBoundingBox();
              box.union(p.geometry.boundingBox!);
            }
            const c = box.getCenter(new THREE.Vector3());
            for (const p of parts) p.geometry.translate(-c.x, -c.y, -c.z);
            if (alive) setColored(parts);
            return;
          } catch (e) {
            console.error("3MF 읽기 실패, STL로 표시", e);
          }
        }
        const buf = await (await loadFile(s.stl)).arrayBuffer();
        geo = new STLLoader().parse(buf);
        geo.center();
        geo.computeVertexNormals();
        if (alive) setGeometry(geo);
      });
    return () => {
      alive = false;
      geo?.dispose();
      parts.forEach((p) => p.geometry.dispose());
    };
  }, [params]);

  return (
    <main className="relative mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-8 pt-8 text-center">
      {sub && <Confetti />}

      <div className="pop-in">
        <div className="text-6xl">🎉</div>
        <h1 className="mt-2 font-display text-3xl leading-snug text-slate-800">
          멋진 작품이
          <br />
          선생님께 전달되었어요!
        </h1>
        {sub && (
          <p className="mt-2 text-slate-500">
            {sub.studentName} 친구의 {MODE_LABEL[sub.mode]} 작품 · {formatTime(sub.createdAt)}
          </p>
        )}
      </div>

      <div className="pop-in relative mx-auto mt-6 aspect-square w-full max-w-sm overflow-hidden rounded-[2rem] bg-gradient-to-b from-sky-100 to-amber-50 shadow-xl ring-4 ring-white [animation-delay:0.2s]">
        {(geometry || colored) && sub ? (
          <ModelViewer geometry={geometry} colored={colored} color={FILAMENT_COLORS[sub.color].hex} spinIntro />
        ) : sub?.thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={sub.thumbnail} alt="내 작품" className="h-full w-full object-cover" />
        ) : (
          <div className="grid h-full place-items-center text-slate-400">
            {missing ? "작품을 찾을 수 없어요" : <Loader2 className="size-10 animate-spin" />}
          </div>
        )}
        {sub && (
          <span
            className={`absolute left-3 top-3 rounded-full px-3 py-1 text-sm font-bold ring-2 ${FILAMENT_COLORS[sub.color].badge}`}
          >
            {FILAMENT_COLORS[sub.color].label}
            {sub.paintColors?.length ? ` 판 + ${sub.paintColors.map((c) => FILAMENT_COLORS[c].label).join("·")}` : "색"} · {sub.sizeMm}mm
          </span>
        )}
      </div>

      <p className="mt-4 text-slate-500">3D 프린터가 곧 내 작품을 만들어 줄 거예요 🖨️</p>

      <div className="mt-auto space-y-3 pt-8">
        <button
          onClick={() => router.push("/create")}
          className="flex h-16 w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-orange-400 to-pink-500 font-display text-2xl text-white shadow-lg shadow-pink-200 active:scale-95"
        >
          <PlusCircle className="size-7" /> 하나 더 만들기
        </button>
        <button
          onClick={() => router.push("/")}
          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-white font-bold text-slate-500 ring-2 ring-slate-200"
        >
          <Home className="size-5" /> 처음 화면으로
        </button>
      </div>
    </main>
  );
}
