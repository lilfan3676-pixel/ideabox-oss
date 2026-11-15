// 像素辦公室的一間房間（從網頁 app/(dash)/office/OfficeView.tsx 的等角房間搬過來，改用 react-native-svg）
// 上班的人坐位子（工作中會打字、等你會跳、休息中桌上有咖啡），下班的人在房間裡走來走去；牆上時鐘、窗外天色跟台北時間走
import { useEffect, useState } from "react";
import { AccessibilityInfo, Text, View } from "react-native";
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, Polygon, Polyline, Rect, Stop, Text as SvgText } from "react-native-svg";
import type { OfficePerson, OfficeStatus } from "@/lib/types";

// 畫面只取房間本體附近（跟網頁一樣）
const VX = 44;
const VY = 2;
const VW = 272;
const VH = 206;
const N = 6;
const ox = 180;
const oy = 74;
const WALL = 62;
const SEATS_MAX = 9;
const WALKERS_MAX = 6;
const iso = (x: number, y: number, z = 0): [number, number] => [ox + (x - y) * 20, oy + (x + y) * 10 - z];
const pts = (...p: [number, number][]) => p.map(([a, b]) => `${a},${b}`).join(" ");
const SEATS: [number, number][] = [1.45, 3.05, 4.65].flatMap((y) => [1.1, 2.9, 4.7].map((x): [number, number] => [x, y]));

export const ROLE_COLOR: Record<string, string> = {
  前端工程師: "#4f8cff", 後端工程師: "#22c55e", 資料庫工程師: "#f59e0b", "App 工程師": "#a855f7", 設計師: "#ec4899", 文案企劃: "#f97316",
  測試工程師: "#14b8a6", 維運工程師: "#64748b", 產品經理: "#ef4444", 研究員: "#eab308", 法律顧問: "#1e3a8a", 財務會計: "#0d9488", 行銷社群: "#d946ef", 業務營運: "#b45309",
};
const STATUS: Record<OfficeStatus, string> = { working: "工作中", waiting: "等你回覆", permission: "等你同意", idle: "休息中", ended: "下班" };
const BOOKS = ["#e85d5d", "#4f8cff", "#f2c14e", "#3fb37f", "#a66cff", "#ff8a3d", "#5ec8d8"];
const SPRITE = ["..hhhh..", ".hhhhhh.", ".hssssh.", ".sesess.", ".ssssss.", "..ssss..", ".cccccc.", "cccccccc", "sccccccs", ".cccccc.", ".pp..pp.", ".pp..pp."];
const HAIR = ["#2b1d14", "#5a3a22", "#111111", "#c9a35c", "#8a3b2e", "#6b6b7a"];
const SKIN = ["#f2c9a0", "#d9a77a", "#b07a52"];
const SKY: Record<"day" | "dusk" | "night", [string, string]> = { day: ["#bfe6ff", "#8fcaf5"], dusk: ["#ffd29a", "#f08a7a"], night: ["#2a3570", "#161c42"] };

