import { Stack } from "expo-router";

// 今天頁自己畫標題（整面漸層），不用原生標題列；設定從選單進去
export default function TodayLayout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#000000" } }} />;
}
