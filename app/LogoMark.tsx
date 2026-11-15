// ideabox 標誌：層層縮進的六角傳送門。顏色跟隨文字色（currentColor），所以每個主題自動配色。
export function LogoMark({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path fillRule="evenodd" d="M12.00 1.00 L21.53 6.50 L21.53 17.50 L12.00 23.00 L2.47 17.50 L2.47 6.50 Z M12.00 3.90 L19.01 7.95 L19.01 16.05 L12.00 20.10 L4.99 16.05 L4.99 7.95 Z" />
      <path fillRule="evenodd" opacity={0.6} d="M13.58 6.21 L18.54 10.09 L17.66 16.33 L11.82 18.69 L6.86 14.81 L7.74 8.57 Z M13.28 8.29 L16.59 10.88 L16.01 15.04 L12.12 16.61 L8.81 14.02 L9.39 9.86 Z" />
      <path d="M13.88 10.83 L15.34 12.34 L14.76 14.36 L12.72 14.87 L11.26 13.36 L11.84 11.34 Z" />
    </svg>
  );
}
