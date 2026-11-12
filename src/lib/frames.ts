"use client";

import { erode, type Mask } from "./geometry/contours";
import type { Stroke } from "./drawpad";

/**
 * 그림판 1단계 '캐릭터 틀'.
 * 모두 이 앱만의 오리지널 캐릭터이고, 원·타원·둥근 네모를 합친 실루엣의 '외곽선'만 틀로 씁니다.
 * (쿠키 틀처럼 한 덩어리라 항상 출력 가능하고, 안쪽은 아이들이 꾸미는 공간)
 */

type Shape =
  | { t: "c"; x: number; y: number; r: number }
  | { t: "e"; x: number; y: number; rx: number; ry: number; rot?: number }
  | { t: "r"; x: number; y: number; w: number; h: number; r: number }
  | { t: "p"; pts: [number, number][]; round: number };

export interface Frame {
  key: string;
  nick: string; // 캐릭터 이름
  kind: string; // 무엇인지
  tint: string; // 미리보기 색
  shapes: Shape[];
  face: { cx: number; eyeY: number; dx: number; mouthY: number; size?: number };
}

const c = (x: number, y: number, r: number): Shape => ({ t: "c", x, y, r });
const e = (x: number, y: number, rx: number, ry: number, rot = 0): Shape => ({ t: "e", x, y, rx, ry, rot });
const r = (x: number, y: number, w: number, h: number, rr: number): Shape => ({ t: "r", x, y, w, h, r: rr });
const p = (pts: [number, number][], round = 0.03): Shape => ({ t: "p", pts, round });

function star(cx: number, cy: number, ro: number, ri: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 ? ri : ro;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    out.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad]);
  }
  return out;
}

export const FRAMES: Frame[] = [
  { key: "bear", nick: "춘곰이", kind: "곰돌이", tint: "#f59e0b",
    shapes: [c(0.5, 0.57, 0.31), c(0.25, 0.3, 0.12), c(0.75, 0.3, 0.12)],
    face: { cx: 0.5, eyeY: 0.53, dx: 0.12, mouthY: 0.62 } },
  { key: "cat", nick: "야옹이", kind: "고양이", tint: "#f472b6",
    shapes: [e(0.5, 0.6, 0.35, 0.28), p([[0.22, 0.46], [0.29, 0.17], [0.44, 0.35]], 0.02), p([[0.56, 0.35], [0.71, 0.17], [0.78, 0.46]], 0.02)],
    face: { cx: 0.5, eyeY: 0.58, dx: 0.13, mouthY: 0.67 } },
  { key: "rabbit", nick: "깡총이", kind: "토끼", tint: "#a78bfa",
    shapes: [c(0.5, 0.66, 0.25), e(0.4, 0.3, 0.08, 0.21, -0.15), e(0.6, 0.3, 0.08, 0.21, 0.15)],
    face: { cx: 0.5, eyeY: 0.64, dx: 0.1, mouthY: 0.72 } },
  { key: "chick", nick: "삐약이", kind: "병아리", tint: "#facc15",
    shapes: [c(0.5, 0.56, 0.3), c(0.44, 0.25, 0.06), c(0.52, 0.22, 0.065), c(0.6, 0.26, 0.05),
      e(0.22, 0.6, 0.08, 0.13, 0.4), e(0.78, 0.6, 0.08, 0.13, -0.4), e(0.41, 0.88, 0.08, 0.045), e(0.59, 0.88, 0.08, 0.045)],
    face: { cx: 0.5, eyeY: 0.52, dx: 0.11, mouthY: 0.61 } },
  { key: "ghost", nick: "부끄", kind: "아기 유령", tint: "#94a3b8",
    shapes: [c(0.5, 0.42, 0.28), r(0.22, 0.42, 0.56, 0.34, 0), c(0.29, 0.76, 0.07), c(0.43, 0.76, 0.07), c(0.57, 0.76, 0.07), c(0.71, 0.76, 0.07),
      e(0.2, 0.56, 0.08, 0.045, -0.5), e(0.8, 0.56, 0.08, 0.045, 0.5)],
    face: { cx: 0.5, eyeY: 0.44, dx: 0.1, mouthY: 0.54 } },
  { key: "dino", nick: "꼬마룡", kind: "아기 공룡", tint: "#4ade80",
    shapes: [e(0.5, 0.6, 0.28, 0.31), p([[0.3, 0.38], [0.36, 0.18], [0.45, 0.32]]), p([[0.42, 0.31], [0.5, 0.12], [0.58, 0.31]]), p([[0.55, 0.32], [0.64, 0.18], [0.7, 0.38]]),
      e(0.23, 0.62, 0.08, 0.045, -0.4), e(0.77, 0.62, 0.08, 0.045, 0.4), e(0.38, 0.9, 0.09, 0.05), e(0.62, 0.9, 0.09, 0.05)],
    face: { cx: 0.5, eyeY: 0.52, dx: 0.11, mouthY: 0.63 } },
  { key: "robot", nick: "삐빅이", kind: "로봇", tint: "#38bdf8",
    shapes: [r(0.2, 0.3, 0.6, 0.46, 0.1), r(0.48, 0.16, 0.04, 0.16, 0.02), c(0.5, 0.15, 0.06), r(0.12, 0.44, 0.1, 0.18, 0.04), r(0.78, 0.44, 0.1, 0.18, 0.04), r(0.33, 0.74, 0.34, 0.14, 0.05)],
    face: { cx: 0.5, eyeY: 0.48, dx: 0.13, mouthY: 0.6 } },
  { key: "whale", nick: "뿌뿌", kind: "아기 고래", tint: "#60a5fa",
    shapes: [e(0.44, 0.62, 0.35, 0.23), p([[0.72, 0.6], [0.84, 0.42], [0.95, 0.34], [0.91, 0.46], [0.96, 0.56], [0.84, 0.52]], 0.035),
      e(0.36, 0.33, 0.035, 0.07), c(0.3, 0.25, 0.045), c(0.42, 0.25, 0.045)],
    face: { cx: 0.32, eyeY: 0.58, dx: 0.08, mouthY: 0.67, size: 0.9 } },
  { key: "alien", nick: "뽀글이", kind: "외계인", tint: "#34d399",
    shapes: [e(0.5, 0.6, 0.3, 0.3), e(0.38, 0.27, 0.025, 0.11, -0.45), e(0.62, 0.27, 0.025, 0.11, 0.45), c(0.33, 0.16, 0.055), c(0.67, 0.16, 0.055)],
    face: { cx: 0.5, eyeY: 0.58, dx: 0.13, mouthY: 0.7 } },
  { key: "frog", nick: "개굴이", kind: "개구리", tint: "#84cc16",
    shapes: [e(0.5, 0.62, 0.36, 0.25), c(0.3, 0.4, 0.12), c(0.7, 0.4, 0.12)],
    face: { cx: 0.5, eyeY: 0.4, dx: 0.2, mouthY: 0.66 } },
  { key: "penguin", nick: "뒤뚱이", kind: "펭귄", tint: "#64748b",
    shapes: [e(0.5, 0.55, 0.26, 0.34), e(0.25, 0.58, 0.065, 0.15, 0.35), e(0.75, 0.58, 0.065, 0.15, -0.35), e(0.41, 0.9, 0.08, 0.045), e(0.59, 0.9, 0.08, 0.045)],
    face: { cx: 0.5, eyeY: 0.42, dx: 0.09, mouthY: 0.5 } },
  { key: "star", nick: "반짝이", kind: "별 친구", tint: "#fb923c",
    shapes: [p(star(0.5, 0.55, 0.4, 0.19), 0.04)],
    face: { cx: 0.5, eyeY: 0.53, dx: 0.08, mouthY: 0.61 } },
];

