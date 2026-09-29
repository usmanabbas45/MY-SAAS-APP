import { all, get, run } from "./db";
import { sendEmail } from "./email";
import { SUPPORT_EMAIL } from "./seo";
import { truncate } from "./text";

/** Support contact points. Set WHATSAPP_NUMBER (digits with country code) and DEVELOPER_URL on the server to change them. */
export const WHATSAPP_NUMBER = (process.env.WHATSAPP_NUMBER || "923431562831").replace(/\D/g, "");
export const WHATSAPP_DISPLAY = `+${WHATSAPP_NUMBER.slice(0, 2)} ${WHATSAPP_NUMBER.slice(2, 5)} ${WHATSAPP_NUMBER.slice(5)}`;
export const DEVELOPER_URL = process.env.DEVELOPER_URL || "https://usmanabbas.dev";
export const DEVELOPER_NAME = DEVELOPER_URL.replace(/^https?:\/\//, "").replace(/\/$/, "");

export const whatsappLink = (text = "Hi! I need help with ProofMyAI.") => `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`;

export const CATEGORIES = {
  bug: "Something is broken / error",
  setup: "Help connecting my chatbot, agent or n8n/Make",
  billing: "Billing, plan or payment",
  question: "Question about a feature",
  feature: "Feature request",
  developer: "I need a developer (custom work)",
} as const;
export type Category = keyof typeof CATEGORIES;

export interface Ticket {
  id: number;
  user_id: number | null;
  email: string;
  name: string | null;
  category: Category;
  subject: string;
  message: string;
  page: string | null;
  status: "open" | "answered" | "closed";
  reply: string | null;
  replied_at: string | null;
  created_at: string;
}

export const ticketCode = (id: number) => `PMA-${String(id).padStart(4, "0")}`;

export function validateTicket(input: { email: string; category: string; subject: string; message: string }): string | null {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) return "Enter a valid email so we can reply.";
  if (!(input.category in CATEGORIES)) return "Choose what your issue is about.";
  if (input.subject.trim().length < 3) return "Add a short title for your issue.";
  if (input.message.trim().length < 10) return "Please describe the issue (at least 10 characters). Include any error message you see.";
  return null;
}

/** Stores a ticket and emails the support inbox. Returns the ticket and a ready-made WhatsApp message. */
export async function createTicket(input: { userId: number | null; email: string; name?: string; category: Category; subject: string; message: string; page?: string }): Promise<{ id: number; code: string; whatsapp: string }> {
  const { lastInsertRowid: id } = run(
    "INSERT INTO support_tickets (user_id, email, name, category, subject, message, page) VALUES (?, ?, ?, ?, ?, ?, ?)",
    input.userId, input.email.trim().toLowerCase(), input.name?.trim().slice(0, 100) || null, input.category,
    input.subject.trim().slice(0, 150), input.message.trim().slice(0, 5000), input.page?.slice(0, 300) || null,
  );
  const code = ticketCode(id);
  const body = `${code} · ${CATEGORIES[input.category]}\nFrom: ${input.name ?? ""} <${input.email}>${input.userId ? ` (user #${input.userId})` : ""}\nPage: ${input.page ?? "-"}\n\n${input.subject}\n\n${input.message}\n\nReply in the admin inbox: ${process.env.APP_URL ?? ""}/app/admin/support`;
  // Email delivery is best-effort: the ticket is saved and visible in the admin inbox either way.
  await sendEmail(SUPPORT_EMAIL, `[ProofMyAI support] ${code}: ${truncate(input.subject, 80)}`, body, input.email).catch(() => false);
  const whatsapp = `Hi, I submitted support ticket ${code} on ProofMyAI: "${truncate(input.subject, 80)}". ${truncate(input.message, 300)}`;
  return { id, code, whatsapp };
}

export function userTickets(userId: number): Ticket[] {
  return all<Ticket>("SELECT * FROM support_tickets WHERE user_id = ? ORDER BY id DESC LIMIT 50", userId);
}

export function listTickets(status: "open" | "answered" | "closed" | "all" = "open"): Ticket[] {
  return status === "all"
    ? all<Ticket>("SELECT * FROM support_tickets ORDER BY id DESC LIMIT 200")
    : all<Ticket>("SELECT * FROM support_tickets WHERE status = ? ORDER BY id DESC LIMIT 200", status);
}

export function ticketCounts(): Record<"open" | "answered" | "closed", number> {
  const rows = all<{ status: "open" | "answered" | "closed"; n: number }>("SELECT status, COUNT(*) AS n FROM support_tickets GROUP BY status");
  return { open: 0, answered: 0, closed: 0, ...Object.fromEntries(rows.map((r) => [r.status, r.n])) };
}

export function getTicket(id: number): Ticket | undefined {
  return get<Ticket>("SELECT * FROM support_tickets WHERE id = ?", id);
}

/** Saves the team's reply and emails it to the customer. Returns whether the email was sent. */
export async function replyToTicket(id: number, reply: string, close: boolean): Promise<boolean> {
  const t = getTicket(id);
  if (!t) throw new Error("Ticket not found.");
  run("UPDATE support_tickets SET reply = ?, replied_at = ?, status = ? WHERE id = ?", reply.trim().slice(0, 5000), new Date().toISOString(), close ? "closed" : "answered", id);
  const text = `Hi${t.name ? ` ${t.name}` : ""},\n\n${reply.trim()}\n\n— ProofMyAI support\n\nYour ticket ${ticketCode(id)}: "${t.subject}"\nView it any time: ${process.env.APP_URL ?? ""}/app/support\nWhatsApp: ${whatsappLink(`About ticket ${ticketCode(id)}`)}`;
  return sendEmail(t.email, `Re: ${ticketCode(id)} ${truncate(t.subject, 80)}`, text, SUPPORT_EMAIL).catch(() => false);
}

export function setTicketStatus(id: number, status: "open" | "answered" | "closed"): void {
  run("UPDATE support_tickets SET status = ? WHERE id = ?", status, id);
}
