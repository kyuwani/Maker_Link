import { getAdmin, isAdminConfigured } from "@/lib/supabase/admin";
import { WORKS_BUCKET, workPath } from "@/lib/supabase/config";

export const runtime = "nodejs";

/** 학생 완료 화면: 방금 낸 작품 (작품 id는 추측할 수 없는 긴 값) → 잠깐 쓰는 파일 주소 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isAdminConfigured()) return Response.json({ error: "server_not_configured" }, { status: 503 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "not_found" }, { status: 404 });
  const admin = getAdmin();
  const { data: s } = await admin.from("submissions").select("*").eq("id", id).maybeSingle();
  if (!s) return Response.json({ error: "not_found" }, { status: 404 });
  const paths = [workPath(s.room_code, id, "model.stl"), workPath(s.room_code, id, "thumb.jpg")];
  if (s.has_3mf) paths.push(workPath(s.room_code, id, "model.3mf"));
  const { data: signed } = await admin.storage.from(WORKS_BUCKET).createSignedUrls(paths, 60 * 30);
  const url = (p: string) => signed?.find((x) => x.path === p)?.signedUrl ?? null;
  return Response.json({
    id: s.id,
    roomCode: s.room_code,
    studentName: s.student_name,
    mode: s.mode,
    color: s.color,
    purpose: s.purpose,
    sizeMm: s.size_mm,
    paintColors: s.paint_colors,
    createdAt: s.created_at,
    stlUrl: url(paths[0]),
    thumbUrl: url(paths[1]),
    model3mfUrl: s.has_3mf ? url(paths[2]) : null,
  });
}
