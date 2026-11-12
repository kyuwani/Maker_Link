"use client";

import type { Mask } from "./geometry/contours";
import { FILAMENT_COLORS } from "./constants";
import type { ColorKey } from "./types";

/** 그림판 획. 좌표와 굵기는 정사각형 캔버스 한 변을 1로 둔 비율 값이라 화면 크기와 무관합니다. */
export interface Stroke {
  pts: number[]; // [x0, y0, x1, y1, ...]
  w: number;
  erase: boolean;
  /** AI 도안처럼 통째로 올린 그림 레이어 (검은 선 + 투명 배경 PNG data URL) */
  img?: string;
  /** 색연필/페인트통으로 칠한 색 (없으면 검은 선) */
  paint?: ColorKey;
  /** 페인트통: pts[0..1] 위치의 '선으로 둘러싸인 칸'을 paint 색으로 채움 */
  fill?: boolean;
}

/** 다색 프린터(AMS 1대)에 보통 꽂는 필라멘트 수. 넘어도 막지 않고 안내만 합니다. */
export const PRINTER_SLOTS = 4;

export function usedPaintColors(strokes: Stroke[]): ColorKey[] {
  const set = new Set<ColorKey>();
  for (const s of strokes) if (s.paint && !s.erase) set.add(s.paint);
  return [...set];
}

// 그림 레이어는 그리기 전에 미리 불러 둡니다 (renderStrokes는 동기 함수)
const imageCache = new Map<string, HTMLImageElement>();

export async function preloadStrokeImages(strokes: Stroke[]) {
  await Promise.all(
    strokes
      .filter((s) => s.img && !imageCache.has(s.img))
      .map(async (s) => {
        const im = new Image();
        im.src = s.img!;
        await im.decode();
        imageCache.set(s.img!, im);
      }),
  );
}

/**
 * AI가 그린 그림 → 그림판 레이어.
 * 어두운 선만 검정으로 남기고(배경 투명), 그림이 그림판 가운데 84%를 채우도록 맞춥니다.
 */
export async function imageToInkLayer(src: string, res = 768): Promise<string> {
  const im = new Image();
  im.src = src;
  await im.decode();
  const w = im.naturalWidth, h = im.naturalHeight;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(im, 0, 0);
  const px = ctx.getImageData(0, 0, w, h);
  const d = px.data;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const ink = lum < 150;
      d[i] = d[i + 1] = d[i + 2] = 17;
      d[i + 3] = ink ? 255 : 0;
      if (ink) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  ctx.putImageData(px, 0, 0);
  if (maxX < 0) throw new Error("그림에 선이 없어요");
  const bw = maxX - minX + 1, bh = maxY - minY + 1;
  const scale = (res * 0.84) / Math.max(bw, bh);
  const out = document.createElement("canvas");
  out.width = res;
  out.height = res;
  const octx = out.getContext("2d")!;
  octx.imageSmoothingQuality = "high";
  octx.drawImage(c, minX, minY, bw, bh, (res - bw * scale) / 2, (res - bh * scale) / 2, bw * scale, bh * scale);
  return out.toDataURL("image/png");
}

export const PEN_WIDTHS = { thin: 0.016, normal: 0.026, thick: 0.042 } as const;
export type PenSize = keyof typeof PEN_WIDTHS;

