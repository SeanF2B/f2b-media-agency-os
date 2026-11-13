// Visual, branded SEO and Google Ads client reports (HTML + inline SVG charts). The same HTML is used for the
// in-app preview and the PDF (browser "Save as PDF"), so what you preview is exactly what you download.
// Real figures only: unavailable sections show "Unavailable" with the reason, never zero.
import type { ClientReport, Section } from "./client-report-data";

type Opts = { origin: string; agencyIconUrl: string };
const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const safeImg = (url: string) => (/^(https:\/\/|data:image\/(png|jpe?g|webp|gif|svg\+xml);base64,)/i.test(url) ? url : "");

/* ------------------------------------------------------------------ icons (simple line icons) */
const ICON: Record<string, string> = {
  coins: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/><path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/>',
  cursor: '<path d="M5 3l14 7-6 2-2 6z"/><path d="M13 12l5 5"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/><circle cx="17" cy="9" r="2.8"/><path d="M16.5 14.3c2.6.2 4.4 2 4.9 4.7"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.6 2.6L16.5 9"/>',
  funnel: '<path d="M3 4h18l-7 8v6l-4 2v-8z"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H4.5a3 3 0 0 0 3.5 4M16 6h3.5a3 3 0 0 1-3.5 4"/><path d="M12 13v4M8.5 20h7M10 17h4v3h-4z"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  gauge: '<path d="M4 16a8 8 0 1 1 16 0"/><path d="M12 16l4-5"/>',
  tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.5"/>',
  userCheck: '<circle cx="10" cy="8" r="3.5"/><path d="M3.5 20c.6-3.6 3.2-5.5 6.5-5.5 1.4 0 2.6.3 3.6.9"/><path d="M15 18l2 2 4-4"/>',
  percent: '<path d="M19 5L5 19"/><circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/>',
  megaphone: '<path d="M3 10v4h3l7 5V5L6 10z"/><path d="M17 9a4 4 0 0 1 0 6"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  trend: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  shop: '<path d="M4 9l1.5-5h13L20 9"/><path d="M4 9a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0"/><path d="M5 11v9h14v-9M10 20v-5h4v5"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
  route: '<path d="M12 2l3 7h-6zM12 9v13"/><path d="M5 22h14"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.3 3 14.7 0 18M12 3c-3 3.3-3 14.7 0 18"/>',
  bot: '<rect x="4" y="8" width="16" height="11" rx="3"/><path d="M12 4v4M8.5 13h.01M15.5 13h.01M9 16.5h6"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
};
const icon = (name: string, size = 22) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name] || ""}</svg>`;
const tile = (name: string, tone: string) => `<span class="tile ${tone}">${icon(name)}</span>`;

/* ------------------------------------------------------------------ formatting */
function fmt(report: ClientReport) {
  const currency = report.client.currency;
  const money = (v: number | null | undefined, digits = 0) => v == null || !Number.isFinite(v) ? "—" : new Intl.NumberFormat("en-IE", { style: "currency", currency, maximumFractionDigits: digits, minimumFractionDigits: digits }).format(v);
  const num = (v: number | null | undefined, digits = 0) => v == null || !Number.isFinite(v) ? "—" : new Intl.NumberFormat("en-IE", { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(v);
  const pct = (v: number | null | undefined, digits = 0) => v == null || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(digits)}%`;
  return { money, num, pct };
}
/** Change pill. lowerIsBetter flips the colour (spend, cost per lead). */
function change(current: number | null | undefined, previous: number | null | undefined, lowerIsBetter = false, mode: "pct" | "pp" | "abs" = "pct") {
  if (current == null || previous == null || !Number.isFinite(current) || !Number.isFinite(previous)) return "";
  let delta: number, text: string;
  if (mode === "pp") { delta = (current - previous) * 100; text = `${delta >= 0 ? "+" : ""}${delta.toFixed(1)} pp`; }
  else if (mode === "abs") { delta = current - previous; text = `${delta >= 0 ? "+" : ""}${Math.round(delta * 10) / 10}`; }
  else { if (previous === 0) return current === 0 ? `<span class="pill flat">0%</span>` : `<span class="pill ${lowerIsBetter ? "bad" : "good"}">New</span>`; delta = (current - previous) / Math.abs(previous) * 100; text = `${delta >= 0 ? "+" : ""}${Math.round(delta)}%`; }
  if (Math.abs(delta) < 0.05) return `<span class="pill flat">${esc(text)}</span>`;
  const good = lowerIsBetter ? delta < 0 : delta > 0;
  return `<span class="pill ${good ? "good" : "bad"}">${delta > 0 ? "↑" : "↓"} ${esc(text.replace(/^[+-]/, ""))}</span>`;
}
const unavailable = (section?: Section<unknown>, fallback = "Unavailable") => `<div class="na">${icon("info", 16)}<span><b>${section?.status === "not_connected" ? "Not connected" : "Unavailable"}</b> ${esc(section?.note || fallback)}</span></div>`;
const stamp = (section?: Section<unknown>) => section?.status === "ok" && section.updatedAt ? `<span class="stamp">${icon("clock", 12)} Updated ${esc(new Date(section.updatedAt).toLocaleString("en-IE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }))}</span>` : "";
const monthLabel = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-IE", { month: "short", timeZone: "UTC" });
const dayLabel = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IE", { day: "numeric", month: "short", timeZone: "UTC" });

