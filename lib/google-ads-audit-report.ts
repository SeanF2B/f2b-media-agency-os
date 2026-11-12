type AuditCampaign = {
  id: string;
  name: string;
  status: string;
  primaryStatus?: string;
  impressions?: number;
  clicks?: number;
  ctr?: number;
  spend?: number;
  conversions?: number;
  costPerConversion?: number;
  budgetMicros: number;
  budgetStatus?: string;
};

type AuditCheck = { text: string; done: boolean; evidence?: string };
type AuditAction = { title: string; rationale: string; evidence: string };

const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
const formatNumber = (value: number | undefined) => Number(value || 0).toLocaleString("en-IE", { maximumFractionDigits: 2 });

function safeLogoSource(value: string | undefined): string {
  const source = String(value || "").trim();
  if (/^https:\/\//i.test(source) || /^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(source)) return source;
  return "";
}

export function buildGoogleAdsAuditReport(input: {
  clientName: string;
  clientLogo?: string;
  accountId: string;
  taskTitle: string;
  campaignName?: string;
  reportingPeriod: string;
  completedAt: string;
  status: string;
  summary: string;
  campaigns: AuditCampaign[];
  checks: AuditCheck[];
  recommendations: AuditAction[];
  assets: string[];
  dataNotes: string[];
  currency: string;
}): string {
  const money = (value: number | undefined) => new Intl.NumberFormat("en-IE", { style: "currency", currency: input.currency || "EUR" }).format(Number.isFinite(Number(value)) ? Number(value || 0) : 0);
  const logo = safeLogoSource(input.clientLogo);
  const spend = input.campaigns.reduce((sum, campaign) => sum + Number(campaign.spend || 0), 0);
  const clicks = input.campaigns.reduce((sum, campaign) => sum + Number(campaign.clicks || 0), 0);
  const impressions = input.campaigns.reduce((sum, campaign) => sum + Number(campaign.impressions || 0), 0);
  const conversions = input.campaigns.reduce((sum, campaign) => sum + Number(campaign.conversions || 0), 0);
  const ctr = impressions > 0 ? `${(clicks / impressions * 100).toFixed(2)}%` : "Not available";
  const cpa = conversions > 0 ? money(spend / conversions) : "Not available";
  const checks = input.checks.length ? input.checks.map((item) => `<li><span class="mark ${item.done ? "ok" : "gap"}">${item.done ? "✓" : "!"}</span><div><b>${escapeHtml(item.text)}</b>${item.evidence ? `<p>${escapeHtml(item.evidence)}</p>` : ""}</div></li>`).join("") : `<li><span class="mark gap">!</span><div><b>No checklist was saved for this run.</b></div></li>`;
  const actions = input.recommendations.length ? input.recommendations.map((item, index) => `<li><span class="step">${index + 1}</span><div><b>${escapeHtml(item.title)}</b><p>${escapeHtml(item.rationale)}</p>${item.evidence ? `<small>Evidence: ${escapeHtml(item.evidence)}</small>` : ""}</div></li>`).join("") : `<li><span class="step">1</span><div><b>No evidence-backed action was ready.</b><p>Review the checks and data notes below.</p></div></li>`;
  const rows = input.campaigns.length ? input.campaigns.map((campaign) => `<tr><td><b>${escapeHtml(campaign.name)}</b><small>${escapeHtml(campaign.status)}${campaign.primaryStatus ? ` · ${escapeHtml(campaign.primaryStatus)}` : ""}</small></td><td>${formatNumber(campaign.impressions)}</td><td>${formatNumber(campaign.clicks)}</td><td>${campaign.ctr == null ? "—" : `${(Number(campaign.ctr) * 100).toFixed(2)}%`}</td><td>${money(campaign.spend)}</td><td>${formatNumber(campaign.conversions)}</td><td>${Number(campaign.conversions || 0) > 0 && campaign.costPerConversion != null ? money(campaign.costPerConversion) : "—"}</td></tr>`).join("") : `<tr><td colspan="7">No campaign metrics were returned for this run.</td></tr>`;
  const dataNotes = input.dataNotes.length ? input.dataNotes.map((note) => `<li>${escapeHtml(note)}</li>`).join("") : "<li>No additional data gaps were recorded.</li>";
  const assets = input.assets.length ? input.assets.slice(0, 16).map((asset) => `<li>${escapeHtml(asset)}</li>`).join("") : "<li>No campaign assets were returned for this review.</li>";

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(input.clientName)} · Google Ads audit</title><style>
    :root{color-scheme:light;--ink:#202825;--muted:#69716c;--line:#e5ded3;--paper:#fffdf9;--warm:#f7f1e7;--gold:#c3944c;--clay:#b85e45;--green:#31745c}*{box-sizing:border-box}body{margin:0;background:#f1eee8;color:var(--ink);font:15px/1.5 Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}.report{max-width:1040px;margin:28px auto;background:var(--paper);border:1px solid var(--line);box-shadow:0 12px 36px #30291d12}.topline{height:8px;background:linear-gradient(90deg,var(--gold),var(--clay))}.content{padding:38px 44px}.brand{display:flex;align-items:center;gap:16px;border-bottom:1px solid var(--line);padding-bottom:22px}.logo{width:64px;height:64px;object-fit:contain;border:1px solid var(--line);border-radius:14px;background:white;padding:5px}.logo-placeholder{display:grid;place-items:center;width:64px;height:64px;border-radius:14px;background:var(--warm);font-size:26px}.eyebrow{text-transform:uppercase;letter-spacing:.1em;color:var(--clay);font-weight:750;font-size:11px}.brand h1{margin:3px 0;font-size:26px;line-height:1.2}.subtle{color:var(--muted)}.meta{margin-left:auto;text-align:right;color:var(--muted);font-size:12px}.status{display:inline-block;padding:4px 10px;border-radius:999px;background:#e9f4ed;color:var(--green);font-weight:700}.hero{padding:26px 0 20px}.hero h2{font-size:23px;margin:3px 0 8px}.hero p{max-width:800px;margin:0;color:#424b46}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:18px 0 30px}.kpi{border:1px solid var(--line);border-radius:12px;background:var(--warm);padding:15px}.kpi span{display:block;color:var(--muted);font-size:12px}.kpi b{font-size:22px}.section{margin:26px 0}.section h3{font-size:17px;margin:0 0 12px}.table-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:10px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{text-align:left;padding:10px;border-bottom:1px solid var(--line);vertical-align:top}th{background:var(--warm);white-space:nowrap;color:#514b40}tr:last-child td{border:0}td small{display:block;color:var(--muted)}.checks,.actions,.notes{list-style:none;padding:0;margin:0;display:grid;gap:9px}.checks li,.actions li{display:flex;gap:12px;align-items:flex-start;padding:12px;border:1px solid var(--line);border-radius:10px;background:white}.checks p,.actions p{margin:3px 0 0;color:#48514c}.checks small,.actions small{display:block;margin-top:5px;color:var(--muted)}.mark,.step{flex:0 0 26px;height:26px;border-radius:50%;display:grid;place-items:center;font-weight:800;background:#e8f2ec;color:var(--green)}.mark.gap{background:#fbefe3;color:#9d5a28}.step{background:var(--warm);color:#72572c}.notes{padding:14px 18px;background:#fff9ef;border:1px solid #ead8b7;border-radius:10px}.footer{margin-top:30px;padding-top:14px;border-top:1px solid var(--line);font-size:11px;color:var(--muted)}@media(max-width:700px){.content{padding:24px 18px}.kpis{grid-template-columns:repeat(2,1fr)}.brand{align-items:flex-start;flex-wrap:wrap}.meta{width:100%;margin:0;text-align:left}.brand h1{font-size:21px}}@media print{body{background:white}.report{margin:0 auto;border:0;box-shadow:none}.content{padding:24px 30px}.section,.kpi,.checks li,.actions li{break-inside:avoid}}
    </style></head><body><main class="report"><div class="topline"></div><div class="content"><header class="brand">${logo ? `<img class="logo" src="${escapeHtml(logo)}" alt="${escapeHtml(input.clientName)} logo">` : `<div class="logo-placeholder" aria-hidden="true">📊</div>`}<div><div class="eyebrow">F2B Media · Campaign review</div><h1>${escapeHtml(input.clientName)}</h1><div class="subtle">${escapeHtml(input.taskTitle)}</div></div><div class="meta"><span class="status">${escapeHtml(input.status)}</span><p>Account ${escapeHtml(input.accountId)}<br>${escapeHtml(input.reportingPeriod)}<br>${escapeHtml(input.completedAt)}</p></div></header><section class="hero"><div class="eyebrow">Google Ads audit</div><h2>Campaign performance & next steps</h2><p>${escapeHtml(input.summary || "The audit checked the connected campaign data and recorded verified findings below.")}</p></section><section class="kpis" aria-label="Performance summary"><div class="kpi"><span>💶 Spend</span><b>${escapeHtml(money(spend))}</b></div><div class="kpi"><span>👆 Clicks</span><b>${escapeHtml(formatNumber(clicks))}</b></div><div class="kpi"><span>👁 Impressions</span><b>${escapeHtml(formatNumber(impressions))}</b></div><div class="kpi"><span>🎯 Conversions</span><b>${escapeHtml(formatNumber(conversions))}</b></div></section><div class="kpis"><div class="kpi"><span>📈 Click rate</span><b>${escapeHtml(ctr)}</b></div><div class="kpi"><span>💡 Cost per conversion</span><b>${escapeHtml(cpa)}</b></div><div class="kpi"><span>Campaigns checked</span><b>${input.campaigns.length}</b></div><div class="kpi"><span>Changes made</span><b>None</b></div></div><section class="section"><h3>📊 Campaign results</h3><div class="table-wrap"><table><thead><tr><th>Campaign</th><th>Impressions</th><th>Clicks</th><th>CTR</th><th>Spend</th><th>Conversions</th><th>Cost / conv.</th></tr></thead><tbody>${rows}</tbody></table></div></section><section class="section"><h3>🔗 Ads & assets checked</h3><ul class="notes">${assets}</ul></section><section class="section"><h3>✅ Audit checks</h3><ul class="checks">${checks}</ul></section><section class="section"><h3>🧭 Recommended next steps</h3><ol class="actions">${actions}</ol></section><section class="section"><h3>ℹ️ Data notes</h3><ul class="notes">${dataNotes}</ul></section><footer class="footer">Prepared for ${escapeHtml(input.clientName)} · ${escapeHtml(input.completedAt)} · Figures reflect the selected reporting period. Recommendations are guidance; account changes require separate approval.</footer></div></main></body></html>`;
}
