import Link from "next/link";

export default function NotFound() {
  return (
    <div className="auth-wrap">
      <div className="card auth-card" style={{ textAlign: "center" }}>
        <div style={{ fontSize: 40 }}>🔎</div>
        <h2>Page not found</h2>
        <p className="sub">This page doesn&apos;t exist or you don&apos;t have access to it.</p>
        <Link href="/app" className="btn">Go to dashboard</Link>
      </div>
    </div>
  );
}
