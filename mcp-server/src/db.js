import { Database } from "bun:sqlite";
import { randomUUID } from "crypto";
import { join } from "path";

const dbPath = join(import.meta.dir, "..", "openclaw.sqlite");
const db = new Database(dbPath, { create: true });
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
  let modHeaders, modResHeaders;
  try { modHeaders = r.modifiedHeaders ? JSON.parse(r.modifiedHeaders) : undefined; } catch(e) {}
  try { modResHeaders = r.modifiedResponseHeaders ? JSON.parse(r.modifiedResponseHeaders) : undefined; } catch(e) {}
  
  return {
    ...r,
    modifiedHeaders: modHeaders,
    modifiedResponseHeaders: modResHeaders,
    isActive: !!r.isActive
  };
}

function parseLog(l) {
  let reqHeaders, resHeaders;
  try { reqHeaders = l.requestHeaders ? JSON.parse(l.requestHeaders) : undefined; } catch(e) {}
  try { resHeaders = l.responseHeaders ? JSON.parse(l.responseHeaders) : undefined; } catch(e) {}
  
  return {
    ...l,
    requestHeaders: reqHeaders,
    responseHeaders: resHeaders,
  };
}

// Pre-compiled statements for high throughput
const insertRuleStmt = db.prepare(`
  INSERT INTO rules (id, name, folder, urlPattern, method, phase, action, modifiedMethod, modifiedUrl, modifiedHeaders, modifiedBody, modifiedStatusCode, modifiedResponseHeaders, modifiedResponseBody, isActive, createdAt)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertLogStmt = db.prepare(`
  INSERT INTO traffic_logs (id, folder, phase, mode, url, method, requestHeaders, requestBody, responseStatusCode, responseHeaders, responseBody, timestamp)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const cleanupLogsStmt = db.prepare(`
  DELETE FROM traffic_logs WHERE id IN (
    SELECT id FROM traffic_logs ORDER BY timestamp DESC LIMIT -1 OFFSET 2000
  )
`);

// Rules functions
export function getActiveRules() {
  return db.query("SELECT * FROM rules WHERE isActive = 1").all().map(parseRule);
}

export function getAllRules() {
  return db.query("SELECT * FROM rules ORDER BY createdAt DESC").all().map(parseRule);
}

export function addRule(rule) {
  const id = randomUUID();
  insertRuleStmt.run(
    id, rule.name, rule.folder || 'Uncategorized', rule.urlPattern, rule.method, rule.phase, rule.action,
    rule.modifiedMethod, rule.modifiedUrl,
    rule.modifiedHeaders ? JSON.stringify(rule.modifiedHeaders) : null,
    rule.modifiedBody, rule.modifiedStatusCode,
    rule.modifiedResponseHeaders ? JSON.stringify(rule.modifiedResponseHeaders) : null,
    rule.modifiedResponseBody,
    1, Date.now()
  );
  return { ...rule, id };
}

export function updateRule(id, updates) {
  const stmt = db.prepare(`
    UPDATE rules 
    SET name=?, folder=?, urlPattern=?, method=?, phase=?, action=?, modifiedMethod=?, modifiedUrl=?, modifiedHeaders=?, modifiedBody=?, modifiedStatusCode=?, modifiedResponseHeaders=?, modifiedResponseBody=?
    WHERE id=?
  `);
  stmt.run(
    updates.name, updates.folder || 'Uncategorized', updates.urlPattern, updates.method, updates.phase, updates.action,
    updates.modifiedMethod, updates.modifiedUrl, 
    updates.modifiedHeaders ? JSON.stringify(updates.modifiedHeaders) : null,
    updates.modifiedBody, updates.modifiedStatusCode,
    updates.modifiedResponseHeaders ? JSON.stringify(updates.modifiedResponseHeaders) : null,
    updates.modifiedResponseBody,
    id
  );
}

export function updateRuleState(id, isActive) {
  db.query("UPDATE rules SET isActive = ? WHERE id = ?").run(isActive ? 1 : 0, id);
}

export function removeRule(id) {
  const res = db.query("DELETE FROM rules WHERE id = ?").run(id);
  return res.changes > 0;
}

let logInsertCounter = 0;
// Traffic log functions
export function addTrafficLog(data) {
  insertLogStmt.run(
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
  
  // Deterministic prune old logs to prevent DB bloat
  logInsertCounter++;
  if (logInsertCounter % 50 === 0) {
    cleanupLogsStmt.run();
  }
}

export function getTrafficLogs(limit = 100) {
  const clampedLimit = Math.max(1, Math.min(1000, Number(limit) || 100));
  return db.query("SELECT * FROM traffic_logs ORDER BY timestamp DESC LIMIT ?").all(clampedLimit).map(parseLog);
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
