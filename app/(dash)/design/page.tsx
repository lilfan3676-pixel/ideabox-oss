import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { listFolders } from "@/lib/folders";

export const dynamic = "force-dynamic";

// 設計庫已併進點子庫：舊網址轉到「介面設計」資料夾
export default async function DesignPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  await requireOwner();
  const sp = await searchParams;
  if (sp.view === "brief") redirect("/?view=brief");
  const { folders } = await listFolders();
  const ui = folders.find((f) => f.category === (sp.view === "github" ? "github" : "ui_design"));
  redirect(ui ? `/?folder=${ui.id}` : "/");
}
