// Proposal Studio · presentation renderer.
// Turns a deck into one self-contained HTML presentation: 16:11.6 slides (the same proportions as F2B's
// proposals), blue/black/white F2B identity, CSS/SVG device mockups and marketing graphics, scroll-in
// animations like the live reports, and an A4-landscape print layout for "Download PDF".
// With editable=true every text block is contenteditable and images are click-to-swap; edits are posted
// to the parent window (the live editor). Pure function — runs in the browser and on the Worker.

import type { ProposalBrand, ProposalDeck, Slide } from "./deck";

export type RenderOptions = {
  editable?: boolean;
  /** Resolves stored "r2:<name>" assets to a URL (auth API in the app, token route on the share page). */
  assetUrl?: (name: string) => string;
  agencyLogo?: string;
  title?: string;
  /** Slide id to scroll to after load (keeps the editor in place on re-render). */
  focusSlide?: string;
  /** Adds the floating "Download PDF" button (share page / full screen). */
  printButton?: boolean;
  approveUrl?: string;
};

const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const attr = esc;

export function renderProposalHtml(deck: ProposalDeck, brand: ProposalBrand, opts: RenderOptions = {}) {
  const edit = Boolean(opts.editable);
  const accent = /^#[0-9a-f]{6}$/i.test(deck.accent) ? deck.accent : "#1463ff";
  const img = (src: string | undefined) => {
    const value = String(src || "");
    if (value.startsWith("r2:")) return opts.assetUrl ? opts.assetUrl(value.slice(3)) : "";
    if (/^https:\/\//i.test(value) || /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(value) || value.startsWith("/")) return value;
    return "";
  };
  /** Editable text node. */
  const t = (slide: Slide, path: string, tag = "span", cls = "") => {
    const value = path.split(".").reduce<any>((node, key) => (node == null ? node : node[key]), slide.data);
    return `<${tag}${cls ? ` class="${cls}"` : ""}${edit ? ` data-e="${attr(slide.id)}|${attr(path)}" contenteditable="plaintext-only" spellcheck="true"` : ""}>${esc(value)}</${tag}>`;
  };
  /** Swappable picture. key = brand field ("brand.screenshotDesktop") or slide field ("images.0"). */
  const pic = (slide: Slide, key: string, fallback: string, cls = "shot", alt = "") => {
    const own = key.startsWith("brand.") ? (brand as any)[key.slice(6)] : key.split(".").reduce<any>((node, k) => (node == null ? node : node[k]), slide.data);
    const src = img(own) || img(fallback);
    const data = edit ? ` data-img="${attr(slide.id)}|${attr(key)}" title="Click to change image"` : "";
    return src ? `<img class="${cls}" src="${attr(src)}" alt="${attr(alt)}" loading="lazy"${data}>` : `<div class="${cls} ph"${data}><span>${edit ? "Click to add image" : esc(brand.businessName)}</span></div>`;
  };
  const desktopShot = brand.screenshotDesktop || brand.images[0] || "";
  const mobileShot = brand.screenshotMobile || brand.screenshotDesktop || brand.images[0] || "";
  const imageAt = (index: number) => brand.images[index] || brand.images[0] || desktopShot;
  const logo = img(brand.logo);
  const agencyLogo = opts.agencyLogo || "";

  const desktop = (inner: string, cls = "") => `<div class="mac ${cls}"><div class="mac-screen">${inner}</div><div class="mac-chin"></div><div class="mac-neck"></div><div class="mac-foot"></div></div>`;
  const phone = (inner: string, cls = "") => `<div class="phone ${cls}"><div class="phone-screen">${inner}</div><i class="notch"></i></div>`;
  const swoosh = (pos: string) => `<svg class="swoosh ${pos}" viewBox="0 0 120 400" aria-hidden="true"><path d="M95 0 C 40 120, 90 260, 18 400" fill="none" stroke="${accent}" stroke-width="26" stroke-linecap="round"/></svg>`;
  const icon = (name: string) => {
    const paths: Record<string, string> = {
      search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l5 5"/>',
      target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>',
      pin: '<path d="M12 21s-6.5-6.2-6.5-11.2A6.5 6.5 0 0 1 18.5 9.8C18.5 14.8 12 21 12 21z"/><circle cx="12" cy="10" r="2.4"/>',
      chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
      spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/>',
      monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
      cursor: '<path d="M5 3l14 7-6 2-2 6z"/>',
      social: '<rect x="4" y="4" width="16" height="16" rx="5"/><circle cx="12" cy="12" r="3.5"/><circle cx="17" cy="7" r="1" fill="currentColor"/>',
      repeat: '<path d="M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5M20 12a8 8 0 0 1-14 5.3L4 15M4 20v-5h5"/>',
      mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
      chat: '<path d="M4 18l1.5-4A8 8 0 1 1 9 19z"/><path d="M9 10h6M9 13h4"/>',
      gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
      check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
      clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
      plus: '<path d="M12 5v14M5 12h14"/>',
      star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" fill="currentColor"/>',
    };
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.spark}</svg>`;
  };
  const visualIcon: Record<string, string> = { search: "search", maps: "pin", seo: "chart", ai: "spark", site: "monitor", landing: "cursor", social: "social", retarget: "repeat", email: "mail", whatsapp: "chat", dashboard: "gear" };
  const serviceVisual = (key: string) => ({ "google-ads": "search", seo: "seo", geo: "ai", aeo: "ai", gbp: "maps", website: "site", landing: "landing", "meta-ads": "social", retargeting: "retarget", social: "social", email: "email", whatsapp: "whatsapp", crm: "dashboard" } as Record<string, string>)[key] || "site";
  const card = (slide: Slide, iconName: string, titlePath: string, bodyPath: string) => `<div class="icard a"><span class="icard-ico">${icon(iconName)}</span>${t(slide, titlePath, "b")}${t(slide, bodyPath, "p")}</div>`;

  const searchScreen = (term: string) => `<div class="serp"><div class="serp-glow"></div><div class="serp-brand"><span>${icon("search")}</span>Search</div><div class="serp-box"><div class="serp-q">${icon("search")}<b>${esc(term || "your service near me")}</b></div>${[0, 1, 2, 3, 4, 5].map((index) => `<div class="serp-row" style="--d:${index}">${icon("search")}<span>${esc(term || "your service")} ${["", "cost", "near me", "reviews", "best", "quote"][index]}</span></div>`).join("")}</div></div>`;
  const browser = (inner: string) => `<div class="browser"><div class="browser-bar"><i></i><i></i><i></i><span>${esc((brand.website || "").replace(/^https?:\/\//, "").replace(/\/$/, "") || "yourwebsite.ie")}</span></div>${inner}</div>`;

  const serviceGraphic = (slide: Slide) => {
    const visual = serviceVisual(String(slide.data.serviceKey || ""));
    const term = String(slide.data.searchTerm || "");
    switch (visual) {
      case "search": return desktop(searchScreen(term), "big a d2");
      case "maps": return `<div class="mapwrap a d2"><div class="map">${[18, 42, 66, 30, 78, 55].map((x, index) => `<i class="pin${index === 2 ? " me" : ""}" style="left:${x}%;top:${[30, 62, 38, 22, 55, 75][index]}%">${icon("pin")}</i>`).join("")}</div><div class="listing">${logo ? `<img src="${attr(logo)}" alt="">` : ""}<b>${esc(brand.businessName)}</b><span class="stars">${icon("star").repeat(5)}<em>5.0</em></span><small>${esc((brand.areas || "").split(/[,\n]/)[0] || "Open now")} · Call · Directions · Website</small></div></div>`;
      case "seo": return `<div class="duo a d2">${desktop(browser(pic(slide, "brand.screenshotDesktop", desktopShot)), "big")}${phone(pic(slide, "brand.screenshotMobile", mobileShot), "front")}<div class="rank">${[38, 52, 64, 78, 92].map((h, index) => `<i style="height:${h}%;--d:${index}"></i>`).join("")}<span>Organic traffic</span></div></div>`;
      case "ai": return `<div class="aiq a d2"><div class="aiq-ask">${icon("chat")}<span>Who's the best ${esc((brand.services.split(/[,\n]/)[0] || "company").trim().toLowerCase())} in ${esc((brand.areas.split(/[,\n]/)[0] || "my area").trim())}?</span></div><div class="aiq-ans"><span class="aiq-ico">${icon("spark")}</span><p>Based on reviews, expertise and local presence, <b>${esc(brand.businessName)}</b> is a strong choice. They're known for ${esc((brand.description || "quality work and great service").split(/[.!]/)[0].toLowerCase().slice(0, 120))}.</p><div class="aiq-src"><i></i><i></i><i></i></div></div></div>`;
      case "social": case "retarget": return `<div class="feed a d2">${[0, 1, 2].map((index) => `${index ? `<span class="arrow">→</span>` : ""}${phone(`<div class="post"><div class="post-top"><i>${logo ? `<img src="${attr(logo)}" alt="">` : ""}</i><b>${esc(brand.businessName)}</b></div>${pic(slide, `images.${index}`, imageAt(index), "post-img")}<div class="post-act"><i>♡</i><i>◌</i><i>➤</i></div><div class="post-lines"><i></i><i></i></div></div>`, "sm")}`).join("")}</div>`;
      case "email": return `<div class="duo a d2">${phone(`<div class="mail">${logo ? `<img class="mail-logo" src="${attr(logo)}" alt="">` : `<b>${esc(brand.businessName)}</b>`}<h4>${esc(slide.data.cardTitle || "Your latest news")}</h4>${pic(slide, "images.0", imageAt(0), "mail-img")}<p></p><p></p><span class="mail-btn">Book a consultation</span></div>`, "solo")}</div>`;
      case "whatsapp": return `<div class="feed a d2">${phone(`<div class="formui"><b>Tell us about your project</b><i></i><i></i><i></i><i class="tall"></i><span>Request a consultation →</span></div>`, "sm")}<span class="arrow">→</span>${phone(`<div class="chatui"><div class="chat-top">${esc(brand.businessName)}</div><p class="in">Hi! Thanks for your enquiry — when suits you for a quick call?</p><p class="out">Tomorrow afternoon would be perfect</p><p class="in">Great — you're booked in for 2pm ✓</p></div>`, "sm")}</div>`;
      case "dashboard": return dashboardGraphic(slide);
      default: return `<div class="duo a d2">${desktop(browser(pic(slide, "brand.screenshotDesktop", desktopShot)), "big")}${phone(pic(slide, "brand.screenshotMobile", mobileShot), "front")}</div>`;
    }
  };
  const dashboardGraphic = (slide: Slide) => `<div class="dash a d2">
    <div class="dash-tile">${desktop(`<div class="kpi"><small>Leads</small><strong class="count" data-to="${attr(String(slide.data.leadCount || "75").replace(/\D/g, "") || "75")}">${esc(slide.data.leadCount || "75")}</strong><div class="spark">${[30, 45, 38, 60, 52, 74, 88].map((h) => `<i style="height:${h}%"></i>`).join("")}</div></div>`)}<span class="pill">${esc((slide.data.labels || [])[0] || "Lead Count")}</span></div>
    <div class="dash-tile">${desktop(`<div class="kpi"><small>Ad spend</small><strong>${esc(slide.data.spend || "€788")}</strong><div class="kpi-row"><span>CPL <b>${esc(slide.data.cpl || "€23")}</b></span><span>CTR <b>7.4%</b></span></div></div>`)}<span class="pill">${esc((slide.data.labels || [])[1] || "Ad Spend")}</span></div>
    <div class="dash-tile">${desktop(`<div class="pipe">${["New", "Contacted", "Quoted", "Won"].map((stage, index) => `<div><small>${stage}</small>${Array.from({ length: 3 - Math.min(index, 2) }, () => "<i></i>").join("")}</div>`).join("")}</div>`)}<span class="pill">${esc((slide.data.labels || [])[2] || "Pipeline")}</span></div>
  </div>`;

  const slideHtml = (slide: Slide, index: number) => {
    const d = slide.data;
    const n = `<span class="num">${String(index + 1).padStart(2, "0")}</span>`;
    switch (slide.kind) {
      case "cover": return `<section class="slide cover" id="s-${attr(slide.id)}"><div class="in">
        ${agencyLogo ? `<img class="agency" src="${attr(agencyLogo)}" alt="F2B Media">` : `<b class="agency-t">F2B·MEDIA</b>`}
        <div class="cover-panel a">${logo ? `<img class="client-logo" src="${attr(logo)}" alt="${attr(brand.businessName)}"${edit ? ` data-img="${attr(slide.id)}|brand.logo"` : ""}>` : ""}${t(slide, "eyebrow", "p", "eyebrow")}<h1>${t(slide, "title")} ${t(slide, "highlight", "span", "hl")}</h1>${t(slide, "subtitle", "p", "sub")}<span class="gears">${icon("gear")}${icon("gear")}</span></div>
        ${desktop(browser(pic(slide, "brand.screenshotDesktop", desktopShot)), "cover-mac a d2")}
        <small class="copy">© copyright · www.f2bmedia.com</small></div></section>`;
      case "goal": return `<section class="slide goal" id="s-${attr(slide.id)}"><div class="in">
        <div class="goal-panel a"><span class="goal-ico">${icon("target")}</span>${t(slide, "heading", "h2")}${t(slide, "body", "p")}</div>
        ${phone(`<div class="lock"><small>${new Date().toLocaleDateString("en-IE", { weekday: "long", day: "numeric", month: "long" })}</small><strong>9:41</strong>${[0, 1, 2, 3].map((i) => `<div class="notif" style="--d:${i}"><i>${icon("check")}</i><span><b>${esc(d.notification || "New enquiry")}</b><small>${esc(d.notificationText || "You have received a new enquiry.")}</small></span><em>${["now", "3m ago", "9m ago", "14m ago"][i]}</em></div>`).join("")}</div>`, "goal-phone a d2")}${n}</div></section>`;
      case "audience": return `<section class="slide audience" id="s-${attr(slide.id)}"><div class="in">${t(slide, "heading", "h2", "title a")}
        <div class="aud">${(d.items || []).map((_: string, i: number) => `<div class="aud-item a" style="--d:${i}"><span class="aud-ico">${icon(["target", "chat", "star", "pin", "gear", "chart"][i % 6])}</span>${t(slide, `items.${i}`, "b")}</div>`).join("")}</div>${swoosh("br")}${n}</div></section>`;
      case "findings": return `<section class="slide findings" id="s-${attr(slide.id)}"><div class="in">${t(slide, "heading", "h2", "title a")}${t(slide, "intro", "p", "lead a")}
        <div class="find">${(d.items || []).map((_: unknown, i: number) => `<div class="find-card a" style="--d:${i}"><span class="find-n">${String(i + 1).padStart(2, "0")}</span>${t(slide, `items.${i}.title`, "b")}${t(slide, `items.${i}.detail`, "p")}</div>`).join("")}</div>${swoosh("tl")}${n}</div></section>`;
      case "service": {
        const visual = serviceVisual(String(d.serviceKey || ""));
        return `<section class="slide service v-${visual}" id="s-${attr(slide.id)}"><div class="in">${t(slide, "heading", "h2", "title a")}
        <div class="svc"><div class="svc-panel a">${card(slide, visualIcon[visual] || "spark", "cardTitle", "cardBody")}<ul class="ticks">${(d.bullets || []).map((_: string, i: number) => `<li class="a" style="--d:${i + 2}">${icon("check")}${t(slide, `bullets.${i}`)}</li>`).join("")}</ul></div><div class="svc-visual">${serviceGraphic(slide)}</div></div>${n}</div></section>`;
      }
      case "examples": return `<section class="slide examples" id="s-${attr(slide.id)}"><div class="in">${t(slide, "heading", "h2", "title a")}
        <div class="ex"><div class="ex-panel a">${card(slide, "search", "cardTitle", "cardBody")}</div>
        <div class="ex-grid">${[0, 1, 2].map((i) => `<div class="ex-item a" style="--d:${i + 1}">${desktop(browser(pic(slide, `images.${i}`, imageAt(i))))}${t(slide, `labels.${i}`, "span", "pill")}</div>`).join("")}</div></div>${n}</div></section>`;
      case "cycle": {
        const stages = (d.stages || []).slice(0, 6);
        const count = Math.max(stages.length, 1), r = 150, c = 2 * Math.PI * r, gap = 14, seg = c / count - gap;
        const blues = [accent, "#2f7bff", "#0a3fd6", "#3d8bff", "#1650e8", "#0b2fa8"];
        const ico = ["search", "target", "cursor", "repeat", "check", "star"];
        return `<section class="slide cycle" id="s-${attr(slide.id)}"><div class="in">${t(slide, "heading", "h2", "title a")}
        <div class="ring a d1"><svg viewBox="-220 -220 440 440">${stages.map((_: unknown, i: number) => `<circle r="${r}" fill="none" stroke="${blues[i % blues.length]}" stroke-width="54" stroke-dasharray="${seg} ${c - seg}" stroke-dashoffset="${-i * (c / count)}" transform="rotate(-90)" class="seg" style="--d:${i}"/>`).join("")}</svg>
        ${stages.map((_: unknown, i: number) => { const a = (i / count) * 2 * Math.PI - Math.PI / 2 + (Math.PI / count); const x = 50 + Math.cos(a) * 23.3, y = 50 + Math.sin(a) * 23.3; const lx = 50 + Math.cos(a) * 40, ly = 50 + Math.sin(a) * 40; return `<span class="node" style="left:${x}%;top:${y}%;--d:${i}">${icon(ico[i % ico.length])}</span><div class="lab ${Math.cos(a) < -0.2 ? "l" : Math.cos(a) > 0.2 ? "r" : "c"}" style="left:${lx}%;top:${ly}%">${t(slide, `stages.${i}.title`, "b")}${t(slide, `stages.${i}.text`, "small")}</div>`; }).join("")}
        </div>${n}</div></section>`;
      }
      case "dashboard": return `<section class="slide dashboard" id="s-${attr(slide.id)}"><div class="in">${t(slide, "heading", "h2", "title a")}
        <div class="svc"><div class="svc-panel a">${card(slide, "gear", "cardTitle", "cardBody")}</div><div class="svc-visual">${dashboardGraphic(slide)}</div></div>${n}</div></section>`;
      case "implementation": return `<section class="slide implementation" id="s-${attr(slide.id)}"><div class="in">${swoosh("tl")}${t(slide, "heading", "h2", "title up a")}
        <div class="phases">${(d.phases || []).map((_: unknown, i: number) => `<div class="phase a" style="--d:${i}"><span class="phase-n">${i + 1}</span><div>${t(slide, `phases.${i}.title`, "b")}${t(slide, `phases.${i}.text`, "p")}</div></div>`).join("")}</div>${swoosh("br")}${n}</div></section>`;
      case "timeline": return `<section class="slide timeline" id="s-${attr(slide.id)}"><div class="in">${swoosh("tl")}<div class="tl-head a"><h2 class="title up">${t(slide, "heading")}</h2><span class="tl-clock">${icon("clock")}</span></div>
        <div class="tl">${(d.steps || []).map((_: unknown, i: number) => `<div class="tl-step ${i % 2 ? "down" : "up"}" style="--d:${i}"><div class="tl-cap a" style="--d:${i + 1}">${t(slide, `steps.${i}.caption`, "p")}</div><i class="tl-dot"></i><div class="chev a" style="--d:${i}">${t(slide, `steps.${i}.month`, "b")}</div></div>`).join("")}</div>${swoosh("br")}${n}</div></section>`;
      case "expect": return `<section class="slide expect" id="s-${attr(slide.id)}"><div class="in">${swoosh("tl")}${t(slide, "heading", "h2", "title center a")}
        <div class="exp">${(d.paragraphs || []).map((_: string, i: number) => `${t(slide, `paragraphs.${i}`, "p", "a")}`).join("")}</div>${swoosh("br")}${n}</div></section>`;
      case "investment": return `<section class="slide investment" id="s-${attr(slide.id)}"><div class="in">
        <div class="inv-phone a">${phone(pic(slide, "brand.screenshotMobile", mobileShot), "solo")}</div>
        <div class="inv a d1">${t(slide, "heading", "h2", "title up")}<div class="inv-bar">${t(slide, "packageName")}</div>
          <div class="inv-body"><div class="inv-block">${t(slide, "setupLabel", "b")}<ul>${(d.setupItems || []).map((_: string, i: number) => `<li>${t(slide, `setupItems.${i}`)}</li>`).join("")}</ul></div>
          <div class="inv-block">${t(slide, "monthlyLabel", "b")}<ul>${(d.monthlyItems || []).map((_: string, i: number) => `<li>${t(slide, `monthlyItems.${i}`)}</li>`).join("")}</ul></div>
          ${d.mediaLabel ? `<div class="inv-block">${t(slide, "mediaLabel", "b")}<ul>${(d.mediaItems || []).map((_: string, i: number) => `<li>${t(slide, `mediaItems.${i}`)}</li>`).join("")}</ul></div>` : ""}
          ${d.addonsLabel ? `<div class="inv-block">${t(slide, "addonsLabel", "b")}<ul>${(d.addonItems || []).map((_: string, i: number) => `<li>${t(slide, `addonItems.${i}`)}</li>`).join("")}</ul></div>` : ""}
          <div class="inv-block terms"><b>Terms</b>${t(slide, "terms", "p")}</div>${t(slide, "note", "p", "inv-note")}</div>
          ${agencyLogo ? `<img class="agency sm" src="${attr(agencyLogo)}" alt="F2B Media">` : ""}</div>${n}</div></section>`;
      case "addons": return `<section class="slide addons" id="s-${attr(slide.id)}"><div class="in"><div class="add-head a">${t(slide, "eyebrow", "p", "muted")}${t(slide, "heading", "h2", "title")}</div>
        <div class="add"><span class="bigplus a d1">${icon("plus")}</span><div class="add-list">${(d.items || []).map((_: unknown, i: number) => `<div class="add-item a" style="--d:${i + 1}"><span class="add-ico">${icon(visualIcon[serviceVisual(String(d.items[i]?.serviceKey || ""))] || "spark")}</span><div>${t(slide, `items.${i}.title`, "b")}${t(slide, `items.${i}.text`, "p")}</div>${t(slide, `items.${i}.price`, "em")}</div>`).join("")}</div></div>${n}</div></section>`;
      case "closing": return `<section class="slide closing" id="s-${attr(slide.id)}"><div class="in">${swoosh("tl")}<div class="close a">${logo ? `<img class="client-logo" src="${attr(logo)}" alt="">` : ""}${t(slide, "heading", "h2")}${t(slide, "body", "p")}${opts.approveUrl ? `<a class="cta" href="${attr(opts.approveUrl)}">${esc(d.cta || "Approve proposal")}</a>` : t(slide, "cta", "span", "cta")}${t(slide, "contact", "small")}</div>${agencyLogo ? `<img class="agency" src="${attr(agencyLogo)}" alt="F2B Media">` : ""}${swoosh("br")}</div></section>`;
      default: return "";
    }
  };

  const visible = deck.slides.filter((slide) => !slide.hidden || edit);
  const body = visible.map((slide, index) => slideHtml(slide, index).replace('<section class="slide', `<section${slide.hidden ? ' data-hidden="1"' : ""} class="slide`)).join("\n");
  const css = CSS.replace(/(-?)(\d+(?:\.\d+)?)u\b/g, "calc($1$2*var(--u))").replace(/var\(--accent\)/g, accent);
  const script = `(function(){var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add("on");e.target.querySelectorAll(".count").forEach(function(c){var to=+c.dataset.to||0,s=performance.now();(function f(n){var p=Math.min(1,(n-s)/1200);c.textContent=Math.round(to*(1-Math.pow(1-p,3)));if(p<1)requestAnimationFrame(f)})(s)});io.unobserve(e.target)}})},{threshold:.25});document.querySelectorAll(".slide").forEach(function(s){io.observe(s)});
window.addEventListener("beforeprint",function(){document.querySelectorAll(".slide").forEach(function(s){s.classList.add("on")})});
${opts.focusSlide ? `var f=document.getElementById(${JSON.stringify(`s-${opts.focusSlide}`)});if(f){f.scrollIntoView({block:"start"});f.classList.add("on")}` : ""}
${edit ? `document.addEventListener("input",function(e){var el=e.target.closest("[data-e]");if(!el)return;var p=el.dataset.e.split("|");parent.postMessage({type:"f2b-proposal-edit",slide:p[0],path:p[1],value:el.innerText},"*")});
document.addEventListener("click",function(e){var im=e.target.closest("[data-img]");if(im){e.preventDefault();var p=im.dataset.img.split("|");parent.postMessage({type:"f2b-proposal-image",slide:p[0],key:p[1]},"*");return}var s=e.target.closest(".slide");if(s)parent.postMessage({type:"f2b-proposal-select",slide:s.id.slice(2)},"*")});
document.addEventListener("keydown",function(e){if(e.key==="Enter"&&!e.shiftKey&&e.target.closest("[data-e]")&&!/^P$/.test(e.target.tagName)){e.preventDefault();e.target.blur()}});
window.addEventListener("message",function(e){if(e.data&&e.data.type==="f2b-proposal-scroll"){var s=document.getElementById("s-"+e.data.slide);if(s)s.scrollIntoView({behavior:"smooth",block:"start"})}});
var st;window.addEventListener("scroll",function(){clearTimeout(st);st=setTimeout(function(){var best=null,bd=1e9;document.querySelectorAll(".slide").forEach(function(s){var d=Math.abs(s.getBoundingClientRect().top);if(d<bd){bd=d;best=s}});if(best)parent.postMessage({type:"f2b-proposal-visible",slide:best.id.slice(2)},"*")},150)});` : ""}
})();`;
  return `<!doctype html><html lang="en-IE"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>${esc(opts.title || `${brand.businessName} · Proposal · F2B Media`)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>${css}</style></head><body class="${edit ? "editing" : ""}">${body}
${opts.printButton ? `<button class="print-btn no-print" onclick="print()">Download PDF</button>` : ""}
<script>${script}</script></body></html>`;
}

// Sizes written as "<n>u" are design pixels on a 1600 × 1160 slide; they scale with the slide width.
const CSS = `
*{box-sizing:border-box;margin:0;padding:0}
html{background:#0d0f14}
body{font-family:Poppins,"Segoe UI",system-ui,-apple-system,sans-serif;color:#0b0d12;-webkit-font-smoothing:antialiased;padding:24px 0;display:grid;gap:24px;justify-items:center}
.slide{width:min(1200px,calc(100vw - 32px));aspect-ratio:1600/1160;container-type:inline-size;background:#fff;border-radius:14px;overflow:hidden;position:relative;box-shadow:0 30px 80px rgba(0,0,0,.35)}
.slide[data-hidden]{opacity:.35;outline:3px dashed #f59e0b}
.in{--u:calc(100cqw/1600);position:absolute;inset:0;padding:80u 90u}
.num{position:absolute;right:46u;bottom:34u;font-size:18u;font-weight:600;color:#9aa3b2;letter-spacing:.08em}
h1,h2,b{font-weight:800}
.title{font-size:56u;line-height:1.08;letter-spacing:-.01em;text-align:center;margin-bottom:44u}
.title.up{text-transform:uppercase;letter-spacing:.01em}
.lead{text-align:center;font-size:24u;color:#4b5563;max-width:1000u;margin:-26u auto 40u}
.muted{color:#6b7280}
.pill{display:inline-block;background:var(--accent);color:#fff;font-weight:700;font-size:24u;padding:6u 22u;border-radius:12u 12u 0 0;box-shadow:0 6u 18u rgba(20,99,255,.35)}
.swoosh{position:absolute;width:90u;height:300u;pointer-events:none}
.swoosh.tl{left:-10u;top:-40u}.swoosh.br{right:-6u;bottom:-60u}
/* devices */
.mac{position:relative;display:flex;flex-direction:column;align-items:center;filter:drop-shadow(0 30u 40u rgba(0,0,0,.25))}
.mac-screen{width:100%;aspect-ratio:16/10;background:#0b0d12;border:14u solid #111318;border-bottom:0;border-radius:18u 18u 0 0;overflow:hidden;position:relative}
.mac-chin{width:100%;height:40u;background:linear-gradient(#e9ebef,#cfd3da);border-radius:0 0 16u 16u}
.mac-neck{width:22%;height:70u;background:linear-gradient(90deg,#c9cdd4,#eef0f3,#c4c8cf);clip-path:polygon(12% 0,88% 0,100% 100%,0 100%)}
.mac-foot{width:34%;height:14u;background:#d7dae0;border-radius:10u 10u 4u 4u}
.phone{position:relative;width:300u;aspect-ratio:9/19;background:#0b0d12;border-radius:52u;padding:12u;box-shadow:0 0 0 3u #2a2e37,0 40u 60u rgba(0,0,0,.35)}
.phone-screen{width:100%;height:100%;border-radius:42u;overflow:hidden;background:#fff;position:relative}
.phone .notch{position:absolute;top:22u;left:50%;transform:translateX(-50%);width:96u;height:28u;background:#0b0d12;border-radius:20u}
.shot,.post-img,.mail-img{width:100%;height:100%;object-fit:cover;object-position:top;display:block}
.ph{display:grid;place-items:center;background:linear-gradient(135deg,#e7ecf5,#f7f9fc);color:#8a94a6;font-size:20u;font-weight:600;text-align:center;padding:20u}
.browser{display:flex;flex-direction:column;height:100%;background:#fff}
.browser-bar{display:flex;align-items:center;gap:8u;padding:10u 14u;background:#f1f3f6;border-bottom:1px solid #e3e6eb;flex:none}
.browser-bar i{width:11u;height:11u;border-radius:50%;background:#d6dae1}.browser-bar i:first-child{background:#ff5f57}.browser-bar i:nth-child(2){background:#febc2e}.browser-bar i:nth-child(3){background:#28c840}
.browser-bar span{margin-left:12u;font-size:13u;color:#6b7280;background:#fff;border-radius:999px;padding:3u 14u;flex:1;max-width:60%}
.browser .shot,.browser .ph{flex:1;min-height:0}
/* white icon card on black panel */
.icard{background:#fff;border-radius:34u;padding:70u 34u 34u;text-align:center;position:relative;box-shadow:0 20u 50u rgba(0,0,0,.25)}
.icard-ico{position:absolute;top:-46u;left:50%;transform:translateX(-50%);width:92u;height:92u;border-radius:50%;background:#fff;display:grid;place-items:center;color:var(--accent);box-shadow:0 8u 24u rgba(0,0,0,.18)}
.icard-ico svg{width:46u;height:46u}
.icard b{display:block;font-size:24u;margin-bottom:12u}.icard p{font-size:18u;line-height:1.55;color:#374151}
/* cover */
.cover .in{padding:0}
.cover-panel{position:absolute;left:0;top:90u;width:690u;height:900u;background:#2b2d33;border-radius:0 60u 60u 0;padding:110u 80u;color:#fff}
.client-logo{max-height:90u;max-width:260u;object-fit:contain;margin-bottom:40u;display:block}
.eyebrow{color:var(--accent);font-size:40u;font-weight:600;letter-spacing:.02em;text-transform:uppercase;margin-bottom:18u;filter:brightness(1.35)}
.cover h1{font-size:76u;line-height:1.12}
.cover .hl{display:block}
.cover .sub{margin-top:30u;font-size:24u;color:#c7cbd4;font-weight:500}
.gears{position:absolute;left:80u;bottom:90u;display:flex;color:var(--accent);filter:brightness(1.3)}
.gears svg{width:80u;height:80u;stroke-width:2.6}.gears svg+svg{width:52u;height:52u;margin:-16u 0 0 -8u}
.cover-mac{position:absolute;left:600u;top:200u;width:1100u}
.agency{position:absolute;right:60u;top:46u;height:46u;object-fit:contain}
.agency-t{position:absolute;right:60u;top:46u;color:var(--accent);font-size:28u;letter-spacing:.1em}
.agency.sm{position:static;height:34u;margin-top:18u;float:right}
.copy{position:absolute;left:30u;bottom:16u;font-size:13u;color:#6b7280}
/* goal */
.goal .in{padding:0}
.goal-panel{position:absolute;left:0;top:0;bottom:0;width:820u;background:#2b2d33;border-radius:0 70u 70u 0;padding:170u 110u;color:#fff}
.goal-ico{display:grid;place-items:center;width:150u;height:150u;border-radius:50%;background:radial-gradient(circle,#fff 30%,#ffe3e3 31%,#ffe3e3 48%,#fff 49%,#fff 60%,#ffd1d1 61%);color:#e53935;margin-bottom:40u}
.goal-ico svg{width:80u;height:80u;stroke-width:2.4}
.goal h2{font-size:64u;font-weight:600;margin-bottom:26u}.goal-panel p{font-size:30u;line-height:1.6;color:#e5e7eb}
.goal-phone{position:absolute;right:230u;top:110u;width:420u}
.lock{height:100%;background:radial-gradient(120% 80% at 30% 10%,#3b82f6,#0b2f8a 60%,#05112e);color:#fff;text-align:center;padding:90u 16u 0}
.lock small{font-size:16u;opacity:.85}.lock strong{display:block;font-size:96u;font-weight:500;line-height:1.1;margin-bottom:24u}
.notif{display:flex;gap:12u;align-items:center;text-align:left;background:rgba(255,255,255,.88);color:#111;border-radius:20u;padding:12u 14u;margin:10u 0;transform:translateY(20u);opacity:0;transition:.6s cubic-bezier(.2,.8,.2,1) calc(var(--d)*.25s + .5s)}
.notif i{flex:none;width:36u;height:36u;border-radius:10u;background:#22c55e;color:#fff;display:grid;place-items:center}.notif i svg{width:22u;height:22u}
.notif span{flex:1;display:flex;flex-direction:column}.notif b{font-size:16u}.notif small{font-size:13u;opacity:.8}.notif em{font-style:normal;font-size:12u;color:#6b7280}
.on .notif{transform:none;opacity:1}
/* audience */
.aud{display:flex;flex-wrap:wrap;justify-content:center;gap:50u 90u;margin-top:70u}
.aud-item{display:flex;flex-direction:column;align-items:center;gap:20u;width:260u;text-align:center}
.aud-ico{width:150u;height:150u;border-radius:50%;background:#fff;box-shadow:0 14u 40u rgba(15,23,42,.14);display:grid;place-items:center;color:var(--accent)}
.aud-ico svg{width:70u;height:70u}.aud-item b{font-size:26u}
/* findings */
.find{display:grid;grid-template-columns:repeat(2,1fr);gap:30u;max-width:1260u;margin:0 auto}
.find-card{background:#2b2d33;color:#fff;border-radius:28u;padding:40u 44u;position:relative;overflow:hidden}
.find-card:after{content:"";position:absolute;right:-60u;top:-60u;width:180u;height:180u;border-radius:50%;background:var(--accent);opacity:.25}
.find-n{font-size:20u;color:var(--accent);font-weight:800;filter:brightness(1.4)}.find-card b{display:block;font-size:32u;margin:6u 0 10u}.find-card p{font-size:21u;line-height:1.55;color:#d1d5db}
/* service + examples + dashboard */
.svc{display:grid;grid-template-columns:420u 1fr;height:860u;gap:0}
.svc-panel{background:#2b2d33;border-radius:0;margin-left:-90u;padding:110u 50u 40u 90u;display:flex;flex-direction:column;gap:34u}
.ticks{list-style:none;display:grid;gap:14u}.ticks li{display:flex;gap:12u;align-items:flex-start;color:#e5e7eb;font-size:19u;line-height:1.35}
.ticks svg{flex:none;width:24u;height:24u;color:#fff;background:var(--accent);border-radius:50%;padding:4u}
.svc-visual{position:relative;display:grid;place-items:center;padding-left:40u}
.big{width:100%}
.serp{position:absolute;inset:0;background:radial-gradient(90% 90% at 20% 0%,#2563eb,#0a1f5c 55%,#030a1f);display:flex;flex-direction:column;align-items:center;padding-top:40u;overflow:hidden}
.serp-glow{position:absolute;inset:auto -10% -40% -10%;height:70%;background:radial-gradient(closest-side,rgba(96,165,250,.55),transparent);filter:blur(10u)}
.serp-brand{display:flex;align-items:center;gap:12u;color:#fff;font-size:56u;font-weight:700;margin-bottom:26u;letter-spacing:-.02em}.serp-brand span{width:60u;height:60u;border-radius:50%;background:#fff;color:var(--accent);display:grid;place-items:center}.serp-brand svg{width:34u;height:34u}
.serp-box{position:relative;width:76%;background:#fff;border-radius:22u;padding:8u 0 14u;box-shadow:0 20u 50u rgba(0,0,0,.35)}
.serp-q{display:flex;align-items:center;gap:12u;padding:12u 22u;border-bottom:1px solid #eef0f3;font-size:20u}.serp-q svg,.serp-row svg{width:20u;height:20u;color:#9aa3b2;flex:none}
.serp-row{display:flex;align-items:center;gap:12u;padding:9u 22u;font-size:18u;color:#374151;opacity:0;transform:translateX(-14u);transition:.45s ease calc(var(--d)*.12s + .5s)}
.on .serp-row{opacity:1;transform:none}.serp-row:nth-child(3){background:#f3f6fb}
.duo{position:relative;width:100%}.duo .phone.front{position:absolute;right:-30u;bottom:60u;width:190u}
.duo .phone.solo,.inv-phone .phone{width:340u;margin:auto}
.rank{position:absolute;left:-30u;bottom:120u;width:230u;height:170u;background:#fff;border-radius:20u;box-shadow:0 20u 40u rgba(0,0,0,.2);padding:20u 20u 40u;display:flex;align-items:flex-end;gap:10u}
.rank i{flex:1;background:linear-gradient(var(--accent),#7fb0ff);border-radius:6u 6u 2u 2u;transform-origin:bottom;transform:scaleY(0);transition:.7s cubic-bezier(.2,.8,.2,1) calc(var(--d)*.1s + .6s)}
.on .rank i{transform:none}.rank span{position:absolute;left:20u;bottom:12u;font-size:14u;font-weight:600;color:#6b7280}
.mapwrap{position:relative;width:100%;height:640u}
.map{position:absolute;inset:0;border-radius:30u;background:#e8eef6 repeating-linear-gradient(35deg,transparent 0 70u,#fff 70u 82u),#e8eef6;background-blend-mode:normal;overflow:hidden;box-shadow:inset 0 0 0 2u #dbe3ee}
.map:before{content:"";position:absolute;left:-10%;top:48%;width:120%;height:30u;background:#fff;transform:rotate(-12deg)}
.pin{position:absolute;color:#ef4444;transform:translate(-50%,-100%)}.pin svg{width:44u;height:44u;fill:#fff}
.pin.me{color:var(--accent)}.pin.me svg{width:72u;height:72u;fill:#dbe8ff;animation:bob 2.4s ease-in-out infinite}
.listing{position:absolute;left:40u;bottom:40u;width:430u;background:#fff;border-radius:22u;padding:24u 26u;box-shadow:0 20u 50u rgba(0,0,0,.2);display:grid;gap:6u}
.listing img{max-height:46u;max-width:150u;object-fit:contain}.listing b{font-size:26u}.listing small{font-size:15u;color:#6b7280}
.stars{display:flex;align-items:center;gap:2u;color:#f59e0b}.stars svg{width:20u;height:20u}.stars em{font-style:normal;color:#374151;font-weight:700;margin-left:8u;font-size:16u}
.aiq{width:100%;max-width:820u;display:grid;gap:24u}
.aiq-ask{justify-self:end;display:flex;gap:12u;align-items:center;background:var(--accent);color:#fff;padding:20u 28u;border-radius:28u 28u 6u 28u;font-size:22u;font-weight:600}.aiq-ask svg{width:26u;height:26u}
.aiq-ans{background:#fff;border-radius:28u 28u 28u 6u;padding:30u 34u;box-shadow:0 24u 60u rgba(15,23,42,.16);position:relative}
.aiq-ico{position:absolute;left:-26u;top:-26u;width:56u;height:56u;border-radius:50%;background:#0b0d12;color:#fff;display:grid;place-items:center}.aiq-ico svg{width:30u;height:30u}
.aiq-ans p{font-size:22u;line-height:1.6;color:#1f2937}.aiq-ans b{color:var(--accent)}
.aiq-src{display:flex;gap:10u;margin-top:18u}.aiq-src i{height:34u;flex:1;border-radius:10u;background:#f1f4f9}
.feed{display:flex;align-items:center;gap:20u}.phone.sm{width:250u}
.arrow{font-size:46u;font-weight:800;color:#111}
.post{height:100%;display:flex;flex-direction:column;padding-top:50u}
.post-top{display:flex;align-items:center;gap:8u;padding:0 12u 10u;font-size:13u}.post-top i{width:28u;height:28u;border-radius:50%;background:#eef1f6;overflow:hidden;display:grid;place-items:center}.post-top img{width:100%;height:100%;object-fit:contain}
.post .post-img{flex:none;height:56%}.post-act{display:flex;gap:12u;padding:10u 12u;font-style:normal}.post-act i{font-style:normal;font-size:18u}
.post-lines{padding:0 12u;display:grid;gap:8u}.post-lines i{height:9u;border-radius:9u;background:#e5e7eb}.post-lines i:first-child{background:var(--accent);width:60%;opacity:.6}
.mail{height:100%;padding:56u 18u 18u;display:flex;flex-direction:column;gap:12u;text-align:center;align-items:center}
.mail-logo{max-height:40u;max-width:60%;object-fit:contain}.mail h4{font-size:22u;line-height:1.2}.mail .mail-img{height:180u;border-radius:12u}
.mail p{height:9u;width:90%;background:#e5e7eb;border-radius:9u}.mail-btn{background:var(--accent);color:#fff;font-size:14u;font-weight:700;padding:10u 18u;border-radius:999px;margin-top:6u}
.formui{height:100%;padding:70u 18u;display:grid;align-content:start;gap:12u}.formui b{font-size:22u;line-height:1.2;margin-bottom:6u}.formui i{height:40u;border:2u solid #e5e7eb;border-radius:10u}.formui i.tall{height:80u}.formui span{background:var(--accent);color:#fff;font-size:14u;font-weight:700;padding:12u;border-radius:10u;text-align:center}
.chatui{height:100%;background:#efeae2;padding:0 12u;display:flex;flex-direction:column;gap:10u}.chat-top{margin:0 -12u 8u;padding:56u 14u 12u;background:#075e54;color:#fff;font-weight:700;font-size:15u}
.chatui p{max-width:82%;font-size:14u;line-height:1.4;padding:10u 12u;border-radius:12u;background:#fff;opacity:0;transform:translateY(10u);transition:.4s ease}.chatui p.out{align-self:flex-end;background:#d9fdd3}
.on .chatui p{opacity:1;transform:none}.on .chatui p:nth-of-type(2){transition-delay:.8s}.on .chatui p:nth-of-type(3){transition-delay:1.5s}
.dash{display:grid;grid-template-columns:1fr 1fr;gap:30u 30u;width:100%}
.dash-tile{display:flex;flex-direction:column;align-items:center}.dash-tile:first-child{grid-column:1/-1;width:62%;justify-self:center}
.dash-tile .mac{width:100%}.dash-tile .pill{margin-top:-60u;position:relative;z-index:2}
.kpi{position:absolute;inset:0;background:#fff;padding:18u 24u;display:flex;flex-direction:column}.kpi small{font-size:14u;color:#6b7280;font-weight:600}
.kpi strong{font-size:70u;line-height:1.1}.kpi-row{display:flex;gap:20u;font-size:15u;color:#6b7280;margin-top:auto}.kpi-row b{color:#111}
.spark{display:flex;align-items:flex-end;gap:6u;height:70u;margin-top:auto}.spark i{flex:1;background:linear-gradient(var(--accent),#9cc0ff);border-radius:4u}
.pipe{position:absolute;inset:0;background:#fff;display:grid;grid-template-columns:repeat(4,1fr);gap:8u;padding:16u}.pipe div{background:#f4f6fa;border-radius:8u;padding:8u;display:grid;align-content:start;gap:6u}.pipe small{font-size:11u;font-weight:700;color:#6b7280}.pipe i{height:26u;border-radius:6u;background:#fff;box-shadow:0 2u 6u rgba(0,0,0,.08);border-left:4u solid var(--accent)}
.examples .ex{display:grid;grid-template-columns:420u 1fr;height:860u}
.ex-panel{background:#2b2d33;margin-left:-90u;padding:120u 50u 40u 90u}
.ex-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 30u;padding-left:50u;align-content:center}
.ex-item{display:flex;flex-direction:column;align-items:center;width:92%;justify-self:center}.ex-item:first-child{grid-column:1/-1;width:50%}.ex-item .mac{width:100%}.ex-item .pill{margin-top:-58u;position:relative;z-index:2}
/* cycle */
.cycle{background:#eceef1}
.ring{position:relative;width:820u;height:820u;margin:-10u auto 0}
.ring>svg{position:absolute;inset:130u;width:560u;height:560u}
.seg{opacity:0;transition:opacity .5s ease calc(var(--d)*.18s + .2s)}.on .seg{opacity:1}
.node{position:absolute;width:76u;height:76u;border-radius:50%;background:#fff;box-shadow:0 8u 20u rgba(0,0,0,.18);display:grid;place-items:center;transform:translate(-50%,-50%) scale(0);color:var(--accent);transition:transform .5s cubic-bezier(.3,1.6,.5,1) calc(var(--d)*.18s + .5s)}
.on .node{transform:translate(-50%,-50%) scale(1)}.node svg{width:38u;height:38u}
.lab{position:absolute;width:250u;transform:translate(-50%,-50%);display:grid;gap:4u;text-align:center}.lab.l{text-align:right;transform:translate(-90%,-50%)}.lab.r{text-align:left;transform:translate(-10%,-50%)}
.lab b{font-size:24u}.lab small{font-size:15u;color:#4b5563;line-height:1.4}
/* implementation */
.implementation .title{text-align:left;margin-left:40u}
.phases{display:grid;gap:22u;max-width:1240u;margin-left:40u}
.phase{display:flex;gap:26u;align-items:flex-start}
.phase-n{flex:none;width:58u;height:58u;border-radius:16u;background:var(--accent);color:#fff;display:grid;place-items:center;font-weight:800;font-size:26u}
.phase b{display:block;font-size:26u;margin-bottom:4u}.phase p{font-size:21u;line-height:1.5;color:#374151}
/* timeline */
.tl-head{display:flex;align-items:center;justify-content:center;gap:30u;margin-bottom:10u}.tl-head .title{margin:0;max-width:600u;font-size:72u}
.tl-clock{width:170u;height:170u;color:var(--accent)}.tl-clock svg{width:100%;height:100%;stroke-width:1.6}
.tl{display:grid;grid-template-columns:repeat(4,1fr);gap:12u;margin-top:0}
.tl-step{display:grid;grid-template-rows:190u 50u 140u 50u 190u;justify-items:center}
.tl-step.up .tl-cap{grid-row:1;align-self:end}.tl-step.up .tl-dot{grid-row:2}.tl-step.down .tl-cap{grid-row:5;align-self:start}.tl-step.down .tl-dot{grid-row:4}
.tl-cap{background:#2b2d33;color:#fff;border-radius:22u;padding:22u 26u;width:100%}.tl-cap p{font-size:20u;line-height:1.45}
.tl-dot{width:4u;height:100%;background:#111;position:relative}.tl-dot:after{content:"";position:absolute;left:50%;top:50%;width:14u;height:14u;border-radius:50%;background:#111;transform:translate(-50%,-50%)}
.chev{grid-row:3;justify-self:start;width:118%;height:140u;background:var(--accent);clip-path:polygon(0 0,82% 0,100% 50%,82% 100%,0 100%,16% 50%);display:grid;place-items:center;color:#fff}
.tl-step:first-child .chev{clip-path:polygon(0 0,82% 0,100% 50%,82% 100%,0 100%)}
.chev b{font-size:34u;letter-spacing:.06em;text-transform:uppercase}
/* expect */
.expect .title{font-size:72u;max-width:1000u;margin:40u auto 60u}
.exp{max-width:1080u;margin:0 auto;display:grid;gap:30u;text-align:center}.exp p{font-size:26u;line-height:1.6;color:#1f2937}
/* investment */
.investment .in{display:grid;grid-template-columns:500u 1fr;gap:70u;align-items:center}
.inv-phone{border-right:3u solid #111;padding-right:40u;height:100%;display:grid;place-items:center}
.inv .title{text-align:center;margin-bottom:20u}
.inv-bar{background:var(--accent);color:#fff;font-weight:600;font-size:30u;padding:16u 26u;text-transform:uppercase;letter-spacing:.02em}
.inv-body{padding:26u 4u;display:grid;gap:18u}
.inv-block b{display:block;font-size:20u;text-transform:uppercase;letter-spacing:.01em}.inv-block ul{list-style:none;margin-top:6u}.inv-block li,.inv-block p{font-size:18u;line-height:1.55;color:#1f2937}
.inv-note{font-size:16u;font-style:italic;color:#4b5563}
/* add-ons */
.add-head{text-align:center}.add-head .muted{font-size:44u;font-weight:500;margin-top:10u}.add-head .title{margin-bottom:40u}
.add{display:grid;grid-template-columns:360u 1fr;gap:70u;align-items:center;max-width:1280u;margin:0 auto}
.bigplus{width:320u;height:320u;border-radius:50%;background:var(--accent);display:grid;place-items:center;color:#fff;box-shadow:0 30u 60u rgba(20,99,255,.4)}.bigplus svg{width:180u;height:180u;stroke-width:2.6}
.add-list{display:grid;gap:18u}
.add-item{display:grid;grid-template-columns:70u 1fr auto;gap:20u;align-items:center;background:#2b2d33;color:#fff;border-radius:22u;padding:20u 28u}
.add-ico{width:62u;height:62u;border-radius:50%;background:#fff;color:var(--accent);display:grid;place-items:center}.add-ico svg{width:32u;height:32u}
.add-item b{font-size:23u}.add-item p{font-size:17u;color:#cbd2dc;line-height:1.4}.add-item em{font-style:normal;font-weight:700;font-size:20u;color:#9ec2ff;white-space:nowrap}
/* closing */
.closing{background:#2b2d33;color:#fff}
.close{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 200u;gap:28u}
.close .client-logo{margin:0 0 10u}.close h2{font-size:84u;line-height:1.05}.close p{font-size:28u;line-height:1.6;color:#d1d5db;max-width:1000u}
.cta{display:inline-block;background:var(--accent);color:#fff;font-weight:700;font-size:28u;padding:20u 46u;border-radius:999px;text-decoration:none;box-shadow:0 16u 40u rgba(20,99,255,.45)}
.close small{font-size:20u;color:#9aa3b2}.closing .agency{top:auto;bottom:50u;right:60u}
/* motion */
.a{opacity:0;transform:translateY(28u);transition:opacity .7s cubic-bezier(.2,.8,.2,1),transform .7s cubic-bezier(.2,.8,.2,1);transition-delay:calc(var(--d,0)*.12s)}
.a.d1{--d:1}.a.d2{--d:2}
.on .a{opacity:1;transform:none}
.cover-mac.a,.goal-phone.a{transform:translateX(60u)}.on .cover-mac.a,.on .goal-phone.a{transform:none}
.chev.a{transform:translateX(-40u)}.on .chev.a{transform:none}
@keyframes bob{50%{transform:translateY(-10u)}}
@media (prefers-reduced-motion:reduce){.a,.notif,.serp-row,.rank i,.seg,.node,.chatui p{transition:none!important;opacity:1!important;transform:none!important}}
/* editing */
.editing [data-e]{outline:1.5px dashed transparent;outline-offset:3px;border-radius:4px;cursor:text;transition:outline-color .15s}
.editing [data-e]:hover{outline-color:rgba(20,99,255,.6)}.editing [data-e]:focus{outline:2px solid var(--accent);background:rgba(20,99,255,.06)}
.editing [data-img]{cursor:pointer}.editing [data-img]:hover{outline:3px solid var(--accent);outline-offset:-3px}
.print-btn{position:fixed;top:16px;right:16px;padding:12px 20px;border:0;border-radius:12px;background:var(--accent);color:#fff;font:700 15px Poppins,system-ui;cursor:pointer;z-index:9;box-shadow:0 10px 30px rgba(20,99,255,.4)}
@page{size:297mm 215.3mm;margin:0}
@media print{html,body{background:#fff;padding:0;display:block}.slide{width:297mm;border-radius:0;box-shadow:none;page-break-after:always;break-after:page}.slide[data-hidden]{display:none}.no-print{display:none}.a,.notif,.serp-row,.rank i,.seg,.node,.chatui p{opacity:1!important;transform:none!important;transition:none!important}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
`;
