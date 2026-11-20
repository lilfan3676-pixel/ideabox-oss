"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { createPortal } from "react-dom";
import type { Idea } from "@/lib/db";
import { isDesign } from "@/lib/labels";
import type { Folder } from "@/lib/folderLogic";
import { FOLDER_COLORS, folderColor, reorder, sortFolders } from "@/lib/folderLogic";
import { taipeiShort } from "@/lib/format";
import { catLabel } from "@/lib/labels";
import { useL, useLang } from "@/app/LangProvider";
import type { Translate } from "@/lib/i18n";
import { CATEGORIES } from "@/lib/scoring";
import { hasFilters, matchFilters, MIN_SCORES, NO_PROJECT, splitAdopted, type IdeaFilters } from "@/lib/ideaFilters";
import { AddIdeaForm } from "./AddIdeaForm";
import { DupNotice, DupTitles } from "./DupNotice";
import { createFolder, deleteFolder, deleteIdea, moveIdeas, renameFolder, reorderFolders, saveNote, setCategory, setFolderColor, setIdeaProject, toggleAdopted, toggleBrief } from "./actions";
import { AutoSelect, ConfirmButton, SubmitButton } from "./ConfirmButton";
import { DesignCard, DesignDetail, DesignRow } from "./designUi";
import { ideaInsights } from "@/lib/insights";
import { axisLabels, bestFit } from "@/lib/scoring";
import { BarRow, Delta, Kpi, KpiRow, SidePanel } from "./Insight";

type ProjectName = { id: string; name: string };
// 卡片上的分數標籤用：有指定專案就顯示專案名稱，沒有就顯示「相關」（對最相關專案的分數）
function useScoreLabel(i: Idea): string {
  const names = useContext(ProjectNames);
  const L = useL();
  // 沒指定專案：顯示 AI 評出來最適合的那個專案（新評分才有）
  const best = i.project_id ? null : bestFit(i.scoring?.projects, null, [...names.keys()]);
  return (i.project_id && names.get(i.project_id)) || (best && names.get(best.id)) || L("相關", "Fit");
}
import { IconGrid, IconSearch } from "./icons";
import { ContextMenu, DetailPanel, ProjectFits, ProjectNames, ScoreBlock, FlagToggle, LayoutToggle, SourceButton, useFlagToggle, useLayout, type CardExtra, type FlagKey } from "./ideaUi";
import { useView } from "./Nav";

const VIEWS = ["all", "week", "todo", "adopted", "brief"] as const;
const VIEW_LABEL: Record<string, [string, string]> = {
  all: ["全部", "All"],
  week: ["本週新增", "New this week"],
  todo: ["待補充", "Needs input"],
  adopted: ["已採用", "Adopted"],
  brief: ["已選入設計簡報", "In the design brief"],
};
const WEEK_MS = 7 * 86_400_000;
const SOURCE_LABEL: Record<Idea["source"], [string, string]> = { threads: ["Threads", "Threads"], text: ["直接寫的想法", "Typed notes"], photo: ["照片", "Photos"], link: ["連結", "Links"] };
const NONE = "none"; // 「未分類」的網址參數
// 拖曳時帶的資料種類：點子（可以一次多個）或資料夾（排順序）
const DRAG_IDEAS = "application/x-ideabox-ideas";
const DRAG_FOLDER = "application/x-ideabox-folder";

/** 拖曳時跟著游標的是一個小圖示（不是整張大卡片），比較好對準上面的資料夾 */
function setDragImage(e: DragEvent, label: string) {
  const el = document.createElement("div");
  el.className = "drag-ghost";
  el.innerHTML = '<span class="drag-ghost-icon">💡</span><span class="drag-ghost-text"></span>';
  el.querySelector(".drag-ghost-text")!.textContent = label;
  document.body.appendChild(el);
  e.dataTransfer.setDragImage(el, 18, 18);
  // 瀏覽器拍完拖曳圖就可以移除
  requestAnimationFrame(() => el.remove());
}

/** 更新網址參數但不向伺服器重新要資料（重新整理後仍保留篩選） */
function setParam(name: string, value: string) {
  const u = new URL(window.location.href);
  if (value) u.searchParams.set(name, value);
  else u.searchParams.delete(name);
  window.history.replaceState(null, "", u.pathname + u.search);
}

