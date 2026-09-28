"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { run } from "@/lib/db";

export async function acceptDpaAction(form: FormData) {
  const user = await requireUser();
  const company = String(form.get("company") ?? "").trim().slice(0, 200);
  if (!company || !form.get("agree")) redirect("/dpa?error=Enter+your+company+name+and+tick+the+box+to+accept.#accept");
  run("UPDATE users SET dpa_accepted_at = ?, dpa_company = ? WHERE id = ?", new Date().toISOString(), company, user.id);
  redirect("/dpa?ok=Thank+you.+The+DPA+is+accepted+for+your+account.#accept");
}
