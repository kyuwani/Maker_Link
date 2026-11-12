"use client";

import * as THREE from "three";
import type { ColorKey, Purpose, ShapeKey } from "../types";
import {
  dilate,
  erode,
  groupsBounds,
  largestComponent,
  maskCount,
  resampleMask,
  type Mask,
  maskToContourGroups,
  padMask,
  signedArea,
  type ContourGroup,
  type Pt,
} from "./contours";
import { binarize, renderTextMask, type PreparedImage } from "./raster";
import { TEMPLATES } from "./templates";

/** 모든 치수 단위는 mm (Three.js 1 unit = 1 mm) */
export interface ModelParts {
  base: THREE.BufferGeometry;
  ring?: THREE.BufferGeometry;
  emboss?: THREE.BufferGeometry;
  /** 몸체와 같은 색으로 그리는 추가 덩어리 (사진 판의 높이맵 등) */
  extra?: THREE.BufferGeometry;
  /** 색칠한 칸들 (색마다 따로 → 다색 프린터에서 그 색 필라멘트로) */
  paints?: { key: ColorKey; geometry: THREE.BufferGeometry }[];
  /** 화면 맞춤용 크기 */
  extent: number;
  /** 몸체가 몇 조각인지 (1이 아니면 출력 시 떨어져 나감) */
  pieces: number;
}

const RING = { rOut: 6, rIn: 2.6, gap: 1.0 };
const BEVEL = 0.4;

export function disposeParts(p: ModelParts | null | undefined) {
  p?.base.dispose();
  p?.ring?.dispose();
  p?.emboss?.dispose();
  p?.extra?.dispose();
  p?.paints?.forEach((x) => x.geometry.dispose());
}

/** 총 두께가 정확히 thickness가 되도록(0 ~ thickness) 베벨 포함 돌출 */
function extrude(shapes: THREE.Shape[], thickness: number, bevel = BEVEL): THREE.BufferGeometry {
  const useBevel = bevel > 0;
  const g = new THREE.ExtrudeGeometry(shapes, {
    depth: Math.max(0.2, thickness - (useBevel ? bevel * 2 : 0)),
    bevelEnabled: useBevel,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelOffset: -bevel,
    bevelSegments: 2,
    curveSegments: 16,
  });
  if (useBevel) g.translate(0, 0, bevel);
  g.computeVertexNormals();
  return g;
}

/** 단위 공간 Shape를 점으로 뽑아 변환(축척/이동)한 새 Shape로 */
function transformShape(shape: THREE.Shape, tf: (v: THREE.Vector2) => THREE.Vector2): THREE.Shape {
  const { shape: pts, holes } = shape.extractPoints(24);
  const out = new THREE.Shape(pts.map(tf));
  out.holes = holes.map((h) => new THREE.Path(h.map(tf)));
  return out;
}

function groupsToShapes(groups: ContourGroup[], tf: (p: Pt) => THREE.Vector2): THREE.Shape[] {
  return groups.map((g) => {
    const s = new THREE.Shape(g.outer.map(tf));
    s.holes = g.holes.map((h) => new THREE.Path(h.map(tf)));
    return s;
  });
}

function distToSegment(px: number, py: number, a: THREE.Vector2, b: THREE.Vector2) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy || 1e-9;
  const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / l2));
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}

