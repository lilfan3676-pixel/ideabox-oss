"use client";

import { memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useL, useLang } from "@/app/LangProvider";
import { FOLDER_COLORS } from "@/lib/folderLogic";
import { displayStatus, handoffLive, isRole, officeCounts, onDuty, ROLE_EN, ROLES, staffKey, staffOf, type AgentSession, type AgentStatus, type Handoff } from "@/lib/officeLogic";
import { stageName, type Project } from "@/lib/projectLogic";
import { ContextMenu } from "../ideaUi";
import { Kpi, KpiRow } from "../Insight";
import { changeSessionRole, dismissSession } from "./actions";

// 像素辦公室：一棟樓，每個專案一個等角視角的房間，大廳放對不到專案的；每個執行中的 Claude Code 是一個小人。
// 圖都是用 SVG 方塊畫的原創像素風，不用外部圖片。

const PALETTE = Object.values(FOLDER_COLORS);
const REFRESH_MS = 3_000;
const SEATS_MAX = 9; // 上班的坐位子
const WALKERS_MAX = 6; // 下班的在房間裡走動，最多畫幾個

const ROLE_COLOR: Record<string, string> = {
  前端工程師: "#4f8cff",
  後端工程師: "#22c55e",
  資料庫工程師: "#f59e0b",
  "App 工程師": "#a855f7",
  設計師: "#ec4899",
  文案企劃: "#f97316",
  測試工程師: "#14b8a6",
  維運工程師: "#64748b",
  產品經理: "#ef4444",
  研究員: "#eab308",
  法律顧問: "#1e3a8a",
  財務會計: "#0d9488",
  行銷社群: "#d946ef",
  業務營運: "#b45309",
};

type ProjectRoom = Pick<Project, "id" | "slug" | "name" | "stages" | "stage" | "status">;

/** 只比較會影響畫面的欄位，沒變就不重畫 */
const sig = (list: AgentSession[]) => list.map((s) => `${s.session_id}|${s.status}|${s.role}|${s.task}|${s.project_id}|${s.updated_at}`).join(";");

const hsig = (list: Handoff[]) => list.map((h) => `${h.id}|${h.to}`).join(";");

