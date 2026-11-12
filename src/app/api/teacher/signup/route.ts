import { getAdmin, isAdminConfigured } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * 선생님 가입. TEACHER_SIGNUP_CODE(학교 가입 코드)를 정해 두면 그 코드를 아는 사람만 가입할 수 있어요.
 * 메일 인증 없이 바로 쓸 수 있게 서버에서 계정을 만듭니다.
 */
export async function POST(req: Request) {
  if (!isAdminConfigured()) return Response.json({ error: "server_not_configured" }, { status: 503 });
  let body: { email?: string; password?: string; code?: string; name?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const required = process.env.TEACHER_SIGNUP_CODE;
  if (required && String(body.code ?? "").trim() !== required) {
    return Response.json({ error: "bad_signup_code" }, { status: 403 });
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return Response.json({ error: "bad_email" }, { status: 400 });
  if (password.length < 8) return Response.json({ error: "weak_password" }, { status: 400 });

  const { error } = await getAdmin().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name: String(body.name ?? "").slice(0, 20), role: "teacher" },
  });
  if (error) {
    const exists = /already|registered|exists/i.test(error.message);
    return Response.json({ error: exists ? "email_exists" : "signup_failed" }, { status: exists ? 409 : 500 });
  }
  return Response.json({ ok: true });
}
