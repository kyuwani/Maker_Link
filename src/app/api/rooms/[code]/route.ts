import { findRoom, isAdminConfigured } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/** 학생 입장: 수업 코드가 진짜 있는지 (학교·학급 이름만 알려 줌) */
export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  if (!isAdminConfigured()) return Response.json({ error: "server_not_configured" }, { status: 503 });
  const { code } = await params;
  const room = await findRoom(code);
  if (!room) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({ code: room.code, school: room.school, className: room.class_name, createdAt: room.created_at });
}
