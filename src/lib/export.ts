"use client";

import JSZip from "jszip";
import { COLOR_ORDER, FILAMENT_COLORS, MODE_LABEL, PURPOSE_LABEL, SHAPE_LABEL } from "./constants";
import { formatDateTime } from "./session";
import { loadFile, type ColorKey, type Room, type Submission } from "./types";

function sanitize(s: string) {
  return s.replace(/[\\/:*?"<>|\s]+/g, "").slice(0, 20) || "학생";
}

/** [수업코드_학생이름_색상.stl] — 같은 이름이 겹치면 _2, _3… */
export function buildFileNames(subs: Submission[]): Map<string, string> {
  const used = new Map<string, number>();
  const out = new Map<string, string>();
  // 오래된 제출부터 번호를 매겨 파일명이 안정적으로 유지되도록
  for (const s of [...subs].sort((a, b) => a.createdAt - b.createdAt)) {
    const base = `${s.roomCode}_${sanitize(s.studentName)}_${FILAMENT_COLORS[s.color].label}`;
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    out.set(s.id, `${base}${n > 1 ? `_${n}` : ""}.stl`);
  }
  return out;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function downloadZip(room: Room, subs: Submission[]) {
  const zip = new JSZip();
  const names = buildFileNames(subs);
  for (const s of subs) {
    zip.file(names.get(s.id)!, await loadFile(s.stl));
    // 색칠한 작품은 다색 프린터용 3MF도 함께
    if (s.model3mf) zip.file(names.get(s.id)!.replace(/\.stl$/, ".3mf"), await loadFile(s.model3mf));
  }
  zip.file("제작의뢰서.csv", buildCsv(room, subs));
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
  downloadBlob(blob, `${room.code}_${sanitize(room.school)}_${sanitize(room.className)}_STL.zip`);
}

export function colorStats(subs: Submission[]) {
  const counts = Object.fromEntries(COLOR_ORDER.map((c) => [c, 0])) as Record<ColorKey, number>;
  // 작품마다 쓰는 필라멘트(판 색 + 칠한 색)를 한 번씩 셈
  for (const s of subs) for (const c of new Set([s.color, ...(s.paintColors ?? [])])) counts[c]++;
  return COLOR_ORDER.map((c) => ({ color: c, label: FILAMENT_COLORS[c].label, count: counts[c] }));
}

function csvCell(v: string | number) {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildCsv(room: Room, subs: Submission[]): string {
  const names = buildFileNames(subs);
  const rows: (string | number)[][] = [
    ["메이커스페이스 3D 프린팅 제작 의뢰서"],
    ["학교", room.school, "학급", room.className, "수업 코드", room.code],
    ["작성일", new Date().toLocaleString("ko-KR"), "총 수량", subs.length],
    [],
    ["[색상별 필요 수량]"],
    ["색상", "수량"],
    ...colorStats(subs).map((c) => [c.label, c.count]),
    [],
    ["[학생별 명단]"],
    ["번호", "학생 이름", "만들기 모드", "모양", "용도", "크기(mm)", "색상", "칠한 색(다색)", "제출 시간", "파일명"],
    ...[...subs]
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((s, i) => [
        i + 1,
        s.studentName,
        MODE_LABEL[s.mode],
        s.shape ? SHAPE_LABEL[s.shape] : MODE_LABEL[s.mode],
        PURPOSE_LABEL[s.purpose],
        s.sizeMm,
        FILAMENT_COLORS[s.color].label,
        (s.paintColors ?? []).map((c) => FILAMENT_COLORS[c].label).join("·") || "-",
        formatDateTime(s.createdAt),
        names.get(s.id)!,
      ]),
  ];
  // 엑셀에서 한글이 깨지지 않도록 BOM 추가
  return "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}

export function downloadCsv(room: Room, subs: Submission[]) {
  downloadBlob(new Blob([buildCsv(room, subs)], { type: "text/csv;charset=utf-8" }), `${room.code}_제작의뢰서.csv`);
}

/**
 * 제출 STL → 블렌더용 GLB (필라멘트 색 포함).
 * - 단위: 앱은 mm, glTF는 m 이므로 1/1000로 줄여 블렌더에서 실제 크기(예: 6cm)로 보이게
 * - 방향: glTF(Y-up)를 블렌더(Z-up)가 바꿔 읽으므로, 작품이 정면(Front 뷰)을 보고 바닥에 서 있는 모습이 됨
 */
export async function stlToGlb(sub: Submission, objectName: string): Promise<Blob> {
  const THREE = await import("three");
  const { STLLoader } = await import("three/examples/jsm/loaders/STLLoader.js");
  const { GLTFExporter } = await import("three/examples/jsm/exporters/GLTFExporter.js");

  // 색칠한 작품은 3MF의 색별 조각, 아니면 STL 한 덩어리
  const pieces: { geometry: import("three").BufferGeometry; hex: string; name: string }[] = [];
  if (sub.model3mf) {
    const { parse3MF } = await import("./export3mf");
    for (const p of await parse3MF(await loadFile(sub.model3mf))) pieces.push({ geometry: p.geometry, hex: p.hex, name: p.name });
  } else {
    pieces.push({
      geometry: new STLLoader().parse(await (await loadFile(sub.stl)).arrayBuffer()),
      hex: FILAMENT_COLORS[sub.color].hex,
      name: `필라멘트_${FILAMENT_COLORS[sub.color].label}`,
    });
  }
  // 전체를 함께 옮겨 가운데 + 바닥(고리 반대쪽 끝)에 맞춤
  const box = new THREE.Box3();
  for (const p of pieces) {
    p.geometry.computeBoundingBox();
    box.union(p.geometry.boundingBox!);
  }
  const c = box.getCenter(new THREE.Vector3());
  for (const p of pieces) {
    p.geometry.translate(-c.x, -box.min.y, -c.z);
    p.geometry.scale(0.001, 0.001, 0.001);
    p.geometry.computeVertexNormals();
  }

  const scene = new THREE.Scene();
  const group = new THREE.Group();
  group.name = objectName;
  const materials: import("three").Material[] = [];
  for (const p of pieces) {
    const info = Object.values(FILAMENT_COLORS).find((x) => x.hex.toLowerCase() === p.hex.toLowerCase());
    const material = new THREE.MeshStandardMaterial({
      name: p.name.startsWith("필라멘트_") ? p.name : `필라멘트_${info?.label ?? p.hex}`,
      color: new THREE.Color(p.hex),
      roughness: info?.metallic ? 0.3 : 0.45,
      metalness: info?.metallic ? 0.8 : 0,
    });
    materials.push(material);
    const mesh = new THREE.Mesh(p.geometry, material);
    mesh.name = pieces.length > 1 ? `${objectName}_${p.name}` : objectName;
    group.add(mesh);
  }
  scene.add(group);

  const result = await new GLTFExporter().parseAsync(scene, { binary: true });
  pieces.forEach((p) => p.geometry.dispose());
  materials.forEach((m) => m.dispose());
  return new Blob([result as ArrayBuffer], { type: "model/gltf-binary" });
}
