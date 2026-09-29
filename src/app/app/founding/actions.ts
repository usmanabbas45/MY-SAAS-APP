"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { claimFoundingSpot } from "@/lib/founding";

export async function claimFoundingAction() {
  const user = await requireUser();
  const r = await claimFoundingSpot(user.id);
  redirect(r.ok ? "/app/founding?claimed=1" : `/app/founding?error=${encodeURIComponent(r.error)}`);
}
