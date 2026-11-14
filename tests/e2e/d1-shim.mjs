// Minimal D1 binding over node:sqlite (same SQLite dialect D1 uses), with every real migration applied.
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
export function createD1(root) {
  const sqlite = new DatabaseSync(":memory:");
  const failures = [];
  for (const file of readdirSync(path.join(root, "drizzle")).filter((name) => name.endsWith(".sql")).sort()) {
    const sql = readFileSync(path.join(root, "drizzle", file), "utf8").replace(/--> statement-breakpoint/g, "");
    for (const statement of sql.split(/;\s*\n/)) { const text = statement.trim(); if (!text || /^--/.test(text) && !text.includes("\n")) continue; try { sqlite.exec(text); } catch (error) { failures.push(`${file}: ${error.message}`); } }
  }
  const normalise = (value) => value === undefined ? null : typeof value === "boolean" ? (value ? 1 : 0) : value;
  class Statement {
    constructor(sql, params = []) { this.sql = sql; this.params = params; }
    bind(...params) { return new Statement(this.sql, params.map(normalise)); }
    async first(column) { const row = sqlite.prepare(this.sql).get(...this.params); if (!row) return null; return column ? row[column] : { ...row }; }
    async all() { const rows = sqlite.prepare(this.sql).all(...this.params).map((row) => ({ ...row })); return { results: rows, success: true, meta: {} }; }
    async run() { const info = sqlite.prepare(this.sql).run(...this.params); return { success: true, results: [], meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } }; }
    async raw() { return sqlite.prepare(this.sql).all(...this.params).map((row) => Object.values(row)); }
  }
  return {
    failures, sqlite,
    prepare: (sql) => new Statement(sql),
    async batch(statements) { const out = []; sqlite.exec("BEGIN"); try { for (const statement of statements) out.push(await statement.run()); sqlite.exec("COMMIT"); } catch (error) { sqlite.exec("ROLLBACK"); throw error; } return out; },
    async exec(sql) { sqlite.exec(sql); return { count: 1 }; },
  };
}
