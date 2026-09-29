import { beforeEach, describe, expect, it } from "vitest";
import { createTicket, listTickets, replyToTicket, setTicketStatus, ticketCode, ticketCounts, userTickets, validateTicket, whatsappLink } from "@/lib/support";
import { freshDb } from "./helpers";

let userId: number;
beforeEach(() => ({ userId } = freshDb()));

describe("support tickets", () => {
  it("validates input and builds a WhatsApp link to the support number", () => {
    expect(validateTicket({ email: "bad", category: "bug", subject: "Broken", message: "It shows an error 500" })).toMatch(/email/);
    expect(validateTicket({ email: "a@b.co", category: "nope", subject: "Broken", message: "It shows an error 500" })).toMatch(/Choose/);
    expect(validateTicket({ email: "a@b.co", category: "bug", subject: "Broken", message: "short" })).toMatch(/describe/);
    expect(validateTicket({ email: "a@b.co", category: "bug", subject: "Broken", message: "It shows an error 500" })).toBeNull();
    expect(whatsappLink("Hi there")).toBe("https://wa.me/923431562831?text=Hi%20there");
    expect(ticketCode(7)).toBe("PMA-0007");
  });

  it("stores tickets, lists them per user and records replies", async () => {
    const t = await createTicket({ userId, email: "Cust@Example.com", category: "bug", subject: "Audit fails", message: "Error: could not parse my CSV file" });
    await createTicket({ userId: null, email: "guest@x.com", category: "developer", subject: "Need a bot", message: "Can you build a WhatsApp chatbot?" });
    expect(t.code).toBe(ticketCode(t.id));
    expect(t.whatsapp).toContain(t.code);
    expect(userTickets(userId)).toHaveLength(1);
    expect(userTickets(userId)[0].email).toBe("cust@example.com");
    expect(ticketCounts()).toEqual({ open: 2, answered: 0, closed: 0 });

    await replyToTicket(t.id, "Fixed, please try again.", false);
    expect(userTickets(userId)[0]).toMatchObject({ status: "answered", reply: "Fixed, please try again." });
    expect(listTickets("open")).toHaveLength(1);
    setTicketStatus(t.id, "closed");
    expect(ticketCounts()).toEqual({ open: 1, answered: 0, closed: 1 });
    expect(listTickets("all")).toHaveLength(2);
  });
});

describe("account deletion", () => {
  it("removes the user's tickets with the account", async () => {
    await createTicket({ userId, email: "c@x.com", category: "bug", subject: "Oops", message: "Something went wrong here" });
    const { run } = await import("@/lib/db");
    run("DELETE FROM users WHERE id = ?", userId);
    expect(listTickets("all")).toHaveLength(0);
  });
});
