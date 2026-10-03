"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createDemoProject, deleteDemoProject } from "@/lib/demo";
import { rateLimit } from "@/lib/security";

/** "Try with demo data": opens a sample project full of realistic results. */
export async function tryDemoAction() {
  const user = await requireUser();
  if (!rateLimit(`demo:${user.id}`, 5, 3600000)) redirect("/app?new=1&error=" + encodeURIComponent("Please wait a little before creating the demo again."));
  const id = await createDemoProject(user.id);
  redirect(`/app/p/${id}?demo=1`);
}

export async function deleteDemoAction() {
  const user = await requireUser();
  deleteDemoProject(user.id);
  redirect("/app?new=1");
}