export function OfficeView({ projects, sessions: initial, handoffs: initialHandoffs, now: initialNow }: { projects: ProjectRoom[]; sessions: AgentSession[]; handoffs: Handoff[]; now: number }) {
  const L = useL();
  const [sessions, setSessions] = useState(initial);
  const [handoffs, setHandoffs] = useState(initialHandoffs);
  const lastH = useRef(hsig(initialHandoffs));
  // 「休息中」的判斷用到現在時間；取到分鐘就好，避免每次輪詢都讓所有房間重畫
  const [now, setNow] = useState(Math.floor(initialNow / 60_000) * 60_000);
  const last = useRef(sig(initial));
  // 按了「下班」的人：在伺服器確實更新前，就算輪詢拿到舊資料也維持下班（除非他之後又有新的動作）
  const dismissed = useRef(new Map<string, string>());
  const visible = (list: AgentSession[]) => list.map((x) => (dismissed.current.get(x.session_id) === x.updated_at ? { ...x, status: "ended" as const } : x));

  // 每 3 秒只抓在線的 Claude 清單（很小），有變才更新；分頁在背景時暫停，回到前景馬上抓一次
  useEffect(() => {
    let busy = false;
    const ctrl = new AbortController(); // 離開辦公室時立刻取消還在跑的請求
    const tick = async () => {
      if (busy || document.visibilityState !== "visible") return;
      busy = true;
      try {
        const res = await fetch("/api/office/state", { cache: "no-store", signal: ctrl.signal });
        if (!res.ok) return;
        const r = (await res.json()) as { sessions: AgentSession[]; handoffs?: Handoff[]; now: number };
        const hs = r.handoffs ?? [];
        if (hsig(hs) !== lastH.current) {
          lastH.current = hsig(hs);
          setHandoffs(hs);
        }
        const list = visible(r.sessions);
        const next = sig(list);
        if (next !== last.current) {
          last.current = next;
          setSessions(list);
        }
        setNow((n) => {
          const m = Math.floor(r.now / 60_000) * 60_000;
          return m === n ? n : m;
        });
      } catch {
        /* 網路斷掉就等下一次 */
      } finally {
        busy = false;
      }
    };
    const t = setInterval(tick, REFRESH_MS);
    const onVis = () => document.visibilityState === "visible" && tick();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      ctrl.abort();
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  const rooms = useMemo(() => {
    const known = new Set(projects.map((p) => p.id));
    // 房間裡畫的是「人」（同專案同職位＝同一個人），不是一個個 Claude 對話
    const staff = staffOf(sessions, now);
    return {
      // 顏色跟專案頁一樣：照全部專案的順序
      projects: projects.filter((p) => p.status !== "done").map((p) => ({ project: p, color: PALETTE[projects.indexOf(p) % PALETTE.length], people: staff.filter((s) => s.project_id === p.id) })),
      lobby: staff.filter((s) => !s.project_id || !known.has(s.project_id)),
    };
  }, [projects, sessions, now]);

  // 交接：接手的人還在做（工作中／等你）就在兩個人之間畫連線；同一個人（同專案同職位）就在泡泡上標「接手中」
  const live = useMemo(() => {
    const byId = new Map(sessions.map((s) => [s.session_id, s]));
    const lines: { id: string; from: string; to: string; title: string | null }[] = [];
    const taking = new Set<string>();
    for (const h of handoffs) {
      const a = byId.get(h.from);
      const b = h.to ? byId.get(h.to) : undefined;
      if (!a || !b || !handoffLive(b, now)) continue;
      const [ka, kb] = [staffKey(a), staffKey(b)];
      taking.add(kb);
      if (ka !== kb && !lines.some((l) => l.from === ka && l.to === kb)) lines.push({ id: h.id, from: ka, to: kb, title: h.title });
    }
    return { lines, taking };
  }, [handoffs, sessions, now]);
  const takingIn = (people: AgentSession[]) => people.filter((p) => live.taking.has(p.session_id)).map((p) => p.session_id).join(",");

  // 手機：一次一間房間（左右滑或點上面的專案標籤），下面列這間的 Claude
  const roomList = [
    ...rooms.projects.map((r) => ({ key: r.project.id, name: r.project.name, color: r.color })),
    { key: LOBBY, name: L("大廳", "Lobby"), color: "#94a3b8" },
  ];
  const roomOf = (s: AgentSession) => (s.project_id && projects.some((p) => p.id === s.project_id) ? s.project_id : LOBBY);
  const byRoom = (key: string) => sessions.filter((s) => roomOf(s) === key);
  // 電腦版：頂部列點專案＝只看那一間（網址 ?room=短名）；沒有就是整棟大樓
  const roomSlug = useSearchParams().get("room");
  const solo = (roomSlug && projects.find((p) => p.slug === roomSlug)?.id) || null;
  // 一開始停在有人在工作的房間（網址有指定房間就停在那間）
  const [picked, setPicked] = useState<string | null>(solo);
  useEffect(() => {
    if (solo) setPicked(solo);
  }, [solo]);
  const busiest = roomList.find((r) => byRoom(r.key).some((s) => displayStatus(s, now) === "working")) ?? roomList.find((r) => byRoom(r.key).some((s) => onDuty(s, now)));
  const active = picked && roomList.some((r) => r.key === picked) ? picked : (busiest ?? roomList[0]).key;
  const track = useRef<HTMLDivElement>(null);
  const tabs = useRef<HTMLDivElement>(null);
  const centerOn = (el: HTMLElement | null, child: Element | null | undefined, smooth: boolean) => {
    if (!el || !(child instanceof HTMLElement)) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ left: child.offsetLeft - (el.clientWidth - child.offsetWidth) / 2, behavior: smooth && !reduce ? "smooth" : "auto" });
  };
  const roomEl = (key: string) => track.current?.querySelector(`[data-room="${key}"]`);
  // 進來時直接捲到那間（不要動畫）
  useEffect(() => {
    setPicked(active); // 定下來，之後輪詢不會自己換房間
    centerOn(track.current, roomEl(active), false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 上面的標籤跟著目前的房間捲動
  useEffect(() => {
    centerOn(tabs.current, tabs.current?.querySelector(`[data-room="${active}"]`), true);
  }, [active]);
  // 滑動時：看哪一間在正中間
  const raf = useRef(0);
  // 點標籤跳房間時，捲動途中經過的房間不算（停下來才恢復）
  const jumping = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onTrackScroll = () => {
    if (jumping.current) {
      clearTimeout(jumping.current);
      jumping.current = setTimeout(() => (jumping.current = null), 150);
      return;
    }
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      const el = track.current;
      if (!el || el.scrollWidth <= el.clientWidth) return;
      const mid = el.scrollLeft + el.clientWidth / 2;
      let best: string | null = null;
      let dist = Infinity;
      for (const c of Array.from(el.children) as HTMLElement[]) {
        const d = Math.abs(c.offsetLeft + c.offsetWidth / 2 - mid);
        if (d < dist) [dist, best] = [d, c.dataset.room ?? null];
      }
      if (best) setPicked(best);
    });
  };
  const go = (key: string) => {
    setPicked(key);
    if (jumping.current) clearTimeout(jumping.current);
    jumping.current = setTimeout(() => (jumping.current = null), 150);
    centerOn(track.current, roomEl(key), true);
  };

  const dismiss = (id: string) => {
    // 先在畫面上讓他下班（離開座位去走動），再告訴伺服器
    const gone = sessions.find((x) => x.session_id === id);
    if (gone) dismissed.current.set(id, gone.updated_at);
    const next = visible(sessions);
    last.current = sig(next);
    setSessions(next);
    dismissSession(id).catch(() => null);
  };
  const changeRole = (id: string, role: string) => {
    // 先在畫面上換掉，下一次輪詢就會是伺服器的新資料
    const next = sessions.map((x) => (x.session_id === id ? { ...x, role, role_locked: true } : x));
    last.current = sig(next);
    setSessions(next);
    return changeSessionRole(id, role).catch(() => ({ ok: false, locked: false }));
  };
  const activeRoom = roomList.find((r) => r.key === active)!;

  const working = sessions.filter((s) => displayStatus(s, now) === "working").length;
  const needYou = sessions.filter((s) => ["waiting", "permission"].includes(displayStatus(s, now))).length;
  const inOffice = sessions.filter((s) => onDuty(s, now)).length;
  const counts = officeCounts(sessions, handoffs, now);

  return (
    <>
      {/* 電腦版：重點數字卡；手機版照舊用下面的標題列 */}
      <KpiRow label={L("現在狀況", "Right now")}>
        <Kpi pop label={L("工作中", "Working")} value={counts.working} hint={L(`上班 ${inOffice} 人・下班 ${counts.off} 人`, `${inOffice} in · ${counts.off} off`)} />
        <Kpi tone={counts.needYou ? "warn" : ""} label={L("等你回覆", "Waiting for you")} value={counts.needYou} hint={counts.needYou ? L("右邊清單標橘色的那幾個", "The ones marked in the list") : L("沒有人在等你", "Nobody is waiting")} />
        <Kpi label={L("休息中", "Idle")} value={counts.idle} hint={L("坐在位子上、暫時沒在做事", "At their desk, not doing anything")} />
        <Kpi label={L("今天交接", "Handoffs today")} value={counts.handoffsToday} hint={L("一個 Claude 把事情交給另一個", "One Claude passing work to another")} />
      </KpiRow>
      <div className="page-title m-only">
        <h1>{L("辦公室", "Office")}</h1>
        <p className="muted title-stats">
          <span>{L(`上班 ${inOffice}`, `${inOffice} in`)}</span>
          <span>{L(`工作中 ${working}`, `${working} working`)}</span>
          <span>{L(`下班 ${sessions.length - inOffice}`, `${sessions.length - inOffice} off`)}</span>
          {needYou > 0 && <span className="warn-text">{L(`${needYou} 個在等你`, `${needYou} waiting for you`)}</span>}
        </p>
      </div>

      {/* 電腦版寬螢幕：大樓在左、清單和交接紀錄在右；窄一點清單在上面（跟原本一樣） */}
      <div className="office-split">
      <div className="office-list-desk">
        <SessionList sessions={solo ? byRoom(solo) : sessions} projects={projects} now={now} onDismiss={dismiss} onRole={changeRole} />
        {solo && !byRoom(solo).length && <p className="muted small office-solo-empty">{L("這間現在沒有 Claude。", "No Claude in this room right now.")}</p>}
        <HandoffList handoffs={handoffs} sessions={sessions} projects={projects} now={now} />
      </div>

      <div className="office-main">
      {/* 手機：專案標籤（綠點＝有人在工作、橘點＝在等你） */}
      <div className="office-tabs" ref={tabs} role="tablist" aria-label={L("房間", "Rooms")}>
        {roomList.map((r) => {
          const list = byRoom(r.key);
          const busy = list.some((s) => displayStatus(s, now) === "working");
          const wait = list.some((s) => ["waiting", "permission"].includes(displayStatus(s, now)));
          const on = list.filter((s) => onDuty(s, now)).length;
          return (
            <button key={r.key} type="button" role="tab" data-room={r.key} aria-selected={r.key === active} className={`office-tab ${r.key === active ? "on" : ""}`} style={{ ["--room" as string]: r.color }} onClick={() => go(r.key)}>
              {(wait || busy) && <i className={`office-tab-dot ${wait ? "waiting" : "working"}`} aria-label={wait ? L("在等你", "waiting for you") : L("工作中", "working")} />}
              {r.name}
              {on > 0 && <span className="office-tab-n">{on}</span>}
            </button>
          );
        })}
      </div>

      <section className="building" aria-label={L("辦公大樓", "Office building")}>
        <div className="building-roof" aria-hidden>
          <span>IDEABOX HQ</span>
        </div>
        <div className={`building-floors stagger ${solo ? "solo" : ""}`} ref={track} onScroll={onTrackScroll}>
          {rooms.projects.map((r, i) => (
            <Room key={r.project.id} taking={takingIn(r.people)} roomKey={r.project.id} active={r.project.id === active} hide={!!solo && r.project.id !== solo} title={r.project.name} sub={stageName(r.project)} paused={r.project.status === "paused"} color={r.color} people={r.people} now={now} floor={`${Math.floor(i / 2) + 2}F`} />
          ))}
          <Room lobby hide={!!solo} taking={takingIn(rooms.lobby)} roomKey={LOBBY} active={active === LOBBY} title={L("大廳", "Lobby")} sub={L("其他資料夾", "Other folders")} color="#94a3b8" people={rooms.lobby} now={now} floor="1F" />
          {!solo && live.lines.length > 0 && <HandoffLines lines={live.lines} stamp={last.current} />}
        </div>
      </section>
      </div>
      </div>

      {/* 手機：目前這間的 Claude（換房間時淡入） */}
      <div className="office-list-m view-swap" key={active}>
        <SessionList mobile title={activeRoom.name} sessions={byRoom(active)} projects={projects} now={now} onDismiss={dismiss} onRole={changeRole} />
        <HandoffList handoffs={handoffs} sessions={sessions} projects={projects} now={now} />
      </div>
    </>
  );
}

// ---------- 等角房間 ----------

// 畫面只取房間本體附近（裁掉四周空白，房間看起來大一點）
const VX = 44;
const VY = 2;
const VW = 272;
const VH = 206;
const pctX = (px: number) => `${((px - VX) / VW) * 100}%`;
const pctY = (py: number) => `${((py - VY) / VH) * 100}%`;

/** 台北時間的白天／黃昏／晚上（窗外顏色、晚上開檯燈） */
type DayPhase = "day" | "dusk" | "night";
function dayPhase(now: number): DayPhase {
  const h = new Date(now + 8 * 3600_000).getUTCHours();
  if (h >= 7 && h < 17) return "day";
  if ((h >= 17 && h < 19) || (h >= 5 && h < 7)) return "dusk";
  return "night";
}
const SKY: Record<DayPhase, [string, string]> = { day: ["#bfe6ff", "#8fcaf5"], dusk: ["#ffd29a", "#f08a7a"], night: ["#2a3570", "#161c42"] };
const N = 6; // 地板 6×6 格
const ox = 180;
const oy = 74;
const WALL = 62;
const iso = (x: number, y: number, z = 0): [number, number] => [ox + (x - y) * 20, oy + (x + y) * 10 - z];
const pts = (...p: [number, number][]) => p.map(([a, b]) => `${a},${b}`).join(" ");

/** 兩個顏色混合（t=0 全部 a，t=1 全部 b） */
function mix(a: string, b: string, t: number) {
  const n = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [n(a), n(b)];
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("")}`;
}

// 座位（格子座標）：三排各三張桌子
const SEATS: [number, number][] = [1.45, 3.05, 4.65].flatMap((y) => [1.1, 2.9, 4.7].map((x): [number, number] => [x, y]));

const LOBBY = "lobby";

type RoomProps = { taking: string; roomKey: string; active: boolean; title: string; sub: string; color: string; people: AgentSession[]; now: number; floor: string; paused?: boolean; lobby?: boolean; hide?: boolean };

// 房間裡的人沒變就整間不重畫
const Room = memo(RoomInner, (a, b) => a.title === b.title && a.active === b.active && a.hide === b.hide && a.sub === b.sub && a.color === b.color && a.now === b.now && a.floor === b.floor && a.paused === b.paused && a.taking === b.taking && sig(a.people) === sig(b.people));

function RoomInner({ taking, roomKey, active, title, sub, color, people, now, floor, paused = false, lobby = false, hide = false }: RoomProps) {
  const L = useL();
  const gid = useId().replace(/:/g, "");
  const floorSeed = hash(title) % BOOKS.length;
  // 上班的照開工順序坐位子；下班的（最近下班的優先）在房間裡走動
  const working = people.filter((p) => onDuty(p, now));
  const off = people.filter((p) => !onDuty(p, now)).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const shown = working.slice(0, SEATS_MAX);
  const walkers = off.slice(0, WALKERS_MAX);
  const extra = people.length - shown.length - walkers.length;
  const empty = people.length === 0;
  const phase = dayPhase(now);
  const night = phase === "night";
  const [skyTop, skyBottom] = SKY[phase];
  const t = new Date(now + 8 * 3600_000);
  const hh = t.getUTCHours() % 12;
  const mm = t.getUTCMinutes();
  const floorA = mix(color, "#1b1730", 0.72);
  const floorB = mix(color, "#1b1730", 0.62);
  const wallL = mix(color, "#2a2440", 0.45);
  const wallR = mix(color, "#2a2440", 0.3);

  // 棋盤地板：兩種顏色各一條 path（比 36 個多邊形輕很多）
  const tile = (x: number, y: number) => `M${pts(iso(x, y), iso(x + 1, y), iso(x + 1, y + 1), iso(x, y + 1)).replace(/ /g, "L")}Z`;
  const tilesA: string[] = [];
  const tilesB: string[] = [];
  for (let x = 0; x < N; x++) for (let y = 0; y < N; y++) ((x + y) % 2 ? tilesA : tilesB).push(tile(x, y));

  // 桌子與小人依深度排序（後面的先畫）
  const seats = SEATS.map(([x, y], i) => ({ x, y, s: shown[i] }));
  const walking = walkers.map((w) => ({ s: w, ...walkFor(w) }));

  return (
    <article data-room={roomKey} className={`office-room glass ${lobby ? "lobby" : ""} ${empty || paused ? "dim" : ""} ${active ? "active" : ""} ${hide ? "solo-hide" : ""}`} style={{ ["--room" as string]: color }}>
      <header className="office-room-head">
        <span className="office-floor">{floor}</span>
        <b>{title}</b>
        <span className="muted small">{paused ? L("暫停中", "Paused") : sub}</span>
        <span className="office-count small">
          {people.length ? L(`上班 ${working.length}・下班 ${off.length}`, `${working.length} in · ${off.length} off`) : L("沒人", "Empty")}
        </span>
      </header>
      <div className="office-stage">
        <svg viewBox={`${VX} ${VY} ${VW} ${VH}`} className="office-svg" role="img" aria-label={L(`${title}，${people.length} 個 Claude`, `${title}, ${people.length} Claude sessions`)}>
          {/* 牆 */}
          <polygon points={pts(iso(0, 0), iso(0, N), iso(0, N, WALL), iso(0, 0, WALL))} fill={wallL} />
          <polygon points={pts(iso(0, 0), iso(N, 0), iso(N, 0, WALL), iso(0, 0, WALL))} fill={wallR} />
          <polygon points={pts(iso(0, 0, WALL), iso(0, N, WALL), iso(-0.25, N, WALL + 3), iso(-0.25, -0.25, WALL + 3), iso(N, -0.25, WALL + 3), iso(N, 0, WALL))} fill={mix(color, "#ffffff", 0.15)} />
          {/* 左牆：招牌 */}
          <polygon points={pts(iso(0, 1, 46), iso(0, 4.4, 46), iso(0, 4.4, 30), iso(0, 1, 30))} fill="#0f0d1a" opacity="0.85" />
          <text transform={`matrix(1,-0.5,0,1,${iso(0, 4.2, 34)[0]},${iso(0, 4.2, 34)[1]})`} className="office-sign" fill={mix(color, "#ffffff", 0.35)}>
            {title.slice(0, 10)}
          </text>
          {/* 右牆：窗戶 */}
          <defs>
            <linearGradient id={`sky-${gid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={skyTop} />
              <stop offset="1" stopColor={skyBottom} />
            </linearGradient>
          </defs>
          {[1.2, 3.6].map((x) => (
            <g key={x}>
              <polygon points={pts(iso(x, 0, 50), iso(x + 1.6, 0, 50), iso(x + 1.6, 0, 22), iso(x, 0, 22))} fill={`url(#sky-${gid})`} opacity={empty ? 0.5 : 0.9} />
              {night && [0.3, 1.1].map((k, j) => <rect key={k} x={iso(x + k, 0, 44 - j * 9)[0]} y={iso(x + k, 0, 44 - j * 9)[1]} width="1.5" height="1.5" fill="#fff6c8" />)}
              {phase === "day" && <rect x={iso(x + 0.25, 0, 44)[0]} y={iso(x + 0.25, 0, 44)[1]} width="7" height="2.5" fill="#ffffff" opacity=".8" />}
              <polyline points={pts(iso(x + 0.8, 0, 50), iso(x + 0.8, 0, 22))} stroke={wallR} strokeWidth="2" />
              <polygon points={pts(iso(x, 0, 23), iso(x + 1.6, 0, 23), iso(x + 1.6, 0, 21), iso(x, 0, 21))} fill={mix(wallR, "#ffffff", 0.25)} />
            </g>
          ))}
          {/* 右牆：時鐘（台北時間） */}
          <Clock cx={iso(3.2, 0, 42)[0]} cy={iso(3.2, 0, 42)[1]} hh={hh} mm={mm} />
          {/* 左牆：白板 */}
          <polygon points={pts(iso(0, 4.7, 46), iso(0, 5.8, 46), iso(0, 5.8, 24), iso(0, 4.7, 24))} fill="#f4f6fb" stroke="#0f0d1a" strokeWidth="1.5" />
          {[40, 35, 30].map((z, j) => (
            <polyline key={z} points={pts(iso(0, 4.85, z), iso(0, 5.65 - j * 0.15, z - 1))} stroke={j === 1 ? color : "#7b8597"} strokeWidth="1.5" />
          ))}
          {/* 地板 */}
          <path d={tilesA.join("")} fill={floorA} shapeRendering="crispEdges" />
          <path d={tilesB.join("")} fill={floorB} shapeRendering="crispEdges" />
          {/* 地毯 */}
          <polygon points={pts(iso(0.8, 1.05), iso(5.85, 1.05), iso(5.85, 5.75), iso(0.8, 5.75))} fill={mix(color, "#1b1730", 0.45)} opacity=".55" />
          <polygon points={pts(iso(1.05, 1.3), iso(5.6, 1.3), iso(5.6, 5.5), iso(1.05, 5.5))} fill="none" stroke={mix(color, "#ffffff", 0.2)} strokeWidth="1" opacity=".5" strokeDasharray="3 2" />
          {/* 書櫃（左後角） */}
          <Box x={0.05} y={0.1} w={0.45} d={0.78} h={40} color="#7a5230" />
          {[10, 21, 32].map((z, j) => (
            <g key={z}>
              {[0.12, 0.34, 0.56].map((y, k) => (
                <polygon key={y} points={pts(iso(0.5, 0.1 + y, z + 8), iso(0.5, 0.1 + y + 0.16, z + 8), iso(0.5, 0.1 + y + 0.16, z), iso(0.5, 0.1 + y, z))} fill={BOOKS[(j * 3 + k + floorSeed) % BOOKS.length]} />
              ))}
            </g>
          ))}
          {/* 茶水區：櫃子＋咖啡機 */}
          <Box x={4.15} y={0.12} w={0.95} d={0.5} h={13} color="#d7d2c8" />
          <Box x={4.3} y={0.2} w={0.32} d={0.3} h={22} color="#3b3f4e" />
          <rect x={iso(4.78, 0.3, 15)[0]} y={iso(4.78, 0.3, 15)[1] - 4} width="3.5" height="4" fill="#ffffff" />
          {/* 盆栽 */}
          <Box x={5.3} y={0.3} w={0.5} d={0.5} h={10} color="#8b5a2b" />
          <circle cx={iso(5.55, 0.55, 22)[0]} cy={iso(5.55, 0.55, 22)[1]} r="9" fill="#2f9e44" />
          <circle cx={iso(5.55, 0.55, 22)[0] - 4} cy={iso(5.55, 0.55, 22)[1] - 4} r="4" fill="#40b856" />

          {seats.map(({ x, y, s }, i) => (
            <g key={i}>
              {s && <Person s={s} x={x + 0.35} y={y - 0.45} now={now} />}
              <Desk x={x} y={y} on={!!s && displayStatus(s, now) === "working"} lamp={night && !!s} />
              {s && displayStatus(s, now) === "idle" && <Mug x={x + 1.1} y={y + 0.2} />}
            </g>
          ))}
          {/* 下班的人畫在桌子上面，在房間裡走來走去 */}
          {walking.map((w) => (
            <g key={w.s.session_id} className="office-walk" style={w.style}>
              <Person s={w.s} x={w.x} y={w.y} now={now} walking />
            </g>
          ))}
          {/* 晚上整間暗一點：只蓋房間的輪廓，不蓋到外面的空白 */}
          {night && <polygon points={pts(iso(0, N), iso(N, N), iso(N, 0), iso(N, -0.25, WALL + 3), iso(-0.25, -0.25, WALL + 3), iso(-0.25, N, WALL + 3))} fill="#0b0a24" opacity=".14" pointerEvents="none" />}
          {empty && (
            <text x={iso(3, 3)[0]} y={iso(3, 3)[1] + 6} textAnchor="middle" className="office-empty">
              {paused ? L("暫停中", "Paused") : L("沒有人在工作", "Nobody here")}
            </text>
          )}
        </svg>
        {/* 泡泡：HTML 疊在 SVG 上，文字才好排 */}
        {seats.map(({ x, y, s }, i) => {
          if (!s) return null;
          const [px, py] = iso(x + 0.35, y - 0.45, 46);
          return (
            <div key={i} className="office-anchor" data-staff={s.session_id} style={{ left: pctX(px), top: pctY(py) }}>
              <Bubble s={s} now={now} lobby={lobby} compact={shown.length > 3} taking={taking.split(",").includes(s.session_id)} />
            </div>
          );
        })}
        {/* 房間畫不下的人數（上班最多 9 個座位、下班最多畫 6 個） */}
        {extra > 0 && (
          <span className="office-extra" title={L(`房間畫不下，還有 ${extra} 人沒畫出來，完整名單在下面清單`, `${extra} more not drawn; see the list below`)}>
            {L(`另有 ${extra} 人`, `+${extra} more`)}
          </span>
        )}
      </div>
    </article>
  );
}

