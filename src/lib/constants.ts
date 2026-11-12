import type { ColorKey, MakeMode, Purpose, ShapeKey } from "./types";

/**
 * 필라멘트 색 (3D 프린터용 PLA로 흔히 구할 수 있는 색).
 * light: 밝은 색이라 선택 표시(✓)를 어둡게 / metallic: 금속 느낌(실크 PLA)
 */
export const FILAMENT_COLORS: Record<
  ColorKey,
  { label: string; hex: string; badge: string; light?: boolean; metallic?: boolean }
> = {
  red: { label: "빨강", hex: "#EF4444", badge: "bg-red-100 text-red-700 ring-red-300" },
  orange: { label: "주황", hex: "#F97316", badge: "bg-orange-100 text-orange-700 ring-orange-300" },
  yellow: { label: "노랑", hex: "#FACC15", badge: "bg-yellow-100 text-yellow-800 ring-yellow-300", light: true },
  lime: { label: "연두", hex: "#A3E635", badge: "bg-lime-100 text-lime-800 ring-lime-300", light: true },
  green: { label: "초록", hex: "#22C55E", badge: "bg-green-100 text-green-700 ring-green-300" },
  sky: { label: "하늘", hex: "#38BDF8", badge: "bg-sky-100 text-sky-700 ring-sky-300", light: true },
  blue: { label: "파랑", hex: "#3B82F6", badge: "bg-blue-100 text-blue-700 ring-blue-300" },
  purple: { label: "보라", hex: "#A855F7", badge: "bg-purple-100 text-purple-700 ring-purple-300" },
  pink: { label: "분홍", hex: "#F472B6", badge: "bg-pink-100 text-pink-700 ring-pink-300" },
  brown: { label: "갈색", hex: "#92400E", badge: "bg-amber-100 text-amber-900 ring-amber-400" },
  white: { label: "하양", hex: "#F8FAFC", badge: "bg-slate-100 text-slate-700 ring-slate-300", light: true },
  gray: { label: "회색", hex: "#9CA3AF", badge: "bg-gray-100 text-gray-700 ring-gray-300", light: true },
  black: { label: "검정", hex: "#1F2937", badge: "bg-slate-800 text-white ring-slate-900" },
  gold: { label: "금색", hex: "#D4A72C", badge: "bg-yellow-50 text-yellow-800 ring-yellow-500", light: true, metallic: true },
  silver: { label: "은색", hex: "#C0C7D0", badge: "bg-slate-50 text-slate-600 ring-slate-400", light: true, metallic: true },
};

export const COLOR_ORDER: ColorKey[] = [
  "red", "orange", "yellow", "lime", "green",
  "sky", "blue", "purple", "pink", "brown",
  "white", "gray", "black", "gold", "silver",
];

/** 미리보기 hex → 색 정보 (금속 느낌 등) */
export function colorInfoByHex(hex: string) {
  return Object.values(FILAMENT_COLORS).find((c) => c.hex.toLowerCase() === hex.toLowerCase());
}

export const SHAPES: { key: ShapeKey; label: string; emoji: string }[] = [
  { key: "star", label: "별", emoji: "⭐" },
  { key: "heart", label: "하트", emoji: "💖" },
  { key: "rocket", label: "로켓", emoji: "🚀" },
  { key: "nametag", label: "둥근 이름표", emoji: "🏷️" },
  { key: "bear", label: "춘천 곰돌이", emoji: "🐻" },
];

export const SHAPE_LABEL: Record<ShapeKey, string> = Object.fromEntries(
  SHAPES.map((s) => [s.key, s.label]),
) as Record<ShapeKey, string>;

export const MODE_LABEL: Record<MakeMode, string> = {
  template: "템플릿",
  canvas: "그림판",
  drawing: "손그림",
  photo: "사진",
  relief: "사진 판",
};

export const PURPOSE_LABEL: Record<Purpose, string> = {
  keyring: "열쇠고리",
  magnet: "이름표/자석",
};

export const SIZE_MIN = 50;
export const SIZE_MAX = 100;
export const SIZE_DEFAULT = 60;

export const SESSION_KEY = "cc-maker:session";
export const LAST_SUBMISSION_KEY = "cc-maker:last-submission";
export const TEACHER_ROOM_KEY = "cc-maker:teacher-room";