function mix(a: string, b: string, t: number) {
  const n = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [n(a), n(b)];
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("")}`;
}
function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
function dayPhase(now: number) {
  const h = new Date(now + 8 * 3600_000).getUTCHours();
  if (h >= 7 && h < 17) return "day" as const;
  if ((h >= 17 && h < 19) || (h >= 5 && h < 7)) return "dusk" as const;
  return "night" as const;
}

/** 動畫時鐘：每 0.25 秒一格；「減少動態效果」打開時不動 */
function useTick() {
  const [tick, setTick] = useState(0);
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduce).catch(() => null);
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduce);
    return () => sub.remove();
  }, []);
  useEffect(() => {
    if (reduce) return;
    const t = setInterval(() => setTick((n) => n + 1), 250);
    return () => clearInterval(t);
  }, [reduce]);
  return { tick, reduce };
}

/** 下班的人的走路路線：起點 → A → B → 起點，速度與起始位置依 id 固定 */
function walkPos(key: string, ms: number): { x: number; y: number; step: boolean } {
  const h = hash(key);
  const spot = (k: number): [number, number] => [0.7 + ((h >> k) % 9) * 0.55, 0.9 + ((h >> (k + 4)) % 9) * 0.52];
  const path = [spot(0), spot(8), spot(16), spot(0)];
  const dur = (16 + (h % 9)) * 1000;
  const p = ((ms + (h % dur)) % dur) / dur; // 0～1
  const seg = Math.min(2, Math.floor(p * 3));
  const t = p * 3 - seg;
  const [a, b] = [path[seg], path[seg + 1]];
  return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, step: Math.floor(ms / 350) % 2 === 0 };
}

export function OfficeRoom({ title, color, people, now, width }: { title: string; color: string; people: OfficePerson[]; now: number; width: number }) {
  const { tick, reduce } = useTick();
  const ms = Date.now();
  const scale = width / VW;
  const height = VH * scale;

  const working = people.filter((p) => p.status !== "ended");
  const off = people.filter((p) => p.status === "ended").sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const seated = working.slice(0, SEATS_MAX);
  const walkers = off.slice(0, WALKERS_MAX);
  const extra = people.length - seated.length - walkers.length;
  const phase = dayPhase(now);
  const night = phase === "night";
  const t = new Date(now + 8 * 3600_000);
  const hh = t.getUTCHours() % 12;
  const mm = t.getUTCMinutes();
  const floorA = mix(color, "#1b1730", 0.72);
  const floorB = mix(color, "#1b1730", 0.62);
  const wallL = mix(color, "#2a2440", 0.45);
  const wallR = mix(color, "#2a2440", 0.3);
  const seed = hash(title) % BOOKS.length;

  const tile = (x: number, y: number) => `M${pts(iso(x, y), iso(x + 1, y), iso(x + 1, y + 1), iso(x, y + 1)).replace(/ /g, "L")}Z`;
  const tilesA: string[] = [];
  const tilesB: string[] = [];
  for (let x = 0; x < N; x++) for (let y = 0; y < N; y++) ((x + y) % 2 ? tilesA : tilesB).push(tile(x, y));

  const seats = SEATS.map(([x, y], i) => ({ x, y, p: seated[i] }));
  const label = `${title}，上班 ${working.length} 人，下班 ${off.length} 人`;

  return (
    <View style={{ width, height }} accessible accessibilityLabel={label}>
      <Svg width={width} height={height} viewBox={`${VX} ${VY} ${VW} ${VH}`}>
        <Defs>
          <LinearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={SKY[phase][0]} />
            <Stop offset="1" stopColor={SKY[phase][1]} />
          </LinearGradient>
        </Defs>
        {/* 牆 */}
        <Polygon points={pts(iso(0, 0), iso(0, N), iso(0, N, WALL), iso(0, 0, WALL))} fill={wallL} />
        <Polygon points={pts(iso(0, 0), iso(N, 0), iso(N, 0, WALL), iso(0, 0, WALL))} fill={wallR} />
        <Polygon points={pts(iso(0, 0, WALL), iso(0, N, WALL), iso(-0.25, N, WALL + 3), iso(-0.25, -0.25, WALL + 3), iso(N, -0.25, WALL + 3), iso(N, 0, WALL))} fill={mix(color, "#ffffff", 0.15)} />
        {/* 左牆招牌 */}
        <Polygon points={pts(iso(0, 1, 46), iso(0, 4.4, 46), iso(0, 4.4, 30), iso(0, 1, 30))} fill="#0f0d1a" opacity={0.85} />
        <SvgText transform={`matrix(1,-0.5,0,1,${iso(0, 4.2, 34)[0]},${iso(0, 4.2, 34)[1]})`} fill={mix(color, "#ffffff", 0.35)} fontSize={9} fontWeight="800">
          {title.slice(0, 10)}
        </SvgText>
        {/* 右牆窗戶 */}
        {[1.2, 3.6].map((x) => (
          <G key={x}>
            <Polygon points={pts(iso(x, 0, 50), iso(x + 1.6, 0, 50), iso(x + 1.6, 0, 22), iso(x, 0, 22))} fill="url(#sky)" opacity={people.length ? 0.9 : 0.5} />
            {night ? [0.3, 1.1].map((k, j) => <Rect key={k} x={iso(x + k, 0, 44 - j * 9)[0]} y={iso(x + k, 0, 44 - j * 9)[1]} width={1.5} height={1.5} fill="#fff6c8" />) : null}
            {phase === "day" ? <Rect x={iso(x + 0.25, 0, 44)[0]} y={iso(x + 0.25, 0, 44)[1]} width={7} height={2.5} fill="#ffffff" opacity={0.8} /> : null}
            <Polyline points={pts(iso(x + 0.8, 0, 50), iso(x + 0.8, 0, 22))} stroke={wallR} strokeWidth={2} />
            <Polygon points={pts(iso(x, 0, 23), iso(x + 1.6, 0, 23), iso(x + 1.6, 0, 21), iso(x, 0, 21))} fill={mix(wallR, "#ffffff", 0.25)} />
          </G>
        ))}
        <Clock c={iso(3.2, 0, 42)} hh={hh} mm={mm} />
        {/* 白板 */}
        <Polygon points={pts(iso(0, 4.7, 46), iso(0, 5.8, 46), iso(0, 5.8, 24), iso(0, 4.7, 24))} fill="#f4f6fb" stroke="#0f0d1a" strokeWidth={1.5} />
        {[40, 35, 30].map((z, j) => (
          <Polyline key={z} points={pts(iso(0, 4.85, z), iso(0, 5.65 - j * 0.15, z - 1))} stroke={j === 1 ? color : "#7b8597"} strokeWidth={1.5} />
        ))}
        {/* 地板、地毯 */}
        <Path d={tilesA.join("")} fill={floorA} />
        <Path d={tilesB.join("")} fill={floorB} />
        <Polygon points={pts(iso(0.8, 1.05), iso(5.85, 1.05), iso(5.85, 5.75), iso(0.8, 5.75))} fill={mix(color, "#1b1730", 0.45)} opacity={0.55} />
        <Polygon points={pts(iso(1.05, 1.3), iso(5.6, 1.3), iso(5.6, 5.5), iso(1.05, 5.5))} fill="none" stroke={mix(color, "#ffffff", 0.2)} strokeWidth={1} opacity={0.5} strokeDasharray="3 2" />
        {/* 書櫃 */}
        <Box x={0.05} y={0.1} w={0.45} d={0.78} h={40} color="#7a5230" />
        {[10, 21, 32].map((z, j) => (
          <G key={z}>
            {[0.12, 0.34, 0.56].map((y, k) => (
              <Polygon key={y} points={pts(iso(0.5, 0.1 + y, z + 8), iso(0.5, 0.1 + y + 0.16, z + 8), iso(0.5, 0.1 + y + 0.16, z), iso(0.5, 0.1 + y, z))} fill={BOOKS[(j * 3 + k + seed) % BOOKS.length]} />
            ))}
          </G>
        ))}
        {/* 茶水區、盆栽 */}
        <Box x={4.15} y={0.12} w={0.95} d={0.5} h={13} color="#d7d2c8" />
        <Box x={4.3} y={0.2} w={0.32} d={0.3} h={22} color="#3b3f4e" />
        <Rect x={iso(4.78, 0.3, 15)[0]} y={iso(4.78, 0.3, 15)[1] - 4} width={3.5} height={4} fill="#ffffff" />
        <Box x={5.3} y={0.3} w={0.5} d={0.5} h={10} color="#8b5a2b" />
        <Circle cx={iso(5.55, 0.55, 22)[0]} cy={iso(5.55, 0.55, 22)[1]} r={9} fill="#2f9e44" />
        <Circle cx={iso(5.55, 0.55, 22)[0] - 4} cy={iso(5.55, 0.55, 22)[1] - 4} r={4} fill="#40b856" />

        {seats.map(({ x, y, p }, i) => (
          <G key={i}>
            {p ? <Person p={p} x={x + 0.35} y={y - 0.45} tick={reduce ? 0 : tick} /> : null}
            <Desk x={x} y={y} on={p?.status === "working"} lamp={night && !!p} glow={reduce ? 0 : tick} />
            {p?.status === "idle" ? <Mug x={x + 1.1} y={y + 0.2} up={!reduce && tick % 8 < 4} /> : null}
          </G>
        ))}
        {walkers.map((p) => {
          const w = reduce ? { ...walkPos(p.key, 0), step: false } : walkPos(p.key, ms);
          return <Person key={p.key} p={p} x={w.x} y={w.y} tick={w.step ? 1 : 0} walking />;
        })}
        {night ? <Polygon points={pts(iso(0, N), iso(N, N), iso(N, 0), iso(N, -0.25, WALL + 3), iso(-0.25, -0.25, WALL + 3), iso(-0.25, N, WALL + 3))} fill="#0b0a24" opacity={0.14} /> : null}
        {people.length === 0 ? (
          <SvgText x={iso(3, 3)[0]} y={iso(3, 3)[1] + 6} textAnchor="middle" fill="#ffffff" opacity={0.8} fontSize={11} fontWeight="700">
            沒有人在工作
          </SvgText>
        ) : null}
      </Svg>

      {/* 泡泡：職位＋狀態，疊在人頭上 */}
      {seats.map(({ x, y, p }, i) => {
        if (!p) return null;
        const [px, py] = iso(x + 0.35, y - 0.45, 40);
        const left = (px - VX) * scale;
        const bottom = height - (py - VY) * scale;
        const roleColor = (p.role && ROLE_COLOR[p.role]) || "#94a3b8";
        const ask = p.status === "waiting" || p.status === "permission";
        return (
          <View key={i} pointerEvents="none" style={{ position: "absolute", left: left - 40, bottom, width: 80, alignItems: "center" }}>
            <View style={{ backgroundColor: "rgba(255,255,255,0.94)", borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2, borderWidth: ask ? 1.5 : 0, borderColor: "#f5b04a", alignItems: "center" }}>
              <Text style={{ fontSize: 10, fontWeight: "800", color: roleColor }} numberOfLines={1}>{p.role ?? "待分配"}</Text>
              <Text style={{ fontSize: 9, color: "#4b4b5c" }} numberOfLines={1}>{STATUS[p.status]}</Text>
            </View>
          </View>
        );
      })}
      {extra > 0 ? (
        <View style={{ position: "absolute", right: 8, bottom: 8, backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 }}>
          <Text style={{ color: "#fff", fontSize: 12, fontWeight: "700" }}>另有 {extra} 人</Text>
        </View>
      ) : null}
    </View>
  );
}

function Box({ x, y, w, d, h, color }: { x: number; y: number; w: number; d: number; h: number; color: string }) {
  return (
    <G>
      <Polygon points={pts(iso(x, y + d), iso(x + w, y + d), iso(x + w, y + d, h), iso(x, y + d, h))} fill={mix(color, "#000000", 0.25)} />
      <Polygon points={pts(iso(x + w, y), iso(x + w, y + d), iso(x + w, y + d, h), iso(x + w, y, h))} fill={mix(color, "#000000", 0.4)} />
      <Polygon points={pts(iso(x, y, h), iso(x + w, y, h), iso(x + w, y + d, h), iso(x, y + d, h))} fill={color} />
    </G>
  );
}

function Clock({ c: [cx, cy], hh, mm }: { c: [number, number]; hh: number; mm: number }) {
  const hand = (deg: number, len: number) => {
    const r = ((deg - 90) * Math.PI) / 180;
    return `${cx},${cy} ${cx + Math.cos(r) * len},${cy + Math.sin(r) * len}`;
  };
  return (
    <G>
      <Circle cx={cx} cy={cy} r={6.5} fill="#fdfbf5" stroke="#0f0d1a" strokeWidth={1.5} />
      <Polyline points={hand((hh + mm / 60) * 30, 3)} stroke="#0f0d1a" strokeWidth={1.4} />
      <Polyline points={hand(mm * 6, 4.8)} stroke="#e85d5d" strokeWidth={1} />
    </G>
  );
}

function Mug({ x, y, up }: { x: number; y: number; up: boolean }) {
  const [mx, my] = iso(x, y, 14);
  return (
    <G>
      <Rect x={mx - 2} y={my - 5} width={4} height={5} fill="#ffffff" />
      <Rect x={mx + 2} y={my - 4} width={1.5} height={2.5} fill="#ffffff" />
      <Rect x={mx - 1.5} y={my - 5} width={3} height={1} fill="#6b3f22" />
      <Rect x={mx - 0.5} y={my - (up ? 11 : 9)} width={1} height={2.5} fill="#ffffff" opacity={0.6} />
    </G>
  );
}

const SCREEN = ["#7ee0ff", "#a8f0ff", "#5fc8ee"];
function Desk({ x, y, on, lamp, glow }: { x: number; y: number; on: boolean; lamp: boolean; glow: number }) {
  const [mx, my] = iso(x + 0.7, y + 0.2, 16);
  const [lx, ly] = iso(x + 0.2, y + 0.35, 14);
  return (
    <G>
      <Box x={x} y={y} w={1.4} d={0.7} h={14} color="#c08a55" />
      {lamp ? (
        <G>
          <Ellipse cx={lx + 4} cy={ly + 2} rx={9} ry={4.5} fill="#ffe08a" opacity={0.35} />
          <Rect x={lx - 0.5} y={ly - 7} width={1.5} height={7} fill="#2b2b3a" />
          <Rect x={lx - 2.5} y={ly - 9} width={5} height={2.5} fill="#ffd166" />
        </G>
      ) : null}
      <Rect x={mx - 9} y={my - 13} width={18} height={12} fill="#2b2b3a" />
      <Rect x={mx - 7} y={my - 11} width={14} height={8} fill={on ? SCREEN[Math.floor(glow / 3) % 3] : "#3a3a4d"} />
      <Rect x={mx - 1.5} y={my - 1} width={3} height={3} fill="#2b2b3a" />
    </G>
  );
}

/** 8×12 像素小人；工作中會上下打字、等你會跳、休息中頭上冒 z */
function Person({ p, x, y, tick, walking = false }: { p: OfficePerson; x: number; y: number; tick: number; walking?: boolean }) {
  const h = hash(p.key);
  const colors: Record<string, string> = { h: HAIR[h % HAIR.length], s: SKIN[(h >> 3) % SKIN.length], e: "#1a1a2a", c: (p.role && ROLE_COLOR[p.role]) || "#94a3b8", p: "#2f3550" };
  const P = 2.5;
  const [fx, fy] = iso(x, y, 4);
  const bob = walking ? (tick ? -1.5 : 0) : p.status === "working" ? (tick % 4 < 2 ? -1 : 0) : p.status === "waiting" || p.status === "permission" ? (tick % 5 < 2 ? -2 : 0) : 0;
  const left = fx - (8 * P) / 2;
  const top = fy - 12 * P + bob;
  const paths: Record<string, string> = {};
  SPRITE.forEach((row, r) =>
    [...row].forEach((ch, c) => {
      if (ch === ".") return;
      paths[ch] = (paths[ch] ?? "") + `M${left + c * P},${top + r * P}h${P}v${P}h-${P}z`;
    }),
  );
  return (
    <G opacity={walking ? 0.85 : 1}>
      {Object.entries(paths).map(([ch, d]) => <Path key={ch} d={d} fill={colors[ch]} />)}
      {p.status === "permission" && !walking ? <SvgText x={fx} y={top - 4} textAnchor="middle" fill="#ff5a5a" fontSize={12} fontWeight="900">!</SvgText> : null}
      {p.status === "waiting" && !walking ? <SvgText x={fx} y={top - 4} textAnchor="middle" fill="#f5b04a" fontSize={12} fontWeight="900">?</SvgText> : null}
      {p.status === "idle" && !walking ? <SvgText x={fx + 10} y={top - (tick % 8 < 4 ? 0 : 3)} fill="#c8c8ff" fontSize={10} fontWeight="800">z</SvgText> : null}
    </G>
  );
}