/** 下班的人的走動路線：從房間某處出發、走到另外兩個點再走回來（起點、路線、速度依 id 固定，彼此錯開） */
function walkFor(s: AgentSession): { x: number; y: number; style: React.CSSProperties } {
  const h = hash(s.session_id);
  const spot = (k: number): [number, number] => [0.7 + ((h >> k) % 9) * 0.55, 0.9 + ((h >> (k + 4)) % 9) * 0.52];
  const [x, y] = spot(0);
  const [sx, sy] = iso(x, y, 4);
  const [ax, ay] = iso(...spot(8), 4);
  const [bx, by] = iso(...spot(16), 4);
  const dur = 16 + (h % 9);
  return {
    x,
    y,
    style: {
      ["--x1" as string]: ax - sx,
      ["--y1" as string]: ay - sy,
      ["--x2" as string]: bx - sx,
      ["--y2" as string]: by - sy,
      animationDuration: `${dur}s`,
      animationDelay: `-${h % dur}s`,
    } as React.CSSProperties,
  };
}

function Box({ x, y, w, d, h, color }: { x: number; y: number; w: number; d: number; h: number; color: string }) {
  return (
    <g>
      <polygon points={pts(iso(x, y + d), iso(x + w, y + d), iso(x + w, y + d, h), iso(x, y + d, h))} fill={mix(color, "#000000", 0.25)} />
      <polygon points={pts(iso(x + w, y), iso(x + w, y + d), iso(x + w, y + d, h), iso(x + w, y, h))} fill={mix(color, "#000000", 0.4)} />
      <polygon points={pts(iso(x, y, h), iso(x + w, y, h), iso(x + w, y + d, h), iso(x, y + d, h))} fill={color} />
    </g>
  );
}

