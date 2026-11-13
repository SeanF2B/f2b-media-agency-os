"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type CrmNote = { id: string; opportunity_id?: string; contact_id?: string; body: string; created_at: string; created_by?: string; created_by_name?: string };

const fmt = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-GB", { month: "short", day: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true }).replace(/,(?=[^,]*$)/, "");
};
const linkify = (text: string) => text.split(/(https?:\/\/[^\s]+)/g).map((part, i) => /^https?:\/\//.test(part) ? <a key={i} href={part} target="_blank" rel="noreferrer noopener">{part}</a> : <span key={i}>{part}</span>);

function NoteCard({ note, onSave, onDelete }: { note: CrmNote; onSave: (body: string) => Promise<boolean>; onDelete: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.body);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!menu) return; const close = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false); }; document.addEventListener("mousedown", close); return () => document.removeEventListener("mousedown", close); }, [menu]);
  const long = note.body.length > 220 || note.body.split("\n").length > 3;
  return <article className="crm-note-card">
    {editing ? <form onSubmit={async (e) => { e.preventDefault(); if (draft.trim() && await onSave(draft.trim())) setEditing(false); }}>
      <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={4} autoFocus />
      <div className="crm-note-actions"><button type="button" className="secondary-button" onClick={() => { setDraft(note.body); setEditing(false); }}>Cancel</button><button type="submit" className="primary-button" disabled={!draft.trim()}>Save</button></div>
    </form> : <>
      <div className={`crm-note-body ${long && !expanded ? "is-clamped" : ""}`}>{linkify(note.body)}</div>
      {long && <button type="button" className="text-button crm-note-more" onClick={() => setExpanded((v) => !v)}>{expanded ? "Show less" : "Show more"}</button>}
    </>}
    <footer className="crm-note-meta">
      <div><span>{fmt(note.created_at)}</span><span>Created by: {note.created_by_name || "API"}</span></div>
      {note.id !== "__form__" && <div className="crm-note-menu" ref={menuRef}>
        <button type="button" className="crm-note-dots" aria-label="Note options" aria-expanded={menu} onClick={() => setMenu((v) => !v)}>⋮</button>
        {menu && <div className="crm-note-dropdown" role="menu"><button type="button" role="menuitem" onClick={() => { setMenu(false); setEditing(true); }}>Edit</button><button type="button" role="menuitem" className="danger" onClick={() => { setMenu(false); onDelete(); }}>Delete</button></div>}
      </div>}
    </footer>
  </article>;
}

export function CrmNotesPanel({ title, subtitle = "Notes and follow-ups for this opportunity.", formAnswers, formDate, notes, onClose, onChanged }: { title: string; subtitle?: string; formAnswers?: string; formDate?: string; notes: CrmNote[]; onClose: () => void; onChanged: (payload: Record<string, unknown>) => Promise<boolean> }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"newest" | "oldest">("newest");
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; document.addEventListener("keydown", esc); return () => document.removeEventListener("keydown", esc); }, [onClose]);
  const shown = useMemo(() => {
    const all: CrmNote[] = [...notes];
    if (formAnswers) all.push({ id: "__form__", body: formAnswers, created_at: formDate || "", created_by_name: "Website form" });
    const q = query.trim().toLowerCase();
    return all.filter((n) => !q || n.body.toLowerCase().includes(q)).sort((a, b) => (sort === "newest" ? -1 : 1) * (Date.parse(a.created_at || "0") - Date.parse(b.created_at || "0")));
  }, [notes, formAnswers, formDate, query, sort]);
  const run = async (payload: Record<string, unknown>) => { setBusy(true); try { return await onChanged(payload); } finally { setBusy(false); } };
  return <div className="crm-drawer-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <aside className="crm-drawer" role="dialog" aria-modal="true" aria-label={`Notes for ${title}`}>
      <header className="crm-drawer-head"><div><h2>{title}</h2><p>{subtitle}</p></div><button type="button" className="crm-drawer-close" aria-label="Close notes" onClick={onClose}>›</button></header>
      <div className="crm-notes-toolbar">
        <h3>Notes</h3>
        <button type="button" className="crm-note-sort" title={sort === "newest" ? "Newest first" : "Oldest first"} aria-label="Change sort order" onClick={() => setSort((s) => s === "newest" ? "oldest" : "newest")}>{sort === "newest" ? "↓ Newest" : "↑ Oldest"}</button>
        <label className="crm-notes-search"><span aria-hidden="true">⌕</span><input type="search" placeholder="Search notes" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
      </div>
      {adding ? <form className="crm-note-card crm-note-new" onSubmit={async (e) => { e.preventDefault(); if (draft.trim() && await run({ action: "addActivity", body: draft.trim() })) { setDraft(""); setAdding(false); } }}>
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={4} placeholder="Write a note…" autoFocus />
        <div className="crm-note-actions"><button type="button" className="secondary-button" onClick={() => { setDraft(""); setAdding(false); }}>Cancel</button><button type="submit" className="primary-button" disabled={busy || !draft.trim()}>{busy ? "Saving…" : "Save note"}</button></div>
      </form> : <button type="button" className="crm-note-add" onClick={() => setAdding(true)}>＋ Add note</button>}
      <div className="crm-note-list">
        {shown.map((note) => <NoteCard key={note.id} note={note} onSave={(body) => run({ action: "updateActivity", id: note.id, body })} onDelete={() => { if (window.confirm("Delete this note? This can't be undone.")) void run({ action: "deleteActivity", id: note.id }); }} />)}
        {!shown.length && <p className="crm-empty">{query ? "No notes match your search." : "No notes yet. Add the first one."}</p>}
      </div>
    </aside>
  </div>;
}
