"use client";

import { useAccess } from "./AccessContext";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { IconBell, IconLogout, IconSettings } from "./icons";
import { useL } from "../LangProvider";
import { LangSwitch } from "./LangSwitch";

export type BellItem = { key: string; label: string; hint: string; count: number; href: string; tone: "danger" | "warn" };

/** 右上角鈴鐺：點開列出各類待處理數量，各自點進去 */
export function BellMenu({ items }: { items: BellItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const sp = useSearchParams();
  const total = items.reduce((a, i) => a + i.count, 0);
  const L = useL();

  // 換頁後自動關閉
  useEffect(() => setOpen(false), [pathname, sp]);
  // 點外面或按 Esc 關閉
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="bell-menu" ref={ref}>
      <button
        type="button"
        className="circle-btn"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={total ? L(`待處理 ${total} 項`, `${total} to-dos`) : L("沒有待處理事項", "Nothing to do")}
        onClick={() => setOpen((o) => !o)}
      >
        <IconBell size={17} />
        {total > 0 && <span className="bell-dot">{total > 9 ? "9+" : total}</span>}
      </button>
      {open && (
        <div className="menu glass bell-panel" role="menu">
          <p className="bell-title">{L("待處理", "To do")}</p>
          {items.map((i) => (
            <Link key={i.key} href={i.href} role="menuitem" className={`bell-row ${i.count ? "" : "zero"}`} onClick={() => setOpen(false)}>
              <span className="bell-text">
                <b>{i.label}</b>
                <span className="muted small">{i.hint}</span>
              </span>
              <span className={`bell-count ${i.count ? i.tone : ""}`}>{i.count}</span>
            </Link>
          ))}
          {!total && <p className="muted small bell-empty">{L("目前沒有需要處理的事 🎉", "All clear 🎉")}</p>}
        </div>
      )}
    </div>
  );
}

/** 頭像選單：帳號、設定、登出（換頁後自動關閉） */
export function AccountMenu({ email, logout }: { email: string; logout: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const L = useL();
  const owner = useAccess().owner;
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="avatar-menu" ref={ref}>
      <button type="button" className="avatar" aria-label={L("帳號選單", "Account menu")} aria-haspopup="true" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {email.slice(0, 1).toUpperCase()}
      </button>
      {open && (
        <div className="menu glass" role="menu">
          <p className="muted small">{email}</p>
          <LangSwitch compact />
          {owner && (
            <Link href="/settings" className="menu-item" role="menuitem" onClick={() => setOpen(false)}>
              <IconSettings size={16} /> {L("設定", "Settings")}
            </Link>
          )}
          <form action={logout}>
            <button type="submit" className="menu-item" role="menuitem">
              <IconLogout size={16} /> {L("登出", "Log out")}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