const BOOKS = ["#e85d5d", "#4f8cff", "#f2c14e", "#3fb37f", "#a66cff", "#ff8a3d", "#5ec8d8"];

/** 牆上的時鐘，指針是台北現在時間 */
function Clock({ cx, cy, hh, mm }: { cx: number; cy: number; hh: number; mm: number }) {
  const hand = (deg: number, len: number) => {
    const r = ((deg - 90) * Math.PI) / 180;
    return `${cx},${cy} ${cx + Math.cos(r) * len},${cy + Math.sin(r) * len}`;
  };
  return (
    <g>
      <circle cx={cx} cy={cy} r="6.5" fill="#fdfbf5" stroke="#0f0d1a" strokeWidth="1.5" />
      <polyline points={hand((hh + mm / 60) * 30, 3)} stroke="#0f0d1a" strokeWidth="1.4" />
      <polyline points={hand(mm * 6, 4.8)} stroke="#e85d5d" strokeWidth="1" />
    </g>
  );
}

/** 休息中的人桌上放一杯咖啡 */
function Mug({ x, y }: { x: number; y: number }) {
  const [mx, my] = iso(x, y, 14);
  return (
    <g className="office-mug">
      <rect x={mx - 2} y={my - 5} width="4" height="5" fill="#ffffff" />
      <rect x={mx + 2} y={my - 4} width="1.5" height="2.5" fill="#ffffff" />
      <rect x={mx - 1.5} y={my - 5} width="3" height="1" fill="#6b3f22" />
      <rect x={mx - 0.5} y={my - 9} width="1" height="2.5" fill="#ffffff" opacity=".6" className="office-steam" />
    </g>
  );
}

