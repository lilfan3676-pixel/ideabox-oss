"use client";

import { useFormStatus } from "react-dom";
import { useL } from "../LangProvider";

/** 送出前跳確認視窗的按鈕（用於刪除）。 */
export function ConfirmButton({ label, message, className = "btn ghost small" }: { label: string; message: string; className?: string }) {
  const { pending } = useFormStatus();
  const L = useL();
  return (
    <button
      type="submit"
      className={className}
      disabled={pending}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {pending ? L("處理中…", "Working…") : label}
    </button>
  );
}

/** 送出中會顯示「處理中…」並停用的按鈕（AI 分析要幾秒）。 */
export function SubmitButton({
  label,
  pending,
  className = "btn small",
  disabled = false,
  name,
  value,
}: {
  label: string;
  pending?: string;
  className?: string;
  disabled?: boolean;
  name?: string; // 同一個表單有好幾顆送出鈕時，只有按下的那顆顯示「處理中…」
  value?: string;
}) {
  const { pending: busy, data } = useFormStatus();
  const L = useL();
  const mine = busy && (!name || data?.get(name) === value);
  return (
    <button type="submit" className={className} disabled={busy || disabled} name={name} value={value} aria-busy={mine || undefined}>
      {mine ? (pending ?? L("處理中…", "Working…")) : label}
    </button>
  );
}

/** 選單一改就自動送出表單。 */
export function AutoSelect({ name, defaultValue, options }: { name: string; defaultValue: string; options: Array<[string, string]> }) {
  return (
    <select name={name} defaultValue={defaultValue} onChange={(e) => e.currentTarget.form?.requestSubmit()}>
      {options.map(([v, l]) => (
        <option key={v} value={v}>{l}</option>
      ))}
    </select>
  );
}
