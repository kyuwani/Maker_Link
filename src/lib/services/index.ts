import { isSupabaseConfigured } from "../supabase/config";
import { LocalClassroomService } from "./local-classroom-service";
import { SupabaseClassroomService } from "./supabase-classroom-service";
import type { ClassroomService } from "./types";

/**
 * Supabase 설정(NEXT_PUBLIC_SUPABASE_URL + 키)이 있으면 서버 저장,
 * 없으면 '로컬 테스트 모드'(이 브라우저 안 IndexedDB)로 동작합니다.
 */
let instance: ClassroomService | null = null;

export function getClassroomService(): ClassroomService {
  if (!instance) instance = isSupabaseConfigured() ? new SupabaseClassroomService() : new LocalClassroomService();
  return instance;
}

export const isServerMode = isSupabaseConfigured;

export type { ClassroomService } from "./types";
