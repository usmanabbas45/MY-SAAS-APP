import { all, get, run, transaction } from "./db";
import { sendMail } from "./email";
import { inviteEmail } from "./emails";
import type { Project } from "./projects";
import { randomToken, sha256 } from "./security";

/** Team access: the owner plus invited members with a viewer or editor role. */
export type Role = "owner" | "editor" | "viewer";
export const INVITE_DAYS = 7;
export const ROLE_LABEL: Record<Role, string> = { owner: "Owner", editor: "Editor", viewer: "Viewer" };
const HIDDEN_KEY = "ap_live_hidden-ask-the-project-owner";

export function projectRole(userId: number, projectId: number): Role | null {
  const p = get<{ user_id: number }>("SELECT user_id FROM projects WHERE id = ?", projectId);
  if (!p) return null;
  if (p.user_id === userId) return "owner";
  const m = get<{ role: string }>("SELECT role FROM project_members WHERE project_id = ? AND user_id = ?", projectId, userId);
  return m ? (m.role === "editor" ? "editor" : "viewer") : null;
}

/** The project as a member sees it: viewers never see the project's API key. */
export function asSeenBy(p: Project, role: Role): Project {
  return role === "viewer" ? { ...p, api_key: HIDDEN_KEY } : p;
}

export function sharedProjects(userId: number): (Project & { role: Role })[] {
  return all<Project & { role: Role }>(
    "SELECT p.*, pm.role AS role FROM project_members pm JOIN projects p ON p.id = pm.project_id WHERE pm.user_id = ? ORDER BY p.id", userId,
  ).map((p) => asSeenBy(p, p.role) as Project & { role: Role });
}

export interface Member { user_id: number; email: string; role: Role; created_at: string }
export interface Invite { id: number; email: string; role: Role; expires_at: string; created_at: string }

export function members(projectId: number): Member[] {
  return all<Member>("SELECT pm.user_id, u.email, pm.role, pm.created_at FROM project_members pm JOIN users u ON u.id = pm.user_id WHERE pm.project_id = ? ORDER BY pm.created_at", projectId);
}

export function pendingInvites(projectId: number): Invite[] {
  return all<Invite>("SELECT id, email, role, expires_at, created_at FROM project_invites WHERE project_id = ? AND accepted_at IS NULL AND expires_at > datetime('now') ORDER BY id DESC", projectId);
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Creates an invite (replacing an older pending one for the same email) and emails the link. */
export async function createInvite(p: Project, inviterEmail: string, rawEmail: string, rawRole: string, appUrl: string): Promise<{ ok: true; link: string; emailed: boolean } | { ok: false; error: string }> {
  const email = rawEmail.trim().toLowerCase();
  const role: Role = rawRole === "editor" ? "editor" : "viewer";
  if (!EMAIL.test(email)) return { ok: false, error: "Enter a valid email address." };
  if (email === inviterEmail.toLowerCase()) return { ok: false, error: "That's your own email: you already have access." };
  const owner = get<{ email: string }>("SELECT email FROM users WHERE id = ?", p.user_id)?.email;
  if (owner?.toLowerCase() === email) return { ok: false, error: "That person owns this project." };
  if (get("SELECT 1 FROM project_members pm JOIN users u ON u.id = pm.user_id WHERE pm.project_id = ? AND lower(u.email) = ?", p.id, email)) {
    return { ok: false, error: `${email} is already a member. Change their role in the list below.` };
  }
  const token = randomToken(24);
  transaction(() => {
    run("DELETE FROM project_invites WHERE project_id = ? AND lower(email) = ? AND accepted_at IS NULL", p.id, email);
    run("INSERT INTO project_invites (project_id, email, role, token_hash, invited_by, expires_at) VALUES (?, ?, ?, ?, ?, datetime('now', ?))",
      p.id, email, role, sha256(token), p.user_id, `+${INVITE_DAYS} days`);
  });
  const link = `${appUrl.replace(/\/+$/, "")}/invite/${token}`;
  let emailed = false;
  try {
    emailed = await sendMail(email, inviteEmail(inviterEmail, p.name, role, link, INVITE_DAYS));
  } catch (err) {
    console.error("[team] invite email failed:", err);
  }
  return { ok: true, link, emailed };
}

export interface InviteInfo { id: number; project_id: number; project_name: string; owner_email: string; email: string; role: Role; expired: boolean; accepted: boolean }

export function inviteByToken(token: string): InviteInfo | null {
  if (!/^[A-Za-z0-9_-]{10,100}$/.test(token)) return null;
  const r = get<{ id: number; project_id: number; project_name: string; owner_email: string; email: string; role: Role; expired: number; accepted_at: string | null }>(
    `SELECT i.id, i.project_id, p.name AS project_name, u.email AS owner_email, i.email, i.role, (i.expires_at <= datetime('now')) AS expired, i.accepted_at
       FROM project_invites i JOIN projects p ON p.id = i.project_id JOIN users u ON u.id = p.user_id WHERE i.token_hash = ?`, sha256(token),
  );
  return r ? { ...r, expired: Boolean(r.expired), accepted: Boolean(r.accepted_at) } : null;
}

/** Accepts an invite for the logged-in user. The account email must match the invited email. */
export function acceptInvite(token: string, userId: number, userEmail: string): { ok: true; projectId: number } | { ok: false; error: string } {
  const inv = inviteByToken(token);
  if (!inv || inv.accepted) return { ok: false, error: "This invitation was already used or doesn't exist. Ask the project owner for a new one." };
  if (inv.expired) return { ok: false, error: "This invitation has expired. Ask the project owner to send a new one." };
  if (inv.email !== userEmail.toLowerCase()) return { ok: false, error: `This invitation is for ${inv.email}. Log in with that email address to accept it.` };
  if (projectRole(userId, inv.project_id) === "owner") return { ok: false, error: "You already own this project." };
  transaction(() => {
    run("INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, ?) ON CONFLICT(project_id, user_id) DO UPDATE SET role = excluded.role", inv.project_id, userId, inv.role);
    run("UPDATE project_invites SET accepted_at = datetime('now') WHERE id = ?", inv.id);
  });
  return { ok: true, projectId: inv.project_id };
}

export function setMemberRole(projectId: number, userId: number, role: string): void {
  run("UPDATE project_members SET role = ? WHERE project_id = ? AND user_id = ?", role === "editor" ? "editor" : "viewer", projectId, userId);
}

export function removeMember(projectId: number, userId: number): void {
  run("DELETE FROM project_members WHERE project_id = ? AND user_id = ?", projectId, userId);
}

export function revokeInvite(projectId: number, inviteId: number): void {
  run("DELETE FROM project_invites WHERE id = ? AND project_id = ? AND accepted_at IS NULL", inviteId, projectId);
}
