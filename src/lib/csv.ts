/** One CSV cell: quoted, with spreadsheet formula injection neutralised. */
export function csvCell(value: unknown): string {
  const s = value == null ? "" : String(value);
  // Neutralise spreadsheet formula injection, then quote.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}
