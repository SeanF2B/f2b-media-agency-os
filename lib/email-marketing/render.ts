// Email Builder blocks → email-safe HTML (tables + inline styles, works in Gmail/Outlook/Apple Mail).
// Shared by the builder preview (browser) and the campaign sender (worker), so what you see is what is sent.

export type EmailBlock =
  | { id: string; type: "heading"; text: string; align?: "left" | "center"; size?: number }
  | { id: string; type: "text"; text: string; align?: "left" | "center" }
  | { id: string; type: "button"; text: string; url: string; align?: "left" | "center" }
  | { id: string; type: "image"; src: string; alt?: string; url?: string; width?: number }
  | { id: string; type: "divider" }
  | { id: string; type: "spacer"; height?: number };

export type EmailStyle = { brand: string; background: string; card: string; text: string; font: "sans" | "serif"; logo?: string };
export type EmailDoc = { subject: string; preheader?: string; blocks: EmailBlock[]; style: EmailStyle };

export const DEFAULT_STYLE: EmailStyle = { brand: "#0b74b8", background: "#f2f4f7", card: "#ffffff", text: "#1c2330", font: "sans" };
export const BLOCK_TYPES: Array<{ type: EmailBlock["type"]; label: string }> = [
  { type: "heading", label: "Heading" }, { type: "text", label: "Text" }, { type: "button", label: "Button" },
  { type: "image", label: "Image" }, { type: "divider", label: "Divider" }, { type: "spacer", label: "Spacer" },
];
export const MERGE_FIELDS = ["first_name", "last_name", "company", "email"] as const;

export function newBlock(type: EmailBlock["type"]): EmailBlock {
  const id = `b${Math.random().toString(36).slice(2, 9)}`;
  switch (type) {
    case "heading": return { id, type, text: "Your headline here", align: "left", size: 26 };
    case "text": return { id, type, text: "Hi {{first_name}},\n\nWrite your message here.", align: "left" };
    case "button": return { id, type, text: "Book a call", url: "https://", align: "left" };
    case "image": return { id, type, src: "", alt: "", width: 100 };
    case "divider": return { id, type };
    default: return { id, type: "spacer", height: 24 };
  }
}

const esc = (value: string) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const safeUrl = (value?: string) => { const v = String(value || "").trim(); return /^(https?:|mailto:|tel:)/i.test(v) ? v : ""; };
const safeColor = (value: string, fallback: string) => /^#[0-9a-f]{3,8}$/i.test(String(value || "")) ? value : fallback;

/** Replace {{first_name}} etc. Unknown fields are left blank; values are HTML-escaped by the caller. */
export function fillMergeFields(text: string, vars: Record<string, string>) {
  return String(text || "").replace(/\{\{\s*([a-z_]+)\s*(?:\|\s*([^}]*))?\}\}/gi, (_, key: string, fallback?: string) => (vars[key.toLowerCase()] || (fallback || "").trim() || (key.toLowerCase() === "first_name" ? "there" : "")));
}

/** Text with **bold**, line breaks and bare links, escaped. */
function richText(text: string, vars: Record<string, string>, linkColor: string) {
  return esc(fillMergeFields(text, vars))
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(https?:\/\/[^\s<]+)/g, `<a href="$1" style="color:${linkColor};">$1</a>`)
    .replace(/\n/g, "<br>");
}