function Desk({ x, y, on, lamp = false }: { x: number; y: number; on: boolean; lamp?: boolean }) {
  const [mx, my] = iso(x + 0.7, y + 0.2, 16);
  const [lx, ly] = iso(x + 0.2, y + 0.35, 14);
  return (
    <g>
      <Box x={x} y={y} w={1.4} d={0.7} h={14} color="#c08a55" />
      {/* 晚上有人坐的位子開檯燈 */}
      {lamp && (
        <g>
          <ellipse cx={lx + 4} cy={ly + 2} rx="9" ry="4.5" fill="#ffe08a" opacity=".35" />
          <rect x={lx - 0.5} y={ly - 7} width="1.5" height="7" fill="#2b2b3a" />
          <rect x={lx - 2.5} y={ly - 9} width="5" height="2.5" fill="#ffd166" />
        </g>
      )}
      {/* 螢幕（背面朝我們，亮著代表在工作） */}
      <rect x={mx - 9} y={my - 13} width="18" height="12" fill="#2b2b3a" />
      <rect x={mx - 7} y={my - 11} width="14" height="8" fill={on ? "#7ee0ff" : "#3a3a4d"} className={on ? "office-screen" : undefined} />
      <rect x={mx - 1.5} y={my - 1} width="3" height="3" fill="#2b2b3a" />
    </g>
  );
}

