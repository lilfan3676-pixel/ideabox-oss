// 排程時間（前後端共用，不能 import 任何 node 模組）

/** 「14:00」「9:5」「14：00」「14:00:00」→「14:00」；不合法回傳 null */
export function parseTime(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const m = s.trim().replace("：", ":").match(/^(\d{1,2}):(\d{1,2})(?::\d{2})?$/);
  if (!m) return null;
  const h = +m[1];
  const min = +m[2];
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}
