"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Loader2, LogIn, UserPlus } from "lucide-react";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getSupabase } from "@/lib/supabase/browser";

const SIGNUP_ERRORS: Record<string, string> = {
  bad_signup_code: "학교 가입 코드가 맞지 않아요. 관리 선생님께 확인해 주세요.",
  bad_email: "이메일 주소를 다시 확인해 주세요.",
  weak_password: "비밀번호는 8자 이상으로 정해 주세요.",
  email_exists: "이미 가입된 이메일이에요. 로그인해 주세요.",
  server_not_configured: "서버 설정(Supabase)이 아직 안 되어 있어요.",
};

export default function TeacherLoginPage() {
  const router = useRouter();
  const configured = isSupabaseConfigured();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // 이미 로그인돼 있으면 바로 대시보드로
  useEffect(() => {
    if (!configured) return;
    getSupabase()
      .auth.getSession()
      .then(({ data }) => data.session && router.replace("/teacher"));
  }, [configured, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (mode === "signup") {
        const res = await fetch("/api/teacher/signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, email, password, code }),
        });
        if (!res.ok) {
          const { error: code } = await res.json().catch(() => ({ error: "" }));
          setError(SIGNUP_ERRORS[code] ?? "가입하지 못했어요. 잠시 뒤 다시 해 주세요.");
          return;
        }
      }
      const { error: loginError } = await getSupabase().auth.signInWithPassword({ email: email.trim(), password });
      if (loginError) {
        setError(/invalid/i.test(loginError.message) ? "이메일이나 비밀번호가 맞지 않아요." : loginError.message);
        return;
      }
      router.replace("/teacher");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-slate-50 p-6">
      <div className="w-full max-w-md rounded-3xl bg-white p-8 shadow-sm ring-1 ring-slate-200">
        <div className="mb-6 text-center">
          <div className="text-5xl">🐻</div>
          <h1 className="mt-2 font-display text-2xl text-slate-800">선생님 로그인</h1>
          <p className="mt-1 text-sm text-slate-500">춘천 꼬마 3D 메이커 · 수업방과 학생 작품을 관리해요</p>
        </div>

        {!configured ? (
          <div className="space-y-4 text-center">
            <p className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-800">
              지금은 <b>로컬 테스트 모드</b>라 로그인 없이 대시보드를 쓸 수 있어요.
              <br />
              배포하려면 Supabase를 연결해 주세요 (README 참고).
            </p>
            <Link href="/teacher" className="inline-flex min-h-12 items-center rounded-xl bg-sky-600 px-5 font-bold text-white">
              대시보드로 가기
            </Link>
          </div>
        ) : (
          <>
            <div className="mb-5 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
              {(
                [
                  ["login", "로그인"],
                  ["signup", "선생님 가입"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => {
                    setMode(k);
                    setError("");
                  }}
                  className={`min-h-11 rounded-lg text-sm font-bold ${mode === k ? "bg-white text-slate-800 shadow-sm" : "text-slate-500"}`}
                >
                  {label}
                </button>
              ))}
            </div>

            <form onSubmit={submit} className="space-y-3">
              {mode === "signup" && (
                <label className="block">
                  <span className="mb-1 block text-sm font-semibold text-slate-600">이름</span>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="예: 김선생"
                    className="h-12 w-full rounded-xl border border-slate-300 px-3 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
                  />
                </label>
              )}
              <label className="block">
                <span className="mb-1 block text-sm font-semibold text-slate-600">이메일</span>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-12 w-full rounded-xl border border-slate-300 px-3 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-semibold text-slate-600">비밀번호{mode === "signup" && " (8자 이상)"}</span>
                <input
                  type="password"
                  required
                  minLength={mode === "signup" ? 8 : undefined}
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-12 w-full rounded-xl border border-slate-300 px-3 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
                />
              </label>
              {mode === "signup" && (
                <label className="block">
                  <span className="mb-1 block text-sm font-semibold text-slate-600">학교 가입 코드</span>
                  <input
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="관리 선생님께 받은 코드 (없으면 비워 두세요)"
                    className="h-12 w-full rounded-xl border border-slate-300 px-3 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
                  />
                </label>
              )}

              {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-600">{error}</p>}

              <button
                disabled={busy}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-sky-600 font-bold text-white hover:bg-sky-700 disabled:opacity-60"
              >
                {busy ? <Loader2 className="size-5 animate-spin" /> : mode === "login" ? <LogIn className="size-5" /> : <UserPlus className="size-5" />}
                {mode === "login" ? "로그인" : "가입하고 시작하기"}
              </button>
            </form>
          </>
        )}

        <p className="mt-6 text-center text-xs text-slate-400">
          학생은 로그인 없이 휴대폰에서 수업 코드로 들어와요.
        </p>
      </div>
    </main>
  );
}