function insidePoly(px: number, py: number, poly: THREE.Vector2[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > py !== b.y > py && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * 고리 자동 배치: anchorX 위치에서 고리를 위에서 아래로 '떨어뜨려'
 * 고리 구멍(rIn + gap)이 몸체에 닿기 직전 위치에 둡니다. → 구멍은 비어 있고, 고리 테두리는 몸체와 겹쳐 붙습니다.
 */
function placeRing(shapes: THREE.Shape[], anchorX: number): THREE.Vector2 {
  const polys = shapes.map((s) => s.extractPoints(24).shape);
  let maxY = -Infinity;
  for (const p of polys) for (const v of p) maxY = Math.max(maxY, v.y);
  const clear = RING.rIn + RING.gap;
  const hits = (cy: number) =>
    polys.some((poly) => {
      if (insidePoly(anchorX, cy, poly)) return true;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        if (distToSegment(anchorX, cy, poly[j], poly[i]) < clear) return true;
      }
      return false;
    });
  let y = maxY + clear + 0.5;
  const step = 0.2;
  for (let i = 0; i < 2000 && !hits(y - step); i++) y -= step;
  return new THREE.Vector2(anchorX, y);
}

function ringGeometry(center: THREE.Vector2, thickness: number) {
  const s = new THREE.Shape();
  s.absarc(center.x, center.y, RING.rOut, 0, Math.PI * 2, false);
  const hole = new THREE.Path();
  hole.absarc(center.x, center.y, RING.rIn, 0, Math.PI * 2, true);
  s.holes.push(hole);
  return extrude([s], thickness);
}

/** 이름 텍스트 → 양각 Shape들 (박스 안에 가운데 정렬) */
function textShapes(text: string, box: { cx: number; cy: number; w: number; h: number }): THREE.Shape[] {
  const mask = renderTextMask(text, 120);
  if (!mask) return [];
  const groups = maskToContourGroups(mask, { minArea: 6, epsilon: 0.6 });
  if (!groups.length) return [];
  const b = groupsBounds(groups);
  const s = Math.min(box.w / b.w, box.h / b.h);
  const cx = b.minX + b.w / 2;
  const cy = b.minY + b.h / 2;
  return groupsToShapes(groups, ([x, y]) => new THREE.Vector2(box.cx + (x - cx) * s, box.cy - (y - cy) * s));
}

export function buildTemplateModel(opts: {
  shape: ShapeKey;
  purpose: Purpose;
  sizeMm: number;
  text: string;
}): ModelParts {
  const def = TEMPLATES[opts.shape];
  const unit = def.build();
  const pts = unit.extractPoints(24).shape;
  const box = new THREE.Box2().setFromPoints(pts);
  const size = box.getSize(new THREE.Vector2());
  const center = box.getCenter(new THREE.Vector2());
  const s = opts.sizeMm / Math.max(size.x, size.y);
  const tf = (v: THREE.Vector2) => new THREE.Vector2((v.x - center.x) * s, (v.y - center.y) * s);

  const thickness = 4;
  const baseShape = transformShape(unit, tf);
  const base = extrude([baseShape], thickness);

  let ring: THREE.BufferGeometry | undefined;
  if (opts.purpose === "keyring") {
    ring = ringGeometry(placeRing([baseShape], 0), thickness);
  }

  let emboss: THREE.BufferGeometry | undefined;
  const tb = def.textBox;
  const tShapes = textShapes(opts.text, {
    cx: (tb.cx - center.x) * s,
    cy: (tb.cy - center.y) * s,
    w: tb.w * s,
    h: tb.h * s,
  });
  if (tShapes.length) {
    emboss = extrude(tShapes, 1.4, 0);
    emboss.translate(0, 0, thickness - 0.05); // 살짝 파묻어 몸체와 확실히 붙도록
  }

  return { base, ring, emboss, extent: opts.sizeMm + (ring ? RING.rOut * 2 : 0), pieces: 1 };
}

export type DrawingStyle = "filled" | "lines";

/** 픽셀 윤곽 → 크기 맞춤 → 두께 3mm(베벨) 몸체 + 맨 위 점에 고리 + 선/무늬 양각 */
function assembleFromPixels(
  baseGroups: ContourGroup[],
  embossGroups: ContourGroup[],
  sizeMm: number,
  paintGroups: { key: ColorKey; groups: ContourGroup[] }[] = [],
): ModelParts {
  const b = groupsBounds(baseGroups);
  const s = sizeMm / Math.max(b.w, b.h);
  const cx = b.minX + b.w / 2;
  const cy = b.minY + b.h / 2;
  const tf = ([x, y]: Pt) => new THREE.Vector2((x - cx) * s, -(y - cy) * s);

  const thickness = 3;
  const baseShapes = groupsToShapes(baseGroups, tf);
  const base = extrude(baseShapes, thickness);

  // 가장 위쪽 점의 x 위치에 고리 결합
  let top = baseGroups[0].outer[0];
  for (const g of baseGroups) for (const p of g.outer) if (p[1] < top[1]) top = p;
  const ring = ringGeometry(placeRing(baseShapes, tf(top).x), thickness);

  let emboss: THREE.BufferGeometry | undefined;
  if (embossGroups.length) {
    emboss = extrude(groupsToShapes(embossGroups, tf), 1.2, 0);
    emboss.translate(0, 0, thickness - 0.05);
  }
  // 색칠한 칸: 판 위로 0.8mm (선 양각 1.2mm보다 낮아서 선이 경계로 또렷이 남음)
  const paints = paintGroups
    .filter((p) => p.groups.length)
    .map((p) => {
      const g = extrude(groupsToShapes(p.groups, tf), 0.8, 0);
      g.translate(0, 0, thickness - 0.05);
      return { key: p.key, geometry: g };
    });
  return {
    base,
    ring,
    emboss,
    paints: paints.length ? paints : undefined,
    extent: sizeMm + RING.rOut * 2,
    pieces: baseGroups.length,
  };
}

/** 너무 작은 조각(떨어져 나갈 부스러기)은 제외 */
function dropCrumbs(groups: ContourGroup[]) {
  const areas = groups.map((g) => Math.abs(signedArea(g.outer)));
  const maxArea = Math.max(0, ...areas);
  return groups.filter((_, i) => areas[i] >= maxArea * 0.02);
}

/** 손그림 사진 → 흑백 이진화 → 3D */
export function buildDrawingModel(opts: {
  image: PreparedImage;
  threshold: number;
  style: DrawingStyle;
  sizeMm: number;
}): ModelParts | null {
  return buildInkModel({ ink: binarize(opts.image, opts.threshold), style: opts.style, sizeMm: opts.sizeMm });
}

/** 잉크 마스크(1 = 선) → 두께 3mm(베벨) 입체 + 상단 고리. 그림판은 이 함수로 바로 들어옵니다. */
export function buildInkModel(opts: {
  ink: Mask;
  style: DrawingStyle;
  sizeMm: number;
  paints?: { key: ColorKey; mask: Mask }[];
}): ModelParts | null {
  const PAD = 16;
  const ink = padMask(opts.ink, PAD);
  const paints = (opts.paints ?? []).map((p) => ({ key: p.key, mask: padMask(p.mask, PAD) }));
  // 판 모양은 선 + 칠한 곳 모두를 감싸도록
  const shape: Mask = paints.length
    ? { ...ink, data: ink.data.map((v, i) => (v || paints.some((p) => p.mask.data[i]) ? 1 : 0)) }
    : ink;
  const scaleRef = Math.max(opts.ink.width, opts.ink.height) / 512; // 해상도와 무관한 두께
  const lines = dilate(ink, Math.max(1, Math.round(1.2 * scaleRef)));
  const minArea = 30 * scaleRef * scaleRef;

  let baseGroups: ContourGroup[];
  let embossGroups: ContourGroup[] = [];
  if (opts.style === "filled") {
    // 그림 둘레에 스티커처럼 테두리를 두르고 속을 채운 판 + 그 위에 선 양각
    baseGroups = maskToContourGroups(dilate(shape, Math.round(9 * scaleRef)), {
      minArea,
      epsilon: 0.8,
      ignoreHoles: true,
    });
    embossGroups = maskToContourGroups(lines, { minArea: minArea / 3, epsilon: 0.6 });
  } else {
    baseGroups = maskToContourGroups(dilate(shape, Math.round(3 * scaleRef)), { minArea, epsilon: 0.7 });
  }
  baseGroups = dropCrumbs(baseGroups);
  if (!baseGroups.length) return null;
  const paintGroups = paints.map((p) => ({
    key: p.key,
    groups: maskToContourGroups(p.mask, { minArea: minArea / 2, epsilon: 0.7 }),
  }));
  return assembleFromPixels(baseGroups, embossGroups, opts.sizeMm, paintGroups);
}

/**
 * 동물·물건 사진 → AI가 찾은 물체 실루엣으로 판을 만들고,
 * 물체 안에서 물체 평균보다 어두운 부분(눈·코·무늬)을 볼록하게 올립니다.
 */
export function buildPhotoModel(opts: {
  image: PreparedImage;
  objectMask: Mask;
  threshold: number;
  details: boolean;
  sizeMm: number;
}): ModelParts | null {
  const { width: w, height: h, gray } = opts.image;
  const PAD = 16;
  const scaleRef = Math.max(w, h) / 512;
  // 1) 실루엣: 가장 큰 덩어리만, 작은 틈은 메우고(closing) 가장자리는 부드럽게
  let sil = largestComponent(resampleMask(opts.objectMask, w, h));
  if (maskCount(sil) < w * h * 0.01) return null; // 너무 작으면 실패로 봄
  const r = Math.round(4 * scaleRef);
  sil = erode(dilate(sil, r), r);
  const baseGroups = dropCrumbs(
    maskToContourGroups(padMask(sil, PAD), { minArea: 30 * scaleRef * scaleRef, epsilon: 1.0, ignoreHoles: true }),
  );
  if (!baseGroups.length) return null;

  // 2) 무늬: 실루엣 안쪽(테두리 그림자 제외)에서 물체의 중간 밝기보다 확실히 어두운 곳
  let embossGroups: ContourGroup[] = [];
  if (opts.details) {
    const inner = erode(sil, Math.round(6 * scaleRef));
    const hist = new Uint32Array(256);
    let n = 0;
    for (let i = 0; i < w * h; i++) {
      if (inner.data[i]) {
        hist[Math.max(0, Math.min(255, Math.round(gray[i])))]++;
        n++;
      }
    }
    if (n > 0) {
      let acc = 0, median = 0;
      for (let v = 0; v < 256; v++) {
        acc += hist[v];
        if (acc >= n / 2) {
          median = v;
          break;
        }
      }
      const cut = median * opts.threshold;
      const ink = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) ink[i] = inner.data[i] && gray[i] < cut ? 1 : 0;
      const lines = dilate(padMask({ width: w, height: h, data: ink }, PAD), Math.max(1, Math.round(scaleRef)));
      embossGroups = maskToContourGroups(lines, { minArea: 14 * scaleRef * scaleRef, epsilon: 0.7 });
    }
  }
  return assembleFromPixels(baseGroups, embossGroups, opts.sizeMm);
}

