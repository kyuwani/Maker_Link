// 공용 도메인 타입 — 서비스 레이어(IndexedDB / 추후 Supabase)와 UI가 함께 사용합니다.

export type ColorKey =
  | "red" | "orange" | "yellow" | "lime" | "green" | "sky" | "blue" | "purple" | "pink"
  | "brown" | "white" | "gray" | "black" | "gold" | "silver";
export type ShapeKey = "star" | "heart" | "rocket" | "nametag" | "bear";
export type Purpose = "keyring" | "magnet";
export type MakeMode = "template" | "canvas" | "drawing" | "photo" | "relief";

export interface Room {
  code: string; // 4자리 수업 코드
  school: string;
  className: string;
  createdAt: number;
}

/** 파일: 바로 들고 있거나(로컬 모드), 필요할 때 내려받는 함수(서버 모드) */
export type FileRef = Blob | (() => Promise<Blob>);

export async function loadFile(f: FileRef): Promise<Blob> {
  return typeof f === "function" ? f() : f;
}

export interface Submission {
  id: string;
  roomCode: string;
  studentName: string;
  mode: MakeMode;
  color: ColorKey;
  shape?: ShapeKey; // (예전) 템플릿 모드일 때
  purpose: Purpose;
  sizeMm: number;
  engraving?: string;
  createdAt: number;
  thumbnail?: string; // 작은 이미지 (data URL 또는 주소)
  stl: FileRef; // 바이너리 STL
  /** 색칠한 색들 (다색 출력) */
  paintColors?: ColorKey[];
  /** 다색 프린터용 3MF (색칠했을 때만) */
  model3mf?: FileRef;
}

/** 학생이 새로 제출할 때 (파일을 직접 들고 있음) */
export interface NewSubmission {
  roomCode: string;
  studentName: string;
  mode: MakeMode;
  color: ColorKey;
  purpose: Purpose;
  sizeMm: number;
  thumbnail?: string; // data URL
  stl: Blob;
  paintColors?: ColorKey[];
  model3mf?: Blob;
}

export interface StudentSession {
  code: string;
  name: string;
}
