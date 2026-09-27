import { openDatabase, run, setDb } from "@/lib/db";

export function freshDb(): { userId: number; projectId: number } {
  setDb(openDatabase(":memory:"));
  const userId = run("INSERT INTO users (email, password_hash) VALUES ('t@example.com', 'x')").lastInsertRowid;
  const projectId = run("INSERT INTO projects (user_id, name, api_key) VALUES (?, 'Test', 'ap_live_test')", userId).lastInsertRowid;
  return { userId, projectId };
}