export type ReliefStyle = "emboss" | "litho";

/**
 * 높이맵 → 닫힌(수밀) 입체. 윗면은 격자, 옆면은 테두리 벽, 바닥은 부채꼴로 막습니다.
 * heights[j * nx + i], j=0 이 위쪽(y 최대).
 */
function heightfieldSolid(
  nx: number,
  ny: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  heights: Float32Array,
): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const X = (i: number) => x0 + ((x1 - x0) * i) / (nx - 1);
  const Y = (j: number) => y1 - ((y1 - y0) * j) / (ny - 1);
  // 윗면
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) pos.push(X(i), Y(j), heights[j * nx + i]);
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  // 테두리 고리(위에서 봤을 때 시계 방향)
  const loop: [number, number][] = [];
  for (let i = 0; i < nx - 1; i++) loop.push([i, 0]);
  for (let j = 0; j < ny - 1; j++) loop.push([nx - 1, j]);
  for (let i = nx - 1; i > 0; i--) loop.push([i, ny - 1]);
  for (let j = ny - 1; j > 0; j--) loop.push([0, j]);
  const base = pos.length / 3;
  for (const [i, j] of loop) {
    pos.push(X(i), Y(j), heights[j * nx + i]); // 벽 위
    pos.push(X(i), Y(j), 0); // 벽 아래
  }
  const n = loop.length;
  for (let k = 0; k < n; k++) {
    const pt = base + k * 2, pb = pt + 1;
    const qt = base + ((k + 1) % n) * 2, qb = qt + 1;
    idx.push(pt, qt, qb, pt, qb, pb);
  }
  // 바닥: 가운데 점에서 부채꼴
  const center = pos.length / 3;
  pos.push((x0 + x1) / 2, (y0 + y1) / 2, 0);
  for (let k = 0; k < n; k++) {
    const pb = base + k * 2 + 1;
    const qb = base + ((k + 1) % n) * 2 + 1;
    idx.push(center, pb, qb);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * 아무 사진 → 사진 판.
 * - emboss(볼록 사진): 어두운 곳이 높게 → 어떤 색 필라멘트로도 사진이 입체로 보임
 * - litho(빛 사진/리소페인): 밝은 곳은 얇게(0.8mm) 어두운 곳은 두껍게(3.2mm) → 하얀색으로 뽑아 빛에 비추면 사진이 보임
 */
export function buildReliefModel(opts: {
  image: PreparedImage;
  style: ReliefStyle;
  contrast: number; // 0.6 ~ 1.8
  sizeMm: number;
}): ModelParts {
  const src = opts.image.canvas;
  // 너무 길쭉한 사진은 가운데를 잘라 2:3 ~ 3:2 비율로
  let aspect = src.width / src.height;
  let sx = 0, sy = 0, sw = src.width, sh = src.height;
  if (aspect > 1.5) {
    sw = Math.round(src.height * 1.5);
    sx = Math.round((src.width - sw) / 2);
    aspect = 1.5;
  } else if (aspect < 2 / 3) {
    sh = Math.round(src.width * 1.5);
    sy = Math.round((src.height - sh) / 2);
    aspect = 2 / 3;
  }
  const W = aspect >= 1 ? opts.sizeMm : opts.sizeMm * aspect;
  const H = aspect >= 1 ? opts.sizeMm / aspect : opts.sizeMm;
  const border = 3;
  const overlap = 0.6; // 사진 판이 테두리 밑으로 살짝 들어가 확실히 붙도록
  const winW = W - border * 2;
  const winH = H - border * 2;
  const rx0 = -winW / 2 - overlap, rx1 = winW / 2 + overlap;
  const ry0 = -winH / 2 - overlap, ry1 = winH / 2 + overlap;

  // 0.5mm 격자 (노즐 굵기 수준), 최대 200칸
  const cell = 0.5;
  const nx = Math.min(200, Math.max(20, Math.round((rx1 - rx0) / cell) + 1));
  const ny = Math.min(200, Math.max(20, Math.round((ry1 - ry0) / cell) + 1));
  const sc = document.createElement("canvas");
  sc.width = nx;
  sc.height = ny;
  const sctx = sc.getContext("2d", { willReadFrequently: true })!;
  sctx.imageSmoothingQuality = "high";
  sctx.drawImage(src, sx, sy, sw, sh, 0, 0, nx, ny);
  const px = sctx.getImageData(0, 0, nx, ny).data;
  const lum = new Float32Array(nx * ny);
  for (let i = 0; i < lum.length; i++) lum[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];

  // 자동 밝기 맞춤(아래 2% ~ 위 2%를 0~1로 늘림) → 흐릿한 사진도 또렷하게
  const sorted = Array.from(lum).sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length * 0.02)];
  const hi = Math.max(lo + 1, sorted[Math.floor(sorted.length * 0.98)]);
  const heights = new Float32Array(nx * ny);
  for (let i = 0; i < lum.length; i++) {
    const t = Math.min(1, Math.max(0, (lum[i] - lo) / (hi - lo)));
    const dark = Math.min(1, Math.max(0, 0.5 + (1 - t - 0.5) * opts.contrast));
    heights[i] = opts.style === "litho" ? 0.8 + dark * 2.4 : 2.0 + dark * 1.6;
  }
  const relief = heightfieldSolid(nx, ny, rx0, rx1, ry0, ry1, heights);

  // 둥근 네모 테두리(가운데는 사진 창)
  const r = 4;
  const frame = new THREE.Shape();
  frame.moveTo(-W / 2 + r, -H / 2);
  frame.lineTo(W / 2 - r, -H / 2);
  frame.absarc(W / 2 - r, -H / 2 + r, r, -Math.PI / 2, 0, false);
  frame.lineTo(W / 2, H / 2 - r);
  frame.absarc(W / 2 - r, H / 2 - r, r, 0, Math.PI / 2, false);
  frame.lineTo(-W / 2 + r, H / 2);
  frame.absarc(-W / 2 + r, H / 2 - r, r, Math.PI / 2, Math.PI, false);
  frame.lineTo(-W / 2, -H / 2 + r);
  frame.absarc(-W / 2 + r, -H / 2 + r, r, Math.PI, Math.PI * 1.5, false);
  const win = new THREE.Path();
  win.moveTo(-winW / 2, -winH / 2);
  win.lineTo(-winW / 2, winH / 2);
  win.lineTo(winW / 2, winH / 2);
  win.lineTo(winW / 2, -winH / 2);
  win.closePath();
  frame.holes.push(win);
  const frameT = opts.style === "litho" ? 3.6 : 3.0;
  const base = extrude([frame], frameT);
  const ring = ringGeometry(placeRing([frame], 0), frameT);

  return { base, ring, extra: relief, extent: opts.sizeMm + RING.rOut * 2, pieces: 1 };
}
