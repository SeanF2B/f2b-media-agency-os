"use client";
// Social post planner: a month calendar of posts per client. Write with AI, attach photos from the client's Media Library.
import { useCallback, useEffect, useMemo, useState } from "react";
import { PlatformIcon } from "./platform-icon";

/** Split a caption into the text and its hashtags (shown as chips; joined back when saved). */
export function splitCaption(caption: string) {
  const tags = [...new Set((caption.match(/#[\p{L}\p{N}_]+/gu) || []))];
  const text = caption.replace(/(\s*#[\p{L}\p{N}_]+)+\s*$/u, "").trim();
  return { text, tags };
}
const joinCaption = (text: string, tags: string[]) => [text.trim(), tags.join(" ")].filter(Boolean).join("\n\n");

export type Post = { id: string; clientId: string; postAt: string; platforms: string[]; caption: string; images: string[]; status: "draft" | "pending" | "scheduled" | "posted" | "failed" | "rejected"; updatedAt?: string; createdByName?: string; createdBy?: string; authorType?: string; reviewNote?: string; reviewedBy?: string; publish?: Record<string, { ok: boolean; url?: string; error?: string; manual?: boolean; at?: string }> };
type Media = { id: string; url: string; name: string; kind: string; createdBy?: string };
export type PlannerFilters = { createdBy?: string; platform?: string; status?: string };
export const STATUS_LABEL: Record<string, string> = { draft: "Draft", pending: "Awaiting approval", scheduled: "Scheduled", posted: "Posted", failed: "Failed", rejected: "Sent back" };
const initials = (n = "") => n.replace(/\|.*$/, "").trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "?";
const PLATFORMS: Array<[string, string, string]> = [["facebook", "Facebook", "#1877f2"], ["instagram", "Instagram", "#e1306c"], ["google", "Google Business", "#34a853"], ["linkedin", "LinkedIn", "#0a66c2"], ["tiktok", "TikTok", "#111"]];
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const hm = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

async function call<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const json = await res.json().catch(() => ({})) as T & { error?: string };
  if (!res.ok) throw new Error(json.error || "Something went wrong.");
  return json;
}

export function SocialPlanner({ clientId, clientName, filters = {}, canApprove = false, onChanged }: { clientId: string; clientName: string; filters?: PlannerFilters; canApprove?: boolean; onChanged?: () => void }) {
  const [month, setMonth] = useState(() => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d; });
  const [posts, setPosts] = useState<Post[]>([]);
  const [edit, setEdit] = useState<Post | null>(null);
  const [status, setStatus] = useState("");
  const [planning, setPlanning] = useState(false);
  const [media, setMedia] = useState<Media[]>([]);

  const load = useCallback(async () => {
    try { const from = new Date(month); from.setDate(from.getDate() - 7); const to = new Date(month); to.setMonth(to.getMonth() + 1, 7);
      const r = await call<{ posts: Post[] }>(`/api/social-posts?clientId=${encodeURIComponent(clientId)}&from=${from.toISOString()}&to=${to.toISOString()}`); setPosts(r.posts.filter((x) => (!filters.createdBy || x.createdByName === filters.createdBy) && (!filters.platform || x.platforms.includes(filters.platform)) && (!filters.status || x.status === filters.status))); setStatus(""); }
    catch (e) { setStatus(e instanceof Error ? e.message : "Couldn't load posts."); }
  }, [clientId, month, filters.createdBy, filters.platform, filters.status]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { let live = true; call<{ items: Media[] }>(`/api/media-library?scope=${encodeURIComponent(clientId)}&kind=image`).then((r) => { if (live) setMedia(r.items || []); }).catch(() => undefined); return () => { live = false; }; }, [clientId]);

  const days = useMemo(() => { const start = new Date(month); const lead = (start.getDay() + 6) % 7; start.setDate(start.getDate() - lead); return Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; }); }, [month]);
  const byDay = useMemo(() => { const m = new Map<string, Post[]>(); for (const p of posts) { const k = ymd(new Date(p.postAt)); m.set(k, [...(m.get(k) || []), p]); } return m; }, [posts]);
  const upcoming = posts.filter((p) => p.status !== "posted" && Date.parse(p.postAt) >= Date.now()).length;
  const due = posts.filter((p) => p.status === "scheduled" && Date.parse(p.postAt) < Date.now());

  const newPost = (day: Date) => { const d = new Date(day); d.setHours(10, 0, 0, 0); setEdit({ id: "", clientId, postAt: d.toISOString(), platforms: ["facebook", "instagram"], caption: "", images: [], status: "draft" }); };
  // Plan the month: AI writes posts for Tue / Thu / Sat and attaches photos from the Media Library.
  const planMonth = async () => {
    setPlanning(true); setStatus("Writing this month's posts…");
    try {
      const slots = days.filter((d) => d.getMonth() === month.getMonth() && [2, 4, 6].includes(d.getDay()) && d.getTime() >= new Date().setHours(0, 0, 0, 0) && !byDay.get(ymd(d))?.length).slice(0, 12);
      if (!slots.length) { setStatus("No free Tue/Thu/Sat left this month — try next month."); return; }
      const r = await call<{ posts: Array<{ caption: string }> }>("/api/social-posts", { action: "generate", clientId, clientName, count: slots.length, platforms: ["facebook", "instagram"], prompt: `Plan ${slots.length} posts for ${month.toLocaleDateString("en-GB", { month: "long" })}.` });
      for (const [i, p] of r.posts.slice(0, slots.length).entries()) {
        const at = new Date(slots[i]); at.setHours(i % 2 ? 18 : 10, 0, 0, 0);
        await call("/api/social-posts", { action: "save", clientId, post: { postAt: at.toISOString(), platforms: ["facebook", "instagram"], caption: p.caption, images: media.length ? [media[i % media.length].url] : [], status: "draft" } });
      }
      setStatus(`Drafted ${Math.min(r.posts.length, slots.length)} posts with descriptions and hashtags. Open any to check it, then Schedule.`); await load();
    } catch (e) { setStatus(e instanceof Error ? e.message : "Couldn't plan the month."); }
    finally { setPlanning(false); }
  };

  return <section className="sp" aria-label="Social posts">
    <header className="sp-head">
      <div><h3>📅 Social posts</h3><p>Plan {clientName}'s posts on a calendar, write them with AI and add photos from the Media Library.</p></div>
      <div className="sp-actions"><span className="sp-count"><b>{upcoming}</b> upcoming</span><button type="button" className="secondary-button" disabled={planning} onClick={() => void planMonth()}>{planning ? "Drafting…" : "✨ Draft this month’s posts"}</button><button type="button" className="primary-button" onClick={() => newPost(new Date())}>+ New post</button></div>
    </header>
    {status && <p className="sp-status" role="status">{status}</p>}
    {due.length > 0 && <div className="sp-due">⏰ {due.length} post{due.length === 1 ? " is" : "s are"} ready to go out: {due.map((p) => <button key={p.id} type="button" className="text-button" onClick={() => setEdit(p)}>{new Date(p.postAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</button>)}</div>}
    <div className="sp-nav"><button type="button" className="iv-btn" aria-label="Previous month" onClick={() => { const d = new Date(month); d.setMonth(d.getMonth() - 1); setMonth(d); }}>‹</button><b>{month.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</b><button type="button" className="iv-btn" aria-label="Next month" onClick={() => { const d = new Date(month); d.setMonth(d.getMonth() + 1); setMonth(d); }}>›</button></div>
    <div className="sp-grid">
      {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="sp-dow">{d}</div>)}
      {days.map((d) => { const k = ymd(d); const list = byDay.get(k) || []; const out = d.getMonth() !== month.getMonth(); const today = k === ymd(new Date());
        return <div key={k} className={`sp-day${out ? " out" : ""}${today ? " today" : ""}`} onClick={(e) => { if (e.target === e.currentTarget) newPost(d); }}>
          <span className="sp-date" onClick={() => newPost(d)}>{d.getDate()}</span>
          {list.map((p) => <button key={p.id} type="button" className={`sp-post ${p.status}`} onClick={() => setEdit(p)} title={p.caption}>
            {p.images[0] && <img src={p.images[0]} alt="" loading="lazy" />}
            <span><em>{hm(p.postAt)} <span className="sp-icons">{p.platforms.map((x) => <PlatformIcon key={x} id={x} size={12} />)}</span>{p.createdByName && <b className="sp-who" title={`By ${p.createdByName}`}>{initials(p.createdByName)}</b>}</em><small>{p.caption.split("\n")[0].slice(0, 60) || "Untitled post"}</small></span>
          </button>)}
        </div>; })}
    </div>
    {edit && <PostEditor post={edit} clientId={clientId} clientName={clientName} media={media} canApprove={canApprove} onMedia={(m) => setMedia((cur) => [m, ...cur])} onClose={() => setEdit(null)} onSaved={async (msg) => { setEdit(null); setStatus(msg); await load(); onChanged?.(); }} />}
  </section>;
}

export function PostEditor({ post, clientId, clientName, media, onMedia, onClose, onSaved, canApprove = false }: { post: Post; clientId: string; clientName: string; media: Media[]; onMedia: (m: Media) => void; onClose: () => void; onSaved: (msg: string) => void; canApprove?: boolean }) {
  const [uploader, setUploader] = useState("");
  const [drive, setDrive] = useState<{ connected: boolean; files: Array<{ id: string; name: string; thumbnailLink?: string; mimeType?: string }> } | null>(null);
  const [note, setNote] = useState("");
  const openDrive = async () => { setErr(""); try { const r = await call<{ connected: boolean; files: Array<{ id: string; name: string; thumbnailLink?: string; mimeType?: string }> }>("/api/media-library?drive=1&folder=root"); setDrive({ connected: r.connected, files: (r.files || []).filter((f) => String(f.mimeType || "").startsWith("image/")) }); } catch (e) { setErr(e instanceof Error ? e.message : "Google Drive couldn't be opened."); } };
  const importDrive = async (fileId: string, name: string) => { setBusy("upload"); try { const r = await call<{ item: Media }>("/api/media-library", { action: "importDrive", scope: clientId, fileId, name, folder: "Social posts" }); onMedia(r.item); setP((cur) => ({ ...cur, images: [...cur.images, r.item.url].slice(0, 10) })); } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't import from Drive."); } finally { setBusy(""); } };
  const review = async (action: "approve" | "reject" | "publish") => { setBusy("save"); setErr(""); try { if (action !== "publish") await call("/api/social-posts", { action: "save", clientId, post: p }); const r = await call<{ result?: { status: string } }>("/api/social-posts", { action, clientId, id: p.id, note }); onSaved(action === "approve" ? "Approved and scheduled." : action === "reject" ? "Sent back with your note." : r.result?.status === "posted" ? "Published ✓" : "Publish attempted — see results on the post."); } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't do that."); } finally { setBusy(""); } };
  const [p, setP] = useState<Post>(post);
  const [prompt, setPrompt] = useState("");
  const [tagDraft, setTagDraft] = useState("");
  const parts = splitCaption(p.caption);
  const [ideas, setIdeas] = useState<string[]>([]);
  const [busy, setBusy] = useState(""); const [err, setErr] = useState("");
  const [picker, setPicker] = useState(false);
  const local = new Date(p.postAt); const dateVal = ymd(local); const timeVal = `${String(local.getHours()).padStart(2, "0")}:${String(local.getMinutes()).padStart(2, "0")}`;
  const setWhen = (date: string, time: string) => setP({ ...p, postAt: new Date(`${date}T${time}:00`).toISOString() });
  const write = async () => { setBusy("ai"); setErr(""); try { const r = await call<{ posts: Array<{ caption: string }> }>("/api/social-posts", { action: "generate", clientId, clientName, count: 3, platforms: p.platforms, prompt: prompt || p.caption || "A post for this week." }); setIdeas(r.posts.map((x) => x.caption)); } catch (e) { setErr(e instanceof Error ? e.message : "No ideas."); } finally { setBusy(""); } };
  const upload = async (files: FileList | null) => {
    for (const file of [...(files || [])].filter((f) => f.type.startsWith("image/")).slice(0, 6)) {
      setBusy("upload");
      try { const q = new URLSearchParams({ scope: clientId, folder: "Social posts", name: file.name.slice(0, 120) }); const res = await fetch(`/api/media-library?${q}`, { method: "PUT", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file }); const out = await res.json().catch(() => ({})) as { item?: Media; error?: string }; if (!res.ok || !out.item) throw new Error(out.error || "Upload failed"); onMedia(out.item); setP((cur) => ({ ...cur, images: [...cur.images, out.item!.url].slice(0, 10) })); }
      catch (e) { setErr(e instanceof Error ? e.message : "Upload failed."); }
      finally { setBusy(""); }
    }
  };
  const save = async (statusOverride?: Post["status"]) => { setBusy("save"); setErr(""); try { await call("/api/social-posts", { action: "save", clientId, post: { ...p, status: statusOverride || p.status } }); onSaved(statusOverride === "posted" ? "Marked as posted." : statusOverride === "scheduled" ? "Scheduled." : "Saved."); } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't save."); } finally { setBusy(""); } };
  const remove = async () => { if (!p.id) return onClose(); setBusy("save"); try { await call("/api/social-posts", { action: "delete", clientId, id: p.id }); onSaved("Post deleted."); } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't delete."); } finally { setBusy(""); } };

  return <div className="sp-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="sp-editor" role="dialog" aria-modal="true" aria-label="Social post">
      <header><b>{p.id ? "Edit post" : "New post"}</b><span className={`sp-badge ${p.status}`}>{STATUS_LABEL[p.status] || p.status}</span>{p.createdByName && <small className="sp-by">by {p.createdByName}{p.authorType === "subaccount" ? " (client team)" : ""}</small>}<button type="button" className="sp-x" aria-label="Close" onClick={onClose}>×</button></header>
      <div className="sp-editor-body">
        <div className="sp-col">
          <div className="sp-row2"><label>Date<input type="date" value={dateVal} onChange={(e) => setWhen(e.target.value, timeVal)} /></label><label>Time<input type="time" value={timeVal} onChange={(e) => setWhen(dateVal, e.target.value)} /></label></div>
          <div className="sp-platforms">{PLATFORMS.map(([k, label, color]) => { const on = p.platforms.includes(k); return <button key={k} type="button" className={on ? "on" : ""} style={{ ["--pc" as string]: color }} aria-pressed={on} onClick={() => setP({ ...p, platforms: on ? p.platforms.filter((x) => x !== k) : [...p.platforms, k] })}><PlatformIcon id={k} size={14} /> {label}</button>; })}</div>
          <label>Description<textarea rows={6} value={parts.text} maxLength={4500} placeholder="Write the post, or ask the AI below…" onChange={(e) => setP({ ...p, caption: joinCaption(e.target.value, parts.tags) })} /><small className="sp-chars">{p.caption.length} characters{p.platforms.includes("google") && p.caption.length > 1500 ? " · Google posts max 1,500" : ""}</small></label>
          <div className="sp-tags"><b className="sp-label">Hashtags</b><div>{parts.tags.map((t) => <span key={t}>{t}<button type="button" aria-label={`Remove ${t}`} onClick={() => setP({ ...p, caption: joinCaption(parts.text, parts.tags.filter((x) => x !== t)) })}>×</button></span>)}<input value={tagDraft} placeholder="+ add hashtag" onChange={(e) => setTagDraft(e.target.value)} onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " " || e.key === ",") && tagDraft.trim()) { e.preventDefault(); const t = `#${tagDraft.trim().replace(/^#+/, "").replace(/\s+/g, "")}`; setP({ ...p, caption: joinCaption(parts.text, [...new Set([...parts.tags, t])]) }); setTagDraft(""); } }} /></div></div>
          <div className="sp-ai"><input value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="✨ What's the post about? e.g. Saturday walk-ins, new flash designs" /><button type="button" className="secondary-button" disabled={busy === "ai"} onClick={() => void write()}>{busy === "ai" ? "Writing…" : "Write with AI"}</button></div>
          {ideas.length > 0 && <div className="sp-ideas">{ideas.map((t, i) => { const d = splitCaption(t); return <button key={i} type="button" onClick={() => { setP({ ...p, caption: t }); setIdeas([]); }}><b>Option {i + 1}</b><span>{d.text}</span>{d.tags.length > 0 && <em className="sp-idea-tags">{d.tags.join(" ")}</em>}</button>; })}</div>}
        </div>
        <div className="sp-col">
          <b className="sp-label">Photos</b>
          <div className="sp-images">{p.images.map((u) => <span key={u}><img src={u} alt="" /><button type="button" aria-label="Remove" onClick={() => setP({ ...p, images: p.images.filter((x) => x !== u) })}>×</button></span>)}
            <button type="button" className="sp-add" onClick={() => setPicker((v) => !v)}>🖼️<small>Media Library</small></button>
            <button type="button" className="sp-add" onClick={() => void openDrive()}>🟢<small>Google Drive</small></button>
            <label className="sp-add">{busy === "upload" ? "…" : "⬆️"}<small>Upload</small><input type="file" accept="image/*" multiple hidden onChange={(e) => { void upload(e.target.files); e.target.value = ""; }} /></label></div>
          {picker && [...new Set(media.map((m) => m.createdBy).filter(Boolean))].length > 1 && <select className="sp-uploader" value={uploader} onChange={(e) => setUploader(e.target.value)} aria-label="Uploaded by"><option value="">Uploaded by anyone</option>{[...new Set(media.map((m) => m.createdBy).filter(Boolean))].map((u) => <option key={u}>{u}</option>)}</select>}
          {drive && <div className="sp-drive">{!drive.connected ? <p>Connect your own Google Drive to pick images from it. <a className="primary-button" href="/api/media-library/drive?mine=1">Connect my Google Drive</a></p> : drive.files.length ? drive.files.slice(0, 48).map((f) => <button key={f.id} type="button" title={f.name} onClick={() => void importDrive(f.id, f.name)}>{f.thumbnailLink ? <img src={f.thumbnailLink} alt="" referrerPolicy="no-referrer" /> : <span>{f.name}</span>}</button>) : <p>No images in the top of your Drive. <a href="/api/media-library/drive?mine=1">Use a different Google account</a></p>}<button type="button" className="text-button" onClick={() => setDrive(null)}>Close Drive</button></div>}
          {picker && <div className="sp-picker">{media.filter((m) => !uploader || m.createdBy === uploader).length ? media.filter((m) => !uploader || m.createdBy === uploader).slice(0, 48).map((m) => { const on = p.images.includes(m.url); return <button key={m.id} type="button" className={on ? "on" : ""} onClick={() => setP({ ...p, images: on ? p.images.filter((x) => x !== m.url) : [...p.images, m.url].slice(0, 10) })}><img src={m.url} alt={m.name} loading="lazy" /></button>; }) : <p>No photos in {clientName}'s Media Library yet. Upload one.</p>}</div>}
          <div className="sp-preview"><b className="sp-label">Preview</b><div className="sp-preview-card"><div className="sp-pv-head"><span>{clientName.slice(0, 1)}</span><b>{clientName}</b><i className="sp-icons">{p.platforms.map((x) => <PlatformIcon key={x} id={x} size={14} />)}</i><small>{new Date(p.postAt).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</small></div>{p.caption && <p>{p.caption}</p>}{p.images[0] && <img src={p.images[0]} alt="" />}</div></div>
        </div>
      </div>
      {err && <p className="sp-err" role="alert">{err}</p>}
      <footer>{p.id && <button type="button" className="text-button sp-del" onClick={() => void remove()}>Delete</button>}{p.caption && <button type="button" className="text-button" onClick={() => { void navigator.clipboard?.writeText(p.caption); }}>Copy caption</button>}<span style={{ flex: 1 }} />
        {p.status === "scheduled" && Date.parse(p.postAt) < Date.now() && <button type="button" className="secondary-button" disabled={!!busy} onClick={() => void save("posted")}>Mark as posted</button>}
        <button type="button" className="secondary-button" disabled={!!busy} onClick={() => void save("draft")}>Save draft</button>
        {canApprove && p.id && p.status === "pending" ? <><input className="sp-note" placeholder="Note for the client (optional)" value={note} onChange={(e) => setNote(e.target.value)} /><button type="button" className="secondary-button" disabled={!!busy} onClick={() => void review("reject")}>Send back</button><button type="button" className="primary-button" disabled={!!busy} onClick={() => void review("approve")}>Approve &amp; schedule</button></>
          : <button type="button" className="primary-button" disabled={!!busy || !p.caption.trim() || !p.platforms.length} onClick={() => void save("scheduled")}>{canApprove ? "Schedule" : "Send for approval"}</button>}
        {canApprove && p.id && ["scheduled", "failed"].includes(p.status) && <button type="button" className="secondary-button" disabled={!!busy} onClick={() => void review("publish")}>Publish now</button>}</footer>
      {(p.reviewNote || Object.keys(p.publish || {}).length > 0) && <div className="sp-results">{p.reviewNote && <p className="sp-review">💬 {p.reviewedBy ? `${p.reviewedBy}: ` : ""}{p.reviewNote}</p>}{Object.entries(p.publish || {}).map(([k, r]) => <p key={k} className={r.ok ? "ok" : "bad"}><b>{PLATFORMS.find((x) => x[0] === k)?.[1] || k}</b> {r.ok ? <>posted {r.url && <a href={r.url} target="_blank" rel="noreferrer">view ↗</a>}</> : r.error}</p>)}</div>}
    </div>
  </div>;
}
