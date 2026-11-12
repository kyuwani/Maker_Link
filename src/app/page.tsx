"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { ArrowRight, GraduationCap, Sparkles } from "lucide-react";
import { getClassroomService } from "@/lib/services";
import MobileOnly from "@/components/MobileOnly";
import { loadSession, saveSession } from "@/lib/session";

function EntryForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [roomLabel, setRoomLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const fromQr = /^\d{4}$/.test(params.get("code") ?? "");

  useEffect(() => {
    const q = params.get("code");
    const prev = loadSession();
    if (q && /^\d{4}$/.test(q)) setCode(q);
    else if (prev) setCode(prev.code);
    if (prev && (!q || q === prev.code)) setName(prev.name);
  }, [params]);

  // 같은 기기에 수업방 정보가 있으면 학교/학급 이름을 보여줌
  useEffect(() => {
    setRoomLabel("");
    if (code.length !== 4) return;
    let alive = true;
    getClassroomService()
      .getRoom(code)
      .then((r) => alive && r && setRoomLabel(`${r.school} ${r.className}`));
    return () => {
      alive = false;
    };
  }, [code]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!/^\d{4}$/.test(code)) return setError("수업 코드 숫자 4개를 넣어 주세요.");
    const n = name.trim();
    if (!n) return setError("이름을 써 주세요.");
    if (n.length > 10) return setError("이름은 10글자까지 쓸 수 있어요.");
    setBusy(true);
    const svc = getClassroomService();
    if (svc.strictRoomCheck && !(await svc.getRoom(code))) {
      setBusy(false);
      return setError("그런 수업방이 없어요. 선생님께 코드를 다시 확인해 주세요.");
    }
    saveSession({ code, name: n });
    router.push("/create");
  }

  return (
    <form onSubmit={submit} className="space-y-5 rounded-[2rem] bg-white p-6 shadow-xl shadow-amber-200/60 ring-4 ring-amber-100">
      <label className="block">
        <span className="mb-2 flex items-center gap-2 font-display text-xl text-slate-700">
          <span className="grid size-8 place-items-center rounded-full bg-sky-100 text-lg">🔢</span>
          수업 코드
        </span>
        <input
          inputMode="numeric"
          pattern="\d*"
          autoComplete="off"
          maxLength={4}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
          placeholder="1234"
          className="h-20 w-full rounded-2xl border-4 border-sky-200 bg-sky-50 text-center font-display text-5xl tracking-[0.4em] text-sky-700 placeholder:text-sky-200 focus:border-sky-400 focus:outline-none"
        />
        {fromQr && <span className="mt-2 block text-center text-sm text-sky-600">QR코드로 들어왔어요! 코드가 자동으로 들어갔어요 ✨</span>}
        {roomLabel && <span className="mt-2 block text-center font-bold text-emerald-600">🏫 {roomLabel} 수업방</span>}
      </label>

      <label className="block">
        <span className="mb-2 flex items-center gap-2 font-display text-xl text-slate-700">
          <span className="grid size-8 place-items-center rounded-full bg-pink-100 text-lg">😊</span>
          내 이름
        </span>
        <input
          value={name}
          maxLength={10}
          onChange={(e) => setName(e.target.value)}
          placeholder="김민수"
          autoComplete="off"
          className="h-16 w-full rounded-2xl border-4 border-pink-200 bg-pink-50 px-4 text-center font-display text-3xl text-pink-700 placeholder:text-pink-200 focus:border-pink-400 focus:outline-none"
        />
      </label>

      {error && (
        <p role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-center font-bold text-red-600">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="flex h-16 w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-orange-400 to-pink-500 font-display text-2xl text-white shadow-lg shadow-pink-300 transition active:scale-95 disabled:opacity-60"
      >
        만들러 가기 <ArrowRight className="size-7" strokeWidth={3} />
      </button>
    </form>
  );
}

export default function EntryPage() {
  return (
    <MobileOnly>
    <main className="relative mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-8 pt-4">
      <div className="flex justify-end">
        <Link
          href="/teacher"
          className="inline-flex min-h-12 items-center gap-1.5 rounded-full px-4 text-sm font-semibold text-slate-500 hover:bg-white/70"
        >
          <GraduationCap className="size-4" /> 선생님 페이지로 이동
        </Link>
      </div>

      <header className="mb-6 mt-4 text-center">
        <div className="wiggle mx-auto mb-3 inline-block text-6xl">🐻</div>
        <h1 className="font-display text-4xl leading-tight text-slate-800">
          춘천 꼬마 <span className="text-pink-500">3D</span> 메이커
        </h1>
        <p className="mt-2 flex items-center justify-center gap-1 text-lg text-slate-600">
          <Sparkles className="size-5 text-amber-500" />
          내가 만든 모양이 진짜 물건이 돼요!
        </p>
      </header>

      <Suspense fallback={<div className="h-96 animate-pulse rounded-[2rem] bg-white/60" />}>
        <EntryForm />
      </Suspense>

      <p className="mt-6 text-center text-sm text-slate-500">
        선생님이 칠판에 보여 준 <b>숫자 4개</b>와 <b>내 이름</b>을 쓰면 시작할 수 있어요.
      </p>
    </main>
    </MobileOnly>
  );
}
