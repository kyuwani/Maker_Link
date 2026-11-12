"use client";

import type { Mask } from "./contours";

const FONT_STACK =
  "'Apple SD Gothic Neo','Malgun Gothic','Noto Sans KR','Nanum Gothic','Helvetica Neue',Arial,sans-serif";

/** 투명 캔버스에 굵은 고딕체로 글자를 그리고 알파값으로 마스크를 만듭니다. (외부 폰트 파일 불필요) */
export function renderTextMask(text: string, fontPx = 120): Mask | null {
  const t = text.trim();
  if (!t) return null;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  const font = `900 ${fontPx}px ${FONT_STACK}`;
  ctx.font = font;
  const m = ctx.measureText(t);
  const pad = Math.ceil(fontPx * 0.15);
  const w = Math.ceil(m.width) + pad * 2;
  const h = Math.ceil(fontPx * 1.35) + pad * 2;
  canvas.width = w;
  canvas.height = h;
  ctx.font = font; // 크기 변경 시 컨텍스트가 초기화되므로 다시 지정
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.fillStyle = "#000";
  // 아주 얇은 획을 조금 두껍게 해 3D 프린팅이 잘 되도록 외곽선도 함께 칠함
  ctx.lineWidth = fontPx * 0.035;
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#000";
  ctx.fillText(t, w / 2, h / 2);
  ctx.strokeText(t, w / 2, h / 2);
  const img = ctx.getImageData(0, 0, w, h).data;
  const data = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) data[i] = img[i * 4 + 3] >= 128 ? 1 : 0;
  return { width: w, height: h, data };
}

export interface PreparedImage {
  width: number;
  height: number;
  /** 조명 보정된 밝기 비율 (픽셀 / 주변 종이 밝기). 1에 가까울수록 종이, 작을수록 잉크 */
  ratio: Float32Array;
  /** 블러된 흑백 밝기 0~255 (사진 모드의 무늬 찾기용) */
  gray: Float32Array;
  /** 축소된 원본 컬러 캔버스 (AI 사물 분리 입력용) */
  canvas: HTMLCanvasElement;
}

export function loadImageFile(file: File | Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("사진을 열 수 없어요."));
    };
    img.src = url;
  });
}

/** 이미지를 최대 maxSize px로 줄이고, 흑백 + 조명(그림자) 보정까지 마칩니다. */
/**
 * 큰 사진을 한 번에 확 줄이면(예: 4032→1024) 브라우저에 따라 얇은 선이 점선처럼 끊깁니다.
 * 절반씩 단계적으로 줄여 선을 보존합니다.
 */
function downscale(source: CanvasImageSource, sw: number, sh: number, w: number, h: number): HTMLCanvasElement {
  let cur: CanvasImageSource = source;
  let cw = sw;
  let ch = sh;
  while (cw / 2 > w && ch / 2 > h) {
    const nw = Math.round(cw / 2);
    const nh = Math.round(ch / 2);
    const step = document.createElement("canvas");
    step.width = nw;
    step.height = nh;
    const sctx = step.getContext("2d")!;
    sctx.imageSmoothingQuality = "high";
    sctx.drawImage(cur, 0, 0, nw, nh);
    cur = step;
    cw = nw;
    ch = nh;
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(cur, 0, 0, w, h);
  return canvas;
}

/** 이미지를 최대 maxSize px로 줄이고, 잉크 세기 + 조명(그림자) 보정까지 마칩니다. */
export function prepareImage(source: CanvasImageSource & { width: number; height: number }, maxSize = 1024): PreparedImage {
  const sw = (source as HTMLImageElement).naturalWidth || source.width;
  const sh = (source as HTMLImageElement).naturalHeight || source.height;
  const scale = Math.min(1, maxSize / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));
  const canvas = downscale(source, sw, sh, w, h);
  const px = canvas.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, w, h).data;

  // 1) 밝기(사진 모드용)와 '잉크 세기'(종이 그림용) 채널
  //    잉크 세기 = R,G,B 중 가장 어두운 값 → 노랑·연두 같은 밝은 색 사인펜도 종이보다 확실히 어둡게 잡힘
  const gray = new Float32Array(w * h);
  const ink = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2];
    gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    ink[i] = Math.min(r, g, b);
  }
  const res = Math.max(w, h) / 512; // 해상도 보정
  const blurredGray = boxBlur(gray, w, h, 1);
  const blurredInk = boxBlur(ink, w, h, 1); // 3x3 평균으로 미세 노이즈 제거

  // 2) '종이 배경'을 추정해 그림자/조명 불균일 보정 (잉크가 섞이지 않게 최대값 필터 후 블러)
  const bgBase = maxFilter(blurredInk, w, h, Math.round(6 * res));
  const bg = boxBlur(bgBase, w, h, Math.max(8, Math.round(Math.max(w, h) / 24)));
  const ratio = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) ratio[i] = blurredInk[i] / Math.max(bg[i], 1);
  return { width: w, height: h, ratio, gray: blurredGray, canvas };
}

/**
 * 흑백 이진화. threshold(0.5~0.95)보다 어두운 비율이면 잉크로 봅니다.
 * 사진 가장자리에 붙은 그림자 덩어리는 제거합니다.
 */
