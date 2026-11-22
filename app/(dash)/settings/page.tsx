import { requireOwner } from "@/lib/auth";
import { db } from "@/lib/db";
import { getOwnerContext, getOwnerProfile, primaryProjectSlug } from "@/lib/owner";
import { LEARN_BATCH, type Rule } from "@/lib/learning";
import { env } from "@/lib/env";
import { getL } from "@/lib/i18nServer";
import { getWebhookInfo } from "@/lib/telegram";
import { listProjects } from "@/lib/projects";
import { removeRule, restoreRule, runLearningNow, saveOwnerContext, saveProjectDescriptions, sendDigestNow } from "../actions";
import { SubmitButton } from "../ConfirmButton";
import { AppearanceControls } from "../Nav";
import { AssistantSettings } from "./AssistantSettings";
import { SettingsSwitch } from "./SettingsSwitch";
import { Suspense } from "react";
import { listDevices } from "@/lib/app";
import { AppPairing } from "./AppPairing";
import { removeAppDevice } from "./appActions";
import { PartnersPanel } from "./PartnersPanel";
import { listMembers } from "@/lib/members";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const { email } = await requireOwner();
  const { msg } = await searchParams;
  return (
    <Suspense>
      <SettingsSwitch
        msg={msg}
        panels={{
          desc: <DescSection />,
          status: <StatusSection email={email} />,
          theme: <ThemeSection />,
          digest: <DigestSection />,
          learn: <LearnSection />,
          app: <AppSection />,
          partners: <PartnersSection />,
        }}
      />
    </Suspense>
  );
}

async function DescSection() {
  const [context, profile, { projects, ready }, L] = await Promise.all([getOwnerContext(), getOwnerProfile(), listProjects().catch(() => ({ projects: [], ready: false })), getL()]);
  const list = projects.filter((p) => p.status !== "done");
  const main = primaryProjectSlug();
  const about = (
    <form action={saveOwnerContext} className="glass panel">
      <h3>{L("關於你", "About you")}</h3>
      <p className="muted small">{L("一句話說明你的身分、所在地與階段（例如：台北的大學生創辦人、一人開發）。補助雷達用這段判斷你符不符合資格。", "One line on who you are, where you are and your stage (e.g. a solo student founder in Taipei). The grant radar uses it to judge eligibility.")}</p>
      <textarea name="owner_profile" rows={2} maxLength={500} defaultValue={profile} />
      {/* 還沒有專案資料（migration-013 前）時，產品描述在這裡填 */}
      {(!ready || !list.length || !("description" in list[0])) && (
        <>
          <h3>{L("產品描述", "Product description")}</h3>
          <p className="muted small">{L("你在做什麼、給誰用、現在到哪。之後新存的點子都會用這段描述評分。", "What you're building, for whom, and where it stands. New ideas are scored against this.")}</p>
          <textarea name="owner_context" rows={6} maxLength={2000} defaultValue={context} />
        </>
      )}
      <SubmitButton label={L("儲存", "Save")} className="btn primary" />
    </form>
  );
  if (!ready || !list.length || !("description" in list[0])) return about;
  return (
    <>
      {about}
      <form action={saveProjectDescriptions} className="glass panel">
        <h3>{L("專案描述", "Project descriptions")}</h3>
        <p className="muted small">{L("一句到幾句話說明每個專案在做什麼、給誰用、現在到哪。方向變了就來更新，之後新存的點子都會用新的描述分析。", "A few sentences on what each project is, who it's for and where it stands. New ideas are analyzed against the latest descriptions.")}</p>
        {list.map((p) => (
          <label key={p.id} className="settings-desc">
            <b>{p.name}{p.status === "paused" ? L("（暫停中）", " (paused)") : ""}</b>
            <textarea name={`desc:${p.id}`} rows={p.slug === main ? 5 : 3} maxLength={2000} defaultValue={p.description?.trim() || (p.slug === main ? context : "")} />
          </label>
        ))}
        <SubmitButton label={L("儲存", "Save")} className="btn primary" />
      </form>
    </>
  );
}

