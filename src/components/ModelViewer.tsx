"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useEffect, useImperativeHandle, useMemo, useRef, type Ref } from "react";
import * as THREE from "three";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import type { ModelParts } from "@/lib/geometry/model";
import { colorInfoByHex, FILAMENT_COLORS } from "@/lib/constants";
import { build3MF, type ColorPart } from "@/lib/export3mf";
import type { ColorKey } from "@/lib/types";

export interface ViewerApi {
  /** 현재 모델을 바이너리 STL Blob으로 */
  exportSTL(): Blob | null;
  /** 다색 프린터용 3MF (판 색 + 칠한 색마다 부품) */
  export3MF(name: string, plate: ColorKey): Promise<Blob | null>;
  /** 작은 썸네일 이미지(data URL) */
  snapshot(size?: number): string | null;
}

interface Props {
  parts?: ModelParts | null;
  /** 완료 화면처럼 STL에서 읽은 단일 지오메트리를 보여줄 때 */
  geometry?: THREE.BufferGeometry | null;
  /** 다색 작품(3MF에서 읽은 색별 조각) */
  colored?: { geometry: THREE.BufferGeometry; hex: string }[] | null;
  color: string;
  spinIntro?: boolean;
  apiRef?: Ref<ViewerApi>;
  className?: string;
}

/**
 * 볼록한 선(양각)을 판과 확실히 구분되게: 밝은 판이면 선을 어둡게, 어두운 판이면 밝게.
 * (실제 출력물은 한 가지 색이고, 이건 화면에서 잘 보이게 하는 용도)
 */
function contrastColor(hex: string) {
  const c = new THREE.Color(hex);
  const { r, g, b } = c.clone().convertLinearToSRGB();
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return luminance > 0.55
    ? "#" + c.lerp(new THREE.Color("#1e293b"), 0.8).getHexString()
    : "#" + c.lerp(new THREE.Color("#ffffff"), 0.4).getHexString();
}

function Bridge({ apiRef, groupRef }: { apiRef?: Ref<ViewerApi>; groupRef: React.RefObject<THREE.Group | null> }) {
  const { gl, scene, camera } = useThree();
  useImperativeHandle(
    apiRef,
    () => ({
      async export3MF(name, plate) {
        const g = groupRef.current;
        if (!g) return null;
        g.updateMatrixWorld(true);
        const byColor = new Map<ColorKey, THREE.BufferGeometry[]>();
        g.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          const key = (m.userData.paint as ColorKey | undefined) ?? plate;
          const geo = m.geometry.clone().applyMatrix4(m.matrixWorld);
          byColor.set(key, [...(byColor.get(key) ?? []), geo]);
        });
        const parts: ColorPart[] = [...byColor.entries()].map(([key, geometries]) => ({
          name: `${key === plate ? "판" : "색칠"}(${FILAMENT_COLORS[key].label})`,
          hex: FILAMENT_COLORS[key].hex,
          geometries,
        }));
        const blob = await build3MF(name, parts);
        parts.forEach((p) => p.geometries.forEach((x) => x.dispose()));
        return blob;
      },
      exportSTL() {
        const g = groupRef.current;
        if (!g) return null;
        g.updateMatrixWorld(true);
        const dv = new STLExporter().parse(g, { binary: true }) as unknown as DataView;
        return new Blob([dv.buffer as ArrayBuffer], { type: "model/stl" });
      },
      snapshot(size = 320) {
        // frameloop="demand"라도 같은 작업 안에서 그리고 바로 읽으면 캡처됩니다.
        gl.render(scene, camera);
        const src = gl.domElement;
        const c = document.createElement("canvas");
        const ratio = src.width / src.height;
        c.width = size;
        c.height = Math.round(size / ratio);
        const ctx = c.getContext("2d");
        if (!ctx) return null;
        const bg = ctx.createLinearGradient(0, 0, 0, c.height);
        bg.addColorStop(0, "#e0f2fe");
        bg.addColorStop(1, "#fef3c7");
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(src, 0, 0, c.width, c.height);
        return c.toDataURL("image/jpeg", 0.85);
      },
    }),
    [gl, scene, camera, groupRef],
  );
  return null;
}

/** 크기가 바뀌면 카메라 거리를 다시 맞춤 */
function AutoFrame({ extent }: { extent: number }) {
  const { camera, invalidate, controls } = useThree();
  useEffect(() => {
    const d = Math.max(30, extent) * 1.55;
    camera.position.set(0, -d * 0.35, d);
    camera.lookAt(0, 0, 0);
    const c = controls as unknown as { target?: THREE.Vector3; update?: () => void } | null;
    c?.target?.set(0, 0, 0);
    c?.update?.();
    invalidate();
  }, [extent, camera, invalidate, controls]);
  return null;
}

