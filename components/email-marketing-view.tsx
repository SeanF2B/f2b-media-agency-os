"use client";

import "./email-marketing.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Copy, GripVertical, Image as ImageIcon, Minus, Monitor, MousePointerClick, Pause, Play, Plus, Rocket, Save, Send, Smartphone, Sparkles, Trash2, Type, Heading1, MoveVertical, Mail, ChevronLeft } from "lucide-react";
import { appAlert, appConfirm, appPrompt } from "./app-dialog";
import { SystemEmailsView } from "./system-emails-view";
import { BLOCK_TYPES, DEFAULT_STYLE, MERGE_FIELDS, newBlock, renderEmailHtml, type EmailBlock, type EmailStyle } from "@/lib/email-marketing/render";

// Operations → Email: a drag-and-drop Email Builder, AI-assisted campaigns (sequences with wait
// periods) sent to the CRM's own contacts, and the existing Automations, all per client.

type Template = { id: string; name: string; subject: string; preheader: string; blocks: EmailBlock[]; style: EmailStyle; updatedAt: string };
type Step = { id: string; subject: string; preheader: string; waitDays: number; blocks: EmailBlock[] };
type Campaign = { id: string; name: string; goal: string; status: "draft" | "running" | "paused" | "completed"; audience: { tags: string[]; tagMode: "any" | "all" }; steps: Step[]; style: EmailStyle; fromName: string; replyTo: string; footer: string; stats: { enrolled?: number; sent?: number; failed?: number; unsubscribed?: number }; updatedAt: string; launchedAt?: string };
type Doc = { subject: string; preheader: string; blocks: EmailBlock[]; style: EmailStyle };
const BLOCK_ICONS: Record<EmailBlock["type"], typeof Type> = { heading: Heading1, text: Type, button: MousePointerClick, image: ImageIcon, divider: Minus, spacer: MoveVertical };
const uid = () => `s${Math.random().toString(36).slice(2, 9)}`;

async function api<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch("/api/email-marketing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(json.error || "Something went wrong.");
  return json;
}

