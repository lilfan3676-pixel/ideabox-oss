"use client";

import { createContext, useContext } from "react";
import type { Idea } from "@/lib/db";
import { useL } from "../LangProvider";
import { deleteIdea, dismissDup } from "./actions";
import { ConfirmButton, SubmitButton } from "./ConfirmButton";

// 點子 id → 標題（點子庫提供，用來寫「可能跟『…』重複」）
export const DupTitles = createContext<Map<string, string>>(new Map());

/** AI 判斷可能跟之前某一則重複時，卡片上的提醒：刪掉這張或標記不是重複 */
export function DupNotice({ idea: i }: { idea: Idea }) {
  const titles = useContext(DupTitles);
  const L = useL();
  if (!i.dup_of) return null;
  const t = titles.get(i.dup_of);
  const short = t && t.length > 28 ? `${t.slice(0, 28)}…` : t;
  return (
    <div className="dup-notice" role="note">
      <span>{short ? L(`可能跟「${short}」重複`, `May duplicate “${short}”`) : L("可能跟另一則點子重複", "May duplicate another idea")}</span>
      <form action={deleteIdea}>
        <input type="hidden" name="id" value={i.id} />
        <ConfirmButton label={L("刪除這張", "Delete this one")} message={L("確定刪除這則重複的點子？", "Delete this duplicate idea?")} className="btn ghost small" />
      </form>
      <form action={dismissDup}>
        <input type="hidden" name="id" value={i.id} />
        <SubmitButton label={L("不是重複", "Not a duplicate")} pending={L("處理中…", "Saving…")} className="btn ghost small" />
      </form>
    </div>
  );
}
