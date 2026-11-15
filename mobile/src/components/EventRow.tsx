import { Text, View } from "react-native";
import { useTheme } from "@/lib/theme";
import { md, relDay } from "@/lib/format";
import type { AppEvent } from "@/lib/types";
import { Dot, projectColor, Row } from "./ui";

export function EventRow({ e, project, today, showDate, last }: { e: AppEvent; project?: string; today: string; showDate?: boolean; last?: boolean }) {
  const t = useTheme();
  const multi = e.end_date > e.start_date;
  const when = showDate ? `${md(e.start_date)}${multi ? `～${md(e.end_date)}` : ""}・${relDay(today, e.start_date)}` : multi ? `到 ${md(e.end_date)}` : null;
  return (
    <Row
      left={
        <View style={{ width: 48, alignItems: "flex-start" }}>
          <Text style={{ fontSize: 15, fontWeight: "600", color: e.start_time ? t.text : t.faint, fontVariant: ["tabular-nums"] }}>{e.start_time ?? "整天"}</Text>
        </View>
      }
      title={e.title}
      subtitle={[project, when].filter(Boolean).join("・")}
      right={<Dot color={projectColor(e.project_id)} size={8} />}
      last={last}
    />
  );
}
