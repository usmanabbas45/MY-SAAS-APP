import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  api_key TEXT NOT NULL UNIQUE,
  alert_webhook TEXT,
  alert_email TEXT,
  agent_cost_budget_usd REAL NOT NULL DEFAULT 1.0,
  agent_max_steps INTEGER NOT NULL DEFAULT 25,
  agent_max_ms INTEGER NOT NULL DEFAULT 120000,
  agent_ai_review INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS kb_docs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS audits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  score REAL,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS audit_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  audit_id INTEGER NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL,
  turn_index INTEGER NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  verdict TEXT NOT NULL,
  severity TEXT NOT NULL,
  reason TEXT NOT NULL,
  source_doc TEXT,
  confidence REAL NOT NULL,
  features_json TEXT NOT NULL,
  risk REAL,
  feedback TEXT,
  corrected_verdict TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_items_audit ON audit_items(audit_id);
CREATE TABLE IF NOT EXISTS bot_targets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  headers_enc TEXT,
  body_template TEXT NOT NULL,
  response_path TEXT NOT NULL,
  last_run_at TEXT
);
CREATE TABLE IF NOT EXISTS test_cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  expected TEXT NOT NULL,
  must_not TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS test_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  target_id INTEGER NOT NULL REFERENCES bot_targets(id) ON DELETE CASCADE,
  passed INTEGER NOT NULL,
  failed INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS test_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
  case_id INTEGER NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  pass INTEGER NOT NULL,
  reason TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  goal TEXT NOT NULL,
  status TEXT NOT NULL,
  final_output TEXT NOT NULL,
  steps_json TEXT NOT NULL,
  total_cost_usd REAL NOT NULL,
  total_ms INTEGER NOT NULL,
  issues_json TEXT NOT NULL,
  score REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(project_id, external_id)
);
CREATE TABLE IF NOT EXISTS workflow_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  api_key_enc TEXT NOT NULL,
  scenario_ids TEXT NOT NULL DEFAULT '',
  expected_interval_min INTEGER,
  last_polled_at TEXT,
  last_error TEXT
);
CREATE TABLE IF NOT EXISTS workflow_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  workflow_name TEXT NOT NULL,
  execution_id TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  duration_ms INTEGER,
  output_items INTEGER,
  error_message TEXT,
  UNIQUE(project_id, platform, execution_id)
);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_wf ON workflow_runs(project_id, workflow_id, started_at);
CREATE TABLE IF NOT EXISTS incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  module TEXT NOT NULL,
  code TEXT NOT NULL,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  dedupe_key TEXT,
  resolved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_incidents_project ON incidents(project_id, created_at);
CREATE TABLE IF NOT EXISTS risk_models (
  project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  weights_json TEXT NOT NULL,
  n_samples INTEGER NOT NULL,
  val_accuracy REAL NOT NULL,
  trained_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

/** Additive migrations for databases created by older versions. */
function migrate(db: DatabaseSync): void {
  const cols = (db.prepare("PRAGMA table_info(audits)").all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes("judge")) db.exec("ALTER TABLE audits ADD COLUMN judge TEXT");
}

let instance: DatabaseSync | null = null;

export function openDatabase(file: string): DatabaseSync {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

export function getDb(): DatabaseSync {
  if (!instance) instance = openDatabase(process.env.DATABASE_PATH || "./data/agentproof.db");
  return instance;
}

/** Test hook: point the app at a fresh database. */
export function setDb(db: DatabaseSync): void {
  instance = db;
}

type Row = Record<string, unknown>;
type Param = string | number | null;

export function all<T = Row>(sql: string, ...params: Param[]): T[] {
  return getDb().prepare(sql).all(...params) as T[];
}

export function get<T = Row>(sql: string, ...params: Param[]): T | undefined {
  return getDb().prepare(sql).get(...params) as T | undefined;
}

export function run(sql: string, ...params: Param[]): { lastInsertRowid: number; changes: number } {
  const r = getDb().prepare(sql).run(...params);
  return { lastInsertRowid: Number(r.lastInsertRowid), changes: Number(r.changes) };
}

export function transaction<T>(fn: () => T): T {
  const db = getDb();
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
