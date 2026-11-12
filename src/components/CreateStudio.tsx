"use client";

import { useRouter } from "next/navigation";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Lock, PaintBucket, PenLine, Brush, Box, FileText, Search, Camera, Eraser, ImagePlus, Loader2, Palette, Pencil, Send, Sparkles, Trash2, Undo2 } from "lucide-react";
import ModelViewer, { type ViewerApi } from "./ModelViewer";
import { ColorPalette, Section, SizeSlider, Toggle } from "./KidControls";
import DrawPad, { type PadTool } from "./DrawPad";
import { FRAMES, drawSilhouette, faceStrokes, frameOutlineLayer, type Frame } from "@/lib/frames";
import {
  canFillAt,
  hasInk,
  imageToInkLayer,
  PRINTER_SLOTS,
  PEN_WIDTHS,
  preloadStrokeImages,
  strokesToMask,
  strokesToPaintMasks,
  usedPaintColors,
  type PenSize,
  type Stroke,
} from "@/lib/drawpad";

const WORD_IDEAS = ["강아지", "고양이", "공룡", "로켓", "아이스크림", "무지개", "곰돌이", "막국수", "닭갈비", "토끼", "자동차", "꽃", "펭귄", "케이크", "축구공", "소양강"];
import { COLOR_ORDER, FILAMENT_COLORS, LAST_SUBMISSION_KEY, MODE_LABEL, SIZE_DEFAULT } from "@/lib/constants";
import type { Mask } from "@/lib/geometry/contours";
import { isSegmenterLoaded, segmentObjectAt } from "@/lib/segmentation";
import {
  buildDrawingModel,
  buildPhotoModel,
  buildReliefModel,
  type ReliefStyle,
  buildInkModel,
  disposeParts,
  type DrawingStyle,
  type ModelParts,
} from "@/lib/geometry/model";
import {
  binarize,
  loadImageFile,
  makeSampleDrawing,
  maskToDataUrl,
  overlayMaskDataUrl,
  prepareImage,
  type PreparedImage,
} from "@/lib/geometry/raster";
import { getClassroomService } from "@/lib/services";
import { loadSession } from "@/lib/session";
import type { ColorKey, MakeMode, StudentSession } from "@/lib/types";

const PAD_STEPS = [
  { n: 1, label: "틀 고르기", emoji: "🧸", doing: "마음에 드는 친구를 골라요" },
  { n: 2, label: "꾸미기", emoji: "🖍️", doing: "그리고 색칠해요" },
  { n: 3, label: "완성하기", emoji: "🎁", doing: "크기·색을 골라 보내요" },
] as const;

function FrameThumb({ frame }: { frame: Frame }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, 160, 160);
    drawSilhouette(ctx, frame, 160, frame.tint);
    ctx.fillStyle = "#1e293b";
    const { cx, eyeY, dx, mouthY } = frame.face;
    for (const x of [cx - dx, cx + dx]) {
      ctx.beginPath();
      ctx.arc(x * 160, eyeY * 160, 6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = "#1e293b";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(cx * 160, (mouthY - 0.036) * 160, 9, Math.PI * 0.15, Math.PI * 0.85);
    ctx.stroke();
  }, [frame]);
  return <canvas ref={ref} width={160} height={160} className="aspect-square w-full" />;
}