export function IdeasView({
  ideas: serverIdeas,
  folders: serverFolders,
  foldersReady,
  projects = [],
  urls,
  initial,
  now,
}: {
  ideas: Idea[];
  folders: Folder[];
  foldersReady: boolean;
  projects?: ProjectName[]; // 點子可以指定的專案（還沒執行 migration-013 時是空的）
  urls: Record<string, string>; // 圖片的簽名網址
  initial: { q: string; sort: string; folder: string; filters: IdeaFilters };
  now: number; // 由伺服器提供，避免伺服器與瀏覽器算出的「本週」不同
}) {
  const view = useView("all", VIEWS);
  const L = useL();
  const [q, setQ] = useState(initial.q);
  const [sort, setSort] = useState(initial.sort === "new" ? "new" : "score");
  const [folder, setFolderState] = useState(initial.folder);
  // 網址裡的專案已經不存在（被刪掉）就當作沒篩選
  const [filters, setFiltersState] = useState<IdeaFilters>(() => {
    const p = initial.filters.project;
    return p && p !== NO_PROJECT && !projects.some((x) => x.id === p) ? { ...initial.filters, project: "" } : initial.filters;
  });
  const setFilter = <K extends keyof IdeaFilters>(k: K, v: IdeaFilters[K]) => {
    setFiltersState((f) => ({ ...f, [k]: v }));
    setParam(k, v ? String(v) : "");
  };
  const clearFilters = () => {
    setFiltersState({ adopt: "", project: "", min: 0, cat: "" });
    for (const k of ["adopt", "project", "min", "cat"]) setParam(k, "");
  };
  // 「已採用」那一區預設收起來（平常不太看），展開與否記在這台裝置
  const [adoptedOpen, setAdoptedOpen] = useState(false);
  useEffect(() => {
    try { if (localStorage.getItem("ib-adopted-expanded") === "1") setAdoptedOpen(true); } catch {}
  }, []);
  const toggleAdoptedOpen = () => {
    const next = !adoptedOpen;
    setAdoptedOpen(next);
    try { localStorage.setItem("ib-adopted-expanded", next ? "1" : "0"); } catch {}
  };
  const [layout, setLayout] = useLayout("ib-layout-ideas");
  const [openId, setOpenId] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dragging, setDragging] = useState<string[]>([]);
  const [notice, setNotice] = useState<{ text: string; bad?: boolean } | null>(null);
  const [projectBusy, setProjectBusy] = useState(false);
  const [cardMenu, setCardMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const closeCardMenu = useCallback(() => setCardMenu(null), []);

  // 搬移、排序先在畫面上生效，伺服器更新完資料傳回來後就以伺服器為準
  const [moved, setMoved] = useState<Record<string, string | null>>({});
  const [order, setOrder] = useState<string[] | null>(null);
  // 採用、簡報開關也是先在畫面上切換
  const [flags, setFlags] = useState<Record<string, Partial<Record<FlagKey, boolean>>>>({});
  useEffect(() => {
    setMoved({});
    setFlags({});
  }, [serverIdeas]);
  const ideas = useMemo(
    () => serverIdeas.map((i) => (flags[i.id] ? { ...i, ...flags[i.id] } : i)),
    [serverIdeas, flags],
  );
  const dupTitles = useMemo(() => new Map(serverIdeas.map((i) => [i.id, i.summary ?? i.url ?? ""] as [string, string])), [serverIdeas]);
  useEffect(() => setOrder(null), [serverFolders]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  const folders = useMemo(() => {
    const fs = sortFolders(serverFolders);
    if (!order) return fs;
    return order.map((id) => fs.find((f) => f.id === id)).filter((f): f is Folder => !!f);
  }, [serverFolders, order]);
  const folderOf = (i: Idea) => (i.id in moved ? moved[i.id] : i.folder_id) ?? null;
  const known = new Set(folders.map((f) => f.id));
  const inFolder = (i: Idea, f: string) => {
    const fid = folderOf(i);
    return f === NONE ? !fid || !known.has(fid) : fid === f;
  };
  const current = folders.find((f) => f.id === folder) ?? null;
  // 資料夾被刪掉（或網址過期）就回到全部
  const activeFolder = folder === NONE || current ? folder : "";

  // 從通知的「查看」等連結切換資料夾時跟著網址走
  const sp = useSearchParams();
  const urlFolder = sp.get("folder") ?? "";
  useEffect(() => setFolderState(urlFolder), [urlFolder]);

  const setFolder = (f: string) => {
    setFolderState(f);
    setParam("folder", f);
  };

  // 打開的面板顯示最新資料（存補充、改分類後會自動更新）；被刪除就自動關閉
  const opened = openId ? ideas.find((i) => i.id === openId) ?? null : null;

  const isWeek = (i: Idea) => now - new Date(i.created_at).getTime() <= WEEK_MS;
  const stats = useMemo(
    () => ({
      total: ideas.length,
      week: ideas.filter(isWeek).length,
      todo: ideas.filter((i) => i.status === "needs_input" || i.status === "failed").length,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ideas, now],
  );
  const counts = useMemo(() => {
    const c: Record<string, number> = { [NONE]: 0 };
    for (const i of ideas) {
      const fid = folderOf(i);
      const k = fid && known.has(fid) ? fid : NONE;
      c[k] = (c[k] ?? 0) + 1;
    }
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ideas, moved, folders]);
  const briefCount = ideas.filter((i) => i.in_brief).length;
  // 最上面那排重點數字與右欄（電腦版）
  const ins = useMemo(() => ideaInsights(ideas, now), [ideas, now]);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = ideas.filter((i) => {
      if (activeFolder && !inFolder(i, activeFolder)) return false;
      if (view === "week" && !isWeek(i)) return false;
      if (view === "todo" && !["needs_input", "failed", "pending"].includes(i.status)) return false;
      if (view === "adopted" && !i.adopted) return false;
      if (view === "brief" && !i.in_brief) return false;
      if (!matchFilters(i, filters)) return false;
      if (needle) {
        const d = i.design ?? {};
        const hay = [i.summary, i.content, i.note, i.author, ...(i.tags ?? []), ...(d.styles ?? []), ...(d.learn ?? [])].join(" ").toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    out = [...out].sort((a, b) =>
      sort === "new"
        ? b.created_at.localeCompare(a.created_at)
        : (b.score_total ?? -1) - (a.score_total ?? -1) || b.created_at.localeCompare(a.created_at),
    );
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ideas, view, q, sort, now, activeFolder, moved, folders, filters]);

  // ---------- 搬移與排序 ----------

  const folderName = (id: string | null) => (id ? folders.find((f) => f.id === id)?.name : null) ?? L("未分類", "Unfiled");

  const move = async (ids: string[], target: string | null) => {
    const todo = ids.filter((id) => {
      const i = ideas.find((x) => x.id === id);
      return i && folderOf(i) !== target;
    });
    if (!todo.length) return;
    setMoved((m) => ({ ...m, ...Object.fromEntries(todo.map((id) => [id, target])) }));
    setSelected(new Set());
    setSelecting(false);
    const r = await moveIdeas(todo, target ?? "").catch(() => ({ ok: false }));
    if (r.ok) {
      setNotice({ text: L(`已把 ${todo.length} 則搬到「${folderName(target)}」`, `Moved ${todo.length} to “${folderName(target)}”`) });
    } else {
      setMoved((m) => {
        const n = { ...m };
        for (const id of todo) delete n[id];
        return n;
      });
      setNotice({ text: L("搬移失敗，請再試一次", "Couldn’t move — please try again"), bad: true });
    }
  };

  const toggleFlag = async (id: string, key: FlagKey, to: boolean) => {
    setFlags((f) => ({ ...f, [id]: { ...f[id], [key]: to } }));
    const r = await (key === "adopted" ? toggleAdopted(id, to) : toggleBrief(id, to)).catch(() => ({ ok: false }));
    if (r.ok) {
      setNotice({
        text: key === "adopted"
          ? (to ? L("已標記為採用", "Marked as adopted") : L("已取消採用", "Unadopted"))
          : (to ? L("已加入設計簡報", "Added to the brief") : L("已移出設計簡報", "Removed from the brief")),
      });
    } else {
      setFlags((f) => ({ ...f, [id]: { ...f[id], [key]: !to } }));
      setNotice({ text: L("沒有存成功，已改回來，請再試一次", "Couldn’t save — reverted, please try again"), bad: true });
    }
  };

  const reorderTo = async (id: string, targetId: string) => {
    const next = reorder(folders.map((f) => f.id), id, targetId);
    if (next.join() === folders.map((f) => f.id).join()) return;
    setOrder(next);
    await reorderFolders(next).catch(() => setOrder(null));
  };

  const toggleSelect = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const extraFor = (i: Idea): CardExtra => ({
    className: `${dragging.includes(i.id) ? "dragging" : ""} ${selected.has(i.id) ? "selected" : ""} ${selecting ? "selecting" : ""}`,
    li: foldersReady
      ? {
          draggable: true,
          onDragStart: (e) => {
            // 拖曳已勾選的其中一張 → 一起搬；否則只搬這一張
            const ids = selected.has(i.id) ? [...selected] : [i.id];
            e.dataTransfer.setData(DRAG_IDEAS, JSON.stringify(ids));
            e.dataTransfer.effectAllowed = "move";
            setDragImage(e, ids.length > 1 ? L(`${ids.length} 則點子`, `${ids.length} ideas`) : (i.summary ?? i.content ?? i.url ?? "").slice(0, 18));
            setDragging(ids);
          },
          onDragEnd: () => setDragging([]),
          onContextMenu: (e) => {
            // 在連結、輸入框上按右鍵保留瀏覽器原本的選單
            if ((e.target as HTMLElement).closest("a, input, textarea, select")) return;
            e.preventDefault();
            setCardMenu({ x: e.clientX, y: e.clientY, id: i.id });
          },
        }
      : undefined,
    check: selecting ? (
      <label className="pick-box" onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" checked={selected.has(i.id)} onChange={() => toggleSelect(i.id)} aria-label={L("選取這則", "Select")} />
      </label>
    ) : null,
  });

  const projectNames = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects]);
  const title = activeFolder === NONE ? L("未分類", "Unfiled") : current ? current.name : L("點子庫", "Ideas");
  const lang = useLang();

  // 有已採用、也有其他的時候才分兩區
  const split = splitAdopted(list);
  const sections: { key: string; title: string | null; items: Idea[] }[] =
    split.adopted.length && split.rest.length && view !== "adopted" && filters.adopt !== "yes"
      ? [
          { key: "adopted", title: L("已採用", "Adopted"), items: split.adopted },
          { key: "rest", title: L("其他點子", "Other ideas"), items: split.rest },
        ]
      : [{ key: "all", title: null, items: list }];
  const gridKey = `${view}-${activeFolder}-${sort}-${filters.adopt}${filters.project}${filters.min}${filters.cat}`;
  const renderItems = (items: Idea[], part: string) =>
    // 已採用的那一區只顯示一行（分類、標題、分數），點標題看細節
    part === "adopted" ? (
      <ul className="adopted-mini-list stagger" key={`${gridKey}-${part}-mini`}>
        {items.map((i) => <AdoptedMini key={i.id} idea={i} onOpen={() => setOpenId(i.id)} extra={extraFor(i)} />)}
      </ul>
    ) : layout === "grid" ? (
      <ul className="ideas stagger" key={`${gridKey}-${part}-grid`}>
        {items.map((i) =>
          isDesign(i.category) ? (
            <DesignCard key={i.id} idea={i} img={i.image_path ? urls[i.image_path] : undefined} now={now} onOpen={() => setOpenId(i.id)} extra={extraFor(i)} />
          ) : (
            <IdeaCard key={i.id} idea={i} fresh={now - Date.parse(i.created_at) < 86_400_000} onOpen={() => setOpenId(i.id)} extra={extraFor(i)} />
          ),
        )}
      </ul>
    ) : (
      <ul className="idea-rows stagger" key={`${gridKey}-${part}-list`}>
        {items.map((i) =>
          isDesign(i.category) ? (
            <DesignRow key={i.id} idea={i} img={i.image_path ? urls[i.image_path] : undefined} onOpen={() => setOpenId(i.id)} extra={extraFor(i)} />
          ) : (
            <IdeaRow key={i.id} idea={i} onOpen={() => setOpenId(i.id)} extra={extraFor(i)} />
          ),
        )}
      </ul>
    );

  return (
    <ProjectNames.Provider value={projectNames}>
    <DupTitles.Provider value={dupTitles}>
    <FlagToggle.Provider value={toggleFlag}>
      {/* 電腦版：重點數字卡；手機版照舊用下面的標題列 */}
      <KpiRow label={L("重點數字", "Key numbers")}>
        <Kpi
          pop
          label={L("本週新點子", "New this week")}
          value={ins.week}
          hint={<><Delta now={ins.week} prev={ins.lastWeek} flat={L("跟上週一樣", "Same as last week")} />{ins.week !== ins.lastWeek ? L(" 比上週", " vs last week") : ""}</>}
          data={ins.weekly}
        />
        <Kpi label={L("已採用", "Adopted")} value={ins.adopted} hint={L(`全部 ${stats.total} 則`, `of ${stats.total}`)} />
        <Kpi
          label={L("平均綜合分數", "Average score")}
          value={ins.avgScore ?? "—"}
          hint={ins.top ? L(`最高 ${ins.top.score}：${ins.top.title}`, `Top ${ins.top.score}: ${ins.top.title}`) : L("還沒有分析好的點子", "Nothing analyzed yet")}
        />
        <Kpi
          tone={stats.todo + ins.dups ? "warn" : ""}
          label={L("等你處理", "Needs you")}
          value={stats.todo + ins.dups}
          hint={L(`待補充 ${stats.todo}・可能重複 ${ins.dups}`, `${stats.todo} need input · ${ins.dups} possible dups`)}
        />
      </KpiRow>
      {(view !== "all" || activeFolder || q.trim() || hasFilters(filters) || briefCount > 0) && (
        <div className="view-line d-only">
          {(view !== "all" || activeFolder || q.trim() || hasFilters(filters)) && (
            <>
              <h2>{activeFolder ? title : L(...VIEW_LABEL[view])}</h2>
              <span className="muted small">
                {L(`${list.length} 則`, `${list.length} ideas`)}
                {q.trim() ? L(`・搜尋「${q.trim()}」`, ` · “${q.trim()}”`) : ""}
              </span>
            </>
          )}
          {briefCount ? (
            <Link href="/design/brief" className="btn primary small push">{L(`產生設計簡報（${briefCount}）`, `Build design brief (${briefCount})`)}</Link>
          ) : null}
        </div>
      )}
      <div className="page-title with-action m-only">
        <div>
          <h1>{title}</h1>
          <p className="muted title-stats">
            <span>{L(`共 ${stats.total} 則`, `${stats.total} total`)}</span>
            <span>{L(`本週 ${stats.week}`, `${stats.week} this week`)}</span>
            <Link href="/?view=todo" className={stats.todo ? "warn-text" : ""}>{L(`待補充 ${stats.todo}`, `${stats.todo} need input`)}</Link>
            {(view !== "all" || activeFolder || q.trim() || hasFilters(filters)) && (
              <span>
                {(() => {
                  const label = view === "all" && hasFilters(filters) ? L("篩選結果", "Filtered") : L(...VIEW_LABEL[view]);
                  return L(`目前：${label} ${list.length} 則`, `Showing: ${label} · ${list.length}`);
                })()}
                {q.trim() ? L(`・搜尋「${q.trim()}」`, ` · “${q.trim()}”`) : ""}
              </span>
            )}
          </p>
        </div>
        <div className="title-actions">
          {briefCount ? (
            <Link href="/design/brief" className="btn primary">{L(`產生設計簡報（${briefCount}）`, `Build design brief (${briefCount})`)}</Link>
          ) : null}
        </div>
      </div>

      {foldersReady ? (
        <FolderGrid
          folders={folders}
          counts={counts}
          total={ideas.length}
          active={activeFolder}
          onPick={setFolder}
          onDropIdeas={move}
          onReorder={reorderTo}
          onDeleted={(id) => id === activeFolder && setFolder("")}
          onError={(text) => setNotice({ text, bad: true })}
        />
      ) : (
        <p className="error">{L("資料夾功能需要先在 ideabox 的 Supabase 執行 migration-010-folders.sql。", "Folders need migration-010-folders.sql to be run on the ideabox Supabase first.")}</p>
      )}

      <AddIdeaForm
        compact
        folders={folders}
        projects={projects}
        placeholder={L("貼上 Threads／Instagram／GitHub 連結（可多個），或直接寫下想法…", "Paste Threads / Instagram / GitHub links (several OK), or just type an idea…")}
      />

      {/* 搜尋與篩選即時生效，不用按按鈕 */}
      <div className="filters ideas-filters glass" role="search">
        <label className="search-field">
          <IconSearch size={16} />
          <input
            id="search"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setParam("q", e.target.value.trim());
            }}
            placeholder={L("搜尋摘要、內容、補充…", "Search summaries, content, notes…")}
          />
        </label>
        <select
          value={sort}
          aria-label={L("排序", "Sort")}
          onChange={(e) => {
            setSort(e.target.value);
            setParam("sort", e.target.value === "score" ? "" : e.target.value);
          }}
        >
          <option value="score">{L("依分數", "By score")}</option>
          <option value="new">{L("依時間", "Newest")}</option>
        </select>
        <select value={filters.adopt} aria-label={L("採用狀態", "Adoption")} className={filters.adopt ? "on" : ""} onChange={(e) => setFilter("adopt", e.target.value as IdeaFilters["adopt"])}>
          <option value="">{L("採用：全部", "Adopted: all")}</option>
          <option value="yes">{L("只看已採用", "Adopted only")}</option>
          <option value="no">{L("只看未採用", "Not adopted")}</option>
        </select>
        {projects.length > 0 && (
          <select value={filters.project} aria-label={L("專案", "Project")} className={filters.project ? "on" : ""} onChange={(e) => setFilter("project", e.target.value)}>
            <option value="">{L("專案：全部", "Project: all")}</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            <option value={NO_PROJECT}>{L("沒指定專案", "No project")}</option>
          </select>
        )}
        <select value={filters.min || ""} aria-label={L("分數", "Score")} className={filters.min ? "on" : ""} onChange={(e) => setFilter("min", Number(e.target.value) || 0)}>
          <option value="">{L("分數：不限", "Score: any")}</option>
          {MIN_SCORES.map((n) => <option key={n} value={n}>{L(`${n} 分以上`, `${n}+`)}</option>)}
        </select>
        <select value={filters.cat} aria-label={L("分類", "Category")} className={filters.cat ? "on" : ""} onChange={(e) => setFilter("cat", e.target.value)}>
          <option value="">{L("分類：全部", "Category: all")}</option>
          {catOptions(lang).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
        {hasFilters(filters) && (
          <button type="button" className="btn ghost small" onClick={clearFilters}>{L("清除篩選", "Clear filters")}</button>
        )}
        {foldersReady && (
          <button
            type="button"
            className={`btn small ${selecting ? "primary" : "ghost"}`}
            aria-pressed={selecting}
            onClick={() => {
              setSelecting(!selecting);
              setSelected(new Set());
            }}
          >
            {selecting ? L("完成", "Done") : L("選取", "Select")}
          </button>
        )}
        <LayoutToggle layout={layout} onChange={setLayout} />
      </div>

      {/* 左邊是點子，右邊一欄是概況（電腦版） */}
      <div className="page-split">
      <div className="page-main">
      {!list.length && (
        <div className="glass empty">
          {view === "brief"
            ? L("還沒有選入簡報的設計。在設計卡片上按「加入簡報」。", "Nothing in the brief yet. Tap “Add to brief” on a design card.")
            : view === "all" && !q && !activeFolder && !hasFilters(filters)
              ? L("這裡還沒有點子。到 Telegram 把 Threads 貼文分享給 Bot，或用上面的框框新增。", "No ideas yet. Share a Threads post with the Telegram bot, or add one in the box above.")
              : activeFolder && view === "all" && !q && !hasFilters(filters)
                ? L("這個資料夾是空的。把點子拖到上面的資料夾就能搬進來。", "This folder is empty. Drag ideas onto a folder above to move them.")
                : hasFilters(filters)
                  ? <>{L("這些篩選條件下沒有點子。", "No ideas match these filters.")} <button type="button" className="btn ghost small" onClick={clearFilters}>{L("清除篩選", "Clear filters")}</button></>
                  : L("這個檢視下沒有點子。", "No ideas in this view.")}
        </div>
      )}

      {/* 已採用的放最上面一區（只看已採用時不用分區）；key 讓切換檢視時卡片重新播放進場動畫（搜尋打字、搬移時不重播） */}
      {sections.map((sec) => (
        <section key={sec.key} className="idea-section">
          {sec.title && (
            <h2 className="idea-section-title">
              {sec.key === "adopted" ? (
                <button type="button" className="idea-section-toggle" onClick={toggleAdoptedOpen} aria-expanded={adoptedOpen}>
                  <span className="office-chevron" aria-hidden>{adoptedOpen ? "▾" : "▸"}</span>
                  {sec.title} <span className="muted">{sec.items.length}</span>
                </button>
              ) : (
                <>{sec.title} <span className="muted">{sec.items.length}</span></>
              )}
            </h2>
          )}
          {(sec.key !== "adopted" || adoptedOpen) && renderItems(sec.items, sec.key)}
        </section>
      ))}
      </div>
      <aside className="page-aside d-only" aria-label={L("點子概況", "Idea overview")}>
        <SidePanel title={L("分類分佈", "By category")}>
          {ins.cats.length ? ins.cats.map((c) => <BarRow key={c.cat ?? "none"} label={catLabel(c.cat, lang)} n={c.n} max={ins.cats[0].n} />) : <p className="muted small">{L("還沒有點子", "No ideas yet")}</p>}
        </SidePanel>
        <SidePanel title={L("從哪裡收進來", "Where they came from")}>
          {ins.sources.length ? ins.sources.map((s) => (
            <div className="side-row" key={s.source}>
              <span className="grow">{L(...SOURCE_LABEL[s.source])}</span>
              <b>{s.n}</b>
            </div>
          )) : <p className="muted small">{L("還沒有點子", "No ideas yet")}</p>}
        </SidePanel>
        {ins.nudge && (
          <SidePanel className="nudge" title={L("提醒", "Reminder")}>
            <p>{L(`「${ins.nudge.title}」已經存了 ${ins.nudge.days} 天，要不要動手？`, `“${ins.nudge.title}” has been sitting for ${ins.nudge.days} days — time to act?`)}</p>
            <button type="button" className="btn small" onClick={() => setOpenId(ins.nudge!.id)}>{L("打開這個點子", "Open this idea")}</button>
          </SidePanel>
        )}
      </aside>
      </div>

      <DetailPanel open={!!opened} onClose={() => setOpenId(null)} title={opened?.summary ?? L("點子內容", "Idea")} url={opened?.url}>
        {opened && (
          <>
            {(() => {
              // 資料夾與專案：放在詳情裡（標籤下面），兩個並排
              const picks = (foldersReady || projects.length > 0) && (
                <div className="detail-picks">
                {foldersReady && (
                  <label className="folder-pick">
                    <span className="muted small">{L("資料夾", "Folder")}</span>
                    <select value={folderOf(opened) ?? ""} onChange={(e) => move([opened.id], e.target.value || null)}>
                      <option value="">{L("未分類", "Unfiled")}</option>
                      {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                    </select>
                  </label>
                )}
                {projects.length > 0 && (
                  <label className="folder-pick">
                    <span className="muted small">{L("專案", "Project")}</span>
                    <select
                      value={opened.project_id ?? ""}
                      disabled={projectBusy}
                      onChange={async (e) => {
                        setProjectBusy(true);
                        setNotice({ text: L("針對新專案重新分析中…", "Re-analyzing for the new project…") });
                        const r = await setIdeaProject(opened.id, e.target.value).catch(() => ({ ok: false, error: undefined }));
                        setProjectBusy(false);
                        setNotice(r.ok ? { text: L("已重新分析", "Re-analyzed") } : { text: r.error ?? L("沒有改成功", "Couldn’t change it"), bad: true });
                      }}
                    >
                      <option value="">{L("不指定（看最相關的專案）", "None (closest project)")}</option>
                      {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </label>
                )}
                </div>
              );
              return isDesign(opened.category) ? (
                <DesignDetail idea={opened} img={opened.image_path ? urls[opened.image_path] : undefined} now={now} picks={picks} />
              ) : (
                <IdeaDetail idea={opened} picks={picks} />
              );
            })()}
          </>
        )}
      </DetailPanel>


      {cardMenu && (() => {
        const i = ideas.find((x) => x.id === cardMenu.id);
        if (!i) return null;
        const fid = folderOf(i);
        const form = () => {
          const fd = new FormData();
          fd.set("id", i.id);
          return fd;
        };
        const run = (fn: () => Promise<unknown>) => async () => {
          setCardMenu(null);
          await fn().catch(() => setNotice({ text: L("操作失敗，請再試一次", "Something went wrong — please try again"), bad: true }));
        };
        return (
          <ContextMenu x={cardMenu.x} y={cardMenu.y} onClose={closeCardMenu} label={L("點子選項", "Idea options")}>
            <p className="ctx-title">{(i.summary ?? i.content ?? i.url ?? "").slice(0, 28)}</p>
            <button type="button" role="menuitem" onClick={() => { setCardMenu(null); setOpenId(i.id); }}>{L("打開內容", "Open")}</button>
            <p className="ctx-sub">{L("搬到", "Move to")}</p>
            <div className="ctx-scroll">
              {folders.map((f) => (
                <button key={f.id} type="button" role="menuitem" className={fid === f.id ? "on" : ""} onClick={run(() => move([i.id], f.id))}>
                  <span className="ctx-dot" style={{ background: folderColor(f.color) }} />
                  {f.name}
                  {fid === f.id && <span className="ctx-check">✓</span>}
                </button>
              ))}
              <button type="button" role="menuitem" className={!fid || !known.has(fid) ? "on" : ""} onClick={run(() => move([i.id], null))}>
                <span className="ctx-dot" />
                {L("未分類", "Unfiled")}
              </button>
            </div>
            <hr />
            <button type="button" role="menuitem" onClick={() => { setCardMenu(null); toggleFlag(i.id, "adopted", !i.adopted); }}>{i.adopted ? L("取消採用", "Unadopt") : L("標記已採用", "Mark adopted")}</button>
            {isDesign(i.category) && (
              <button type="button" role="menuitem" onClick={() => { setCardMenu(null); toggleFlag(i.id, "in_brief", !i.in_brief); }}>{i.in_brief ? L("移出設計簡報", "Remove from brief") : L("加入設計簡報", "Add to brief")}</button>
            )}
            <button
              type="button"
              role="menuitem"
              className="danger"
              onClick={run(async () => {
                if (window.confirm(L("確定刪除這則點子？", "Delete this idea?"))) await deleteIdea(form());
              })}
            >
              {L("刪除", "Delete")}
            </button>
          </ContextMenu>
        );
      })()}

      {/* 勾選後的搬移列；放到 body 底下，頁面進場動畫的 transform 會讓 fixed 定位跑掉 */}
      {selecting && typeof document !== "undefined" && createPortal(
        <div className="folder-bulk-bar glass" role="toolbar" aria-label={L("批次搬移", "Bulk move")}>
          <b>{L(`已選 ${selected.size} 則`, `${selected.size} selected`)}</b>
          <button type="button" className="btn ghost small" onClick={() => setSelected(new Set(list.map((i) => i.id)))}>{L("全選", "Select all")}</button>
          <select
            value=""
            disabled={!selected.size}
            aria-label={L("搬到資料夾", "Move to folder")}
            onChange={(e) => e.target.value && move([...selected], e.target.value === NONE ? null : e.target.value)}
          >
            <option value="">{L("搬到…", "Move to…")}</option>
            {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            <option value={NONE}>{L("未分類", "Unfiled")}</option>
          </select>
          <button type="button" className="btn ghost small" onClick={() => { setSelecting(false); setSelected(new Set()); }}>{L("取消", "Cancel")}</button>
        </div>,
        document.body,
      )}

      {notice && typeof document !== "undefined" && createPortal(
        <div className={`toast glass ${notice.bad ? "bad" : "ok"}`} role="status" aria-live="polite">
          <span className="toast-icon" aria-hidden>{notice.bad ? "!" : "✓"}</span>
          <div className="toast-body"><b>{notice.text}</b></div>
          <button type="button" className="toast-close" aria-label={L("關閉通知", "Dismiss")} onClick={() => setNotice(null)}>×</button>
        </div>,
        document.body,
      )}
    </FlagToggle.Provider>
    </DupTitles.Provider>
    </ProjectNames.Provider>
  );
}

// ---------- 資料夾 ----------

/** 資料夾圖示（顏色跟著資料夾設定） */
function FolderIcon({ color, open = false }: { color: string; open?: boolean }) {
  return (
    <svg className="folder-svg" viewBox="0 0 64 52" aria-hidden style={{ color }}>
      <path d="M4 8a4 4 0 0 1 4-4h15l6 6h27a4 4 0 0 1 4 4v4H4z" fill="currentColor" opacity=".7" />
      <path
        d={open ? "M2 20a3 3 0 0 1 3-3h56a3 3 0 0 1 3 3l-4 26a4 4 0 0 1-4 3H8a4 4 0 0 1-4-3z" : "M4 16a3 3 0 0 1 3-3h50a3 3 0 0 1 3 3v29a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z"}
        fill="currentColor"
      />
      <path d="M8 22h48" stroke="#fff" strokeOpacity=".25" strokeWidth="2" />
    </svg>
  );
}

type FolderMenu = { x: number; y: number; folder: Folder };

function FolderGrid({
  folders,
  counts,
  total,
  active,
  onPick,
  onDropIdeas,
  onReorder,
  onDeleted,
  onError,
}: {
  folders: Folder[];
  counts: Record<string, number>;
  total: number;
  active: string;
  onPick: (f: string) => void;
  onDropIdeas: (ids: string[], folderId: string | null) => void;
  onReorder: (id: string, targetId: string) => void;
  onDeleted: (id: string) => void;
  onError: (msg: string) => void;
}) {
  const L = useL();
  const [over, setOver] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const newName = useRef<HTMLInputElement>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<FolderMenu | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

  // target：資料夾 id；NONE = 未分類（只能放點子，不能排序）
  const dropProps = (target: string) => ({
    onDragOver: (e: DragEvent) => {
      const t = e.dataTransfer.types;
      if (!t.includes(DRAG_IDEAS) && !(t.includes(DRAG_FOLDER) && target !== NONE)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (over !== target) setOver(target);
    },
    onDragLeave: (e: DragEvent) => {
      // 移到圖示裡的文字上不算離開
      if (e.currentTarget.contains(e.relatedTarget as Node)) return;
      setOver((o) => (o === target ? null : o));
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      setOver(null);
      const ideasRaw = e.dataTransfer.getData(DRAG_IDEAS);
      const folderId = e.dataTransfer.getData(DRAG_FOLDER);
      if (ideasRaw) {
        try {
          const ids = JSON.parse(ideasRaw) as string[];
          if (Array.isArray(ids)) onDropIdeas(ids, target === NONE ? null : target);
        } catch {
          /* 不是我們的拖曳資料 */
        }
      } else if (folderId && target !== NONE) onReorder(folderId, target);
    },
  });

  const openMenu = (e: { clientX: number; clientY: number; preventDefault: () => void }, f: Folder) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, folder: f });
  };

  const rename = async (f: Folder, name: string) => {
    setRenaming(null);
    if (!name.trim() || name.trim() === f.name) return;
    const r = await renameFolder(f.id, name);
    if (!r.ok) onError(r.error ?? L("改名失敗", "Couldn’t rename"));
  };

  return (
    <>
      <nav className="folder-grid" aria-label={L("資料夾", "Folders")}>
        <button type="button" className={`folder-tile ${active === "" ? "active" : ""}`} aria-pressed={active === ""} onClick={() => onPick("")}>
          <span className="folder-art all"><IconGrid size={30} /></span>
          <span className="folder-name">{L("全部", "All")}</span>
          <span className="folder-count">{total}</span>
        </button>

        {folders.map((f) => (
          <div
            key={f.id}
            role="button"
            tabIndex={0}
            draggable={renaming !== f.id}
            onDragStart={(e) => {
              e.dataTransfer.setData(DRAG_FOLDER, f.id);
              e.dataTransfer.effectAllowed = "move";
            }}
            {...dropProps(f.id)}
            onContextMenu={(e) => openMenu(e, f)}
            onClick={() => renaming !== f.id && onPick(f.id)}
            onKeyDown={(e) => {
              if (renaming === f.id) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onPick(f.id);
              }
              if (e.key === "F2") setRenaming(f.id);
            }}
            className={`folder-tile ${active === f.id ? "active" : ""} ${over === f.id ? "over" : ""}`}
            aria-pressed={active === f.id}
            title={L("點一下打開；把點子拖進來就會搬過去；右鍵可改名、換顏色、刪除", "Click to open · drop ideas to move them · right-click to rename, recolor or delete")}
          >
            <span className="folder-art"><FolderIcon color={folderColor(f.color)} open={over === f.id} /></span>
            {renaming === f.id ? (
              <input
                className="folder-rename"
                defaultValue={f.name}
                maxLength={20}
                autoFocus
                onFocus={(e) => e.currentTarget.select()}
                onClick={(e) => e.stopPropagation()}
                onBlur={(e) => rename(f, e.currentTarget.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") e.currentTarget.blur();
                  if (e.key === "Escape") setRenaming(null);
                }}
                aria-label={L("資料夾名稱", "Folder name")}
              />
            ) : (
              <span className="folder-name">{f.name}</span>
            )}
            <span className="folder-count">{counts[f.id] ?? 0}</span>
            {/* 手機沒有右鍵：用這顆按鈕叫出同一個選單 */}
            <button
              type="button"
              className="folder-more"
              aria-label={L(`「${f.name}」的選項`, `Options for “${f.name}”`)}
              onClick={(e) => {
                e.stopPropagation();
                const r = e.currentTarget.getBoundingClientRect();
                setMenu({ x: r.left, y: r.bottom + 4, folder: f });
              }}
            >
              ⋯
            </button>
          </div>
        ))}

        {(counts[NONE] > 0 || active === NONE) && (
          <button
            type="button"
            {...dropProps(NONE)}
            className={`folder-tile unfiled ${active === NONE ? "active" : ""} ${over === NONE ? "over" : ""}`}
            aria-pressed={active === NONE}
            onClick={() => onPick(NONE)}
          >
            <span className="folder-art"><FolderIcon color="var(--muted, #94a3b8)" open={over === NONE} /></span>
            <span className="folder-name">{L("未分類", "Unfiled")}</span>
            <span className="folder-count">{counts[NONE]}</span>
          </button>
        )}

        {adding ? (
          <form
            className="folder-tile adding"
            action={async (fd) => {
              const name = String(fd.get("name") ?? "");
              const r = await createFolder(name);
              if (r.ok) setAdding(false);
              else {
                onError(r.error ?? L("新增失敗", "Couldn’t add"));
                // React 送出後會清空輸入框；沒成功就把名稱放回去
                requestAnimationFrame(() => {
                  if (newName.current) newName.current.value = name;
                });
              }
            }}
          >
            <span className="folder-art"><FolderIcon color="var(--accent)" /></span>
            <input
              name="name"
              ref={newName}
              className="folder-rename"
              autoFocus
              maxLength={20}
              placeholder={L("資料夾名稱", "Folder name")}
              onKeyDown={(e) => e.key === "Escape" && setAdding(false)}
              onBlur={(e) => !e.currentTarget.value.trim() && setAdding(false)}
            />
          </form>
        ) : (
          <button type="button" className="folder-tile add" onClick={() => setAdding(true)}>
            <span className="folder-art add-art" aria-hidden>＋</span>
            <span className="folder-name">{L("新資料夾", "New folder")}</span>
          </button>
        )}
      </nav>

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} onClose={closeMenu} label={L(`「${menu.folder.name}」的選項`, `Options for “${menu.folder.name}”`)}>
          <p className="ctx-title">📁 {menu.folder.name}</p>
          <button type="button" role="menuitem" onClick={() => { setRenaming(menu.folder.id); setMenu(null); }}>{L("改名", "Rename")}</button>
          <div className="ctx-colors" role="group" aria-label={L("換顏色", "Color")}>
            <button
              type="button"
              className={`color-pick default ${!menu.folder.color ? "on" : ""}`}
              title={L("跟著主題", "Theme color")}
              aria-label={L("跟著主題", "Theme color")}
              onClick={async () => {
                setMenu(null);
                const r = await setFolderColor(menu.folder.id, "");
                if (!r.ok) onError(r.error ?? L("換顏色失敗", "Couldn’t change color"));
              }}
            />
            {Object.entries(FOLDER_COLORS).map(([k, c]) => (
              <button
                key={k}
                type="button"
                className={`color-pick ${menu.folder.color === k ? "on" : ""}`}
                style={{ background: c }}
                aria-label={k}
                onClick={async () => {
                  setMenu(null);
                  const r = await setFolderColor(menu.folder.id, k);
                  if (!r.ok) onError(r.error ?? L("換顏色失敗", "Couldn’t change color"));
                }}
              />
            ))}
          </div>
          <button
            type="button"
            role="menuitem"
            className="danger"
            onClick={async () => {
              const f = menu.folder;
              setMenu(null);
              if (!window.confirm(L(`確定刪除「${f.name}」？裡面的點子不會刪除，會移到「未分類」。`, `Delete “${f.name}”? The ideas inside stay and move to Unfiled.`))) return;
              const r = await deleteFolder(f.id);
              if (r.ok) onDeleted(f.id);
              else onError(r.error ?? L("刪除失敗", "Couldn’t delete"));
            }}
          >
            {L("刪除資料夾", "Delete folder")}
          </button>
        </ContextMenu>
      )}
    </>
  );
}

