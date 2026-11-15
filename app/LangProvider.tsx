"use client";

import { createContext, useContext, useMemo } from "react";
import { makeL, type Lang, type Translate } from "@/lib/i18n";

const LangContext = createContext<Lang>("zh");

export function LangProvider({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  return <LangContext.Provider value={lang}>{children}</LangContext.Provider>;
}

export function useLang(): Lang {
  return useContext(LangContext);
}

/** 用法：const L = useL(); L("點子庫", "Ideas") */
export function useL(): Translate {
  const lang = useContext(LangContext);
  return useMemo(() => makeL(lang), [lang]);
}
