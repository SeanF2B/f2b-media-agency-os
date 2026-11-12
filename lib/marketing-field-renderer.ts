type DisplayField = { type?: string; label?: string; description?: string };

const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

export function renderMarketingDisplayField(field: DisplayField, condition = "") {
  const label = escapeHtml(field.label || "");
  const description = escapeHtml(field.description || "");
  if (field.type === "heading") return `<section class="field-content field-heading"${condition}><h2>${label}</h2>${description ? `<p>${description}</p>` : ""}</section>`;
  if (field.type === "description") return `<section class="field-content field-description"${condition}><p>${description || label}</p></section>`;
  if (field.type === "divider") return `<hr class="field-divider"${condition} aria-hidden="true">`;
  if (field.type === "progress") return `<div class="field-progress"${condition} aria-live="polite" data-survey-progress>${label || "Progress"}</div>`;
  return null;
}
