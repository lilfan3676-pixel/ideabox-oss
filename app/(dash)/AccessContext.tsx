"use client";

import { createContext, useContext } from "react";
import { OWNER_ACCESS, type Access } from "@/lib/accessLogic";

// 目前登入者的權限（主人＝全部），畫面用來藏起沒權限的選單與按鈕。真正的檢查在伺服器端。
const Ctx = createContext<Access>(OWNER_ACCESS);

export function AccessProvider({ access, children }: { access: Access; children: React.ReactNode }) {
  return <Ctx.Provider value={access}>{children}</Ctx.Provider>;
}

export const useAccess = () => useContext(Ctx);
