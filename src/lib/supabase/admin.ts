import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "./config";

/**
 * 서버 전용 관리자 클라이언트 (secret 키). 학생 작품 등록·수업 코드 확인 등에 사용.
 * 이 키는 절대 브라우저로 보내면 안 됩니다 (NEXT_PUBLIC_ 붙이지 말 것).
 */
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export const isAdminConfigured = () => !!(SUPABASE_URL && SECRET_KEY);

let admin: SupabaseClient | null = null;
export function getAdmin(): SupabaseClient {
  if (!admin) {
    admin = createClient(SUPABASE_URL, SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return admin;
}

/** 수업 코드가 실제로 있는지 (있으면 학교/학급 이름) */
export async function findRoom(code: string) {
  if (!/^\d{4}$/.test(code)) return null;
  const { data } = await getAdmin().from("rooms").select("code, school, class_name, created_at").eq("code", code).maybeSingle();
  return data as { code: string; school: string; class_name: string; created_at: string } | null;
}