export function binarize(img: PreparedImage, threshold: number): Mask {
  const { width: w, height: h, ratio } = img;
  const data = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) data[i] = ratio[i] < threshold ? 1 : 0;
  removeBorderBlobs(data, w, h);
  return { width: w, height: h, data };
}

function removeBorderBlobs(data: Uint8Array, w: number, h: number) {
  const stack: number[] = [];
  const push = (x: number, y: number) => {
    const i = y * w + x;
    if (data[i]) {
      data[i] = 0;
      stack.push(i);
    }
  };
  for (let x = 0; x < w; x++) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    push(0, y);
    push(w - 1, y);
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    const y = (i - x) / w;
    if (x > 0) push(x - 1, y);
    if (x < w - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < h - 1) push(x, y + 1);
  }
}

function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  if (r <= 0) return src;
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  // 가로
  for (let y = 0; y < h; y++) {
    let acc = 0;
    const row = y * w;
    for (let x = -r; x <= r; x++) acc += src[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / (2 * r + 1);
      acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  // 세로
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / (2 * r + 1);
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

/** 분리형 최대값 필터 (단순 구현, 512px에서 충분히 빠름) */
function maxFilter(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = 0;
      for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) m = Math.max(m, src[y * w + k]);
      tmp[y * w + x] = m;
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let m = 0;
      for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) m = Math.max(m, tmp[k * w + x]);
      out[y * w + x] = m;
    }
  }
  return out;
}

/** 이진화 결과 미리보기용 data URL */
export function maskToDataUrl(mask: Mask, color = "#1e293b"): string {
  const c = document.createElement("canvas");
  c.width = mask.width;
  c.height = mask.height;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(mask.width, mask.height);
  const hex = color.replace("#", "");
  const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
  for (let i = 0; i < mask.data.length; i++) {
    const on = mask.data[i];
    img.data[i * 4] = on ? r : 255;
    img.data[i * 4 + 1] = on ? g : 255;
    img.data[i * 4 + 2] = on ? b : 255;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL("image/png");
}

/** PC 테스트용 예시 손그림(사인펜 느낌의 고양이 얼굴)을 캔버스로 생성 */
export function makeSampleDrawing(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 480;
  c.height = 480;
  const ctx = c.getContext("2d")!;
  // 약간 누런 종이 + 한쪽 그림자
  const grad = ctx.createLinearGradient(0, 0, 480, 480);
  grad.addColorStop(0, "#fbf8ef");
  grad.addColorStop(1, "#d9d4c4");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 480, 480);
  ctx.strokeStyle = "#222";
  ctx.lineWidth = 9;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // 얼굴
  ctx.beginPath();
  ctx.moveTo(110, 170);
  ctx.lineTo(130, 70);
  ctx.lineTo(200, 130);
  ctx.quadraticCurveTo(240, 120, 280, 130);
  ctx.lineTo(350, 70);
  ctx.lineTo(370, 170);
  ctx.bezierCurveTo(420, 260, 380, 390, 240, 395);
  ctx.bezierCurveTo(100, 390, 60, 260, 110, 170);
  ctx.stroke();
  // 눈
  ctx.fillStyle = "#222";
  ctx.beginPath();
  ctx.arc(190, 240, 16, 0, Math.PI * 2);
  ctx.arc(290, 240, 16, 0, Math.PI * 2);
  ctx.fill();
  // 코와 입
  ctx.beginPath();
  ctx.moveTo(228, 285);
  ctx.lineTo(252, 285);
  ctx.lineTo(240, 300);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(240, 300);
  ctx.quadraticCurveTo(225, 330, 205, 315);
  ctx.moveTo(240, 300);
  ctx.quadraticCurveTo(255, 330, 275, 315);
  ctx.stroke();
  // 수염
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(150, 290); ctx.lineTo(90, 280);
  ctx.moveTo(150, 305); ctx.lineTo(95, 315);
  ctx.moveTo(330, 290); ctx.lineTo(390, 280);
  ctx.moveTo(330, 305); ctx.lineTo(385, 315);
  ctx.stroke();
  return c;
}

/** 사진 위에 AI가 찾은 물체를 분홍색으로 덮고 바깥은 흐리게 한 미리보기 */
export function overlayMaskDataUrl(photo: HTMLCanvasElement, mask: Mask): string {
  const w = photo.width;
  const h = photo.height;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(photo, 0, 0);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    const my = Math.min(mask.height - 1, Math.floor((y * mask.height) / h));
    for (let x = 0; x < w; x++) {
      const mx = Math.min(mask.width - 1, Math.floor((x * mask.width) / w));
      const on = mask.data[my * mask.width + mx];
      const i = (y * w + x) * 4;
      if (on) {
        d[i] = d[i] * 0.55 + 236 * 0.45;
        d[i + 1] = d[i + 1] * 0.55 + 72 * 0.45;
        d[i + 2] = d[i + 2] * 0.55 + 153 * 0.45;
      } else {
        const g = (d[i] + d[i + 1] + d[i + 2]) / 3;
        d[i] = d[i + 1] = d[i + 2] = g * 0.5 + 255 * 0.5;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL("image/jpeg", 0.85);
}
