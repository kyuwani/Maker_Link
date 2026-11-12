import { COLOR_ORDER } from "@/lib/constants";
import { findRoom, getAdmin, isAdminConfigured } from "@/lib/supabase/admin";
import { WORKS_BUCKET, workPath } from "@/lib/supabase/config";

export const runtime = "nodejs";

const MODES = ["template", "canvas", "drawing", "photo", "relief"];

/**
 * 학생 제출 1단계: 작품 정보를 등록하고, 파일을 저장소에 '직접' 올릴 수 있는 1회용 주소를 돌려줌.
 * (파일이 이 서버를 거치지 않아 Vercel 요청 크기 제한 4.5MB에 걸리지 않음)
 */
export async function POST(req: Request) {
  if (!isAdminConfigured()) return Response.json({ error: "server_not_configured" }, { status: 503 });
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  const roomCode = String(body.roomCode ?? "");
  const studentName = String(body.studentName ?? "").trim();
  const mode = String(body.mode ?? "");
  const color = String(body.color ?? "");
  const sizeMm = Math.round(Number(body.sizeMm));
  const paintColors = Array.isArray(body.paintColors) ? body.paintColors.map(String).filter((c) => COLOR_ORDER.includes(c as never)) : [];
  const has3mf = body.has3mf === true;

  if (!studentName || studentName.length > 10) return Response.json({ error: "bad_name" }, { status: 400 });
  if (!MODES.includes(mode) || !COLOR_ORDER.includes(color as never) || !(sizeMm >= 30 && sizeMm <= 150)) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  if (!(await findRoom(roomCode))) return Response.json({ error: "room_not_found" }, { status: 404 });

  const admin = getAdmin();
  const { data, error } = await admin
    .from("submissions")
    .insert({
      room_code: roomCode,
      student_name: studentName,
      mode,
      color,
      purpose: "keyring",
      size_mm: sizeMm,
      paint_colors: paintColors,
      has_3mf: has3mf,
    })
    .select("id, created_at")
    .single();
  if (error || !data) {
    console.error("submission insert", error);
    return Response.json({ error: "db_error" }, { status: 500 });
  }

  const files = ["model.stl", "thumb.jpg", ...(has3mf ? ["model.3mf"] : [])] as const;
  const uploads: Record<string, { path: string; token: string }> = {};
  for (const f of files) {
    const path = workPath(roomCode, data.id, f as "model.stl");
    const { data: signed, error: e } = await admin.storage.from(WORKS_BUCKET).createSignedUploadUrl(path);
    if (e || !signed) {
      console.error("signed upload", e);
      return Response.json({ error: "storage_error" }, { status: 500 });
    }
    uploads[f] = { path, token: signed.token };
  }
  return Response.json({ id: data.id, createdAt: data.created_at, uploads });
}
