// 桌面小工具「今天」（小、中、大）：小的是「做完幾件／共幾件」，中和大的是今天的時間軸（大的列比較多）。
// 規定同 NextWidget：純函式、不能用最外層的常數。
import { Capsule, HStack, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import { containerBackground, font, foregroundStyle, frame, lineLimit, opacity, padding, widgetURL } from "@expo/ui/swift-ui/modifiers";
import { createWidget, type WidgetEnvironment } from "expo-widgets";

export type TodayRow = { t: string; title: string; state: "past" | "next" | "later" };
export type TodayProps = { rows: TodayRow[]; done: number; total: number; overdue: number; label: string; empty: string; overdueText: string };

function TodayWidget(props: TodayProps, env: WidgetEnvironment) {
  "widget";
  const ink = "#f1f3f8";
  const muted = "#8d93a4";
  const main = "#2f8cff";
  const acc = "#ff8a3d";
  const soft = "#2a2e3a";
  const small = env.widgetFamily === "systemSmall";
  const max = env.widgetFamily === "systemLarge" ? 9 : 4;
  // 放不下時，從「下一件」前面一件開始列，才不會只看到已經過去的
  const at = Math.max(0, props.rows.findIndex((r) => r.state === "next"));
  const from = props.rows.length > max ? Math.min(Math.max(0, at - 1), props.rows.length - max) : 0;
  const rows = props.rows.slice(from, from + max);
  const bars = Array.from({ length: Math.min(8, Math.max(1, props.total)) }, (_, i) => i < props.done);
  return (
    <VStack alignment="leading" spacing={small ? 4 : 6} modifiers={[frame({ maxWidth: 9999, maxHeight: 9999, alignment: "topLeading" }), containerBackground(small ? main : "#16181f", "widget"), widgetURL("ideabox://")]}>
      <HStack spacing={6}>
        <Text modifiers={[font({ size: 12, weight: "semibold" }), foregroundStyle(small ? "#ffffff" : muted)]}>{props.label}</Text>
        <Spacer />
        {!small ? <Text modifiers={[font({ size: 12 }), foregroundStyle(muted)]}>{`${props.done}/${props.total}`}</Text> : null}
      </HStack>
      {small ? (
        <>
          <HStack alignment="firstTextBaseline" spacing={2}>
            <Text modifiers={[font({ size: 46, weight: "semibold", design: "rounded" }), foregroundStyle("#ffffff")]}>{`${props.done}`}</Text>
            <Text modifiers={[font({ size: 20, weight: "medium", design: "rounded" }), foregroundStyle("#ffffff"), opacity(0.75)]}>{`/${props.total}`}</Text>
          </HStack>
          <Spacer />
          <HStack spacing={4}>
            {bars.map((on, i) => <Capsule key={i} modifiers={[frame({ height: 5 }), foregroundStyle("#ffffff"), opacity(on ? 1 : 0.35)]} />)}
          </HStack>
          {props.overdue > 0 ? <Text modifiers={[font({ size: 12, weight: "semibold" }), foregroundStyle(acc), lineLimit(1), padding({ top: 2 })]}>{props.overdueText}</Text> : null}
        </>
      ) : (
        <>
          <HStack spacing={4}>
            {bars.map((on, i) => <Capsule key={i} modifiers={[frame({ height: 5 }), foregroundStyle(on ? main : soft)]} />)}
          </HStack>
          {rows.length ? (
            rows.map((r, i) => (
              <HStack key={i} spacing={8} modifiers={[opacity(r.state === "past" ? 0.45 : 1)]}>
                <Text modifiers={[font({ size: 13, weight: "semibold", design: "rounded" }), foregroundStyle(r.state === "next" ? acc : ink), frame({ width: 46, alignment: "leading" }), lineLimit(1)]}>{r.t}</Text>
                <Text modifiers={[font({ size: 13.5, weight: r.state === "next" ? "semibold" : "regular" }), foregroundStyle(ink), lineLimit(1)]}>{r.title}</Text>
                <Spacer />
              </HStack>
            ))
          ) : (
            <Text modifiers={[font({ size: 14 }), foregroundStyle(muted)]}>{props.empty}</Text>
          )}
          <Spacer />
          {props.overdue > 0 ? <Text modifiers={[font({ size: 12, weight: "medium" }), foregroundStyle("#ff7f7f"), lineLimit(1)]}>{props.overdueText}</Text> : null}
        </>
      )}
    </VStack>
  );
}

export default createWidget<TodayProps>("IdeaboxToday", TodayWidget);
