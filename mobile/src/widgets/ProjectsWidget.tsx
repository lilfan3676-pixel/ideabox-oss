// 桌面小工具「各專案的下一步」（中、大）：一個專案兩行——名稱與第幾階段、下一步。
// 規定同 NextWidget：純函式、不能用最外層的常數。
import { Circle, HStack, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import { containerBackground, font, foregroundStyle, frame, lineLimit, padding, widgetURL } from "@expo/ui/swift-ui/modifiers";
import { createWidget, type WidgetEnvironment } from "expo-widgets";

export type ProjectRow = { name: string; next: string; frac: string; color: string; late: number };
export type ProjectsProps = { rows: ProjectRow[]; label: string; empty: string };

function ProjectsWidget(props: ProjectsProps, env: WidgetEnvironment) {
  "widget";
  const ink = "#f1f3f8";
  const muted = "#8d93a4";
  const large = env.widgetFamily === "systemLarge";
  const rows = props.rows.slice(0, large ? 6 : 2);
  return (
    <VStack alignment="leading" spacing={large ? 9 : 7} modifiers={[frame({ maxWidth: 9999, maxHeight: 9999, alignment: "topLeading" }), containerBackground("#16181f", "widget"), widgetURL("ideabox://projects")]}>
      <Text modifiers={[font({ size: 12, weight: "semibold" }), foregroundStyle(muted)]}>{props.label}</Text>
      {rows.length ? (
        rows.map((r, i) => (
          <VStack key={i} alignment="leading" spacing={1}>
            <HStack spacing={7}>
              <Circle modifiers={[frame({ width: 8, height: 8 }), foregroundStyle(r.color)]} />
              <Text modifiers={[font({ size: 14, weight: "semibold" }), foregroundStyle(ink), lineLimit(1)]}>{r.name}</Text>
              <Spacer />
              {r.late > 0 ? <Text modifiers={[font({ size: 12, weight: "semibold" }), foregroundStyle("#ff7f7f")]}>{`${r.late}`}</Text> : null}
              <Text modifiers={[font({ size: 12, design: "rounded" }), foregroundStyle(muted)]}>{r.frac}</Text>
            </HStack>
            <Text modifiers={[font({ size: 12.5 }), foregroundStyle(muted), lineLimit(1), padding({ leading: 15 })]}>{r.next}</Text>
          </VStack>
        ))
      ) : (
        <Text modifiers={[font({ size: 14 }), foregroundStyle(muted)]}>{props.empty}</Text>
      )}
      <Spacer />
    </VStack>
  );
}

export default createWidget<ProjectsProps>("IdeaboxProjects", ProjectsWidget);
