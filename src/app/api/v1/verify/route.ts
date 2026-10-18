import { z } from "zod";
import { json, readIngest } from "@/lib/api";
import { OutcomeCheckSchema, verifyClaim } from "@/lib/outcome";

const VerifySchema = OutcomeCheckSchema.extend({
  name: z.string().min(1).max(200),
  reference: z.string().max(200).optional(),
  claim: z.string().max(500).optional(),
  delay_seconds: z.number().min(0).max(60).default(0),
});

/**
 * Confirm that a step really happened, e.g. after n8n or an agent "created" a CRM record: ProofMyAI fetches the
 * record and raises an alert if it isn't there. Answers with the result (checks once more after 30 s on failure).
 */
export async function POST(req: Request) {
  const r = await readIngest(req);
  if (r instanceof Response) return r;
  const parsed = VerifySchema.safeParse(r.body);
  if (!parsed.success) {
    return json({ error: parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") }, 400);
  }
  const { name, reference, claim, ...check } = parsed.data;
  const result = await verifyClaim(r.project.id, { who: name, what: claim ?? "", ref: reference ?? new Date().toISOString() }, check);
  return json(result, 200);
}
