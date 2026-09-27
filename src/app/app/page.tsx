import Link from "next/link";
import { redirect } from "next/navigation";
import { SubmitButton, ThemeToggle } from "@/components/client";
import { ScoreBadge } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { projectHealth } from "@/lib/health";
import { createProject, listProjects } from "@/lib/projects";
import { logoutAction } from "../(auth)/actions";

export const metadata = { title: "Projects" };

async function newProjectAction(form: FormData) {
  "use server";
  const user = await requireUser();
  const id = createProject(user.id, String(form.get("name") ?? ""));
  redirect(`/app/p/${id}?welcome=1`);
}

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const user = await requireUser();
  const projects = listProjects(user.id);
  const sp = await searchParams;
  if (projects.length === 1 && !sp.new) redirect(`/app/p/${projects[0].id}`);
  return (
    <div>
      <nav className="lp-nav">
        <Link href="/" className="logo"><span className="logo-mark">✓</span>ProofMyAI</Link>
        <div className="row">
          <span className="sub">{user.email}</span>
          <ThemeToggle />
          <form action={logoutAction}><button className="btn btn-ghost btn-sm">Log out</button></form>
        </div>
      </nav>
      <div className="content" style={{ margin: "0 auto" }}>
        <h1>Your projects</h1>
        <p className="sub">Use one project per business or client. Agencies: create one project per client.</p>
        <div className="grid grid-3" style={{ marginTop: 20 }}>
          {projects.map((p) => {
            const h = projectHealth(p.id, 7);
            return (
              <Link key={p.id} href={`/app/p/${p.id}`} className="card" style={{ color: "inherit", textDecoration: "none" }}>
                <div className="row between"><h3>{p.name}</h3><ScoreBadge score={h.overall} /></div>
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
