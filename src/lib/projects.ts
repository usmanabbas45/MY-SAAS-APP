import { notFound } from "next/navigation";
import { all, get, run } from "./db";
import { randomToken } from "./security";

export interface Project {
  id: number;
  user_id: number;
  name: string;
  api_key: string;
  alert_webhook: string | null;
  alert_email: string | null;
  agent_cost_budget_usd: number;
  agent_max_steps: number;
  agent_max_ms: number;
  agent_ai_review: number;
  created_at: string;
}

export function newApiKey(): string {
  return `ap_live_${randomToken(24)}`;
}

export function createProject(userId: number, name: string): number {
  const clean = name.trim().slice(0, 100) || "My project";
  return run("INSERT INTO projects (user_id, name, api_key) VALUES (?, ?, ?)", userId, clean, newApiKey()).lastInsertRowid;
}

export function listProjects(userId: number): Project[] {
  return all<Project>("SELECT * FROM projects WHERE user_id = ? ORDER BY id", userId);
}

/** Loads a project and 404s unless it belongs to the user (prevents cross-account access). */
export function ownedProject(userId: number, projectId: number): Project {
  const p = Number.isInteger(projectId) ? get<Project>("SELECT * FROM projects WHERE id = ? AND user_id = ?", projectId, userId) : undefined;
  if (!p) notFound();
  return p;
}

/** Authenticates ingestion API calls: `Authorization: Bearer ap_live_...` */
export function projectFromRequest(req: Request): Project | null {
  const header = req.headers.get("authorization") ?? "";
  const key = header.replace(/^Bearer\s+/i, "").trim() || req.headers.get("x-api-key")?.trim() || "";
  if (!key.startsWith("ap_live_")) return null;
  return get<Project>("SELECT * FROM projects WHERE api_key = ?", key) ?? null;
}