const STATUS_LABEL: Record<Idea["status"], [string, string]> = {
  pending: ["分析中", "Analyzing"],
  needs_input: ["待補充", "Needs input"],
  analyzed: ["", ""],
  failed: ["分析失敗", "Analysis failed"],
};
const statusText = (L: Translate, s: Idea["status"]) => L(...STATUS_LABEL[s]);

function titleOf(i: Idea, L: Translate) {
  return i.summary ?? (i.content ? i.content.slice(0, 120) : i.url) ?? L("（沒有內容）", "(no content)");
}
const catOptions = (lang: "zh" | "en") => CATEGORIES.map((c) => [c, catLabel(c, lang)] as [string, string]);

/** 點子卡片（精簡版）：分類、專案、標題、綜合分數、下一步；理由、三項分數、標籤、原文都在點開的面板裡 */
function IdeaCard({ idea: i, fresh = false, onOpen, extra }: { idea: Idea; fresh?: boolean; onOpen: () => void; extra?: CardExtra }) {
  const L = useL();
  const lang = useLang();
  const toggleFlag = useFlagToggle();
  const project = useContext(ProjectNames).get(i.project_id ?? "");
  const date = taipeiShort(i.created_at, false);
  return (
    <li {...extra?.li} className={`glass idea idea-lite lift ${i.adopted ? "adopted" : ""} ${extra?.className ?? ""}`} data-fresh={fresh || undefined}>
      {extra?.check}
      <div className="idea-head">
        <form action={setCategory} className="inline">
          <input type="hidden" name="id" value={i.id} />
          <AutoSelect name="category" defaultValue={i.category ?? "other"} options={catOptions(lang)} />
        </form>
        {project && <span className="idea-project">{project}</span>}
        {i.status !== "analyzed" && <span className={`badge ${i.status}`}>{statusText(L, i.status)}</span>}
        <span className="muted small push">{date}</span>
        <SourceButton url={i.url} />
      </div>

      <div className="idea-main">
        <button type="button" className="title-btn summary idea-lite-title" onClick={onOpen} title={L("看完整內容", "Open details")}>
          {titleOf(i, L)}
        </button>
        {i.score_total !== null && (
          <span className={`idea-score ${i.score_total >= 8 ? "hi" : i.score_total >= 6 ? "mid" : "lo"}`} aria-label={L(`綜合分數 ${i.score_total}`, `Overall score ${i.score_total}`)}>
            {i.score_total}
          </span>
        )}
      </div>

      {i.next_step && <p className="next idea-lite-next">👉 {i.next_step}</p>}
      <DupNotice idea={i} />

      <div className="idea-lite-foot">
        <button
          type="button"
          aria-pressed={!!i.adopted}
          onClick={() => toggleFlag(i.id, "adopted", !i.adopted)}
          className={`btn small adopt-btn ${i.adopted ? "on" : ""}`}
          title={i.adopted ? L("點一下取消採用", "Click to unadopt") : L("點一下標記已採用", "Click to mark as adopted")}
        >
          {i.adopted ? L("✓ 已採用", "✓ Adopted") : L("＋ 標記採用", "+ Adopt")}
        </button>
        <button type="button" className="btn ghost small" onClick={onOpen}>{L("看細節", "Details")} →</button>
      </div>
    </li>
  );
}

