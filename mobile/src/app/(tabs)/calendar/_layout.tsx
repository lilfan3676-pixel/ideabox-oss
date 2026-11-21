import { Stack } from "expo-router";

// 每頁自己畫標題，不用原生標題列
export default function Layout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "transparent" } }} />;
}
