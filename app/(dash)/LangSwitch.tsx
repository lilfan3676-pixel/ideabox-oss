"use client";

import { useTransition } from "react";
import { useLang } from "../LangProvider";
import { setLang } from "./actions";

/** 中文／English 切換（設定頁與頭像選單） */
export function LangSwitch({ compact = false }: { compact?: boolean }) {
  const lang = useLang();
  const [pending, start] = useTransition();
  const pick = (l: "zh" | "en") => {
    if (l === lang || pending) return;
    start(() => setLang(l));
  };
  return (
    <div className={`theme-switch inline lang-switch ${compact ? "compact" : ""}`} role="radiogroup" aria-label="Language／語言" aria-busy={pending}>
      <button type="button" role="radio" aria-checked={lang === "zh"} className={lang === "zh" ? "active" : ""} onClick={() => pick("zh")}>
        中文
      </button>
      <button type="button" role="radio" aria-checked={lang === "en"} className={lang === "en" ? "active" : ""} onClick={() => pick("en")}>
        English
      </button>
    </div>
  );
}
