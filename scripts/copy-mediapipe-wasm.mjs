// MediaPipe wasm 파일을 public/으로 복사해 학교 네트워크에서도 CDN 없이 로드되도록 합니다.
import { cpSync, existsSync } from "node:fs";
const src = "node_modules/@mediapipe/tasks-vision/wasm";
if (existsSync(src)) cpSync(src, "public/mediapipe/wasm", { recursive: true });
