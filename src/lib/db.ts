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
  corrected_verdict TEXT,
  created_at TEXT
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
function addColumn(db: DatabaseSync, table: string, column: string, definition: string): void {
  const cols = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function migrate(db: DatabaseSync): void {
  addColumn(db, "audits", "judge", "TEXT");
  addColumn(db, "audits", "share_token", "TEXT");
  addColumn(db, "audit_items", "created_at", "TEXT");
  addColumn(db, "audit_items", "frustrated", "INTEGER NOT NULL DEFAULT 0");
  addColumn(db, "audit_items", "rule_hit", "TEXT");
  addColumn(db, "projects", "redact_pii", "INTEGER NOT NULL DEFAULT 1");
  addColumn(db, "projects", "report_brand", "TEXT");
  addColumn(db, "projects", "weekly_digest", "INTEGER NOT NULL DEFAULT 1");
  addColumn(db, "projects", "last_digest_at", "TEXT");
  addColumn(db, "users", "plan", "TEXT NOT NULL DEFAULT 'free'");
  addColumn(db, "users", "plan_status", "TEXT");
  addColumn(db, "users", "paddle_customer_id", "TEXT");
  addColumn(db, "users", "paddle_subscription_id", "TEXT");
  addColumn(db, "users", "plan_renews_at", "TEXT");
  addColumn(db, "users", "plan_cancel_at", "TEXT");
  addColumn(db, "users", "trial_ends_at", "TEXT");
  addColumn(db, "users", "plan_updated_at", "TEXT");
  addColumn(db, "projects", "mask_terms", "TEXT");
  addColumn(db, "projects", "retention_days", "INTEGER NOT NULL DEFAULT 0");
  addColumn(db, "projects", "store_text", "INTEGER NOT NULL DEFAULT 1");
  addColumn(db, "projects", "use_ai", "INTEGER NOT NULL DEFAULT 1");
  addColumn(db, "projects", "reply_timeout_sec", "INTEGER NOT NULL DEFAULT 120");
  addColumn(db, "audit_items", "conv_flags", "TEXT");
  addColumn(db, "audit_items", "latency_ms", "INTEGER");
  addColumn(db, "audit_items", "cost_usd", "REAL");
  addColumn(db, "audit_items", "bot_error", "TEXT");
  db.exec(`CREATE TABLE IF NOT EXISTS pending_replies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    conversation_id TEXT NOT NULL,
    question TEXT NOT NULL,
    received_at TEXT NOT NULL,
    error TEXT,
    alerted INTEGER NOT NULL DEFAULT 0,
    UNIQUE(project_id, conversation_id)
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS support_tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    name TEXT,
    category TEXT NOT NULL,
    subject TEXT NOT NULL,
    message TEXT NOT NULL,
    page TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    reply TEXT,
    replied_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS testimonials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    role TEXT,
    company TEXT,
    website TEXT,
    quote TEXT NOT NULL,
    result TEXT,
    rating INTEGER NOT NULL DEFAULT 5,
    consent INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL DEFAULT 'in_app',
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    approved_at TEXT
  )`);
  // AI usage per call: token counts and dollar cost only, never any customer text. No foreign keys, so
  // the cost history survives when a project or account is deleted.
  db.exec(`CREATE TABLE IF NOT EXISTS ai_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER,
    user_id INTEGER,
    kind TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cache_read_tokens INTEGER NOT NULL DEFAULT 0,
    cache_write_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  db.exec("CREATE INDEX IF NOT EXISTS ai_usage_created ON ai_usage (created_at)");
  // One row per user per day they used the app: powers retention cohorts.
  db.exec(`CREATE TABLE IF NOT EXISTS user_activity (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day TEXT NOT NULL,
    PRIMARY KEY (user_id, day)
  )`);
  // Daily business snapshot (MRR history), written by the cron and the analytics page.
  db.exec(`CREATE TABLE IF NOT EXISTS metrics_daily (
    day TEXT PRIMARY KEY,
    users INTEGER NOT NULL,
    paying INTEGER NOT NULL,
    trialing INTEGER NOT NULL,
    mrr REAL NOT NULL,
    ai_cost REAL NOT NULL DEFAULT 0
  )`);
  // Cookie-free website traffic (no consent needed): daily totals only, no IPs or personal data.
  db.exec(`CREATE TABLE IF NOT EXISTS traffic_pages (day TEXT NOT NULL, path TEXT NOT NULL, views INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, path))`);
  db.exec(`CREATE TABLE IF NOT EXISTS traffic_sources (day TEXT NOT NULL, source TEXT NOT NULL, visits INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, source))`);
  db.exec(`CREATE TABLE IF NOT EXISTS traffic_days (day TEXT PRIMARY KEY, visitors INTEGER NOT NULL DEFAULT 0, views INTEGER NOT NULL DEFAULT 0)`);
  // Today's anonymous visitor fingerprints (salted hash that changes daily); rows older than today are deleted.
  db.exec(`CREATE TABLE IF NOT EXISTS traffic_seen (day TEXT NOT NULL, hash TEXT NOT NULL, PRIMARY KEY (day, hash))`);
  // Emails ("name@x.com") or whole domains ("@x.com") that may not sign up.
  db.exec(`CREATE TABLE IF NOT EXISTS blocklist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pattern TEXT NOT NULL UNIQUE,
    reason TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  // WhatsApp live monitoring: the last customer message per chat, to pair with the bot's reply.
  db.exec(`CREATE TABLE IF NOT EXISTS wa_last_question (
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    chat TEXT NOT NULL,
    question TEXT NOT NULL,
    at_ms INTEGER NOT NULL,
    PRIMARY KEY (project_id, chat)
  )`);
  // Solved CAPTCHA challenges (each can be used once), kept until they expire.
  db.exec("CREATE TABLE IF NOT EXISTS captcha_used (id TEXT PRIMARY KEY, exp INTEGER NOT NULL)");
  db.exec(`CREATE TABLE IF NOT EXISTS recovery_codes (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL,
    used_at TEXT,
    PRIMARY KEY (user_id, code_hash)
  )`);
  // Devices a user has logged in from, to email them about sign-ins from new ones.
  db.exec(`CREATE TABLE IF NOT EXISTS login_devices (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_hash TEXT NOT NULL,
    label TEXT NOT NULL,
    first_seen TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, device_hash)
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS heartbeats (
    name TEXT PRIMARY KEY,
    last_run_at TEXT NOT NULL,
    ok INTEGER NOT NULL,
    detail TEXT
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS uptime_days (
    day TEXT PRIMARY KEY,
    cron_runs INTEGER NOT NULL DEFAULT 0,
    cron_failures INTEGER NOT NULL DEFAULT 0
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS alert_channels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    target TEXT NOT NULL,
    secret_enc TEXT,
    min_severity TEXT NOT NULL DEFAULT 'medium',
    modules TEXT NOT NULL DEFAULT '',
    notify_resolved INTEGER NOT NULL DEFAULT 0,
    last_status TEXT,
    last_sent_at TEXT
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS chat_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    platform TEXT NOT NULL,
    name TEXT NOT NULL,
    account_id TEXT NOT NULL,
    secret_enc TEXT NOT NULL,
    bot_address TEXT NOT NULL,
    cursor TEXT,
    last_polled_at TEXT,
    last_error TEXT
  )`);
  addColumn(db, "users", "dpa_accepted_at", "TEXT");
  addColumn(db, "users", "dpa_company", "TEXT");
  addColumn(db, "users", "suspended_at", "TEXT");
  addColumn(db, "users", "ga_client_id", "TEXT");
  addColumn(db, "users", "last_seen_at", "TEXT");
  addColumn(db, "users", "admin_note", "TEXT");
  addColumn(db, "users", "founding_at", "TEXT");
  addColumn(db, "users", "comp_ends_at", "TEXT");
  addColumn(db, "users", "comp_reminded_at", "TEXT");
  // Two-factor authentication (TOTP). Secrets are stored encrypted.
  addColumn(db, "users", "totp_secret_enc", "TEXT");
  addColumn(db, "users", "totp_pending_enc", "TEXT");
  addColumn(db, "users", "totp_enabled_at", "TEXT");
  addColumn(db, "users", "totp_last_step", "INTEGER");
  // Backfill from what we already know (sign-up day and last active day); runs harmlessly on every start.
  db.exec("INSERT OR IGNORE INTO user_activity (user_id, day) SELECT id, substr(created_at, 1, 10) FROM users");
  db.exec("INSERT OR IGNORE INTO user_activity (user_id, day) SELECT id, substr(last_seen_at, 1, 10) FROM users WHERE last_seen_at IS NOT NULL");
  db.exec(`CREATE TABLE IF NOT EXISTS admin_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_email TEXT NOT NULL,
    action TEXT NOT NULL,
    target_email TEXT,
    detail TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    pattern TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS password_resets (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    used INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  db.exec("CREATE INDEX IF NOT EXISTS idx_audit_items_conv ON audit_items(conversation_id, turn_index)");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_audits_share ON audits(share_token) WHERE share_token IS NOT NULL");
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
