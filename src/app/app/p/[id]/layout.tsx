import Link from "next/link";
import { NavLinks, ProjectSwitcher, ThemeToggle, type NavItem } from "@/components/client";
import { isAdmin } from "@/lib/admin";
import { requireUser } from "@/lib/auth";
import { get } from "@/lib/db";
import { listProjects, ownedProject } from "@/lib/projects";
import { logoutAction } from "../../../(auth)/actions";

export default async function ProjectLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const project = ownedProject(user.id, Number(id));
  const base = `/app/p/${project.id}`;
  const open = get<{ n: number }>("SELECT COUNT(*) AS n FROM incidents WHERE project_id = ? AND resolved = 0", project.id)?.n ?? 0;

  const monitor: NavItem[] = [
    { href: base, label: "Overview", icon: "📊" },
    { href: `${base}/live`, label: "Live tracking", icon: "📡" },
    { href: `${base}/chatbot`, label: "Chatbot audits", icon: "💬" },
    { href: `${base}/tests`, label: "Chatbot tests", icon: "🧪" },
    { href: `${base}/agents`, label: "AI agents", icon: "🤖" },
    { href: `${base}/workflows`, label: "n8n & Make", icon: "⚙️" },
    { href: `${base}/incidents`, label: "Incidents", icon: "🚨", badge: open },
  ];
  const manage: NavItem[] = [
    { href: `${base}/settings`, label: "Settings & AI model", icon: "🛠️" },
    { href: `${base}/guide`, label: "Setup guide", icon: "📘" },
    { href: "/app/billing", label: "Plan & billing", icon: "💳" },
    { href: "/app/account", label: "Account", icon: "👤" },
    ...(isAdmin(user.email) ? [{ href: "/app/admin", label: "Admin", icon: "🛡️" }] : []),
  ];

  return (
    <div className="shell">
      <aside className="sidebar">
        <Link href="/app?new=1" className="logo"><span className="logo-mark">✓</span>ProofMyAI</Link>
        <ProjectSwitcher projects={listProjects(user.id).map((p) => ({ id: p.id, name: p.name }))} current={project.id} />
        <div className="nav-label">Monitor</div>
        <NavLinks items={monitor} />
        <div className="nav-label">Manage</div>
        <NavLinks items={manage} />
        <div className="sidebar-foot">
          <span className="sub" style={{ padding: "0 8px", overflow: "hidden", textOverflow: "ellipsis" }}>{user.email}</span>
          <div className="row" style={{ padding: "0 4px" }}>
            <ThemeToggle />
            <form action={logoutAction}><button className="btn btn-ghost btn-sm">Log out</button></form>
          </div>
        </div>
      </aside>
      <div className="main">
        <nav className="mobile-nav" aria-label="Sections"><NavLinks items={[...monitor, ...manage]} /></nav>
        <div className="content">{children}</div>
      </div>
    </div>
  );
}
