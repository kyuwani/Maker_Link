"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  LogOut,
  Box,
  ClipboardList,
  Download,
  FileSpreadsheet,
  Inbox,
  Loader2,
  Maximize2,
  PackageOpen,
  Plus,
  Printer,
  School,
  Trash2,
  X,
} from "lucide-react";
import { FILAMENT_COLORS, MODE_LABEL, PURPOSE_LABEL, SHAPE_LABEL, TEACHER_ROOM_KEY } from "@/lib/constants";
import { buildFileNames, colorStats, downloadBlob, downloadCsv, downloadZip, stlToGlb } from "@/lib/export";
import { getClassroomService, isServerMode } from "@/lib/services";
import { getSupabase } from "@/lib/supabase/browser";
import { formatDateTime, formatTime } from "@/lib/session";
import { loadFile, type Room, type Submission } from "@/lib/types";

function RequestSheet({ room, subs }: { room: Room; subs: Submission[] }) {
  const stats = colorStats(subs);
  const names = buildFileNames(subs);
  const ordered = [...subs].sort((a, b) => a.createdAt - b.createdAt);
  return (
    <div className="space-y-6 text-slate-800">
      <header className="border-b-2 border-slate-800 pb-3">
        <h2 className="text-2xl font-bold">메이커스페이스 3D 프린팅 제작 의뢰서</h2>
        <p className="mt-1 text-sm text-slate-600">
          {room.school} · {room.className} · 수업 코드 {room.code} · 작성 {new Date().toLocaleDateString("ko-KR")} · 총{" "}
          <b>{subs.length}</b>개
        </p>
      </header>
      <section>
        <h3 className="mb-2 font-bold">색상별 필요 수량</h3>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-slate-100">
              {stats.map((s) => (
                <th key={s.color} className="border border-slate-300 px-2 py-1.5">
                  <span className="mr-1 inline-block size-3 rounded-full border border-slate-400 align-middle" style={{ background: FILAMENT_COLORS[s.color].hex }} />
                  {s.label}
                </th>
              ))}
              <th className="border border-slate-300 px-2 py-1.5">합계</th>
            </tr>
          </thead>
          <tbody>
            <tr className="text-center text-lg font-bold">
              {stats.map((s) => (
                <td key={s.color} className="border border-slate-300 px-2 py-2">
                  {s.count}
                </td>
              ))}
              <td className="border border-slate-300 px-2 py-2">{subs.length}</td>
            </tr>
          </tbody>
        </table>
      </section>
      <section>
        <h3 className="mb-2 font-bold">학생별 명단</h3>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-slate-100 text-left">
              {["번호", "이름", "모드", "모양/용도", "크기", "색상", "칠한 색", "제출 시간", "파일명", "확인"].map((h) => (
                <th key={h} className="border border-slate-300 px-2 py-1.5 whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ordered.map((s, i) => (
              <tr key={s.id} className="break-inside-avoid">
                <td className="border border-slate-300 px-2 py-1 text-center">{i + 1}</td>
                <td className="border border-slate-300 px-2 py-1 font-semibold">{s.studentName}</td>
                <td className="border border-slate-300 px-2 py-1">{MODE_LABEL[s.mode]}</td>
                <td className="border border-slate-300 px-2 py-1">
                  {s.shape ? SHAPE_LABEL[s.shape] : MODE_LABEL[s.mode]} / {PURPOSE_LABEL[s.purpose]}
                </td>
                <td className="border border-slate-300 px-2 py-1 whitespace-nowrap">{s.sizeMm}mm</td>
                <td className="border border-slate-300 px-2 py-1">{FILAMENT_COLORS[s.color].label}</td>
                <td className="border border-slate-300 px-2 py-1">
                  {(s.paintColors ?? []).map((c) => FILAMENT_COLORS[c].label).join("·") || "-"}
                </td>
                <td className="border border-slate-300 px-2 py-1 whitespace-nowrap">{formatDateTime(s.createdAt)}</td>
                <td className="border border-slate-300 px-2 py-1 font-mono text-xs">{names.get(s.id)}</td>
                <td className="w-10 border border-slate-300 px-2 py-1" />
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <p className="text-xs text-slate-500">
        ※ STL 단위: mm · 출력 방향: 바닥면(두께 방향 Z)이 베드에 닿게 · 열쇠고리 고리 구멍 지름 약 5mm
      </p>
    </div>
  );
}

export default function TeacherDashboard() {
  const svc = getClassroomService();
  const router = useRouter();
  const serverMode = isServerMode();
  // 서버 모드: 로그인한 선생님만 (아니면 로그인 페이지로)
  const [teacher, setTeacher] = useState<{ email: string; name: string } | null>(null);
  const [authReady, setAuthReady] = useState(!serverMode);

  useEffect(() => {
    if (!serverMode) return;
    const sb = getSupabase();
    sb.auth.getSession().then(({ data }) => {
      const u = data.session?.user;
      if (!u) {
        router.replace("/teacher/login");
        return;
      }
      setTeacher({ email: u.email ?? "", name: (u.user_metadata?.name as string) || "" });
      setAuthReady(true);
    });
    const { data: sub } = sb.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") router.replace("/teacher/login");
    });
    return () => sub.subscription.unsubscribe();
  }, [serverMode, router]);

  async function logout() {
    try {
      localStorage.removeItem(TEACHER_ROOM_KEY);
    } catch {}
    await getSupabase().auth.signOut();
  }
  const [rooms, setRooms] = useState<Room[]>([]);
  const [room, setRoom] = useState<Room | null>(null);
  const [school, setSchool] = useState("춘천초등학교");
  const [className, setClassName] = useState("");
  const [creating, setCreating] = useState(false);
  const [subs, setSubs] = useState<Submission[]>([]);
  const [baseUrl, setBaseUrl] = useState("");
  const [showSheet, setShowSheet] = useState(false);
  const [bigQr, setBigQr] = useState(false);
  const [zipping, setZipping] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    setBaseUrl(window.location.origin);
    if (!authReady) return;
    svc.listRooms().then((list) => {
      setRooms(list);
      let saved: string | null = null;
      try {
        saved = localStorage.getItem(TEACHER_ROOM_KEY);
      } catch {}
      setRoom(list.find((r) => r.code === saved) ?? list[0] ?? null);
    });
  }, [svc, authReady]);

  useEffect(() => {
    if (!room) return;
    try {
      localStorage.setItem(TEACHER_ROOM_KEY, room.code);
    } catch {}
    let first = true;
    let known = new Set<string>();
    const unsub = svc.subscribeSubmissions(room.code, (items) => {
      if (!first) {
        const added = items.filter((s) => !known.has(s.id)).map((s) => s.id);
        if (added.length) {
          setFreshIds((prev) => new Set([...prev, ...added]));
          setTimeout(() => setFreshIds((prev) => new Set([...prev].filter((id) => !added.includes(id)))), 4000);
        }
      }
      first = false;
      known = new Set(items.map((s) => s.id));
      setSubs(items);
    });
    return unsub;
  }, [room, svc]);

  async function createRoom(e: React.FormEvent) {
    e.preventDefault();
    if (!school.trim() || !className.trim()) return;
    setCreating(true);
    const r = await svc.createRoom({ school: school.trim(), className: className.trim() });
    setRooms((prev) => [r, ...prev]);
    setRoom(r);
    setSubs([]);
    setClassName("");
    setCreating(false);
  }

  const joinUrl = room ? `${baseUrl.replace(/\/$/, "")}/?code=${room.code}` : "";
  const fileNames = useMemo(() => buildFileNames(subs), [subs]);
  const stats = useMemo(() => colorStats(subs), [subs]);
  const isLocalhost = /localhost|127\.0\.0\.1/.test(baseUrl);

  if (!authReady) {
    return <div className="grid min-h-dvh place-items-center text-slate-400">로그인 확인 중…</div>;
  }

  return (
    <>
      <div className="min-h-dvh bg-slate-50 print:hidden">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center gap-3 px-6 py-3">
            <span className="text-3xl">🐻</span>
            <div className="flex-1">
              <h1 className="font-display text-2xl text-slate-800">춘천 꼬마 3D 메이커 · 선생님 대시보드</h1>
              <p className="text-sm text-slate-500">수업방을 만들고 학생 작품을 실시간으로 모아 3D 프린팅을 의뢰하세요.</p>
            </div>
            <Link href="/?pc=1" title="PC에서 학생 화면 미리보기" className="min-h-12 content-center rounded-xl px-4 text-sm font-semibold text-slate-500 hover:bg-slate-100">
              학생 화면 보기 →
            </Link>
            {serverMode && teacher && (
              <div className="flex items-center gap-2 border-l border-slate-200 pl-3">
                <span className="hidden text-sm text-slate-600 sm:inline">
                  👩‍🏫 <b>{teacher.name || teacher.email}</b> 선생님
                </span>
                <button
                  onClick={logout}
                  className="flex min-h-11 items-center gap-1 rounded-xl px-3 text-sm font-semibold text-slate-500 hover:bg-slate-100"
                >
                  <LogOut className="size-4" /> 로그아웃
                </button>
              </div>
            )}
          </div>
        </header>

        <main className="mx-auto max-w-7xl space-y-6 px-6 py-6">
          {/* 수업방 관리 */}
          <section className="grid gap-6 lg:grid-cols-[1fr_auto]">
            <div className="space-y-5 rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
              <form onSubmit={createRoom} className="flex flex-wrap items-end gap-3">
                <label className="min-w-48 flex-1">
                  <span className="mb-1 block text-sm font-semibold text-slate-600">학교명</span>
                  <input
                    value={school}
                    onChange={(e) => setSchool(e.target.value)}
                    className="h-12 w-full rounded-xl border border-slate-300 px-3 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
                  />
                </label>
                <label className="min-w-48 flex-1">
                  <span className="mb-1 block text-sm font-semibold text-slate-600">학급명</span>
                  <input
                    value={className}
                    onChange={(e) => setClassName(e.target.value)}
                    placeholder="예: 4학년 2반"
                    className="h-12 w-full rounded-xl border border-slate-300 px-3 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
                  />
                </label>
                <button
                  disabled={creating || !school.trim() || !className.trim()}
                  className="flex h-12 items-center gap-2 rounded-xl bg-sky-600 px-5 font-bold text-white hover:bg-sky-700 disabled:bg-slate-300"
                >
                  {creating ? <Loader2 className="size-5 animate-spin" /> : <Plus className="size-5" />}
                  수업 코드 만들기
                </button>
              </form>

              {rooms.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-slate-500">내 수업방:</span>
                  {rooms.map((r) => (
                    <button
                      key={r.code}
                      onClick={() => setRoom(r)}
                      className={`min-h-10 rounded-full px-3 text-sm font-semibold ${
                        room?.code === r.code ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                      }`}
                    >
                      {r.className} · {r.code}
                    </button>
                  ))}
                </div>
              )}

              {room ? (
                <div className="flex flex-wrap items-center gap-6 rounded-2xl bg-gradient-to-r from-amber-50 to-pink-50 p-5">
                  <div>
                    <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-500">
                      <School className="size-4" /> {room.school} {room.className}
                    </p>
                    <p className="font-display text-7xl tracking-[0.15em] text-slate-800">{room.code}</p>
                    <p className="text-sm text-slate-500">학생들은 수업 코드와 이름만 넣으면 입장해요.</p>
                  </div>
                  <div className="min-w-64 flex-1 space-y-1">
                    <label className="block text-xs font-semibold text-slate-500">학생 접속 주소 (QR에 담기는 주소)</label>
                    <input
                      value={baseUrl}
                      onChange={(e) => setBaseUrl(e.target.value)}
                      className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm"
                    />
                    <p className="break-all font-mono text-xs text-slate-500">{joinUrl}</p>
                    {isLocalhost && (
                      <p className="text-xs text-amber-700">
                        ⚠️ localhost는 학생 기기에서 열리지 않아요. 이 PC의 네트워크 주소(예: http://192.168.0.10:3000)로 바꿔 주세요.
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <p className="rounded-2xl bg-slate-50 p-5 text-slate-500">위에서 학급명을 넣고 수업 코드를 만들어 주세요.</p>
              )}
            </div>

            {room && (
              <button
                onClick={() => setBigQr(true)}
                className="group relative flex flex-col items-center justify-center gap-2 rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200 hover:ring-sky-300"
                title="크게 보기"
              >
                <QRCodeSVG value={joinUrl} size={220} level="M" marginSize={1} />
                <span className="flex items-center gap-1 text-sm font-semibold text-slate-500 group-hover:text-sky-600">
                  <Maximize2 className="size-4" /> 칠판에 크게 띄우기
                </span>
              </button>
            )}
          </section>

          {/* 일괄 출력 의뢰 액션 바 */}
          {room && (
            <section className="flex flex-wrap items-center gap-3 rounded-3xl bg-slate-800 p-4 text-white">
              <div className="flex items-center gap-2 pl-2 pr-4">
                <Inbox className="size-6 text-amber-300" />
                <span className="text-lg font-bold">제출 {subs.length}개</span>
              </div>
              <div className="flex flex-1 flex-wrap gap-1.5">
                {stats
                  .filter((s) => s.count > 0)
                  .map((s) => (
                    <span key={s.color} className="flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-sm">
                      <span className="size-3 rounded-full ring-1 ring-white/50" style={{ background: FILAMENT_COLORS[s.color].hex }} />
                      {s.label} {s.count}
                    </span>
                  ))}
              </div>
              <button
                disabled={!subs.length || zipping}
                onClick={async () => {
                  setZipping(true);
                  try {
                    await downloadZip(room, subs);
                  } finally {
                    setZipping(false);
                  }
                }}
                className="flex min-h-12 items-center gap-2 rounded-xl bg-amber-400 px-4 font-bold text-slate-900 hover:bg-amber-300 disabled:opacity-40"
              >
                {zipping ? <Loader2 className="size-5 animate-spin" /> : <PackageOpen className="size-5" />}
                전체 STL 일괄 ZIP 다운로드
              </button>
              <button
                disabled={!subs.length}
                onClick={() => setShowSheet(true)}
                className="flex min-h-12 items-center gap-2 rounded-xl bg-white px-4 font-bold text-slate-800 hover:bg-slate-100 disabled:opacity-40"
              >
                <ClipboardList className="size-5" />
                메이커스페이스 제작 의뢰서 (CSV/인쇄)
              </button>
            </section>
          )}

          {/* 제출 현황 그리드 */}
          {room && (
            <section>
              <h2 className="mb-3 flex items-center gap-2 text-lg font-bold text-slate-700">
                제출 현황
                <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                  <span className="size-2 animate-pulse rounded-full bg-emerald-500" /> 실시간
                </span>
              </h2>
              {subs.length === 0 ? (
                <div className="grid place-items-center rounded-3xl border-2 border-dashed border-slate-300 bg-white py-16 text-center text-slate-400">
                  <Inbox className="mb-2 size-10" />
                  아직 제출된 작품이 없어요. 학생들이 제출하면 여기에 바로 나타나요.
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                  {subs.map((s) => (
                    <article
                      key={s.id}
                      className={`overflow-hidden rounded-2xl bg-white shadow-sm ring-1 transition ${
                        freshIds.has(s.id) ? "pop-in ring-4 ring-emerald-400" : "ring-slate-200"
                      }`}
                    >
                      <div className="relative aspect-[4/3] bg-gradient-to-b from-sky-50 to-amber-50">
                        {s.thumbnail ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={s.thumbnail} alt={`${s.studentName} 작품`} className="h-full w-full object-cover" />
                        ) : (
                          <div className="grid h-full place-items-center text-4xl">🧊</div>
                        )}
                        {freshIds.has(s.id) && (
                          <span className="absolute right-2 top-2 rounded-full bg-emerald-500 px-2 py-0.5 text-xs font-bold text-white">NEW</span>
                        )}
                      </div>
                      <div className="space-y-2 p-3">
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="truncate text-lg font-bold text-slate-800">{s.studentName}</h3>
                          <span className="shrink-0 text-xs text-slate-400">{formatTime(s.createdAt)}</span>
                        </div>
                        <div className="flex flex-wrap gap-1 text-xs font-semibold">
                          <span className={`rounded-full px-2 py-0.5 ${s.mode === "template" ? "bg-violet-100 text-violet-700" : s.mode === "photo" ? "bg-amber-100 text-amber-800" : s.mode === "relief" ? "bg-emerald-100 text-emerald-700" : s.mode === "canvas" ? "bg-pink-100 text-pink-700" : "bg-sky-100 text-sky-700"}`}>
                            {MODE_LABEL[s.mode]}
                          </span>
                          <span className={`rounded-full px-2 py-0.5 ring-1 ${FILAMENT_COLORS[s.color].badge}`}>
                            ● {FILAMENT_COLORS[s.color].label}
                          </span>
                          {!!s.paintColors?.length && (
                            <span className="flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-slate-600 ring-1 ring-slate-200" title="색칠한 색 (다색 출력)">
                              🎨
                              {s.paintColors.map((c) => (
                                <span key={c} className="size-3 rounded-full ring-1 ring-black/10" style={{ background: FILAMENT_COLORS[c].hex }} />
                              ))}
                            </span>
                          )}
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">
                            {s.shape ? SHAPE_LABEL[s.shape] : MODE_LABEL[s.mode]} · {s.sizeMm}mm
                          </span>
                        </div>
                        <div className="flex gap-1.5">
                          <button
                            onClick={async () => downloadBlob(await loadFile(s.stl), fileNames.get(s.id)!)}
                            title="3D 프린터용 파일"
                            className="flex min-h-10 flex-1 items-center justify-center gap-1 rounded-lg bg-slate-800 text-sm font-semibold text-white hover:bg-slate-700"
                          >
                            <Download className="size-4" /> .stl
                          </button>
                          <button
                            onClick={async () => {
                              const name = fileNames.get(s.id)!.replace(/\.stl$/, "");
                              downloadBlob(await stlToGlb(s, name), `${name}.glb`);
                            }}
                            title="블렌더에서 파일 → 가져오기 → glTF 2.0 으로 열어요 (색깔 포함)"
                            className="flex min-h-10 flex-1 items-center justify-center gap-1 rounded-lg bg-orange-500 text-sm font-semibold text-white hover:bg-orange-600"
                          >
                            <Box className="size-4" /> 블렌더
                          </button>
                          {pendingDelete === s.id ? (
                            <button
                              onClick={() => {
                                svc.deleteSubmission(s.id);
                                setPendingDelete(null);
                              }}
                              onBlur={() => setPendingDelete(null)}
                              className="min-h-10 rounded-lg bg-red-500 px-2 text-xs font-bold text-white"
                            >
                              삭제 확인
                            </button>
                          ) : (
                            <button
                              onClick={() => setPendingDelete(s.id)}
                              className="grid min-h-10 w-10 place-items-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500"
                              aria-label="삭제"
                            >
                              <Trash2 className="size-4" />
                            </button>
                          )}
                        </div>
                        {s.model3mf && (
                          <button
                            onClick={async () => downloadBlob(await loadFile(s.model3mf!), fileNames.get(s.id)!.replace(/\.stl$/, ".3mf"))}
                            title={
                              new Set([s.color, ...(s.paintColors ?? [])]).size > 4
                                ? "필라멘트가 5가지 이상이에요. AMS 1대(4색)로는 한 번에 못 뽑으니 색을 바꾸거나 여러 대를 연결하세요."
                                : "다색 프린터용: 슬라이서에서 부품마다 이름에 적힌 색 필라멘트를 지정하세요"
                            }
                            className={`flex min-h-10 w-full items-center justify-center gap-1 rounded-lg text-sm font-semibold text-white hover:opacity-90 ${
                              new Set([s.color, ...(s.paintColors ?? [])]).size > 4
                                ? "bg-orange-500"
                                : "bg-gradient-to-r from-pink-500 to-violet-500"
                            }`}
                          >
                            <Download className="size-4" /> 다색 3MF ({new Set([s.color, ...(s.paintColors ?? [])]).size}색)
                            {new Set([s.color, ...(s.paintColors ?? [])]).size > 4 && " ⚠️"}
                          </button>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          )}

          <p className="text-xs text-slate-400">
            {serverMode
              ? "🔒 작품은 학교 서버(Supabase)에 저장되고, 로그인한 선생님은 자기 수업방의 작품만 볼 수 있어요."
              : "ℹ️ 로컬 테스트 모드: 데이터가 이 브라우저(IndexedDB)에만 저장돼 다른 기기와 공유되지 않아요. 배포하려면 Supabase를 연결하세요 (README 참고)."}
          </p>
        </main>
      </div>

      {/* QR 크게 보기 */}
      {bigQr && room && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-white print:hidden" onClick={() => setBigQr(false)}>
          <button className="absolute right-6 top-6 grid size-12 place-items-center rounded-full bg-slate-100" aria-label="닫기">
            <X className="size-6" />
          </button>
          <p className="font-display text-4xl text-slate-700">
            {room.school} {room.className}
          </p>
          <QRCodeSVG value={joinUrl} size={Math.min(560, typeof window !== "undefined" ? window.innerHeight * 0.55 : 480)} level="M" marginSize={2} />
          <p className="font-display text-8xl tracking-[0.2em] text-slate-800">{room.code}</p>
          <p className="text-xl text-slate-500">카메라로 QR을 찍거나, 수업 코드를 입력하세요!</p>
        </div>
      )}

      {/* 제작 의뢰서 모달 */}
      {showSheet && room && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-6 print:hidden" onClick={() => setShowSheet(false)}>
          <div className="flex max-h-full w-full max-w-5xl flex-col rounded-3xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 border-b border-slate-200 px-6 py-4">
              <h2 className="flex-1 text-lg font-bold">제작 의뢰서 미리보기</h2>
              <button
                onClick={() => downloadCsv(room, subs)}
                className="flex min-h-12 items-center gap-2 rounded-xl bg-emerald-600 px-4 font-bold text-white hover:bg-emerald-700"
              >
                <FileSpreadsheet className="size-5" /> CSV 다운로드
              </button>
              <button
                onClick={() => window.print()}
                className="flex min-h-12 items-center gap-2 rounded-xl bg-slate-800 px-4 font-bold text-white hover:bg-slate-700"
              >
                <Printer className="size-5" /> 인쇄하기
              </button>
              <button onClick={() => setShowSheet(false)} className="grid size-12 place-items-center rounded-xl hover:bg-slate-100" aria-label="닫기">
                <X className="size-5" />
              </button>
            </div>
            <div className="overflow-auto p-6">
              <RequestSheet room={room} subs={subs} />
            </div>
          </div>
        </div>
      )}

      {/* 인쇄 전용 */}
      {room && (
        <div className="hidden print:block">
          <RequestSheet room={room} subs={subs} />
        </div>
      )}
    </>
  );
}
