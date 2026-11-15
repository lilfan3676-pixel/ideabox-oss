import { Link, Stack } from "expo-router";
import { SymbolView } from "expo-symbols";
import { Pressable } from "react-native";
import { useStackOptions } from "@/components/ui";
import { useTheme } from "@/lib/theme";

export default function TodayLayout() {
  const t = useTheme();
  return (
    <Stack screenOptions={useStackOptions()}>
      <Stack.Screen
        name="index"
        options={{
          title: "今天",
          headerRight: () => (
            <Link href="/settings" asChild>
              <Pressable hitSlop={10} accessibilityRole="button" accessibilityLabel="設定" style={{ width: 36, height: 36, alignItems: "center", justifyContent: "center" }}>
                <SymbolView name="gearshape" size={22} tintColor={t.accent} weight="medium" />
              </Pressable>
            </Link>
          ),
        }}
      />
    </Stack>
  );
}
