import * as THREE from "three";
import type { ShapeKey } from "../types";

/** 템플릿은 대략 [-1, 1] 단위 공간에서 정의하고, 모델 생성 시 mm 크기로 맞춥니다. */
export interface TemplateDef {
  build: () => THREE.Shape;
  /** 이름 각인이 들어갈 영역 (단위 공간) */
  textBox: { cx: number; cy: number; w: number; h: number };
}

function circlePath(cx: number, cy: number, r: number) {
  const p = new THREE.Path();
  p.absarc(cx, cy, r, 0, Math.PI * 2, true);
  return p;
}

/** 외부 점 T에서 원(C, r)에 그은 접선의 접점 각도 */
function tangentAngle(T: [number, number], C: [number, number], r: number, sign: 1 | -1) {
  const dx = T[0] - C[0];
  const dy = T[1] - C[1];
  const d = Math.hypot(dx, dy);
  return Math.atan2(dy, dx) + sign * Math.acos(r / d);
}

function star(): THREE.Shape {
  const s = new THREE.Shape();
  const outer = 1;
  const inner = 0.5;
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) s.moveTo(x, y);
    else s.lineTo(x, y);
  }
  s.closePath();
  return s;
}

function heart(): THREE.Shape {
  const r = 0.5;
  const R: [number, number] = [0.45, 0.35];
  const L: [number, number] = [-0.45, 0.35];
  const T: [number, number] = [0, -1];
  const aR = tangentAngle(T, R, r, 1);
  const aL = tangentAngle(T, L, r, -1);
  const notchY = 0.35 + Math.sqrt(r * r - 0.45 * 0.45);
  const notchFromR = Math.atan2(notchY - R[1], 0 - R[0]);
  const notchFromL = Math.atan2(notchY - L[1], 0 - L[0]);
  const s = new THREE.Shape();
  s.moveTo(T[0], T[1]);
  s.lineTo(R[0] + r * Math.cos(aR), R[1] + r * Math.sin(aR));
  s.absarc(R[0], R[1], r, aR, notchFromR, false);
  s.absarc(L[0], L[1], r, notchFromL, aL + Math.PI * 2, false);
  s.lineTo(T[0], T[1]);
  return s;
}

function rocket(): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(0, 1);
  s.quadraticCurveTo(0.46, 0.72, 0.42, 0.2);
  s.lineTo(0.42, -0.42);
  s.lineTo(0.78, -0.78);
  s.lineTo(0.78, -1);
  s.lineTo(0.42, -0.82);
  s.lineTo(-0.42, -0.82);
  s.lineTo(-0.78, -1);
  s.lineTo(-0.78, -0.78);
  s.lineTo(-0.42, -0.42);
  s.lineTo(-0.42, 0.2);
  s.quadraticCurveTo(-0.46, 0.72, 0, 1);
  s.holes.push(circlePath(0, 0.42, 0.15));
  return s;
}

function nametag(): THREE.Shape {
  const w = 1;
  const h = 0.55;
  const r = 0.3;
  const s = new THREE.Shape();
  s.moveTo(-w + r, -h);
  s.lineTo(w - r, -h);
  s.absarc(w - r, -h + r, r, -Math.PI / 2, 0, false);
  s.lineTo(w, h - r);
  s.absarc(w - r, h - r, r, 0, Math.PI / 2, false);
  s.lineTo(-w + r, h);
  s.absarc(-w + r, h - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(-w, -h + r);
  s.absarc(-w + r, -h + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}

/** 춘천 곰돌이: 둥근 얼굴 + 두 귀(원 합집합 외곽선) + 눈 구멍 */
function bear(): THREE.Shape {
  const R = 1;
  const er = 0.38;
  const ed = 1.0; // 귀 중심까지 거리
  // 두 원의 교점: 얼굴 중심에서 본 각도 차 δ
  const a = (R * R - er * er + ed * ed) / (2 * ed);
  const hh = Math.sqrt(R * R - a * a);
  const delta = Math.atan2(hh, a);
  const earAngles = [Math.PI / 4, (Math.PI * 3) / 4];
  const earC = earAngles.map((t) => [Math.cos(t) * ed, Math.sin(t) * ed] as [number, number]);
  const onHead = (t: number): [number, number] => [Math.cos(t) * R, Math.sin(t) * R];
  const earArc = (s: THREE.Shape, i: number, fromHeadAngle: number, toHeadAngle: number) => {
    const [ex, ey] = earC[i];
    const p1 = onHead(fromHeadAngle);
    const p2 = onHead(toHeadAngle);
    const f1 = Math.atan2(p1[1] - ey, p1[0] - ex);
    let f2 = Math.atan2(p2[1] - ey, p2[0] - ex);
    while (f2 <= f1) f2 += Math.PI * 2;
    s.absarc(ex, ey, er, f1, f2, false);
  };
  const [rA, lA] = earAngles;
  const s = new THREE.Shape();
  const start = onHead(rA + delta);
  s.moveTo(start[0], start[1]);
  s.absarc(0, 0, R, rA + delta, lA - delta, false); // 귀 사이 정수리
  earArc(s, 1, lA - delta, lA + delta); // 왼쪽 귀
  s.absarc(0, 0, R, lA + delta, rA - delta + Math.PI * 2, false); // 얼굴 아래쪽
  earArc(s, 0, rA - delta, rA + delta); // 오른쪽 귀
  s.holes.push(circlePath(-0.36, 0.28, 0.11));
  s.holes.push(circlePath(0.36, 0.28, 0.11));
  return s;
}

export const TEMPLATES: Record<ShapeKey, TemplateDef> = {
  star: { build: star, textBox: { cx: 0, cy: -0.05, w: 0.85, h: 0.36 } },
  heart: { build: heart, textBox: { cx: 0, cy: 0.12, w: 1.2, h: 0.42 } },
  rocket: { build: rocket, textBox: { cx: 0, cy: -0.2, w: 0.68, h: 0.32 } },
  nametag: { build: nametag, textBox: { cx: 0, cy: 0, w: 1.7, h: 0.72 } },
  bear: { build: bear, textBox: { cx: 0, cy: -0.32, w: 1.25, h: 0.42 } },
};
