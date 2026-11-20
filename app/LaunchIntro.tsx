"use client";

import { useEffect, useRef, useState } from "react";

type Intro = { destroy: () => void; finish: () => void };
declare global {
  interface Window {
    IdeaboxLaunch?: new (canvas: HTMLCanvasElement, opts: { duration?: number; onComplete?: () => void }) => Intro;
  }
}

const SRC = "/brand/ideabox-launch.js";

/**
 * 開場動畫：黑底白粒子撞進中心、收成 ib 標誌（public/brand/ideabox-launch.js，Canvas 畫的，不連網）。
 * 只在手機版（寬度 720px 以下）播，電腦版不播（使用者 2026-11-20 改的；電腦版用 CSS 直接藏掉黑幕）。
 * 每次打開網站（整頁載入）播一次；在站內換頁不會再播。點一下或按任意鍵跳過。
 * 伺服器送出的 HTML 就帶著這層黑幕，所以不會先閃一下頁面內容；
 * 萬一 JavaScript 沒跑起來，globals.css 的 launch-failsafe 會在 9 秒後自己把黑幕收掉，不會整頁卡在黑畫面。
 * 系統開了「減少動態效果」時，動畫程式會直接顯示標誌，這裡停一下就收掉。
 */
export function LaunchIntro() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<"play" | "fade" | "gone">("play");

  const skip = useRef<() => void>(() => setPhase("gone"));

  useEffect(() => {
    if (!window.matchMedia("(max-width: 720px)").matches) {
      setPhase("gone");
      return;
    }
    let intro: Intro | null = null;
    let done = false; // 只收一次：跳過之後，動畫播完或保底計時器到了都不再動畫面
    const timers: ReturnType<typeof setTimeout>[] = [];
    const stop = () => {
      timers.forEach(clearTimeout);
      intro?.destroy();
      intro = null;
    };
    const close = (hold = 0) => {
      if (done) return;
      done = true;
      timers.forEach(clearTimeout);
      timers.push(
        setTimeout(() => setPhase("fade"), hold),
        setTimeout(() => {
          setPhase("gone");
          stop();
        }, hold + 380),
      );
    };
    skip.current = () => {
      done = true;
      stop();
      setPhase("gone");
    };
    const start = () => {
      if (done || !canvas.current || !window.IdeaboxLaunch) return close();
      try {
        intro = new window.IdeaboxLaunch(canvas.current, { duration: 4400, onComplete: () => close(450) });
      } catch {
        close();
      }
    };
    if (window.IdeaboxLaunch) start();
    else {
      const s = document.createElement("script");
      s.src = SRC;
      s.async = true;
      s.onload = start;
      s.onerror = () => close();
      document.head.appendChild(s);
    }
    // 動畫程式萬一沒跑起來，最多 8 秒就放行
    timers.push(setTimeout(() => close(), 8000));
    const onKey = () => skip.current();
    window.addEventListener("keydown", onKey, { once: true });
    return () => {
      done = true;
      window.removeEventListener("keydown", onKey);
      stop();
    };
  }, []);

  if (phase === "gone") return null;
  return (
    <div className={`launch-intro${phase === "fade" ? " out" : ""}`} onClick={() => skip.current()} role="presentation">
      <canvas ref={canvas} aria-label="ideabox 開場動畫" />
    </div>
  );
}
