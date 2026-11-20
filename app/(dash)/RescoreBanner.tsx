"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useL } from "../LangProvider";
import type { RescoreStatus } from "@/lib/rescore";
import { rescoreStatusAction, startRescore } from "./rescoreActions";

/**
 * 點子庫最上面的提示：還有舊算法評的點子時，按一下用新評分重評（只評還沒採用的）。
 * 一批大約 80 秒，這裡每 6 秒看一次進度，上一批跑完就叫下一批；關掉網頁的話每晚排程會接著跑。
 */
export function RescoreBanner({ ready, pending }: { ready: boolean; pending: number }) {
  const L = useL();
  const router = useRouter();
  const [st, setSt] = useState<RescoreStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const wasOn = useRef(false);

  // 一進來先問一次：是不是已經在跑了（例如重新整理頁面）
  useEffect(() => {
    if (!ready || !pending) return;
    rescoreStatusAction().then(setSt).catch(() => null);
  }, [ready, pending]);

  const on = !!st?.on;
  useEffect(() => {
    if (!on) return;
    wasOn.current = true;
    const id = setInterval(async () => {
      try {
        let s = await rescoreStatusAction();
        if (s.on && !s.running && s.pending > 0) s = await startRescore();
        setSt(s);
      } catch {
        // 網路斷一下沒關係，下一輪再問
      }
    }, 6000);
    return () => clearInterval(id);
  }, [on]);

  // 跑完了：重新讀一次清單，讓新分數出現
  useEffect(() => {
    if (wasOn.current && st && !st.on) {
      wasOn.current = false;
      router.refresh();
    }
  }, [st, router]);

  if (!ready) {
    return (
      <p className="rescore-note muted small">
        {L(
          "評分已改成「每個專案各一分＋依類型換評分面向」。要記下各專案的分數、並重評舊點子，請先執行 migration-033-scoring.sql。",
          "Scoring now rates each project separately. Run migration-033-scoring.sql to store per-project scores and re-score older ideas.",
        )}
      </p>
    );
  }
  const left = st?.pending ?? pending;
  if (!left && !on) return null;
  return (
    <div className="rescore-note" role="status">
      {on ? (
        <span>
          {L(`正在用新評分重評：已完成 ${st?.done ?? 0} 則，還剩 ${left} 則。`, `Re-scoring: ${st?.done ?? 0} done, ${left} left.`)}
          <span className="muted small"> {L("可以離開這頁，每晚排程會接著跑。", "You can leave this page; the nightly job continues.")}</span>
        </span>
      ) : (
        <>
          <span>
            {L(`有 ${left} 則還沒採用的點子是用舊算法評的。`, `${left} unadopted ideas still use the old scoring.`)}
            {!!st?.failed && <span className="muted small"> {L(`上次有 ${st.failed} 則沒評成功，可以再按一次。`, `${st.failed} failed last time; try again.`)}</span>}
          </span>
          <button
            type="button"
            className="btn small"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                setSt(await startRescore());
              } finally {
                setBusy(false);
              }
            }}
          >
            {L("用新評分重評", "Re-score with the new logic")}
          </button>
        </>
      )}
    </div>
  );
}
