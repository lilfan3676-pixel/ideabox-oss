"use client";

import Link from "next/link";
import { useL } from "../LangProvider";

// 頁面或按鈕執行時出錯：不要整頁變成白底錯誤畫面，給「再試一次」和回首頁
export default function DashError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const L = useL();
  return (
    <section className="glass panel" role="alert">
      <h2>{L("這頁出了點問題", "Something went wrong on this page")}</h2>
      <p className="muted">{L("可能是網路或外部服務暫時不穩，資料沒有遺失。可以再試一次。", "Probably a temporary network or service hiccup — your data is safe. Try again.")}</p>
      {error.digest && <p className="muted small">{L("錯誤代碼：", "Error code: ")}{error.digest}</p>}
      <div className="title-actions" style={{ justifyContent: "flex-start" }}>
        <button type="button" className="btn primary" onClick={reset}>{L("再試一次", "Try again")}</button>
        <Link href="/" className="btn">{L("回點子庫", "Back to ideas")}</Link>
      </div>
    </section>
  );
}
