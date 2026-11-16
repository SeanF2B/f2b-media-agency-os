"use client";
// Social post planner: a month calendar of posts per client. Write with AI, attach photos from the client's Media Library.
import { useCallback, useEffect, useMemo, useState } from "react";

type Post = { id: string; clientId: string; postAt: string; platforms: string[]; caption: string; images: string[]; status: "draft" | "scheduled" | "posted"; updatedAt?: string };
type Media = { id: string; url: string; name: string; kind: string };
const PLATFORMS: Array<[string, string, string]> = [["facebook", "Facebook", "#1877f2"], ["instagram", "Instagram", "#e1306c"], ["google", "Google Business", "#34a853"], ["linkedin", "LinkedIn", "#0a66c2"], ["tiktok", "TikTok", "#111"]];
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const hm = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

async function call<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const json = await res.json().catch(() => ({})) as T & { error?: string };
  if (!res.ok) throw new Error(json.error || "Something went wrong.");
  return json;
}

export function SocialPlanner({ clientId, clientName }: { clientId: string; clientName: string }) {
  const [month, setMonth] = useState(() => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d; });
  const [posts, setPosts] = useState<Post[]>([]);
  const [edit, setEdit] = useState<Post | null>(null);
  const [status, setStatus] = useState("");
  const [planning, setPlanning] = useState(false);
  const [media, setMedia] = useState<Media[]>([]);

  const load = useCallback(async () => {
    try { const from = new Date(month); from.setDate(from.getDate() - 7); const to = new Date(month); to.setMonth(to.getMonth() + 1, 7);
      const r = await call<{ posts: Post[] }>(`/api/social-posts?clientId=${encodeURIComponent(clientId)}&from=${from.toISOString()}&to=${to.toISOString()}`); setPosts(r.posts); setStatus(""); }
    catch (e) { setStatus(e instanceof Error ? e.message : "Couldn't load posts."); }
  }, [clientId, month]);
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
      setStatus(`Added ${Math.min(r.posts.length, slots.length)} draft posts. Open any to edit, then mark it Scheduled.`); await load();
    } catch (e) { setStatus(e instanceof Error ? e.message : "Couldn't plan the month."); }
    finally { setPlanning(false); }
  };

  return <section className="sp" aria-label="Social posts">
    <header className="sp-head">
      <div><h3>📅 Social posts</h3><p>Plan {clientName}'s posts on a calendar, write them with AI and add photos from the Media Library.</p></div>
      <div className="sp-actions"><span className="sp-count"><b>{upcoming}</b> upcoming</span><button type="button" className="secondary-button" disabled={planning} onClick={() => void planMonth()}>{planning ? "Planning…" : "✨ Plan this month with AI"}</button><button type="button" className="primary-button" onClick={() => newPost(new Date())}>+ New post</button></div>
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
            <span><em>{hm(p.postAt)} {p.platforms.map((x) => <i key={x} style={{ background: PLATFORMS.find((q) => q[0] === x)?.[2] }} />)}</em><small>{p.caption.split("\n")[0].slice(0, 60) || "Untitled post"}</small></span>
          </button>)}
        </div>; })}
    </div>
    {edit && <PostEditor post={edit} clientId={clientId} clientName={clientName} media={media} onMedia={(m) => setMedia((cur) => [m, ...cur])} onClose={() => setEdit(null)} onSaved={async (msg) => { setEdit(null); setStatus(msg); await load(); }} />}
  </section>;
}