/** 중간점을 잇는 2차 곡선으로 부드럽게 그립니다. */
export function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke, size: number) {
  if (s.img) {
    const im = imageCache.get(s.img);
    if (im) ctx.drawImage(im, 0, 0, size, size);
    return;
  }
  if (s.fill) return; // 페인트통은 renderLayers에서 처리
  const p = s.pts;
  if (p.length < 2) return;
  const color = s.paint ? FILAMENT_COLORS[s.paint].hex : "#111827";
  ctx.save();
  ctx.globalCompositeOperation = s.erase ? "destination-out" : "source-over";
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = s.w * size;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (p.length === 2) {
    ctx.beginPath();
    ctx.arc(p[0] * size, p[1] * size, (s.w * size) / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(p[0] * size, p[1] * size);
    for (let i = 2; i < p.length - 2; i += 2) {
      const mx = ((p[i] + p[i + 2]) / 2) * size;
      const my = ((p[i + 1] + p[i + 3]) / 2) * size;
      ctx.quadraticCurveTo(p[i] * size, p[i + 1] * size, mx, my);
    }
    ctx.lineTo(p[p.length - 2] * size, p[p.length - 1] * size);
    ctx.stroke();
  }
  ctx.restore();
}

function makeCanvas(size: number) {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  return { c, ctx: c.getContext("2d", { willReadFrequently: true })! };
}

/**
 * 페인트통: (sx, sy)에서 시작해 선(잉크)에 막힌 칸을 색으로 채웁니다.
 * 칸이 그림판 가장자리에 닿으면(=선으로 둘러싸이지 않은 바깥) 채우지 않고 false.
 */
function floodFill(paint: CanvasRenderingContext2D, ink: CanvasRenderingContext2D, size: number, sx: number, sy: number, hex: string): boolean {
  const x0 = Math.min(size - 1, Math.max(0, Math.floor(sx)));
  const y0 = Math.min(size - 1, Math.max(0, Math.floor(sy)));
  const inkPx = ink.getImageData(0, 0, size, size).data;
  const wall = (i: number) => inkPx[i * 4 + 3] >= 128;
  if (wall(y0 * size + x0)) return false;
  const seen = new Uint8Array(size * size);
  const stack = [y0 * size + x0];
  seen[stack[0]] = 1;
  const region: number[] = [];
  while (stack.length) {
    const i = stack.pop()!;
    region.push(i);
    const x = i % size, y = (i - x) / size;
    if (x === 0 || y === 0 || x === size - 1 || y === size - 1) return false; // 바깥으로 샘
    for (const j of [i - 1, i + 1, i - size, i + size]) {
      if (!seen[j] && !wall(j)) {
        seen[j] = 1;
        stack.push(j);
      }
    }
  }
  const img = paint.getImageData(0, 0, size, size);
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  for (const i of region) {
    img.data[i * 4] = r;
    img.data[i * 4 + 1] = g;
    img.data[i * 4 + 2] = b;
    img.data[i * 4 + 3] = 255;
  }
  paint.putImageData(img, 0, 0);
  return true;
}

/** 획 목록을 순서대로 다시 그려 '색칠 층'과 '선 층'을 만듭니다. */
export function renderLayers(strokes: Stroke[], size: number) {
  const ink = makeCanvas(size);
  const paint = makeCanvas(size);
  for (const s of strokes) {
    if (s.fill && s.paint) floodFill(paint.ctx, ink.ctx, size, s.pts[0] * size, s.pts[1] * size, FILAMENT_COLORS[s.paint].hex);
    else if (s.erase) {
      drawStroke(ink.ctx, s, size);
      drawStroke(paint.ctx, s, size);
    } else if (s.paint) drawStroke(paint.ctx, s, size);
    else drawStroke(ink.ctx, s, size);
  }
  return { ink: ink.c, paint: paint.c };
}

/** 화면용: 색칠 층 위에 선 층 */
export function renderStrokes(ctx: CanvasRenderingContext2D, strokes: Stroke[], size: number) {
  const { ink, paint } = renderLayers(strokes, size);
  ctx.clearRect(0, 0, size, size);
  ctx.drawImage(paint, 0, 0);
  ctx.drawImage(ink, 0, 0);
}

/** 이 자리를 페인트통으로 채울 수 있는지 (선으로 둘러싸인 칸인지) 미리 확인 */
export function canFillAt(strokes: Stroke[], x: number, y: number, res = 384): boolean {
  const { ink } = renderLayers(strokes, res);
  const paint = makeCanvas(res);
  return floodFill(paint.ctx, ink.getContext("2d")!, res, x * res, y * res, "#000000");
}

/** 칠한 색별 마스크 (선 아래 칠해진 부분 포함) */
export function strokesToPaintMasks(strokes: Stroke[], res = 768): { key: ColorKey; mask: Mask }[] {
  const keys = usedPaintColors(strokes);
  if (!keys.length) return [];
  const { paint } = renderLayers(strokes, res);
  const px = paint.getContext("2d")!.getImageData(0, 0, res, res).data;
  const rgb = keys.map((k) => {
    const h = FILAMENT_COLORS[k].hex;
    return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  });
  const masks = keys.map(() => new Uint8Array(res * res));
  for (let i = 0; i < res * res; i++) {
    if (px[i * 4 + 3] < 128) continue;
    // 가장 가까운 칠 색으로 분류 (부드러운 가장자리 대비)
    let best = 0, bestD = Infinity;
    for (let k = 0; k < rgb.length; k++) {
      const d = (px[i * 4] - rgb[k][0]) ** 2 + (px[i * 4 + 1] - rgb[k][1]) ** 2 + (px[i * 4 + 2] - rgb[k][2]) ** 2;
      if (d < bestD) { bestD = d; best = k; }
    }
    masks[best][i] = 1;
  }
  return keys.map((key, k) => ({ key, mask: { width: res, height: res, data: masks[k] } }));
}

/** 획들을 res×res 잉크(선) 마스크로 (지우개 반영, 색칠 제외) */
export function strokesToMask(strokes: Stroke[], res = 768): Mask {
  const { ink } = renderLayers(strokes, res);
  const px = ink.getContext("2d")!.getImageData(0, 0, res, res).data;
  const data = new Uint8Array(res * res);
  for (let i = 0; i < data.length; i++) data[i] = px[i * 4 + 3] >= 128 ? 1 : 0;
  return { width: res, height: res, data };
}

export function hasInk(strokes: Stroke[]) {
  return strokes.some((s) => !s.erase);
}
