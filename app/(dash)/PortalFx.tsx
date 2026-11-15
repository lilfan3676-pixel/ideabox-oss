"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/** Portal 主題專用：送出表單、動作完成時跳出漫畫擬聲字。其他主題下什麼都不做。 */

const WORDS = ["POW!", "ZAP!", "BOOM!", "BAM!", "YES!"];
const FAIL = /失敗|無法|錯誤|fail|error|couldn’t|could not/i;
const isPortal = () => document.documentElement.dataset.theme === "portal";

type Fx = { id: number; word: string; x: number; y: number; oops: boolean };

function place(el: Element | null) {
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (!el || !el.isConnected) return { x: w / 2, y: h / 3 };
  const r = el.getBoundingClientRect();
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
  return { x: clamp(r.left + r.width / 2, 90, w - 90), y: clamp(r.top - 12, 70, h - 70) };
}

export function PortalFx() {
  const [items, setItems] = useState<Fx[]>([]);
  const lastSubmit = useRef(0); // 最近一次送出表單的時間
  const lastMsgFx = useRef(0); // 最近一次因為頁面訊息跳字的時間
  const seq = useRef(0);
  const msg = useSearchParams().get("msg");

  const pop = (word: string, at: { x: number; y: number }, oops = false) => {
    const id = ++seq.current;
    setItems((cur) => [...cur.slice(-2), { id, word, oops, ...at }]);
    window.setTimeout(() => setItems((cur) => cur.filter((f) => f.id !== id)), 1200);
  };
  const randomWord = () => WORDS[Math.floor(Math.random() * WORDS.length)];

  // 動作完成後網址帶 ?msg=… 的頁面（補助更新、監控檢查、設定儲存…）：依訊息判斷成功或失敗
  useEffect(() => {
    if (!msg || !isPortal()) return;
    if (Date.now() - lastSubmit.current > 120_000) return; // 重新整理頁面時不重播
    lastMsgFx.current = Date.now();
    const oops = FAIL.test(msg);
    pop(oops ? "OOPS!" : randomWord(), place(document.querySelector(".notice")), oops);
  }, [msg]);

  // 其他表單：送出按鈕「處理中」結束（或表單消失）時跳字
  useEffect(() => {
    const onSubmit = (e: Event) => {
      if (!isPortal()) return;
      const form = e.target as HTMLFormElement;
      const btn = ((e as SubmitEvent).submitter as HTMLButtonElement | null) ?? form.querySelector("button[type=submit]");
      lastSubmit.current = Date.now();
      let anchor = place(btn ?? form);
      const started = Date.now();
      let sawBusy = false;
      const finish = () => {
        window.setTimeout(() => {
          if (Date.now() - lastMsgFx.current < 2000) return; // 已經由 ?msg= 那邊跳過了
          pop(randomWord(), anchor);
        }, 150);
      };
      const tick = () => {
        const alive = !!btn && btn.isConnected && form.isConnected;
        if (alive) anchor = place(btn);
        const busy = alive && btn!.disabled;
        if (busy) sawBusy = true;
        const elapsed = Date.now() - started;
        if (elapsed > 120_000) return; // 等太久就放棄
        if (!alive || (sawBusy && !busy) || (!sawBusy && elapsed > 500)) return finish();
        window.setTimeout(tick, 200);
      };
      window.setTimeout(tick, 100);
    };
    document.addEventListener("submit", onSubmit);
    return () => document.removeEventListener("submit", onSubmit);
  }, []);

  if (!items.length) return null;
  return (
    <>
      {items.map((f) => (
        <span key={f.id} className={`pt-sfx ${f.oops ? "oops" : ""}`} style={{ left: f.x, top: f.y }} aria-hidden="true">
          {f.word}
        </span>
      ))}
    </>
  );
}
