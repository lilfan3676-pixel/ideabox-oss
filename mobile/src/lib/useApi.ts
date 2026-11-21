// 讀 ideabox 資料：進到畫面、App 回到前景時自動更新，下拉可重新整理
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { rememberProjectOrder } from "@/components/ui";
import { api, ApiError } from "./api";
import { L } from "./i18n";
import { getSession, saveSession } from "./session";

type State<T> = { data: T | null; error: string | null; loading: boolean; refreshing: boolean };

const cache = new Map<string, unknown>();
const STALE_MS = 30_000;

/** pollMs：畫面開著時每隔幾毫秒安靜地更新一次（辦公室用） */
export function useApi<T>(path: string, opts?: { pollMs?: number }) {
  const [state, setState] = useState<State<T>>(() => ({ data: (cache.get(path) as T) ?? null, error: null, loading: !cache.has(path), refreshing: false }));
  const lastLoad = useRef(0);
  const pathRef = useRef(path);
  pathRef.current = path;

  const load = useCallback(async (mode: "auto" | "pull" | "poll") => {
    const p = pathRef.current;
    if (mode === "auto" && Date.now() - lastLoad.current < STALE_MS && cache.has(p)) return;
    lastLoad.current = Date.now();
    setState((s) => ({ ...s, refreshing: mode === "pull", loading: !cache.has(p) }));
    try {
      const data = await api<T>(p);
      // 首頁與月曆帶有完整的專案排序，記下來給顏色用
      const list = (data as { projects?: { id: string }[] }).projects;
      if (Array.isArray(list)) rememberProjectOrder(list.map((x) => x.id));
      // 首頁也帶回這支手機能看的分頁：你在網頁改了合夥人的權限，App 跟著換
      const tabs = (data as { access?: { tabs?: unknown } }).access?.tabs;
      const s = getSession();
      if (s && Array.isArray(tabs) && tabs.join() !== (s.tabs ?? []).join()) saveSession({ ...s, tabs: tabs.map(String) }).catch(() => null);
      cache.set(p, data);
      if (pathRef.current === p) setState({ data, error: null, loading: false, refreshing: false });
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : L("讀取失敗", "Could not load");
      if (pathRef.current === p) setState((s) => ({ ...s, error: msg, loading: false, refreshing: false }));
    }
  }, []);

  // 換月份等等：路徑變了就立刻讀（有快取先顯示快取）
  useEffect(() => {
    lastLoad.current = 0;
    setState({ data: (cache.get(path) as T) ?? null, error: null, loading: !cache.has(path), refreshing: false });
    load("auto");
  }, [path, load]);

  const pollMs = opts?.pollMs;
  useFocusEffect(
    useCallback(() => {
      load("auto");
      if (!pollMs) return;
      const timer = setInterval(() => AppState.currentState === "active" && load("poll"), pollMs);
      return () => clearInterval(timer);
    }, [load, pollMs]),
  );

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => s === "active" && load("auto"));
    return () => sub.remove();
  }, [load]);

  return { ...state, refresh: () => load("pull") };
}

/** 不另外讀，只看之前讀到的（選單上的現況用） */
export const peekApi = <T,>(path: string) => (cache.get(path) as T | undefined) ?? null;

export function clearApiCache() {
  cache.clear();
}
