/**
 * Supabase 연결 설정. 값이 없으면 앱은 '로컬 테스트 모드'(브라우저 저장소)로 동작합니다.
 * Supabase 새 키 이름(publishable / secret)과 예전 이름(anon / service_role) 모두 받습니다.
 */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_PUBLIC_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const isSupabaseConfigured = () => !!(SUPABASE_URL && SUPABASE_PUBLIC_KEY);

export const WORKS_BUCKET = "works";

export function workPath(roomCode: string, id: string, file: "model.stl" | "model.3mf" | "thumb.jpg") {
  return `${roomCode}/${id}/${file}`;
}
