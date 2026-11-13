import { env } from "cloudflare:workers";
import { calculateMarketingDerivedValues, calculateMarketingQuote, getMarketingSurveyPath, isMarketingFieldVisible, isMarketingRequiredValuePresent, parseMarketingFieldValue, type MarketingField, type MarketingValues } from "@/lib/marketing-rules";
import { createMarketingQuoteSnapshot } from "@/lib/marketing-quote-snapshot.js";
import { enqueueMarketingAutomations } from "@/worker/marketing-automations";
import { buildMarketingContactPayload } from "@/lib/marketing-contact-sync";
import { isMarketingImageKey, marketingImageOwnerPrefix, uploadedMarketingImageUrl } from "@/lib/marketing-assets";
import { renderMarketingDisplayField } from "@/lib/marketing-field-renderer";
import { detectMarketingSubmissionFileType, MARKETING_SUBMISSION_FILE_MAX_BYTES, MARKETING_SUBMISSION_TOTAL_MAX_BYTES, marketingSubmissionFilePrefix, sanitizeMarketingSubmissionFilename } from "@/lib/marketing-submission-files";
import { consumeMarketingSubmissionRateLimit } from "@/lib/marketing-public-rate-limit";
import { flattenMarketingSections, normalizeMarketingSections, renderMarketingFaqStructuredData, renderMarketingSectionsHtml } from "@/lib/marketing-sections";
import { MARKETING_EDITABLE_TEXT_CSS, marketingFontStack, marketingResponsiveBlockCss, normalizeMarketingDesign } from "@/lib/marketing-design";
import { readMarketingAttribution, readSubmittedMarketingAttribution, renderMarketingAttributionFields } from "@/lib/marketing-attribution.js";

