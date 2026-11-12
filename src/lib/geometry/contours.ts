/**
 * 이진 마스크 → 폐곡선(Contour) 추출.
 * Marching Squares로 윤곽선 조각을 만들고 이어 붙인 뒤,
 * Douglas–Peucker로 단순화하고 포함 관계(깊이)로 바깥선/구멍을 구분합니다.
 */

export interface Mask {
  width: number;
  height: number;
  data: Uint8Array; // 1 = 채움, 0 = 빈 곳
}

export type Pt = [number, number];

export interface ContourGroup {
  outer: Pt[];
  holes: Pt[][];
}

// 셀 코너 비트: tl=8, tr=4, br=2, bl=1 / 변: T=0, R=1, B=2, L=3
const CASES: number[][] = [
  [],
  [3, 2],
  [2, 1],
  [3, 1],
  [0, 1],
  [3, 2, 0, 1], // 대각선(saddle): 분리 해석
  [0, 2],
  [0, 3],
  [0, 3],
  [0, 2],
  [0, 3, 2, 1], // 대각선(saddle): 분리 해석
  [0, 1],
  [3, 1],
  [2, 1],
  [3, 2],
  [],
];

/** 마스크의 모든 경계 폐곡선을 픽셀 좌표(픽셀 중심 = 정수)로 반환합니다. */
export function traceLoops(mask: Mask): Pt[][] {
  const { width: w, height: h, data } = mask;
  const at = (x: number, y: number) =>
    x < 0 || y < 0 || x >= w || y >= h ? 0 : data[y * w + x];

  // 두 배 좌표계에서 변 중점에 정수 키를 부여
  const H2 = 2 * h + 6;
  const key = (X: number, Y: number) => (X + 2) * H2 + (Y + 2);
  const adj = new Map<number, number[]>();
  const link = (a: number, b: number) => {
    const la = adj.get(a);
    if (la) la.push(b);
    else adj.set(a, [b]);
    const lb = adj.get(b);
    if (lb) lb.push(a);
    else adj.set(b, [a]);
  };

  for (let y = -1; y < h; y++) {
    for (let x = -1; x < w; x++) {
      const c =
        (at(x, y) << 3) | (at(x + 1, y) << 2) | (at(x + 1, y + 1) << 1) | at(x, y + 1);
      if (c === 0 || c === 15) continue;
      const edges = CASES[c];
      const ek = (e: number) => {
        switch (e) {
          case 0: return key(2 * x + 1, 2 * y);
          case 1: return key(2 * x + 2, 2 * y + 1);
          case 2: return key(2 * x + 1, 2 * y + 2);
          default: return key(2 * x, 2 * y + 1);
        }
      };
      for (let i = 0; i < edges.length; i += 2) link(ek(edges[i]), ek(edges[i + 1]));
    }
  }

  const visited = new Set<number>();
  const loops: Pt[][] = [];
  for (const start of adj.keys()) {
    if (visited.has(start)) continue;
    const loop: Pt[] = [];
    let prev = -1;
    let cur = start;
    while (!visited.has(cur)) {
      visited.add(cur);
      const X = Math.floor(cur / H2) - 2;
      const Y = (cur % H2) - 2;
      loop.push([X / 2, Y / 2]);
      const n = adj.get(cur)!;
      const next = n[0] !== prev ? n[0] : n[1];
      prev = cur;
      cur = next;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

export function signedArea(p: Pt[]): number {
  let a = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    a += (p[j][0] - p[i][0]) * (p[j][1] + p[i][1]);
  }
  return a / 2;
}

export function pointInPolygon(pt: Pt, poly: Pt[]): boolean {
  let inside = false;
  const [x, y] = pt;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function rdp(points: Pt[], eps: number): Pt[] {
  if (points.length < 3) return points;
  const [ax, ay] = points[0];
  const [bx, by] = points[points.length - 1];
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1e-9;
  let maxD = -1;
  let idx = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i];
    const d = Math.abs(dy * px - dx * py + bx * ay - by * ax) / len;
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  if (maxD <= eps) return [points[0], points[points.length - 1]];
  const left = rdp(points.slice(0, idx + 1), eps);
  const right = rdp(points.slice(idx), eps);
  return left.slice(0, -1).concat(right);
}

/** 닫힌 곡선용 Douglas–Peucker 단순화 */
export function simplifyClosed(loop: Pt[], eps: number): Pt[] {
  if (loop.length < 8 || eps <= 0) return loop;
  // 시작점에서 가장 먼 점을 기준으로 두 개의 열린 곡선으로 나눠 처리
  let far = 0;
  let maxD = -1;
  for (let i = 1; i < loop.length; i++) {
    const d = (loop[i][0] - loop[0][0]) ** 2 + (loop[i][1] - loop[0][1]) ** 2;
    if (d > maxD) {
      maxD = d;
      far = i;
    }
  }
  const a = rdp(loop.slice(0, far + 1), eps);
  const b = rdp(loop.slice(far).concat([loop[0]]), eps);
  const out = a.slice(0, -1).concat(b.slice(0, -1));
  return out.length >= 3 ? out : loop;
}

/**
 * 마스크에서 바깥선 + 구멍 그룹을 만듭니다.
 * @param minArea 이 면적(픽셀²)보다 작은 곡선은 잡티로 보고 버립니다.
 * @param ignoreHoles true면 구멍을 모두 메웁니다(바깥 실루엣만).
 */
export function maskToContourGroups(
  mask: Mask,
  { minArea = 12, epsilon = 0.7, ignoreHoles = false } = {},
): ContourGroup[] {
  const loops = traceLoops(mask)
    .map((l) => ({ pts: simplifyClosed(l, epsilon), area: 0, depth: 0 }))
    .map((l) => ({ ...l, area: Math.abs(signedArea(l.pts)) }))
    .filter((l) => l.area >= minArea && l.pts.length >= 3);

  // 포함 깊이 계산: 짝수 = 바깥선, 홀수 = 구멍
  for (const l of loops) {
    let d = 0;
    for (const o of loops) {
      if (o !== l && o.area > l.area && pointInPolygon(l.pts[0], o.pts)) d++;
    }
    l.depth = d;
  }

  const outers = loops.filter((l) => l.depth % 2 === 0);
  const groups = outers.map((o) => ({ src: o, outer: o.pts, holes: [] as Pt[][] }));
  if (!ignoreHoles) {
    for (const hole of loops.filter((l) => l.depth % 2 === 1)) {
      // 가장 작은(가장 가까운) 감싸는 바깥선에 붙이기
      let best: (typeof groups)[number] | null = null;
      for (const g of groups) {
        if (g.src.depth === hole.depth - 1 && g.src.area > hole.area && pointInPolygon(hole.pts[0], g.outer)) {
          if (!best || g.src.area < best.src.area) best = g;
        }
      }
      best?.holes.push(hole.pts);
    }
  } else {
    // 실루엣 모드: 다른 바깥선 안쪽에 있는 섬(깊이 2 이상)은 어차피 메워지므로 제외
    return groups.filter((g) => g.src.depth === 0).map(({ outer, holes }) => ({ outer, holes }));
  }
  return groups.map(({ outer, holes }) => ({ outer, holes }));
}

export function groupsBounds(groups: ContourGroup[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const g of groups) {
    for (const [x, y] of g.outer) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

/** 근사 유클리드 거리 변환(2-pass chamfer). 채워진 픽셀까지의 거리를 반환합니다. */
export function distanceToFilled(mask: Mask): Float32Array {
  const { width: w, height: h, data } = mask;
  const INF = 1e9;
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = data[i] ? 0 : INF;
  const D = Math.SQRT2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + 1);
      if (y > 0) {
        v = Math.min(v, d[i - w] + 1);
        if (x > 0) v = Math.min(v, d[i - w - 1] + D);
        if (x < w - 1) v = Math.min(v, d[i - w + 1] + D);
      }
      d[i] = v;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let v = d[i];
      if (x < w - 1) v = Math.min(v, d[i + 1] + 1);
      if (y < h - 1) {
        v = Math.min(v, d[i + w] + 1);
        if (x < w - 1) v = Math.min(v, d[i + w + 1] + D);
        if (x > 0) v = Math.min(v, d[i + w - 1] + D);
      }
      d[i] = v;
    }
  }
  return d;
}

/** 반지름 r 픽셀만큼 팽창(dilate) */
export function dilate(mask: Mask, r: number): Mask {
  if (r <= 0) return mask;
  const dist = distanceToFilled(mask);
  const out = new Uint8Array(dist.length);
  for (let i = 0; i < dist.length; i++) out[i] = dist[i] <= r ? 1 : 0;
  return { width: mask.width, height: mask.height, data: out };
}

/** 마스크 주변에 여백을 덧대 확장 (팽창 시 가장자리가 잘리지 않도록) */
export function padMask(mask: Mask, pad: number): Mask {
  const w = mask.width + pad * 2;
  const h = mask.height + pad * 2;
  const data = new Uint8Array(w * h);
  for (let y = 0; y < mask.height; y++) {
    data.set(mask.data.subarray(y * mask.width, (y + 1) * mask.width), (y + pad) * w + pad);
  }
  return { width: w, height: h, data };
}

/** 반지름 r 픽셀만큼 침식(erode). 이미지 바깥은 채워진 것으로 봐서 가장자리에 닿은 부분은 깎지 않습니다. */
export function erode(mask: Mask, r: number): Mask {
  if (r <= 0) return mask;
  const inv = new Uint8Array(mask.data.length);
  for (let i = 0; i < inv.length; i++) inv[i] = mask.data[i] ? 0 : 1;
  const dist = distanceToFilled({ width: mask.width, height: mask.height, data: inv });
  const out = new Uint8Array(inv.length);
  for (let i = 0; i < out.length; i++) out[i] = dist[i] > r ? 1 : 0;
  return { width: mask.width, height: mask.height, data: out };
}

/** 가장 큰 연결 덩어리 하나만 남김 (4-이웃) */
export function largestComponent(mask: Mask): Mask {
  const { width: w, height: h, data } = mask;
  const label = new Int32Array(w * h);
  let best = 0, bestSize = 0, next = 0;
  const stack: number[] = [];
  for (let s = 0; s < data.length; s++) {
    if (!data[s] || label[s]) continue;
    next++;
    let size = 0;
    label[s] = next;
    stack.push(s);
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      const x = i % w;
      const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w];
      for (const j of nb) {
        if (j >= 0 && j < data.length && data[j] && !label[j]) {
          label[j] = next;
          stack.push(j);
        }
      }
    }
    if (size > bestSize) {
      bestSize = size;
      best = next;
    }
  }
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = label[i] === best && best ? 1 : 0;
  return { width: w, height: h, data: out };
}

/** 최근접 이웃 방식으로 마스크 크기 맞추기 */
export function resampleMask(mask: Mask, w: number, h: number): Mask {
  if (mask.width === w && mask.height === h) return mask;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(mask.height - 1, Math.floor((y * mask.height) / h));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(mask.width - 1, Math.floor((x * mask.width) / w));
      out[y * w + x] = mask.data[sy * mask.width + sx];
    }
  }
  return { width: w, height: h, data: out };
}

export function maskCount(mask: Mask) {
  let n = 0;
  for (let i = 0; i < mask.data.length; i++) n += mask.data[i];
  return n;
}
