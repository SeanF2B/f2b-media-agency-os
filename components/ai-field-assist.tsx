"use client";

// Floating "✨ AI" helper for form fields in Operations (SEO, Google Ads, Business & community, websites,
// onboarding, audits…). Focus a text field and a small button appears: it suggests a value when the field
// is empty, or polishes what's typed. It lives in its own overlay, so it never touches React-managed DOM.
import { useCallback, useEffect, useRef, useState } from "react";

const ROOTS = ".ops-centre, .seo-view, .google-ads-view, .studio-panel";
const LIST_HINT = /(keyword|seed|phrase|negative|tags?\b|services?\b|locations?|areas?|competitor|questions?|ideas|topics|headlines|hashtags)/i;

type Target = HTMLInputElement | HTMLTextAreaElement;
const FACTUAL = /(phone|mobile|telephone|\btel\b|e-?mail|address|postcode|eircode|zip code|vat|company number|\biban\b|\bbic\b|customer id|account id|property id|location id|pixel id|price|budget €|password|act_\d|\d{3}-\d{3}-\d{4}|properties\/|locations\/|sc-domain)/i;
const URL_FIELD = /domain|website|site url|\burl\b/i;
type Mode = "suggest" | "improve" | "shorter" | "professional" | "alternatives" | "regenerate";
const MODE_LABEL: Record<Mode, string> = { suggest: "Suggest with AI", improve: "Improve my answer", shorter: "Make it shorter", professional: "More professional", alternatives: "Alternatives", regenerate: "Regenerate" };

function eligible(el: Element | null): el is Target {
  if (!el || !(el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement)) return false;
  if (el.disabled || el.readOnly) return false;
  if (el instanceof HTMLInputElement && !["text", ""].includes(el.type)) return false;
  if (!el.closest(ROOTS)) return false;
  if (el.closest(".crm-contacts-manager, .ops-toolbar, [data-no-ai]")) return false;
  const label = labelFor(el);
  if (/^search\b|search clients|filter/i.test(label) || /^search/i.test(el.placeholder || "")) return false;
  // Simple factual fields (phone, email, address, IDs…) never get AI — it can't know them and shouldn't guess.
  if (FACTUAL.test(label) || FACTUAL.test(el.placeholder || "") || FACTUAL.test(el.name || "")) return false;
  return true;
}

function labelFor(el: Target): string {
  const own = el.getAttribute("aria-label");
  if (own) return own.trim();
  if (el.id) { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l?.textContent) return l.textContent.trim(); }
  const wrap = el.closest("label");
  if (wrap) { const span = wrap.querySelector("span, b, strong"); const text = (span?.textContent || wrap.textContent || "").replace(el.value, "").trim(); if (text) return text.slice(0, 120); }
  const prev = el.previousElementSibling; if (prev?.textContent) return prev.textContent.trim().slice(0, 120);
  return (el.placeholder || el.name || "Text").slice(0, 120);
}

function contextFor(el: Target) {
  const scope = el.closest("form, section, .panel, fieldset") || el.parentElement;
  if (!scope) return [];
  return Array.from(scope.querySelectorAll("input, textarea, select")).filter((other) => other !== el).slice(0, 14).map((other) => {
    const node = other as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    if (node instanceof HTMLInputElement && ["checkbox", "radio", "hidden", "file", "password"].includes(node.type)) return null;
    const value = node instanceof HTMLSelectElement ? node.selectedOptions[0]?.textContent || "" : node.value;
    const label = node instanceof HTMLSelectElement ? (node.closest("label")?.querySelector("span")?.textContent || node.getAttribute("aria-label") || "") : labelFor(node as Target);
    return value.trim() ? { label: label.trim(), value: value.trim() } : null;
  }).filter(Boolean) as Array<{ label: string; value: string }>;
}

function selectedClientName(el: Target): string {
  const root = el.closest(ROOTS) || document;
  const selects = Array.from(root.querySelectorAll("select")) as HTMLSelectElement[];
  const pick = selects.find((select) => /client/i.test(select.getAttribute("aria-label") || select.closest("label")?.textContent || select.previousElementSibling?.textContent || ""));
  return pick?.selectedOptions[0]?.textContent?.trim() || "";
}

function scopedClientId(): string {
  // Inside a sub-account the cookie names the client; in the agency view the client picked in the top bar does.
  try { const match = document.cookie.match(/(?:^|;\s*)f2b_client=([^;]+)/); const value = match ? decodeURIComponent(match[1]) : ""; if (value && value !== "agency") return value; return window.localStorage.getItem("f2b-focus-client") || window.localStorage.getItem("f2b-ops-client") || ""; } catch { return ""; }
}