/* ------------------------------------------------------------------ charts (inline SVG) */
function comboChart(rows: Array<{ label: string; a: number; b: number; line: number | null }>, labels: [string, string, string], fmtLine: (v: number) => string) {
  const W = 560, H = 230, L = 40, R = 56, T = 14, B = 34, iw = W - L - R, ih = H - T - B;
  const maxBar = Math.max(1, ...rows.map((r) => Math.max(r.a, r.b)));
  const maxLine = Math.max(1, ...rows.map((r) => r.line || 0));
  const step = iw / Math.max(1, rows.length), bw = Math.min(26, step / 3.2);
  const y = (v: number) => T + ih - (v / maxBar) * ih, yl = (v: number) => T + ih - (v / maxLine) * ih;
  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => `<line x1="${L}" x2="${W - R}" y1="${T + ih - f * ih}" y2="${T + ih - f * ih}" class="grid"/><text x="${L - 8}" y="${T + ih - f * ih + 4}" class="axis" text-anchor="end">${Math.round(maxBar * f)}</text><text x="${W - R + 8}" y="${T + ih - f * ih + 4}" class="axis">${esc(fmtLine(maxLine * f))}</text>`).join("");
  const bars = rows.map((r, i) => { const cx = L + step * i + step / 2; return `<rect x="${cx - bw - 2}" y="${y(r.a)}" width="${bw}" height="${T + ih - y(r.a)}" rx="4" class="bar-a"/><rect x="${cx + 2}" y="${y(r.b)}" width="${bw}" height="${T + ih - y(r.b)}" rx="4" class="bar-b"/><text x="${cx}" y="${H - 12}" class="axis" text-anchor="middle">${esc(r.label)}</text>`; }).join("");
  const pts = rows.map((r, i) => r.line == null ? null : [L + step * i + step / 2, yl(r.line)] as const).filter(Boolean) as Array<readonly [number, number]>;
  const line = pts.length ? `<polyline points="${pts.map((p) => p.join(",")).join(" ")}" class="line"/>${pts.map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="4.5" class="dot"/>`).join("")}` : "";
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="${esc(labels.join(", "))}">${grid}${bars}${line}</svg><div class="legend"><span><i class="sw a"></i>${esc(labels[0])}</span><span><i class="sw b"></i>${esc(labels[1])}</span><span><i class="sw ln"></i>${esc(labels[2])}</span></div>`;
}
function areaChart(rows: Array<{ label: string; value: number; previous: number | null }>) {
  const W = 560, H = 210, L = 44, R = 22, T = 12, B = 28, iw = W - L - R, ih = H - T - B;
  const max = Math.max(1, ...rows.map((r) => Math.max(r.value, r.previous || 0)));
  const x = (i: number) => L + (rows.length < 2 ? iw / 2 : (i / (rows.length - 1)) * iw), y = (v: number) => T + ih - (v / max) * ih;
  const path = (key: "value" | "previous") => rows.map((r, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y((r[key] as number) || 0).toFixed(1)}`).join(" ");
  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => `<line x1="${L}" x2="${W - R}" y1="${T + ih - f * ih}" y2="${T + ih - f * ih}" class="grid"/><text x="${L - 8}" y="${T + ih - f * ih + 4}" class="axis" text-anchor="end">${Math.round(max * f).toLocaleString("en-IE")}</text>`).join("");
  const ticks = rows.map((r, i) => (i % Math.max(1, Math.ceil(rows.length / 7)) === 0 || i === rows.length - 1) ? `<text x="${x(i)}" y="${H - 8}" class="axis" text-anchor="middle">${esc(r.label)}</text>` : "").join("");
  const hasPrev = rows.some((r) => r.previous != null);
  const last = rows[rows.length - 1];
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Organic traffic this period and last period"><defs><linearGradient id="ag" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--blue)" stop-opacity=".28"/><stop offset="1" stop-color="var(--blue)" stop-opacity="0"/></linearGradient></defs>${grid}${hasPrev ? `<path d="${path("previous")}" class="line-prev"/>` : ""}<path d="${path("value")} L${x(rows.length - 1)},${T + ih} L${x(0)},${T + ih} Z" fill="url(#ag)"/><path d="${path("value")}" class="line-blue"/>${last ? `<circle cx="${x(rows.length - 1)}" cy="${y(last.value)}" r="5" class="dot-blue"/>` : ""}${ticks}</svg>`;
}
function donut(parts: Array<{ value: number; color: string }>, centerBig: string, centerSmall: string, size = 150) {
  const total = parts.reduce((s, p) => s + p.value, 0); const r = 54, c = 2 * Math.PI * r; let offset = 0;
  const arcs = total ? parts.filter((p) => p.value > 0).map((p) => { const len = (p.value / total) * c; const seg = `<circle cx="70" cy="70" r="${r}" fill="none" stroke="${p.color}" stroke-width="20" stroke-dasharray="${len} ${c - len}" stroke-dashoffset="${-offset}" transform="rotate(-90 70 70)"/>`; offset += len; return seg; }).join("") : `<circle cx="70" cy="70" r="${r}" fill="none" stroke="#e6ebf1" stroke-width="20"/>`;
  return `<svg viewBox="0 0 140 140" width="${size}" height="${size}" class="donut" role="img" aria-label="${esc(`${centerBig} ${centerSmall}`)}"><circle cx="70" cy="70" r="${r}" fill="none" stroke="#eef2f6" stroke-width="20"/>${arcs}<text x="70" y="${centerSmall.includes(" ") && centerSmall.length > 10 ? 62 : 68}" text-anchor="middle" class="donut-big">${esc(centerBig)}</text>${centerSmall.includes(" ") && centerSmall.length > 10 ? centerSmall.split(" ").slice(0, 2).map((word, i) => `<text x="70" y="${82 + i * 13}" text-anchor="middle" class="donut-small">${esc(word)}</text>`).join("") : `<text x="70" y="88" text-anchor="middle" class="donut-small">${esc(centerSmall)}</text>`}</svg>`;
}
function groupedBars(groups: Array<{ label: string; prev: number | null; cur: number | null; fmt: (v: number) => string; delta: string }>, legend: [string, string]) {
  return `<div class="gbars">${groups.map((g) => { const max = Math.max(1, g.prev || 0, g.cur || 0); const h = (v: number | null) => v == null ? 0 : Math.max(4, (v / max) * 110); return `<div class="gb"><div class="gb-bars"><div class="gb-col"><small>${g.prev == null ? "—" : esc(g.fmt(g.prev))}</small><i class="p" style="height:${h(g.prev)}px"></i></div><div class="gb-col"><small><b>${g.cur == null ? "—" : esc(g.fmt(g.cur))}</b></small><i class="c" style="height:${h(g.cur)}px"></i></div></div><span>${esc(g.label)}</span>${g.delta}</div>`; }).join("")}</div><div class="legend right"><span><i class="sw p"></i>${esc(legend[0])}</span><span><i class="sw c"></i>${esc(legend[1])}</span></div>`;
}
function sparkline(values: number[]) {
  if (values.length < 2) return "";
  const W = 200, H = 64, max = Math.max(...values), min = Math.min(...values), span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * W},${H - 6 - ((v - min) / span) * (H - 14)}`);
  return `<svg viewBox="0 0 ${W} ${H}" class="spark" aria-hidden="true"><defs><linearGradient id="sg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#22a35a" stop-opacity=".3"/><stop offset="1" stop-color="#22a35a" stop-opacity="0"/></linearGradient></defs><path d="M${pts.join(" L")} L${W},${H} L0,${H} Z" fill="url(#sg)"/><polyline points="${pts.join(" ")}" fill="none" stroke="#22a35a" stroke-width="2.5"/><circle cx="${pts[pts.length - 1].split(",")[0]}" cy="${pts[pts.length - 1].split(",")[1]}" r="3.5" fill="#22a35a"/></svg>`;
}

/* ------------------------------------------------------------------ building blocks */
const card = (cls: string, title: string, iconName: string, tone: string, body: string, opts: { sub?: string; section?: Section<unknown>; extra?: string } = {}) => `<section class="card ${cls}"><header class="card-h"><span class="h-ico ${tone}">${icon(iconName)}</span><div><h2>${esc(title)}${opts.extra || ""}</h2>${opts.sub ? `<p>${esc(opts.sub)}</p>` : ""}</div>${stamp(opts.section)}</header>${body}</section>`;
const kpi = (iconName: string, tone: string, label: string, value: string, pill: string, sub = "") => `<div class="kpi">${tile(iconName, tone)}<span class="k-label">${esc(label)}</span><b class="k-value">${value}</b><span class="k-foot">${pill}${sub ? `<small>${sub}</small>` : ""}</span></div>`;
// Official product logos (Google Ads, ChatGPT, Claude) are shown only when the file has been added to
// public/brand/. Until then the product name is shown on its own — logos are never redrawn by hand.
export const BRAND_LOGO_FILES = new Set<string>([]);
const brandLogo = (origin: string, file: string, name: string, cls = "") => `<span class="brand ${cls}">${BRAND_LOGO_FILES.has(file) ? `<img src="${esc(`${origin}/brand/${file}`)}" alt="">` : ""}<b>${esc(name)}</b></span>`;
const list = (items: string[], kind: "done" | "next") => items.length ? `<ol class="${kind}">${items.map((item, i) => `<li>${kind === "done" ? `<span class="ok">${icon("check", 18)}</span>` : `<span class="num">${i + 1}</span>`}<span>${esc(item)}</span></li>`).join("")}</ol>` : `<p class="muted">${kind === "done" ? "No completed tasks were recorded for this period." : "No recommendations yet — they appear when the data supports one."}</p>`;

function periodText(report: ClientReport) {
  const f = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return { current: `${f(report.period.start)} – ${f(report.period.end)}`, previous: `${f(report.comparison.start)} – ${f(report.comparison.end)}` };
}
function isCalendarMonth(report: ClientReport) {
  const s = new Date(`${report.period.start}T00:00:00Z`), e = new Date(`${report.period.end}T00:00:00Z`);
  const next = new Date(e); next.setUTCDate(e.getUTCDate() + 1);
  return s.getUTCDate() === 1 && next.getUTCDate() === 1 && s.getUTCMonth() === e.getUTCMonth();
}
function header(report: ClientReport, o: Opts, title: string, subtitle: string, product?: string) {
  const logo = safeImg(report.client.logo);
  const p = periodText(report);
  return `<header class="top"><div class="client">${logo ? `<img src="${esc(logo)}" alt="${esc(report.client.name)}">` : `<span class="client-name">${esc(report.client.name)}</span>`}</div><div class="title">${product || ""}<h1>${esc(title)}</h1><p>${esc(subtitle)}</p><div class="period"><span>${icon("calendar", 18)} <b>Reporting period:</b> ${esc(p.current)}</span><span class="sep"></span><span><b>Compared to:</b> ${esc(p.previous)}</span></div></div><div class="agency">${o.agencyIconUrl ? `<img src="${esc(o.agencyIconUrl)}" alt="">` : ""}</div></header>`;
}
function footer(report: ClientReport, sources: Array<Section<unknown> | undefined>) {
  const used = [...new Set(sources.filter((s) => s?.status === "ok" && s.source).map((s) => s!.source!))];
  const next = new Date(`${report.period.end}T00:00:00Z`); next.setUTCMonth(next.getUTCMonth() + 1);
  return `<footer class="foot"><div class="foot-main">${icon("info", 20)}<div><b>Real data only.</b> Sources: ${esc(used.join(" · ") || "none connected")}. Pipeline value is an <b>estimate</b> from open CRM deals; won revenue is <b>actual</b> from deals marked Won. ${report.attribution.data ? esc(report.attribution.data.qualifiedRule) : ""} Each lead is credited to one channel only, so SEO and Google Ads never double-count.${report.missing.length ? `<div class="missing"><b>Not included (missing or not connected):</b> ${report.missing.map((m) => `${esc(m.label)} — ${esc(m.note)}`).join(" · ")}</div>` : ""}</div></div><div class="foot-side">${icon("calendar", 18)}<span>Generated ${esc(new Date(report.generatedAt).toLocaleString("en-IE", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }))}<br><b>Next report:</b> ${esc(next.toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }))}</span></div></footer>`;
}

/* ------------------------------------------------------------------ Google Ads report */
function adsBody(report: ClientReport, o: Opts) {
  const { money, num, pct } = fmt(report);
  const ads = report.ads?.status === "ok" ? report.ads.data! : null;
  const a = report.attribution.status === "ok" ? report.attribution.data! : null;
  const cur = a?.current, prev = a?.previous;
  const spend = ads?.current.spend ?? null, prevSpend = ads?.previous?.spend ?? null;
  const cpl = spend != null && cur?.leads ? spend / cur.leads : null, prevCpl = prevSpend != null && prev?.leads ? prevSpend / prev.leads : null;
  const cpql = spend != null && cur?.qualified ? spend / cur.qualified : null, prevCpql = prevSpend != null && prev?.qualified ? prevSpend / prev.qualified : null;
  const roas = spend && cur && cur.wonRevenue > 0 ? cur.wonRevenue / spend : null, prevRoas = prevSpend && prev && prev.wonRevenue > 0 ? prev.wonRevenue / prevSpend : null;
  const convRate = ads && ads.current.clicks ? ads.current.conversions / ads.current.clicks : null, prevConvRate = ads?.previous && ads.previous.clicks ? ads.previous.conversions / ads.previous.clicks : null;
  const na = "<span class=\"na-inline\">Unavailable</span>";
  const kpis = `<div class="kpis k7">${[
    kpi("coins", "blue", "Ad Spend", ads ? money(spend, 0) : na, change(spend, prevSpend, true)),
    kpi("cursor", "blue", "Clicks", ads ? num(ads.current.clicks) : na, change(ads?.current.clicks, ads?.previous?.clicks)),
    kpi("target", "red", "Conversions", ads ? num(ads.current.conversions, 1) : na, change(ads?.current.conversions, ads?.previous?.conversions), "Google-reported"),
    kpi("users", "violet", "Leads", cur ? num(cur.leads) : na, change(cur?.leads, prev?.leads), "CRM-verified"),
    kpi("check", "green", "Qualified Leads", cur ? num(cur.qualified) : na, change(cur?.qualified, prev?.qualified)),
    kpi("funnel", "blue", "Pipeline Value", cur ? money(cur.pipelineValue) : na, change(cur?.pipelineValue, prev?.pipelineValue), "Estimated"),
    kpi("trophy", "amber", "Won Revenue", cur ? money(cur.wonRevenue) : na, change(cur?.wonRevenue, prev?.wonRevenue), "Actual"),
  ].join("")}</div>`;
  const trend = a ? comboChart(a.trend.map((t) => ({ label: monthLabel(t.month), a: t.leads, b: t.qualified, line: t.wonRevenue })), ["Leads", "Qualified Leads", "Won Revenue"], (v) => money(v, 0)) : unavailable(report.attribution);
  const kpiCard = (iconName: string, label: string, value: string, pill: string, vs: string) => `<div class="mini">${icon(iconName, 30)}<div><span>${esc(label)}</span><b>${value}${pill}</b><small>${vs}</small></div></div>`;
  const roasNote = roas == null ? (cur && cur.wonRevenue === 0 ? "No won revenue attributed yet" : "Needs Google Ads spend and won deals") : `(vs. ${prevRoas == null ? "—" : `${prevRoas.toFixed(1)}x`})`;
  const kpiBlock = `<div class="minis">${kpiCard("tag", "Cost per Lead", money(cpl, 2), change(cpl, prevCpl, true), `(vs. ${money(prevCpl, 2)})`)}${kpiCard("userCheck", "Cost per Qualified Lead", money(cpql, 2), change(cpql, prevCpql, true), `(vs. ${money(prevCpql, 2)})`)}${kpiCard("chart", "ROAS", roas == null ? "—" : `${roas.toFixed(1)}x`, change(roas, prevRoas), esc(roasNote))}${kpiCard("percent", "Conversion Rate", pct(convRate, 1), change(convRate, prevConvRate, false, "pp"), `(vs. ${pct(prevConvRate, 1)})`)}</div>`;
  // Campaign table: Google metrics + CRM leads matched by UTM campaign name.
  const leadsFor = (name: string) => cur?.byCampaign.find((c) => c.campaign.toLowerCase() === name.toLowerCase() || (c.campaign && name.toLowerCase().includes(c.campaign.toLowerCase())));
  const campaigns = (ads?.campaigns || []).filter((c) => c.spend > 0 || c.clicks > 0).sort((x, y) => y.spend - x.spend).slice(0, 8);
  const unmatched = cur?.byCampaign.find((c) => c.campaign === "Not matched to a campaign");
  const campaignRows = campaigns.map((c) => { const l = leadsFor(c.name); const r = l && l.wonRevenue > 0 && c.spend ? l.wonRevenue / c.spend : null; return `<tr><td><i class="dot-g"></i>${esc(c.name)}</td><td>${money(c.spend, 0)}</td><td>${num(c.clicks)}</td><td>${num(c.conversions, 1)}</td><td>${l ? num(l.leads) : "—"}</td><td>${l && l.leads ? money(c.spend / l.leads, 2) : "—"}</td><td>${r == null ? "—" : `<span class="roas">${r.toFixed(1)}x</span>`}</td></tr>`; }).join("");
  const campaignTable = ads ? `<table class="t"><thead><tr><th>Campaign</th><th>Spend</th><th>Clicks</th><th>Conversions</th><th>Leads</th><th>Cost / Lead</th><th>ROAS</th></tr></thead><tbody>${campaignRows || `<tr><td colspan="7" class="muted">No campaign activity in this period.</td></tr>`}</tbody><tfoot><tr><td>Total</td><td>${money(spend, 0)}</td><td>${num(ads.current.clicks)}</td><td>${num(ads.current.conversions, 1)}</td><td>${cur ? num(cur.leads) : "—"}</td><td>${money(cpl, 2)}</td><td>${roas == null ? "—" : `${roas.toFixed(1)}x`}</td></tr></tfoot></table>${unmatched ? `<p class="note">${unmatched.leads} Google Ads lead${unmatched.leads === 1 ? "" : "s"} arrived without a campaign name (no UTM campaign) and are counted in the total only.</p>` : ""}` : unavailable(report.ads);
  const mom = (label: string, p: number | null | undefined, c: number | null | undefined, f: (v: number) => string, lower = false) => `<tr><td>${esc(label)}</td><td>${p == null ? "—" : esc(f(p))}</td><td>${c == null ? "—" : esc(f(c))}</td><td>${change(c, p, lower) || "—"}</td></tr>`;
  const momTable = `<table class="t compact"><thead><tr><th>Metric</th><th>Previous</th><th>This period</th><th>Change</th></tr></thead><tbody>${mom("Ad Spend", prevSpend, spend, (v) => money(v, 0), true)}${mom("Clicks", ads?.previous?.clicks, ads?.current.clicks, (v) => num(v))}${mom("Conversions", ads?.previous?.conversions, ads?.current.conversions, (v) => num(v, 1))}${mom("Leads", prev?.leads, cur?.leads, (v) => num(v))}${mom("Qualified Leads", prev?.qualified, cur?.qualified, (v) => num(v))}${mom("Pipeline Value", prev?.pipelineValue, cur?.pipelineValue, (v) => money(v))}${mom("Won Revenue", prev?.wonRevenue, cur?.wonRevenue, (v) => money(v))}</tbody></table>`;
  // Lead sources donut: CRM leads by campaign; fall back to Google-reported conversions by campaign.
  const palette = ["#1f6feb", "#22a35a", "#f2b21b", "#b79cf3", "#ef6b6b"];
  const fromCrm = (cur?.byCampaign || []).filter((c) => c.leads > 0);
  const sourceRows = fromCrm.length ? fromCrm.map((c) => ({ name: c.campaign, value: c.leads })) : (ads?.campaigns || []).filter((c) => c.conversions > 0).map((c) => ({ name: c.name, value: c.conversions }));
  const top = sourceRows.sort((x, y) => y.value - x.value).slice(0, 4); const rest = sourceRows.slice(4).reduce((s, r) => s + r.value, 0); if (rest) top.push({ name: "Other", value: rest });
  const total = top.reduce((s, r) => s + r.value, 0);
  const sources = total ? `<div class="donut-row">${donut(top.map((r, i) => ({ value: r.value, color: palette[i % palette.length] })), num(total, fromCrm.length ? 0 : 1), fromCrm.length ? "Leads" : "Conversions")}<ul class="keys">${top.map((r, i) => `<li><i style="background:${palette[i % palette.length]}"></i><span class="kname">${esc(r.name)}</span><b>${Math.round(r.value / total * 100)}%</b></li>`).join("")}</ul></div>${fromCrm.length ? "" : `<p class="note">No CRM-verified Google Ads leads yet, so this shows Google-reported conversions.</p>`}` : `<p class="muted">No leads or conversions recorded in this period.</p>`;
  const qShare = cur && cur.leads ? cur.qualified / cur.leads : null;
  const quality = cur && cur.leads ? `<div class="donut-row">${donut([{ value: cur.qualified, color: "#22a35a" }, { value: cur.leads - cur.qualified, color: "#d5dde6" }], pct(qShare), "Qualified")}<ul class="keys"><li><i style="background:#22a35a"></i><span class="kname">Qualified Leads</span><b>${num(cur.qualified)}</b></li><li><i style="background:#d5dde6"></i><span class="kname">Other Leads</span><b>${num(cur.leads - cur.qualified)}</b></li></ul></div>` : cur ? `<p class="muted">No CRM-verified Google Ads leads in this period.</p>` : unavailable(report.attribution);
  const rev = (iconName: string, tone: string, label: string, value: string, pill: string, sub: string) => `<div class="rev ${tone}">${icon(iconName, 28)}<span>${esc(label)}</span><b>${value}</b>${pill}<small>${esc(sub)}</small></div>`;
  const revenue = `<div class="revs">${rev("funnel", "violet", "Pipeline Value", cur ? money(cur.pipelineValue) : "—", change(cur?.pipelineValue, prev?.pipelineValue), "Estimated · open deals")}${rev("trophy", "amber", "Won Revenue", cur ? money(cur.wonRevenue) : "—", change(cur?.wonRevenue, prev?.wonRevenue), "Actual · won deals")}${rev("trend", "green", "ROAS", roas == null ? "—" : `${roas.toFixed(1)}x`, change(roas, prevRoas), roas == null ? "Shown once won revenue is attributed" : "Won revenue ÷ ad spend")}</div>`;
  return `${header(report, o, isCalendarMonth(report) ? "Monthly Performance Report" : "Performance Report", "Paid advertising results, leads and business growth", brandLogo(o.origin, "google-ads.svg", "Google Ads", "product"))}