// 8×12 的像素小人：h 頭髮、s 皮膚、e 眼睛、c 衣服（職位顏色）、p 褲子
const SPRITE = ["..hhhh..", ".hhhhhh.", ".hssssh.", ".sesess.", ".ssssss.", "..ssss..", ".cccccc.", "cccccccc", "sccccccs", ".cccccc.", ".pp..pp.", ".pp..pp."];
const HAIR = ["#2b1d14", "#5a3a22", "#111111", "#c9a35c", "#8a3b2e", "#6b6b7a"];
const SKIN = ["#f2c9a0", "#d9a77a", "#b07a52"];

function spritePaths(left: number, top: number, P: number): Record<string, string> {
  const out: Record<string, string> = {};
  SPRITE.forEach((row, r) =>
    [...row].forEach((ch, c) => {
      if (ch === ".") return;
      out[ch] = (out[ch] ?? "") + `M${left + c * P},${top + r * P}h${P}v${P}h-${P}z`;
    }),
  );
  return out;
}

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function Person({ s, x, y, now, walking = false }: { s: AgentSession; x: number; y: number; now: number; walking?: boolean }) {
  const L = useL();
  const st = displayStatus(s, now);
  const label = `${s.role ?? L("待分配", "Unassigned")}・${L("待機中", "Standing by")}`;
  const h = hash(s.session_id);
  const colors: Record<string, string> = {
    h: HAIR[h % HAIR.length],
    s: SKIN[(h >> 3) % SKIN.length],
    e: "#1a1a2a",
    c: (s.role && ROLE_COLOR[s.role]) || "#94a3b8",
    p: "#2f3550",
  };
  const P = 2.5;
  const [fx, fy] = iso(x, y, 4);
  const left = fx - (8 * P) / 2;
  const top = fy - 12 * P;
  return (
    <g className={`office-person ${st} ${walking ? "walking" : ""}`} shapeRendering="crispEdges">
      {walking && <title>{label}</title>}
      <g className="office-body">
        {/* 每種顏色畫成一條 path（一個小人 5 個節點，而不是 80 個方塊） */}
        {Object.entries(spritePaths(left, top, P)).map(([ch, d]) => <path key={ch} d={d} fill={colors[ch]} />)}
      </g>
      {st === "permission" && (
        <text x={fx} y={top - 4} textAnchor="middle" className="office-alert">!</text>
      )}
      {st === "waiting" && !walking && (
        <text x={fx} y={top - 4} textAnchor="middle" className="office-ask">?</text>
      )}
      {st === "idle" && !walking && (
        <text x={fx + 10} y={top} className="office-zzz">z</text>
      )}
    </g>
  );
}

const STATUS_LABEL: Record<AgentStatus, [string, string]> = {
  working: ["工作中", "Working"],
  waiting: ["等你回覆", "Waiting for you"],
  permission: ["等你同意", "Needs approval"],
  idle: ["休息中", "Idle"],
  ended: ["下班", "Ended"],
};

/** compact：房間人多時只顯示職位（框的顏色代表狀態），滑過去才展開 */
function Bubble({ s, now, lobby, compact = false, taking = false }: { s: AgentSession; now: number; lobby: boolean; compact?: boolean; taking?: boolean }) {
  const L = useL();
  const lang = useLang();
  const st = displayStatus(s, now);
  const role = s.role ? (lang === "en" && isRole(s.role) ? ROLE_EN[s.role] : s.role) : L("待分配", "Unassigned");
  return (
    <div className={`office-bubble ${st} ${compact ? "compact" : ""}`}>
      <b style={{ color: (s.role && ROLE_COLOR[s.role]) || undefined }}>
        {role}
        {st === "ended" && <span className="office-dots" aria-hidden>…</span>}
      </b>
      {/* 沒在工作的：顯示待機中，不顯示上次做的事 */}
      <span className="office-status">{st === "ended" ? L("待機中", "Standing by") : L(...STATUS_LABEL[st])}</span>
      {s.task && st !== "ended" && <span className="office-task">{s.task}</span>}
      {taking && st !== "ended" && <span className="office-taking">{L("↪ 接手中", "↪ Handed off")}</span>}
      {lobby && s.folder && <span className="office-folder">📁 {s.folder}</span>}
    </div>
  );
}

