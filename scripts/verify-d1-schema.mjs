import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const database = process.argv[2] || "f2b-media-agency-os";
const migrationDir = path.join(root, "drizzle");
const wranglerConfig = path.join(root, "dist", "server", "wrangler.json");
const migrations = (await readdir(migrationDir))
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort()
  .map(async (name) => ({ name, sql: await readFile(path.join(migrationDir, name), "utf8") }));
const migrationFiles = await Promise.all(migrations);
if (!migrationFiles.length) throw new Error(`No SQL migrations found in ${migrationDir}`);

const sql = "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name != 'd1_migrations' ORDER BY type, name";
const raw = execFileSync(process.execPath, [
  path.join(root, "node_modules", "wrangler", "bin", "wrangler.js"),
  "d1", "execute", database, "--config", wranglerConfig, "--remote", "--json", "--command", sql,
], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
const remoteResponse = JSON.parse(raw);
const remoteSchema = remoteResponse.flatMap((result) => result.results || []);

const expectedDb = new DatabaseSync(":memory:");
for (const migration of migrationFiles) {
  try {
    expectedDb.exec(migration.sql);
  } catch (error) {
    throw new Error(`Could not replay ${migration.name} in memory: ${error.message}`, { cause: error });
  }
}
const expectedSchema = expectedDb.prepare("SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type, name").all();
expectedDb.close();
const normalize = (value) => String(value).replaceAll("`", "").replaceAll('"', "").replace(/\s+/g, "").toLowerCase();
const signature = (objects) => new Map(objects.map((object) => [`${object.type}:${object.name}`, normalize(object.sql)]));
const actual = signature(remoteSchema);
const expected = signature(expectedSchema);
const missing = [...expected.keys()].filter((key) => !actual.has(key));
const unexpected = [...actual.keys()].filter((key) => !expected.has(key));
const different = [...expected.keys()].filter((key) => actual.has(key) && expected.get(key) !== actual.get(key));

if (missing.length || unexpected.length || different.length) {
  process.stderr.write(`D1 schema does not match the checked-in migrations.\nMissing: ${missing.join(", ") || "none"}\nUnexpected: ${unexpected.join(", ") || "none"}\nDefinition differences: ${different.join(", ") || "none"}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`D1 schema matches ${migrationFiles.length} checked-in migrations (${expected.size} tables and indexes). No rows were read.\n`);
}