${kpis}
<div class="row r-6-4">${card("", "Leads & Revenue Trend", "chart", "blue", trend, { sub: "Monthly leads, qualified leads and won revenue (last 6 months)", section: report.attribution })}${card("", "Key Performance Indicators", "gauge", "blue", ads ? kpiBlock : unavailable(report.ads), { section: report.ads })}</div>
<div class="row r-6-4">${card("", "Campaign Performance", "megaphone", "blue", campaignTable, { sub: `Results by campaign (${periodText(report).current})`, section: report.ads })}${card("", "Period-on-Period Comparison", "layers", "blue", momTable, { sub: `${periodText(report).current} vs. ${periodText(report).previous}` })}</div>
<div class="row r-3">${card("", "Conversion Sources (Leads)", "pin", "blue", sources)}${card("", "Lead Quality", "users", "blue", quality)}${card("", "Revenue Attribution", "coins", "blue", revenue, { extra: " <small>(Google Ads)</small>" })}</div>
<div class="row r-5-5">${card("done-card", "Completed Optimisations", "check", "green", list(report.work.completed.map((t) => t.title), "done"))}${card("next-card", "Recommendations for Next Period", "target", "blue", list(report.recommendations, "next"))}</div>
${footer(report, [report.ads, report.attribution])}`;
}

/* ------------------------------------------------------------------ SEO report */
function seoBody(report: ClientReport, o: Opts) {
  const { money, num, pct } = fmt(report);
  const a = report.attribution.status === "ok" ? report.attribution.data! : null;
  const cur = a?.current, prev = a?.previous;
  const na = "<span class=\"na-inline\">Unavailable</span>";
  const vs = (v: number | null | undefined, f: (x: number) => string) => v == null ? "" : `vs. ${esc(f(v))} last period`;
  const kpis = `<div class="kpis k4">${[
    kpi("users", "violet", "SEO Leads", cur ? num(cur.leads) : na, change(cur?.leads, prev?.leads), vs(prev?.leads, (x) => num(x))),
    kpi("funnel", "violet", "Qualified Leads", cur ? num(cur.qualified) : na, change(cur?.qualified, prev?.qualified), vs(prev?.qualified, (x) => num(x))),
    kpi("layers", "teal", "Pipeline Value", cur ? money(cur.pipelineValue) : na, change(cur?.pipelineValue, prev?.pipelineValue), `Estimated · ${vs(prev?.pipelineValue, (x) => money(x)) || "open deals"}`),
    kpi("trophy", "amber", "Won Revenue", cur ? money(cur.wonRevenue) : na, change(cur?.wonRevenue, prev?.wonRevenue), `Actual · ${vs(prev?.wonRevenue, (x) => money(x)) || "won deals"}`),
  ].join("")}</div>`;
  const t = report.traffic?.status === "ok" ? report.traffic.data! : null;
  const traffic = t ? `<div class="big-line"><b>${num(t.current)}</b>${change(t.current, t.previous)}<span class="legend inline"><span><i class="sw c"></i>This period</span>${t.previous != null ? `<span><i class="sw p"></i>Previous period</span>` : ""}</span></div><p class="sub">${esc(t.metric)}</p>${areaChart(t.daily.map((d) => ({ label: dayLabel(d.date), value: d.value, previous: d.previous })))}` : unavailable(report.traffic);
  const rk = report.rankings?.status === "ok" ? report.rankings.data! : null;
  const greens = ["#16a34a", "#4ade80", "#a7f3d0", "#cbd5e1"];
  const rankOverview = rk ? `<div class="donut-row">${donut(rk.buckets.map((b, i) => ({ value: b.count, color: greens[i] })), num(rk.tracked), "Keywords Tracked", 170)}<ul class="keys big">${rk.buckets.map((b, i) => `<li><i style="background:${greens[i]}"></i><span class="kname">${esc(b.label)}</span><b>${num(b.count)}</b>${b.change == null ? "" : change(b.count, b.count - b.change, i === 3, "abs")}</li>`).join("")}</ul></div><p class="note">${esc(rk.basis)}.</p>` : unavailable(report.rankings);
  const kwTable = rk ? `<table class="t"><thead><tr><th>Keyword</th><th>Search vol.</th><th>Rank (now)</th><th>Rank (before)</th><th>Movement</th></tr></thead><tbody>${rk.keywords.slice(0, 8).map((k) => `<tr><td>${esc(k.keyword)}</td><td>${k.volume == null ? "—" : num(k.volume)}</td><td><b>${k.position == null ? "—" : num(k.position, 1)}</b></td><td>${k.previousPosition == null ? "—" : num(k.previousPosition, 1)}</td><td>${k.change == null ? "—" : k.change === 0 ? `<span class="pill flat">0</span>` : `<span class="pill ${k.change > 0 ? "good" : "bad"}">${k.change > 0 ? "↑" : "↓"} ${num(Math.abs(k.change), 1)}</span>`}</td></tr>`).join("")}</tbody></table>${rk.keywords.some((k) => k.volume == null) ? `<p class="note">Search volume shows “—” until keyword research has been run for that keyword (DataForSEO / Google Ads Keyword Planner).</p>` : ""}` : unavailable(report.rankings);
  const momGroups = groupedBars([
    { label: t ? (t.metric.startsWith("Organic clicks") ? "Organic Clicks" : "Organic Traffic") : "Organic Traffic", prev: t?.previous ?? null, cur: t?.current ?? null, fmt: (v) => num(v), delta: change(t?.current, t?.previous) },
    { label: "SEO Leads", prev: prev?.leads ?? null, cur: cur?.leads ?? null, fmt: (v) => num(v), delta: change(cur?.leads, prev?.leads) },
    { label: "Won Revenue", prev: prev?.wonRevenue ?? null, cur: cur?.wonRevenue ?? null, fmt: (v) => money(v), delta: change(cur?.wonRevenue, prev?.wonRevenue) },
  ], ["Previous period", "This period"]);
  const bl = report.backlinks?.status === "ok" ? report.backlinks.data! : null;
  const backlinks = bl ? `<div class="bl"><div><b>${num(bl.backlinks)}</b>${change(bl.backlinks, bl.previous?.backlinks)}<span>Total Backlinks</span></div><div class="vr"></div><div><b>${num(bl.referringDomains)}</b>${change(bl.referringDomains, bl.previous?.referringDomains)}<span>Referring Domains</span></div>${sparkline(bl.history.map((h) => h.backlinks).filter((v): v is number => v != null))}</div><p class="note">For ${esc(bl.target)}${bl.previous ? ` · compared with the check on ${esc(dayLabel(bl.previous.checkedAt.slice(0, 10)))}` : " · first check, no comparison yet"}.</p>` : unavailable(report.backlinks);
  const comp = report.competitors?.status === "ok" ? report.competitors.data! : null;
  const competitors = comp ? `<table class="t compact"><thead><tr><th>Domain</th><th>Keyword gaps*</th><th>Biggest gaps</th></tr></thead><tbody><tr class="hl"><td><b>${esc(comp.clientDomain)}</b></td><td>—</td><td>Your site</td></tr>${comp.competitors.map((c) => `<tr><td>${esc(c.domain)}</td><td>${c.gapKeywords == null ? "—" : num(c.gapKeywords)}</td><td>${esc(c.topGaps.join(", ") || "—")}</td></tr>`).join("")}</tbody></table><p class="note">*Keywords the competitor ranks for in Google where ${esc(report.client.name)} does not (DataForSEO). Estimated organic traffic per competitor is not part of the current data.</p>` : unavailable(report.competitors);
  const gb = report.business?.status === "ok" ? report.business.data! : null;
  const gbStat = (iconName: string, v: number | null, p: number | null | undefined, label: string) => `<div class="gbs">${icon(iconName, 22)}<b>${v == null ? "—" : num(v)}</b><span>${esc(label)}</span>${change(v, p)}</div>`;
  const business = gb ? `<div class="gbp"><div class="gbp-id">${safeImg(report.client.logo) ? `<img src="${esc(safeImg(report.client.logo))}" alt="">` : icon("shop", 40)}<div><b>${esc(gb.locationName || report.client.name)}</b><small>${esc(gb.windowNote)}</small></div></div><div class="gbs-row">${gbStat("phone", gb.calls, gb.previous?.calls, "Calls")}${gbStat("route", gb.directions, gb.previous?.directions, "Directions")}${gbStat("eye", gb.impressions, gb.previous?.impressions, "Profile views")}${gbStat("globe", gb.websiteClicks, gb.previous?.websiteClicks, "Website clicks")}</div></div>` : unavailable(report.business);
  const ai = report.aiVisibility?.status === "ok" ? report.aiVisibility.data! : null;
  const plat = (key: "chatgpt" | "claude", name: string, file: string) => { const p = ai?.platforms.find((x) => x.platform === key); return `<div class="aip">${brandLogo(o.origin, file, name, "ai")}${p ? `<span>Mentioned in</span><b>${num(p.mentioned)} of ${num(p.prompts)} prompts</b><span class="aip-row">(${pct(p.share)}) ${change(p.share, p.previousShare, false, "pp")}</span>` : `<span class="muted">No recorded tests</span>`}</div>`; };
  const aiBlock = ai ? `<div class="ai">${plat("chatgpt", "ChatGPT", "chatgpt.svg")}<div class="vr"></div>${plat("claude", "Claude", "claude.svg")}<div class="ai-all"><span>Overall AI Visibility</span><b>${pct(ai.overall)}</b>${change(ai.overall, ai.previousOverall, false, "pp")}<small>${ai.previousOverall == null ? "No earlier tests to compare" : `vs. ${pct(ai.previousOverall)} last period`}</small></div></div>` : unavailable(report.aiVisibility);
  return `${header(report, o, isCalendarMonth(report) ? "Monthly SEO Performance Report" : "SEO Performance Report", "Organic visibility, leads and business results from SEO")}
