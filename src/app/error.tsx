"use client";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="auth-wrap">
      <div className="card auth-card" style={{ textAlign: "center" }}>
        <div style={{ fontSize: 40 }}>⚠️</div>
        <h2>Something went wrong</h2>
        <p className="sub">The error has been logged. Please try again.</p>
        <button className="btn" onClick={() => reset()}>Try again</button>
      </div>
    </div>
  );
}