/** 已採用區的一行：分類、標題（超過就截斷）、分數、取消採用 */
function AdoptedMini({ idea: i, onOpen, extra }: { idea: Idea; onOpen: () => void; extra?: CardExtra }) {
  const L = useL();
  const lang = useLang();
  const toggleFlag = useFlagToggle();
  return (
    <li {...extra?.li} className={`glass adopted-mini ${extra?.className ?? ""}`}>
      {extra?.check}
      <span className="row-cat">{catLabel(i.category, lang)}</span>
      <button type="button" className="title-btn adopted-mini-title" onClick={onOpen} title={titleOf(i, L)}>
        {titleOf(i, L)}
      </button>
      {i.score_total !== null && <span className="adopted-mini-score">{i.score_total}</span>}
      <button
        type="button"
        aria-pressed
        className="adopt-tag on"
        onClick={() => toggleFlag(i.id, "adopted", false)}
        title={L("點一下取消採用", "Click to unadopt")}
      >
        ✓
      </button>
    </li>
  );
}

/** 標記已採用／取消採用（畫面先切換，背景再存） */
function AdoptButton({ idea: i, className }: { idea: Idea; className: string }) {
  const L = useL();
  const toggle = useFlagToggle();
  return (
    <button type="button" className={className} aria-pressed={!!i.adopted} onClick={() => toggle(i.id, "adopted", !i.adopted)}>
      {i.adopted ? L("取消採用", "Unadopt") : L("標記已採用", "Mark adopted")}
    </button>
  );
}