${kpis}
<div class="row r-5-5">${card("", "Organic Traffic", "chart", "blue", traffic, { section: report.traffic })}${card("", "Keyword Rankings Overview", "trophy", "amber", rankOverview, { section: report.rankings })}</div>
<div class="row r-5-5">${card("", "Top Google Keywords", "search", "blue", kwTable, { section: report.rankings })}${card("", "Period-on-Period Performance", "chart", "blue", momGroups)}</div>
<div class="row r-5-5">${card("", "Backlinks & Referring Domains", "link", "blue", backlinks, { section: report.backlinks })}${card("", "Competitor Comparison", "users", "blue", competitors, { extra: " <small>(Keyword gaps)</small>", section: report.competitors })}</div>
<div class="row r-5-5">${card("", "Google Business Profile", "shop", "blue", business, { section: report.business })}${card("", "AI Visibility", "bot", "blue", aiBlock, { extra: " <small>(Brand mentions)</small>", section: report.aiVisibility })}</div>
<div class="row r-5-5">${card("done-card", "Completed SEO Work", "check", "green", list(report.work.completed.map((x) => x.title), "done"))}${card("next-card", "Recommendations", "target", "blue", list(report.recommendations, "next"), { extra: " <small>(Next 30 days)</small>" })}</div>
${footer(report, [report.traffic, report.rankings, report.backlinks, report.competitors, report.business, report.aiVisibility, report.attribution])}`;
}

/* ------------------------------------------------------------------ document */
const CSS = `:root{--blue:#1f6feb;--ink:#14213d;--muted:#5b6b82;--line:#e6ebf2;--green:#16a34a;--red:#dc2626;--brand:#1f6feb}
*{box-sizing:border-box}html,body{margin:0}body{font-family:"Poppins","Segoe UI",system-ui,-apple-system,Arial,sans-serif;color:var(--ink);background:linear-gradient(160deg,#f3f7fd 0%,#eef3fa 45%,#f5f8fc 100%);-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{width:1200px;margin:0 auto;padding:26px 22px 30px}
.top{display:grid;grid-template-columns:300px 1fr 90px;align-items:center;gap:22px;padding:6px 6px 18px}
.client img{max-width:280px;max-height:96px;object-fit:contain;display:block}.client-name{font-size:28px;font-weight:800}
.title{border-left:2px solid #d9e2ee;padding-left:26px}.title h1{margin:2px 0 4px;font-size:32px;line-height:1.1;font-weight:800;letter-spacing:-.3px}.title>p{margin:0;color:var(--muted);font-size:16px}
.period{display:flex;align-items:center;gap:16px;margin-top:12px;font-size:13.5px;color:#334155;flex-wrap:wrap}.period span{display:inline-flex;align-items:center;gap:6px}.period .sep{width:1px;height:18px;background:#cbd5e1}
.agency{justify-self:end}.agency img{width:66px;height:66px;object-fit:contain;border-radius:50%;background:#fff;padding:8px;box-shadow:0 6px 18px rgba(20,33,61,.12)}
.brand{display:inline-flex;align-items:center;gap:8px}.brand img{height:30px;width:auto}.brand b{font-weight:600;color:#475569}.brand.product{font-size:22px;margin-bottom:2px}.brand.product img{height:34px}.brand.ai{font-size:20px}.brand.ai b{color:var(--ink);font-weight:700}.brand.ai img{height:30px}
.kpis{display:grid;gap:12px;margin-bottom:14px}.k7{grid-template-columns:repeat(7,1fr)}.k4{grid-template-columns:repeat(4,1fr)}
.kpi{background:#fff;border:1px solid var(--line);border-radius:16px;padding:16px 16px 14px;box-shadow:0 8px 24px rgba(20,33,61,.06);display:flex;flex-direction:column;gap:4px;break-inside:avoid}
.k4 .kpi{display:grid;grid-template-columns:56px 1fr;grid-template-rows:auto auto auto;column-gap:14px}.k4 .kpi .tile{grid-row:1/4;align-self:center;width:52px;height:52px}
.tile{display:inline-grid;place-items:center;width:42px;height:42px;border-radius:12px;margin-bottom:6px}.tile.blue{background:#e8f0fe;color:#1f6feb}.tile.red{background:#fde8e8;color:#dc2626}.tile.violet{background:#efeafd;color:#6d4fd8}.tile.green{background:#e3f6ea;color:#16a34a}.tile.amber{background:#fff4d6;color:#d99a00}.tile.teal{background:#dcf5f0;color:#0d9488}
.k-label{font-size:14px;font-weight:600;color:#334155}.k-value{font-size:27px;font-weight:800;letter-spacing:-.4px;line-height:1.15}.k-foot{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:12px;color:var(--muted)}.k-foot small{font-size:11.5px}
.pill{display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border-radius:999px;font-size:12.5px;font-weight:700;white-space:nowrap}.pill.good{background:#dcfce7;color:#15803d}.pill.bad{background:#fee2e2;color:#b91c1c}.pill.flat{background:#eef2f6;color:#475569}
.na-inline{font-size:15px;font-weight:700;color:#94a3b8}
.row{display:grid;gap:14px;margin-bottom:14px}.r-6-4{grid-template-columns:1.45fr 1fr}.r-5-5{grid-template-columns:1fr 1fr}.r-3{grid-template-columns:1fr 1fr 1.15fr}
.card{background:rgba(255,255,255,.96);border:1px solid var(--line);border-radius:18px;padding:18px 20px;box-shadow:0 10px 28px rgba(20,33,61,.06);break-inside:avoid;min-width:0}
.card-h{display:flex;align-items:flex-start;gap:12px;margin-bottom:12px}.card-h h2{margin:0;font-size:19px;font-weight:800;letter-spacing:-.2px}.card-h h2 small{font-weight:500;color:#475569;font-size:15px}.card-h p{margin:2px 0 0;color:var(--muted);font-size:13px}.h-ico{color:var(--blue);display:inline-grid}.h-ico.green{color:var(--green)}.h-ico.amber{color:#d99a00}
.stamp{margin-left:auto;display:inline-flex;align-items:center;gap:4px;font-size:11px;color:#64748b;white-space:nowrap;padding-top:4px}
.chart{width:100%;height:auto;display:block}.grid{stroke:#eef2f6;stroke-width:1}.axis{font-size:11px;fill:#64748b}.bar-a{fill:#9cc3fb}.bar-b{fill:#2f6ff0}.line{fill:none;stroke:#16a34a;stroke-width:3}.dot{fill:#fff;stroke:#16a34a;stroke-width:2.5}.line-blue{fill:none;stroke:#1f6feb;stroke-width:3}.line-prev{fill:none;stroke:#b8c2cf;stroke-width:2.2}.dot-blue{fill:#fff;stroke:#1f6feb;stroke-width:3}
.legend{display:flex;justify-content:center;gap:22px;font-size:12.5px;color:#334155;margin-top:4px}.legend.right{justify-content:flex-end}.legend.inline{margin:0 0 0 auto}.legend span{display:inline-flex;align-items:center;gap:6px}.sw{display:inline-block;width:14px;height:10px;border-radius:3px}.sw.a{background:#9cc3fb}.sw.b,.sw.c{background:#2f6ff0}.sw.p{background:#b8d3fb}.sw.ln{height:3px;background:#16a34a;width:20px}
.minis{display:grid;grid-template-columns:1fr 1fr;gap:12px}.mini{display:flex;gap:12px;align-items:flex-start;background:#f8fafd;border:1px solid var(--line);border-radius:14px;padding:14px;color:#1f6feb}.mini div{display:flex;flex-direction:column;color:var(--ink)}.mini span{font-size:14px;font-weight:600}.mini b{font-size:24px;font-weight:800;display:flex;align-items:center;gap:8px;flex-wrap:wrap}.mini small{color:var(--muted);font-size:12px}
.t{width:100%;border-collapse:collapse;font-size:13.5px}.t th{text-align:left;font-size:12px;color:#334155;font-weight:700;background:#f1f5fb;padding:8px 10px}.t td{padding:7px 10px;border-bottom:1px solid #f0f3f7}.t th:not(:first-child),.t td:not(:first-child){text-align:right}.t tfoot td{font-weight:800;background:#eaf2fe;border:0}.t.compact td,.t.compact th{padding:6px 9px}.t tr.hl td{background:#e9f8ee}
.dot-g{display:inline-block;width:10px;height:10px;border-radius:50%;background:#22a35a;margin-right:8px}.roas{background:#dcfce7;color:#15803d;border-radius:999px;padding:2px 8px;font-weight:700}
.donut-row{display:flex;align-items:center;gap:18px}.donut-big{font-size:26px;font-weight:800;fill:var(--ink)}.donut-small{font-size:11px;fill:#475569}
.keys{list-style:none;margin:0;padding:0;flex:1;display:grid;gap:9px;font-size:13px}.keys li{display:flex;align-items:center;gap:8px}.keys li .pill{min-width:46px;justify-content:center}.keys li .kname{flex:1}.keys i{width:11px;height:11px;border-radius:50%}.keys.big{font-size:14.5px;gap:12px}
.revs{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.rev{display:flex;flex-direction:column;align-items:center;text-align:center;gap:3px;border-radius:14px;padding:14px 8px;border:1px solid var(--line)}.rev span{font-size:13px;font-weight:600}.rev b{font-size:22px;font-weight:800}.rev small{font-size:11px;color:var(--muted)}.rev.violet{background:#f6f3ff;color:#6d4fd8}.rev.amber{background:#fffaf0;color:#d99a00}.rev.green{background:#effaf3;color:#16a34a}.rev b,.rev span{color:var(--ink)}
ol.done,ol.next{list-style:none;margin:0;padding:0;display:grid;gap:9px;font-size:14px}ol li{display:flex;gap:10px;align-items:flex-start}.ok{color:#fff;background:#22a35a;border-radius:50%;display:inline-grid;place-items:center;width:22px;height:22px;flex:none}.ok svg{stroke:#fff}.num{background:#1f6feb;color:#fff;border-radius:7px;min-width:24px;height:22px;display:inline-grid;place-items:center;font-size:12px;font-weight:700;flex:none}
.done-card{background:linear-gradient(180deg,#f3fbf5,#fff)}.next-card{background:linear-gradient(180deg,#f3f7ff,#fff)}
.big-line{display:flex;align-items:center;gap:10px}.big-line>b{font-size:30px;font-weight:800}.sub{margin:2px 0 6px;color:var(--muted);font-size:13px}
.gbars{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;align-items:end;min-height:180px}.gb{display:flex;flex-direction:column;align-items:center;gap:6px;font-size:13px;text-align:center}.gb-bars{display:flex;gap:6px;align-items:flex-end;height:140px}.gb-col{display:flex;flex-direction:column;align-items:center;gap:4px;justify-content:flex-end}.gb-col small{font-size:12.5px}.gb-col i{display:block;width:44px;border-radius:6px 6px 0 0}.gb-col i.p{background:#b8d3fb}.gb-col i.c{background:#2f6ff0}
.bl{display:flex;align-items:center;gap:20px}.bl>div:not(.vr){display:flex;flex-direction:column;gap:2px}.bl b{font-size:28px;font-weight:800}.bl span{font-size:13px;color:#334155}.vr{width:1px;align-self:stretch;background:var(--line)}.spark{width:200px;height:64px;margin-left:auto}
.gbp{display:grid;grid-template-columns:200px 1fr;gap:16px;align-items:center}.gbp-id{display:flex;flex-direction:column;align-items:center;gap:8px;text-align:center;background:#f8fafd;border-radius:14px;padding:16px;color:var(--blue)}.gbp-id img{max-width:150px;max-height:80px;object-fit:contain}.gbp-id div{display:flex;flex-direction:column;gap:2px}.gbp-id b{color:var(--ink)}.gbp-id small{display:block;color:var(--muted);font-size:11.5px}.gbs-row{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.gbs{display:flex;flex-direction:column;align-items:center;gap:2px;color:var(--blue);text-align:center}.gbs b{font-size:22px;font-weight:800;color:var(--ink)}.gbs span{font-size:12px;color:#334155}
.ai{display:grid;grid-template-columns:1fr auto 1fr 1.1fr;gap:14px;align-items:center}.aip{display:flex;flex-direction:column;gap:3px;font-size:14px}.aip b{font-size:17px}.aip-row{display:flex;gap:8px;align-items:center;color:#475569}.ai-all{background:#f8fafd;border:1px solid var(--line);border-radius:14px;padding:14px;display:flex;flex-direction:column;gap:3px}.ai-all span{font-size:13.5px;font-weight:600}.ai-all b{font-size:32px;font-weight:800}.ai-all small{color:var(--muted);font-size:12px}
.na{display:flex;gap:10px;align-items:flex-start;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:12px;padding:14px;color:#475569;font-size:13.5px}.na b{color:#334155;margin-right:4px}
.note{margin:8px 0 0;font-size:11.5px;color:#64748b}.muted{color:#64748b;font-size:13.5px}
.foot{display:grid;grid-template-columns:1fr 260px;gap:14px;margin-top:4px}.foot-main,.foot-side{display:flex;gap:12px;align-items:flex-start;background:#fff;border:1px solid var(--line);border-radius:14px;padding:14px 16px;font-size:12px;color:#334155;line-height:1.55}.foot-side{align-items:center;font-size:13px}.missing{margin-top:6px;color:#92400e}
@page{size:A4 portrait;margin:8mm}
@media print{body{background:#fff}.page{width:1200px;padding:0;zoom:.6}.card,.kpi{box-shadow:none}.row{break-inside:avoid}}`;

export function renderClientReportHtml(report: ClientReport, opts: Opts) {
  const body = report.type === "ads" ? adsBody(report, opts) : seoBody(report, opts);
  const title = `${report.client.name} — ${report.type === "ads" ? "Google Ads" : "SEO"} report ${report.period.start} to ${report.period.end}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title><style>${CSS}</style></head><body><main class="page">${body}</main></body></html>`;
}