// Remembers what was typed in each field (per client) so it can be reused next time with one click.
const rememberKey = (el: Target) => `f2b-remember:${scopedClientId() || "agency"}:${labelFor(el).toLowerCase().slice(0, 80)}`;
function rememberValue(el: Target) { try { const v = el.value.trim(); if (v && v.length <= 2000) window.localStorage.setItem(rememberKey(el), v); } catch { /* storage unavailable */ } }
function recalled(el: Target) { try { return window.localStorage.getItem(rememberKey(el)) || ""; } catch { return ""; } }
function setNativeValue(el: Target, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

export function AiFieldAssist() {
  const [target, setTarget] = useState<Target | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [undo, setUndo] = useState<{ el: Target; value: string } | null>(null);
  const hideTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const onFocus = (event: FocusEvent) => { const el = event.target as Element; if (eligible(el)) { window.clearTimeout(hideTimer.current); setTarget(el); setRect(el.getBoundingClientRect()); setMessage(""); } };
    const onBlur = (event: FocusEvent) => { const el = event.target as Element; if (eligible(el)) rememberValue(el); hideTimer.current = window.setTimeout(() => { if (!busy) { setTarget(null); setUndo(null); } }, 180); };
    document.addEventListener("focusin", onFocus); document.addEventListener("focusout", onBlur);
    return () => { document.removeEventListener("focusin", onFocus); document.removeEventListener("focusout", onBlur); };
  }, [busy]);

  useEffect(() => {
    if (!target) return;
    const update = () => { if (!document.contains(target)) { setTarget(null); return; } setRect(target.getBoundingClientRect()); };
    window.addEventListener("scroll", update, true); window.addEventListener("resize", update);
    const observer = new ResizeObserver(update); observer.observe(target);
    return () => { window.removeEventListener("scroll", update, true); window.removeEventListener("resize", update); observer.disconnect(); };
  }, [target]);

  const [chips, setChips] = useState<string[]>([]);
  const [lastSuggestion, setLastSuggestion] = useState("");
  const [menu, setMenu] = useState(false);
  useEffect(() => { setChips([]); setMenu(false); setLastSuggestion(""); }, [target]);

  const run = useCallback(async (mode: Mode) => {
    if (!target || busy) return;
    const current = target.value;
    const field = labelFor(target);
    const list = target instanceof HTMLTextAreaElement && LIST_HINT.test(`${field} ${target.placeholder}`);
    setBusy(true); setMessage(""); setMenu(false);
    try {
      // Website/domain fields are answered instantly from the client record (no AI call) by the existing endpoint.
      const urlField = URL_FIELD.test(`${field} ${target.placeholder}`) && mode === "suggest";
      const response = urlField
        ? await fetch("/api/ai-assist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId: scopedClientId(), clientName: selectedClientName(target), field, placeholder: target.placeholder, current, mode: "suggest" }) })
        : await fetch("/api/onboarding", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "ai", mode, clientId: scopedClientId(), clientName: selectedClientName(target), field, placeholder: target.placeholder, current, previous: lastSuggestion, list, context: contextFor(target), page: document.querySelector(".ops-centre [aria-selected=\"true\"], .ops-centre .active")?.textContent?.trim() || "" }) });
      const result = await response.json() as { text?: string; suggestions?: string[]; removedClaims?: number; error?: string };
      const options = result.suggestions || (result.text ? [result.text] : []);
      if (!response.ok || !options.length) throw new Error(result.error || "Couldn’t get a suggestion.");
      if (mode === "alternatives") { setChips(options); setMessage("Pick one — or keep yours"); target.focus(); return; }
      setUndo({ el: target, value: current });
      setNativeValue(target, options[0]);
      setLastSuggestion(options[0]);
      target.focus();
      setMessage(`${mode === "suggest" || mode === "regenerate" ? "Suggested — edit as needed" : "Updated"}${result.removedClaims ? " · unsupported claims removed" : ""}`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Couldn’t get a suggestion."); target.focus(); }
    finally { setBusy(false); }
  }, [target, busy, lastSuggestion]);

  if (!target || !rect || rect.width < 120) return null;
  const empty = !target.value.trim();
  const last = empty ? recalled(target) : "";
  const modes: Mode[] = empty ? ["suggest", "alternatives"] : ["improve", "shorter", "professional", "alternatives", ...(lastSuggestion ? ["regenerate" as Mode] : [])];
  const top = Math.max(4, rect.top - 30), left = Math.min(window.innerWidth - 230, Math.max(4, rect.right - 220));
  const pick = (text: string) => { setUndo({ el: target, value: target.value }); setNativeValue(target, text); setLastSuggestion(text); setChips([]); setMessage("Added — edit as needed"); target.focus(); };
  return <div className="ai-field-assist" style={{ top, left }} onMouseDown={(event) => event.preventDefault()}>
    <span className="ai-field-assist-split">
      <button type="button" className="ai-field-assist-btn" disabled={busy} onClick={() => void run(empty ? "suggest" : "improve")} title={empty ? "Let AI suggest an answer from the client's details" : "Let AI improve what you've written"}>
        <span aria-hidden="true">✨</span>{busy ? "Thinking…" : empty ? "AI suggest" : "AI improve"}
      </button>
      <button type="button" className="ai-field-assist-more" aria-label="More AI options" aria-expanded={menu} disabled={busy} onClick={() => setMenu((open) => !open)}>▾</button>
    </span>
    {menu && <div className="ai-field-assist-menu" role="menu">{modes.map((mode) => <button key={mode} type="button" role="menuitem" onClick={() => void run(mode)}>{MODE_LABEL[mode]}</button>)}</div>}
    {last && !busy && <button type="button" className="ai-field-assist-undo" title={last} onClick={() => { setUndo({ el: target, value: "" }); setNativeValue(target, last); target.focus(); setMessage("Filled from last time"); }}>↺ Last used</button>}
    {undo && undo.el === target && !busy && <button type="button" className="ai-field-assist-undo" onClick={() => { setNativeValue(undo.el, undo.value); setUndo(null); setMessage("Undone"); }}>Undo</button>}
    {message && <span className="ai-field-assist-msg" role="status">{message}</span>}
    {chips.length > 0 && <div className="ai-field-assist-chips" style={{ top: rect.height + 34 }}>{chips.map((chip, index) => <button key={index} type="button" title={chip} onClick={() => pick(chip)}>{chip.length > 140 ? `${chip.slice(0, 140)}…` : chip}</button>)}<button type="button" className="ai-field-assist-dismiss" onClick={() => { setChips([]); setMessage(""); }}>Dismiss</button></div>}
  </div>;
}
