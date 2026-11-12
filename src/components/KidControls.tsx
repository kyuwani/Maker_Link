"use client";

import { Check } from "lucide-react";
import { COLOR_ORDER, FILAMENT_COLORS, SIZE_MAX, SIZE_MIN } from "@/lib/constants";
import type { ColorKey } from "@/lib/types";

export function Section({ title, emoji, children }: { title: string; emoji: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-1.5 font-display text-lg text-slate-700">
        <span aria-hidden>{emoji}</span>
        {title}
      </h3>
      {children}
    </section>
  );
}

export function SizeSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="rounded-2xl bg-white px-4 py-2 ring-2 ring-pink-100">
      <div className="flex items-baseline justify-between">
        <span className="text-sm text-slate-500">작게</span>
        <span className="font-display text-2xl text-pink-600">
          {value}
          <span className="text-base">mm</span>
          <span className="ml-1 text-sm text-slate-400">({(value / 10).toFixed(1)}cm)</span>
        </span>
        <span className="text-sm text-slate-500">크게</span>
      </div>
      <input
        type="range"
        className="kid-range"
        min={SIZE_MIN}
        max={SIZE_MAX}
        step={5}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label="크기"
      />
    </div>
  );
}

export function ColorPalette({ value, onChange }: { value: ColorKey; onChange: (c: ColorKey) => void }) {
  return (
    <div className="grid grid-cols-5 gap-x-2 gap-y-3">
      {COLOR_ORDER.map((k) => {
        const c = FILAMENT_COLORS[k];
        const active = value === k;
        return (
          <button
            key={k}
            type="button"
            onClick={() => onChange(k)}
            aria-pressed={active}
            className="flex flex-col items-center gap-1"
          >
            <span
              className={`grid size-12 place-items-center rounded-full border-4 shadow-sm transition active:scale-90 ${
                active ? "scale-110 border-slate-700" : "border-white ring-2 ring-slate-200"
              }`}
              style={{
                background: c.metallic
                  ? `linear-gradient(135deg, #ffffff 0%, ${c.hex} 45%, ${c.hex} 60%, #ffffff 100%)`
                  : c.hex,
              }}
            >
              {active && <Check className={`size-6 ${c.light ? "text-slate-700" : "text-white"}`} strokeWidth={4} />}
            </span>
            <span className={`text-sm ${active ? "font-bold text-slate-800" : "text-slate-500"}`}>{c.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function Toggle<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; emoji: string; hint?: string }[];
}) {
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={active}
            className={`flex min-h-14 flex-col items-center justify-center rounded-2xl px-2 py-2 font-bold transition active:scale-95 ${
              active ? "bg-violet-500 text-white shadow-md shadow-violet-200" : "bg-white text-slate-600 ring-2 ring-slate-200"
            }`}
          >
            <span className="text-base">
              {o.emoji} {o.label}
            </span>
            {o.hint && <span className={`text-xs font-normal ${active ? "text-violet-100" : "text-slate-400"}`}>{o.hint}</span>}
          </button>
        );
      })}
    </div>
  );
}
