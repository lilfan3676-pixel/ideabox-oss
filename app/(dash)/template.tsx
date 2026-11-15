import { PageTransition } from "./PageTransition";

// 每次換頁都會重新掛載，用來播放進場動畫（依分頁順序左右滑入）
export default function Template({ children }: { children: React.ReactNode }) {
  return <PageTransition>{children}</PageTransition>;
}
