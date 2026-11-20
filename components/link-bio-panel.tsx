"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Copy, ExternalLink, Eye, MousePointerClick, Plus, Trash2, Upload } from "lucide-react";
import { logoFileToDataUrl } from "@/lib/branding";
import { SOCIAL_LABELS, SOCIAL_NETWORKS, renderLinkBioHtml, slugify, type LinkBioLink, type LinkBioPage, type SocialNetwork } from "@/lib/link-bio";

// Operations → Sites → Link in bio: one branded links page per client (for Instagram/TikTok bios, QR codes, email signatures).
type Client = { id: string; name: string; logo?: string; color?: string };
type Saved = { clientId: string; slug: string; page: LinkBioPage | null; published: boolean; views: number; clicks: Record<string, number>; updatedAt: string; updatedBy: string };

const newId = () => Math.random().toString(36).slice(2, 10);
const fmt = (iso: string) => iso ? new Date(iso).toLocaleString("en-IE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";

export function LinkBioPanel({ clients, clientId }: { clients: Client[]; clientId: string }) {
  const client = clients.find((c) => c.id === clientId);
  const [origin, setOrigin] = useState("");
  const [saved, setSaved] = useState<Saved | null>(null);
  const [page, setPage] = useState<LinkBioPage | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    setPage(null); setSaved(null); setError(""); setNotice(""); setDirty(false);
    fetch(`/api/link-bio?clientId=${encodeURIComponent(clientId)}`, { cache: "no-store" }).then(async (r) => {
      const j = await r.json().catch(() => ({})) as { origin?: string; saved?: Saved | null; starter?: LinkBioPage; error?: string };
      if (!r.ok) throw new Error(j.error || "Link in bio is unavailable.");
      if (cancelled) return;
      setOrigin(j.origin || window.location.origin); setSaved(j.saved || null); setPage(j.saved?.page || j.starter || null);
    }).catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Link in bio is unavailable."); });
    return () => { cancelled = true; };
  }, [clientId]);

  const patch = (partial: Partial<LinkBioPage>) => { setPage((current) => current ? { ...current, ...partial } : current); setDirty(true); setNotice(""); };
  const patchLink = (id: string, partial: Partial<LinkBioLink>) => page && patch({ links: page.links.map((l) => l.id === id ? { ...l, ...partial } : l) });
  const moveLink = (index: number, dir: -1 | 1) => { if (!page) return; const links = [...page.links]; const to = index + dir; if (to < 0 || to >= links.length) return; [links[index], links[to]] = [links[to], links[index]]; patch({ links }); };
  const setSocial = (network: SocialNetwork, url: string) => { if (!page) return; const rest = page.socials.filter((s) => s.network !== network); patch({ socials: url.trim() ? [...rest, { network, url }].sort((a, b) => SOCIAL_NETWORKS.indexOf(a.network) - SOCIAL_NETWORKS.indexOf(b.network)) : rest }); };

  const save = async (published: boolean) => {
    if (!page || !client) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const r = await fetch("/api/link-bio", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId: client.id, page, published }) });
      const j = await r.json().catch(() => ({})) as { saved?: Saved; error?: string };
      if (!r.ok || !j.saved) throw new Error(j.error || "This page couldn’t be saved.");
      setSaved(j.saved); if (j.saved.page) setPage(j.saved.page); setDirty(false);
      setNotice(published ? (saved?.published ? "Changes are live." : "Published. The link is ready to share.") : saved?.published ? "Unpublished. The link now shows “not available”." : "Draft saved.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "This page couldn’t be saved."); } finally { setBusy(false); }
  };

  const publicUrl = saved?.slug ? `${origin}/f/bio/${saved.slug}` : "";
  const preview = useMemo(() => page ? renderLinkBioHtml(page, { preview: true, hrefFor: () => "#" }) : "", [page]);
  const totalClicks = saved ? Object.values(saved.clicks).reduce((a, b) => a + (Number(b) || 0), 0) : 0;

  if (!client) return <p className="ops-empty">Pick a client in the top bar to build their Link in bio page.</p>;
  if (error && !page) return <p className="ops-empty" role="alert">{error}</p>;
  if (!page) return <p className="ops-empty">Loading {client.name}’s Link in bio…</p>;

  return <div className="lb-wrap">
    <div className="lb-head">
      <div className="lb-head-title">{client.logo ? <img src={client.logo} alt="" /> : <i style={{ background: client.color || "#d9dee3" }} />}<div><b>{client.name} · Link in bio</b><small>{saved ? `${saved.published ? "Live" : "Draft"} · saved ${fmt(saved.updatedAt)}` : "Not set up yet — this starter uses the client’s own details."}{dirty ? " · unsaved changes" : ""}</small></div></div>
      <span className={`lb-status ${saved?.published ? "on" : "off"}`}>{saved?.published ? "Live" : "Draft"}</span>
    </div>

    {saved && <div className="lb-stats">
      <span><Eye size={15} aria-hidden="true" /><b>{saved.views}</b> visits</span>
      <span><MousePointerClick size={15} aria-hidden="true" /><b>{totalClicks}</b> link clicks</span>
      <span><b>{saved.views ? `${Math.round((totalClicks / saved.views) * 100)}%` : "—"}</b> click rate</span>
      {publicUrl && saved.published && <span className="lb-url"><a href={publicUrl} target="_blank" rel="noreferrer">{publicUrl.replace(/^https?:\/\//, "")}</a><button type="button" className="ops-icon-button" aria-label="Copy link" title="Copy link" onClick={() => { void navigator.clipboard?.writeText(publicUrl); setNotice("Link copied."); }}><Copy size={15} /></button><a className="ops-icon-button" href={publicUrl} target="_blank" rel="noreferrer" aria-label="Open live page" title="Open live page"><ExternalLink size={15} /></a></span>}
    </div>}

    <div className="lb-grid">
      <div className="lb-form">
        <section className="lb-card">
          <h3>Profile</h3>
          <div className="lb-avatar-row">
            {page.avatar ? <img className="lb-avatar" src={page.avatar} alt="" /> : <span className="lb-avatar lb-avatar-empty">{page.title.slice(0, 1).toUpperCase()}</span>}
            <div className="lb-avatar-actions">
              <button type="button" className="secondary-button" onClick={() => fileInput.current?.click()}><Upload size={14} /> Upload logo</button>
              {client.logo && page.avatar !== client.logo && <button type="button" className="text-button" onClick={() => patch({ avatar: client.logo || "" })}>Use client logo</button>}
              {page.avatar && <button type="button" className="text-button" onClick={() => patch({ avatar: "" })}>Remove</button>}
              <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden onChange={async (event) => { const file = event.target.files?.[0]; event.target.value = ""; if (!file) return; try { patch({ avatar: await logoFileToDataUrl(file) }); } catch (reason) { setError(reason instanceof Error ? reason.message : "That image couldn’t be used."); } }} />
            </div>
          </div>
          <label>Name<input value={page.title} maxLength={60} onChange={(e) => patch({ title: e.target.value })} /></label>
          <label>Short bio <small>{page.bio.length}/160</small><textarea rows={2} value={page.bio} maxLength={160} placeholder="e.g. Roofing specialists in Galway · Free quotes" onChange={(e) => patch({ bio: e.target.value })} /></label>
          <label>Link address<span className="lb-slug"><span>{(origin || "").replace(/^https?:\/\//, "")}/f/bio/</span><input value={page.slug} maxLength={40} onChange={(e) => patch({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })} onBlur={() => patch({ slug: slugify(page.slug) })} /></span></label>
        </section>

        <section className="lb-card">
          <div className="lb-card-head"><h3>Links</h3><button type="button" className="secondary-button" disabled={page.links.length >= 20} onClick={() => patch({ links: [...page.links, { id: newId(), label: "", url: "", enabled: true }] })}><Plus size={14} /> Add link</button></div>
          {!page.links.length && <p className="muted">Add the buttons people should see — website, quote form, booking page, latest offer.</p>}
          <ol className="lb-links">{page.links.map((link, index) => <li key={link.id} className={link.enabled ? "" : "off"}>
            <div className="lb-link-fields">
              <input aria-label="Button label" placeholder="Button label (e.g. Get a free quote)" value={link.label} maxLength={60} onChange={(e) => patchLink(link.id, { label: e.target.value })} />
              <input aria-label="Link" placeholder="https://…, email or phone" value={link.url} onChange={(e) => patchLink(link.id, { url: e.target.value })} />
            </div>
            <div className="lb-link-tools">
              {saved && <span className="lb-clicks" title="Clicks since published">{saved.clicks[link.id] || 0} clicks</span>}
              <label className="lb-toggle" title={link.enabled ? "Shown" : "Hidden"}><input type="checkbox" checked={link.enabled} onChange={(e) => patchLink(link.id, { enabled: e.target.checked })} /><span aria-hidden="true" /><span className="sr-only">Show this link</span></label>
              <button type="button" className="ops-icon-button" aria-label="Move up" disabled={!index} onClick={() => moveLink(index, -1)}><ArrowUp size={14} /></button>
              <button type="button" className="ops-icon-button" aria-label="Move down" disabled={index === page.links.length - 1} onClick={() => moveLink(index, 1)}><ArrowDown size={14} /></button>
              <button type="button" className="ops-icon-button" aria-label="Delete link" onClick={() => patch({ links: page.links.filter((l) => l.id !== link.id) })}><Trash2 size={14} /></button>
            </div>
          </li>)}</ol>
        </section>

        <section className="lb-card">
          <h3>Social icons</h3>
          <p className="muted">Paste a profile link or just the handle. Leave blank to hide.</p>
          <div className="lb-socials">{SOCIAL_NETWORKS.map((network) => <label key={network}>{SOCIAL_LABELS[network]}<input value={page.socials.find((s) => s.network === network)?.url || ""} placeholder={network === "phone" ? "+353 …" : network === "email" ? "hello@…" : network === "whatsapp" ? "+353 … or wa.me link" : network === "google" ? "Google review link" : "@handle or link"} onChange={(e) => setSocial(network, e.target.value)} /></label>)}</div>
        </section>

        <section className="lb-card">
          <h3>Look</h3>
          <div className="lb-look">
            <label>Brand colour<span className="lb-colour"><input type="color" value={page.theme.brand} onChange={(e) => patch({ theme: { ...page.theme, brand: e.target.value } })} /><code>{page.theme.brand}</code>{client.color && client.color.toLowerCase() !== page.theme.brand && /^#[0-9a-f]{6}$/i.test(client.color) && <button type="button" className="text-button" onClick={() => patch({ theme: { ...page.theme, brand: client.color!.toLowerCase() } })}>Reset to client colour</button>}</span></label>
            <div className="lb-seg-row"><span>Background</span><span className="ops-seg" role="tablist" aria-label="Background">{(["light", "dark", "brand"] as const).map((key) => <button key={key} type="button" role="tab" aria-selected={page.theme.background === key} className={page.theme.background === key ? "active" : ""} onClick={() => patch({ theme: { ...page.theme, background: key } })}>{key === "brand" ? "Brand colour" : key[0].toUpperCase() + key.slice(1)}</button>)}</span></div>
            <div className="lb-seg-row"><span>Buttons</span><span className="ops-seg" role="tablist" aria-label="Button style">{(["solid", "outline", "soft"] as const).map((key) => <button key={key} type="button" role="tab" aria-selected={page.theme.buttons === key} className={page.theme.buttons === key ? "active" : ""} onClick={() => patch({ theme: { ...page.theme, buttons: key } })}>{key[0].toUpperCase() + key.slice(1)}</button>)}</span></div>
          </div>
        </section>

        {error && <p className="ops-error" role="alert">{error}</p>}
        {notice && <p className="ops-notice" role="status">{notice}</p>}
        <div className="lb-actions">
          <button type="button" className="primary-button" disabled={busy || Boolean(saved?.published && !dirty)} onClick={() => void save(true)}>{busy ? "Saving…" : saved?.published ? (dirty ? "Update live page" : "Up to date") : "Publish"}</button>
          {(!saved?.published) && <button type="button" className="secondary-button" disabled={busy} onClick={() => void save(false)}>Save draft</button>}
          {saved?.published && <button type="button" className="secondary-button" disabled={busy} onClick={() => void save(false)}>Unpublish</button>}
        </div>
      </div>

      <div className="lb-preview" aria-label="Live preview">
        <div className="lb-phone"><iframe title={`${client.name} Link in bio preview`} srcDoc={preview} sandbox="allow-same-origin" /></div>
        <small className="muted">Preview · buttons are disabled here</small>
      </div>
    </div>
  </div>;
}
