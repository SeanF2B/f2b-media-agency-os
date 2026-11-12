import { marketingImageKeyFromUrl } from "./marketing-assets.ts";
import { normalizeMarketingColumns } from "./marketing-columns.ts";

export type ReusableSection = { type: string; heading: string; body: string; imageUrl?: string; imageAlt?: string; buttonLabel?: string; buttonUrl?: string; columns?: Array<{ heading: string; body: string; buttonLabel: string; buttonUrl: string }> };
type DB = D1Database;

function safeHttps(value: unknown) {
  try { const url = new URL(String(value || "")); return url.protocol === "https:" ? url.toString().slice(0, 2000) : ""; } catch { return ""; }
}

export function normalizeMarketingReusableSection(value: unknown): ReusableSection {
  const section = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const type = ["hero", "text", "image", "button", "faq", "testimonial", "pricing", "columns"].includes(String(section.type)) ? String(section.type) : "text";
  const imageUrl = String(section.imageUrl || "");
  const columns = normalizeMarketingColumns(section.columns);
  return {
    type,
    heading: String(section.heading || "").slice(0, 160),
    body: String(section.body || "").slice(0, 4000),
    imageUrl: marketingImageKeyFromUrl(imageUrl) ? imageUrl.slice(0, 2000) : safeHttps(imageUrl),
    imageAlt: String(section.imageAlt || "").slice(0, 300),
    buttonLabel: String(section.buttonLabel || "Learn more").slice(0, 80),
    buttonUrl: safeHttps(section.buttonUrl),
    ...(columns.length ? { columns } : {}),
  };
}

export async function listMarketingReusableBlocks(db: DB, ownerId: string) {
  const rows = await db.prepare("SELECT id, name, data, created_at AS createdAt FROM marketing_reusable_blocks WHERE owner_id = ?1 AND kind = 'funnel' ORDER BY updated_at DESC LIMIT 100").bind(ownerId).all<Record<string, unknown>>();
  return (rows.results || []).map((row) => ({ id: String(row.id), name: String(row.name), section: normalizeMarketingReusableSection(parseData(row.data)), createdAt: String(row.createdAt || "") }));
}

export async function saveMarketingReusableBlock(db: DB, ownerId: string, name: string, rawSection: unknown, now = new Date().toISOString()) {
  const id = crypto.randomUUID();
  const section = normalizeMarketingReusableSection(rawSection);
  await db.prepare("INSERT INTO marketing_reusable_blocks (id, owner_id, kind, name, data, created_at, updated_at) VALUES (?1, ?2, 'funnel', ?3, ?4, ?5, ?5)").bind(id, ownerId, name.trim().replace(/\s+/g, " ").slice(0, 100) || "Reusable section", JSON.stringify(section), now).run();
  return { id, name: name.trim().replace(/\s+/g, " ").slice(0, 100) || "Reusable section", section, createdAt: now };
}

export async function deleteMarketingReusableBlock(db: DB, ownerId: string, id: string) {
  const result = await db.prepare("DELETE FROM marketing_reusable_blocks WHERE owner_id = ?1 AND id = ?2 AND kind = 'funnel'").bind(ownerId, id).run();
  return result.meta.changes === 1;
}

function parseData(value: unknown): unknown { try { return JSON.parse(String(value || "{}")); } catch { return {}; } }
