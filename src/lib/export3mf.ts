"use client";

import JSZip from "jszip";
import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * 다색 프린터용 3MF.
 * 색마다 부품(object) 하나 → 한 작품(components)으로 묶습니다.
 * 슬라이서(Bambu Studio, OrcaSlicer, PrusaSlicer 등)에서 열면 부품 이름에 색 이름이 있어
 * 부품마다 그 색 필라멘트를 지정하면 됩니다. 단위: mm.
 */
export interface ColorPart {
  name: string; // 예: "판(파랑)", "색칠(빨강)"
  hex: string; // #RRGGBB
  geometries: THREE.BufferGeometry[]; // 월드 좌표로 변환된 지오메트리들
}

function prepare(geos: THREE.BufferGeometry[]) {
  const clean = geos.map((g) => {
    const c = (g.index ? g.toNonIndexed() : g.clone()) as THREE.BufferGeometry;
    for (const name of Object.keys(c.attributes)) if (name !== "position") c.deleteAttribute(name);
    return c;
  });
  const merged = clean.length === 1 ? clean[0] : mergeGeometries(clean, false)!;
  // 같은 위치의 점을 하나로 합쳐 닫힌(수밀) 메시로
  const indexed = mergeVertices(merged, 1e-4);
  clean.forEach((c) => c.dispose());
  if (merged !== clean[0]) merged.dispose();
  return indexed;
}

const esc = (s: string) => s.replace(/[<>&"]/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[ch]!);

export async function build3MF(modelName: string, parts: ColorPart[]): Promise<Blob> {
  const objects: string[] = [];
  const bases = parts.map((p) => `<base name="${esc(p.name)}" displaycolor="${p.hex.toUpperCase()}FF"/>`).join("");
  parts.forEach((part, k) => {
    const g = prepare(part.geometries);
    const pos = g.getAttribute("position");
    const idx = g.index!;
    const v: string[] = [];
    for (let i = 0; i < pos.count; i++) {
      v.push(`<vertex x="${pos.getX(i).toFixed(3)}" y="${pos.getY(i).toFixed(3)}" z="${pos.getZ(i).toFixed(3)}"/>`);
    }
    const t: string[] = [];
    for (let i = 0; i < idx.count; i += 3) {
      t.push(`<triangle v1="${idx.getX(i)}" v2="${idx.getX(i + 1)}" v3="${idx.getX(i + 2)}"/>`);
    }
    g.dispose();
    objects.push(
      `<object id="${k + 2}" type="model" name="${esc(part.name)}" pid="1" pindex="${k}"><mesh><vertices>${v.join("")}</vertices><triangles>${t.join("")}</triangles></mesh></object>`,
    );
  });
  const assemblyId = parts.length + 2;
  const components = parts.map((_, k) => `<component objectid="${k + 2}"/>`).join("");
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="ko-KR" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<metadata name="Title">${esc(modelName)}</metadata>
<metadata name="Application">춘천 꼬마 3D 메이커</metadata>
<resources>
<basematerials id="1">${bases}</basematerials>
${objects.join("\n")}
<object id="${assemblyId}" type="model" name="${esc(modelName)}"><components>${components}</components></object>
</resources>
<build><item objectid="${assemblyId}"/></build>
</model>`;

  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`,
  );
  zip.file("3D/3dmodel.model", model);
  return zip.generateAsync({ type: "blob", compression: "DEFLATE", mimeType: "model/3mf" });
}

/** 우리가 만든 3MF → 색별 지오메트리 (완료 화면·블렌더 파일에서 색을 그대로 보여 주려고) */
export async function parse3MF(blob: Blob): Promise<{ name: string; hex: string; geometry: THREE.BufferGeometry }[]> {
  const zip = await JSZip.loadAsync(blob);
  const xml = await zip.file("3D/3dmodel.model")!.async("string");
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const bases = [...doc.querySelectorAll("basematerials > base")];
  return [...doc.querySelectorAll("object")]
    .filter((o) => o.querySelector("mesh"))
    .map((o) => {
      const verts = [...o.querySelectorAll("vertex")].map((v) => [+v.getAttribute("x")!, +v.getAttribute("y")!, +v.getAttribute("z")!]);
      const pos: number[] = [];
      for (const t of o.querySelectorAll("triangle")) {
        for (const k of ["v1", "v2", "v3"]) pos.push(...verts[+t.getAttribute(k)!]);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      geometry.computeVertexNormals();
      const base = bases[+(o.getAttribute("pindex") ?? 0)];
      const hex = (base?.getAttribute("displaycolor") ?? "#CCCCCC").slice(0, 7);
      return { name: o.getAttribute("name") ?? "", hex, geometry };
    });
}
