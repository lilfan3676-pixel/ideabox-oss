"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { addIdea, moveIdeas, type AddIdeaState, type SavedItem } from "./actions";
import { SubmitButton } from "./ConfirmButton";
import { useL, useLang } from "../LangProvider";
import { catLabel } from "@/lib/labels";
import type { Folder } from "@/lib/folderLogic";
import type { Lang, Translate } from "@/lib/i18n";

function line(i: SavedItem, L: Translate, lang: Lang, folders: Folder[]) {
  const where = L("點子庫", "Ideas");
  // 有資料夾就顯示資料夾名稱（還沒執行 migration-010 時顯示分類）
  const cat = folders.find((f) => f.id === i.folderId)?.name ?? (folders.length ? L("未分類", "Unfiled") : catLabel(i.category, lang));
  if (i.duplicate) return L(`之前存過了，在${where}【${cat}】`, `Already saved — in ${where} (${cat})`);
  if (i.status === "needs_input")
    return L(`已存到${where}，但讀不到內容，請到「待補充」補一句重點`, `Saved to ${where}, but the content couldn’t be read — add a note under “Needs input”`);
  if (i.status === "failed") return L(`已存到${where}，AI 分析暫時失敗，今晚會自動重試`, `Saved to ${where}. AI analysis failed for now — it will retry tonight`);
  return L(`已存到${where}【${cat}】`, `Saved to ${where} (${cat})`);
}

/** 點子庫的新增表單：存好後跳出通知，告訴你 AI 放進哪個資料夾，可以當場改 */
export function AddIdeaForm({
  placeholder,
  folders = [],
  projects = [],
  compact = false,
}: {
  placeholder: string;
  folders?: Folder[];
  projects?: { id: string; name: string }[]; // 存的時候指定專案，AI 就針對那個專案評分
  compact?: boolean;
}) {
  const [state, run, isPending] = useActionState<AddIdeaState, FormData>(addIdea, null);
  // React 送出後會清空表單；沒存成功時把剛剛貼的內容放回去，不用重貼
  const lastInput = useRef("");
  const action = (fd: FormData) => {
    lastInput.current = String(fd.get("input") ?? "");
    run(fd);
  };
  const [toast, setToast] = useState<AddIdeaState>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const L = useL();
  const lang = useLang();

  useEffect(() => {
    if (!state) return;
    setToast(state);
    if (state.items.length && !state.error) formRef.current?.reset();
    else {
      const box = formRef.current?.elements.namedItem("input");
      if (box instanceof HTMLTextAreaElement && !box.value) box.value = lastInput.current;
    }
    const t = setTimeout(() => setToast(null), 12000);
    return () => clearTimeout(t);
  }, [state]);

  /** 通知裡改資料夾：更新通知內容，點子庫會自動重新整理 */
  const refile = async (item: SavedItem, folderId: string) => {
    const r = await moveIdeas([item.id], folderId).catch(() => ({ ok: false }));
    if (!r.ok) return;
    setToast((t) => (t ? { ...t, items: t.items.map((x) => (x.id === item.id ? { ...x, folderId: folderId || null } : x)) } : t));
  };

  const ok = toast && !toast.error && toast.items.length > 0;
  const first = toast?.items[0];
  // 有存下來但需要你處理（讀不到內容／分析失敗）時用黃色
  const warn = ok && toast.items.some((i) => i.status === "needs_input" || i.status === "failed");

  return (
    <>
      <form ref={formRef} action={action} className={`glass add-form ${compact ? "compact" : ""}`}>
        <textarea
          name="input"
          rows={compact ? 1 : 2}
          placeholder={placeholder}
          required
          enterKeyHint="send"
          aria-describedby="add-idea-hint"
          onKeyDown={(e) => {
            // Enter 直接存入；Shift+Enter 換行；中文輸入法選字時按 Enter 不送出
            if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing || e.keyCode === 229) return;
            e.preventDefault();
            if (!isPending && e.currentTarget.value.trim()) e.currentTarget.form?.requestSubmit();
          }}
        />
        {projects.length > 0 && (
          <select name="project" className="project-pick" aria-label={L("這則是哪個專案的點子", "Which project is this for")} defaultValue="">
            <option value="">{L("不指定專案", "No project")}</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        <span id="add-idea-hint" className="sr-only">{L("按 Enter 存入並分析，Shift + Enter 換行", "Press Enter to save and analyze, Shift + Enter for a new line")}</span>
        <SubmitButton label={L("存入並分析", "Save & analyze")} pending={L("分析中…", "Analyzing…")} className="btn primary" />
      </form>

      {/* 放到 body 底下：頁面進場動畫的 transform 會讓 fixed 定位跑掉 */}
      {toast && typeof document !== "undefined" && createPortal(
        <div className={`toast glass ${warn ? "warn" : ok ? "ok" : "bad"}`} role="status" aria-live="polite">
          <span className="toast-icon" aria-hidden>{ok ? "✓" : "!"}</span>
          <div className="toast-body">
            {toast.error ? (
              <b>{toast.error}</b>
            ) : !toast.items.length ? (
              <b>{L("沒有存成功，請確認連結是否正確", "Nothing was saved — check that the link is correct")}</b>
            ) : (
              <>
                <b>{toast.items.length > 1 ? L(`已存 ${toast.items.length} 則`, `Saved ${toast.items.length} items`) : line(first!, L, lang, folders)}</b>
                {toast.items.length > 1 ? (
                  <ul>
                    {toast.items.slice(0, 4).map((i) => <li key={i.id}>{line(i, L, lang, folders)}</li>)}
                  </ul>
                ) : (
                  <>
                    {first!.summary && <span className="muted small">{first!.summary}</span>}
                    {folders.length > 0 && (
                      <label className="toast-folder small">
                        {L("放錯了？改放到", "Wrong folder? Move to")}
                        <select value={first!.folderId ?? ""} onChange={(e) => refile(first!, e.target.value)}>
                          <option value="">{L("未分類", "Unfiled")}</option>
                          {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                        </select>
                      </label>
                    )}
                  </>
                )}
                {toast.failed > 0 && <span className="small error">{L(`另有 ${toast.failed} 個連結沒存成功`, `${toast.failed} more link(s) couldn’t be saved`)}</span>}
              </>
            )}
          </div>
          {first && !toast.error && (
            <Link className="btn small" href={first.status === "needs_input" ? "/?view=todo" : first.folderId ? `/?folder=${first.folderId}` : "/"} onClick={() => setToast(null)}>
              {L("查看", "View")}
            </Link>
          )}
          <button type="button" className="toast-close" aria-label={L("關閉通知", "Dismiss")} onClick={() => setToast(null)}>×</button>
        </div>,
        document.body,
      )}
    </>
  );
}
