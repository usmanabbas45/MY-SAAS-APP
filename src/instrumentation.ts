/** Runs once when the server starts (Node.js runtime only). See instrumentation-node.ts. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}

/** Every unhandled server error: recorded, and the admins are emailed when errors spike. */
export async function onRequestError(err: unknown, request: { path: string; method: string }) {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { reportError } = await import("./lib/monitoring");
    await reportError(`${request.method} ${request.path.split("?")[0].slice(0, 150)}`, err);
  }
}
