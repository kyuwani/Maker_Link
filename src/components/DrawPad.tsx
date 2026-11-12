"use client";

import { useEffect, useRef, useState } from "react";
import { drawStroke, renderStrokes, type Stroke } from "@/lib/drawpad";
import type { ColorKey } from "@/lib/types";

export type PadTool = "pen" | "brush" | "fill" | "eraser";

interface Props {
  strokes: Stroke[];
  onCommit: (s: Stroke) => void;
  penWidth: number;
  tool: PadTool;
  paint: ColorKey;
}

/** 손가락/펜으로 그리는 정사각형 그림판. 한 획이 끝날 때마다 onCommit으로 알려 줍니다. */
export default function DrawPad({ strokes, onCommit, penWidth, tool, paint }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [side, setSide] = useState(0); // CSS px
  const current = useRef<{ id: number; stroke: Stroke } | null>(null);

  // 영역에 맞는 가장 큰 정사각형
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      setSide(Math.floor(Math.min(width, height)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 크기나 획 목록이 바뀌면 다시 그림
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !side) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(side * dpr);
    c.height = Math.round(side * dpr);
    const ctx = c.getContext("2d")!;
    renderStrokes(ctx, strokes, c.width);
  }, [strokes, side]);

  function point(e: React.PointerEvent<HTMLCanvasElement>): [number, number] {
    const r = e.currentTarget.getBoundingClientRect();
    return [
      Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    ];
  }

  function onDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (current.current) return; // 두 번째 손가락은 무시
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // 일부 기기/펜에서 캡처가 안 돼도 그리기는 계속
    }
    const [x, y] = point(e);
    if (tool === "fill") {
      onCommit({ pts: [x, y], w: 0, erase: false, fill: true, paint });
      return;
    }
    const erase = tool === "eraser";
    const stroke: Stroke = {
      pts: [x, y],
      w: erase ? penWidth * 2.2 : tool === "brush" ? penWidth * 1.6 : penWidth,
      erase,
      ...(tool === "brush" ? { paint } : {}),
    };
    current.current = { id: e.pointerId, stroke };
    const c = canvasRef.current!;
    drawStroke(c.getContext("2d")!, stroke, c.width);
  }

  function onMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const cur = current.current;
    if (!cur || cur.id !== e.pointerId) return;
    const c = canvasRef.current!;
    const ctx = c.getContext("2d")!;
    // 촘촘한 움직임 정보가 비어 오는 기기도 있어서, 없으면 이번 이벤트 하나로
    const coalesced = e.nativeEvent.getCoalescedEvents?.();
    const events = coalesced && coalesced.length ? coalesced : [e.nativeEvent];
    const r = c.getBoundingClientRect();
    for (const ev of events) {
      const x = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
      const y = Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height));
      const p = cur.stroke.pts;
      const lx = p[p.length - 2], ly = p[p.length - 1];
      if (Math.hypot(x - lx, y - ly) < 0.002) continue;
      p.push(x, y);
      // 마지막 구간만 바로 그려서 손가락을 따라오게
      drawStroke(ctx, { ...cur.stroke, pts: [lx, ly, x, y] }, c.width);
    }
  }

  function onUp(e: React.PointerEvent<HTMLCanvasElement>) {
    const cur = current.current;
    if (!cur || cur.id !== e.pointerId) return;
    current.current = null;
    onCommit(cur.stroke);
  }

  return (
    <div ref={wrapRef} className="grid h-full w-full place-items-center">
      <canvas
        ref={canvasRef}
        style={{ width: side, height: side }}
        className="touch-none rounded-3xl bg-white shadow-inner ring-4 ring-amber-200"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        aria-label="그림판"
      />
    </div>
  );
}
