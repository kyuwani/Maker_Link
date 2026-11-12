"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_PUBLIC_KEY, SUPABASE_URL } from "./config";

/** 브라우저용 클라이언트 (선생님 로그인 세션 보관) */
let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: "cc-maker-auth" },
    });
  }
  return client;
}
