// 監控：大字講一個產品的狀況（有連不上的排最前面），左右滑換下一個產品；
// 下面一個產品一列，兩條小眼睛標出現在看的那個，點一列展開細節（有展開、收起的動畫）
import { useState } from "react";
import { Animated, LayoutAnimation, Pressable, View } from "react-native";
import { Icon } from "@/components/Icon";
import { Orb } from "@/components/Orb";
import { Big, Dot, Empty, ErrorNote, Head, Label, Line, Loading, Page, Sig, Small, Txt } from "@/components/ui";
import { ago } from "@/lib/format";
import { L } from "@/lib/i18n";
import { reduceMotion } from "@/lib/motion";
import { useSwipe } from "@/lib/swipe";
import { useTheme, type Palette } from "@/lib/theme";
import type { Breakdown, MonitorData, MonitorProductData } from "@/lib/types";
import { useApi } from "@/lib/useApi";

function bytes(b: number) {
  if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toFixed(1)} GB`;
  if (b >= 1024 ** 2) return `${Math.round(b / 1024 ** 2)} MB`;
  return `${Math.round(b / 1024)} KB`;
}

export default function Monitor() {
  const t = useTheme();
  const { data, error, loading, refreshing, refresh } = useApi<MonitorData>("/api/app/monitor", { pollMs: 60_000 });
  const [open, setOpen] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null); // 滑到哪個產品（key）
  // 有連不上的排最前面
  const products = [...(data?.products ?? [])].sort((a, b) => Number(b.services.some((s) => s.ok === false)) - Number(a.services.some((s) => s.ok === false)));
  const index = Math.max(0, products.findIndex((p) => p.key === picked));
  const swipe = useSwipe(products.length, index, (i) => setPicked(products[i]?.key ?? null));
  if (loading && !data) return <Loading />;
  if (!data) return <Page onRefresh={refresh}><Head title={L("監控", "Monitor")} />{error ? <ErrorNote text={error} onRetry={refresh} /> : null}</Page>;

  const down = data.products.flatMap((p) => p.services).filter((s) => s.ok === false);
  const cur = products[index];
  const curBad = cur?.services.filter((s) => s.ok === false) ?? [];
  const curLatest = cur?.daily[cur.daily.length - 1];
  const curNum = curLatest?.active7 ?? curLatest?.users ?? null;
  /** 展開、收起：高度用動畫長出來、收回去 */
  const toggle = (key: string) => {
    if (!reduceMotion()) LayoutAnimation.configureNext({ duration: 260, create: { type: "easeInEaseOut", property: "opacity" }, update: { type: "spring", springDamping: 0.9 }, delete: { type: "easeInEaseOut", property: "opacity", duration: 120 } });
    setOpen((o) => (o === key ? null : key));
  };

  return (
    <Page refreshing={refreshing} onRefresh={refresh} swiping={swipe.dragging}>
      <View {...swipe.handlers}>
      <Head title={L("監控", "Monitor")} pad={112} right={<Txt size={14} lh={20} muted tab>{down.length ? L(`${down.length} 項異常`, `${down.length} down`) : L("每 5 分鐘檢查", "Every 5 min")}</Txt>} />
      <Orb size={160} mood={curBad.length ? "worried" : "calm"} style={{ position: "absolute", right: -44, top: 20 }} />
      {error ? <ErrorNote text={error} onRetry={refresh} /> : null}
      {!data.ready ? <ErrorNote text={L("監控還沒啟用：ideabox 的資料庫要先執行 migration-004。", "Monitoring isn't on yet: run migration-004 first.")} /> : null}

      <Animated.View style={[{ marginTop: 40, marginRight: 100, minHeight: 128 }, swipe.style]} accessibilityHint={L("左右滑換下一個產品", "Swipe sideways for the next product")}>
        {cur ? (
          <>
            <Big lines={2}>{`${cur.label}\n${curBad.length ? L(`${curBad[0].name}連不上`, `${curBad[0].name} is down`) : cur.services.every((s) => !s.checked) ? L("還沒檢查", "Not checked") : L("正常", "All good")}`}</Big>
            <Txt muted tab style={{ marginTop: 8 }} numberOfLines={1}>
              {curBad.length
                ? `${curBad[0].since ? L(`${ago(curBad[0].since)}開始`, `since ${ago(curBad[0].since)}`) : curBad[0].error ?? ""}${curBad.length > 1 ? L(`，另外還有 ${curBad.length - 1} 項`, `, +${curBad.length - 1} more`) : ""}`
                : curNum != null && cur.metrics
                  ? `${curLatest?.active7 != null ? cur.metrics.active7 : cur.metrics.users} ${curNum.toLocaleString()}`
                  : L(`${cur.services.length} 項服務`, `${cur.services.length} services`)}
            </Txt>
          </>
        ) : (
          <>
            <Big>{L("還沒監控任何東西", "Nothing monitored yet")}</Big>
            <Txt muted style={{ marginTop: 8 }}>{L("到網頁的監控頁加網址", "Add an address on the web Monitor page")}</Txt>
          </>
        )}
      </Animated.View>

      <View style={{ marginTop: 32 }}>
        {products.map((p, i) => {
          const bad = p.services.filter((s) => s.ok === false);
          const none = p.services.every((s) => !s.checked);
          const latest = p.daily[p.daily.length - 1];
          const big = latest?.active7 ?? latest?.users ?? null;
          const on = open === p.key;
          return (
            <View key={p.key}>
              <Line last={i === products.length - 1 && !on} onPress={() => { setPicked(p.key); toggle(p.key); }} label={`${p.label}，${bad.length ? L(`${bad.length} 項異常`, `${bad.length} down`) : none ? L("還沒檢查", "not checked") : L("正常", "OK")}`}>
                <Dot color={bad.length ? t.bad : none ? t.track : t.ok} size={6} />
                <Txt style={{ flex: 1 }} numberOfLines={1}>{p.label}</Txt>
                {i === index ? <Sig label={L("現在看的這個", "Showing now")} /> : null}
                {bad.length ? (
                  <Small icon="warn" color={t.badText}>{L(`${bad.length} 項`, `${bad.length}`)}</Small>
                ) : big != null ? (
                  <Small icon="users" iconLabel={latest?.active7 != null ? p.metrics?.active7 : p.metrics?.users}>{big.toLocaleString()}</Small>
                ) : none ? (
                  <Small>{L("還沒檢查", "Not checked")}</Small>
                ) : (
                  <Icon name="check" size={16} color={t.muted} label={L("正常", "OK")} />
                )}
              </Line>
              {on ? <Detail p={p} t={t} last={i === products.length - 1} /> : null}
            </View>
          );
        })}
      </View>

      </View>

      <Label icon="check">{data.health ? L(`每週健檢　${ago(data.health.at)}`, `Weekly check  ${ago(data.health.at)}`) : L("每週健檢", "Weekly check")}</Label>
      {!data.health ? (
        <Empty text={L("還沒有紀錄，每週一早上 9 點自動檢查", "No record yet. Runs every Monday 9:00")} />
      ) : data.health.issues.length ? (
        data.health.issues.map((it, n) => (
          <Line key={n} last={n === data.health!.issues.length - 1} style={{ alignItems: "flex-start", paddingVertical: 12 }}>
            <View style={{ marginTop: 7 }}><Dot color={it.level === "error" ? t.bad : t.muted} size={6} /></View>
            <Txt size={14} lh={20} style={{ flex: 1 }}>{it.text}</Txt>
          </Line>
        ))
      ) : (
        <Txt size={14} lh={20} muted style={{ paddingVertical: 8 }}>{L(`排程、分析、Telegram 都正常。這週 AI 花費 US$${data.health.ai_usd_week.toFixed(2)}，錯誤 ${data.health.errors} 次`, `Jobs, analysis and Telegram are fine. AI spend this week US$${data.health.ai_usd_week.toFixed(2)}, ${data.health.errors} errors`)}</Txt>
      )}
    </Page>
  );
}

/** 點開一個產品：每個服務、三個數字、資料庫用量、分組統計 */
function Detail({ p, t, last }: { p: MonitorProductData; t: Palette; last: boolean }) {
  const latest = p.daily[p.daily.length - 1];
  const weekAgo = p.daily.length > 7 ? p.daily[p.daily.length - 8] : p.daily[0];
  const nums = p.metrics && latest ? ([[p.metrics.users, latest.users, weekAgo?.users], [p.metrics.active7, latest.active7, weekAgo?.active7], [p.metrics.new7, latest.new7, weekAgo?.new7]] as const) : [];
  const pct = p.db_limit && latest?.db_bytes != null ? Math.min(100, (latest.db_bytes / p.db_limit) * 100) : null;
  return (
    <View style={{ paddingLeft: 18, paddingBottom: 16, gap: 12, borderBottomWidth: last ? 0 : 1, borderBottomColor: t.line }}>
      <View style={{ gap: 6 }}>
        {p.services.map((s) => (
          <View key={s.id} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Txt size={14} lh={20} color={s.ok === false ? t.badText : t.ink} style={{ flex: 1 }}>{s.name}</Txt>
            <Txt size={13} lh={18} tab color={s.ok === false ? t.badText : t.muted} numberOfLines={1} style={{ maxWidth: 180 }}>
              {!s.checked ? L("還沒檢查", "Not checked") : s.ok === false ? s.error ?? L("連不上", "Down") : s.latency_ms != null ? `${s.latency_ms} ms` : L("正常", "OK")}
            </Txt>
          </View>
        ))}
      </View>
      {nums.length ? (
        <View style={{ flexDirection: "row", gap: 16 }}>
          {nums.map(([label, v, prev]) => {
            const diff = v != null && prev != null ? v - prev : 0;
            return (
              <View key={label} style={{ flex: 1 }} accessible accessibilityLabel={`${label} ${v ?? "—"}`}>
                <Txt size={22} lh={28} tab>{v ?? "—"}</Txt>
                <Txt size={12} lh={16} muted numberOfLines={1}>{label}</Txt>
                <Txt size={12} lh={16} tab color={diff < 0 ? t.badText : t.muted}>{diff ? `${diff > 0 ? "+" : "−"}${Math.abs(diff)}` : L("持平", "flat")}</Txt>
              </View>
            );
          })}
        </View>
      ) : null}
      {pct != null ? (
        <View style={{ gap: 6 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Txt size={13} lh={18} muted>{p.db_label ?? L("資料庫用量", "Database")}</Txt>
            <Txt size={13} lh={18} tab color={pct >= 80 ? t.badText : t.ink}>{`${bytes(latest!.db_bytes!)} / ${bytes(p.db_limit!)}　${Math.round(pct)}%`}</Txt>
          </View>
          <View style={{ height: 3, borderRadius: 2, backgroundColor: t.track }} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(pct) }}>
            <View style={{ width: `${pct}%`, height: 3, borderRadius: 2, backgroundColor: pct >= 80 ? t.bad : t.ink }} />
          </View>
        </View>
      ) : null}
      {p.hint ? <Txt size={13} lh={18} muted>{p.hint}</Txt> : null}
      {(p.breakdowns ?? []).map((b) => <BreakdownView key={b.title} b={b} t={t} />)}
    </View>
  );
}

function BreakdownView({ b, t }: { b: Breakdown; t: Palette }) {
  const [i, setI] = useState(0);
  const v = b.views[Math.min(i, b.views.length - 1)];
  return (
    <View style={{ gap: 10, borderTopWidth: 1, borderTopColor: t.line, paddingTop: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
        <Txt size={14} lh={20} style={{ flex: 1 }}>{b.title}</Txt>
        {b.views.length > 1
          ? b.views.map((x, n) => (
              <Pressable key={x.label} onPress={() => setI(n)} accessibilityRole="tab" accessibilityState={{ selected: n === i }} hitSlop={12} style={{ borderBottomWidth: 1.5, borderBottomColor: n === i ? t.ink : "transparent" }}>
                <Txt size={13} lh={22} color={n === i ? t.ink : t.muted}>{x.label}</Txt>
              </Pressable>
            ))
          : null}
      </View>
      {b.error || !v ? (
        <Txt size={13} muted>{b.error ?? L("沒有資料", "No data")}</Txt>
      ) : (
        <>
          <View style={{ flexDirection: "row", height: 6, borderRadius: 3, overflow: "hidden", backgroundColor: t.track }} accessible={false}>
            {v.parts.map((x) => (x.n && v.total ? <View key={x.label} style={{ width: `${(x.n / v.total) * 100}%`, backgroundColor: x.color }} /> : null))}
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 16, rowGap: 4 }}>
            {v.parts.map((x) => (
              <View key={x.label} style={{ flexDirection: "row", alignItems: "center", gap: 6 }} accessible accessibilityLabel={`${x.label} ${x.n}，${x.pct}%`}>
                <Dot color={x.color} size={6} />
                <Txt size={13} lh={18} tab>{`${x.label} ${x.n}`}</Txt>
                <Txt size={13} lh={18} tab muted>{`${x.pct}%`}</Txt>
              </View>
            ))}
          </View>
          {v.table ? (
            <View>
              <View style={{ flexDirection: "row", paddingVertical: 4 }}>
                {v.table.cols.map((c, n) => <Txt key={c} size={12} lh={16} muted style={{ flex: n === 0 ? 1.4 : 1, textAlign: n === 0 ? "left" : "right" }}>{c}</Txt>)}
              </View>
              {v.table.rows.map((r) => (
                <View key={r.label} style={{ flexDirection: "row", paddingVertical: 6, borderTopWidth: 1, borderTopColor: t.line }} accessible accessibilityLabel={`${r.label}：${v.table!.cols.slice(1).map((c, n) => `${c} ${r.cells[n]}`).join("、")}`}>
                  <Txt size={13} lh={18} style={{ flex: 1.4 }}>{r.label}</Txt>
                  {r.cells.map((c, n) => <Txt key={n} size={13} lh={18} tab muted={!c} style={{ flex: 1, textAlign: "right" }}>{c}</Txt>)}
                </View>
              ))}
            </View>
          ) : null}
          {b.note ? <Txt size={12} lh={17} muted>{b.note}</Txt> : null}
        </>
      )}
    </View>
  );
}
