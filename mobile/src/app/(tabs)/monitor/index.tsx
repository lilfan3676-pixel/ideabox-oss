// 監控：主角是「全部正常／N 項異常」大卡；每個產品一張卡（服務燈號、三個數字＋近 30 天趨勢、資料庫用量）；最後是每週健檢
import { useState } from "react";
import { Animated, Pressable, Text, View } from "react-native";
import { soft } from "@/components/blocks";
import { Card, Dot, Empty, ErrorNote, Loading, Screen, Section } from "@/components/ui";
import { ago } from "@/lib/format";
import { useRise } from "@/lib/motion";
import { halo, useTheme, type Palette } from "@/lib/theme";
import type { Breakdown, MonitorData, MonitorDay, MonitorProductData } from "@/lib/types";
import { useApi } from "@/lib/useApi";

function bytes(b: number) {
  if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toFixed(1)} GB`;
  if (b >= 1024 ** 2) return `${Math.round(b / 1024 ** 2)} MB`;
  return `${Math.round(b / 1024)} KB`;
}

export default function Monitor() {
  const t = useTheme();
  // 開著畫面時每分鐘更新一次（伺服器每 5 分鐘檢查）
  const { data, error, loading, refreshing, refresh } = useApi<MonitorData>("/api/app/monitor", { pollMs: 60_000 });
  if (loading && !data) return <Loading />;
  if (!data) return <Screen onRefresh={refresh}>{error ? <ErrorNote text={error} onRetry={refresh} /> : null}</Screen>;

  const all = data.products.flatMap((p) => p.services.map((s) => ({ ...s, product: p.label })));
  const down = all.filter((s) => s.ok === false);
  const checked = all.filter((s) => s.checked);
  // 異常的排前面
  const products = [...data.products].sort((a, b) => Number(b.services.some((s) => s.ok === false)) - Number(a.services.some((s) => s.ok === false)));

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      {error ? <ErrorNote text={error} onRetry={refresh} /> : null}
      {!data.ready ? <ErrorNote text="監控還沒啟用：ideabox 的資料庫要先執行 migration-004。" /> : null}

      {!all.length ? (
        <Section><Empty text="還沒有監控任何東西。到網頁的「監控」頁加網址，每 5 分鐘會檢查一次。" /></Section>
      ) : (
        <>
          <Text style={{ fontSize: 22, fontWeight: "700", color: down.length ? t.warn : t.muted, marginHorizontal: 22, marginTop: 2 }}>
            {down.length ? `${down.length} 項連不上` : `${checked.length} 項都正常`}
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginHorizontal: 12, marginTop: 14 }}>
            {products.map((p, i) => <HaloTile key={p.key} p={p} i={data.products.indexOf(p)} wide={products.length % 2 === 1 && i === products.length - 1} />)}
          </View>
        </>
      )}

      {products.map((p) => <ProductCard key={p.key} p={p} t={t} />)}

      <HealthCard t={t} health={data.health} />
      <Text style={{ fontSize: 13, color: t.muted, marginHorizontal: 20, marginTop: 10, lineHeight: 18 }}>要新增或移除監控的網址，請到網頁的「監控」頁。</Text>
    </Screen>
  );
}

/** 光環磚：產品名、最重要的一個數字（7 天活躍）、狀態；連不上時改顯示哪個服務壞了 */
function HaloTile({ p, i, wide }: { p: MonitorProductData; i: number; wide: boolean }) {
  const bad = p.services.filter((s) => s.ok === false);
  const none = p.services.every((s) => !s.checked);
  const latest = p.daily[p.daily.length - 1];
  const big = latest?.active7 ?? latest?.users ?? null;
  const label = latest?.active7 != null ? p.metrics?.active7 : p.metrics?.users;
  const okCount = p.services.filter((s) => s.ok).length;
  const rise = useRise(i * 70); // 一塊接一塊浮上來
  return (
    <Animated.View
      accessibilityLabel={`${p.label}，${bad.length ? `${bad.map((s) => s.name).join("、")}連不上` : none ? "尚未檢查" : "正常"}`}
      style={{ flexGrow: 1, flexBasis: wide ? "100%" : "48%", height: wide ? 120 : 190, borderRadius: 20, padding: 13, overflow: "hidden", backgroundColor: "#1a1a1c", experimental_backgroundImage: halo(i), ...rise }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text style={{ flex: 1, fontSize: 14, fontWeight: "700", color: "#ffffff" }} numberOfLines={1}>{p.label}</Text>
        {bad.length ? (
          <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: "#ffe14a", transform: [{ rotate: "45deg" }] }} />
        ) : (
          <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: none ? "rgba(255,255,255,0.5)" : "#9dffbf" }} />
        )}
      </View>
      <Text style={{ fontSize: 12, color: "#ffffff", marginTop: 1 }} numberOfLines={1}>{bad.length ? `${bad[0].name}連不上` : label && big != null ? label : none ? "尚未檢查" : `${okCount} 項服務`}</Text>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        {bad.length ? (
          <Text style={{ fontSize: 26, fontWeight: "700", color: "#ffffff" }} numberOfLines={1}>連不上</Text>
        ) : (
          <Text style={{ fontSize: 42, fontWeight: "400", color: "#ffffff", fontVariant: ["tabular-nums"] }}>{big != null ? big.toLocaleString() : okCount}</Text>
        )}
      </View>
      <Text style={{ fontSize: 12, color: "#ffffff" }} numberOfLines={1}>
        {bad.length ? (bad[0].since ? `${ago(bad[0].since)}開始` : bad[0].error ?? "") : latest?.new7 != null && p.metrics ? `${p.metrics.new7} ${latest.new7}` : none ? "" : "正常"}
      </Text>
    </Animated.View>
  );
}

function ProductCard({ p, t }: { p: MonitorProductData; t: Palette }) {
  const anyDown = p.services.some((s) => s.ok === false);
  const none = p.services.every((s) => !s.checked);
  const latest = p.daily[p.daily.length - 1];
  const weekAgo = p.daily.length > 7 ? p.daily[p.daily.length - 8] : p.daily[0];
  const pill = none ? { text: "尚未檢查", color: t.muted } : anyDown ? { text: "有服務異常", color: t.danger } : { text: "正常", color: t.ok };
  return (
    <Card style={{ marginHorizontal: 16, marginTop: 12, padding: 16, gap: 12, borderColor: anyDown ? soft(t.danger, 0.45) : undefined }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Text style={{ flex: 1, fontSize: 20, fontWeight: "800", color: t.text }} numberOfLines={1}>{p.label}</Text>
        <View style={{ backgroundColor: soft(pill.color, 0.14), borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
          <Text style={{ fontSize: 13, fontWeight: "800", color: pill.color }}>{pill.text}</Text>
        </View>
      </View>

      {/* 服務燈號 */}
      <View style={{ gap: 8 }}>
        {p.services.map((s) => (
          <View key={s.id} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Dot color={!s.checked ? t.faint : s.ok ? t.ok : t.danger} size={9} />
            <Text style={{ flex: 1, fontSize: 15, fontWeight: s.ok === false ? "700" : "500", color: s.ok === false ? t.danger : t.text }}>{s.name}</Text>
            <Text style={{ fontSize: 13, color: s.ok === false ? t.danger : t.muted, maxWidth: 170 }} numberOfLines={1}>
              {!s.checked ? "尚未檢查" : s.ok === false ? s.error ?? "連不上" : s.latency_ms != null ? `${s.latency_ms} ms` : "正常"}
            </Text>
          </View>
        ))}
      </View>

      {/* 三個數字：最新值大字，旁邊寫跟 7 天前比 */}
      {p.metrics && latest ? (
        <View style={{ flexDirection: "row", borderTopWidth: 1, borderTopColor: t.sep, paddingTop: 12 }}>
          <Metric t={t} label={p.metrics.users} v={latest.users} prev={weekAgo?.users ?? null} series={p.daily.map((d) => d.users)} />
          <Metric t={t} label={p.metrics.active7} v={latest.active7} prev={weekAgo?.active7 ?? null} series={p.daily.map((d) => d.active7)} divider />
          <Metric t={t} label={p.metrics.new7} v={latest.new7} prev={weekAgo?.new7 ?? null} series={p.daily.map((d) => d.new7)} divider />
        </View>
      ) : null}

      {/* 資料庫用量 */}
      {p.db_limit && latest?.db_bytes != null ? <DbBar t={t} used={latest.db_bytes} limit={p.db_limit} label={p.db_label ?? "資料庫用量"} /> : null}
      {p.hint ? <Text style={{ fontSize: 13, color: t.muted, lineHeight: 18 }}>{p.hint}</Text> : null}

      {/* 分組統計（例如使用者男女比例），只有主人收得到 */}
      {(p.breakdowns ?? []).map((b) => <BreakdownView key={b.title} b={b} t={t} />)}
    </Card>
  );
}

function BreakdownView({ b, t }: { b: Breakdown; t: Palette }) {
  const [i, setI] = useState(0);
  const v = b.views[Math.min(i, b.views.length - 1)];
  return (
    <View style={{ gap: 10, borderTopWidth: 1, borderTopColor: t.sep, paddingTop: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text style={{ flex: 1, fontSize: 15, fontWeight: "700", color: t.text }}>{b.title}</Text>
        {b.views.length > 1 ? (
          <View style={{ flexDirection: "row", backgroundColor: t.accentSoft, borderRadius: 9, padding: 2 }} accessibilityRole="tablist">
            {b.views.map((x, n) => {
              const on = n === i;
              return (
                <Pressable key={x.label} onPress={() => setI(n)} accessibilityRole="tab" accessibilityState={{ selected: on }} hitSlop={6} style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 7, backgroundColor: on ? t.card : "transparent" }}>
                  <Text style={{ fontSize: 13, fontWeight: on ? "700" : "500", color: on ? t.text : t.muted }}>{x.label}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </View>
      {b.error || !v ? (
        <Text style={{ fontSize: 13, color: t.muted }}>{b.error ?? "沒有資料"}</Text>
      ) : (
        <>
          <View style={{ flexDirection: "row", height: 10, borderRadius: 5, overflow: "hidden", backgroundColor: t.accentSoft }} accessible={false}>
            {v.parts.map((x) => (x.n && v.total ? <View key={x.label} style={{ width: `${(x.n / v.total) * 100}%`, backgroundColor: x.color }} /> : null))}
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 14, rowGap: 4 }}>
            {v.parts.map((x) => (
              <View key={x.label} style={{ flexDirection: "row", alignItems: "center", gap: 5 }} accessible accessibilityLabel={`${x.label} ${x.n} 人，${x.pct}%`}>
                <Dot color={x.color} size={8} />
                <Text style={{ fontSize: 13, color: t.text }}>
                  {x.label} <Text style={{ fontSize: 15, fontWeight: "800" }}>{x.n}</Text> <Text style={{ color: t.muted }}>{x.pct}%</Text>
                </Text>
              </View>
            ))}
          </View>
          {v.table ? (
            <View>
              <View style={{ flexDirection: "row", paddingVertical: 5 }}>
                {v.table.cols.map((c, n) => (
                  <Text key={c} style={{ flex: n === 0 ? 1.4 : 1, textAlign: n === 0 ? "left" : "right", fontSize: 13, color: t.muted }}>{c}</Text>
                ))}
              </View>
              {v.table.rows.map((r) => (
                <View key={r.label} style={{ flexDirection: "row", paddingVertical: 6, borderTopWidth: 1, borderTopColor: t.sep }} accessible accessibilityLabel={`${r.label}：${v.table!.cols.slice(1).map((c, n) => `${c} ${r.cells[n]}`).join("、")}`}>
                  <Text style={{ flex: 1.4, fontSize: 14, fontWeight: "600", color: t.text }}>{r.label}</Text>
                  {r.cells.map((c, n) => (
                    <Text key={n} style={{ flex: 1, textAlign: "right", fontSize: 14, color: c ? t.text : t.faint, fontVariant: ["tabular-nums"] }}>{c}</Text>
                  ))}
                </View>
              ))}
            </View>
          ) : null}
          {b.note ? <Text style={{ fontSize: 12, color: t.muted, lineHeight: 17 }}>{b.note}</Text> : null}
        </>
      )}
    </View>
  );
}

function Metric({ t, label, v, prev, series, divider }: { t: Palette; label: string; v: number | null; prev: number | null; series: (number | null)[]; divider?: boolean }) {
  const diff = v != null && prev != null ? v - prev : null;
  return (
    <View style={{ flex: 1, alignItems: "center", gap: 2, borderLeftWidth: divider ? 1 : 0, borderLeftColor: t.sep }} accessibilityLabel={`${label} ${v ?? "沒有資料"}${diff ? `，比 7 天前${diff > 0 ? "多" : "少"} ${Math.abs(diff)}` : ""}`}>
      <Text style={{ fontSize: 24, fontWeight: "900", color: t.text, fontVariant: ["tabular-nums"] }}>{v ?? "—"}</Text>
      <Text style={{ fontSize: 12, color: t.muted }} numberOfLines={1}>{label}</Text>
      {diff ? <Text style={{ fontSize: 12, fontWeight: "700", color: diff > 0 ? t.ok : t.warn }}>{diff > 0 ? "▲" : "▼"} {Math.abs(diff)}</Text> : <Text style={{ fontSize: 12, color: t.faint }}>持平</Text>}
      <Spark series={series} color={t.accent} track={t.accentSoft} />
    </View>
  );
}

/** 近 30 天的小長條圖 */
function Spark({ series, color, track }: { series: (number | null)[]; color: string; track: string }) {
  const vals = series.slice(-30);
  const max = Math.max(1, ...vals.map((v) => v ?? 0));
  if (vals.length < 2) return null;
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 1, height: 18, marginTop: 4 }} accessible={false}>
      {vals.map((v, i) => (
        <View key={i} style={{ width: 2.5, height: Math.max(2, ((v ?? 0) / max) * 18), backgroundColor: i === vals.length - 1 ? color : track, borderRadius: 1 }} />
      ))}
    </View>
  );
}

function DbBar({ t, used, limit, label }: { t: Palette; used: number; limit: number; label: string }) {
  const pct = Math.min(100, (used / limit) * 100);
  const color = pct >= 80 ? t.danger : pct >= 60 ? t.warn : t.ok;
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={{ fontSize: 13, color: t.muted }}>{label}</Text>
        <Text style={{ fontSize: 13, fontWeight: "700", color: pct >= 80 ? t.danger : t.text }}>{bytes(used)}／{bytes(limit)}・{Math.round(pct)}%</Text>
      </View>
      <View style={{ height: 8, borderRadius: 4, backgroundColor: t.accentSoft, overflow: "hidden" }} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(pct) }}>
        <View style={{ width: `${pct}%`, height: 8, backgroundColor: color }} />
      </View>
    </View>
  );
}

function HealthCard({ t, health }: { t: Palette; health: MonitorData["health"] }) {
  return (
    <Section title={health ? `系統健康・${ago(health.at)}檢查` : "系統健康"}>
      {!health ? (
        <Empty text="還沒有健檢紀錄。每週一早上 9 點自動檢查。" />
      ) : health.issues.length ? (
        health.issues.map((i, n) => (
          <View key={n} style={{ flexDirection: "row", gap: 10, paddingHorizontal: 16, paddingVertical: 11, borderBottomWidth: n === health.issues.length - 1 ? 0 : 1, borderBottomColor: t.sep }}>
            <Dot color={i.level === "error" ? t.danger : t.warn} size={9} />
            <Text style={{ flex: 1, fontSize: 14, color: t.text, lineHeight: 20, marginTop: -5 }}>{i.text}</Text>
          </View>
        ))
      ) : (
        <View style={{ padding: 16, gap: 4 }}>
          <Text style={{ fontSize: 15, fontWeight: "700", color: t.ok }}>排程、分析、AI 費用、Telegram 都正常</Text>
          <Text style={{ fontSize: 13, color: t.muted }}>這週 AI 花費 US${health.ai_usd_week.toFixed(2)}・錯誤 {health.errors} 次</Text>
        </View>
      )}
    </Section>
  );
}
