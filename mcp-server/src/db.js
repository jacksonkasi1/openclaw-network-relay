import { Database } from "bun:sqlite";
import { randomUUID } from "crypto";

const db = new Database("openclaw.sqlite", { create: true });
db.exec("PRAGMA journal_mode = WAL;");

db.exec(`
  CREATE TABLE IF NOT EXISTS rules (
    id TEXT PRIMARY KEY,
    name TEXT,
    folder TEXT DEFAULT 'Uncategorized',
    urlPattern TEXT,
    method TEXT,
    phase TEXT,
    action TEXT,
    modifiedMethod TEXT,
    modifiedUrl TEXT,
    modifiedHeaders TEXT,
    modifiedBody TEXT,
    modifiedStatusCode INTEGER,
    modifiedResponseHeaders TEXT,
    modifiedResponseBody TEXT,
    isActive INTEGER DEFAULT 1,
    createdAt INTEGER
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS traffic_logs (
    id TEXT PRIMARY KEY,
    folder TEXT DEFAULT 'Inbox',
    phase TEXT,
    mode TEXT,
    url TEXT,
    method TEXT,
    requestHeaders TEXT,
    requestBody TEXT,
    responseStatusCode INTEGER,
    responseHeaders TEXT,
    responseBody TEXT,
    timestamp INTEGER
  );
`);

db.exec(`CREATE INDEX IF NOT EXISTS idx_rules_active ON rules(isActive);`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_traffic_timestamp ON traffic_logs(timestamp);`);

function parseRule(r) {
  return {
    ...r,
    modifiedHeaders: r.modifiedHeaders ? JSON.parse(r.modifiedHeaders) : undefined,
    modifiedResponseHeaders: r.modifiedResponseHeaders ? JSON.parse(r.modifiedResponseHeaders) : undefined,
    isActive: !!r.isActive
  };
}

function parseLog(l) {
  return {
    ...l,
    requestHeaders: l.requestHeaders ? JSON.parse(l.requestHeaders) : undefined,
    responseHeaders: l.responseHeaders ? JSON.parse(l.responseHeaders) : undefined,
  };
}

// Rules functions
export function getActiveRules() {
  return db.query("SELECT * FROM rules WHERE isActive = 1").all().map(parseRule);
}

export function getAllRules() {
  return db.query("SELECT * FROM rules ORDER BY createdAt DESC").all().map(parseRule);
}

export function addRule(rule) {
  const id = randomUUID();
  const stmt = db.prepare(`
    INSERT INTO rules (id, name, folder, urlPattern, method, phase, action, modifiedMethod, modifiedUrl, modifiedHeaders, modifiedBody, modifiedStatusCode, modifiedResponseHeaders, modifiedResponseBody, isActive, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    id, rule.name, rule.folder || 'Uncategorized', rule.urlPattern, rule.method, rule.phase, rule.action,
    rule.modifiedMethod, rule.modifiedUrl,
    rule.modifiedHeaders ? JSON.stringify(rule.modifiedHeaders) : null,
    rule.modifiedBody, rule.modifiedStatusCode,
    rule.modifiedResponseHeaders ? JSON.stringify(rule.modifiedResponseHeaders) : null,
    rule.modifiedResponseBody,
    1, Date.now()
  );
  return { id, ...rule };
}

export function updateRuleState(id, isActive) {
  db.query("UPDATE rules SET isActive = ? WHERE id = ?").run(isActive ? 1 : 0, id);
}

export function removeRule(id) {
  const res = db.query("DELETE FROM rules WHERE id = ?").run(id);
  return res.changes > 0;
}

// Traffic log functions
export function addTrafficLog(data) {
  const stmt = db.prepare(`
    INSERT INTO traffic_logs (id, folder, phase, mode, url, method, requestHeaders, requestBody, responseStatusCode, responseHeaders, responseBody, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    data.id || randomUUID(),
    data.folder || 'Inbox',
    data.phase,
    data.mode,
    data.url,
    data.method,
    data.requestHeaders ? JSON.stringify(data.requestHeaders) : null,
    data.requestBody,
    data.responseStatusCode,
    data.responseHeaders ? JSON.stringify(data.responseHeaders) : null,
    data.responseBody,
    Date.now()
  );
}

export function getTrafficLogs(limit = 100) {
  return db.query("SELECT * FROM traffic_logs ORDER BY timestamp DESC LIMIT ?").all(limit).map(parseLog);
}

export function organizeLogIntoFolder(id, folder) {
  const res = db.query("UPDATE traffic_logs SET folder = ? WHERE id = ?").run(folder, id);
  return res.changes > 0;
}

export function clearAllTrafficLogs() {
  db.query("DELETE FROM traffic_logs").run();
}

export function clearAllRules() {
  db.query("DELETE FROM rules").run();
}
