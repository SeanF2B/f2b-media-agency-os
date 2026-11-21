"use client";
// Social post planner: a month calendar of posts per client. Write with AI, attach photos from the client's Media Library.
import { useCallback, useEffect, useMemo, useState } from "react";
import { PlatformIcon } from "./platform-icon";
import { useSampleData } from "@/hooks/use-sample-data";

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
/** Videos are stored in the same list as photos; the file extension tells them apart. */
export const isVideo = (url: string) => /\.(mp4|mov|m4v|webm)(?:$|[?&#])/i.test(decodeURIComponent(url || ""));
/** Marker for the AI's filming plan on video drafts. Everything after it is stripped before posting. */
export const VIDEO_PLAN_MARK = "🎬 Video plan (not posted):";
export const postableCaption = (caption: string) => { const i = caption.indexOf(VIDEO_PLAN_MARK); return (i >= 0 ? caption.slice(0, i) : caption).replace(/\s*-{3,}\s*$/, "").trim(); };
const MediaThumb = ({ url, alt = "" }: { url: string; alt?: string }) => isVideo(url) ? <video src={url} muted playsInline preload="metadata" aria-label={alt || "Video"} /> : <img src={url} alt={alt} loading="lazy" />;
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
  // Sample mode: "Draft this month's posts" really writes example posts with AI, shown on the calendar but never saved.
  const [sample] = useSampleData();
  const [demo, setDemo] = useState<Post[]>([]);
  const [opened, setOpened] = useState("");
  useEffect(() => { if (!sample) setDemo([]); }, [sample]);

  const load = useCallback(async () => {
    try { const from = new Date(month); from.setDate(from.getDate() - 7); const to = new Date(month); to.setMonth(to.getMonth() + 1, 7);
      const r = await call<{ posts: Post[] }>(`/api/social-posts?clientId=${encodeURIComponent(clientId)}&from=${from.toISOString()}&to=${to.toISOString()}`); setPosts(r.posts.filter((x) => (!filters.createdBy || x.createdByName === filters.createdBy) && (!filters.platform || x.platforms.includes(filters.platform)) && (!filters.status || x.status === filters.status))); setStatus(""); }
    catch (e) { setStatus(e instanceof Error ? e.message : "Couldn't load posts."); }
  }, [clientId, month, filters.createdBy, filters.platform, filters.status]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { let live = true; Promise.all([call<{ items: Media[] }>(`/api/media-library?scope=${encodeURIComponent(clientId)}&kind=image`).catch(() => ({ items: [] as Media[] })), call<{ items: Media[] }>(`/api/media-library?scope=${encodeURIComponent(clientId)}&kind=video`).catch(() => ({ items: [] as Media[] }))]).then(([a, b]) => { if (live) setMedia([...(a.items || []), ...(b.items || [])]); }).catch(() => undefined); return () => { live = false; }; }, [clientId]);
  const [planOpen, setPlanOpen] = useState(false);

  const days = useMemo(() => { const start = new Date(month); const lead = (start.getDay() + 6) % 7; start.setDate(start.getDate() - lead); return Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; }); }, [month]);
  const shown = useMemo(() => (sample ? [...posts, ...demo] : posts), [sample, posts, demo]);
  const byDay = useMemo(() => { const m = new Map<string, Post[]>(); for (const p of shown) { const k = ymd(new Date(p.postAt)); m.set(k, [...(m.get(k) || []), p]); } return m; }, [shown]);
  const upcoming = shown.filter((p) => p.status !== "posted" && Date.parse(p.postAt) >= Date.now()).length;
  const due = posts.filter((p) => p.status === "scheduled" && Date.parse(p.postAt) < Date.now());

  const newPost = (day: Date) => { const d = new Date(day); d.setHours(10, 0, 0, 0); setEdit({ id: "", clientId, postAt: d.toISOString(), platforms: ["facebook", "instagram"], caption: "", images: [], status: "draft" }); };
  // Plan the month with the options the person picked (days, frequency, times, platforms, photo/video, theme per post).
  const planMonth = async (opt: PlanOptions) => {
    setPlanOpen(false); setPlanning(true); setStatus("Writing this month's posts…");
    try {
      const slots = planSlots(days, month, opt, (d) => Boolean(byDay.get(ymd(d))?.length));
      if (!slots.length) { setStatus("No free days left this month with those settings. Pick more days, or try next month."); return; }
      const themes = opt.mode === "services" ? opt.services : opt.mode === "custom" ? opt.custom.split("\n").map((x) => x.trim()).filter(Boolean) : [];
      const n = themes.length && !opt.rotate ? Math.min(themes.length, slots.length) : slots.length;
      const plan = slots.slice(0, n).map((d, i) => {
        const fmt: "photo" | "video" = opt.format === "video" ? "video" : opt.format === "mix" ? (i % 2 ? "video" : "photo") : "photo";
        const time = opt.time2 && i % 2 ? opt.time2 : opt.time1 || "10:00";
        const at = new Date(d); const [hh, mm] = time.split(":").map(Number); at.setHours(hh || 10, mm || 0, 0, 0);
        return { at, fmt, theme: themes.length ? themes[i % themes.length] : "" };
      });
      const briefs = plan.map((x) => [x.fmt === "video" ? "VIDEO (Reel / short video)" : "PHOTO post", x.theme ? `about: ${x.theme}` : "", `for ${x.at.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}`].filter(Boolean).join(" · "));
      const monthName = month.toLocaleDateString("en-GB", { month: "long" });
      // Captions in batches of 10 (the AI writes a few at a time so they stay varied).
      const results: Array<{ caption: string; videoPlan?: string }> = [];
      let aiFailed = "";
      for (let i = 0; i < briefs.length; i += 10) {
        const chunk = briefs.slice(i, i + 10);
        try { const r = await call<{ posts: Array<{ caption: string; videoPlan?: string }> }>("/api/social-posts", { action: "generate", clientId, clientName, count: chunk.length, platforms: opt.platforms, briefs: chunk, prompt: `Plan ${chunk.length} posts for ${monthName}.${opt.extra ? ` Notes: ${opt.extra}` : ""}` }); results.push(...r.posts); }
        catch (e) { aiFailed = e instanceof Error ? e.message : "AI unavailable"; break; }
      }
      const name = clientName || "us";
      const fallback = (theme: string, k: number) => theme ? `${theme} at ${name} ✨ Get in touch to book yours today.\n\n#${theme.replace(/[^\p{L}\p{N}]+/gu, "").toLowerCase()} #local #booknow` : [`Weekend bookings are filling up fast at ${name}. Message us today to grab a spot ✨\n\n#booknow #local #smallbusiness`, `A look at some recent work from the ${name} team. Which is your favourite? 👇\n\n#recentwork #behindthescenes`, `Got a question before you book? Our team is happy to help — just drop us a message.\n\n#askus #customercare`, `Thank you to everyone who visited ${name} this month. Your reviews mean the world to us 🙏\n\n#thankyou #reviews`][k % 4];
      if (aiFailed && !sample) { setStatus(aiFailed); return; }
      // Photos / videos from the Media Library, matched to the theme by file name where possible.
      let photos = media.filter((m) => !isVideo(m.url) && m.kind !== "video");
      const videos = media.filter((m) => isVideo(m.url) || m.kind === "video");
      if (sample && !photos.length) { try { const site = await call<{ gallery?: string[]; work?: Record<string, string[]> }>(`/api/scheduling?clientId=${encodeURIComponent(clientId)}&view=site`); photos = [...new Set([...Object.values(site.work || {}).flat(), ...(site.gallery || [])])].map((url, i) => ({ id: `site-${i}`, url, name: "", kind: "image" })); } catch { /* no photos */ } }
      const pick = (list: Media[], theme: string, i: number) => { if (!list.length) return ""; const words = theme.toLowerCase().split(/\W+/).filter((w) => w.length > 3); const hit = words.length ? list.find((m) => words.some((w) => (m.name || "").toLowerCase().includes(w))) : undefined; return (hit || list[i % list.length]).url; };
      const made: Post[] = plan.map((x, i) => {
        const r = results[i]; const base = r?.caption || fallback(x.theme, i);
        const caption = x.fmt === "video" ? `${base}\n\n---\n${VIDEO_PLAN_MARK}\n${r?.videoPlan || "Film a 15–30 second clip: hook in the first 2 seconds, show the work up close, end on the result with a call to book."}` : base;
        const file = x.fmt === "video" ? pick(videos, x.theme, i) || "" : pick(photos, x.theme, i);
        return { id: sample ? `sample-${ymd(x.at)}-${i}` : "", clientId, postAt: x.at.toISOString(), platforms: opt.platforms, caption, images: file ? [file] : [], status: "draft", createdByName: sample ? "Sample" : undefined };
      });
      const noVideo = made.filter((m) => m.caption.includes(VIDEO_PLAN_MARK) && !m.images.length).length;
      if (sample) {
        setDemo((cur) => [...cur.filter((c) => !made.some((m) => ymd(new Date(m.postAt)) === ymd(new Date(c.postAt)))), ...made]);
        setStatus(`Sample: drafted ${made.length} example posts${results.length ? " with AI" : ""}. They're not saved — open one and Save draft to keep it.`);
        return;
      }
      for (const m of made) await call("/api/social-posts", { action: "save", clientId, post: { postAt: m.postAt, platforms: m.platforms, caption: m.caption, images: m.images, status: "draft" } });
      setStatus(`Drafted ${made.length} posts${themes.length ? ` (${opt.mode === "services" ? "by service" : "your ideas"})` : ""}.${noVideo ? ` ${noVideo} video post${noVideo === 1 ? " needs" : "s need"} a video: each has a filming plan, so record it and attach it.` : ""} Open any to check it, then Schedule.`); await load();
    } catch (e) { setStatus(e instanceof Error ? e.message : "Couldn't plan the month."); }
    finally { setPlanning(false); }
  };

  return <section className="sp" aria-label="Social posts">
    <header className="sp-head">
      <div><h3>📅 Social posts</h3><p>Plan {clientName}'s posts on a calendar, write them with AI and add photos from the Media Library.</p></div>
      <div className="sp-actions"><span className="sp-count"><b>{upcoming}</b> upcoming</span><button type="button" className="secondary-button" disabled={planning} onClick={() => setPlanOpen(true)}>{planning ? "Drafting…" : "✨ Draft this month’s posts"}</button><button type="button" className="primary-button" onClick={() => newPost(new Date())}>+ New post</button></div>
    </header>
    {status && <p className="sp-status" role="status">{status}</p>}
    {due.length > 0 && <div className="sp-due">⏰ {due.length} post{due.length === 1 ? " is" : "s are"} ready to go out: {due.map((p) => <button key={p.id} type="button" className="text-button" onClick={() => setEdit(p)}>{new Date(p.postAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</button>)}</div>}
    <div className="sp-nav"><button type="button" className="iv-btn" aria-label="Previous month" onClick={() => { const d = new Date(month); d.setMonth(d.getMonth() - 1); setMonth(d); }}>‹</button><b>{month.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</b><button type="button" className="iv-btn" aria-label="Next month" onClick={() => { const d = new Date(month); d.setMonth(d.getMonth() + 1); setMonth(d); }}>›</button></div>
    <div className="sp-grid">
      {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="sp-dow">{d}</div>)}
      {days.map((d) => { const k = ymd(d); const list = byDay.get(k) || []; const out = d.getMonth() !== month.getMonth(); const today = k === ymd(new Date());
        return <div key={k} className={`sp-day${out ? " out" : ""}${today ? " today" : ""}`} onClick={(e) => { if (e.target === e.currentTarget) newPost(d); }}>
          <span className="sp-date" onClick={() => newPost(d)}>{d.getDate()}</span>
          {list.map((p) => <button key={p.id} type="button" className={`sp-post ${p.status}${p.id.startsWith("sample-") ? " sample" : ""}`} onClick={() => { if (p.id.startsWith("sample-")) { setOpened(p.id); setEdit({ ...p, id: "", createdByName: "" }); } else { setOpened(""); setEdit(p); } }} title={p.caption}>
            {p.images[0] ? <MediaThumb url={p.images[0]} /> : p.caption.includes(VIDEO_PLAN_MARK) ? <i className="sp-vid-need" title="Needs a video">🎬</i> : null}
            <span><em>{hm(p.postAt)} <span className="sp-icons">{p.platforms.map((x) => <PlatformIcon key={x} id={x} size={12} />)}</span>{p.createdByName && <b className="sp-who" title={`By ${p.createdByName}`}>{initials(p.createdByName)}</b>}</em><small>{p.caption.split("\n")[0].slice(0, 60) || "Untitled post"}</small></span>
          </button>)}
        </div>; })}
    </div>
    {planOpen && <PlanModal clientId={clientId} month={month} onClose={() => setPlanOpen(false)} onRun={(o) => void planMonth(o)} preview={(o) => planSlots(days, month, o, (d) => Boolean(byDay.get(ymd(d))?.length)).length} />}
    {edit && <PostEditor post={edit} clientId={clientId} clientName={clientName} media={media} canApprove={canApprove} onMedia={(m) => setMedia((cur) => [m, ...cur])} onClose={() => setEdit(null)} onSaved={async (msg) => { setEdit(null); if (opened) { setDemo((cur) => cur.filter((x) => x.id !== opened)); setOpened(""); } setStatus(msg); await load(); onChanged?.(); }} />}
  </section>;
}

export function PostEditor({ post, clientId, clientName, media, onMedia, onClose, onSaved, canApprove = false }: { post: Post; clientId: string; clientName: string; media: Media[]; onMedia: (m: Media) => void; onClose: () => void; onSaved: (msg: string) => void; canApprove?: boolean }) {
  const [uploader, setUploader] = useState("");
  const [drive, setDrive] = useState<{ connected: boolean; files: Array<{ id: string; name: string; thumbnailLink?: string; mimeType?: string }> } | null>(null);
  const [note, setNote] = useState("");
  const openDrive = async () => { setErr(""); try { const r = await call<{ connected: boolean; files: Array<{ id: string; name: string; thumbnailLink?: string; mimeType?: string }> }>("/api/media-library?drive=1&folder=root"); setDrive({ connected: r.connected, files: (r.files || []).filter((f) => /^(image|video)\//.test(String(f.mimeType || ""))) }); } catch (e) { setErr(e instanceof Error ? e.message : "Google Drive couldn't be opened."); } };
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
    for (const file of [...(files || [])].filter((f) => f.type.startsWith("image/") || f.type.startsWith("video/")).slice(0, 6)) {
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
          <b className="sp-label">Photos &amp; videos</b>
          <div className="sp-images">{p.images.map((u) => <span key={u} className={isVideo(u) ? "vid" : ""}><MediaThumb url={u} /><button type="button" aria-label="Remove" onClick={() => setP({ ...p, images: p.images.filter((x) => x !== u) })}>×</button></span>)}
            <button type="button" className="sp-add" onClick={() => setPicker((v) => !v)}>🖼️<small>Media Library</small></button>
            <button type="button" className="sp-add" onClick={() => void openDrive()}>🟢<small>Google Drive</small></button>
            <label className="sp-add">{busy === "upload" ? "…" : "⬆️"}<small>Upload</small><input type="file" accept="image/*,video/mp4,video/quicktime,video/webm" multiple hidden onChange={(e) => { void upload(e.target.files); e.target.value = ""; }} /></label></div>
          {picker && [...new Set(media.map((m) => m.createdBy).filter(Boolean))].length > 1 && <select className="sp-uploader" value={uploader} onChange={(e) => setUploader(e.target.value)} aria-label="Uploaded by"><option value="">Uploaded by anyone</option>{[...new Set(media.map((m) => m.createdBy).filter(Boolean))].map((u) => <option key={u}>{u}</option>)}</select>}
          {drive && <div className="sp-drive">{!drive.connected ? <p>Connect your own Google Drive to pick images from it. <a className="primary-button" href="/api/media-library/drive?mine=1">Connect my Google Drive</a></p> : drive.files.length ? drive.files.slice(0, 48).map((f) => <button key={f.id} type="button" title={f.name} onClick={() => void importDrive(f.id, f.name)}>{f.thumbnailLink ? <img src={f.thumbnailLink} alt="" referrerPolicy="no-referrer" /> : <span>{f.name}</span>}</button>) : <p>No images in the top of your Drive. <a href="/api/media-library/drive?mine=1">Use a different Google account</a></p>}<button type="button" className="text-button" onClick={() => setDrive(null)}>Close Drive</button></div>}
          {picker && <div className="sp-picker">{media.filter((m) => !uploader || m.createdBy === uploader).length ? media.filter((m) => !uploader || m.createdBy === uploader).slice(0, 48).map((m) => { const on = p.images.includes(m.url); return <button key={m.id} type="button" className={on ? "on" : ""} onClick={() => setP({ ...p, images: on ? p.images.filter((x) => x !== m.url) : [...p.images, m.url].slice(0, 10) })}><MediaThumb url={m.url} alt={m.name} /></button>; }) : <p>No photos or videos in {clientName}'s Media Library yet. Upload one.</p>}</div>}
          {p.images.some(isVideo) && <small className="sp-vid-note">Video posts go out as a Reel on Instagram and a video on Facebook (one video per post). Google Business gets the text only.</small>}
          {p.caption.includes(VIDEO_PLAN_MARK) && !p.images.some(isVideo) && <small className="sp-vid-note warn">This is a video post: film it using the plan in the description, then attach it here. The plan is never posted.</small>}
          <div className="sp-preview"><b className="sp-label">Preview</b><div className="sp-preview-card"><div className="sp-pv-head"><span>{clientName.slice(0, 1)}</span><b>{clientName}</b><i className="sp-icons">{p.platforms.map((x) => <PlatformIcon key={x} id={x} size={14} />)}</i><small>{new Date(p.postAt).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</small></div>{p.caption && <p>{postableCaption(p.caption)}</p>}{p.images[0] && (isVideo(p.images[0]) ? <video src={p.images[0]} controls playsInline preload="metadata" /> : <img src={p.images[0]} alt="" />)}</div></div>
        </div>
      </div>
      {err && <p className="sp-err" role="alert">{err}</p>}
      <footer>{p.id && <button type="button" className="text-button sp-del" onClick={() => void remove()}>Delete</button>}{p.caption && <button type="button" className="text-button" onClick={() => { void navigator.clipboard?.writeText(postableCaption(p.caption)); }}>Copy caption</button>}<span style={{ flex: 1 }} />
        {p.status === "scheduled" && Date.parse(p.postAt) < Date.now() && <button type="button" className="secondary-button" disabled={!!busy} onClick={() => void save("posted")}>Mark as posted</button>}
        <button type="button" className="secondary-button" disabled={!!busy} onClick={() => void save("draft")}>Save draft</button>
        {canApprove && p.id && p.status === "pending" ? <><input className="sp-note" placeholder="Note for the client (optional)" value={note} onChange={(e) => setNote(e.target.value)} /><button type="button" className="secondary-button" disabled={!!busy} onClick={() => void review("reject")}>Send back</button><button type="button" className="primary-button" disabled={!!busy} onClick={() => void review("approve")}>Approve &amp; schedule</button></>
          : <button type="button" className="primary-button" disabled={!!busy || !p.caption.trim() || !p.platforms.length} onClick={() => void save("scheduled")}>{canApprove ? "Schedule" : "Send for approval"}</button>}
        {canApprove && p.id && ["scheduled", "failed"].includes(p.status) && <button type="button" className="secondary-button" disabled={!!busy} onClick={() => void review("publish")}>Publish now</button>}</footer>
      {(p.reviewNote || Object.keys(p.publish || {}).length > 0) && <div className="sp-results">{p.reviewNote && <p className="sp-review">💬 {p.reviewedBy ? `${p.reviewedBy}: ` : ""}{p.reviewNote}</p>}{Object.entries(p.publish || {}).map(([k, r]) => <p key={k} className={r.ok ? "ok" : "bad"}><b>{PLATFORMS.find((x) => x[0] === k)?.[1] || k}</b> {r.ok ? <>posted {r.url && <a href={r.url} target="_blank" rel="noreferrer">view ↗</a>}</> : r.error}</p>)}</div>}
    </div>
  </div>;
}

export type PlanOptions = { days: number[]; perWeek: number; time1: string; time2: string; platforms: string[]; format: "photo" | "video" | "mix"; mode: "mixed" | "services" | "custom"; services: string[]; custom: string; rotate: boolean; extra: string; skipBusy: boolean };
const DAY_CHIPS: Array<[number, string]> = [[1, "Mon"], [2, "Tue"], [3, "Wed"], [4, "Thu"], [5, "Fri"], [6, "Sat"], [0, "Sun"]];

/** The dates a plan will use: chosen weekdays this month, from today, spread to the weekly frequency. */
export function planSlots(grid: Date[], month: Date, o: PlanOptions, busy: (d: Date) => boolean) {
  const today = new Date().setHours(0, 0, 0, 0);
  const pool = grid.filter((d) => d.getMonth() === month.getMonth() && o.days.includes(d.getDay()) && d.getTime() >= today && !(o.skipBusy && busy(d)));
  if (!o.perWeek) return pool.slice(0, 31);
  const weeks = new Map<string, Date[]>();
  for (const d of pool) { const m = new Date(d); m.setDate(m.getDate() - ((m.getDay() + 6) % 7)); const k = ymd(m); weeks.set(k, [...(weeks.get(k) || []), d]); }
  const out: Date[] = [];
  for (const list of weeks.values()) { const n = Math.min(o.perWeek, list.length); for (let i = 0; i < n; i++) out.push(list[Math.floor((i * list.length) / n)]); }
  return out.slice(0, 31);
}

function PlanModal({ clientId, month, onClose, onRun, preview }: { clientId: string; month: Date; onClose: () => void; onRun: (o: PlanOptions) => void; preview: (o: PlanOptions) => number }) {
  const [o, setO] = useState<PlanOptions>(() => { const base: PlanOptions = { days: [2, 4, 6], perWeek: 0, time1: "10:00", time2: "18:00", platforms: ["facebook", "instagram"], format: "photo", mode: "mixed", services: [], custom: "", rotate: false, extra: "", skipBusy: true }; try { const saved = JSON.parse(localStorage.getItem(`f2b-plan-${clientId}`) || "null"); return saved ? { ...base, ...saved, services: [] } : base; } catch { return base; } });
  const [options, setOptions] = useState<string[]>([]);
  const [adding, setAdding] = useState("");
  const set = (p: Partial<PlanOptions>) => setO((x) => ({ ...x, ...p }));
  // The client's own services: their booking calendars, plus the work types found on their website.
  useEffect(() => { let live = true; Promise.all([call<{ calendars?: Array<{ name: string }> }>(`/api/scheduling?clientId=${encodeURIComponent(clientId)}&view=links`).catch(() => ({ calendars: [] })), call<{ work?: Record<string, string[]> }>(`/api/scheduling?clientId=${encodeURIComponent(clientId)}&view=site`).catch(() => ({ work: {} }))]).then(([a, b]) => { if (!live) return; const names = [...new Set([...(a.calendars || []).map((c) => c.name), ...Object.keys(b.work || {})].map((x) => String(x).trim()).filter((x) => x && x.length < 60))]; setOptions(names); }).catch(() => undefined); return () => { live = false; }; }, [clientId]);
  const slots = preview(o);
  const themes = o.mode === "services" ? o.services : o.mode === "custom" ? o.custom.split("\n").map((x) => x.trim()).filter(Boolean) : [];
  const count = themes.length && !o.rotate ? Math.min(themes.length, slots) : o.mode === "mixed" ? slots : themes.length ? slots : 0;
  const run = () => { try { const { services: _s, custom: _c, ...keep } = o; void _s; void _c; localStorage.setItem(`f2b-plan-${clientId}`, JSON.stringify(keep)); } catch { /* ignore */ } onRun(o); };
  const addService = () => { const v = adding.trim(); if (!v) return; setOptions((x) => [...new Set([...x, v])]); set({ services: [...new Set([...o.services, v])] }); setAdding(""); };
  return <div className="sp-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="sp-editor sp-plan" role="dialog" aria-modal="true" aria-label="Draft this month's posts">
      <header><b>✨ Draft {month.toLocaleDateString("en-GB", { month: "long" })}’s posts</b><button type="button" className="sp-x" aria-label="Close" onClick={onClose}>×</button></header>
      <div className="sp-plan-body">
        <section><b className="sp-label">Which days</b><div className="sp-chips">{DAY_CHIPS.map(([d, l]) => { const on = o.days.includes(d); return <button key={d} type="button" className={on ? "on" : ""} aria-pressed={on} onClick={() => set({ days: on ? o.days.filter((x) => x !== d) : [...o.days, d] })}>{l}</button>; })}<button type="button" className="sp-chip-text" onClick={() => set({ days: [1, 2, 3, 4, 5] })}>Weekdays</button><button type="button" className="sp-chip-text" onClick={() => set({ days: [0, 1, 2, 3, 4, 5, 6] })}>Every day</button></div></section>
        <section className="sp-plan-row">
          <label>How often<select value={o.perWeek} onChange={(e) => set({ perWeek: Number(e.target.value) })}><option value={0}>Every chosen day</option>{[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n} post{n === 1 ? "" : "s"} a week</option>)}</select></label>
          <label>Time<input type="time" value={o.time1} onChange={(e) => set({ time1: e.target.value })} /></label>
          <label>Alternate with<input type="time" value={o.time2} onChange={(e) => set({ time2: e.target.value })} /><small>Leave empty for one time</small></label>
        </section>
        <section><b className="sp-label">Platforms</b><div className="sp-platforms">{PLATFORMS.map(([k, label, color]) => { const on = o.platforms.includes(k); return <button key={k} type="button" className={on ? "on" : ""} style={{ ["--pc" as string]: color }} aria-pressed={on} onClick={() => set({ platforms: on ? o.platforms.filter((x) => x !== k) : [...o.platforms, k] })}><PlatformIcon id={k} size={14} /> {label}</button>; })}</div></section>
        <section><b className="sp-label">Photos or videos</b><div className="sp-seg">{([["photo", "📷 Photos"], ["video", "🎬 Videos / Reels"], ["mix", "Mix of both"]] as const).map(([k, l]) => <button key={k} type="button" className={o.format === k ? "on" : ""} onClick={() => set({ format: k })}>{l}</button>)}</div>{o.format !== "photo" && <small className="sp-hint">Videos come from the Media Library (matched to the service where the file name fits). If there isn't one, the post gets a short filming plan so you can record it.</small>}</section>
        <section><b className="sp-label">What the posts are about</b><div className="sp-seg">{([["mixed", "AI mix (tips, work, reviews…)"], ["services", "One per service"], ["custom", "My own ideas"]] as const).map(([k, l]) => <button key={k} type="button" className={o.mode === k ? "on" : ""} onClick={() => set({ mode: k })}>{l}</button>)}</div>
          {o.mode === "services" && <div className="sp-services">{options.length ? options.map((sv) => { const on = o.services.includes(sv); return <label key={sv} className={on ? "on" : ""}><input type="checkbox" checked={on} onChange={() => set({ services: on ? o.services.filter((x) => x !== sv) : [...o.services, sv] })} />{sv}</label>; }) : <small className="sp-hint">No services found yet. Add them below.</small>}
            <div className="sp-add-svc"><input value={adding} placeholder="Add a service, e.g. Fine line tattoos" onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addService(); } }} /><button type="button" className="secondary-button" onClick={addService}>Add</button>{options.length > 0 && <button type="button" className="text-button" onClick={() => set({ services: o.services.length === options.length ? [] : options })}>{o.services.length === options.length ? "Clear" : "Select all"}</button>}</div></div>}
          {o.mode === "custom" && <textarea rows={5} value={o.custom} placeholder={"One post idea per line, e.g.\nMeet the team: Sarah\nBefore & after of a bathroom refit\nBlack Friday gift vouchers"} onChange={(e) => set({ custom: e.target.value })} />}
          {o.mode !== "mixed" && <label className="sp-check"><input type="checkbox" checked={o.rotate} onChange={(e) => set({ rotate: e.target.checked })} />Fill every free slot, rotating through them (otherwise one post each)</label>}
        </section>
        <section><label>Anything to mention? <small>(optional)</small><input value={o.extra} maxLength={400} placeholder="e.g. Christmas vouchers on sale, new artist joining, keep it fun" onChange={(e) => set({ extra: e.target.value })} /></label><label className="sp-check"><input type="checkbox" checked={o.skipBusy} onChange={(e) => set({ skipBusy: e.target.checked })} />Skip days that already have a post</label></section>
      </div>
      <footer><span className="sp-plan-count">{count ? <><b>{count}</b> post{count === 1 ? "" : "s"} will be drafted{themes.length > slots && !o.rotate ? ` (only ${slots} free slot${slots === 1 ? "" : "s"} for ${themes.length} ideas: add more days)` : ""}</> : o.mode === "mixed" ? "No free days with these settings" : o.mode === "services" ? "Pick at least one service" : "Add at least one idea"}</span><span style={{ flex: 1 }} /><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button type="button" className="primary-button" disabled={!count || !o.platforms.length} onClick={run}>Draft {count || ""} post{count === 1 ? "" : "s"}</button></footer>
    </div>
  </div>;
}
