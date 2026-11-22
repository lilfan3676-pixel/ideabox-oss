// 桌面小工具「下一件」（小、中）：接下來最近的一件事——時間、標題、還有多久；沒有事就講今天的狀況。
// 小工具的規定（expo-widgets）：這個函式要是純的、同步的，不能用 hook、不能讀檔案最外層的常數，
// 所以顏色都寫在函式裡面；資料由 App 讀到首頁時推過來（lib/widgets.ts）。
import { HStack, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import { containerBackground, font, foregroundStyle, frame, lineLimit, padding, widgetURL } from "@expo/ui/swift-ui/modifiers";
import { createWidget, type WidgetEnvironment } from "expo-widgets";

export type NextProps = { has: boolean; time: string; title: string; sub: string; done: number; total: number; overdue: number; label: string; overdueText: string };

function NextWidget(props: NextProps, env: WidgetEnvironment) {
  "widget";
  const ink = "#f1f3f8";
  const muted = "#8d93a4";
  const main = "#2f8cff";
  const acc = "#ff8a3d";
  const wide = env.widgetFamily !== "systemSmall";
  return (
    <VStack alignment="leading" spacing={3} modifiers={[frame({ maxWidth: 9999, maxHeight: 9999, alignment: "topLeading" }), containerBackground("#16181f", "widget"), widgetURL("ideabox://")]}>
      <HStack spacing={6}>
        <Text modifiers={[font({ size: 12, weight: "semibold" }), foregroundStyle(acc)]}>{props.label}</Text>
        <Spacer />
        {wide && props.total > 0 ? <Text modifiers={[font({ size: 12 }), foregroundStyle(muted)]}>{`${props.done}/${props.total}`}</Text> : null}
      </HStack>
      {props.has && props.time ? <Text modifiers={[font({ size: wide ? 34 : 30, weight: "semibold", design: "rounded" }), foregroundStyle(main), lineLimit(1)]}>{props.time}</Text> : null}
      <Text modifiers={[font({ size: props.has && props.time ? 15 : 18, weight: "medium" }), foregroundStyle(ink), lineLimit(props.has && props.time ? 2 : 3)]}>{props.title}</Text>
      <Spacer />
      <Text modifiers={[font({ size: 12 }), foregroundStyle(muted), lineLimit(1)]}>{props.sub}</Text>
      {props.overdue > 0 ? <Text modifiers={[font({ size: 12, weight: "medium" }), foregroundStyle("#ff7f7f"), lineLimit(1), padding({ top: 1 })]}>{props.overdueText}</Text> : null}
    </VStack>
  );
}

export default createWidget<NextProps>("IdeaboxNext", NextWidget);