/** 캐릭터 실루엣을 (색으로) 채워 그림 */
export function drawSilhouette(ctx: CanvasRenderingContext2D, f: Frame, size: number, color: string) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineJoin = "round";
  for (const s of f.shapes) {
    ctx.beginPath();
    if (s.t === "c") ctx.arc(s.x * size, s.y * size, s.r * size, 0, Math.PI * 2);
    else if (s.t === "e") ctx.ellipse(s.x * size, s.y * size, s.rx * size, s.ry * size, s.rot ?? 0, 0, Math.PI * 2);
    else if (s.t === "r") ctx.roundRect(s.x * size, s.y * size, s.w * size, s.h * size, s.r * size);
    else {
      s.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x * size, y * size) : ctx.moveTo(x * size, y * size)));
      ctx.closePath();
      // 둥근 모서리: 같은 모양을 굵은 둥근 선으로 한 번 더
      ctx.lineWidth = s.round * 2 * size;
      ctx.stroke();
    }
    ctx.fill();
  }
  ctx.restore();
}

/** 웃는 얼굴 (지울 수 있는 일반 펜 획) */
export function faceStrokes(f: Frame): Stroke[] {
  const { cx, eyeY, dx, mouthY, size = 1 } = f.face;
  const dot = (x: number, y: number): Stroke => ({ pts: [x, y], w: 0.05 * size, erase: false });
  const smile: number[] = [];
  const mr = 0.06 * size;
  for (let i = 0; i <= 16; i++) {
    const a = Math.PI * (0.15 + (0.7 * i) / 16);
    smile.push(cx + Math.cos(a) * mr, mouthY - mr * 0.6 + Math.sin(a) * mr);
  }
  return [dot(cx - dx, eyeY), dot(cx + dx, eyeY), { pts: smile, w: 0.024, erase: false }];
}

/** 실루엣 → 외곽선만 남긴 그림판 레이어(검은 선 + 투명 배경 PNG) */
export function frameOutlineLayer(f: Frame, res = 768, line = 0.024): Stroke {
  const cv = document.createElement("canvas");
  cv.width = res;
  cv.height = res;
  const ctx = cv.getContext("2d", { willReadFrequently: true })!;
  drawSilhouette(ctx, f, res, "#000");
  const img = ctx.getImageData(0, 0, res, res);
  const mask: Mask = { width: res, height: res, data: new Uint8Array(res * res) };
  for (let i = 0; i < mask.data.length; i++) mask.data[i] = img.data[i * 4 + 3] >= 128 ? 1 : 0;
  const inner = erode(mask, Math.round(line * res));
  for (let i = 0; i < mask.data.length; i++) {
    const on = mask.data[i] && !inner.data[i];
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 17;
    img.data[i * 4 + 3] = on ? 255 : 0;
  }
  ctx.putImageData(img, 0, 0);
  return { pts: [], w: 0, erase: false, img: cv.toDataURL("image/png") };
}
