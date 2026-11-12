"use client";

import type { InteractiveSegmenterLegacy } from "@mediapipe/tasks-vision";
import type { Mask } from "./geometry/contours";

/**
 * 브라우저 안에서 도는 AI 사물 분리(MediaPipe Interactive Segmenter, magic_touch 모델, Apache-2.0).
 * 학생이 사진 속 물체를 콕 누르면 그 물체의 실루엣 마스크를 돌려줍니다.
 * - wasm: public/mediapipe/wasm (postinstall 스크립트가 node_modules에서 복사)
 * - 모델: 기본은 Google 공식 저장소. 학교망에서 막히면 파일을 public/models/에 두고
 *   NEXT_PUBLIC_SEGMENTER_MODEL_URL=/models/magic_touch.tflite 로 바꾸세요.
 */
const MODEL_URL =
  process.env.NEXT_PUBLIC_SEGMENTER_MODEL_URL ??
  "https://storage.googleapis.com/mediapipe-models/interactive_segmenter/magic_touch/float32/1/magic_touch.tflite";

let segmenterPromise: Promise<InteractiveSegmenterLegacy> | null = null;

export function isSegmenterLoaded() {
  return segmenterPromise !== null;
}

async function getSegmenter(): Promise<InteractiveSegmenterLegacy> {
  if (!segmenterPromise) {
    segmenterPromise = (async () => {
      const { FilesetResolver, InteractiveSegmenterLegacy } = await import("@mediapipe/tasks-vision");
      const fileset = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
      const create = (delegate: "GPU" | "CPU") =>
        InteractiveSegmenterLegacy.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate },
          outputCategoryMask: true,
          outputConfidenceMasks: false,
        });
      try {
        return await create("GPU");
      } catch {
        return await create("CPU"); // WebGL이 약한 기기 대비
      }
    })();
    segmenterPromise.catch(() => {
      segmenterPromise = null; // 실패하면 다음에 다시 시도할 수 있게
    });
  }
  return segmenterPromise;
}

/**
 * point(0~1 정규화 좌표)에 있는 물체의 마스크를 만듭니다. 결과 크기 = 입력 캔버스 크기.
 */
export async function segmentObjectAt(canvas: HTMLCanvasElement, point: { x: number; y: number }): Promise<Mask> {
  const seg = await getSegmenter();
  const result = seg.segment(canvas, { keypoint: { x: point.x, y: point.y } });
  try {
    const cm = result.categoryMask;
    if (!cm) throw new Error("마스크가 없어요");
    const { width: w, height: h } = cm;
    const raw = cm.getAsUint8Array();
    // 누른 지점의 값을 '물체' 라벨로 사용 (모델 버전에 따라 0/1이 뒤바뀌어도 안전)
    const px = Math.min(w - 1, Math.max(0, Math.round(point.x * (w - 1))));
    const py = Math.min(h - 1, Math.max(0, Math.round(point.y * (h - 1))));
    const objectLabel = raw[py * w + px];
    const data = new Uint8Array(w * h);
    for (let i = 0; i < data.length; i++) data[i] = raw[i] === objectLabel ? 1 : 0;
    return { width: w, height: h, data };
  } finally {
    result.close();
  }
}