/* ---------------- Builder ---------------- */
function EmailBuilder({ doc, onChange, clientId, extra }: { doc: Doc; onChange: (doc: Doc) => void; clientId: string; extra?: React.ReactNode }) {
  const [selected, setSelected] = useState<string>(doc.blocks[0]?.id || "");
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [brief, setBrief] = useState("");
  const listRef = useRef<HTMLOListElement>(null);
  // The block list scrolls on its own: the card you open is brought into view inside the list,
  // so the page (and the live preview) never jumps.
  useEffect(() => {
    const list = listRef.current; if (!list || !selected) return;
    const card = list.querySelector<HTMLElement>(`[data-block="${selected}"]`); if (!card) return;
    const frame = window.requestAnimationFrame(() => {
      const top = card.offsetTop, bottom = top + card.offsetHeight;
      if (top < list.scrollTop) list.scrollTo({ top: Math.max(0, top - 6), behavior: "smooth" });
      else if (bottom > list.scrollTop + list.clientHeight) list.scrollTo({ top: Math.min(top - 6, bottom - list.clientHeight + 6), behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selected]);
  const set = (patch: Partial<Doc>) => onChange({ ...doc, ...patch });
  const setBlocks = (blocks: EmailBlock[]) => set({ blocks });
  const updateBlock = (id: string, patch: Record<string, unknown>) => setBlocks(doc.blocks.map((b) => b.id === id ? { ...b, ...patch } as EmailBlock : b));
  const insert = (type: EmailBlock["type"], at?: number) => {
    const block = newBlock(type);
    const index = at ?? (doc.blocks.findIndex((b) => b.id === selected) + 1 || doc.blocks.length);
    const blocks = [...doc.blocks]; blocks.splice(index, 0, block); setBlocks(blocks); setSelected(block.id);
  };
  const move = (from: number, to: number) => { if (from === to || to < 0 || to > doc.blocks.length) return; const blocks = [...doc.blocks]; const [b] = blocks.splice(from, 1); blocks.splice(to > from ? to - 1 : to, 0, b); setBlocks(blocks); };
  const remove = (id: string) => setBlocks(doc.blocks.filter((b) => b.id !== id));
  const html = useMemo(() => renderEmailHtml(doc, { first_name: "Alex", last_name: "Murphy", company: "Sample Ltd", email: "alex@example.com" }, { sender: "Your business · Address", unsubscribeUrl: "#" }), [doc]);
  const writeWithAi = async () => {
    setAiBusy(true);
    try {
      const out = await api<{ subject: string; preheader: string; blocks: EmailBlock[] }>({ action: "ai-email", clientId, brief, current: doc.blocks.length ? { subject: doc.subject, blocks: doc.blocks } : null });
      onChange({ ...doc, subject: out.subject || doc.subject, preheader: out.preheader || doc.preheader, blocks: out.blocks });
      setSelected(out.blocks[0]?.id || ""); setBrief("");
    } catch (reason) { await appAlert(reason instanceof Error ? reason.message : "AI couldn’t write this email."); } finally { setAiBusy(false); }
  };
  const field = (block: EmailBlock) => {
    const align = "align" in block ? <span className="em-seg">{(["left", "center"] as const).map((a) => <button key={a} type="button" className={(block as { align?: string }).align === a || (!("align" in block && block.align) && a === "left") ? "active" : ""} onClick={() => updateBlock(block.id, { align: a })}>{a === "left" ? "Left" : "Centre"}</button>)}</span> : null;
    switch (block.type) {
      case "heading": return <><input value={block.text} onChange={(e) => updateBlock(block.id, { text: e.target.value })} aria-label="Heading text" /><div className="em-row">{align}<label className="em-inline">Size <input type="range" min={18} max={36} value={block.size || 26} onChange={(e) => updateBlock(block.id, { size: Number(e.target.value) })} /></label></div></>;
      case "text": return <><textarea rows={6} value={block.text} onChange={(e) => updateBlock(block.id, { text: e.target.value })} aria-label="Text" /><div className="em-row">{align}<span className="em-merge">Insert: {MERGE_FIELDS.slice(0, 3).map((f) => <button key={f} type="button" onClick={() => updateBlock(block.id, { text: `${block.text}{{${f}}}` })}>{f.replace("_", " ")}</button>)}<i>**bold**</i></span></div></>;
      case "button": return <><div className="em-two"><input value={block.text} onChange={(e) => updateBlock(block.id, { text: e.target.value })} placeholder="Button text" aria-label="Button text" /><input value={block.url} onChange={(e) => updateBlock(block.id, { url: e.target.value })} placeholder="https://" aria-label="Button link" /></div>{align}</>;
      case "image": return <><input value={block.src} onChange={(e) => updateBlock(block.id, { src: e.target.value })} placeholder="Image URL (https://…) — copy one from the Media library" aria-label="Image URL" /><div className="em-two"><input value={block.alt || ""} onChange={(e) => updateBlock(block.id, { alt: e.target.value })} placeholder="Alt text" aria-label="Alt text" /><input value={block.url || ""} onChange={(e) => updateBlock(block.id, { url: e.target.value })} placeholder="Link (optional)" aria-label="Image link" /></div><label className="em-inline">Width <input type="range" min={30} max={100} value={block.width || 100} onChange={(e) => updateBlock(block.id, { width: Number(e.target.value) })} /> {block.width || 100}%</label></>;
      case "spacer": return <label className="em-inline">Height <input type="range" min={8} max={80} value={block.height || 24} onChange={(e) => updateBlock(block.id, { height: Number(e.target.value) })} /> {block.height || 24}px</label>;
      default: return <p className="em-muted">A thin line between sections.</p>;
    }
  };
  const label = (block: EmailBlock) => block.type === "heading" || block.type === "text" ? (block.text.split("\n").find(Boolean) || "").slice(0, 60) : block.type === "button" ? block.text : block.type === "image" ? (block.src ? "Image" : "Image — add a URL") : block.type === "spacer" ? `Space ${block.height || 24}px` : "Divider";
  return <div className="em-builder">
    <div className="em-edit">
      <div className="em-card em-head">
        <label>Subject<input value={doc.subject} onChange={(e) => set({ subject: e.target.value })} placeholder="e.g. Quick question, {{first_name}}" /></label>
        <label>Preview text<input value={doc.preheader} onChange={(e) => set({ preheader: e.target.value })} placeholder="Shown after the subject in the inbox" /></label>
      </div>
      <div className="em-card em-ai"><Sparkles size={16} aria-hidden="true" /><input value={brief} onChange={(e) => setBrief(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !aiBusy) void writeWithAi(); }} placeholder={doc.blocks.length ? "Tell AI what to change, e.g. “shorter, warmer, add a winter offer”" : "Tell AI what this email is for, e.g. “spring roof check offer for past customers”"} aria-label="AI brief" /><button type="button" className="primary-button" disabled={aiBusy} onClick={() => void writeWithAi()}>{aiBusy ? "Writing…" : doc.blocks.length ? "Rewrite" : "Write it"}</button></div>
      <div className="em-palette" aria-label="Add a block">{BLOCK_TYPES.map(({ type, label: text }) => { const Icon = BLOCK_ICONS[type]; return <button key={type} type="button" draggable onDragStart={(e) => { e.dataTransfer.setData("text/em-new", type); setDragFrom(null); }} onClick={() => insert(type)} title={`Add ${text.toLowerCase()} (or drag it into place)`}><Icon size={15} aria-hidden="true" />{text}</button>; })}</div>
      <ol ref={listRef} className="em-blocks" onDragOver={(e) => { e.preventDefault(); if (!doc.blocks.length) setDropAt(0); }} onDrop={(e) => { e.preventDefault(); const type = e.dataTransfer.getData("text/em-new") as EmailBlock["type"]; const at = dropAt ?? doc.blocks.length; if (type) insert(type, at); else if (dragFrom !== null) move(dragFrom, at); setDragFrom(null); setDropAt(null); }} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropAt(null); }}>
        {!doc.blocks.length && <li className="em-empty">Drag blocks here, click one above, or let AI write the email.</li>}
        {doc.blocks.map((block, index) => { const Icon = BLOCK_ICONS[block.type]; const open = selected === block.id; return <li key={block.id} data-block={block.id} className={`em-block${open ? " open" : ""}${dragFrom === index ? " dragging" : ""}${dropAt === index ? " drop-before" : ""}${dropAt === doc.blocks.length && index === doc.blocks.length - 1 ? " drop-after" : ""}`}
          draggable onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", block.id); setDragFrom(index); }} onDragEnd={() => { setDragFrom(null); setDropAt(null); }}
          onDragOver={(e) => { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); setDropAt(e.clientY < r.top + r.height / 2 ? index : index + 1); }}>
          <div className="em-block-bar" onClick={() => setSelected(open ? "" : block.id)}>
            <GripVertical size={15} className="em-grip" aria-hidden="true" /><Icon size={15} aria-hidden="true" /><span>{label(block) || block.type}</span>
            <span className="em-block-tools" onClick={(e) => e.stopPropagation()}>
              <button type="button" aria-label="Move up" disabled={!index} onClick={() => move(index, index - 1)}><ArrowUp size={14} /></button>
              <button type="button" aria-label="Move down" disabled={index === doc.blocks.length - 1} onClick={() => move(index, index + 2)}><ArrowDown size={14} /></button>
              <button type="button" aria-label="Duplicate" onClick={() => { const copy = { ...block, id: uid() } as EmailBlock; const blocks = [...doc.blocks]; blocks.splice(index + 1, 0, copy); setBlocks(blocks); setSelected(copy.id); }}><Copy size={14} /></button>
              <button type="button" aria-label="Delete block" onClick={() => remove(block.id)}><Trash2 size={14} /></button>
            </span>
          </div>
          {open && <div className="em-block-body">{field(block)}</div>}
        </li>; })}
      </ol>
      <details className="em-card em-style"><summary>Design</summary>
        <div className="em-style-grid">
          {([["brand", "Buttons & links"], ["background", "Background"], ["card", "Email body"], ["text", "Text"]] as const).map(([key, text]) => <label key={key}><span>{text}</span><input type="color" value={doc.style[key]} onChange={(e) => set({ style: { ...doc.style, [key]: e.target.value } })} /></label>)}
          <label><span>Font</span><select value={doc.style.font} onChange={(e) => set({ style: { ...doc.style, font: e.target.value as EmailStyle["font"] } })}><option value="sans">Modern (sans-serif)</option><option value="serif">Classic (serif)</option></select></label>
          <label className="em-wide"><span>Logo URL</span><input value={doc.style.logo || ""} onChange={(e) => set({ style: { ...doc.style, logo: e.target.value } })} placeholder="https://…/logo.png" /></label>
        </div>
      </details>
      {extra}
    </div>
    <div className="em-preview">
      <div className="em-preview-bar"><span className="em-seg">{(["desktop", "mobile"] as const).map((d) => <button key={d} type="button" className={device === d ? "active" : ""} onClick={() => setDevice(d)} aria-label={d}>{d === "desktop" ? <Monitor size={15} /> : <Smartphone size={15} />}</button>)}</span><span className="em-inbox"><b>{doc.subject.replace(/\{\{\s*first_name[^}]*\}\}/g, "Alex") || "No subject"}</b> {doc.preheader && <span>— {doc.preheader}</span>}</span></div>
      <iframe title="Email preview" className={`em-frame ${device}`} srcDoc={html} sandbox="" />
    </div>
  </div>;
}

