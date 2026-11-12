import test from "node:test";
import assert from "node:assert/strict";
import { unzipSync, strFromU8 } from "fflate";
import { buildLeadCsv, buildLeadExportRows, buildLeadXlsx, LEAD_EXPORT_HEADERS, parseLeadXlsx } from "../lib/lead-export.mjs";

test("lead export uses the exact required nine columns and leaves unknown mobile blank", () => {
  const rows = [
    { keep: true, values: { "Business name": "A & B Roofing", Website: "https://example.ie", "Google Maps URL": "https://maps.example/1", Category: "Roofing contractor", "Outscraper phones": "+353 1 1234567", "Outscraper contacts": "Sam Jones — Owner" } },
    { keep: false, values: { "Business name": "Excluded Supplier" } },
  ];
  assert.deepEqual(LEAD_EXPORT_HEADERS, ["Owners name", "Company name", "email", "mobile", "city", "website", "gbp", "services", "notes"]);
  assert.deepEqual(buildLeadExportRows(rows), [["Sam Jones", "A & B Roofing", "", "", "", "https://example.ie", "https://maps.example/1", "Roofing contractor", ""]]);
});

test("CSV keeps UTF-8, fixed headers, and protects formula-like values", () => {
  const csv = buildLeadCsv([{ keep: true, values: { "Company name": "=HYPERLINK(\"x\")", City: "Dublín" } }]);
  assert.ok(csv.startsWith("\ufeff\"Owners name\",\"Company name\",\"email\",\"mobile\",\"city\",\"website\",\"gbp\",\"services\",\"notes\""));
  assert.match(csv, /'=HYPERLINK/);
  assert.match(csv, /Dublín/);
});

test("XLSX is a readable workbook with the exact ordered headers and escaped text", () => {
  const bytes = buildLeadXlsx([{ keep: true, values: { "Company name": "A & B Roofing", City: "Dublin" } }]);
  const files = unzipSync(bytes);
  const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]);
  assert.ok(sheet.includes("Owners name"));
  assert.ok(sheet.includes("Company name"));
  assert.ok(sheet.includes("email"));
  assert.ok(sheet.includes("mobile"));
  assert.ok(sheet.includes("city"));
  assert.ok(sheet.includes("website"));
  assert.ok(sheet.includes("gbp"));
  assert.ok(sheet.includes("services"));
  assert.ok(sheet.includes("notes"));
  assert.ok(sheet.includes("A &amp; B Roofing"));
  assert.equal((sheet.match(/<row /g) || []).length, 2);
  const imported = parseLeadXlsx(bytes);
  assert.equal(imported.length, 1);
  assert.equal(imported[0].values["Company name"], "A & B Roofing");
  assert.equal(imported[0].values.city, "Dublin");
});
