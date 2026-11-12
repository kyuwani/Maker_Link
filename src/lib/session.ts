"use client";

import { SESSION_KEY } from "./constants";
import type { StudentSession } from "./types";

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export function loadSession(): StudentSession | null {
  return safe(() => {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as StudentSession;
    return s.code && s.name ? s : null;
  }, null);
}

export function saveSession(s: StudentSession) {
  safe(() => localStorage.setItem(SESSION_KEY, JSON.stringify(s)), undefined);
}

export function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

export function formatDateTime(ts: number) {
  return new Date(ts).toLocaleString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