export const dynamic = "force-dynamic";
type Field = MarketingField & { label?: string; description?: string; placeholder?: string; defaultValue?: string; step?: number };
type PublicAsset = { id: string; owner_id: string; client_id: string | null; kind: string; name: string; slug: string; status: string; version: number; data: string };
const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
const safeType = new Set(["text", "email", "tel", "address", "number", "date", "time"]);
async function findAsset(slug: string) {
  if (!env.DB || !slug || slug.length > 120) return null;
  return env.DB.prepare("SELECT id, owner_id, client_id, kind, name, slug, status, version, published_data AS data FROM marketing_assets WHERE slug = ?1 AND published_data IS NOT NULL AND kind IN ('funnel','form','survey','calculator') LIMIT 1").bind(slug).first<PublicAsset>();
}
async function publishedImage(slug: string, key: string) {
  if (!env.DB || !env.BUCKET || !slug || slug.length > 120 || !isMarketingImageKey(key)) return jsonError("This published image could not be found.", 404);
  const asset = await env.DB.prepare("SELECT owner_id, published_data AS data FROM marketing_assets WHERE slug = ?1 AND published_data IS NOT NULL AND kind IN ('funnel','form','survey','calculator') LIMIT 1").bind(slug).first<{ owner_id: string; data: string }>();
  if (!asset) return jsonError("This published image could not be found.", 404);
  if (!key.startsWith(await marketingImageOwnerPrefix(asset.owner_id))) return jsonError("This published image could not be found.", 404);
  let data: Record<string, unknown>;
  try { data = JSON.parse(asset.data) as Record<string, unknown>; } catch { return jsonError("This published image could not be found.", 404); }
  const sections = Array.isArray(data.sections) ? data.sections as Array<{ imageUrl?: string }> : [];
  const referenced = sections.some((section) => section.imageUrl === uploadedMarketingImageUrl(key));
  if (!referenced) return jsonError("This published image could not be found.", 404);
  const object = await env.BUCKET.get(key);
  if (!object) return jsonError("This published image could not be found.", 404);
  return new Response(object.body, { headers: { "Content-Type": object.httpMetadata?.contentType || "application/octet-stream", "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox", "Referrer-Policy": "strict-origin-when-cross-origin" } });
}
function buildMarketingScript(kind: string, data: Record<string, unknown>, currency: string) {
  const isSurvey = kind === "survey";
  const pricing = { fixedFee: Number(data.fixedFee) || 0, minimumCharge: Number(data.minimumCharge) || 0, percentageAdjustmentPercent: Number(data.percentageAdjustmentPercent) || 0, discountPercent: Number(data.discountPercent) || 0, taxPercent: Number(data.taxPercent) || 0 };
  return `<script>(()=>{
    const f=document.querySelector('form');if(!f)return;
    const isSurvey=${JSON.stringify(isSurvey)};
    let step=1;
    const steps=[...new Set([...f.querySelectorAll('[data-survey-step]')].map(x=>Number(x.dataset.surveyStep)||1))].sort((a,b)=>a-b);
    const matchesRule=rule=>{
      const src=f.elements.namedItem(rule.fieldId);
      const raw=src instanceof RadioNodeList?[...src].find(c=>c.checked)?.value:src?.multiple?[...src.selectedOptions].map(c=>c.value):src?.value;
      const values=Array.isArray(raw)?raw:raw==null?[]:[String(raw)];
      const text=values.join(', '),expected=String(rule.value??rule.equals??''),operator=rule.operator||'equals';
      return operator==='notEquals'?!values.includes(expected):operator==='greaterThan'?text!==''&&Number(text)>Number(expected):operator==='lessThan'?text!==''&&Number(text)<Number(expected):operator==='contains'?text.toLowerCase().includes(expected.toLowerCase()):operator==='isEmpty'?text.trim()==='':operator==='isNotEmpty'?text.trim()!=='':values.includes(expected)
    };
    const ruleMatches=x=>{
      let rules=[];try{rules=JSON.parse(x.dataset.showRules||'[]')}catch{}
      if(rules.length)return x.dataset.showMode==='or'?rules.some(matchesRule):rules.every(matchesRule);
      return x.dataset.showField?matchesRule({fieldId:x.dataset.showField,operator:x.dataset.showOperator,value:x.dataset.showValue}):true
    };
    const visibleStep=s=>steps.includes(s)&&[...f.querySelectorAll('[data-survey-step]')].some(x=>Number(x.dataset.surveyStep)===s&&ruleMatches(x));
    let visited=steps.length?[steps.find(visibleStep)??steps[0]]:[];
    const nextStep=from=>{
      let target;
      for(const group of f.querySelectorAll('[data-survey-step]')){
        if(Number(group.dataset.surveyStep)!==from||!ruleMatches(group))continue;
        for(const choice of group.querySelectorAll('[data-next-step]')){
          const branch=Number(choice.dataset.nextStep),selected=choice.matches('option')?choice.selected:choice.matches('input')?choice.checked:false;
          if(selected&&Number.isInteger(branch)&&branch>from&&steps.includes(branch)){target=branch;break}
        }
        if(target)break
      }
      const minimum=target??from+1;
      return steps.find(candidate=>candidate>=minimum&&candidate>from&&!visited.includes(candidate)&&visibleStep(candidate))??null
    };
    const updateStep=()=>{
      f.querySelectorAll('[data-survey-step]').forEach(x=>{
        const visible=Number(x.dataset.surveyStep)===step&&ruleMatches(x);x.hidden=!visible;
        x.querySelectorAll('input,select,textarea').forEach(c=>{c.required=visible&&c.dataset.surveyRequired==='1';c.disabled=!visible})
      });
      const back=document.getElementById('survey-back'),next=document.getElementById('survey-next'),submit=document.getElementById('final-submit'),progress=[...f.querySelectorAll('[data-survey-progress]')],hasNext=!!nextStep(step);
      if(back)back.hidden=visited.length<2;if(next)next.hidden=!hasNext;if(submit)submit.hidden=hasNext;progress.forEach(x=>x.textContent='Step '+visited.length+' of '+steps.filter(visibleStep).length)
    };
    const priceEnabled=el=>{try{const holder=el.closest('[data-price-when]');const rule=holder?JSON.parse(holder.dataset.priceWhen||'null'):null;if(!rule)return true;const conditions=rule.conditions?.length?rule.conditions:rule.fieldId?[rule]:[];const values=id=>[...f.querySelectorAll('[name="'+String(id).replace(/[^A-Za-z0-9_-]/g,'')+'"]')].filter(c=>!c.disabled&&(!['radio','checkbox'].includes(c.type)||c.checked)).flatMap(c=>c.multiple?[...c.selectedOptions].map(o=>o.value):[c.value]);const match=c=>{const v=values(c.fieldId),s=v.join(', '),want=String(c.value??c.equals??'');switch(c.operator||'equals'){case'notEquals':return !v.includes(want);case'greaterThan':return s!==''&&Number.isFinite(Number(s))&&Number(s)>Number(want);case'lessThan':return s!==''&&Number.isFinite(Number(s))&&Number(s)<Number(want);case'contains':return s.toLowerCase().includes(want.toLowerCase());case'isEmpty':return !s.trim();case'isNotEmpty':return !!s.trim();default:return v.includes(want)}};const results=conditions.map(match);return rule.mode==='or'?results.some(Boolean):results.every(Boolean)}catch{return false}};const recalc=()=>{f.querySelectorAll('[data-calculation]').forEach(x=>{let config={};try{config=JSON.parse(x.dataset.calculation||'{}')}catch{}const read=id=>{const control=f.elements.namedItem(id);return Math.max(0,Math.min(1000000,Number(control?.value)||0))};const operands=(config.fieldIds||[]).map(read),a=operands[0]||0,b=operands[1]||0;let value=config.operation==='multiply'?operands.reduce((total,item)=>total*item,1):config.operation==='add'?operands.reduce((total,item)=>total+item,0):config.operation==='subtract'?Math.max(0,a-b):config.operation==='divide'&&b>0?a/b:0;value=Math.round(Math.max(0,Math.min(1000000000,value))*100)/100;x.value=String(value);const out=document.getElementById('calculated-'+x.name);if(out)out.textContent=value.toLocaleString(undefined,{maximumFractionDigits:2})});let subtotal=0;f.querySelectorAll('[data-unit-price]').forEach(x=>{if(x.disabled||x.closest('[hidden]')||!priceEnabled(x))return;const quantity=Math.max(0,Math.min(1000000,Number(x.value)||0));let tiers=[];try{tiers=JSON.parse(x.dataset.rateTiers||'[]')}catch{}if(tiers.length){let remaining=quantity,previous=0;for(let i=0;i<tiers.length&&remaining>0;i++){const limit=i===tiers.length-1?Infinity:Math.max(previous,Number(tiers[i].upTo)||previous);const band=Math.min(remaining,Math.max(0,limit-previous));subtotal+=band*Math.max(0,Math.min(1000000,Number(tiers[i].pricePerUnit)||0));remaining-=band;previous=limit}}else subtotal+=quantity*Math.max(0,Math.min(1000000,Number(x.dataset.unitPrice)||0))});f.querySelectorAll('select option:checked,input[type=radio]:checked,input[type=checkbox]:checked').forEach(x=>{if(!x.closest('[hidden]')&&!x.disabled&&priceEnabled(x))subtotal+=Math.max(0,Number(x.dataset.price)||0)});const p=${JSON.stringify(pricing)};const fixedFee=Math.max(0,p.fixedFee),minimumAdjustment=Math.max(0,p.minimumCharge-subtotal-fixedFee),beforeDiscount=subtotal+fixedFee+minimumAdjustment,percentageAdjustment=beforeDiscount*p.percentageAdjustmentPercent/100,afterAdjustment=Math.max(0,beforeDiscount+percentageAdjustment),discount=afterAdjustment*p.discountPercent/100,taxable=afterAdjustment-discount,tax=taxable*p.taxPercent/100,total=taxable+tax;const fmt=n=>new Intl.NumberFormat(undefined,{style:'currency',currency:${JSON.stringify(currency)}}).format(Math.round(n*100)/100);[['subtotal',subtotal],['fixed-fee',fixedFee],['minimum-adjustment',minimumAdjustment],['percentage-adjustment',percentageAdjustment],['discount',-discount],['taxable-subtotal',taxable],['tax',tax],['total',total]].forEach(([id,value])=>{const out=document.getElementById(id);if(out)out.textContent=fmt(Number(value))})};
    const conditions=()=>{f.querySelectorAll('[data-show-rules],[data-show-field]').forEach(x=>{const visible=ruleMatches(x)&&(!x.dataset.surveyStep||Number(x.dataset.surveyStep)===step);x.hidden=!visible;x.querySelectorAll('input,select,textarea').forEach(c=>{c.disabled=!visible;if(c.dataset.surveyRequired==='1')c.required=visible})});document.querySelectorAll('[data-section-show-rules]').forEach(x=>{let rules=[];try{rules=JSON.parse(x.dataset.sectionShowRules||'[]')}catch{}const matched=rules.length?(x.dataset.sectionShowMode==='or'?rules.some(matchesRule):rules.every(matchesRule)):true;x.hidden=!matched;x.style.display=matched?'':'none'})};
    f.querySelectorAll('[data-survey-step] input,[data-survey-step] select,[data-survey-step] textarea').forEach(c=>c.dataset.surveyRequired=c.required?'1':'0');
    f.addEventListener('input',()=>{conditions();recalc()});f.addEventListener('change',()=>{conditions();recalc()});
    const advance=()=>{if(!f.reportValidity())return;const target=nextStep(step);if(target==null)return;visited=visited.slice(0,visited.indexOf(step)+1);visited.push(target);step=target;updateStep();conditions()};
    const next=document.getElementById('survey-next'),back=document.getElementById('survey-back');
    if(next)next.addEventListener('click',advance);if(back)back.addEventListener('click',()=>{if(visited.length<2)return;visited.pop();step=visited[visited.length-1];updateStep();conditions()});
    if(isSurvey&&steps.length){updateStep();conditions();f.addEventListener('submit',event=>{event.preventDefault();for(const current of visited){step=current;updateStep();conditions();if(!f.reportValidity())return}step=visited[visited.length-1];updateStep();conditions();f.querySelectorAll('[data-survey-step]').forEach(group=>{const reached=visited.includes(Number(group.dataset.surveyStep)),visible=ruleMatches(group);group.querySelectorAll('input,select,textarea').forEach(c=>{c.disabled=!reached||!visible})});f.submit()})}
    conditions();recalc()
  })()</script>`;
}
async function page(asset: PublicAsset, result = "", requestedStep = 1, submissionComplete = false, attribution: Record<string, string> = {}, embedded = false) {
  let data: Record<string, unknown> = {};
  try { data = JSON.parse(asset.data); } catch { data = {}; }
  const design = normalizeMarketingDesign(data.design);
  const fontStack = marketingFontStack(design.fontFamily);
  const fields = Array.isArray(data.fields) ? data.fields as Field[] : [];
  const hasFileFields = fields.some((field) => field.type === "file");
  const funnelSteps = asset.kind === "funnel" && Array.isArray(data.funnelSteps) && data.funnelSteps.length >= 2 ? data.funnelSteps as Array<{ title?: string; heading?: string; body?: string }> : [];
  const funnelIndex = funnelSteps.length ? Math.min(funnelSteps.length - 1, Math.max(0, requestedStep - 1)) : 0;
  const funnelStep = funnelSteps[funnelIndex];
  const isFinalFunnelStep = !funnelSteps.length || funnelIndex === funnelSteps.length - 1;
  const allowedOrigins = Array.isArray(data.allowedDomains) ? data.allowedDomains.map((value: unknown) => { try { const url = new URL(/^https:\/\//i.test(String(value)) ? String(value) : `https://${String(value)}`); return url.protocol === "https:" ? url.origin : ""; } catch { return ""; } }).filter(Boolean).slice(0, 20) : [];
  const sections = normalizeMarketingSections(data.sections);
  const embeddedIds = [...new Set(flattenMarketingSections(sections).filter((section) => section.type === "embed" && section.embeddedAssetId).map((section) => section.embeddedAssetId!))].slice(0, 30);
  const embeddedAssets = new Map<string, { slug: string; kind: string }>();
  if (embeddedIds.length && env.DB) {
    const placeholders = embeddedIds.map((_, index) => `?${index + 3}`).join(", ");
    const rows = await env.DB.prepare(`SELECT id, slug, kind FROM marketing_assets WHERE owner_id = ?1 AND client_id IS ?2 AND id IN (${placeholders}) AND kind IN ('form','survey','calculator') AND published_data IS NOT NULL`)
      .bind(asset.owner_id, asset.client_id, ...embeddedIds).all<{ id: string; slug: string; kind: string }>();
    for (const row of rows.results || []) embeddedAssets.set(row.id, { slug: row.slug, kind: row.kind });
  }
  const safeHttps = (value: unknown) => { try { const url = new URL(String(value || "")); return url.protocol === "https:" ? url.toString() : ""; } catch { return ""; } };
  const heading = esc(funnelStep?.heading || data.heading || asset.name);
  const intro = esc(funnelStep?.body || data.description || "");
  const fieldHtml = fields.map((field, index) => {
    const id = String(field.id || `field-${index + 1}`).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
    const label = esc(field.label || `Question ${index + 1}`);
    const required = field.required ? "required" : "";
    const unitHint = asset.kind === "calculator" && field.type === "number" && field.unitLabel ? `<small>Rate is calculated per ${esc(field.unitLabel)}.</small>` : "";
    const description = `${field.description ? `<small>${esc(field.description)}</small>` : ""}${unitHint}`;
    const priceWhen = asset.kind === "calculator" && field.priceWhen ? ` data-price-when="${esc(JSON.stringify(field.priceWhen))}"` : "";
    const visibilityRules = field.showWhen?.conditions?.length ? field.showWhen.conditions : field.showWhen?.fieldId ? [field.showWhen] : [];
    const condition = `${visibilityRules.length ? ` data-show-rules="${esc(JSON.stringify(visibilityRules))}" data-show-mode="${field.showWhen?.mode === "or" ? "or" : "and"}"` : ""}${priceWhen}${asset.kind === "survey" ? ` data-survey-step="${Math.min(10, Math.max(1, Number(field.step) || 1))}"` : ""}`;
    if (field.type === "hidden") return `<input type="hidden" name="${esc(id)}" value="${esc(field.defaultValue || "")}">`;
    const displayField = renderMarketingDisplayField(field, condition);
    if (displayField !== null) return displayField;
    if (field.type === "calculated") {
      const calculation = field.calculation || { operation: "multiply", fieldIds: ["", ""] };
      return `<label class="field"${condition}><span>${label}</span>${description}<output id="calculated-${esc(id)}" aria-live="polite">0</output>${field.unitLabel ? `<small>${esc(field.unitLabel)}</small>` : ""}<input type="hidden" name="${esc(id)}" data-calculation="${esc(JSON.stringify(calculation))}"${asset.kind === "calculator" ? ` data-unit-price="${Math.max(0, Number(field.pricePerUnit) || 0)}"${field.rateTiers?.length ? ` data-rate-tiers="${esc(JSON.stringify(field.rateTiers))}"` : ""}${priceWhen}` : ""}></label>`;
    }
    if (field.type === "file") return `<label class="field"${condition}><span>${label}${field.required ? " *" : ""}</span>${description}<small>PDF, PNG, JPEG or WebP · maximum 5 MB total per submission.</small><input name="${esc(id)}" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp" ${required}></label>`;
    if (["select", "multiselect"].includes(field.type || "")) return `<label class="field"${condition}><span>${label}${field.required ? " *" : ""}</span>${description}<select name="${esc(id)}" ${field.type === "multiselect" ? "multiple" : ""} ${required} ${field.type === "multiselect" ? 'size="4"' : ""}><option value="">${field.type === "multiselect" ? "Choose one or more…" : "Choose…"}</option>${(field.options || []).slice(0, 80).map((option) => `<option value="${esc(option.value || option.label)}" data-price="${Number.isFinite(Number(option.price)) ? Number(option.price) : 0}"${priceWhen} data-next-step="${asset.kind === "survey" && Number.isInteger(Number(option.nextStep)) ? Number(option.nextStep) : ""}" ${field.defaultValue === String(option.value || option.label) ? "selected" : ""}>${esc(option.label || option.value)}</option>`).join("")}</select></label>`;
    if (field.type === "radio") return `<fieldset class="field radio-group"${condition}><legend>${label}${field.required ? " *" : ""}</legend>${description}${(field.options || []).slice(0, 80).map((option, optionIndex) => `<label class="check"><input type="radio" name="${esc(id)}" value="${esc(option.value || option.label)}" data-price="${Number.isFinite(Number(option.price)) ? Number(option.price) : 0}"${priceWhen} data-next-step="${asset.kind === "survey" && Number.isInteger(Number(option.nextStep)) ? Number(option.nextStep) : ""}" ${field.required && optionIndex === 0 ? "required" : ""}><span>${esc(option.label || option.value)}</span></label>`).join("")}</fieldset>`;
    if (field.type === "textarea") return `<label class="field"${condition}><span>${label}${field.required ? " *" : ""}</span>${description}<textarea name="${esc(id)}" ${required} placeholder="${esc(field.placeholder || "")}">${esc(field.defaultValue || "")}</textarea></label>`;
    if (["checkbox", "consent"].includes(field.type || "")) return `<label class="check"${condition}><input type="checkbox" name="${esc(id)}" value="yes" ${required}><span>${label}${field.required ? " *" : ""}${description}</span></label>`;
    const type = safeType.has(field.type || "") ? field.type : "text";
    return `<label class="field"${condition}><span>${label}${field.required ? " *" : ""}</span>${description}<input name="${esc(id)}" type="${type === "address" ? "text" : type}"${type === "address" ? ' autocomplete="street-address"' : ""} value="${esc(field.defaultValue || "")}" placeholder="${esc(field.placeholder || "")}" ${required}${type === "number" ? ` step="any"${Number.isFinite(Number(field.min)) ? ` min="${Number(field.min)}"` : ""}${Number.isFinite(Number(field.max)) ? ` max="${Number(field.max)}"` : ""}` : ""}${asset.kind === "calculator" && field.type === "number" ? ` data-unit-price="${Math.max(0, Number(field.pricePerUnit) || 0)}"${field.rateTiers?.length ? ` data-rate-tiers="${esc(JSON.stringify(field.rateTiers))}"` : ""}` : ""}></label>`;
  }).join("");
  const responsiveBlockCss = marketingResponsiveBlockCss(flattenMarketingSections(sections));
  const blocks = renderMarketingSectionsHtml(sections, asset.slug, embeddedAssets);
  const structuredFaq = renderMarketingFaqStructuredData(sections);
  const calculator = asset.kind === "calculator" ? '<section class="quote-summary" aria-live="polite" aria-label="Estimate breakdown"><h2>Estimate breakdown</h2><dl><div><dt>Selected items</dt><dd id="subtotal">€0.00</dd></div><div><dt>Fixed fee</dt><dd id="fixed-fee">€0.00</dd></div><div><dt>Minimum charge adjustment</dt><dd id="minimum-adjustment">€0.00</dd></div><div><dt>Percentage adjustment</dt><dd id="percentage-adjustment">€0.00</dd></div><div><dt>Discount</dt><dd id="discount">€0.00</dd></div><div><dt>Before tax</dt><dd id="taxable-subtotal">€0.00</dd></div><div><dt>Tax</dt><dd id="tax">€0.00</dd></div><div class="quote-total"><dt>Estimated total</dt><dd id="total">€0.00</dd></div></dl><small>This is an estimate based on the options selected.</small></section>' : "";
  const button = `${asset.kind === "survey" ? '<div class="step-actions"><button id="survey-back" type="button" class="secondary">Back</button><span id="survey-progress" data-survey-progress></span><button id="survey-next" type="button">Next</button></div>' : ""}<label class="trap" aria-hidden="true">Leave this field blank<input name="website" tabindex="-1" autocomplete="off"></label><button id="final-submit" type="submit">${esc(data.submitLabel || (asset.kind === "calculator" ? "Request this estimate" : "Submit"))}</button>`;
  const attributionQuery = new URLSearchParams(attribution).toString();
  const trackingSuffix = attributionQuery ? `&${attributionQuery.replace(/&/g, "&amp;")}` : "";
  const funnelNav = funnelSteps.length ? `<nav class="funnel-nav" aria-label="Funnel steps">${funnelIndex > 0 ? `<a href="/f/${encodeURIComponent(asset.slug)}?step=${funnelIndex}${trackingSuffix}">← Back</a>` : `<span></span>`}<span>${esc(funnelStep?.title || `Step ${funnelIndex + 1}`)} · ${funnelIndex + 1} of ${funnelSteps.length}</span>${!isFinalFunnelStep ? `<a class="next" href="/f/${encodeURIComponent(asset.slug)}?step=${funnelIndex + 2}${trackingSuffix}">Continue →</a>` : "<span></span>"}</nav>` : "";
  const status = result ? `<p class="notice">${esc(result)}</p>` : "";
  const currency = /^[A-Z]{3}$/.test(String(data.currency || "EUR")) ? String(data.currency || "EUR") : "EUR";
  const seoTitle = esc(data.seoTitle || heading);
  const seoDescription = esc(data.seoDescription || intro).slice(0, 300);
  const canonicalUrl = safeHttps(data.canonicalUrl);
  const ogImageUrl = safeHttps(data.ogImageUrl);
  const robots = data.noIndex ? '<meta name="robots" content="noindex,nofollow">' : '<meta name="robots" content="index,follow">';
  const script = buildMarketingScript(asset.kind, data, currency);
  const hiddenAttribution = renderMarketingAttributionFields(attribution);
  const embedScript = `<script>(()=>{const parents=${JSON.stringify(allowedOrigins)};const slug=${JSON.stringify(asset.slug)};const embedded=${embedded ? "true" : "false"};let origin="";let queued=false;const send=()=>{if(!origin||queued)return;queued=true;requestAnimationFrame(()=>{queued=false;parent.postMessage({type:"f2b-marketing-height",slug,height:Math.ceil(document.documentElement.scrollHeight)},origin)})};addEventListener("message",event=>{if(event.source!==parent||event.data?.type!=="f2b-marketing-ready"||event.data?.slug!==slug)return;if(embedded&&event.origin===location.origin){origin=event.origin;send();return}if(!parents.includes(event.origin))return;origin=event.origin;send()});if("ResizeObserver"in window)new ResizeObserver(send).observe(document.documentElement);addEventListener("load",send)})()</script>`;
  const parentEmbedScript = `<script>(()=>{const frames=[...document.querySelectorAll("iframe[data-f2b-marketing-slug]")];const send=frame=>frame.contentWindow?.postMessage({type:"f2b-marketing-ready",slug:frame.dataset.f2bMarketingSlug},location.origin);frames.forEach(frame=>{frame.addEventListener("load",()=>send(frame));if(frame.contentDocument?.readyState==="complete")send(frame)});addEventListener("message",event=>{if(event.origin!==location.origin||event.data?.type!=="f2b-marketing-height"||!Number.isFinite(event.data?.height))return;const frame=frames.find(item=>item.contentWindow===event.source&&item.dataset.f2bMarketingSlug===event.data.slug);if(!frame)return;frame.style.height=String(Math.max(180,Math.min(8000,Math.ceil(event.data.height))) )+"px"})})()</script>`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${seoTitle}</title><meta name="description" content="${seoDescription}">${robots}${canonicalUrl ? `<link rel="canonical" href="${esc(canonicalUrl)}">` : ""}<meta property="og:title" content="${seoTitle}"><meta property="og:description" content="${seoDescription}">${ogImageUrl ? `<meta property="og:image" content="${esc(ogImageUrl)}">` : ""}${structuredFaq}<style>:root{--brand:${design.brandColor};--page-bg:${design.backgroundColor};--page-text:${design.textColor};--content-width:${design.contentWidth}px;--font-stack:${fontStack}}*{box-sizing:border-box}body{margin:0;padding:32px 18px;background:var(--page-bg);color:var(--page-text);font:16px/1.55 var(--font-stack)}.wrap{max-width:var(--content-width);margin:auto;background:white;padding:clamp(24px,5vw,48px);border:1px solid #dce2e9;border-radius:18px;box-shadow:0 8px 32px #20304412}h1{font-size:clamp(28px,5vw,42px);line-height:1.12;margin:0 0 12px}.intro{color:#586575;margin-bottom:24px}.field{display:grid;gap:7px;margin:18px 0}.field span,.check{font-weight:650}.field input,.field textarea,.field select{width:100%;font:inherit;padding:12px;border:1px solid #cbd3dd;border-radius:8px;background:white;color:inherit}.field textarea{min-height:110px}.check{display:flex;gap:10px;align-items:flex-start;margin:18px 0}.block{margin:24px 0}.quote-summary{padding:18px;margin:22px 0;background:#edf4fb;border-radius:10px}.quote-summary h2{font-size:18px;margin:0 0 12px}.quote-summary dl{margin:0}.quote-summary dl>div{display:flex;justify-content:space-between;gap:16px;padding:7px 0;border-bottom:1px solid #d5e0ea}.quote-summary dd{margin:0;font-variant-numeric:tabular-nums}.quote-summary .quote-total{font-weight:750;font-size:20px;border-bottom:0;padding-top:13px}.quote-summary small{display:block;color:#586575;margin-top:8px}.step-actions,.funnel-nav{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:20px 0}.funnel-nav{padding:12px;border-radius:8px;background:#f2f6fa;font-size:14px}.funnel-nav a{color:#176fae;font-weight:700;text-decoration:none}.step-actions .secondary{background:#edf1f5;color:#18212f}button{font:inherit;font-weight:700;background:var(--brand);color:white;border:0;border-radius:8px;padding:13px 20px;cursor:pointer}.notice{background:#e9f8ef;padding:14px;border-radius:8px}.field[hidden],.check[hidden],[hidden]{display:none!important}.trap{position:absolute;left:-10000px;top:auto;width:1px;height:1px;overflow:hidden}.image-block img{display:block;width:100%;height:auto;border-radius:12px}.cta{display:inline-block;padding:11px 18px;border-radius:8px;background:var(--brand);color:#fff;text-decoration:none;font-weight:700}.hero-block,.pricing-block{padding:24px;background:#edf4fb;border-radius:12px}.quote-block{border-left:4px solid var(--brand);padding-left:18px}.quote-block blockquote{margin:0 0 8px}.columns-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.columns-grid-3{grid-template-columns:repeat(3,minmax(0,1fr))}.columns-grid-4{grid-template-columns:repeat(4,minmax(0,1fr))}.column-card{min-width:0;padding:18px;background:#f5f7fa;border:1px solid #dce2e9;border-radius:10px}.column-card h3{margin:0 0 8px;font-size:1.1em}.column-card p{margin:0}.column-card .cta{margin-top:14px}.columns-block h2{margin-bottom:8px}.container-layout{display:grid;gap:16px;margin-top:16px}.container-layout-stack{grid-template-columns:1fr}.container-layout-two{grid-template-columns:repeat(2,minmax(0,1fr))}.container-layout-three{grid-template-columns:repeat(3,minmax(0,1fr))}.container-layout>.block{min-width:0;margin:0}@media(max-width:680px){.columns-grid,.columns-grid-3,.columns-grid-4,.container-layout-two,.container-layout-three{grid-template-columns:1fr}.column-card{padding:16px}}@media(max-width:500px){body{padding:12px}.wrap{padding:22px 16px}}${responsiveBlockCss}${MARKETING_EDITABLE_TEXT_CSS}</style></head><body><main class="wrap">${funnelNav}<h1>${heading}</h1>${intro ? `<p class="intro">${intro}</p>` : ""}${status}${blocks}${isFinalFunnelStep && !submissionComplete ? `<form method="post" action="/f/${encodeURIComponent(asset.slug)}?step=${funnelIndex + 1}${embedded ? "&amp;embed=1" : ""}" enctype="${hasFileFields ? "multipart/form-data" : "application/x-www-form-urlencoded"}">${hiddenAttribution}${fieldHtml}${calculator}${button}</form>` : ""}</main>${script}${embedScript}${embeddedAssets.size ? parentEmbedScript : ""}</body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=60", "Content-Security-Policy": `default-src 'none'; img-src https: data:; media-src https:; frame-src 'self' https://www.youtube-nocookie.com https://player.vimeo.com; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'self' ${allowedOrigins.join(" ")}`, "X-Content-Type-Options": "nosniff", "Referrer-Policy": "strict-origin-when-cross-origin" } });
}
function jsonError(message: string, status: number) { return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } }); }

async function saveNativeCrmSubmission(asset: PublicAsset, fields: Field[], values: MarketingValues, submissionId: string, now: string, capture: unknown) {
  if (!env.DB) throw new Error("The private workspace database is unavailable.");
  // Every submission becomes a contact. Forms without an email or phone field
  // still create one, named from any name-like answer (or the form itself).
  const mapped: Record<string, string> = buildMarketingContactPayload(fields, values, "", `Website form · ${asset.name}`) || (() => {
    const answers = fields.map((field) => ({ label: String(field.label || ""), value: typeof values[String(field.id || "")] === "string" ? String(values[String(field.id || "")]).trim() : "" })).filter((item) => item.value && item.value.length <= 120);
    const named = answers.find((item) => /name/i.test(item.label)) || answers.find((item) => !/@|^\d+$/.test(item.value));
    return { name: named?.value || `${asset.name} lead`, email: "", phone: "" };
  })();
  const email = String(mapped.email || "").trim().toLowerCase();
  const phone = String(mapped.phone || "").trim();
  const contact = await env.DB.prepare("SELECT id FROM crm_contacts WHERE owner_id=?1 AND COALESCE(client_id,'')=COALESCE(?2,'') AND ((?3<>'' AND lower(email)=?3) OR (?4<>'' AND phone=?4)) ORDER BY updated_at DESC LIMIT 1").bind(asset.owner_id, asset.client_id, email, phone).first<{ id: string }>();
  const id = contact?.id || crypto.randomUUID();
  const fullName = String(mapped.name || [mapped.firstName, mapped.lastName].filter(Boolean).join(" ") || "").trim();
  const names = fullName.split(/\s+/).filter(Boolean);
  const firstName = String(mapped.firstName || names[0] || "").slice(0, 100);
  const lastName = String(mapped.lastName || names.slice(1).join(" ") || "").slice(0, 100);
  await env.DB.prepare("INSERT INTO crm_contacts (id, owner_id, client_id, first_name, last_name, email, phone, company, source, notes, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, '', ?10, ?10) ON CONFLICT(id) DO UPDATE SET first_name=CASE WHEN excluded.first_name<>'' THEN excluded.first_name ELSE crm_contacts.first_name END, last_name=CASE WHEN excluded.last_name<>'' THEN excluded.last_name ELSE crm_contacts.last_name END, email=CASE WHEN excluded.email<>'' THEN excluded.email ELSE crm_contacts.email END, phone=CASE WHEN excluded.phone<>'' THEN excluded.phone ELSE crm_contacts.phone END, company=CASE WHEN excluded.company<>'' THEN excluded.company ELSE crm_contacts.company END, source=excluded.source, updated_at=excluded.updated_at WHERE crm_contacts.owner_id=excluded.owner_id")
    .bind(id, asset.owner_id, asset.client_id, firstName, lastName, email, phone, String(mapped.companyName || "").slice(0, 200), `Website form · ${asset.name}`.slice(0, 100), now).run();
  const result: { status: string; detail?: string; contactId?: string; opportunityId?: string } = { status: contact ? "updated" : "created", contactId: id };
  const config = capture && typeof capture === "object" ? capture as { createOpportunity?: boolean; pipelineId?: string; stageId?: string; title?: string; value?: number; assignedTo?: string } : {};
  if (config.createOpportunity) {
    const pipelineId = String(config.pipelineId || ""), stageId = String(config.stageId || "");
    const stage = await env.DB.prepare("SELECT s.id FROM crm_pipeline_stages s JOIN crm_pipelines p ON p.id=s.pipeline_id AND p.owner_id=s.owner_id WHERE s.owner_id=?1 AND s.pipeline_id=?2 AND s.id=?3 AND p.archived=0").bind(asset.owner_id, pipelineId, stageId).first();
    if (!stage) result.detail = "Contact saved. Choose an active CRM pipeline stage before enabling opportunity creation.";
    else {
      const existing = await env.DB.prepare("SELECT id FROM crm_opportunities WHERE owner_id=?1 AND source_submission_id=?2").bind(asset.owner_id, submissionId).first<{ id: string }>();
      const opportunityId = existing?.id || crypto.randomUUID();
      await env.DB.prepare("INSERT INTO crm_opportunities (id, owner_id, pipeline_id, stage_id, contact_id, client_id, title, value, currency, assigned_to, source, source_submission_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'EUR', ?9, 'form submission', ?10, ?11, ?11) ON CONFLICT(id) DO UPDATE SET stage_id=excluded.stage_id, updated_at=excluded.updated_at WHERE crm_opportunities.owner_id=excluded.owner_id")
        .bind(opportunityId, asset.owner_id, pipelineId, stageId, id, asset.client_id, String(config.title || asset.name).slice(0, 200), Math.max(0, Number(config.value) || 0), String(config.assignedTo || "") || null, submissionId, now).run();
      result.opportunityId = opportunityId;
    }
  }
  return result;
}

export async function GET(request: Request) {
  const url = new URL(request.url); const slug = url.searchParams.get("slug") || "";
  const imageKey = url.searchParams.get("asset") || "";
  if (imageKey) return publishedImage(slug, imageKey);
  const asset = await findAsset(slug);
  const submissionComplete = url.searchParams.get("submitted") === "1";
  if (asset && !submissionComplete && !imageKey && env.DB) {
    try {
      await env.DB.prepare("INSERT INTO marketing_daily_analytics (owner_id, asset_id, metric_date, page_loads, submissions) VALUES (?1, ?2, ?3, 1, 0) ON CONFLICT(owner_id, asset_id, metric_date) DO UPDATE SET page_loads = page_loads + 1")
        .bind(asset.owner_id, asset.id, new Date().toISOString().slice(0, 10)).run();
    } catch { /* Analytics must never make a published page unavailable. */ }
  }
  return asset ? await page(asset, submissionComplete ? "Thanks — your details have been received." : "", Math.max(1, Number(url.searchParams.get("step") || 1) || 1), submissionComplete, readMarketingAttribution(url.searchParams), url.searchParams.get("embed") === "1") : jsonError("This published page could not be found.", 404);
}

export async function POST(request: Request) {
  if (!env.DB) return jsonError("Submissions are temporarily unavailable.", 503);
  const url = new URL(request.url); const slug = url.searchParams.get("slug") || ""; const requestedStep = Math.max(1, Number(url.searchParams.get("step") || 1) || 1);
  const asset = await findAsset(slug);
  if (!asset) return jsonError("This published form could not be found.", 404);
  if (asset.kind === "funnel") { const data = JSON.parse(asset.data) as { funnelSteps?: unknown[] }; if (Array.isArray(data.funnelSteps) && requestedStep < data.funnelSteps.length) return jsonError("Continue to the final funnel step before submitting.", 400); }
  const origin = request.headers.get("origin");
  if (origin) {
    const current = new URL(request.url).origin;
    const assetData = JSON.parse(asset.data) as { allowedDomains?: string[] };
    const allow = new Set([current, ...(assetData.allowedDomains || []).map((value) => { try { return new URL(/^https:\/\//i.test(value) ? value : `https://${value}`).origin; } catch { return ""; } })]);
    if (!allow.has(origin)) return jsonError("This site is not allowed to submit this form.", 403);
  }
  const contentLength = Number(request.headers.get("content-length") || 0);
  const isMultipart = request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data") === true;
  let form: FormData | URLSearchParams;
  if (isMultipart) {
    if (!contentLength || contentLength > MARKETING_SUBMISSION_TOTAL_MAX_BYTES) return jsonError("This submission can include up to 5 MB of files.", 413);
    try { form = await request.formData(); } catch { return jsonError("Send a valid form submission.", 400); }
  } else {
    if (contentLength > 24_000) return jsonError("This submission is too large.", 413);
    const reader = request.body?.getReader();
    if (!reader) return jsonError("Send a valid form submission.", 400);
    const chunks: Uint8Array[] = []; let totalBytes = 0;
    while (true) {
      const next = await reader.read(); if (next.done) break;
      totalBytes += next.value.byteLength;
      if (totalBytes > 24_000) { await reader.cancel(); return jsonError("This submission is too large.", 413); }
      chunks.push(next.value);
    }
    const text = new TextDecoder().decode(BufferlessConcat(chunks, totalBytes));
    form = new URLSearchParams(text);
  }
  const embedded = url.searchParams.get("embed") === "1";
  if (form.get("website")) return page(asset, "Thanks — your details have been received.", requestedStep, true, {}, embedded);
  const withinLimit = await consumeMarketingSubmissionRateLimit(env.DB, asset.owner_id, asset.id);
  if (!withinLimit) return jsonError("This form has received several submissions just now. Please wait a moment and try again.", 429);
  const data = JSON.parse(asset.data) as { fields?: Field[]; crmCapture?: { createOpportunity?: boolean; pipelineId?: string; stageId?: string; title?: string; value?: number; assignedTo?: string }; fixedFee?: number; minimumCharge?: number; percentageAdjustmentPercent?: number; discountPercent?: number; taxPercent?: number; currency?: string; _marketingPublicationVersion?: number };
  const allowed = new Map((data.fields || []).map((field, index) => [String(field.id || `field-${index + 1}`).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64), field]));
  const values: MarketingValues = {};
  const pendingFiles: Array<{ fieldId: string; file: File }> = [];
  for (const [key, field] of allowed) {
    if (field.type === "file") {
      const raw = form instanceof FormData ? form.get(key) : null;
      if (raw instanceof File && raw.size > 0) {
        if (raw.size > MARKETING_SUBMISSION_FILE_MAX_BYTES) return page(asset, "Each uploaded file must be 5 MB or smaller.", requestedStep, false, {}, embedded);
        values[key] = sanitizeMarketingSubmissionFilename(raw.name);
        pendingFiles.push({ fieldId: key, file: raw });
      }
      continue;
    }
    if (field.type === "calculated") continue;
    const rawValues = form.getAll(key).filter((value): value is string => typeof value === "string");
    const parsed = parseMarketingFieldValue(field, rawValues);
    if (parsed.error) return page(asset, parsed.error, requestedStep, false, {}, embedded);
    if (parsed.value !== undefined) values[key] = parsed.value;
  }
  const surveyPath = asset.kind === "survey" ? new Set(getMarketingSurveyPath([...allowed.values()], values)) : null;
  for (const [key, field] of allowed) {
    const fieldStep = Math.max(1, Math.min(10, Math.floor(Number(field.step) || 1)));
    if (surveyPath && !surveyPath.has(fieldStep)) { delete values[key]; continue; }
    const visible = isMarketingFieldVisible(field, values);
    if (!visible) { delete values[key]; continue; }
    if (field.type === "calculated") continue;
    const value = values[key];
    if (field.required && !isMarketingRequiredValuePresent(value)) return page(asset, "Please complete all required fields.", requestedStep, false, {}, embedded);
  }
  Object.assign(values, calculateMarketingDerivedValues([...allowed.values()], values));
  const id = crypto.randomUUID();
  const storedFiles: Array<{ id: string; fieldId: string; name: string; mime: string; size: number; key: string }> = [];
  if (pendingFiles.some((item) => Object.hasOwn(values, item.fieldId))) {
    if (!env.BUCKET) return jsonError("File uploads are temporarily unavailable.", 503);
    let totalFileBytes = 0;
    const validatedFiles: Array<{ fieldId: string; name: string; size: number; bytes: Uint8Array; type: NonNullable<ReturnType<typeof detectMarketingSubmissionFileType>> }> = [];
    for (const item of pendingFiles) {
      if (!Object.hasOwn(values, item.fieldId)) continue;
      totalFileBytes += item.file.size;
      if (totalFileBytes > MARKETING_SUBMISSION_FILE_MAX_BYTES) return jsonError("Total uploaded files must be 5 MB or smaller.", 413);
      const bytes = new Uint8Array(await item.file.arrayBuffer());
      const type = detectMarketingSubmissionFileType(bytes);
      if (!type) return page(asset, "Upload a PDF, PNG, JPEG or WebP file.", requestedStep, false, {}, embedded);
      validatedFiles.push({ fieldId: item.fieldId, name: sanitizeMarketingSubmissionFilename(item.file.name), size: item.file.size, bytes, type });
    }
    try {
      for (const item of validatedFiles) {
        const fileId = crypto.randomUUID();
        const key = `${marketingSubmissionFilePrefix(asset.owner_id, id)}${fileId}.${item.type.ext}`;
        await env.BUCKET.put(key, item.bytes, { httpMetadata: { contentType: item.type.mime, cacheControl: "private, no-store" } });
        storedFiles.push({ id: fileId, fieldId: item.fieldId, name: item.name, mime: item.type.mime, size: item.size, key });
      }
    } catch {
      await Promise.all(storedFiles.map((file) => env.BUCKET!.delete(file.key)));
      return jsonError("The uploaded file could not be stored. Please retry.", 503);
    }
  }
  let quoteSummary: (ReturnType<typeof calculateMarketingQuote> & { calculatorVersion: number; currency: string; pricingRuleVersion: string }) | undefined;
  if (asset.kind === "calculator") {
    const ruleDigest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(asset.data));
    const pricingRuleVersion = [...new Uint8Array(ruleDigest)].map((byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 16);
    const publishedVersion = Number(data._marketingPublicationVersion) || asset.version;
    quoteSummary = createMarketingQuoteSnapshot({ quote: calculateMarketingQuote([...allowed.values()], values, data), calculatorVersion: publishedVersion, currency: data.currency, pricingRuleVersion });
  }
  const now = new Date().toISOString();
  const attribution = readSubmittedMarketingAttribution(form);
  let complete: Record<string, unknown> = { values, submittedAt: now, ...(Object.keys(attribution).length ? { attribution } : {}), ...(storedFiles.length ? { files: storedFiles.map(({ id: fileId, fieldId, name, mime, size }) => ({ id: fileId, fieldId, name, mime, size })) } : {}), ...(quoteSummary ? { calculatedTotal: quoteSummary.total, quoteSummary } : {}) };
  try {
    await env.DB.prepare("INSERT INTO marketing_submissions (id, owner_id, asset_id, kind, data, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)").bind(id, asset.owner_id, asset.id, asset.kind, JSON.stringify(complete), now).run();
  } catch (error) {
    if (env.BUCKET) await Promise.all(storedFiles.map((file) => env.BUCKET!.delete(file.key)));
    throw error;
  }
  try {
    await env.DB.prepare("INSERT INTO marketing_daily_analytics (owner_id, asset_id, metric_date, page_loads, submissions) VALUES (?1, ?2, ?3, 0, 1) ON CONFLICT(owner_id, asset_id, metric_date) DO UPDATE SET submissions = submissions + 1")
      .bind(asset.owner_id, asset.id, now.slice(0, 10)).run();
  } catch { /* Analytics must never hide a successful submission. */ }
  try {
    const crm = await saveNativeCrmSubmission(asset, data.fields || [], values, id, now, data.crmCapture);
    complete = { ...complete, crm };
  } catch (error) {
    complete = { ...complete, crm: { status: "failed", detail: (error instanceof Error ? error.message : "Native CRM could not save this submission.").slice(0, 300) } };
  }
  await env.DB.prepare("UPDATE marketing_submissions SET data = ?1 WHERE id = ?2 AND owner_id = ?3").bind(JSON.stringify(complete), id, asset.owner_id).run();
  try { await enqueueMarketingAutomations(env.DB, { ...asset, fields: (data.fields || []).map((field, index) => ({ id: String(field.id || `field-${index + 1}`), label: field.label, type: field.type })) }, { id, owner_id: asset.owner_id, asset_id: asset.id, kind: asset.kind, data: JSON.stringify(complete), created_at: now }); } catch (error) { console.error("Marketing automation enqueue failed", error); }
  const successUrl = new URL(`/api/marketing-public?slug=${encodeURIComponent(asset.slug)}&step=${requestedStep}&submitted=1`, request.url);
  if (embedded) successUrl.searchParams.set("embed", "1");
  return new Response(null, { status: 303, headers: { Location: successUrl.toString(), "Cache-Control": "no-store" } });
}

function BufferlessConcat(chunks: Uint8Array[], size: number) {
  const result = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}
