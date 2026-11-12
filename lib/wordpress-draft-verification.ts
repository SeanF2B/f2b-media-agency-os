type WordPressTextValue = string | { raw?: unknown; rendered?: unknown } | null | undefined;
export type WordPressDraftReadback = { id?: unknown; status?: unknown; slug?: unknown; title?: WordPressTextValue; content?: WordPressTextValue; link?: unknown };

function text(value: WordPressTextValue) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") return String(value.raw || value.rendered || "");
  return "";
}

function plainContent(value: string) {
  return value.replace(/<!--([\s\S]*?)-->/g, " ").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

function safeDraftLink(value: unknown, siteUrl: string, pageId: number) {
  const site = new URL(siteUrl);
  const supplied = typeof value === "string" ? value.trim() : "";
  if (supplied) {
    try {
      const link = new URL(supplied, site);
      const sameHost = link.hostname.replace(/^www\./i, "").toLowerCase() === site.hostname.replace(/^www\./i, "").toLowerCase();
      if (link.protocol === "https:" && sameHost && !link.username && !link.password) return link.toString();
    } catch { /* use the site's own editor link below */ }
  }
  const editor = new URL("wp-admin/post.php", site.href.endsWith("/") ? site : `${site.href}/`);
  editor.search = new URLSearchParams({ post: String(pageId), action: "edit" }).toString();
  return editor.toString();
}

export function verifyWordPressDraft(input: { expectedTitle: string; expectedSlug?: string; expectedContent: string; expectedStatus?: string; siteUrl: string; saved: WordPressDraftReadback }) {
  const saved = input.saved;
  const pageId = Number(saved.id);
  const actualTitle = text(saved.title).trim();
  const actualSlug = String(saved.slug || "").trim();
  const actualContent = text(saved.content);
  const issues: string[] = [];
  if (!Number.isSafeInteger(pageId) || pageId < 1) issues.push("WordPress did not return a valid page ID.");
  const expectedStatus = input.expectedStatus || "draft";
  if (String(saved.status || "").toLowerCase() !== expectedStatus) issues.push(`WordPress did not confirm that the page status is “${expectedStatus}”.`);
  if (actualTitle !== input.expectedTitle) issues.push("The saved page title does not match the requested title.");
  if (input.expectedSlug && actualSlug !== input.expectedSlug) issues.push("The saved page URL slug does not match the requested slug.");
  const expectedText = plainContent(input.expectedContent).split(" ").slice(0, 6).join(" ");
  const savedText = plainContent(actualContent);
  if (!expectedText || !savedText.includes(expectedText)) issues.push("WordPress read-back did not confirm the page content.");
  return {
    verified: issues.length === 0,
    pageId: Number.isSafeInteger(pageId) && pageId > 0 ? pageId : 0,
    title: actualTitle || input.expectedTitle,
    slug: actualSlug || input.expectedSlug,
    link: Number.isSafeInteger(pageId) && pageId > 0 ? safeDraftLink(saved.link, input.siteUrl, pageId) : "",
    issues,
  };
}
