import { getL } from "@/lib/i18nServer";

// 換頁時立刻顯示的骨架畫面，資料載入完成後自動換成真正內容
export default async function Loading() {
  const L = await getL();
  return (
    <div className="skeleton-page" aria-busy="true" aria-label={L("載入中", "Loading")}>
      <div className="sk sk-title" />
      <div className="sk sk-sub" />
      <div className="sk-row">
        <div className="sk sk-card" />
        <div className="sk sk-card" />
        <div className="sk sk-card" />
      </div>
      <div className="sk sk-bar" />
      <div className="sk-grid">
        <div className="sk sk-block" />
        <div className="sk sk-block" />
        <div className="sk sk-block" />
      </div>
    </div>
  );
}
