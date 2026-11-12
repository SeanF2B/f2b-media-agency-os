import { strFromU8, unzipSync, zipSync } from "fflate";

export const LEAD_EXPORT_HEADERS = ["Owners name", "Company name", "email", "mobile", "city", "website", "gbp", "services", "notes"];

const keyOf = (value) => String(value || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");

function mappedValue(values, aliases) {
  const entries = Object.entries(values || {});
  for (const alias of aliases) {
    const match = entries.find(([key, value]) => keyOf(key) === keyOf(alias) && String(value ?? "").trim());
    if (match) return String(match[1]).trim();
  }
  return "";
}

function ownerFromContacts(value) {
  const text = String(value || "");
  const owner = text.split(/[;\n]+/).map((part) => part.trim()).find((part) => /\b(owner|founder|managing director|director|principal|proprietor|practice owner)\b/i.test(part));
  return owner ? owner.replace(/\s*[—–-]\s*.*$/, "").trim() : "";
}

export function buildLeadExportRows(rows) {
  return (Array.isArray(rows) ? rows : []).filter((row) => row?.keep !== false).map((row) => {
    const values = row?.values || {};
    const contacts = mappedValue(values, ["Outscraper contacts", "Contacts", "Decision maker contacts"]);
    const emails = mappedValue(values, ["email", "Business email", "Published email", "Outscraper emails", "Emails"]);
    const services = mappedValue(values, ["services", "Services offered", "Listed services", "Category", "Business category"]);
    return [
      mappedValue(values, ["Owners name", "Owner name", "Business owner", "Decision-maker name"]) || ownerFromContacts(contacts),
      mappedValue(values, ["Company name", "Business name", "Company", "Name"]),
      emails.split(/[;,\s]+/).find((item) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item)) || "",
      mappedValue(values, ["mobile", "Business mobile", "Mobile number", "Verified mobile", "Cell phone"]),
      mappedValue(values, ["city", "Town"]),
      mappedValue(values, ["website", "Website URL", "Site", "Domain"]),
      mappedValue(values, ["gbp", "Google Business Profile", "Google Maps URL", "Maps URL"]),
      services,
      mappedValue(values, ["Personal line", "Personalised line", "Personalized line", "Outreach note"]),
    ];
  });
}

function csvCell(value) {
  let text = String(value ?? "");
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function buildLeadCsv(rows) {
  const records = buildLeadExportRows(rows);
  return `\ufeff${[LEAD_EXPORT_HEADERS, ...records].map((record) => record.map(csvCell).join(",")).join("\r\n")}`;
}

function xmlEscape(value) {
  return String(value ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function columnName(index) {
  let result = "";
  for (let value = index + 1; value; value = Math.floor((value - 1) / 26)) result = String.fromCharCode(65 + ((value - 1) % 26)) + result;
  return result;
}

export function buildLeadXlsx(rows) {
  const records = [LEAD_EXPORT_HEADERS, ...buildLeadExportRows(rows)];
  const sheetRows = records.map((record, rowIndex) => {
    const cells = record.map((value, columnIndex) => {
      const address = `${columnName(columnIndex)}${rowIndex + 1}`;
      return `<c r="${address}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");
  const files = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Leads" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`,
  };
  return zipSync(Object.fromEntries(Object.entries(files).map(([path, contents]) => [path, new TextEncoder().encode(contents)])));
}

const decodeXml = (value) => value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const columnIndex = (reference) => [...(String(reference).match(/^([A-Z]+)/i)?.[1]?.toUpperCase() || "")].reduce((total, char) => total * 26 + char.charCodeAt(0) - 64, 0) - 1;

function parseSheetXml(xml, sharedStrings) {
  const rows = [];
  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const reference = cellMatch[1].match(/\br="([A-Z]+\d+)"/i)?.[1];
      if (!reference) continue;
      const index = columnIndex(reference);
      const type = cellMatch[1].match(/\bt="([^"]+)"/)?.[1];
      const text = [...cellMatch[2].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((part) => decodeXml(part[1])).join("");
      const raw = cellMatch[2].match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "";
      cells[index] = type === "s" ? sharedStrings[Number(raw)] || "" : type === "inlineStr" ? text : decodeXml(raw);
    }
    rows.push(cells);
  }
  const [headers = [], ...records] = rows;
  const names = headers.map((header) => String(header || "").trim());
  return records.filter((record) => record.some((value) => String(value || "").trim())).map((record, index) => ({ sourceRow: index + 2, values: Object.fromEntries(names.flatMap((name, col) => name ? [[name, String(record[col] ?? "")]] : [])) }));
}

export function parseLeadXlsx(input) {
  const files = unzipSync(input instanceof Uint8Array ? input : new Uint8Array(input));
  const workbook = files["xl/workbook.xml"] ? strFromU8(files["xl/workbook.xml"]) : "";
  const relationships = files["xl/_rels/workbook.xml.rels"] ? strFromU8(files["xl/_rels/workbook.xml.rels"]) : "";
  const relationId = workbook.match(/<sheet\b[^>]*\br:id="([^"]+)"/)?.[1];
  const target = relationId ? relationships.match(new RegExp(`<Relationship\\b(?=[^>]*\\bId="${relationId}")(?=[^>]*\\bTarget="([^"]+)")[^>]*/>`))?.[1] : "worksheets/sheet1.xml";
  const sheetPath = target?.startsWith("/") ? target.slice(1) : `xl/${(target || "worksheets/sheet1.xml").replace(/^\.\//, "")}`;
  const sheet = files[sheetPath] ? strFromU8(files[sheetPath]) : "";
  if (!sheet) throw new Error("This Excel file does not contain a readable first worksheet.");
  const sharedXml = files["xl/sharedStrings.xml"] ? strFromU8(files["xl/sharedStrings.xml"]) : "";
  const sharedStrings = [...sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((item) => [...item[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((part) => decodeXml(part[1])).join(""));
  return parseSheetXml(sheet, sharedStrings);
}
