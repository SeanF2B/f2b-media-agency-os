// A real A4 PDF of a payslip, built with no dependencies (standard Helvetica fonts, optional JPEG logo).
// Used for "Download PDF" and for the attachment when a payslip is emailed to the staff member.
import type { PayslipRecord } from "./payroll-store.ts";

export type PdfLogo = { jpeg: Uint8Array; width: number; height: number };

// Helvetica / Helvetica-Bold advance widths (1/1000 em) for ASCII 32–126.
const W_REG = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const W_BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];

/** Text → WinAnsi bytes (€ is 0x80; Latin-1 accents pass through; anything else becomes "?"). */
function ansi(text: string): number[] {
  const out: number[] = [];
  for (const ch of String(text).normalize("NFC")) {
    const c = ch.codePointAt(0)!;
    if (c === 0x20ac) out.push(0x80);
    else if (c === 0x2013 || c === 0x2014) out.push(c === 0x2013 ? 0x96 : 0x97);
    else if (c === 0x2019 || c === 0x2018) out.push(c === 0x2019 ? 0x92 : 0x91);
    else if (c === 0x2022) out.push(0x95);
    else if (c === 0x00a0 || c === 0x202f) out.push(0x20);
    else if (c >= 0x20 && c <= 0x7e) out.push(c);
    else if (c >= 0xa1 && c <= 0xff) out.push(c);
    else out.push(0x3f);
  }
  return out;
}
function width(text: string, size: number, bold = false) {
  const t = bold ? W_BOLD : W_REG;
  return ansi(text).reduce((n, b) => n + (b >= 32 && b <= 126 ? t[b - 32] : 556), 0) * size / 1000;
}
function fit(text: string, size: number, max: number, bold = false) {
  if (width(text, size, bold) <= max) return text;
  let t = text; while (t.length > 1 && width(`${t}…`, size, bold) > max) t = t.slice(0, -1);
  return `${t}…`;
}
const esc = (bytes: number[]) => bytes.map((b) => b === 0x28 || b === 0x29 || b === 0x5c ? `\\${String.fromCharCode(b)}` : b < 32 || b > 126 ? `\\${b.toString(8).padStart(3, "0")}` : String.fromCharCode(b)).join("");

