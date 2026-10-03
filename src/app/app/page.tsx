import Link from "next/link";
import { redirect } from "next/navigation";
import { SubmitButton, ThemeToggle } from "@/components/client";
import { Flash, ScoreBadge } from "@/components/ui";
import { isAdmin } from "@/lib/admin";
import { limitError } from "@/lib/billing";
import { requireUser } from "@/lib/auth";
import { projectHealth } from "@/lib/health";
import { accessibleProjects, createProject } from "@/lib/projects";
import { logoutAction } from "../(auth)/actions";
import { VerifyBanner } from "@/components/verify-banner";

export const metadata = { title: "Projects" };

async function newProjectAction(form: FormData) {
  "use server";
  const user = await requireUser();
  const over = limitError(user.id, "projects");
  if (over) redirect(`/app?new=1&error=${encodeURIComponent(over)}`);
  const id = createProject(user.id, String(form.get("name") ?? ""));
  redirect(`/app/p/${id}?welcome=1`);
}

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ new?: string; error?: string }> }) {
  const user = await requireUser();
  const projects = accessibleProjects(user.id);
  const sp = await searchParams;
  const real = projects.filter((p) => !p.is_demo);
  if (real.length === 1 && !sp.new) redirect(`/app/p/${real[0].id}`);
  return (
    <div>
      <nav className="lp-nav">
        <Link href="/" className="logo"><span className="logo-mark">✓</span>ProofMyAI</Link>
        <div className="row">
          {isAdmin(user.email) ? <Link href="/app/admin" className="sub">🛡️ Admin</Link> : null}
          <Link href="/app/billing" className="sub">💳 Billing</Link>
          <Link href="/app/account" className="sub">👤 {user.email}</Link>
          <ThemeToggle />
          <form action={logoutAction}><button className="btn btn-ghost btn-sm">Log out</button></form>
        </div>
      </nav>
      <div className="content" style={{ margin: "0 auto" }}>
        <VerifyBanner userId={user.id} email={user.email} />
        <h1>Your projects</h1>
        <p className="sub">Use one project per business or client. Agencies: create one project per client.</p>
        <Flash error={sp.error} />
        <div className="grid grid-3" style={{ marginTop: 20 }}>
          {projects.map((p) => {
            const h = projectHealth(p.id, 7);
            return (
              <Link key={p.id} href={`/app/p/${p.id}`} className="card" style={{ color: "inherit", textDecoration: "none" }}>
                <div className="row between"><h3>{p.name}{p.role !== "owner" ? <span className="badge" style={{ marginLeft: 8, fontSize: 12 }}>Shared · {p.role}</span> : null}</h3><ScoreBadge score={h.overall} /></div>
                <p className="sub" style={{ margin: 0 }}>{h.openIncidents} open incident{h.openIncidents === 1 ? "" : "s"}</p>
              </Link>
            );
          })}
          <form action={newProjectAction} className="card">
            <h3>New project</h3>
            <div className="field">
              <label htmlFor="name">Name</label>
              <input id="name" name="name" type="text" placeholder="Client or brand name" maxLength={100} required />
            </div>
            <SubmitButton>Create project</SubmitButton>
          </form>
        </div>
      </div>
    </div>
  );
}