export default function CreateStudio() {
  const router = useRouter();
  const viewer = useRef<ViewerApi>(null);
  const [session, setSession] = useState<StudentSession | null>(null);

  const [tab, setTab] = useState<"pad" | "drawing">("pad");

  // 그림판
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [pen, setPen] = useState<PenSize>("normal");
  const [tool, setTool] = useState<PadTool>("pen");
  const [paintKey, setPaintKey] = useState<ColorKey>("red");
  const [fillHint, setFillHint] = useState(false);
  const [padView, setPadView] = useState<"draw" | "3d">("draw");
  const [padStyle, setPadStyle] = useState<DrawingStyle>("filled");
  const [padStep, setPadStep] = useState<1 | 2 | 3>(1);
  const [withFace, setWithFace] = useState<"on" | "off">("on");
  const [frameKey, setFrameKey] = useState<string | null>(null);
  const [history, setHistory] = useState<Stroke[][]>([]); // 되돌리기용 스냅샷
  const [word, setWord] = useState("");
  const [wordStatus, setWordStatus] = useState<
    "idle" | "loading" | "ai" | "not_allowed" | "ai_off" | "busy" | "error"
  >("idle");
  const [loadedTitle, setLoadedTitle] = useState("");
  const [suggestions] = useState(() => [...WORD_IDEAS].sort(() => Math.random() - 0.5).slice(0, 6));
  const [size, setSize] = useState(SIZE_DEFAULT);
  const [color, setColor] = useState<ColorKey>("blue");

  const [image, setImage] = useState<PreparedImage | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [threshold, setThreshold] = useState(0.78);
  const [style, setStyle] = useState<DrawingStyle>("filled");
  const [loadingPhoto, setLoadingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState("");

  // 무엇을 찍었나: 종이 그림(선 추출) vs 동물·물건 사진(AI 실루엣)
  const [source, setSource] = useState<"paper" | "photo" | "relief">("paper");
  const [reliefStyle, setReliefStyle] = useState<ReliefStyle>("emboss");
  const [reliefContrast, setReliefContrast] = useState(1.2);
  const [keypoint, setKeypoint] = useState({ x: 0.5, y: 0.5 });
  const [objectMask, setObjectMask] = useState<Mask | null>(null);
  const [segStatus, setSegStatus] = useState<"idle" | "loading" | "running" | "error">("idle");
  const [detailThreshold, setDetailThreshold] = useState(0.6);
  const [details, setDetails] = useState<"on" | "off">("on");

  const [confirming, setConfirming] = useState(false);
  const [leaving, setLeaving] = useState(false); // '처음으로' 확인 창
  const [stepHint, setStepHint] = useState(""); // 아직 못 넘어갈 때 안내
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  useEffect(() => {
    const s = loadSession();
    if (!s) {
      router.replace("/");
      return;
    }
    setSession(s);
  }, [router]);

  // 입력 중에도 화면이 버벅이지 않도록 지연값으로 모델 생성
  const dSize = useDeferredValue(size);
  const dThreshold = useDeferredValue(threshold);

  // 그림판: 한 획이 끝날 때마다 3D 다시 만들기
  const padParts = useMemo<ModelParts | null>(() => {
    if (!hasInk(strokes)) return null;
    try {
      return buildInkModel({ ink: strokesToMask(strokes), paints: strokesToPaintMasks(strokes), style: padStyle, sizeMm: dSize });
    } catch (e) {
      console.error(e);
      return null;
    }
  }, [strokes, padStyle, dSize]);

  const drawingResult = useMemo<{ parts: ModelParts | null; failed: boolean }>(() => {
    if (!image) return { parts: null, failed: false };
    try {
      const parts = buildDrawingModel({ image, threshold: dThreshold, style, sizeMm: dSize });
      return { parts, failed: !parts };
    } catch (e) {
      console.error(e);
      return { parts: null, failed: true };
    }
  }, [image, dThreshold, style, dSize]);

  // 사진 모드: 사진 또는 누른 지점이 바뀌면 AI로 물체 실루엣 찾기
  useEffect(() => {
    if (source !== "photo" || !image) return;
    let alive = true;
    setSegStatus(isSegmenterLoaded() ? "running" : "loading");
    segmentObjectAt(image.canvas, keypoint)
      .then((m) => {
        if (!alive) return;
        setObjectMask(m);
        setSegStatus("idle");
      })
      .catch((e) => {
        console.error(e);
        if (alive) setSegStatus("error");
      });
    return () => {
      alive = false;
    };
  }, [source, image, keypoint]);

  const dDetailThreshold = useDeferredValue(detailThreshold);
  const photoResult = useMemo<{ parts: ModelParts | null; failed: boolean }>(() => {
    if (!image || !objectMask) return { parts: null, failed: false };
    try {
      const parts = buildPhotoModel({
        image,
        objectMask,
        threshold: dDetailThreshold,
        details: details === "on",
        sizeMm: dSize,
      });
      return { parts, failed: !parts };
    } catch (e) {
      console.error(e);
      return { parts: null, failed: true };
    }
  }, [image, objectMask, dDetailThreshold, details, dSize]);

  useEffect(() => () => disposeParts(padParts), [padParts]);
  useEffect(() => () => disposeParts(drawingResult.parts), [drawingResult]);
  useEffect(() => () => disposeParts(photoResult.parts), [photoResult]);

  // 사진 판: 아무 사진이나 높이맵으로
  const dReliefContrast = useDeferredValue(reliefContrast);
  const reliefResult = useMemo<{ parts: ModelParts | null; failed: boolean }>(() => {
    if (!image || source !== "relief") return { parts: null, failed: false };
    try {
      return {
        parts: buildReliefModel({ image, style: reliefStyle, contrast: dReliefContrast, sizeMm: dSize }),
        failed: false,
      };
    } catch (e) {
      console.error(e);
      return { parts: null, failed: true };
    }
  }, [image, source, reliefStyle, dReliefContrast, dSize]);
  useEffect(() => () => disposeParts(reliefResult.parts), [reliefResult]);

  const inkPreview = useMemo(
    () => (image && source === "paper" ? maskToDataUrl(binarize(image, dThreshold)) : null),
    [image, dThreshold, source],
  );
  const objectPreview = useMemo(
    () => (image && objectMask && source === "photo" ? overlayMaskDataUrl(image.canvas, objectMask) : null),
    [image, objectMask, source],
  );

  useEffect(() => () => {
    if (photoUrl?.startsWith("blob:")) URL.revokeObjectURL(photoUrl);
  }, [photoUrl]);

  const freeResult = source === "paper" ? drawingResult : source === "photo" ? photoResult : reliefResult;
  const parts = tab === "pad" ? padParts : freeResult.parts;
  // 몸체가 여러 조각이면 출력 후 떨어져 나가므로 제출을 막음
  const broken = !!parts && parts.pieces > 1;
  const submitMode: MakeMode =
    tab === "pad" ? "canvas" : source === "photo" ? "photo" : source === "relief" ? "relief" : "drawing";
  const hex = FILAMENT_COLORS[color].hex;

  function applyStrokes(next: Stroke[]) {
    setHistory((h) => [...h.slice(-30), strokes]);
    setStrokes(next);
  }

  /** 1단계: 캐릭터 틀을 그림판에 올리기 (얼굴은 선택) */
  async function chooseFrame(f: Frame | null, face = withFace) {
    setFrameKey(f?.key ?? "blank");
    setPadView("draw");
    if (!f) {
      applyStrokes([]);
      return;
    }
    const layer = frameOutlineLayer(f);
    await preloadStrokeImages([layer]);
    applyStrokes(face === "on" ? [layer, ...faceStrokes(f)] : [layer]);
  }

  /** n단계로 갈 수 있는지와, 못 가면 무엇을 해야 하는지 */
  function stepBlock(n: 1 | 2 | 3): string {
    if (n >= 2 && frameKey === null && strokes.length === 0) return "🧸 먼저 친구 틀을 고르거나 '빈 종이'를 눌러 주세요!";
    if (n >= 3 && !hasInk(strokes)) return "🖍️ 그림을 조금 그려 주세요!";
    if (n >= 3 && !padParts) return "⏳ 3D를 만들고 있어요. 잠깐만요!";
    if (n >= 3 && padParts && padParts.pieces > 1)
      return `🧩 작품이 ${padParts.pieces}조각으로 나뉘었어요. 선을 이어 그려 한 덩어리로 만들어 주세요!`;
    return "";
  }

  function goStep(n: 1 | 2 | 3) {
    // 앞 단계로 돌아가는 건 언제든, 다음 단계는 조건을 채웠을 때만
    if (n > padStep) {
      const block = stepBlock(n);
      if (block) {
        setStepHint(block);
        setTimeout(() => setStepHint(""), 2800);
        return;
      }
    }
    setStepHint("");
    setPadStep(n);
    setPadView(n === 3 ? "3d" : "draw");
    if (n === 2) setTool("pen");
  }

  /** 단어 → Google 이미지 AI가 그린 도안을 그림판 레이어로 */
  async function loadWord(raw: string) {
    const w = raw.trim();
    if (!w || wordStatus === "loading") return;
    setWord(w);
    setWordStatus("loading");
    try {
      const res = await fetch("/api/design", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ word: w, roomCode: session?.code }),
      });
      const data = await res.json();
      if (res.ok && typeof data.image === "string") {
        const layer: Stroke = { pts: [], w: 0, erase: false, img: await imageToInkLayer(data.image) };
        await preloadStrokeImages([layer]);
        applyStrokes([layer]);
        setFrameKey("ai");
        setLoadedTitle(data.title ?? w);
        setWordStatus("ai");
        setPadView("draw");
      } else if (data.error === "not_allowed" || data.error === "empty") setWordStatus("not_allowed");
      else if (data.error === "ai_not_configured") setWordStatus("ai_off");
      else if (data.error === "rate_limited") setWordStatus("busy");
      else setWordStatus("error");
    } catch {
      setWordStatus("error");
    }
  }

  function resetPhotoState() {
    setObjectMask(null);
    setKeypoint({ x: 0.5, y: 0.5 });
  }

  function pickPoint(e: React.MouseEvent<HTMLImageElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    setKeypoint({
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    });
  }

  async function onPhoto(file: File | undefined) {
    if (!file) return;
    setPhotoError("");
    setLoadingPhoto(true);
    try {
      const img = await loadImageFile(file);
      resetPhotoState();
      setImage(prepareImage(img));
      setPhotoUrl(URL.createObjectURL(file));
    } catch {
      setPhotoError("사진을 열 수 없어요. 다시 찍어 볼까요?");
    } finally {
      setLoadingPhoto(false);
    }
  }

  function loadSample() {
    const c = makeSampleDrawing();
    resetPhotoState();
    setSource("paper");
    setImage(prepareImage(c));
    setPhotoUrl(c.toDataURL("image/png"));
    setPhotoError("");
  }

  async function submit() {
    if (!session || !parts || !viewer.current) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      const stl = viewer.current.exportSTL();
      if (!stl) throw new Error("STL 생성 실패");
      const thumbnail = viewer.current.snapshot(320) ?? undefined;
      const paintColors = parts.paints?.map((p) => p.key) ?? [];
      const model3mf = paintColors.length
        ? ((await viewer.current.export3MF(`${session.code}_${session.name}`, color)) ?? undefined)
        : undefined;
      const sub = await getClassroomService().addSubmission({
        roomCode: session.code,
        studentName: session.name,
        mode: submitMode,
        color,
        purpose: "keyring",
        sizeMm: size,
        thumbnail,
        stl,
        paintColors: paintColors.length ? paintColors : undefined,
        model3mf,
      });
      try {
        localStorage.setItem(LAST_SUBMISSION_KEY, sub.id);
      } catch {}
      router.push(`/complete?id=${encodeURIComponent(sub.id)}`);
    } catch (e) {
      console.error(e);
      setSubmitError("앗, 제출이 안 됐어요. 한 번 더 눌러 주세요!");
      setSubmitting(false);
      setConfirming(false);
    }
  }

  if (!session) {
    return (
      <div className="grid h-dvh place-items-center">
        <Loader2 className="size-10 animate-spin text-pink-400" />
      </div>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col bg-amber-50">
      {/* 맨 위: 지금 몇 단계인지 항상 보이는 진행 표시 */}
      <header className="sticky top-0 z-30 shrink-0 border-b border-amber-100 bg-white px-3 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              const hasWork = strokes.length > 0 || !!image;
              if (hasWork) setLeaving(true);
              else router.push("/");
            }}
            className="grid size-11 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-600"
            aria-label="처음 화면으로"
          >
            <ArrowLeft className="size-6" />
          </button>
          {tab === "pad" ? (
            <ol className="flex flex-1 items-center" aria-label="만들기 단계">
              {PAD_STEPS.map((st, i) => {
                const done = padStep > st.n;
                const now = padStep === st.n;
                const locked = st.n > padStep && !!stepBlock(st.n);
                return (
                  <li key={st.n} className="flex flex-1 items-center last:flex-none">
                    <button
                      onClick={() => goStep(st.n)}
                      aria-current={now ? "step" : undefined}
                      aria-disabled={locked || undefined}
                      className="flex min-h-11 flex-col items-center justify-center px-0.5"
                    >
                      <span
                        className={`grid place-items-center rounded-full font-bold transition-all ${
                          now
                            ? "size-8 bg-violet-500 text-base text-white shadow-md shadow-violet-200"
                            : done
                              ? "size-7 bg-emerald-500 text-sm text-white"
                              : "size-7 bg-slate-100 text-sm text-slate-400"
                        }`}
                      >
                        {done ? "✓" : locked ? <Lock className="size-3.5" /> : st.n}
                      </span>
                      <span className={`mt-0.5 whitespace-nowrap text-[11px] leading-none ${now ? "font-bold text-violet-700" : done ? "text-emerald-700" : "text-slate-400"}`}>
                        {st.label}
                      </span>
                    </button>
                    {i < PAD_STEPS.length - 1 && (
                      <span className={`mx-1 mb-3 h-1 flex-1 rounded-full ${done ? "bg-emerald-400" : "bg-slate-200"}`} />
                    )}
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="flex-1 font-display text-lg text-slate-700">📸 사진을 찍어 3D로 만들어요</p>
          )}
        </div>
        {tab === "pad" && (
          <div className="mt-1.5 flex items-center gap-2">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-gradient-to-r from-violet-400 to-fuchsia-500 transition-all duration-500"
                style={{ width: `${(padStep / PAD_STEPS.length) * 100}%` }}
              />
            </div>
            <span className="shrink-0 text-xs font-bold text-violet-700">
              {padStep}/{PAD_STEPS.length} · {PAD_STEPS[padStep - 1].emoji} {PAD_STEPS[padStep - 1].doing}
            </span>
          </div>
        )}
      </header>

      {/* 3D 뷰어 */}
      <div className="relative shrink-0 bg-gradient-to-b from-sky-100 via-sky-50 to-amber-50" style={{ height: "min(500px, calc(100vw + 30px), 62dvh)" }}>
        <ModelViewer parts={parts} color={hex} apiRef={viewer} />

        {/* 그림판: 3D 뷰어 위에 덮어서 그리기 (뷰어는 계속 살아 있어 제출 시 STL 내보내기 가능) */}
        {tab === "pad" && padView === "draw" && (
          <div className="absolute inset-0 bg-amber-50 px-2 pb-14 pt-8">
            <DrawPad
              strokes={strokes}
              onCommit={(s) => {
                // 페인트통은 선으로 둘러싸인 칸 안에서만 (바깥을 채우면 네모판이 돼요)
                if (s.fill && !canFillAt(strokes, s.pts[0], s.pts[1])) {
                  setFillHint(true);
                  setTimeout(() => setFillHint(false), 2500);
                  return;
                }
                applyStrokes([...strokes, s]);
              }}
              penWidth={PEN_WIDTHS[pen]}
              tool={tool}
              paint={paintKey}
            />
            {fillHint && (
              <p className="pointer-events-none absolute inset-x-6 bottom-20 rounded-2xl bg-orange-500/95 px-4 py-2 text-center text-sm font-bold text-white shadow">
                🪣 선으로 둘러싸인 칸 안을 눌러야 칠해져요!
              </p>
            )}
            {!strokes.length && (
              <p className="pointer-events-none absolute inset-0 grid place-items-center font-display text-2xl text-slate-300">
                손가락으로 그려 보세요 ✏️
              </p>
            )}
          </div>
        )}
        {tab === "pad" && (
          <div className="absolute inset-x-0 bottom-2 z-10 flex justify-center">
            <div className="flex rounded-full bg-white/95 p-1 shadow">
              {(
                [
                  { k: "draw", label: "그리기", icon: <Pencil className="size-5" /> },
                  { k: "3d", label: "3D 보기", icon: <Box className="size-5" /> },
                ] as const
              ).map((v) => (
                <button
                  key={v.k}
                  onClick={() => setPadView(v.k)}
                  aria-pressed={padView === v.k}
                  className={`flex min-h-12 items-center gap-1.5 rounded-full px-5 font-display text-lg ${
                    padView === v.k ? "bg-violet-500 text-white" : "text-slate-500"
                  }`}
                >
                  {v.icon}
                  {v.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-end p-2">
          <div className="rounded-full bg-white/90 px-3 py-1 text-xs font-bold text-slate-600 shadow">
            🙋 {session.name} · 수업 {session.code}
          </div>
        </div>

        {!parts && !(tab === "pad" && padView === "draw") && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center p-8 text-center">
            <div className="whitespace-pre-line rounded-3xl bg-white/80 px-6 py-5 font-display text-xl text-slate-500 shadow">
              {tab === "drawing" && source === "photo" && image && (segStatus === "loading" || segStatus === "running")
                ? segStatus === "loading"
                  ? "🤖 AI 친구를 깨우는 중…\n(처음 한 번만 조금 걸려요)"
                  : "🤖 AI가 모양을 찾고 있어요…"
                : tab === "drawing" && source === "photo" && segStatus === "error"
                  ? "AI를 불러오지 못했어요 😢\n인터넷 연결을 확인해 주세요"
                  : tab === "drawing" && freeResult.failed
                    ? source === "photo"
                      ? "모양을 못 찾았어요 😢\n사진 속 물체를 콕 눌러 보세요"
                      : "그림을 못 찾았어요 😢\n'선 찾기' 를 오른쪽으로 옮겨 보세요"
                    : tab === "pad"
                      ? "✏️ 그림판에 그리면\n여기에 3D로 나타나요!"
                      : source === "photo"
                      ? "🐶 동물이나 물건을 찍으면\n여기에 3D로 나타나요!"
                      : source === "relief"
                        ? "🖼️ 아무 사진이나 넣으면\n사진 판이 돼요!"
                        : "📸 그림을 찍으면\n여기에 3D로 나타나요!"}
            </div>
          </div>
        )}

        {broken && (
          <div className="pointer-events-none absolute inset-x-3 top-10 rounded-2xl bg-orange-500/95 px-4 py-2 text-center text-sm font-bold text-white shadow">
            ⚠️ 작품이 {parts!.pieces}조각으로 나뉘었어요! 프린트하면 떨어져요.
            <br />
            {tab === "pad" || source === "paper" ? "'속 채우기'를 고르거나 선을 이어서 그려 주세요." : "다른 곳을 콕 눌러 보세요."}
          </div>
        )}

        {parts && tab !== "pad" && (
          <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center">
            <span className="rounded-full bg-white/80 px-3 py-1 text-xs text-slate-500">
              👆 한 손가락: 빙글빙글 · ✌️ 두 손가락: 크게/작게
            </span>
          </div>
        )}
      </div>

      {/* 하단 45%: 조작 패널 */}
      <div className="flex flex-1 flex-col rounded-t-[2rem] bg-white shadow-[0_-8px_24px_rgb(0_0_0/0.06)]">
        <div className="grid grid-cols-2 gap-2 p-3 pb-2">
          {(
            [
              { k: "pad", label: "그림판", icon: <Palette className="size-5" /> },
              { k: "drawing", label: "손그림 찍기", icon: <Camera className="size-5" /> },
            ] as const
          ).map((t) => (
            <button
              key={t.k}
              onClick={() => setTab(t.k)}
              aria-pressed={tab === t.k}
              className={`flex min-h-12 items-center justify-center gap-1.5 rounded-full font-display text-lg transition ${
                tab === t.k ? "bg-pink-500 text-white shadow-md shadow-pink-200" : "bg-slate-100 text-slate-500"
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex-1 space-y-5 px-4 pb-6 pt-1">
          {tab === "pad" ? (
            <>
              {padStep === 1 && (
                <>
                  <Section title="1단계: 마음에 드는 친구를 골라요" emoji="🧸">
                    <div className="grid grid-cols-3 gap-2">
                      {FRAMES.map((f) => (
                        <button
                          key={f.key}
                          onClick={() => chooseFrame(f)}
                          aria-pressed={frameKey === f.key}
                          className={`rounded-2xl p-1.5 pb-2 transition active:scale-95 ${
                            frameKey === f.key ? "bg-violet-100 ring-4 ring-violet-400" : "bg-amber-50 ring-2 ring-amber-100"
                          }`}
                        >
                          <FrameThumb frame={f} />
                          <span className="block font-display text-base leading-tight text-slate-800">{f.nick}</span>
                          <span className="block text-xs text-slate-500">{f.kind}</span>
                        </button>
                      ))}
                    </div>
                    <Toggle
                      value={withFace}
                      onChange={(v) => {
                        setWithFace(v);
                        const f = FRAMES.find((x) => x.key === frameKey);
                        if (f) chooseFrame(f, v);
                      }}
                      options={[
                        { value: "on", label: "얼굴 같이 넣기", emoji: "😊", hint: "지우개로 지울 수 있어요" },
                        { value: "off", label: "얼굴은 내가 그릴래", emoji: "✏️", hint: "빈 얼굴로 시작" },
                      ]}
                    />
                    <button
                      onClick={() => chooseFrame(null)}
                      className={`flex min-h-12 w-full items-center justify-center gap-1.5 rounded-full font-bold active:scale-95 ${
                        frameKey === "blank" ? "bg-violet-100 text-violet-700 ring-4 ring-violet-400" : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      <FileText className="size-5" /> 틀 없이 빈 종이에서 시작
                    </button>
                  </Section>

              <Section title="또는 AI에게 그려 달라고 하기" emoji="🔍">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    loadWord(word);
                  }}
                  className="flex gap-2"
                >
                  <input
                    value={word}
                    maxLength={20}
                    onChange={(e) => setWord(e.target.value)}
                    placeholder="예: 강아지, 로켓, 막국수"
                    className="h-14 min-w-0 flex-1 rounded-2xl border-4 border-violet-100 bg-violet-50 px-4 font-display text-xl text-violet-700 placeholder:text-violet-300 focus:border-violet-300 focus:outline-none"
                  />
                  <button
                    disabled={!word.trim() || wordStatus === "loading"}
                    className="flex h-14 shrink-0 items-center gap-1 rounded-2xl bg-violet-500 px-4 font-display text-lg text-white active:scale-95 disabled:opacity-50"
                  >
                    {wordStatus === "loading" ? <Loader2 className="size-5 animate-spin" /> : <Search className="size-5" />}
                    찾기
                  </button>
                </form>
                <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
                  {suggestions.map((w) => (
                    <button
                      key={w}
                      onClick={() => loadWord(w)}
                      disabled={wordStatus === "loading"}
                      className="min-h-12 shrink-0 rounded-full bg-amber-50 px-4 font-bold text-slate-700 ring-2 ring-amber-100 active:scale-95 disabled:opacity-50"
                    >
                      {w}
                    </button>
                  ))}
                </div>
                {wordStatus !== "idle" && (
                  <p
                    className={`rounded-xl px-3 py-2 text-sm ${
                      wordStatus === "ai"
                        ? "bg-emerald-50 text-emerald-700"
                        : wordStatus === "loading"
                          ? "bg-violet-50 text-violet-700"
                          : "bg-orange-50 text-orange-700"
                    }`}
                  >
                    {wordStatus === "ai" && <>✨ AI가 <b>{loadedTitle}</b> 도안을 그렸어요! 마음에 안 들면 고쳐 그려요.</>}
                    {wordStatus === "loading" && <>🎨 AI가 &lsquo;{word}&rsquo; 도안을 그리고 있어요… (10초쯤 걸려요)</>}
                    {wordStatus === "not_allowed" && <>🙅 &lsquo;{word}&rsquo;은(는) 도안으로 만들 수 없어요. 다른 단어를 써 볼까요?</>}
                    {wordStatus === "ai_off" && <>🔌 AI 그림 기능이 아직 켜지지 않았어요. 선생님께 알려 주세요! 그동안은 직접 그려 볼까요?</>}
                    {wordStatus === "busy" && <>⏳ 지금 친구들이 많이 쓰고 있어요. 잠깐 뒤에 다시 눌러 주세요.</>}
                    {wordStatus === "error" && <>😢 도안을 불러오지 못했어요. 다시 해 볼까요?</>}
                  </p>
                )}
              </Section>

                </>
              )}

              {padStep === 2 && (
                <>
                  <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm leading-relaxed text-slate-600 ring-2 ring-amber-100">
                    🖍️ <b>2단계: 꾸미기</b> — 틀 안에 눈·코·입, 무늬, 내 이름을 그려요. 틀 선을 지우개로 지워도 괜찮아요!
                  </p>
              <Section title="도구" emoji="🧰">
                <div className="grid grid-cols-4 gap-2">
                  {(
                    [
                      { k: "pen", label: "펜", icon: <PenLine className="size-6" /> },
                      { k: "brush", label: "색연필", icon: <Brush className="size-6" /> },
                      { k: "fill", label: "페인트통", icon: <PaintBucket className="size-6" /> },
                      { k: "eraser", label: "지우개", icon: <Eraser className="size-6" /> },
                    ] as const
                  ).map((t) => (
                    <button
                      key={t.k}
                      onClick={() => {
                        setTool(t.k);
                        setPadView("draw");
                      }}
                      aria-pressed={tool === t.k}
                      className={`flex min-h-16 flex-col items-center justify-center gap-1 rounded-2xl ${
                        tool === t.k ? "bg-violet-500 text-white shadow-md shadow-violet-200" : "bg-white text-slate-600 ring-2 ring-slate-200"
                      }`}
                    >
                      {t.icon}
                      <span className="text-sm font-bold">{t.label}</span>
                    </button>
                  ))}
                </div>

                {tool !== "fill" && (
                  <div className="grid grid-cols-3 gap-2">
                    {(
                      [
                        { k: "thin", label: "가늘게", dot: 8 },
                        { k: "normal", label: "보통", dot: 14 },
                        { k: "thick", label: "굵게", dot: 22 },
                      ] as const
                    ).map((p) => (
                      <button
                        key={p.k}
                        onClick={() => setPen(p.k)}
                        aria-pressed={pen === p.k}
                        className={`flex min-h-12 items-center justify-center gap-2 rounded-2xl ${
                          pen === p.k ? "bg-violet-100 text-violet-700 ring-2 ring-violet-400" : "bg-white text-slate-500 ring-2 ring-slate-200"
                        }`}
                      >
                        <span className="rounded-full bg-current" style={{ width: p.dot, height: p.dot }} />
                        <span className="text-sm font-bold">{p.label}</span>
                      </button>
                    ))}
                  </div>
                )}

                {(tool === "brush" || tool === "fill") && (() => {
                  const used = usedPaintColors(strokes);

                  return (
                    <div className="rounded-2xl bg-white p-3 ring-2 ring-pink-100">
                      <p className="mb-2 text-sm text-slate-600">
                        🎨 칠한 색 <b>{used.length}</b>가지 · 마음껏 칠해요!
                      </p>
                      <div className="grid grid-cols-5 gap-x-2 gap-y-2">
                        {COLOR_ORDER.map((k) => {
                          const c = FILAMENT_COLORS[k];
                          return (
                            <button
                              key={k}
                              onClick={() => setPaintKey(k)}
                              aria-pressed={paintKey === k}
                              aria-label={c.label}
                              className="flex flex-col items-center gap-0.5 disabled:opacity-25"
                            >
                              <span
                                className={`size-11 rounded-full border-4 ${paintKey === k ? "scale-110 border-slate-700" : "border-white ring-2 ring-slate-200"}`}
                                style={{ background: c.hex }}
                              />
                              <span className={`text-xs ${paintKey === k ? "font-bold text-slate-800" : "text-slate-500"}`}>{c.label}</span>
                            </button>
                          );
                        })}
                      </div>
                      {tool === "fill" && <p className="mt-2 text-xs text-slate-500">🪣 선으로 둘러싸인 칸을 콕 누르면 그 칸이 칠해져요.</p>}
                    </div>
                  );
                })()}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    disabled={!history.length}
                    onClick={() => {
                      setStrokes(history[history.length - 1] ?? []);
                      setHistory((h) => h.slice(0, -1));
                    }}
                    className="flex min-h-12 items-center justify-center gap-1.5 rounded-full bg-slate-100 font-bold text-slate-600 active:scale-95 disabled:opacity-40"
                  >
                    <Undo2 className="size-5" /> 되돌리기
                  </button>
                  <button
                    disabled={!strokes.length}
                    onClick={() => {
                      applyStrokes([]);
                      setPadView("draw");
                    }}
                    className="flex min-h-12 items-center justify-center gap-1.5 rounded-full bg-slate-100 font-bold text-slate-600 active:scale-95 disabled:opacity-40"
                  >
                    <Trash2 className="size-5" /> 모두 지우기
                  </button>
                </div>
              </Section>

                </>
              )}

              {padStep === 3 && (
                <>
                  <p className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm leading-relaxed text-emerald-800 ring-2 ring-emerald-100">
                    🎁 <b>3단계: 완성하기</b> — 위에서 3D 작품을 돌려 보고, 크기와 색깔을 골라 선생님께 보내요!
                  </p>
              <Section title="만드는 방법" emoji="🛠️">
                <Toggle
                  value={padStyle}
                  onChange={setPadStyle}
                  options={[
                    { value: "filled", label: "속 채우기", emoji: "🍪", hint: "튼튼한 판 위에 그림" },
                    { value: "lines", label: "선만 살리기", emoji: "〰️", hint: "그린 선 모양 그대로" },
                  ]}
                />
              </Section>

              <Section title="크기" emoji="📏">
                <SizeSlider value={size} onChange={setSize} />
              </Section>

              <Section title={usedPaintColors(strokes).length ? "판 색깔" : "색깔 (필라멘트)"} emoji="🎨">
                <ColorPalette value={color} onChange={setColor} />
                {usedPaintColors(strokes).length > 0 && (() => {
                  const all = new Set([color, ...usedPaintColors(strokes)]);
                  return (
                    <p className="rounded-xl bg-violet-50 px-3 py-2 text-sm text-violet-800">
                      🖨️ 다색 프린터로 뽑아요: 판 <b>{FILAMENT_COLORS[color].label}</b> + 칠한 색{" "}
                      <b>{usedPaintColors(strokes).map((k) => FILAMENT_COLORS[k].label).join(", ")}</b> = 필라멘트 <b>{all.size}가지</b>
                      {all.size > PRINTER_SLOTS && (
                        <span className="mt-1 block text-orange-700">
                          🙂 색이 많아서 프린터에 따라 비슷한 색으로 바뀌어 나올 수도 있어요.
                        </span>
                      )}
                    </p>
                  );
                })()}
              </Section>
                </>
              )}
            </>
          ) : (
            <>
              <Section title="무엇을 찍을까요?" emoji="🤔">
                <Toggle
                  value={source}
                  onChange={setSource}
                  options={[
                    { value: "paper", label: "종이 그림", emoji: "📝", hint: "사인펜으로 그린 그림" },
                    { value: "photo", label: "동물·물건", emoji: "🐶", hint: "AI가 모양을 오려요" },
                    { value: "relief", label: "사진 판", emoji: "🖼️", hint: "어떤 사진이든 OK" },
                  ]}
                />
              </Section>

              <div className="space-y-2">
                <label className="flex min-h-20 cursor-pointer items-center justify-center gap-3 rounded-3xl bg-gradient-to-r from-sky-400 to-indigo-500 font-display text-2xl text-white shadow-lg shadow-sky-200 active:scale-95">
                  {loadingPhoto ? <Loader2 className="size-8 animate-spin" /> : <Camera className="size-8" />}
                  {image ? "다시 찍기" : source === "paper" ? "카메라로 그림 찍기" : "카메라로 사진 찍기"}
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="sr-only"
                    onChange={(e) => {
                      onPhoto(e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="flex min-h-12 cursor-pointer items-center justify-center gap-1.5 rounded-full bg-slate-100 text-sm font-bold text-slate-600 active:scale-95">
                    <ImagePlus className="size-5" /> 앨범에서 고르기
                    <input
                      type="file"
                      accept="image/*"
                      className="sr-only"
                      onChange={(e) => {
                        onPhoto(e.target.files?.[0]);
                        e.target.value = "";
                      }}
                    />
                  </label>
                  <button
                    onClick={loadSample}
                    className="flex min-h-12 items-center justify-center gap-1.5 rounded-full bg-slate-100 text-sm font-bold text-slate-600 active:scale-95"
                  >
                    <Sparkles className="size-5" /> 예시 그림 써보기
                  </button>
                </div>
                {photoError && <p className="text-center font-bold text-red-500">{photoError}</p>}
              </div>

              {!image && (
                <div className="rounded-2xl bg-amber-50 p-4 text-sm leading-relaxed text-slate-600 ring-2 ring-amber-100">
                  <p className="mb-1 font-display text-base text-amber-700">💡 이렇게 하면 잘 돼요</p>
                  {source === "paper" ? (
                    <ul className="list-inside list-disc space-y-0.5">
                      <li>하얀 종이에 <b>굵은 검정 사인펜</b>으로 그려요</li>
                      <li>선이 끊기지 않게 <b>이어서</b> 그려요</li>
                      <li>밝은 곳에서 종이만 보이게 찍어요</li>
                    </ul>
                  ) : source === "relief" ? (
                    <ul className="list-inside list-disc space-y-0.5">
                      <li><b>어떤 사진</b>이든 넣을 수 있어요 (그림, 풍경, 캐릭터…)</li>
                      <li>사진이 판 위에 <b>울퉁불퉁 새겨져요</b></li>
                      <li>밝고 어두운 게 <b>뚜렷한 사진</b>일수록 잘 보여요</li>
                    </ul>
                  ) : (
                    <ul className="list-inside list-disc space-y-0.5">
                      <li>만들고 싶은 동물·물건이 <b>크게, 한가운데</b> 오게 찍어요</li>
                      <li>뒤쪽 배경은 <b>단순할수록</b> 좋아요</li>
                      <li>사진을 올린 뒤 원하는 물체를 <b>콕</b> 누르면 돼요</li>
                    </ul>
                  )}
                </div>
              )}

              {image && source === "photo" && (
                <>
                  <figure className="overflow-hidden rounded-2xl bg-slate-50 ring-2 ring-slate-100">
                    <div className="relative mx-auto w-fit">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={objectPreview ?? photoUrl ?? ""}
                        alt="찍은 사진 (콕 눌러서 물체 고르기)"
                        onClick={pickPoint}
                        className="block max-h-72 w-auto max-w-full cursor-crosshair"
                      />
                      <span
                        className="pointer-events-none absolute size-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-white bg-pink-500 shadow"
                        style={{ left: `${keypoint.x * 100}%`, top: `${keypoint.y * 100}%` }}
                      />
                      {(segStatus === "loading" || segStatus === "running") && (
                        <div className="absolute inset-0 grid place-items-center bg-white/50">
                          <Loader2 className="size-10 animate-spin text-pink-500" />
                        </div>
                      )}
                    </div>
                    <figcaption className="py-1.5 text-center text-sm text-slate-600">
                      👆 만들고 싶은 것을 <b>콕</b> 눌러요 · <span className="text-pink-600">분홍색</span>이 3D로 바뀌어요
                    </figcaption>
                  </figure>
                  {segStatus === "error" && (
                    <button
                      onClick={() => setKeypoint({ ...keypoint })}
                      className="min-h-12 w-full rounded-full bg-red-50 font-bold text-red-600"
                    >
                      AI를 불러오지 못했어요 · 다시 해보기
                    </button>
                  )}

                  <Section title="얼굴·무늬 새기기" emoji="✨">
                    <Toggle
                      value={details}
                      onChange={setDetails}
                      options={[
                        { value: "on", label: "무늬 넣기", emoji: "🐾", hint: "눈·코가 볼록하게" },
                        { value: "off", label: "모양만", emoji: "🍪", hint: "매끈한 실루엣" },
                      ]}
                    />
                    {details === "on" && (
                      <div className="rounded-2xl bg-white px-4 py-2 ring-2 ring-pink-100">
                        <div className="flex justify-between text-sm text-slate-500">
                          <span>진한 무늬만</span>
                          <span>연한 무늬까지</span>
                        </div>
                        <input
                          type="range"
                          className="kid-range"
                          min={0.35}
                          max={0.9}
                          step={0.01}
                          value={detailThreshold}
                          onChange={(e) => setDetailThreshold(Number(e.target.value))}
                          aria-label="무늬 찾기 민감도"
                        />
                      </div>
                    )}
                  </Section>

                  <Section title="크기" emoji="📏">
                    <SizeSlider value={size} onChange={setSize} />
                  </Section>

                  <Section title="색깔 (필라멘트)" emoji="🎨">
                    <ColorPalette value={color} onChange={setColor} />
                  </Section>
                </>
              )}

              {image && source === "relief" && (
                <>
                  <figure className="overflow-hidden rounded-2xl bg-slate-50 ring-2 ring-slate-100">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {photoUrl && <img src={photoUrl} alt="넣은 사진" className="mx-auto block max-h-56 w-auto max-w-full" />}
                    <figcaption className="py-1.5 text-center text-xs text-slate-500">사진이 판에 그대로 새겨져요</figcaption>
                  </figure>

                  <Section title="어떻게 새길까요?" emoji="🖨️">
                    <Toggle
                      value={reliefStyle}
                      onChange={(v) => {
                        setReliefStyle(v);
                        if (v === "litho") setColor("white"); // 빛 사진은 하얀색이 가장 잘 보임
                      }}
                      options={[
                        { value: "emboss", label: "볼록 사진", emoji: "⛰️", hint: "어두운 곳이 튀어나와요" },
                        { value: "litho", label: "빛 사진", emoji: "💡", hint: "빛에 비추면 사진이 보여요" },
                      ]}
                    />
                    {reliefStyle === "litho" && (
                      <p className="rounded-xl bg-sky-50 px-3 py-2 text-xs text-sky-700">
                        💡 <b>하얀색</b>으로 뽑아서 창문이나 손전등에 비춰 보세요. 그냥 보면 울퉁불퉁하지만 빛에 비추면 사진이 나타나요!
                      </p>
                    )}
                  </Section>

                  <Section title="또렷하게" emoji="🔆">
                    <div className="rounded-2xl bg-white px-4 py-2 ring-2 ring-pink-100">
                      <div className="flex justify-between text-sm text-slate-500">
                        <span>부드럽게</span>
                        <span>또렷하게</span>
                      </div>
                      <input
                        type="range"
                        className="kid-range"
                        min={0.6}
                        max={1.8}
                        step={0.05}
                        value={reliefContrast}
                        onChange={(e) => setReliefContrast(Number(e.target.value))}
                        aria-label="또렷하게"
                      />
                    </div>
                  </Section>

                  <Section title="크기" emoji="📏">
                    <SizeSlider value={size} onChange={setSize} />
                  </Section>

                  <Section title="색깔 (필라멘트)" emoji="🎨">
                    <ColorPalette value={color} onChange={setColor} />
                  </Section>
                </>
              )}

              {image && source === "paper" && (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <figure className="overflow-hidden rounded-2xl ring-2 ring-slate-100">
                      {photoUrl && <img src={photoUrl} alt="찍은 그림" className="aspect-square w-full object-contain bg-slate-50" />}
                      <figcaption className="bg-slate-50 py-1 text-center text-xs text-slate-500">찍은 사진</figcaption>
                    </figure>
                    <figure className="overflow-hidden rounded-2xl ring-2 ring-slate-100">
                      {inkPreview && <img src={inkPreview} alt="찾은 선" className="aspect-square w-full object-contain bg-white" />}
                      <figcaption className="bg-slate-50 py-1 text-center text-xs text-slate-500">컴퓨터가 찾은 선</figcaption>
                    </figure>
                  </div>

                  <Section title="선 찾기" emoji="🔍">
                    <div className="rounded-2xl bg-white px-4 py-2 ring-2 ring-pink-100">
                      <div className="flex justify-between text-sm text-slate-500">
                        <span>진한 선만</span>
                        <span>연한 선까지</span>
                      </div>
                      <input
                        type="range"
                        className="kid-range"
                        min={0.5}
                        max={0.95}
                        step={0.01}
                        value={threshold}
                        onChange={(e) => setThreshold(Number(e.target.value))}
                        aria-label="선 찾기 민감도"
                      />
                    </div>
                  </Section>

                  <Section title="만드는 방법" emoji="🛠️">
                    <Toggle
                      value={style}
                      onChange={setStyle}
                      options={[
                        { value: "filled", label: "속 채우기", emoji: "🍪", hint: "튼튼한 판 위에 그림" },
                        { value: "lines", label: "선만 살리기", emoji: "〰️", hint: "그린 선 모양 그대로" },
                      ]}
                    />
                  </Section>

                  <Section title="크기" emoji="📏">
                    <SizeSlider value={size} onChange={setSize} />
                  </Section>

                  <Section title="색깔 (필라멘트)" emoji="🎨">
                    <ColorPalette value={color} onChange={setColor} />
                  </Section>
                </>
              )}
            </>
          )}
        </div>

        {/* 하단 고정 제출 버튼 */}
        <div className="sticky bottom-0 z-30 border-t border-slate-100 bg-white/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
          {submitError && <p className="mb-2 text-center text-sm font-bold text-red-500">{submitError}</p>}
          {tab === "pad" && padStep < 3 && (stepHint || stepBlock((padStep + 1) as 2 | 3)) && (
            <p className={`mb-2 rounded-xl px-3 py-1.5 text-center text-sm font-bold ${stepHint ? "bg-orange-100 text-orange-700" : "text-slate-500"}`}>
              {stepHint || stepBlock((padStep + 1) as 2 | 3)}
            </p>
          )}
          {tab === "pad" && padStep < 3 ? (
            <div className="flex gap-2">
              {padStep > 1 && (
                <button
                  onClick={() => goStep((padStep - 1) as 1 | 2)}
                  className="h-16 shrink-0 rounded-full bg-slate-100 px-5 font-display text-lg text-slate-600 active:scale-95"
                >
                  이전
                </button>
              )}
              <button
                onClick={() => goStep(padStep === 1 ? 2 : 3)}
                disabled={!!stepBlock((padStep + 1) as 2 | 3)}
                className="flex h-16 flex-1 items-center justify-center gap-2 rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 font-display text-2xl text-white shadow-lg shadow-violet-200 transition active:scale-95 disabled:from-slate-300 disabled:to-slate-300 disabled:shadow-none"
              >
                다음: {padStep === 1 ? "꾸미기" : "완성하기"} <ArrowRight className="size-6" />
              </button>
            </div>
          ) : (
          <button
            disabled={!parts || broken || submitting}
            onClick={() => setConfirming(true)}
            className="flex h-16 w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-emerald-400 to-teal-500 font-display text-2xl text-white shadow-lg shadow-emerald-200 transition active:scale-95 disabled:from-slate-300 disabled:to-slate-300 disabled:shadow-none"
          >
            <Send className="size-6" /> 선생님께 제출하기
          </button>
          )}
        </div>
      </div>

      {leaving && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4" onClick={() => setLeaving(false)}>
          <div className="pop-in w-full max-w-md rounded-[2rem] bg-white p-6 text-center" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 text-5xl">🥺</div>
            <p className="font-display text-2xl text-slate-800">처음 화면으로 갈까요?</p>
            <p className="mt-1 text-slate-500">지금 만들던 작품은 사라져요.</p>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button onClick={() => setLeaving(false)} className="min-h-14 rounded-full bg-violet-500 font-display text-xl text-white">
                계속 만들기
              </button>
              <button onClick={() => router.push("/")} className="min-h-14 rounded-full bg-slate-100 font-display text-xl text-slate-600">
                처음으로
              </button>
            </div>
          </div>
        </div>
      )}

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4" onClick={() => !submitting && setConfirming(false)}>
          <div className="pop-in w-full max-w-md rounded-[2rem] bg-white p-6 text-center" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 text-5xl">📮</div>
            <p className="font-display text-2xl text-slate-800">선생님께 보낼까요?</p>
            <p className="mt-1 text-slate-500">
              {FILAMENT_COLORS[color].label}색 · {size}mm {MODE_LABEL[submitMode]}
            </p>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                disabled={submitting}
                onClick={() => setConfirming(false)}
                className="min-h-14 rounded-full bg-slate-100 font-display text-xl text-slate-600"
              >
                더 꾸밀래요
              </button>
              <button
                disabled={submitting}
                onClick={submit}
                className="flex min-h-14 items-center justify-center gap-2 rounded-full bg-emerald-500 font-display text-xl text-white"
              >
                {submitting && <Loader2 className="size-5 animate-spin" />}
                보낼래요!
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
