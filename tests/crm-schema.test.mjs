import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

const migration = await readFile(new URL("../drizzle/0041_native_crm.sql", import.meta.url), "utf8");

test("native CRM migration creates contacts, pipelines, opportunities and activity storage", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(migration);
  const names = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name));
  for (const table of ["crm_contacts", "crm_pipelines", "crm_pipeline_stages", "crm_opportunities", "crm_activities"]) assert.ok(names.has(table), `${table} exists`);
  db.close();
});

test("one form submission cannot create duplicate opportunities for the same owner", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(migration);
  db.exec(`INSERT INTO crm_pipelines VALUES ('p','owner','Sales','',0,'now','now');
    INSERT INTO crm_pipeline_stages VALUES ('s','owner','p','New',0,'open','now');
    INSERT INTO crm_contacts VALUES ('c','owner',NULL,'A','','a@example.com','','','form','', 'now','now');
    INSERT INTO crm_opportunities (id,owner_id,pipeline_id,stage_id,contact_id,title,source_submission_id,created_at,updated_at) VALUES ('o','owner','p','s','c','Lead','submission','now','now');`);
  assert.throws(() => db.exec("INSERT INTO crm_opportunities (id,owner_id,pipeline_id,stage_id,title,source_submission_id,created_at,updated_at) VALUES ('o2','owner','p','s','Lead','submission','now','now')"));
  db.close();
});