function PostEditor({ post, clientId, clientName, media, onMedia, onClose, onSaved }: { post: Post; clientId: string; clientName: string; media: Media[]; onMedia: (m: Media) => void; onClose: () => void; onSaved: (msg: string) => void }) {
  const [p, setP] = useState<Post>(post);
  const [prompt, setPrompt] = useState("");
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
      <header><b>{p.id ? "Edit post" : "New post"}</b><span className={`sp-badge ${p.status}`}>{p.status === "draft" ? "Draft" : p.status === "scheduled" ? "Scheduled" : "Posted"}</span><button type="button" className="sp-x" aria-label="Close" onClick={onClose}>×</button></header>
      <div className="sp-editor-body">
        <div className="sp-col">
          <div className="sp-row2"><label>Date<input type="date" value={dateVal} onChange={(e) => setWhen(e.target.value, timeVal)} /></label><label>Time<input type="time" value={timeVal} onChange={(e) => setWhen(dateVal, e.target.value)} /></label></div>
          <div className="sp-platforms">{PLATFORMS.map(([k, label, color]) => { const on = p.platforms.includes(k); return <button key={k} type="button" className={on ? "on" : ""} style={{ ["--pc" as string]: color }} aria-pressed={on} onClick={() => setP({ ...p, platforms: on ? p.platforms.filter((x) => x !== k) : [...p.platforms, k] })}>{label}</button>; })}</div>
          <label>Caption<textarea rows={8} value={p.caption} maxLength={5000} placeholder="Write the post, or ask the AI below…" onChange={(e) => setP({ ...p, caption: e.target.value })} /><small className="sp-chars">{p.caption.length} characters{p.platforms.includes("google") && p.caption.length > 1500 ? " · Google posts max 1,500" : ""}</small></label>
          <div className="sp-ai"><input value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="✨ What's the post about? e.g. Saturday walk-ins, new flash designs" /><button type="button" className="secondary-button" disabled={busy === "ai"} onClick={() => void write()}>{busy === "ai" ? "Writing…" : "Write with AI"}</button></div>
          {ideas.length > 0 && <div className="sp-ideas">{ideas.map((t, i) => <button key={i} type="button" onClick={() => { setP({ ...p, caption: t }); setIdeas([]); }}><b>Option {i + 1}</b><span>{t}</span></button>)}</div>}
        </div>
        <div className="sp-col">
          <b className="sp-label">Photos</b>
          <div className="sp-images">{p.images.map((u) => <span key={u}><img src={u} alt="" /><button type="button" aria-label="Remove" onClick={() => setP({ ...p, images: p.images.filter((x) => x !== u) })}>×</button></span>)}
            <button type="button" className="sp-add" onClick={() => setPicker((v) => !v)}>🖼️<small>Media Library</small></button>
            <label className="sp-add">{busy === "upload" ? "…" : "⬆️"}<small>Upload</small><input type="file" accept="image/*" multiple hidden onChange={(e) => { void upload(e.target.files); e.target.value = ""; }} /></label></div>
          {picker && <div className="sp-picker">{media.length ? media.slice(0, 48).map((m) => { const on = p.images.includes(m.url); return <button key={m.id} type="button" className={on ? "on" : ""} onClick={() => setP({ ...p, images: on ? p.images.filter((x) => x !== m.url) : [...p.images, m.url].slice(0, 10) })}><img src={m.url} alt={m.name} loading="lazy" /></button>; }) : <p>No photos in {clientName}'s Media Library yet. Upload one.</p>}</div>}
          <div className="sp-preview"><b className="sp-label">Preview</b><div className="sp-preview-card"><div className="sp-pv-head"><span>{clientName.slice(0, 1)}</span><b>{clientName}</b><small>{new Date(p.postAt).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</small></div>{p.caption && <p>{p.caption}</p>}{p.images[0] && <img src={p.images[0]} alt="" />}</div></div>
        </div>
      </div>
      {err && <p className="sp-err" role="alert">{err}</p>}
      <footer>{p.id && <button type="button" className="text-button sp-del" onClick={() => void remove()}>Delete</button>}{p.caption && <button type="button" className="text-button" onClick={() => { void navigator.clipboard?.writeText(p.caption); }}>Copy caption</button>}<span style={{ flex: 1 }} />
        {p.status === "scheduled" && Date.parse(p.postAt) < Date.now() && <button type="button" className="secondary-button" disabled={!!busy} onClick={() => void save("posted")}>Mark as posted</button>}
        <button type="button" className="secondary-button" disabled={!!busy} onClick={() => void save("draft")}>Save draft</button>
        <button type="button" className="primary-button" disabled={!!busy || !p.caption.trim() || !p.platforms.length} onClick={() => void save("scheduled")}>Schedule</button></footer>
    </div>
  </div>;
}