async function StatusSection({ email }: { email: string }) {
  const hook = await getWebhookInfo().catch(() => null);
  const owner = env.telegramOwnerId();
  const L = await getL();
  return (
    <section className="glass panel">
      <h3>{L("連線狀態", "Connections")}</h3>
      <ul className="status-list status-cards">
        <li><span>{L("登入帳號", "Signed in as")}</span><b>{email}</b></li>
        <li><span>{L("Telegram 主人 ID", "Telegram owner ID")}</span><b>{owner ? `✅ ${owner}` : L("❌ 尚未設定", "❌ Not set")}</b></li>
        <li><span>Telegram Webhook</span><b>{hook?.url ? L("✅ 已連線", "✅ Connected") : L("❌ 尚未設定", "❌ Not set")}</b></li>
        {hook?.last_error_message && <li className="error">{L("最近錯誤：", "Last error: ")}{hook.last_error_message}</li>}
        <li><span>{L("GitHub 讀取額度", "GitHub rate limit")}</span><b>{env.githubToken() ? L("✅ 已設定權杖（每小時 5000 次）", "✅ Token set (5,000 requests/hour)") : L("未設定權杖（每小時 60 次）", "No token (60 requests/hour)")}</b></li>
      </ul>
    </section>
  );
}

async function ThemeSection() {
  const L = await getL();
  return (
    <section className="glass panel">
      <h3>{L("外觀", "Appearance")}</h3>
      <p className="muted small">{L("只會記在這台裝置的瀏覽器，電腦和手機要各設定一次。", "Saved only in this device's browser, so set it separately on your computer and phone.")}</p>
      <AppearanceControls />
      <AssistantSettings />
    </section>
  );
}

async function DigestSection() {
  const L = await getL();
  return (
    <form action={sendDigestNow} className="glass panel">
      <h3>{L("週報", "Weekly digest")}</h3>
      <p className="muted small">{L("每週日晚上 9 點左右自動傳到 Telegram。想先看看長什麼樣子可以按下面。", "Sent to Telegram automatically around 9 pm every Sunday. Click below to see what it looks like.")}</p>
      <SubmitButton label={L("立即傳送一份週報到 Telegram", "Send a digest to Telegram now")} pending={L("產生中…", "Generating…")} />
    </form>
  );
}