/** 列表模式的一列：分類、摘要（點開看內容）、下一步、綜合分數、原文 */
function IdeaRow({ idea: i, onOpen, extra }: { idea: Idea; onOpen: () => void; extra?: CardExtra }) {
  const L = useL();
  const toggleFlag = useFlagToggle();
  const lang = useLang();
  return (
    <li {...extra?.li} className={`glass idea-row ${i.adopted ? "adopted" : ""} ${extra?.className ?? ""}`}>
      {extra?.check}
      <span className="row-cat">{catLabel(i.category, lang)}</span>
      <div className="row-main">
        <button type="button" className="title-btn row-title" onClick={onOpen} title={L("看完整內容", "Open details")}>
          {titleOf(i, L)}
        </button>
        {i.next_step ? <span className="row-next">👉 {i.next_step}</span> : i.status !== "analyzed" ? <span className={`badge ${i.status}`}>{statusText(L, i.status)}</span> : null}
      </div>
      {/* 採用狀態標籤：點一下就切換 */}
      <div className="row-adopt">
        <button
          type="button"
          aria-pressed={!!i.adopted}
          onClick={() => toggleFlag(i.id, "adopted", !i.adopted)}
          className={`adopt-tag ${i.adopted ? "on" : ""}`}
          title={i.adopted ? L("點一下改成未採用", "Click to mark as not adopted") : L("點一下標記已採用", "Click to mark as adopted")}
        >
          {i.adopted ? L("✓ 已採用", "✓ Adopted") : L("未採用", "Not adopted")}
        </button>
      </div>
      <span className="row-score" aria-label={i.score_total !== null ? L(`綜合分數 ${i.score_total}`, `Overall score ${i.score_total}`) : L("尚無分數", "No score yet")}>{i.score_total ?? "—"}</span>
      <SourceButton url={i.url} />
    </li>
  );
}

