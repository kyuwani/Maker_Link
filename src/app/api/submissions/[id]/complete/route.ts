import { getAdmin, isAdminConfigured } from "@/lib/supabase/admin";
import { WORKS_BUCKET } from "@/lib/supabase/config";

export const runtime = "nodejs";

/** 학생 제출 2단계: 파일이 다 올라갔는지 확인하고 선생님 화면에 보이게 함 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isAdminConfigured()) return Response.json({ error: "server_not_configured" }, { status: 503 });
  const { id } = await params;
  const admin = getAdmin();
  const { data: sub } = await admin.from("submissions").select("id, room_code").eq("id", id).maybeSingle();
  if (!sub) return Response.json({ error: "not_found" }, { status: 404 });
  const { data: listed } = await admin.storage.from(WORKS_BUCKET).list(`${sub.room_code}/${id}`);
  if (!listed?.some((f) => f.name === "model.stl")) return Response.json({ error: "file_missing" }, { status: 409 });
  await admin.from("submissions").update({ ready: true }).eq("id", id);
  return Response.json({ ok: true });
}
