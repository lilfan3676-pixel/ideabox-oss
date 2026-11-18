"use client";

import { useEffect, useState, useTransition } from "react";
import { useL } from "@/app/LangProvider";
import { createAppPairing, type PairResult } from "./appActions";

/** 按了才產生配對碼；10 分鐘後自動失效 */
export function AppPairing({ memberId, label }: { memberId?: string; label?: string } = {}) {
  const L = useL();
  const [pair, setPair] = useState<PairResult | null>(null);
  const [left, setLeft] = useState(0);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!pair?.ok) return;
    const tick = () => setLeft(Math.max(0, Math.round((pair.expiresAt - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [pair]);

  const expired = pair?.ok && left <= 0;
  const code = pair?.ok ? `${pair.code.slice(0, 4)}-${pair.code.slice(4)}` : "";

  return (
    <div className="app-pair">
      {pair?.ok && !expired ? (
        <>
          <div className="app-pair-qr" dangerouslySetInnerHTML={{ __html: pair.svg }} aria-label={L("配對用 QR code", "Pairing QR code")} role="img" />
          <div className="app-pair-info">
            <p>{L("用 ideabox App 的「掃描配對」掃這個 QR code。", "Scan this with “Scan to pair” in the ideabox app.")}</p>
            <p className="muted small">{L("沒辦法掃的話，在 App 裡選「手動輸入」：", "Can't scan? Choose “Enter manually” in the app:")}</p>
            <ul className="status-list">
              <li><span>{L("網址", "Server")}</span><b className="mono">{pair.server}</b></li>
              <li><span>{L("配對碼", "Code")}</span><b className="mono app-pair-code">{code}</b></li>
            </ul>
            <p className="muted small">{L(`${Math.floor(left / 60)} 分 ${left % 60} 秒後失效，用過一次就不能再用`, `Expires in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}; single use`)}</p>
          </div>
        </>
      ) : (
        <div>
          {expired && <p className="muted small">{L("配對碼已經失效，請重新產生。", "The code expired. Generate a new one.")}</p>}
          {pair && !pair.ok && <p className="error small">{L("產生失敗：", "Failed: ")}{pair.error}{L("（請先執行 migration-022-app.sql）", " (run migration-022-app.sql first)")}</p>}
          <button type="button" className="btn primary" disabled={pending} onClick={() => start(async () => setPair(await createAppPairing(memberId).catch((e) => ({ ok: false, error: String(e) }) as PairResult)))}>
            {pending ? L("產生中…", "Generating…") : label ?? L("連結一支手機", "Pair a phone")}
          </button>
        </div>
      )}
    </div>
  );
}
