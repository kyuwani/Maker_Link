"use client";

import type { ColorKey, MakeMode, NewSubmission, Purpose, Room, Submission } from "../types";
import { getSupabase } from "../supabase/browser";
import { WORKS_BUCKET, workPath } from "../supabase/config";
import type { ClassroomService } from "./types";

type RoomRow = { code: string; school: string; class_name: string; created_at: string };
type SubRow = {
  id: string;
  room_code: string;
  student_name: string;
  mode: string;
  color: string;
  purpose: string;
  size_mm: number;
  paint_colors: string[] | null;
  has_3mf: boolean;
  created_at: string;
};

const toRoom = (r: RoomRow): Room => ({
  code: r.code,
  school: r.school,
  className: r.class_name,
  createdAt: new Date(r.created_at).getTime(),
});

async function fetchBlob(url: string): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`파일을 받지 못했어요 (${res.status})`);
  return res.blob();
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [head, b64] = dataUrl.split(",");
  const mime = head.match(/data:([^;]+)/)?.[1] ?? "image/jpeg";
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

/**
 * Supabase 구현.
 * - 선생님: 로그인 세션으로 직접 읽고 지움 (DB 접근 규칙이 자기 반 것만 허용)
 * - 학생: 계정이 없으므로 서버 API(/api/...)를 거쳐 수업 코드 확인·제출
 */
export class SupabaseClassroomService implements ClassroomService {
  readonly strictRoomCheck = true;

  // ── 학생 쪽 (서버 API) ──────────────────────────────
  async getRoom(code: string): Promise<Room | null> {
    if (!/^\d{4}$/.test(code)) return null;
    const res = await fetch(`/api/rooms/${code}`);
    if (!res.ok) return null;
    const r = await res.json();
    return { code: r.code, school: r.school, className: r.className, createdAt: new Date(r.createdAt).getTime() };
  }

  async addSubmission(input: NewSubmission): Promise<Submission> {
    const res = await fetch("/api/submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        roomCode: input.roomCode,
        studentName: input.studentName,
        mode: input.mode,
        color: input.color,
        sizeMm: input.sizeMm,
        paintColors: input.paintColors ?? [],
        has3mf: !!input.model3mf,
      }),
    });
    const meta = await res.json();
    if (!res.ok) throw new Error(meta.error ?? "제출 실패");

    // 파일은 저장소로 바로 올림 (1회용 주소)
    const storage = getSupabase().storage.from(WORKS_BUCKET);
    const files: [string, Blob | undefined][] = [
      ["model.stl", input.stl],
      ["thumb.jpg", input.thumbnail ? dataUrlToBlob(input.thumbnail) : undefined],
      ["model.3mf", input.model3mf],
    ];
    for (const [name, blob] of files) {
      const up = meta.uploads[name];
      if (!up || !blob) continue;
      const { error } = await storage.uploadToSignedUrl(up.path, up.token, blob);
      if (error) throw new Error(`파일 올리기 실패: ${error.message}`);
    }
    const done = await fetch(`/api/submissions/${meta.id}/complete`, { method: "POST" });
    if (!done.ok) throw new Error("제출 마무리 실패");

    return {
      ...input,
      id: meta.id,
      createdAt: new Date(meta.createdAt).getTime(),
    };
  }

  async getSubmission(id: string): Promise<Submission | null> {
    const res = await fetch(`/api/submissions/${id}`);
    if (!res.ok) return null;
    const s = await res.json();
    return {
      id: s.id,
      roomCode: s.roomCode,
      studentName: s.studentName,
      mode: s.mode as MakeMode,
      color: s.color as ColorKey,
      purpose: s.purpose as Purpose,
      sizeMm: s.sizeMm,
      paintColors: (s.paintColors ?? []) as ColorKey[],
      createdAt: new Date(s.createdAt).getTime(),
      thumbnail: s.thumbUrl ?? undefined,
      stl: () => fetchBlob(s.stlUrl),
      model3mf: s.model3mfUrl ? () => fetchBlob(s.model3mfUrl) : undefined,
    };
  }

  // ── 선생님 쪽 (로그인 세션) ─────────────────────────
  async createRoom({ school, className }: { school: string; className: string }): Promise<Room> {
    const sb = getSupabase();
    const { data: auth } = await sb.auth.getUser();
    if (!auth.user) throw new Error("로그인이 필요해요");
    for (let i = 0; i < 30; i++) {
      const code = String(Math.floor(1000 + Math.random() * 9000));
      const { data, error } = await sb
        .from("rooms")
        .insert({ code, school, class_name: className, teacher_id: auth.user.id })
        .select()
        .single();
      if (!error && data) return toRoom(data as RoomRow);
      if (error && error.code !== "23505") throw new Error(error.message); // 23505 = 코드 겹침 → 다시
    }
    throw new Error("사용 가능한 수업 코드가 없어요.");
  }

  async listRooms(): Promise<Room[]> {
    const { data } = await getSupabase().from("rooms").select("*").order("created_at", { ascending: false });
    return ((data ?? []) as RoomRow[]).map(toRoom);
  }

  async listSubmissions(roomCode: string): Promise<Submission[]> {
    const sb = getSupabase();
    const { data } = await sb
      .from("submissions")
      .select("*")
      .eq("room_code", roomCode)
      .eq("ready", true)
      .order("created_at", { ascending: false });
    const rows = (data ?? []) as SubRow[];
    const storage = sb.storage.from(WORKS_BUCKET);
    const thumbs = rows.length
      ? (await storage.createSignedUrls(rows.map((r) => workPath(r.room_code, r.id, "thumb.jpg")), 60 * 60)).data ?? []
      : [];
    const download = (path: string) => async () => {
      const { data: blob, error } = await storage.download(path);
      if (error || !blob) throw new Error("파일을 받지 못했어요");
      return blob;
    };
    return rows.map((r, i) => ({
      id: r.id,
      roomCode: r.room_code,
      studentName: r.student_name,
      mode: r.mode as MakeMode,
      color: r.color as ColorKey,
      purpose: r.purpose as Purpose,
      sizeMm: r.size_mm,
      paintColors: (r.paint_colors ?? []) as ColorKey[],
      createdAt: new Date(r.created_at).getTime(),
      thumbnail: thumbs[i]?.signedUrl ?? undefined,
      stl: download(workPath(r.room_code, r.id, "model.stl")),
      model3mf: r.has_3mf ? download(workPath(r.room_code, r.id, "model.3mf")) : undefined,
    }));
  }

  async deleteSubmission(id: string): Promise<void> {
    const sb = getSupabase();
    const { data } = await sb.from("submissions").select("room_code").eq("id", id).maybeSingle();
    if (!data) return;
    const folder = `${data.room_code}/${id}`;
    await sb.storage
      .from(WORKS_BUCKET)
      .remove(["model.stl", "model.3mf", "thumb.jpg"].map((f) => `${folder}/${f}`));
    await sb.from("submissions").delete().eq("id", id);
  }

  subscribeSubmissions(roomCode: string, cb: (items: Submission[]) => void): () => void {
    const sb = getSupabase();
    let alive = true;
    const refresh = () => this.listSubmissions(roomCode).then((items) => alive && cb(items));
    const channel = sb
      .channel(`room-${roomCode}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "submissions", filter: `room_code=eq.${roomCode}` }, () => refresh())
      .subscribe();
    // 실시간 연결이 끊겨도 15초마다 한 번씩 새로고침
    const timer = setInterval(refresh, 15_000);
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    refresh();
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      sb.removeChannel(channel);
    };
  }
}
