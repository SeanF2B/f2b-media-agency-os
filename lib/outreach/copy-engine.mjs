// Adaptive Copy Engine — keeps every email natural, personal and different.
//  - Each send renders several candidates (A/B variant × spintax seeds × AI opener variants)
//    and picks the one least similar to the campaign's recent emails (5-word shingles).
//  - Every candidate is linted: unfilled merge fields, clichés, spammy phrasing, too many links,
//    shouting, length. A candidate with a blocking issue is never sent.

import { renderTemplate } from "./personalise.mjs";

const CLICHES = ["i hope this email finds you well", "i hope you're well", "i hope you are doing well", "just following up", "just checking in", "touching base", "circling back", "i wanted to reach out", "quick question for you", "per my last email"];
const SPAMMY = ["100% free", "risk-free", "risk free", "guaranteed", "act now", "limited time", "click here", "buy now", "no obligation", "winner", "cash bonus", "earn money", "double your", "urgent", "!!!"];

function fnv(text) { let hash = 2166136261; for (let i = 0; i < text.length; i += 1) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); } return (hash >>> 0).toString(36); }
const normalise = (text) => String(text || "").toLowerCase().replace(/\{\{[^}]+\}\}/g, " ").replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();

export function fingerprint(text, size = 5) {
  const words = normalise(text).split(" ").filter(Boolean);
  const out = new Set();
  if (words.length < size) { if (words.length) out.add(fnv(words.join(" "))); return out; }
  for (let i = 0; i + size <= words.length; i += 1) out.add(fnv(words.slice(i, i + size).join(" ")));
  return out;
}
export const serialiseFingerprint = (set) => [...set].slice(0, 400).join(",");
export const parseFingerprint = (text) => new Set(String(text || "").split(",").filter(Boolean));

export function similarity(a, b) {
  if (!a.size || !b.size) return 0;
  let shared = 0; for (const item of a) if (b.has(item)) shared += 1;
  return shared / (a.size + b.size - shared);
}

export function lintEmail({ subject = "", body = "", step = 0 }) {
  const issues = [];
  const text = `${subject}\n${body}`;
  const lower = text.toLowerCase();
  if (/\{\{|\}\}/.test(text)) issues.push({ level: "block", code: "merge-field", message: "An unfilled merge field is still in the email." });
  if (!body.trim()) issues.push({ level: "block", code: "empty", message: "The email body is empty." });
  if (step === 0 && !subject.trim()) issues.push({ level: "block", code: "no-subject", message: "The first email needs a subject." });
  for (const phrase of CLICHES) if (lower.includes(phrase)) issues.push({ level: "warn", code: "cliche", message: `Cliché: "${phrase}".` });
  for (const phrase of SPAMMY) if (lower.includes(phrase)) issues.push({ level: "warn", code: "spammy", message: `Spam-filter trigger: "${phrase}".` });
  const links = (body.match(/https?:\/\//g) || []).length;
  if (step === 0 && links > 1) issues.push({ level: "warn", code: "links", message: "More than one link in a first email hurts deliverability." });
  if ((text.match(/!/g) || []).length > 1) issues.push({ level: "warn", code: "exclaim", message: "More than one exclamation mark." });
  if ((text.match(/\b[A-Z]{4,}\b/g) || []).filter((word) => !["SEO", "PPC", "HTML", "GDPR", "B2B"].includes(word)).length) issues.push({ level: "warn", code: "caps", message: "Words in capitals read as shouting." });
  const words = body.split(/\s+/).filter(Boolean).length;
  if (step === 0 && words > 150) issues.push({ level: "warn", code: "long", message: `${words} words — first emails work best under 120.` });
  if (subject.length > 60) issues.push({ level: "warn", code: "subject-long", message: "Subject is over 60 characters." });
  return { ok: !issues.some((issue) => issue.level === "block"), issues };
}

/**
 * Pick the freshest valid candidate.
 * @param {Array<{subject:string, body:string, variantId:string, seed:string}>} candidates  already rendered
 * @param {Set<string>[]} recent  fingerprints of the campaign's recent sends
 */
export function chooseFreshest(candidates, recent, { threshold = 0.45, step = 0 } = {}) {
  const scored = candidates.map((candidate) => {
    const print = fingerprint(`${candidate.subject} ${candidate.body}`);
    const maxSimilarity = recent.reduce((max, other) => Math.max(max, similarity(print, other)), 0);
    const lint = lintEmail({ ...candidate, step });
    return { ...candidate, print, maxSimilarity, lint, score: maxSimilarity + lint.issues.filter((issue) => issue.level === "warn").length * 0.05 };
  }).filter((candidate) => candidate.lint.ok);
  if (!scored.length) return { chosen: null, reason: "Every candidate had a blocking problem (usually missing personalisation)." };
  scored.sort((a, b) => a.score - b.score);
  const chosen = scored[0];
  return { chosen, repetitive: chosen.maxSimilarity > threshold, reason: chosen.maxSimilarity > threshold ? `Even the freshest version is ${Math.round(chosen.maxSimilarity * 100)}% similar to a recent email — add more variants.` : "" };
}

/** Render candidates for one send: each variant × a few spintax seeds × optional AI openers. */
export function renderCandidates({ variants, variables, openers = [], enrollmentId, step, subjectFallback = "" }) {
  const out = [];
  const openerList = openers.length ? openers : [""];
  for (const variant of variants) {
    for (let seedIndex = 0; seedIndex < 3; seedIndex += 1) {
      for (const opener of openerList) {
        const seed = `${enrollmentId}:${step}:${variant.id}:${seedIndex}`;
        const vars = { ...variables, opener: opener || variables.opener || "" };
        const subject = renderTemplate(variant.subject || subjectFallback, vars, `${seed}:s`);
        const body = renderTemplate(variant.body, vars, `${seed}:b`);
        out.push({ variantId: variant.id, seed, subject: subject.text.trim(), body: body.text.replace(/\n{3,}/g, "\n\n").trim(), missing: [...subject.missing, ...body.missing] });
      }
    }
  }
  return out.map((candidate) => candidate.missing.length ? { ...candidate, body: `${candidate.body}{{${candidate.missing[0]}}}` } : candidate);
}
