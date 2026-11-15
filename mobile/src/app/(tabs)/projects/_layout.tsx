import { Stack } from "expo-router";
import { useStackOptions } from "@/components/ui";

export default function Layout() {
  return (
    <Stack screenOptions={useStackOptions()}>
      <Stack.Screen name="index" options={{ title: "專案" }} />
      <Stack.Screen name="[slug]" options={{ headerLargeTitle: false, title: "" }} />
    </Stack>
  );
}
