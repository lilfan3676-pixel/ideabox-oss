import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // 換頁後 30 秒內切回同一頁直接用瀏覽器裡的暫存，不用再等伺服器
    staleTimes: { dynamic: 30, static: 180 },
  },
};

export default nextConfig;
