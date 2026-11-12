const clean = (value) => String(value ?? "").trim().replace(/\s+/g, " ");

/** Accepts an AI outreach line only when it is anchored to an exact public-page quote. */
export function validateLeadPersonalLine(lineValue, evidenceValue, sourceText) {
  const line = clean(lineValue).slice(0, 260);
  const evidence = clean(evidenceValue).slice(0, 280);
  if (!line && !evidence) return { status: "needs_review", line: "", evidence: "" };
  const words = line.split(/\s+/).filter(Boolean).length;
  if (words < 5 || words > 30) return { status: "invalid", error: "The line must be short and clear." };
  if (!evidence) return { status: "invalid", error: "The AI did not supply supporting website evidence." };
  if (!clean(sourceText).includes(evidence)) return { status: "invalid", error: "The supporting quote does not match the website text." };
  if (/[\r\n]/.test(line) || line.length < 18) return { status: "invalid", error: "The line is not a single useful sentence." };
  return { status: "supported", line, evidence };
}