async function LearnSection() {
  const L = await getL();
  const [{ data, error }, { count }] = await Promise.all([
    db().from("learned_rules").select("*").order("evidence", { ascending: false }),
    db().from("feedback_signals").select("id", { count: "exact", head: true }).eq("learned", false),
  ]);
  if (error) {
    return (
      <section className="glass panel">
        <h3>{L("AI 學習", "AI learning")}</h3>
        <p className="error">{L("讀不到學習資料，請先在 ideabox 的 Supabase 執行 migration-008-health-learning.sql。", "Couldn't load learning data. Run migration-008-health-learning.sql on the ideabox Supabase first.")}</p>
      </section>
    );
  }
  const rules = (data ?? []) as Rule[];
  const pending = count ?? 0;
  const groups: Array<{ scope: Rule["scope"]; title: string; empty: string }> = [
    { scope: "idea", title: L("點子分析會參考", "Used when analyzing ideas"), empty: L("還沒有規則。多採用、刪除或補充幾則點子後就會出現。", "No rules yet. They appear after you adopt, delete or add notes to a few ideas.") },
    { scope: "grant", title: L("補助雷達會參考", "Used by the grant radar"), empty: L("還沒有規則。把幾筆補助標成有興趣、已申請或不適合後就會出現。", "No rules yet. They appear after you mark a few grants as interested, applied or not a fit.") },
  ];
  const removed = rules.filter((r) => !r.active);

  return (
    <section className="glass panel">
      <h3>{L("AI 學習", "AI learning")}</h3>
      <p className="muted small">
        {L(
          `你採用、取消採用或刪除點子、補充備註，以及標記補助時，都會被記下來。累積 ${LEARN_BATCH} 筆就自動整理成偏好規則（每週日也會整理一次），之後分析點子、找補助時馬上套用。覺得哪條不對就刪掉，AI 不會再學回來。`,
          `Adopting, un-adopting or deleting ideas, adding notes and marking grants are all recorded. Every ${LEARN_BATCH} records (and every Sunday) they're turned into preference rules that apply to future idea analysis and grant searches right away. Delete any rule that's wrong and the AI won't learn it again.`,
        )}
      </p>
      <div className="learn-head">
        <span className="small">{pending ? L(`有 ${pending} 筆新修正等待學習`, `${pending} new correction${pending > 1 ? "s" : ""} waiting`) : L("沒有等待學習的修正", "Nothing waiting to be learned")}</span>
        <form action={runLearningNow}>
          <SubmitButton label={L("立即學習", "Learn now")} pending={L("整理中…", "Learning…")} className="btn small" />
        </form>
      </div>
      {groups.map((g) => {
        const list = rules.filter((r) => r.scope === g.scope && r.active);
        return (
          <div key={g.scope} className="rule-group">
            <h4>{g.title}</h4>
            {list.length ? (
              <ul className="rule-list">
                {list.map((r) => (
                  <li key={r.id}>
                    <span className="rule-text">{r.rule}</span>
                    <span className="muted small rule-ev">{L(`依據 ${r.evidence} 筆`, `${r.evidence} record${r.evidence > 1 ? "s" : ""}`)}</span>
                    <form action={removeRule}>
                      <input type="hidden" name="id" value={r.id} />
                      <SubmitButton className="link-btn danger-link" label={L("刪除", "Delete")} />
                    </form>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted small">{g.empty}</p>
            )}
          </div>
        );
      })}
      {removed.length > 0 && (
        <details className="rule-removed">
          <summary className="small muted">{L(`已刪除的規則（${removed.length}）`, `Deleted rules (${removed.length})`)}</summary>
          <ul className="rule-list">
            {removed.map((r) => (
              <li key={r.id}>
                <span className="rule-text muted">{r.rule}</span>
                <form action={restoreRule}>
                  <input type="hidden" name="id" value={r.id} />
                  <SubmitButton className="link-btn" label={L("恢復", "Restore")} />
                </form>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

async function AppSection() {
  const [L, { devices: all, ready }] = await Promise.all([getL(), listDevices()]);
  const devices = all.filter((d) => !d.member_id); // 合夥人的手機在「合夥人」分頁
  const fmt = (iso: string) => new Date(iso).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  return (
    <section className="glass panel">
      <h3>{L("手機 App", "Phone app")}</h3>
      <p className="muted small">
        {L(
          "App 只能看、不能改。推送：有填時間的排程開始前 30 分鐘、早上 8 點的今日排程與待辦到期提醒、產品掛掉／恢復。Telegram 照常會收到。",
          "The app is read-only. Pushes: 30 min before timed schedule items, the 8 am schedule and to-do due reminders, and product outages / recoveries. Telegram keeps working as before.",
        )}
      </p>
      {!ready ? (
        <p className="error">{L("請先在 ideabox 的 Supabase 執行 migration-022-app.sql。", "Run migration-022-app.sql on the ideabox Supabase first.")}</p>
      ) : (
        <>
          <AppPairing />
          <h4 className="app-devices-title">{L("已配對的手機", "Paired phones")}</h4>
          {devices.length ? (
            <ul className="status-list">
              {devices.map((d) => (
                <li key={d.id}>
                  <span>
                    <b>{d.name}</b>
                    <span className="muted small">　{d.push_token ? L("🔔 推送已開", "🔔 Push on") : L("🔕 沒開推送", "🔕 Push off")}・{L("最後使用", "Last seen")} {fmt(d.last_seen_at)}</span>
                  </span>
                  <form action={removeAppDevice.bind(null, d.id)}>
                    <SubmitButton label={L("解除配對", "Unpair")} pending={L("解除中…", "Removing…")} className="btn ghost small" />
                  </form>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">{L("還沒有配對任何手機。", "No phones paired yet.")}</p>
          )}
        </>
      )}
    </section>
  );
}

async function PartnersSection() {
  const [L, { members, ready }, { projects }, { devices }] = await Promise.all([getL(), listMembers(), listProjects().catch(() => ({ projects: [] })), listDevices()]);
  if (!ready) {
    return (
      <section className="glass panel">
        <h3>{L("合夥人", "Partners")}</h3>
        <p className="error">{L("請先在 ideabox 的 Supabase 執行 migration-026-members.sql。", "Run migration-026-members.sql on the ideabox Supabase first.")}</p>
      </section>
    );
  }
  return (
    <PartnersPanel
      members={members}
      projects={projects.filter((p) => p.status !== "done").map((p) => ({ id: p.id, name: p.name }))}
      devices={devices.map((d) => ({ id: d.id, name: d.name, member_id: d.member_id ?? null, push_token: d.push_token, last_seen_at: d.last_seen_at }))}
    />
  );
}
