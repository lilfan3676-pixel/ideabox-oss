"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { useL } from "@/app/LangProvider";
import { effectiveStatus, MAX_KEYWORDS, type RadarItem, type RadarReport } from "@/lib/radarLogic";
import { runRadarNow, saveRadarKeywords } from "../actions";
import { useAccess } from "../../AccessContext";

// 話題雷達：關鍵字設定＋最新一期整理＋「現在抓一次」。每週日早上 8 點自動抓。

export function RadarSection({ projectId, keywords, reports, ready, enabled, now }: { projectId: string; keywords: string[]; reports: RadarReport[]; ready: boolean; enabled: boolean; now: number }) {
  const L = useL();
  const router = useRouter();
  const owner = useAccess().owner; // 關鍵字與「現在抓一次」會花錢，只有你能改
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [editing, setEditing] = useState(!keywords.length && owner);
  const [shown, setShown] = useState(0); // 看第幾期
  const latest = reports[0];
  const running = latest && effectiveStatus(latest, now) === "running";

  // 抓取中每 10 秒重新整理一次，跑完自動顯示結果
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => router.refresh(), 10_000);
    return () => clearInterval(t);
  }, [running, router]);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, okText?: string) =>
    start(async () => {
      const r = await fn();
      setMsg(r.ok ? (okText ? { ok: true, text: okText } : null) : { ok: false, text: r.error ?? L("失敗了", "Failed") });
      router.refresh();
    });

  if (!ready) {
    return (
      <section className="glass pd-card">
        <h2 className="detail-h">{L("話題雷達", "Topic radar")}</h2>
        <p className="muted small">{L("請先在 ideabox 的 Supabase 執行 migration-021-radar.sql。", "Run migration-021-radar.sql in ideabox’s Supabase first.")}</p>
      </section>
    );
  }

  const report = reports[shown];
  const status = report ? effectiveStatus(report, now) : null;

  return (
    <section className="glass pd-card radar">
      <div className="radar-head">
        <h2 className="detail-h">{L("話題雷達", "Topic radar")}</h2>
        {owner && enabled && keywords.length > 0 && (
          <button type="button" className="btn small" disabled={pending || !!running} onClick={() => run(() => runRadarNow(projectId), L("開始抓了，大約 1～3 分鐘", "Started — about 1–3 minutes"))}>
            {running ? L("抓取中…", "Running…") : L("現在抓一次", "Run now")}
          </button>
        )}
      </div>
      <p className="muted small">
        {L("每週日早上 8 點抓 Threads 上這些關鍵字最近一週的熱門貼文，AI 整理大家在聊什麼、卡在哪；評分高的痛點會自動存成這個專案的點子。", "Every Sunday 8am, collects last week’s top Threads posts for these keywords; AI sums up what people discuss and struggle with. High-scoring pain points are saved as ideas for this project.")}
      </p>
      {owner && !enabled && <p className="small radar-warn">{L("還沒設定 APIFY_TOKEN（Vercel 環境變數），設定好才會開始抓。", "APIFY_TOKEN isn’t set in Vercel yet; nothing will be collected until it is.")}</p>}

      {editing ? (
        <form
          className="log-add"
          action={(fd) =>
            run(async () => {
              const r = await saveRadarKeywords(projectId, String(fd.get("kw") ?? ""));
              if (r.ok) setEditing(!(r.keywords?.length));
              return r;
            })
          }
        >
          <input name="kw" defaultValue={keywords.join("、")} maxLength={200} autoFocus={keywords.length > 0} placeholder={L(`關鍵字，用頓號或逗號分開，最多 ${MAX_KEYWORDS} 個（例如：健身菜單、重訓 卡關）`, `Keywords, comma-separated, up to ${MAX_KEYWORDS}`)} />
          <button className="btn small primary" type="submit" disabled={pending}>{L("儲存", "Save")}</button>
          {keywords.length > 0 && <button type="button" className="btn ghost small" onClick={() => setEditing(false)}>{L("取消", "Cancel")}</button>}
        </form>
      ) : (
        <p className="radar-kw">
          {keywords.map((k) => <span key={k} className="badge">{k}</span>)}
          {owner && <button type="button" className="link-btn small" onClick={() => setEditing(true)}>{L("改關鍵字", "Edit")}</button>}
        </p>
      )}
      {msg && <p className={`small ${msg.ok ? "muted" : "radar-warn"}`} role="status">{msg.text}</p>}

      {reports.length > 1 && (
        <p className="radar-tabs">
          {reports.map((r, i) => (
            <button key={r.id} type="button" className={`chip-btn ${i === shown ? "active" : ""}`} onClick={() => setShown(i)}>
              {r.created_at.slice(5, 10).replace("-", "/")}
            </button>
          ))}
        </p>
      )}

      {!report ? (
        keywords.length > 0 && <p className="muted small">{L("還沒抓過，週日會自動跑，或按「現在抓一次」。", "Not run yet. It runs on Sunday, or press “Run now”.")}</p>
      ) : status === "running" ? (
        <p className="muted small">{L("抓取中，大約 1～3 分鐘，好了會自動顯示…", "Collecting — about 1–3 minutes; results will appear here…")}</p>
      ) : status === "failed" ? (
        <p className="small radar-warn">{L("這次沒抓成功：", "This run failed: ")}{report.error ?? L("逾時中斷", "timed out")}</p>
      ) : report.summary ? (
        <div className="radar-body">
          <p className="muted small">
            {L(`${report.created_at.slice(0, 10)}・看了 ${report.post_count} 篇・關鍵字：${report.keywords.join("、")}`, `${report.created_at.slice(0, 10)} · ${report.post_count} posts · ${report.keywords.join(", ")}`)}
            {report.idea_ids.length > 0 && L(`・存了 ${report.idea_ids.length} 個點子`, ` · ${report.idea_ids.length} saved as ideas`)}
          </p>
          {report.summary.overview && <p className="radar-overview">{report.summary.overview}</p>}
          {report.summary.pains.length > 0 && (
            <>
              <h3 className="radar-h">{L("常見痛點", "Pain points")}</h3>
              <ItemList items={report.summary.pains} scores />
            </>
          )}
          {report.summary.themes.length > 0 && (
            <>
              <h3 className="radar-h">{L("討論主題", "Themes")}</h3>
              <ItemList items={report.summary.themes} />
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}

function ItemList({ items, scores }: { items: (RadarItem & { score?: number })[]; scores?: boolean }) {
  const L = useL();
  return (
    <ul className="radar-list">
      {items.map((it, i) => (
        <li key={i}>
          <div className="radar-item-title">
            {scores && it.score != null && <span className="row-score" title={L("對這個專案的參考價值（1～5）", "Relevance to this project (1–5)")}>{it.score}</span>}
            <b>{it.title}</b>
          </div>
          {it.detail && <p className="small">{it.detail}</p>}
          {it.urls.length > 0 && (
            <p className="radar-links small">
              {it.urls.map((u, n) => (
                <a key={u} href={u} target="_blank" rel="noreferrer">{L(`原文 ${n + 1}`, `Post ${n + 1}`)}</a>
              ))}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
