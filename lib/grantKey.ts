// 補助去重鍵（純函式，有單元測試）：優先用網址（去掉 query 與結尾斜線），沒有網址才用名稱。
export function grantKey(name: string, url?: string | null): string {
  if (url) {
    try {
      const u = new URL(url);
      const host = u.hostname.toLowerCase().replace(/^www\./, "");
      const path = u.pathname.replace(/\/+$/, "").toLowerCase();
      // 有些官網用 query 區分不同公告（例如 ?id=123），保留 id 類參數
      const keep = [...u.searchParams.entries()]
        .filter(([k]) => /^(id|sn|no|nid|pid|serno|cid)$/i.test(k))
        .map(([k, v]) => `${k.toLowerCase()}=${v}`)
        .sort()
        .join("&");
      return `url:${host}${path}${keep ? `?${keep}` : ""}`;
    } catch {
      /* 落到用名稱 */
    }
  }
  return `name:${name.replace(/\s+/g, "").toLowerCase()}`;
}
