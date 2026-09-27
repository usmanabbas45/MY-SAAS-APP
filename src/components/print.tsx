"use client";

export function PrintButton() {
  return <button type="button" className="btn no-print" onClick={() => window.print()}>🖨️ Save as PDF / Print</button>;
}