/** 완료 화면용: 처음 몇 초간만 빙글 돌고 멈춤 (그 외에는 렌더링하지 않아 배터리 절약) */
function IntroSpin({ groupRef }: { groupRef: React.RefObject<THREE.Group | null> }) {
  const start = useRef<number | null>(null);
  const { invalidate } = useThree();
  useEffect(() => invalidate(), [invalidate]);
  useFrame(({ clock }) => {
    const g = groupRef.current;
    if (!g) return;
    if (start.current === null) start.current = clock.elapsedTime;
    const t = (clock.elapsedTime - start.current) / 2.4;
    if (t < 1) {
      const e = 1 - Math.pow(1 - t, 3);
      g.rotation.y = e * Math.PI * 2;
      invalidate();
    } else {
      g.rotation.y = 0;
    }
  });
  return null;
}

export default function ModelViewer({ parts, geometry, colored, color, spinIntro, apiRef, className }: Props) {
  const groupRef = useRef<THREE.Group>(null);
  const embossColor = useMemo(() => contrastColor(color), [color]);
  // 금색·은색 필라멘트는 금속처럼 반짝이게
  const metallic = !!colorInfoByHex(color)?.metallic;
  const mat = metallic ? { roughness: 0.28, metalness: 0.55 } : { roughness: 0.45, metalness: 0.05 };
  const extent = useMemo(() => {
    if (parts) return parts.extent;
    if (colored?.length) {
      const box = new THREE.Box3();
      for (const c of colored) {
        c.geometry.computeBoundingBox();
        box.union(c.geometry.boundingBox!);
      }
      const s = box.getSize(new THREE.Vector3());
      return Math.max(s.x, s.y);
    }
    if (geometry) {
      geometry.computeBoundingBox();
      const s = geometry.boundingBox!.getSize(new THREE.Vector3());
      return Math.max(s.x, s.y);
    }
    return 60;
  }, [parts, geometry, colored]);

  // 모델 두께 방향(z) 중심을 원점 근처로 → 회전이 자연스럽게
  const zOffset = parts ? -2 : 0;

  return (
    <div className={`relative h-full w-full touch-none ${className ?? ""}`}>
      <Canvas
        frameloop="demand"
        dpr={[1, 2]}
        camera={{ fov: 40, near: 1, far: 2000, position: [0, -30, 90] }}
        gl={{ antialias: true, alpha: true, powerPreference: "low-power" }}
      >
        <hemisphereLight args={["#ffffff", "#c7d2fe", 1.1]} />
        <directionalLight position={[60, -40, 120]} intensity={1.6} />
        <directionalLight position={[-80, 60, 40]} intensity={0.6} />
        <group ref={groupRef}>
          <group position={[0, 0, zOffset]}>
            {parts && (
              <>
                <mesh geometry={parts.base}>
                  <meshStandardMaterial color={color} {...mat} />
                </mesh>
                {parts.ring && (
                  <mesh geometry={parts.ring}>
                    <meshStandardMaterial color={color} {...mat} />
                  </mesh>
                )}
                {parts.extra && (
                  <mesh geometry={parts.extra}>
                    <meshStandardMaterial color={color} {...mat} />
                  </mesh>
                )}
                {parts.paints?.map((p) => (
                  <mesh key={p.key} geometry={p.geometry} userData={{ paint: p.key }}>
                    <meshStandardMaterial
                      color={FILAMENT_COLORS[p.key].hex}
                      roughness={FILAMENT_COLORS[p.key].metallic ? 0.28 : 0.5}
                      metalness={FILAMENT_COLORS[p.key].metallic ? 0.55 : 0.02}
                    />
                  </mesh>
                ))}
                {parts.emboss && (
                  <mesh geometry={parts.emboss}>
                    <meshStandardMaterial color={embossColor} roughness={mat.roughness} metalness={mat.metalness} />
                  </mesh>
                )}
              </>
            )}
            {colored?.map((c, i) => (
              <mesh key={i} geometry={c.geometry}>
                <meshStandardMaterial
                  color={c.hex}
                  roughness={colorInfoByHex(c.hex)?.metallic ? 0.28 : 0.45}
                  metalness={colorInfoByHex(c.hex)?.metallic ? 0.55 : 0.05}
                />
              </mesh>
            ))}
            {geometry && (
              <mesh geometry={geometry}>
                <meshStandardMaterial color={color} {...mat} />
              </mesh>
            )}
          </group>
        </group>
        <OrbitControls
          makeDefault
          enablePan={false}
          enableDamping={false}
          minDistance={20}
          maxDistance={400}
          touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }}
        />
        <AutoFrame extent={extent} />
        {spinIntro && <IntroSpin groupRef={groupRef} />}
        <Bridge apiRef={apiRef} groupRef={groupRef} />
      </Canvas>
    </div>
  );
}
