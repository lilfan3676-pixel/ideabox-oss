// ideabox 標誌：黑色圓底、白色的「ib」（2026-11-20 換的新標誌，圖檔在 public/brand/ib-logo.png）。
// 淺色是黑底白字，深色用 CSS 反相成白底黑字（globals.css 的 [data-mode="dark"] .ib-mark）；外層 .logo 的底色與框線會自動拿掉（globals.css 的 .logo:has(.ib-mark)）。
export function LogoMark({ size = 20, className }: { size?: number; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/brand/ib-logo.png" width={size} height={size} alt="" aria-hidden="true" className={`ib-mark${className ? ` ${className}` : ""}`} />;
}
