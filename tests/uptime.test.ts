import { beforeEach, describe, expect, it } from "vitest";
import { all, get, run } from "@/lib/db";
import { checkMonitor, monitorStats, probe, runDueMonitors, type Monitor } from "@/lib/uptime";
import { freshDb } from "./helpers";

let projectId: number;
beforeEach(() => ({ projectId } = freshDb()));
const res = (status: number, body = "ok") => async () => new Response(body, { status });
const fail = async () => { throw new Error("getaddrinfo ENOTFOUND shop.example"); };
const mon = () => get<Monitor>("SELECT * FROM uptime_monitors WHERE project_id = ?", projectId)!;
const openIncidents = () => all<{ title: string }>("SELECT title FROM incidents WHERE project_id = ? AND resolved = 0", projectId).map((r) => r.title);

describe("uptime", () => {
  it("probes status codes and required text", async () => {
    expect(await probe("https://x.test", null, res(200))).toMatchObject({ ok: true, code: 200 });
    expect(await probe("https://x.test", null, res(503))).toMatchObject({ ok: false, error: "HTTP 503" });
    expect((await probe("https://x.test", "chat-widget", res(200, "<html>no widget</html>"))).error).toMatch(/not found/);
    expect(await probe("https://x.test", "Chat-Widget", res(200, "<div id=chat-widget>"))).toMatchObject({ ok: true });
    expect((await probe("https://x.test", null, fail)).error).toMatch(/ENOTFOUND/);
  });

  it("alerts after 2 failures and resolves when back up", async () => {
    run("INSERT INTO uptime_monitors (project_id, name, url) VALUES (?, 'Shop bot', 'https://shop.example')", projectId);
    const t0 = new Date("2026-10-03T10:00:00Z");
    await checkMonitor(mon(), res(200), t0);
    expect(mon().status).toBe("up");
    await checkMonitor(mon(), fail, new Date(t0.getTime() + 300000));
    expect(mon()).toMatchObject({ status: "up", fails: 1 });
    expect(openIncidents()).toEqual([]);
    await checkMonitor(mon(), fail, new Date(t0.getTime() + 600000));
    expect(mon().status).toBe("down");
    expect(openIncidents()).toEqual(["Shop bot is down"]);
    await checkMonitor(mon(), fail, new Date(t0.getTime() + 900000)); // no duplicate incident
    expect(openIncidents()).toHaveLength(1);
    await checkMonitor(mon(), res(200), new Date(t0.getTime() + 1200000));
    expect(mon()).toMatchObject({ status: "up", fails: 0, down_since: null });
    expect(openIncidents()).toEqual([]);
    const st = monitorStats(mon().id, new Date(t0.getTime() + 1200000));
    expect(st.uptime24h).toBe(40);
    expect(st.recent).toHaveLength(5);
  });

  it("only checks monitors that are due", async () => {
    run("INSERT INTO uptime_monitors (project_id, name, url, interval_min) VALUES (?, 'A', 'https://a.example', 5)", projectId);
    const now = new Date();
    expect(await runDueMonitors(now, res(200))).toBe(1);
    expect(await runDueMonitors(new Date(now.getTime() + 60000), res(200))).toBe(0);
    expect(await runDueMonitors(new Date(now.getTime() + 300000), res(200))).toBe(1);
  });
});