/* ---------------- Main view ---------------- */
export function EmailMarketingView({ clientId, clientName, clientLogo, clientColor, automations, initialMode = "campaigns" }: { clientId: string; clientName: string; clientLogo?: string; clientColor?: string; automations?: React.ReactNode; initialMode?: "campaigns" | "builder" | "automations" | "system" | "settings" }) {
  const [mode, setMode] = useState<"campaigns" | "builder" | "automations" | "system" | "settings">(initialMode === "automations" && !automations ? "campaigns" : initialMode);
  type Data = { templates: Template[]; campaigns: Campaign[]; sending: boolean; me: string };
  const [error, setError] = useState("");
  const names = useRef(new Map<string, { name: string; style: EmailStyle }>());
  const baseStyle = useMemo<EmailStyle>(() => ({ ...DEFAULT_STYLE, brand: /^#[0-9a-f]{6}$/i.test(clientColor || "") ? clientColor! : DEFAULT_STYLE.brand, logo: /^https?:/.test(clientLogo || "") ? clientLogo : "" }), [clientColor, clientLogo]);
  names.current.set(clientId, { name: clientName, style: baseStyle });
  // Switching client never blanks the screen: each client's data is cached, the last view stays up
  // (slightly dimmed) until the new client's data arrives, then the fields update in place.
  const cache = useRef(new Map<string, Data>());
  const [data, setData] = useState<Data | null>(() => cache.current.get(clientId) || null);
  const [loadedFor, setLoadedFor] = useState(clientId);
  const load = useCallback(async () => {
    setError("");
    const cached = cache.current.get(clientId);
    if (cached) { setData(cached); setLoadedFor(clientId); }
    try {
      const response = await fetch(`/api/email-marketing?clientId=${encodeURIComponent(clientId)}`, { cache: "no-store" });
      const json = await response.json().catch(() => ({})) as Data & { error?: string };
      if (!response.ok) throw new Error(json?.error || "Email couldn’t load.");
      cache.current.set(clientId, json); setData(json); setLoadedFor(clientId);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Email couldn’t load."); setData((current) => current || { templates: [], campaigns: [], sending: false, me: "" }); setLoadedFor(clientId); }
  }, [clientId]);
  useEffect(() => { void load(); }, [load]);
  const stale = loadedFor !== clientId;
  // While the next client loads, keep showing the last client's panel (dimmed) instead of a blank screen.
  const shownId = stale ? loadedFor : clientId;
  const shown = names.current.get(shownId) || { name: clientName, style: baseStyle };

  // Two categories, each with its own templates: Campaigns (Campaigns | Templates) and System emails (Inbox | Templates).
  const section: "campaigns" | "system" | "automations" = mode === "automations" ? "automations" : mode === "system" || mode === "settings" ? "system" : "campaigns";
  const sections: Array<[typeof section, string]> = [["campaigns", "Campaigns"], ["system", "System emails"], ...(automations ? [["automations", "Automations"]] as Array<[typeof section, string]> : [])];
  return <div className="em">
    <div className="ops-subbar em-subbar">
      <span className="ops-seg" role="tablist" aria-label="Email sections">{sections.map(([key, text]) => <button key={key} type="button" role="tab" aria-selected={section === key} className={section === key ? "active" : ""} onClick={() => setMode(key)}>{text}</button>)}</span>
      {section === "campaigns" && <span className="ops-seg em-inner-seg" role="tablist" aria-label="Campaign emails">{([["campaigns", "Campaigns"], ["builder", "Templates"]] as const).map(([key, text]) => <button key={key} type="button" role="tab" aria-selected={mode === key} className={mode === key ? "active" : ""} onClick={() => setMode(key)}>{text}</button>)}</span>}
      {data && !data.sending && section === "campaigns" && <span className="em-warn">Sending isn’t set up on the server yet (Resend). You can still build and save.</span>}
    </div>
    {error && section === "campaigns" && <p className="ops-empty" role="alert">{error}</p>}
    {section === "automations" && automations}
    {section === "system" && <SystemEmailsView />}
    {section === "campaigns" && !data && <div className="page-loading" role="status" aria-label="Loading email…"><i /></div>}
    {section === "campaigns" && data && <div className={`em-pane${stale ? " em-stale" : ""}`} aria-busy={stale}>
      {mode === "builder" && <TemplatesPane key={shownId} clientId={shownId} clientName={shown.name} templates={data.templates} baseStyle={shown.style} me={data.me} onChanged={load} />}
      {mode === "campaigns" && <CampaignsPane key={shownId} clientId={shownId} clientName={shown.name} campaigns={data.campaigns} templates={data.templates} baseStyle={shown.style} me={data.me} sending={data.sending} onChanged={load} />}
    </div>}
  </div>;
}

function TemplatesPane({ clientId, clientName, templates, baseStyle, me, onChanged }: { clientId: string; clientName: string; templates: Template[]; baseStyle: EmailStyle; me: string; onChanged: () => Promise<void> }) {
  const blank = (): Template => ({ id: "", name: "", subject: "", preheader: "", blocks: [], style: baseStyle, updatedAt: "" });
  const [current, setCurrent] = useState<Template | null>(null);
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const flash = (text: string) => { setNote(text); window.setTimeout(() => setNote(""), 2500); };
  if (!current) return <div className="em-list">
    <div className="ops-toolbar"><b className="em-title">Campaign templates · {clientName}</b><button type="button" className="primary-button" onClick={() => setCurrent(blank())}><Plus size={15} /> New email</button></div>
    {!templates.length ? <div className="em-empty-card"><Mail size={28} aria-hidden="true" /><p>No saved emails yet. Build one with drag-and-drop blocks, or let AI write it for you.</p><button type="button" className="primary-button" onClick={() => setCurrent(blank())}><Sparkles size={15} /> Build your first email</button></div>
      : <div className="em-grid">{templates.map((t) => <button key={t.id} type="button" className="em-tile" onClick={() => setCurrent(t)}><span className="em-thumb" aria-hidden="true"><iframe title="" tabIndex={-1} srcDoc={renderEmailHtml(t)} sandbox="" loading="lazy" /></span><b>{t.name}</b><span>{t.subject || "No subject"}</span><small>{t.blocks.length} blocks · edited {new Date(t.updatedAt).toLocaleDateString("en-IE", { day: "numeric", month: "short" })}</small></button>)}</div>}
  </div>;
  const save = async () => {
    let name = current.name;
    if (!name) { name = (await appPrompt("Name this email", current.subject || "Untitled email")) || ""; if (!name) return; }
    setBusy("save");
    try { const out = await api<{ id: string }>({ action: "save-template", clientId, ...current, name }); setCurrent({ ...current, id: out.id, name }); flash("Saved"); await onChanged(); } catch (reason) { await appAlert(reason instanceof Error ? reason.message : "Couldn’t save."); } finally { setBusy(""); }
  };
  return <>
    <div className="ops-toolbar em-actions">
      <button type="button" className="text-button" onClick={() => setCurrent(null)}><ChevronLeft size={15} /> All emails</button>
      <input className="em-name" value={current.name} onChange={(e) => setCurrent({ ...current, name: e.target.value })} placeholder="Email name" aria-label="Email name" />
      {note && <span className="em-note" role="status">{note}</span>}
      <button type="button" className="secondary-button" onClick={() => void navigator.clipboard.writeText(renderEmailHtml(current)).then(() => flash("HTML copied"))}><Copy size={15} /> Copy HTML</button>
      <button type="button" className="secondary-button" disabled={busy === "test"} onClick={async () => { const to = await appPrompt("Send a test to", me); if (!to) return; setBusy("test"); try { await api({ action: "send-test", clientId, to, ...current }); flash(`Test sent to ${to}`); } catch (reason) { await appAlert(reason instanceof Error ? reason.message : "Couldn’t send."); } finally { setBusy(""); } }}><Send size={15} /> {busy === "test" ? "Sending…" : "Send test"}</button>
      {current.id && <button type="button" className="secondary-button" aria-label="Delete email" onClick={async () => { if (!(await appConfirm(`Delete “${current.name}”?`))) return; await api({ action: "delete-template", clientId, id: current.id }).catch(() => null); setCurrent(null); await onChanged(); }}><Trash2 size={15} /></button>}
      <button type="button" className="primary-button" disabled={busy === "save"} onClick={() => void save()}><Save size={15} /> {busy === "save" ? "Saving…" : "Save"}</button>
    </div>
    <EmailBuilder doc={current} clientId={clientId} onChange={(doc) => setCurrent({ ...current, ...doc })} />
  </>;
}

const STATUS_LABEL: Record<Campaign["status"], string> = { draft: "Draft", running: "Sending", paused: "Paused", completed: "Completed" };
function CampaignsPane({ clientId, clientName, campaigns, templates, baseStyle, me, sending, onChanged }: { clientId: string; clientName: string; campaigns: Campaign[]; templates: Template[]; baseStyle: EmailStyle; me: string; sending: boolean; onChanged: () => Promise<void> }) {
  const [current, setCurrent] = useState<Campaign | null>(null);
  const [wizard, setWizard] = useState(false);
  if (current) return <CampaignEditor key={current.id || "new"} initial={current} clientId={clientId} clientName={clientName} templates={templates} me={me} sending={sending} onClose={async () => { setCurrent(null); await onChanged(); }} />;
  if (wizard) return <CampaignWizard clientId={clientId} clientName={clientName} onCancel={() => setWizard(false)} onReady={(campaign) => { setWizard(false); setCurrent({ ...campaign, style: baseStyle, footer: campaign.footer || clientName, fromName: campaign.fromName || clientName }); }} />;
  const blankCampaign = (): Campaign => ({ id: "", name: "", goal: "", status: "draft", audience: { tags: [], tagMode: "any" }, steps: [{ id: uid(), subject: "", preheader: "", waitDays: 0, blocks: [] }], style: baseStyle, fromName: clientName, replyTo: "", footer: clientName, stats: {}, updatedAt: "" });
  return <div className="em-list">
    {campaigns.length > 0 && <div className="ops-toolbar"><b className="em-title">Email campaigns · {clientName}</b><button type="button" className="secondary-button" onClick={() => setCurrent(blankCampaign())}><Plus size={15} /> Start from scratch</button><button type="button" className="primary-button" onClick={() => setWizard(true)}><Sparkles size={15} /> Create with AI</button></div>}
    {!campaigns.length ? <div className="em-empty-card compact"><Mail size={22} aria-hidden="true" /><div><b>No email campaigns for {clientName} yet</b><p>AI plans the emails, timing and copy for you to review, or build one yourself in the email builder.</p></div><span className="em-empty-actions"><button type="button" className="primary-button" onClick={() => setWizard(true)}><Sparkles size={15} /> Create with AI</button><button type="button" className="secondary-button" onClick={() => setCurrent(blankCampaign())}><Plus size={15} /> Start from scratch</button></span></div>
      : <div className="ops-table-wrap"><table className="ops-table em-table"><thead><tr><th>Campaign</th><th>Status</th><th>Emails</th><th>Contacts</th><th>Sent</th><th>Unsubscribed</th><th>Last edited</th></tr></thead>
        <tbody>{campaigns.map((c) => <tr key={c.id} className="em-click" onClick={() => setCurrent(c)}><td><b>{c.name}</b>{c.goal && <small className="em-sub">{c.goal.slice(0, 90)}</small>}</td><td><span className={`em-pill ${c.status}`}>{STATUS_LABEL[c.status]}</span></td><td>{c.steps.length}</td><td>{c.stats.enrolled ?? "—"}</td><td>{c.stats.sent ?? 0}{c.stats.failed ? <small className="em-sub em-bad">{c.stats.failed} failed</small> : null}</td><td>{c.stats.unsubscribed ?? 0}</td><td>{new Date(c.updatedAt).toLocaleDateString("en-IE", { day: "numeric", month: "short" })}</td></tr>)}</tbody></table></div>}
  </div>;
}

function CampaignWizard({ clientId, clientName, onCancel, onReady }: { clientId: string; clientName: string; onCancel: () => void; onReady: (campaign: Campaign) => void }) {
  const [form, setForm] = useState({ goal: "", offer: "", audienceNote: "", emails: 3, tone: "Friendly and professional", ctaUrl: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ideas = ["Win back past customers who haven’t booked in a year", "Promote a seasonal offer", "Ask happy customers for a Google review", "Welcome new leads and book a free quote", "Announce a new service"];
  const run = async () => {
    if (!form.goal.trim()) { setError("Tell AI what the campaign should achieve."); return; }
    setBusy(true); setError("");
    try {
      const out = await api<{ name: string; steps: Step[]; tips: string }>({ action: "ai-campaign", clientId, ...form });
      onReady({ id: "", name: out.name || form.goal.slice(0, 60), goal: [form.goal, out.tips].filter(Boolean).join("\n\nAI tip: "), status: "draft", audience: { tags: [], tagMode: "any" }, steps: out.steps, style: DEFAULT_STYLE, fromName: "", replyTo: "", footer: "", stats: {}, updatedAt: "" });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "AI couldn’t plan this campaign."); } finally { setBusy(false); }
  };
  return <div className="em-card em-wizard">
    <button type="button" className="text-button" onClick={onCancel}><ChevronLeft size={15} /> Campaigns</button>
    <h2><Sparkles size={20} aria-hidden="true" /> New campaign for {clientName}</h2>
    <p className="em-muted">Answer a few questions and AI writes the full sequence. Nothing is sent until you launch it.</p>
    <label>What should this campaign achieve?<textarea rows={3} value={form.goal} onChange={(e) => setForm({ ...form, goal: e.target.value })} placeholder="e.g. Get past customers to book a roof check before winter" /></label>
    <div className="em-chips">{ideas.map((idea) => <button key={idea} type="button" onClick={() => setForm({ ...form, goal: idea })}>{idea}</button>)}</div>
    <div className="em-two">
      <label>Offer or key message <small>(optional)</small><input value={form.offer} onChange={(e) => setForm({ ...form, offer: e.target.value })} placeholder="e.g. 10% off gutter cleaning in November" /></label>
      <label>Who is it for? <small>(optional)</small><input value={form.audienceNote} onChange={(e) => setForm({ ...form, audienceNote: e.target.value })} placeholder="e.g. homeowners in Galway who got a quote" /></label>
    </div>
    <div className="em-three">
      <label>Number of emails<select value={form.emails} onChange={(e) => setForm({ ...form, emails: Number(e.target.value) })}>{[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
      <label>Tone<select value={form.tone} onChange={(e) => setForm({ ...form, tone: e.target.value })}>{["Friendly and professional", "Warm and personal", "Short and direct", "Premium and polished", "Fun and upbeat"].map((t) => <option key={t}>{t}</option>)}</select></label>
      <label>Button link <small>(optional)</small><input value={form.ctaUrl} onChange={(e) => setForm({ ...form, ctaUrl: e.target.value })} placeholder="https://…/book" /></label>
    </div>
    {error && <p className="em-error" role="alert">{error}</p>}
    <div className="em-row em-end"><button type="button" className="secondary-button" onClick={onCancel}>Cancel</button><button type="button" className="primary-button" disabled={busy} onClick={() => void run()}><Sparkles size={15} /> {busy ? "Planning your campaign…" : "Generate campaign"}</button></div>
  </div>;
}

function CampaignEditor({ initial, clientId, clientName, templates, me, sending, onClose }: { initial: Campaign; clientId: string; clientName: string; templates: Template[]; me: string; sending: boolean; onClose: () => Promise<void> }) {
  const [c, setC] = useState<Campaign>(initial);
  const [stepId, setStepId] = useState(initial.steps[0]?.id || "");
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const [tags, setTags] = useState<Array<{ tag: string; count: number }> | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [dirty, setDirty] = useState(!initial.id);
  const locked = c.status === "running" || c.status === "completed";
  const update = (patch: Partial<Campaign>) => { setC((cur) => ({ ...cur, ...patch })); setDirty(true); };
  const flash = (text: string) => { setNote(text); window.setTimeout(() => setNote(""), 2800); };
  useEffect(() => { void fetch(`/api/email-marketing?view=tags&clientId=${encodeURIComponent(clientId)}`, { cache: "no-store" }).then((r) => r.json()).then((j: { tags?: Array<{ tag: string; count: number }>; total?: number }) => { setTags(j.tags || []); setTotal(j.total ?? null); }).catch(() => setTags([])); }, [clientId]);
  const audienceKey = `${c.audience.tagMode}|${c.audience.tags.join(",")}`;
  const timer = useRef<number>(0);
  useEffect(() => { window.clearTimeout(timer.current); if (!c.audience.tags.length) { setCount(total); return; } setCount(null); timer.current = window.setTimeout(() => { void api<{ count: number }>({ action: "audience-count", clientId, audience: c.audience }).then((j) => setCount(j.count)).catch(() => setCount(null)); }, 350); return () => window.clearTimeout(timer.current); }, [audienceKey, total]); // eslint-disable-line react-hooks/exhaustive-deps
  const step = c.steps.find((s) => s.id === stepId) || c.steps[0];
  const stepIndex = c.steps.findIndex((s) => s.id === step?.id);
  const setStep = (patch: Partial<Step>) => update({ steps: c.steps.map((s) => s.id === step.id ? { ...s, ...patch } : s) });
  const save = async (quiet = false) => {
    setBusy("save");
    try { const out = await api<{ id: string }>({ action: "save-campaign", clientId, ...c, name: c.name || "Untitled campaign" }); setC((cur) => ({ ...cur, id: out.id, name: cur.name || "Untitled campaign" })); setDirty(false); if (!quiet) flash("Saved"); return out.id; } catch (reason) { await appAlert(reason instanceof Error ? reason.message : "Couldn’t save."); return ""; } finally { setBusy(""); }
  };
  const launch = async () => {
    if (!c.steps.every((s) => s.subject.trim() && s.blocks.length)) { await appAlert("Every email needs a subject and some content before launching."); return; }
    if (!(await appConfirm(`Launch “${c.name || "this campaign"}” to ${count ?? "the selected"} contact${count === 1 ? "" : "s"}?\n\nEmail 1 starts going out within a few minutes; the rest follow on their wait periods. Unsubscribes and Do Not Disturb contacts are always skipped.`))) return;
    const id = await save(true); if (!id) return;
    setBusy("launch");
    try { const out = await api<{ enrolled: number }>({ action: "launch", clientId, id }); setC((cur) => ({ ...cur, id, status: "running", stats: { ...cur.stats, enrolled: out.enrolled } })); flash(`Launched to ${out.enrolled} contacts`); } catch (reason) { await appAlert(reason instanceof Error ? reason.message : "Couldn’t launch."); } finally { setBusy(""); }
  };
  const togglePause = async () => { const pause = c.status === "running"; setBusy("pause"); try { await api({ action: pause ? "pause" : "resume", clientId, id: c.id }); setC((cur) => ({ ...cur, status: pause ? "paused" : "running" })); } catch (reason) { await appAlert(reason instanceof Error ? reason.message : "Couldn’t update."); } finally { setBusy(""); } };
  const addStep = async () => {
    let blocks: EmailBlock[] = [], subject = "", preheader = "";
    if (templates.length) { const pick = await appPrompt(`Start from a saved email? Type its number, or leave blank for empty:\n${templates.slice(0, 15).map((t, i) => `${i + 1}. ${t.name}`).join("\n")}`, ""); const t = templates[Number(pick) - 1]; if (t) { blocks = t.blocks.map((b) => ({ ...b, id: uid() })); subject = t.subject; preheader = t.preheader; } }
    const s: Step = { id: uid(), subject, preheader, waitDays: 3, blocks };
    update({ steps: [...c.steps, s] }); setStepId(s.id);
  };
  const toggleTag = (tag: string) => update({ audience: { ...c.audience, tags: c.audience.tags.some((t) => t.toLowerCase() === tag.toLowerCase()) ? c.audience.tags.filter((t) => t.toLowerCase() !== tag.toLowerCase()) : [...c.audience.tags, tag] } });
  return <div className="em-campaign">
    <div className="ops-toolbar em-actions">
      <button type="button" className="text-button" onClick={async () => { if (dirty && !locked && !(await appConfirm("Leave without saving your changes?"))) return; await onClose(); }}><ChevronLeft size={15} /> Campaigns</button>
      <input className="em-name" value={c.name} onChange={(e) => update({ name: e.target.value })} placeholder="Campaign name" aria-label="Campaign name" disabled={locked} />
      <span className={`em-pill ${c.status}`}>{STATUS_LABEL[c.status]}</span>
      {note && <span className="em-note" role="status">{note}</span>}
      <button type="button" className="secondary-button" disabled={busy === "test" || !step} onClick={async () => { const to = await appPrompt(`Send email ${stepIndex + 1} as a test to`, me); if (!to) return; setBusy("test"); try { await api({ action: "send-test", clientId, to, subject: step.subject, preheader: step.preheader, blocks: step.blocks, style: c.style, fromName: c.fromName, footer: c.footer }); flash(`Test sent to ${to}`); } catch (reason) { await appAlert(reason instanceof Error ? reason.message : "Couldn’t send."); } finally { setBusy(""); } }}><Send size={15} /> Test</button>
      {c.id && c.status !== "running" && <button type="button" className="secondary-button" aria-label="Delete campaign" onClick={async () => { if (!(await appConfirm(`Delete “${c.name}”? This also clears its send history.`))) return; await api({ action: "delete-campaign", clientId, id: c.id }).catch(() => null); await onClose(); }}><Trash2 size={15} /></button>}
      {!locked && <button type="button" className="secondary-button" disabled={busy === "save"} onClick={() => void save()}><Save size={15} /> {busy === "save" ? "Saving…" : "Save"}</button>}
      {(c.status === "running" || c.status === "paused") && <button type="button" className="secondary-button" disabled={busy === "pause"} onClick={() => void togglePause()}>{c.status === "running" ? <><Pause size={15} /> Pause</> : <><Play size={15} /> Resume</>}</button>}
      {c.status === "draft" && <button type="button" className="primary-button" disabled={!sending || busy === "launch"} title={sending ? "" : "Email sending isn’t set up on the server yet"} onClick={() => void launch()}><Rocket size={15} /> {busy === "launch" ? "Launching…" : "Launch"}</button>}
    </div>
    {locked && <p className="em-info">{c.status === "running" ? `Sending · ${c.stats.sent || 0} emails sent to ${c.stats.enrolled || 0} contacts so far. Pause it to stop further emails.` : `Completed · ${c.stats.sent || 0} emails sent, ${c.stats.unsubscribed || 0} unsubscribed.`} Content is locked while a campaign is live.</p>}
    <div className="em-campaign-grid">
      <aside className="em-side">
        <section className="em-card"><h3>Who gets it</h3>
          <p className="em-muted">{c.audience.tags.length ? "Contacts with" : `All ${clientName} contacts with an email.`}{c.audience.tags.length > 1 && <> <span className="em-seg">{(["any", "all"] as const).map((m) => <button key={m} type="button" disabled={locked} className={c.audience.tagMode === m ? "active" : ""} onClick={() => update({ audience: { ...c.audience, tagMode: m } })}>{m === "any" ? "any" : "all"}</button>)}</span> of these tags:</>}{c.audience.tags.length === 1 && " this tag:"}</p>
          <div className="em-tags">{tags === null ? <span className="em-muted">Loading tags…</span> : !tags.length ? <span className="em-muted">No tags in this CRM yet. Tag contacts in Leads → Contacts to target groups.</span> : tags.map((t) => { const on = c.audience.tags.some((x) => x.toLowerCase() === t.tag.toLowerCase()); return <button key={t.tag} type="button" disabled={locked} className={on ? "on" : ""} onClick={() => toggleTag(t.tag)}>{t.tag} <small>{t.count}</small></button>; })}</div>
          <p className="em-count"><b>{count === null ? "…" : count}</b> contact{count === 1 ? "" : "s"} will receive this <small>(Do Not Disturb, spam and unsubscribed are skipped)</small></p>
        </section>
        <section className="em-card"><h3>Sender</h3>
          <label>From name<input value={c.fromName} disabled={locked} onChange={(e) => update({ fromName: e.target.value })} placeholder={clientName} /></label>
          <label>Replies go to<input value={c.replyTo} disabled={locked} onChange={(e) => update({ replyTo: e.target.value })} placeholder="hello@business.ie" /></label>
          <label>Footer (business name &amp; address)<input value={c.footer} disabled={locked} onChange={(e) => update({ footer: e.target.value })} placeholder={`${clientName}, Address`} /></label>
        </section>
        <section className="em-card"><h3>Emails</h3>
          <ol className="em-steps">{c.steps.map((s, i) => <li key={s.id}>
            {i > 0 && <div className="em-wait">Wait <input type="number" min={0} max={60} value={s.waitDays} disabled={locked} onChange={(e) => update({ steps: c.steps.map((x) => x.id === s.id ? { ...x, waitDays: Math.max(0, Math.min(60, Number(e.target.value) || 0)) } : x) })} aria-label={`Days to wait before email ${i + 1}`} /> day{s.waitDays === 1 ? "" : "s"}</div>}
            <button type="button" className={`em-step${s.id === step?.id ? " active" : ""}`} onClick={() => setStepId(s.id)}><b>Email {i + 1}</b><span>{s.subject || "No subject yet"}</span></button>
          </li>)}</ol>
          {!locked && <div className="em-row"><button type="button" className="secondary-button" onClick={() => void addStep()}><Plus size={15} /> Add email</button>{c.steps.length > 1 && <button type="button" className="text-button" onClick={() => { const rest = c.steps.filter((s) => s.id !== step.id).map((s, i) => i === 0 ? { ...s, waitDays: 0 } : s); update({ steps: rest }); setStepId(rest[0].id); }}>Remove email {stepIndex + 1}</button>}</div>}
        </section>
        {c.goal && <section className="em-card"><h3>Goal</h3><p className="em-muted em-pre">{c.goal}</p></section>}
      </aside>
      <div className={locked ? "em-locked" : ""}>{step && <EmailBuilder key={step.id} doc={{ subject: step.subject, preheader: step.preheader, blocks: step.blocks, style: c.style }} clientId={clientId} onChange={(doc) => { if (locked) return; setStep({ subject: doc.subject, preheader: doc.preheader, blocks: doc.blocks }); if (doc.style !== c.style) update({ style: doc.style }); }} />}</div>
    </div>
  </div>;
}