/** 詳細面板內容 */
export function IdeaDetail({ idea: i, picks }: { idea: Idea; picks?: React.ReactNode }) {
  const scoreLabel = useScoreLabel(i);
  const L = useL();
  const lang = useLang();
  return (
    <div className="detail">
      <div className="idea-head">
        <form action={setCategory} className="inline">
          <input type="hidden" name="id" value={i.id} />
          <AutoSelect name="category" defaultValue={i.category ?? "other"} options={catOptions(lang)} />
        </form>
        {i.status !== "analyzed" && <span className={`badge ${i.status}`}>{statusText(L, i.status)}</span>}
        {i.adopted && <span className="badge adopted">{L("已採用", "Adopted")}</span>}
        <span className="muted small push">{i.author ? `${i.author}・` : ""}{taipeiShort(i.created_at)}</span>
      </div>
      <h2 className="detail-title">{titleOf(i, L)}</h2>
      <DupNotice idea={i} />

      {i.score_total !== null && (
        <ScoreBlock total={i.score_total} rows={[{ label: scoreLabel, n: i.score_arx }, { label: axisLabels(i.scoring?.lens ?? null, lang).ease, n: i.score_feasibility }, { label: axisLabels(i.scoring?.lens ?? null, lang).value, n: i.score_market }]} />
      )}
      <ProjectFits idea={i} />
      {i.next_step && (
        <div className="detail-next">
          <span className="kpi-label">{L("下一步", "Next step")}</span>
          <p>{i.next_step}</p>
        </div>
      )}
      {i.score_reason && (
        <>
          <h3 className="detail-h">{L("AI 的理由", "Why the AI scored it this way")}</h3>
          <p className="detail-reason">{i.score_reason}</p>
        </>
      )}
      {!!i.tags?.length && <p className="tags">{i.tags.map((t) => <span key={t}>#{t}</span>)}</p>}
      {picks}

      <h3 className="detail-h">{L("原文", "Original post")}</h3>
      {i.content ? <p className="content">{i.content}</p> : <p className="muted small">{L("沒有抓到原文內容。在下面補一句重點，AI 就會重新分析。", "Couldn’t fetch the original text. Add a short note below and the AI will re-analyze it.")}</p>}

      <h3 className="detail-h">{L("我的補充", "My notes")}</h3>
      <form action={saveNote} className="note-form" key={i.note ?? ""}>
        <input type="hidden" name="id" value={i.id} />
        <textarea name="note" rows={3} defaultValue={i.note ?? ""} placeholder={L("補一句重點，AI 會重新分析", "Add a key point — the AI will re-analyze")} />
        <SubmitButton label={L("儲存並重新分析", "Save & re-analyze")} pending={L("分析中…", "Analyzing…")} />
      </form>

      <div className="actions detail-actions">
        <AdoptButton idea={i} className="btn small" />
        <form action={deleteIdea}>
          <input type="hidden" name="id" value={i.id} />
          <ConfirmButton label={L("刪除", "Delete")} message={L("確定刪除這則點子？", "Delete this idea?")} />
        </form>
      </div>
    </div>
  );
}