// ---------- 文字清單（手機、螢幕閱讀器） ----------

function ago(iso: string, now: number, L: ReturnType<typeof useL>) {
  const m = Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
  if (m < 1) return L("剛剛", "just now");
  if (m < 60) return L(`${m} 分鐘前`, `${m}m ago`);
  return L(`${Math.floor(m / 60)} 小時前`, `${Math.floor(m / 60)}h ago`);
}

function SessionList({
  sessions,
  projects,
  now,
  onDismiss,
  onRole,
  mobile = false,
  title,
}: {
  mobile?: boolean;
  title?: string;
  sessions: AgentSession[];
  projects: ProjectRoom[];
  now: number;
  onDismiss: (id: string) => void;
  onRole: (id: string, role: string) => Promise<{ ok: boolean; locked: boolean }>;
}) {
  const L = useL();
  const lang = useLang();
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [note, setNote] = useState("");
  const [showOff, setShowOff] = useState(false);
  // 收合狀態記在這台電腦上
  const [open, setOpen] = useState(true);
  useEffect(() => {
    try {
      if (localStorage.getItem("ib-office-list") === "closed") setOpen(false);
    } catch {
      /* 存不了就預設展開 */
    }
  }, []);
  const toggle = () => {
    setOpen(!open);
    try {
      localStorage.setItem("ib-office-list", open ? "closed" : "open");
    } catch {
      /* 無痕模式等 */
    }
  };
  if (!sessions.length && !mobile) return null;
  const name = (id: string | null) => projects.find((p) => p.id === id)?.name ?? L("大廳", "Lobby");
  const count = (st: AgentStatus[]) => sessions.filter((x) => st.includes(displayStatus(x, now))).length;
  const working = count(["working"]);
  const waiting = count(["waiting", "permission"]);
  const on = sessions.filter((x) => onDuty(x, now));
  const off = sessions.filter((x) => !onDuty(x, now)).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const renderRow = (s: AgentSession) => {
    const st = displayStatus(s, now);
    const role = s.role ? (lang === "en" && isRole(s.role) ? ROLE_EN[s.role] : s.role) : L("待分配", "Unassigned");
    return (
      <li key={s.session_id} className={`office-row ${st}`}>
        <span className="office-row-who">
          <span className="office-dot" style={{ background: (s.role && ROLE_COLOR[s.role]) || "#94a3b8" }} aria-hidden />
          <span className="office-row-name">
            <button
              type="button"
              className="office-role-btn"
              onClick={(e) => setMenu({ x: e.clientX, y: e.clientY, id: s.session_id })}
              title={L("點一下手動改職位", "Click to change role")}
            >
              {role}
              {s.role_locked && <span className="office-role-pin" aria-label={L("你指定的", "set by you")}>📌</span>}
            </button>
            <span className="muted">{name(s.project_id)}</span>
          </span>
        </span>
        <span className={`office-row-status ${st}`}>{L(...STATUS_LABEL[st])}</span>
        <span className="office-row-task">{s.task ?? (s.folder ? `📁 ${s.folder}` : L("還沒交代工作", "No task yet"))}</span>
        <span className="office-row-time muted">{ago(s.updated_at, now, L)}</span>
        {st !== "ended" && (
          <button
            type="button"
            className="office-row-off"
            onClick={() => onDismiss(s.session_id)}
            title={L("這個 Claude 已經關掉了：請他下班", "This Claude is closed — send them home")}
            aria-label={L(`請 ${role} 下班`, `Send ${role} home`)}
          >
            {L("下班", "Home")}
          </button>
        )}
      </li>
    );
  };
  if (mobile && !on.length && !off.length)
    return (
      <section className="glass office-list">
        <h2 className="office-list-title">{title}</h2>
        <p className="muted small office-list-note">{L("這間現在沒有 Claude", "No Claude in this room")}</p>
      </section>
    );
  const shown = open || mobile;
  return (
    <section className={`glass office-list ${shown ? "" : "closed"}`} aria-label={L("辦公室的 Claude", "Everyone in the office")}>
      {mobile ? (
        <h2 className="office-list-title">
          {title}
          <span className="muted">{L(`上班 ${on.length}`, `${on.length} in`)}</span>
        </h2>
      ) : (
      <h2 className="office-list-title">
        <button type="button" className="office-list-toggle" onClick={toggle} aria-expanded={open}>
          <span className="office-chevron" aria-hidden>▾</span>
          {L("上班中的 Claude", "On duty")}
          <span className="muted">{on.length}</span>
          {!open && (
            <span className="office-list-summary">
              {working > 0 && <span className="office-row-status working">{L(`工作中 ${working}`, `${working} working`)}</span>}
              {waiting > 0 && <span className="office-row-status waiting">{L(`等你 ${waiting}`, `${waiting} waiting`)}</span>}
            </span>
          )}
        </button>
      </h2>
      )}
      {shown && (
        <>
          <ul className="view-swap">{on.map(renderRow)}</ul>
          {off.length > 0 && (
            <>
              <button type="button" className="office-off-toggle muted small" onClick={() => setShowOff(!showOff)} aria-expanded={showOff}>
                <span className="office-chevron" aria-hidden>{showOff ? "▾" : "▸"}</span>
                {L(`已下班 ${off.length} 人（還在辦公室裡走動）`, `${off.length} off duty (still wandering the office)`)}
              </button>
              {showOff && <ul className="office-off-list view-swap">{off.map(renderRow)}</ul>}
            </>
          )}
        </>
      )}
      {note && <p className="muted small office-list-note">{note}</p>}
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} label={L("指定職位", "Set role")}>
          <p className="ctx-title">{L("指定職位（之後 AI 只改任務、不改職位）", "Set role (AI keeps it from now on)")}</p>
          <div className="office-role-grid">
            {ROLES.map((r) => (
              <button
                key={r}
                type="button"
                role="menuitem"
                onClick={() => {
                  const id = menu.id;
                  setMenu(null);
                  onRole(id, r).then((res) =>
                    setNote(!res.ok ? L("沒改成功，請再試一次", "Couldn't change it, try again") : res.locked ? "" : L("職位改好了，但要先執行 migration-018-office-role.sql，AI 下次才不會改回去", "Changed, but run migration-018-office-role.sql so the AI won't change it back")),
                  );
                }}
              >
                <i style={{ background: ROLE_COLOR[r] }} aria-hidden />
                {lang === "en" ? ROLE_EN[r] : r}
              </button>
            ))}
          </div>
        </ContextMenu>
      )}
    </section>
  );
}

