import { redirect } from "next/navigation";
import { getViewer } from "@/lib/auth";
import { listDevices } from "@/lib/app";
import { listProjects } from "@/lib/projects";
import { MEMBER_PAGES } from "@/lib/accessLogic";
import { getL } from "@/lib/i18nServer";
import { AccountView } from "./AccountView";

export const dynamic = "force-dynamic";

/** 合夥人的「我的帳號」：看自己的權限、改密碼、配對手機、推送開關。主人用設定頁 */
export default async function AccountPage() {
  const v = await getViewer();
  if (!v) redirect("/login");
  if (!v.member) redirect("/settings");
  const m = v.member;
  const [L, { projects }, { devices }] = await Promise.all([getL(), listProjects().catch(() => ({ projects: [] })), listDevices()]);
  return (
    <AccountView
      name={m.name}
      email={m.email}
      canEdit={m.can_edit}
      push={m.push}
      projects={projects.filter((p) => m.project_ids.includes(p.id)).map((p) => p.name)}
      pages={MEMBER_PAGES.filter((p) => m.pages.includes(p.key)).map((p) => L(p.zh, p.en))}
      devices={devices.filter((d) => d.member_id === m.id).map((d) => ({ id: d.id, name: d.name, push_token: d.push_token, last_seen_at: d.last_seen_at, created_at: d.created_at }))}
    />
  );
}
