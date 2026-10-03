import { beforeEach, describe, expect, it } from "vitest";
import { get, run } from "@/lib/db";
import { AccessError, accessibleProjects, projectAccess, type Project } from "@/lib/projects";
import { acceptInvite, createInvite, inviteByToken, members, pendingInvites, projectRole, removeMember } from "@/lib/team";
import { freshDb } from "./helpers";

let ownerId: number, projectId: number, project: Project;
const addUser = (email: string) => run("INSERT INTO users (email, password_hash) VALUES (?, 'x')", email).lastInsertRowid;
const token = (link: string) => link.split("/invite/")[1];
beforeEach(() => {
  ({ userId: ownerId, projectId } = freshDb());
  project = get<Project>("SELECT * FROM projects WHERE id = ?", projectId)!;
});

describe("team", () => {
  it("invites, accepts with the matching email only, and enforces roles", async () => {
    const r = await createInvite(project, "t@example.com", "Client@Shop.com", "viewer", "https://proofmyai.com");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.link).toMatch(/^https:\/\/proofmyai\.com\/invite\/[\w-]+$/);
    expect(pendingInvites(projectId)).toHaveLength(1);
    expect(inviteByToken(token(r.link))).toMatchObject({ email: "client@shop.com", role: "viewer", project_name: "Test" });

    const stranger = addUser("someone@else.com");
    expect(acceptInvite(token(r.link), stranger, "someone@else.com")).toMatchObject({ ok: false });
    expect(projectRole(stranger, projectId)).toBeNull();

    const client = addUser("client@shop.com");
    expect(acceptInvite(token(r.link), client, "client@shop.com")).toEqual({ ok: true, projectId });
    expect(acceptInvite(token(r.link), client, "client@shop.com")).toMatchObject({ ok: false }); // single use
    expect(projectRole(client, projectId)).toBe("viewer");
    expect(members(projectId).map((m) => m.email)).toEqual(["client@shop.com"]);

    // Viewers see the project without its API key and can't change things.
    const seen = projectAccess(client, projectId);
    expect(seen.role).toBe("viewer");
    expect(seen.project.api_key).not.toBe(project.api_key);
    expect(() => projectAccess(client, projectId, "editor")).toThrow(AccessError);
    expect(accessibleProjects(client).map((p) => [p.id, p.role])).toEqual([[projectId, "viewer"]]);
    expect(projectAccess(ownerId, projectId, "owner").project.api_key).toBe(project.api_key);

    removeMember(projectId, client);
    expect(projectRole(client, projectId)).toBeNull();
  });

  it("validates invites and expires them", async () => {
    expect(await createInvite(project, "t@example.com", "not-an-email", "viewer", "")).toMatchObject({ ok: false });
    expect(await createInvite(project, "t@example.com", "t@example.com", "viewer", "")).toMatchObject({ ok: false });
    const r = await createInvite(project, "t@example.com", "late@x.com", "editor", "");
    if (!r.ok) throw new Error("invite failed");
    run("UPDATE project_invites SET expires_at = datetime('now', '-1 minute')");
    const late = addUser("late@x.com");
    expect(acceptInvite(token(r.link), late, "late@x.com")).toMatchObject({ ok: false, error: expect.stringMatching(/expired/) });
    expect(inviteByToken("../../etc")).toBeNull();
  });
});