// ---------- 交接：連線與時間軸 ----------

/** 接手的人還在做時，兩個人之間一條流動的虛線（量泡泡定位點在畫面上的位置；手機版一次一間房間，不畫） */
function HandoffLines({ lines, stamp }: { lines: { id: string; from: string; to: string; title: string | null }[]; stamp: string }) {
  const L = useL();
  const [paths, setPaths] = useState<{ id: string; d: string; title: string | null }[]>([]);
  const key = lines.map((l) => `${l.from}>${l.to}`).join(";");
  const own = useRef<SVGSVGElement>(null);
  useLayoutEffect(() => {
    // 用自己的上一層（樓層外框）量；第一次畫面出來時外框的 ref 還沒接上，不能用外面傳進來的 ref
    const el = own.current?.parentElement;
    if (!el) return;
    const measure = () => {
      const box = el.getBoundingClientRect();
      const at = (k: string) => {
        const a = el.querySelector(`[data-staff="${CSS.escape(k)}"]`);
        if (!a) return null;
        const r = a.getBoundingClientRect();
        return [r.left - box.left, r.top - box.top + 34] as const; // 定位點在頭頂上方，往下一點接到人身上
      };
      const next: typeof paths = [];
      for (const l of lines) {
        const a = at(l.from);
        const b = at(l.to);
        if (!a || !b) continue;
        const [mx, my] = [(a[0] + b[0]) / 2, Math.min(a[1], b[1]) - 40 - Math.abs(a[0] - b[0]) * 0.12];
        next.push({ id: l.id, d: `M${a[0]},${a[1]} Q${mx},${my} ${b[0]},${b[1]}`, title: l.title });
      }
      setPaths(next);
    };
    measure();
    // 房間進場動畫跑完、視窗大小改變時重新量
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    el.addEventListener("animationend", measure);
    el.addEventListener("transitionend", measure);
    const t = setTimeout(measure, 900);
    return () => {
      ro.disconnect();
      el.removeEventListener("animationend", measure);
      el.removeEventListener("transitionend", measure);
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, stamp]); // stamp：有人換位子時也重新量
  // svg 一直留著（沒有線時是空的），才量得到外框
  return (
    <svg ref={own} className="office-handoff-lines" aria-hidden>
      {paths.map((p) => (
        <g key={p.id}>
          <title>{p.title ? L(`交接：${p.title}`, `Handoff: ${p.title}`) : L("交接", "Handoff")}</title>
          <path d={p.d} className="office-handoff-shadow" />
          <path d={p.d} className="office-handoff-line" />
        </g>
      ))}
    </svg>
  );
}

const time = (iso: string) => {
  const t = new Date(Date.parse(iso) + 8 * 3600_000);
  return `${t.getUTCMonth() + 1}/${t.getUTCDate()} ${String(t.getUTCHours()).padStart(2, "0")}:${String(t.getUTCMinutes()).padStart(2, "0")}`;
};

/** 交接紀錄：誰交給誰、交了什麼、現在做到哪（7 天內，最新的在上面） */
function HandoffList({ handoffs, sessions, projects, now }: { handoffs: Handoff[]; sessions: AgentSession[]; projects: ProjectRoom[]; now: number }) {
  const L = useL();
  const lang = useLang();
  const [all, setAll] = useState(false);
  if (!handoffs.length) return null;
  const byId = new Map(sessions.map((s) => [s.session_id, s]));
  const who = (s: AgentSession | undefined) => {
    if (!s) return L("（已不在辦公室）", "(gone)");
    const role = s.role ? (lang === "en" && isRole(s.role) ? ROLE_EN[s.role] : s.role) : L("待分配", "Unassigned");
    const room = projects.find((p) => p.id === s.project_id)?.name ?? (s.folder || L("大廳", "Lobby"));
    return (
      <span className="office-ho-who">
        <i className="office-dot" style={{ background: (s.role && ROLE_COLOR[s.role]) || "#94a3b8" }} aria-hidden />
        {role}
        <span className="muted">{room}</span>
      </span>
    );
  };
  const state = (to: AgentSession | undefined): [string, string] => {
    if (!to) return ["pending", L("還沒開工", "Not started")];
    const st = displayStatus(to, now);
    if (st === "working") return ["working", L("進行中", "In progress")];
    if (st === "waiting" || st === "permission") return ["waiting", L("等你", "Needs you")];
    if (st === "idle") return ["idle", L("休息中", "Idle")];
    return ["ended", L("結束", "Done")];
  };
  const list = all ? handoffs : handoffs.slice(0, 6);
  return (
    <section className="glass office-list office-handoffs" aria-label={L("交接紀錄", "Handoffs")}>
      <h2 className="office-list-title">
        {L("交接紀錄", "Handoffs")}
        <span className="muted">{L("7 天內", "last 7 days")}</span>
      </h2>
      <ul>
        {list.map((h) => {
          const [cls, label] = state(h.to ? byId.get(h.to) : undefined);
          return (
            <li key={h.id} className="office-ho-row">
              <span className="office-row-time muted">{time(h.created_at)}</span>
              <span className="office-ho-pair">
                {who(byId.get(h.from))}
                <span className="office-ho-arrow" aria-label={L("交給", "to")}>→</span>
                {h.to ? who(byId.get(h.to)) : <span className="muted">{L("新的工作階段", "New session")}</span>}
              </span>
              <span className="office-row-task">{h.title ?? ""}</span>
              <span className={`office-row-status ${cls}`}>{label}</span>
            </li>
          );
        })}
      </ul>
      {handoffs.length > 6 && (
        <button type="button" className="office-off-toggle muted small" onClick={() => setAll(!all)} aria-expanded={all}>
          {all ? L("收起", "Show less") : L(`看全部 ${handoffs.length} 筆`, `Show all ${handoffs.length}`)}
        </button>
      )}
    </section>
  );
}
