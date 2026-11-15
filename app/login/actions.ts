"use server";

import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/auth";
import { env } from "@/lib/env";

export async function login(form: FormData) {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  if (email !== env.ownerEmail()) redirect("/login?error=denied");
  const sb = await supabaseServer();
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    console.error("login failed:", error.status, error.code, error.message);
    redirect(`/login?error=invalid&reason=${encodeURIComponent(error.code || error.message || "")}`);
  }
  redirect("/");
}

export async function logout() {
  const sb = await supabaseServer();
  await sb.auth.signOut();
  redirect("/login");
}
