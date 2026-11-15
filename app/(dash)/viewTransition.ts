// 外觀切換的過場動畫（View Transitions API）。不支援的瀏覽器或開啟「減少動態效果」時直接切換。

type VT = { ready: Promise<void>; finished: Promise<void> };
type DocWithVT = Document & { startViewTransition?: (cb: () => void) => VT };

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * kind="mode"：新畫面從 origin（按下的按鈕）以圓形擴散覆蓋。
 * kind="theme"：整頁交叉淡入，新主題以一道柔和色帶由左往右流過。
 */
export function withViewTransition(kind: "mode" | "theme", update: () => void, origin?: Element | null) {
  const doc = document as DocWithVT;
  // 手機（簡易版）不做整頁過場：iPhone 上截整頁畫面很吃記憶體，容易讓 Safari 重新載入
  const mobile = window.matchMedia("(max-width: 720px)").matches;
  if (!doc.startViewTransition || prefersReducedMotion() || mobile) {
    update();
    return;
  }
  const root = document.documentElement;
  root.dataset.vt = kind;
  let t: VT;
  try {
    t = doc.startViewTransition(update);
  } catch {
    delete root.dataset.vt;
    update();
    return;
  }
  if (kind === "mode") {
    const r = origin?.getBoundingClientRect();
    const x = r ? r.left + r.width / 2 : window.innerWidth / 2;
    const y = r ? r.top + r.height / 2 : window.innerHeight / 2;
    const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    t.ready
      .then(() => {
        root.animate(
          { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
          { duration: 560, easing: "cubic-bezier(.45,0,.2,1)", pseudoElement: "::view-transition-new(root)" },
        );
      })
      .catch(() => {});
  }
  t.finished.finally(() => delete root.dataset.vt).catch(() => {});
}