export function buildPayslipPdf(rec: PayslipRecord, opts: { currency: string; businessName: string; logo?: PdfLogo | null }): Uint8Array {
  const PW = 595.28, PH = 841.89, M = 40;
  const ops: string[] = [];
  const money = (n: number) => { try { return new Intl.NumberFormat("en-IE", { style: "currency", currency: opts.currency }).format(n); } catch { return `€${n.toFixed(2)}`; } };
  const date = (s: string) => s ? new Date(`${s}T12:00:00`).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric" }) : "";
  const y = (top: number) => PH - top; // draw with top-left coordinates
  const color = (hex: string) => { const n = parseInt(hex.slice(1), 16); return `${((n >> 16) & 255) / 255} ${((n >> 8) & 255) / 255} ${(n & 255) / 255}`; };
  const text = (s: string, x: number, top: number, size = 9.5, opt: { bold?: boolean; align?: "left" | "right"; color?: string; max?: number } = {}) => {
    const str = opt.max ? fit(s, size, opt.max, opt.bold) : s;
    const tx = opt.align === "right" ? x - width(str, size, opt.bold) : x;
    ops.push(`BT /${opt.bold ? "F2" : "F1"} ${size} Tf ${color(opt.color || "#101828")} rg ${tx.toFixed(2)} ${y(top).toFixed(2)} Td (${esc(ansi(str))}) Tj ET`);
  };
  const line = (x1: number, top1: number, x2: number, top2: number, w = 0.6, c = "#e4e7ec") => ops.push(`${color(c)} RG ${w} w ${x1.toFixed(2)} ${y(top1).toFixed(2)} m ${x2.toFixed(2)} ${y(top2).toFixed(2)} l S`);
  const box = (x: number, top: number, w: number, h: number, stroke = "#e4e7ec", lw = 0.8, fill?: string) => ops.push(`${fill ? `${color(fill)} rg ` : ""}${color(stroke)} RG ${lw} w ${x.toFixed(2)} ${y(top + h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re ${fill ? "B" : "S"}`);

  const r = rec.result; const contractor = r.employment === "contractor";
  const emp = rec.employer; const name = emp.name || opts.businessName;
  // Header: logo + employer on the left, title on the right
  let lx = M;
  if (opts.logo) {
    const h = 46, w = Math.min(150, (opts.logo.width / Math.max(1, opts.logo.height)) * h);
    ops.push(`q ${w.toFixed(2)} 0 0 ${h} ${M} ${y(M + h).toFixed(2)} cm /Im1 Do Q`);
    lx = M + w + 12;
  }
  text(name, lx, M + 14, 13, { bold: true, max: 300 - (lx - M) });
  let ht = M + 28;
  if (emp.address) { text(emp.address, lx, ht, 8.5, { color: "#475467", max: 320 - (lx - M) }); ht += 12; }
  if (emp.employerNo) { text(`Employer reg. no. ${emp.employerNo}`, lx, ht, 8.5, { color: "#475467" }); ht += 12; }
  text(contractor ? "Payment statement" : "Payslip", PW - M, M + 18, 20, { bold: true, align: "right" });
  text(`No. ${rec.number}`, PW - M, M + 32, 9, { align: "right", color: "#475467" });
  text(`Pay date ${date(rec.payDate)}`, PW - M, M + 44, 9, { align: "right", color: "#475467" });
  let top = Math.max(M + 56, ht + 4);
  line(M, top, PW - M, top, 1.6, "#101828"); top += 12;

  // Meta boxes
  const basis = r.basis === "cumulative" ? "Cumulative" : r.basis === "week1" ? (rec.person.frequency === "monthly" ? "Month 1" : "Week 1") : "Emergency";
  const meta: Array<[string, string, string]> = [
    ["EMPLOYEE", rec.staffName, rec.role],
    ["PPS NUMBER", contractor ? "n/a" : (rec.person.pps || "Not provided"), rec.person.employeeNo ? `Employee no. ${rec.person.employeeNo}` : ""],
    ["PAY PERIOD", `${date(rec.periodStart)} – ${date(rec.periodEnd)}`, contractor ? "Self-employed" : `${rec.person.frequency[0].toUpperCase()}${rec.person.frequency.slice(1)} · period ${r.period} of ${r.periods}`],
    ["TAX DETAILS", contractor ? "Not on PAYE" : `${basis} · PRSI ${r.prsiClass}`, contractor ? "" : `USC ${rec.person.uscStatus}`],
  ];
  const gap = 8, bw = (PW - 2 * M - gap * 3) / 4;
  meta.forEach(([label, value, sub], i) => {
    const bx = M + i * (bw + gap);
    box(bx, top, bw, 44);
    text(label, bx + 7, top + 12, 6.8, { color: "#667085", bold: true });
    text(value, bx + 7, top + 25, 8.6, { bold: true, max: bw - 12 });
    if (sub) text(sub, bx + 7, top + 37, 7.5, { color: "#667085", max: bw - 12 });
  });
  top += 60;

  // Earnings / deductions
  const colW = (PW - 2 * M - 16) / 2;
  const table = (x: number, startTop: number, title: string, rows: Array<[string, string, string?]>, total: [string, string]) => {
    let t = startTop;
    text(title.toUpperCase(), x, t, 7, { bold: true, color: "#667085" }); text("AMOUNT", x + colW, t, 7, { bold: true, color: "#667085", align: "right" });
    t += 6; line(x, t, x + colW, t);
    for (const [label, amount, detail] of rows.slice(0, 14)) {
      t += 13; text(label, x, t, 9, { max: colW - 80 }); text(amount, x + colW, t, 9, { align: "right" });
      if (detail) { t += 10; text(detail, x, t, 7.3, { color: "#667085", max: colW - 10 }); }
      t += 5; line(x, t, x + colW, t, 0.4, "#eaecf0");
    }
    t += 3; line(x, t, x + colW, t, 1.1, "#101828"); t += 13;
    text(total[0], x, t, 9.5, { bold: true }); text(total[1], x + colW, t, 9.5, { bold: true, align: "right" });
    return t;
  };
  const earnRows: Array<[string, string, string?]> = rec.earnings.map((l) => [l.label, money(l.amount), l.detail]);
  const dedRows: Array<[string, string, string?]> = [
    ...(contractor ? [] : [
      ["PAYE income tax", money(r.paye), r.payeHigher > 0 && r.payeStandard > 0 ? `20%: ${money(r.payeStandard)} · 40%: ${money(r.payeHigher)}` : undefined] as [string, string, string?],
      ["USC", money(r.usc)] as [string, string],
      [`PRSI (employee, class ${r.prsiClass})`, money(r.prsiEE)] as [string, string],
      ...(r.pension > 0 ? [[`Pension (${rec.person.pensionPct}%)`, money(r.pension)] as [string, string]] : []),
    ]),
    ...rec.deductions.map((l) => [l.label, money(Math.abs(l.amount))] as [string, string]),
  ];
  const endA = table(M, top, "Earnings", earnRows, ["Gross pay", money(r.gross)]);
  const endB = table(M + colW + 16, top, "Deductions", dedRows, ["Total deductions", money(r.totalDeductions)]);
  top = Math.max(endA, endB) + 18;

  // Net pay
  const nw = 190, nx = PW - M - nw;
  box(nx, top, nw, 52, "#101828", 1.6);
  text("NET PAY", nx + nw - 12, top + 14, 7.5, { bold: true, color: "#667085", align: "right" });
  text(money(r.net), nx + nw - 12, top + 34, 20, { bold: true, align: "right" });
  text(rec.person.paymentMethod || "", nx + nw - 12, top + 46, 7.5, { color: "#667085", align: "right", max: nw - 20 });
  top += 70;

  if (!contractor) {
    const small = (x: number, startTop: number, title: string, rows: Array<[string, string]>) => {
      let t = startTop; text(title.toUpperCase(), x, t, 7, { bold: true, color: "#667085" }); t += 6; line(x, t, x + colW, t);
      for (const [a, b] of rows) { t += 13; text(a, x, t, 8.5); text(b, x + colW, t, 8.5, { align: "right" }); t += 4; line(x, t, x + colW, t, 0.4, "#eaecf0"); }
      return t;
    };
    const a = small(M, top, "This period", [["Tax credits", money(r.taxCredits)], ["Standard rate cut-off point", money(r.srcop)], ["Taxable pay", money(r.taxable)], ["Employer PRSI (paid by employer)", money(r.prsiER)]]);
    const b = small(M + colW + 16, top, `Year to date (${rec.payDate.slice(0, 4)})`, [["Gross pay", money(r.ytd.gross)], ["PAYE", money(r.ytd.paye)], ["USC", money(r.ytd.usc)], ["Employee PRSI", money(r.ytd.prsi)], ["Net pay", money(r.ytd.net)]]);
    top = Math.max(a, b) + 18;
  }
  for (const n of [rec.note, ...r.notes].filter(Boolean)) { text(n, M, top, 8.5, { color: n === rec.note ? "#475467" : "#b54708", max: PW - 2 * M }); top += 13; }
  const foot = `Issued ${new Date(rec.issuedAt).toLocaleDateString("en-IE", { day: "numeric", month: "long", year: "numeric" })}. Earnings from appointment records.${contractor ? "" : ` PAYE, USC and PRSI worked out with ${rec.payDate.slice(0, 4)} Irish rates from the tax credits and cut-off point on file.`}`;
  text(foot, M, PH - M, 7, { color: "#98a2b3", max: PW - 2 * M });

  // ---- assemble the file ----
  const content = ops.join("\n");
  const parts: Array<string | Uint8Array> = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (p: string | Uint8Array) => { parts.push(p); length += typeof p === "string" ? p.length : p.length; };
  const obj = (n: number, body: string | Array<string | Uint8Array>) => { offsets[n] = length; push(`${n} 0 obj\n`); for (const b of Array.isArray(body) ? body : [body]) push(b); push("\nendobj\n"); };
  push("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n");
  const hasLogo = Boolean(opts.logo);
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >>${hasLogo ? " /XObject << /Im1 7 0 R >>" : ""} >> /Contents 6 0 R >>`);
  obj(4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  obj(5, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  obj(6, [`<< /Length ${content.length} >>\nstream\n`, content, "\nendstream"]);
  if (opts.logo) obj(7, [`<< /Type /XObject /Subtype /Image /Width ${opts.logo.width} /Height ${opts.logo.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${opts.logo.jpeg.length} >>\nstream\n`, opts.logo.jpeg, "\nendstream"]);
  const count = hasLogo ? 8 : 7;
  const xref = length;
  push(`xref\n0 ${count}\n0000000000 65535 f \n${offsets.slice(1, count).map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(length); let at = 0;
  for (const p of parts) { if (typeof p === "string") { for (let i = 0; i < p.length; i++) out[at++] = p.charCodeAt(i) & 255; } else { out.set(p, at); at += p.length; } }
  return out;
}

export function bytesToBase64(bytes: Uint8Array) { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); }
