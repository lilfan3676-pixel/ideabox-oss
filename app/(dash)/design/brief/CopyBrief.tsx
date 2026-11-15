"use client";

import { useState } from "react";
import { useL } from "../../../LangProvider";

export function CopyBrief({ text, filename }: { text: string; filename: string }) {
  const [copied, setCopied] = useState(false);
  const L = useL();

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // 舊瀏覽器退回選取文字的方式
      const ta = document.querySelector<HTMLTextAreaElement>(".brief-text");
      ta?.select();
      document.execCommand("copy");
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const href = `data:text/markdown;charset=utf-8,${encodeURIComponent(text)}`;

  return (
    <div className="brief-actions">
      <button type="button" className="btn primary" onClick={copy}>
        {copied ? L("✓ 已複製", "✓ Copied") : L("複製簡報", "Copy brief")}
      </button>
      <a className="btn" href={href} download={filename}>
        {L("下載 .md", "Download .md")}
      </a>
    </div>
  );
}