export function renderEmailHtml(doc: EmailDoc, vars: Record<string, string> = {}, footer?: { unsubscribeUrl?: string; address?: string; sender?: string }) {
  const s = { ...DEFAULT_STYLE, ...(doc.style || {}) };
  const brand = safeColor(s.brand, DEFAULT_STYLE.brand), bg = safeColor(s.background, DEFAULT_STYLE.background), card = safeColor(s.card, DEFAULT_STYLE.card), ink = safeColor(s.text, DEFAULT_STYLE.text);
  const font = s.font === "serif" ? "Georgia,'Times New Roman',serif" : "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  const rows = (doc.blocks || []).map((block) => {
    const align = "align" in block && block.align === "center" ? "center" : "left";
    switch (block.type) {
      case "heading": return `<tr><td style="padding:8px 32px;text-align:${align};"><h1 style="margin:0;font-family:${font};font-size:${Math.min(40, Math.max(16, block.size || 26))}px;line-height:1.25;color:${ink};font-weight:700;">${esc(fillMergeFields(block.text, vars))}</h1></td></tr>`;
      case "text": return `<tr><td style="padding:8px 32px;text-align:${align};font-family:${font};font-size:16px;line-height:1.6;color:${ink};">${richText(block.text, vars, brand)}</td></tr>`;
      case "button": { const url = safeUrl(block.url); return url ? `<tr><td style="padding:14px 32px;text-align:${align};"><a href="${esc(url)}" style="display:inline-block;background:${brand};color:#ffffff;text-decoration:none;font-family:${font};font-size:16px;font-weight:700;padding:13px 26px;border-radius:10px;">${esc(fillMergeFields(block.text, vars))}</a></td></tr>` : ""; }
      case "image": { const src = safeUrl(block.src); if (!src) return ""; const img = `<img src="${esc(src)}" alt="${esc(block.alt || "")}" width="${Math.round(536 * Math.min(100, Math.max(20, block.width || 100)) / 100)}" style="display:block;max-width:100%;height:auto;border:0;border-radius:8px;margin:0 auto;">`; const link = safeUrl(block.url); return `<tr><td style="padding:8px 32px;">${link ? `<a href="${esc(link)}">${img}</a>` : img}</td></tr>`; }
      case "divider": return `<tr><td style="padding:12px 32px;"><div style="border-top:1px solid #e4e7ec;font-size:0;line-height:0;">&nbsp;</div></td></tr>`;
      case "spacer": return `<tr><td style="height:${Math.min(96, Math.max(4, block.height || 24))}px;font-size:0;line-height:0;">&nbsp;</td></tr>`;
      default: return "";
    }
  }).join("");
  const logo = safeUrl(s.logo);
  const foot = footer ? `<tr><td style="padding:20px 32px 28px;text-align:center;font-family:${font};font-size:12px;line-height:1.6;color:#667085;">${footer.sender ? `${esc(footer.sender)}<br>` : ""}${footer.address ? `${esc(footer.address)}<br>` : ""}${footer.unsubscribeUrl ? `<a href="${esc(footer.unsubscribeUrl)}" style="color:#667085;">Unsubscribe</a>` : ""}</td></tr>` : "";
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(fillMergeFields(doc.subject, vars))}</title></head><body style="margin:0;padding:0;background:${bg};">`
    + `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(fillMergeFields(doc.preheader || "", vars))}</div>`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${bg};"><tr><td align="center" style="padding:24px 12px;">`
    + `<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:${card};border-radius:14px;">`
    + (logo ? `<tr><td style="padding:28px 32px 8px;"><img src="${esc(logo)}" alt="" height="40" style="display:block;height:40px;width:auto;border:0;"></td></tr>` : `<tr><td style="height:20px;font-size:0;">&nbsp;</td></tr>`)
    + rows + `<tr><td style="height:16px;font-size:0;">&nbsp;</td></tr></table>`
    + `<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;">${foot}</table>`
    + `</td></tr></table></body></html>`;
}

/** Plain-text version (sent alongside the HTML; better deliverability). */
export function renderEmailText(doc: EmailDoc, vars: Record<string, string> = {}, unsubscribeUrl?: string) {
  const lines = (doc.blocks || []).map((block) => {
    if (block.type === "heading" || block.type === "text") return fillMergeFields(block.text, vars).replace(/\*\*/g, "");
    if (block.type === "button") return safeUrl(block.url) ? `${fillMergeFields(block.text, vars)}: ${block.url}` : "";
    if (block.type === "divider") return "—";
    return "";
  }).filter(Boolean);
  return `${lines.join("\n\n")}${unsubscribeUrl ? `\n\n—\nUnsubscribe: ${unsubscribeUrl}` : ""}`;
}

/** Keeps only valid blocks with sane lengths (used on save and on AI output). */
export function cleanBlocks(input: unknown): EmailBlock[] {
  const list = Array.isArray(input) ? input : [];
  const str = (v: unknown, n: number) => String(v ?? "").slice(0, n);
  const out: EmailBlock[] = [];
  for (const raw of list.slice(0, 60)) {
    const b = (raw || {}) as Record<string, unknown>;
    const id = str(b.id, 24) || `b${Math.random().toString(36).slice(2, 9)}`;
    const align = b.align === "center" ? "center" : "left";
    if (b.type === "heading") out.push({ id, type: "heading", text: str(b.text, 300), align, size: Number(b.size) || 26 });
    else if (b.type === "text") out.push({ id, type: "text", text: str(b.text, 6000), align });
    else if (b.type === "button") out.push({ id, type: "button", text: str(b.text, 80), url: str(b.url, 800), align });
    else if (b.type === "image") out.push({ id, type: "image", src: str(b.src, 1200), alt: str(b.alt, 200), url: str(b.url, 800), width: Number(b.width) || 100 });
    else if (b.type === "divider") out.push({ id, type: "divider" });
    else if (b.type === "spacer") out.push({ id, type: "spacer", height: Number(b.height) || 24 });
  }
  return out;
}
export function cleanStyle(input: unknown): EmailStyle {
  const s = (input || {}) as Record<string, unknown>;
  return { brand: safeColor(String(s.brand || ""), DEFAULT_STYLE.brand), background: safeColor(String(s.background || ""), DEFAULT_STYLE.background), card: safeColor(String(s.card || ""), DEFAULT_STYLE.card), text: safeColor(String(s.text || ""), DEFAULT_STYLE.text), font: s.font === "serif" ? "serif" : "sans", logo: String(s.logo || "").slice(0, 1200) };
}
