"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { pageIndex } from "./Nav";

// 記住上一頁在膠囊裡的位置（跨換頁保留）
let lastIndex: number | null = null;

/** 換頁進場動畫：往右邊的分頁就從右側滑入、往左就從左側；同一個分頁內（例如個股頁）淡入上浮 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const idx = pageIndex(pathname);
  const [dir] = useState(() => (lastIndex == null || idx < 0 || lastIndex < 0 ? 0 : Math.sign(idx - lastIndex)));
  useEffect(() => {
    lastIndex = idx;
  }, [idx]);
  return <div className={`page-enter ${dir > 0 ? "from-right" : dir < 0 ? "from-left" : ""}`}>{children}</div>;
}
