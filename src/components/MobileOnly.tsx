"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { GraduationCap, Smartphone } from "lucide-react";

const PREVIEW_KEY = "cc-maker:pc-preview";

/** 휴대폰·태블릿인지 (iPadOS는 Mac처럼 보이므로 터치 점 수로 구분) */
function isMobileDevice() {
  const ua = navigator.userAgent;
  const uaData = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData;
  const uaMobile = uaData?.mobile === true || /Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i.test(ua);
  const iPadOS = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  const touchFirst = window.matchMedia("(pointer: coarse)").matches && navigator.maxTouchPoints > 0;
  return uaMobile || iPadOS || touchFirst;
}

/**
 * 학생 화면은 휴대폰·태블릿에서만.
 * 선생님이 PC에서 미리 볼 때는 주소에 ?pc=1 을 붙이면 (이 탭에서는) 열립니다.
 */
export default function MobileOnly({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<"checking" | "ok" | "blocked">("checking");
  const [url, setUrl] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    let preview = false;
    try {
      if (params.get("pc") === "1") sessionStorage.setItem(PREVIEW_KEY, "1");
      preview = sessionStorage.getItem(PREVIEW_KEY) === "1";
    } catch {}
    params.delete("pc");
    const q = params.toString();
    setUrl(`${location.origin}${location.pathname}${q ? `?${q}` : ""}`);
    setState(preview || isMobileDevice() ? "ok" : "blocked");
  }, []);

  if (state === "checking") return <div className="min-h-dvh bg-amber-50" />;
  if (state === "ok") return <>{children}</>;

  return (
    <main className="grid min-h-dvh place-items-center bg-amber-50 p-6">
      <div className="w-full max-w-lg rounded-[2rem] bg-white p-8 text-center shadow-xl ring-4 ring-amber-100">
        <Smartphone className="mx-auto size-14 text-pink-500" />
        <h1 className="mt-3 font-display text-3xl text-slate-800">휴대폰이나 태블릿으로 들어와 주세요</h1>
        <p className="mt-2 text-lg text-slate-600">
          춘천 꼬마 3D 메이커 학생 화면은 손가락으로 그리는 기기에서만 열려요.
          <br />
          카메라로 아래 QR을 찍으면 바로 이어서 할 수 있어요!
        </p>
        {url && (
          <div className="mx-auto mt-6 w-fit rounded-2xl bg-white p-3 ring-2 ring-slate-100">
            <QRCodeSVG value={url} size={220} marginSize={1} />
          </div>
        )}
        <p className="mt-3 break-all font-mono text-xs text-slate-400">{url}</p>
        <Link
          href="/teacher"
          className="mt-6 inline-flex min-h-12 items-center gap-1.5 rounded-full px-5 font-semibold text-slate-500 hover:bg-slate-50"
        >
          <GraduationCap className="size-5" /> 선생님 페이지로 이동
        </Link>
      </div>
    </main>
  );
}
