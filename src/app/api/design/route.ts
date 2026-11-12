import { GoogleGenAI } from "@google/genai";
import { findRoom, isAdminConfigured } from "@/lib/supabase/admin";

/**
 * 단어 → Google 이미지 AI가 그린 '굵은 선의 색칠공부 그림'(JPEG).
 * 클라이언트가 이 그림을 검은 선만 남긴 레이어로 바꿔 그림판에 올립니다.
 *
 * 필요한 설정 (서버 환경 변수):
 *   GEMINI_API_KEY        Google AI Studio에서 발급한 API 키
 *   GEMINI_IMAGE_MODEL    (선택) 기본 gemini-nano-banana-2.1.
 *                         더 빠르게: gemini-3.1-flash-lite-image (가격은 같음)
 * 외부로 나가는 정보는 학생이 쓴 '단어'뿐입니다.
 */
export const runtime = "nodejs";

const MODEL = process.env.GEMINI_IMAGE_MODEL ?? "gemini-nano-banana-2.1";

const prompt = (word: string) =>
  `A cute, simple coloring-book line drawing for young children of: "${word}".
Style: thick, bold, uniform black outlines on a plain pure-white background, like a sticker outline.
Exactly one subject, centered, the whole subject fully visible with margin around it, drawn as one connected shape.
Friendly cartoon look with a few simple inner details (eyes, mouth, simple patterns).
No color, no gray, no shading, no fills, no text, no letters, no frame, no background scenery.
If the request is not appropriate for young children, draw a smiling star instead.`;

const cache = new Map<string, string>(); // 단어 → data URL (같은 단어는 다시 돈 내지 않도록)
const CACHE_MAX = 120;
const hits = new Map<string, number[]>();
const LIMIT_PER_MIN = 6;

function rateLimited(ip: string) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > LIMIT_PER_MIN;
}

let ai: GoogleGenAI | null = null;

export async function POST(req: Request) {
  let word = "";
  let roomCode = "";
  try {
    const body = await req.json();
    word = String(body?.word ?? "").trim();
    roomCode = String(body?.roomCode ?? "");
  } catch {}
  if (!word || word.length > 20) return Response.json({ error: "bad_word" }, { status: 400 });
  // 배포 환경: 실제 수업방에 들어온 학생만 (외부에서 마구 요청해 비용이 나가는 것 방지)
  if (isAdminConfigured() && !(await findRoom(roomCode))) {
    return Response.json({ error: "room_not_found" }, { status: 403 });
  }

  const key = word.toLowerCase().replace(/\s+/g, "");
  const cached = cache.get(key);
  if (cached) return Response.json({ title: word, image: cached });

  if (!process.env.GEMINI_API_KEY && !process.env.GOOGLE_API_KEY) {
    return Response.json({ error: "ai_not_configured" }, { status: 503 });
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (rateLimited(ip)) return Response.json({ error: "rate_limited" }, { status: 429 });

  try {
    ai ??= new GoogleGenAI({});
    const interaction = await ai.interactions.create({
      model: MODEL,
      input: prompt(word),
      response_format: { type: "image", mime_type: "image/jpeg", aspect_ratio: "1:1", image_size: "1K" }, // 이미지 모델은 JPEG만 지원
    });
    const img = interaction.output_image;
    // 안전 필터에 걸리면 그림 없이 돌아옵니다
    if (!img?.data) return Response.json({ error: "not_allowed" }, { status: 422 });

    const dataUrl = `data:${img.mime_type ?? "image/jpeg"};base64,${img.data}`;
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
    cache.set(key, dataUrl);
    return Response.json({ title: word, image: dataUrl });
  } catch (e) {
    const status = (e as { status?: number }).status;
    console.error("image design error", status, e instanceof Error ? e.message : e);
    if (status === 401 || status === 403) return Response.json({ error: "ai_not_configured" }, { status: 503 });
    // 선불 크레딧이 다 떨어지면 402 → 학생에게는 '아직 안 켜짐'으로 안내
    if (status === 402) return Response.json({ error: "ai_not_configured", reason: "out_of_credit" }, { status: 503 });
    // 무료 등급(한도 0)이면 결제 등록이 안 된 것 → 학생에게는 '아직 안 켜짐'으로 안내
    if (status === 429 && e instanceof Error && /free tier|limit: 0/i.test(e.message)) {
      return Response.json({ error: "ai_not_configured", reason: "billing_required" }, { status: 503 });
    }
    if (status === 429) return Response.json({ error: "rate_limited" }, { status: 429 });
    // 400은 대부분 요청 형식 문제라 '부적절한 단어'로 숨기지 않고 오류로 알림 (서버 로그에 원인 기록)
    return Response.json({ error: "ai_error" }, { status: 502 });
  }
}
