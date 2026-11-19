"use client";
import { useEffect, useState } from "react";

// Dashboard → Google Business Profile: Google posts from the social calendar, with a preview of how each
// looks (image, text, date, status). Live posts read from Google need the Business Profile connection.
type Post = { id: string; postAt: string; platforms: string[]; caption: string; images: string[]; status: string };

export function GbpPosts({ clientId, businessName = "", onOpenCalendar }: { clientId: string; businessName?: string; onOpenCalendar?: () => void }) {
  const [posts, setPosts] = useState<Post[] | null>(null);
  useEffect(() => {
    let live = true;
    const q = new URLSearchParams({ clientId, from: new Date(Date.now() - 90 * 86_400_000).toISOString(), to: new Date(Date.now() + 45 * 86_400_000).toISOString() });
    fetch(`/api/social-posts?${q}`, { cache: "no-store" }).then((r) => r.ok ? r.json() : { posts: [] }).then((j: { posts?: Post[] }) => { if (live) setPosts((j.posts || []).filter((p) => p.platforms.includes("google")).sort((a, b) => b.postAt.localeCompare(a.postAt)).slice(0, 8)); }).catch(() => { if (live) setPosts([]); });
    return () => { live = false; };
  }, [clientId]);
  if (!posts) return null;
  const when = (s: string) => new Date(s).toLocaleDateString("en-IE", { day: "numeric", month: "short" });
  return <div className="gbpp">
    <style>{CSS}</style>
    <div className="gbpp-head"><b>Google posts</b><small>{posts.length ? "From the social calendar" : ""}</small>{onOpenCalendar && <button type="button" className="dh-golink" onClick={onOpenCalendar}>{posts.length ? "Open social calendar →" : "Plan a Google post →"}</button>}</div>
    {!posts.length ? <p className="dh-muted">No Google Business posts planned or published in the last 90 days.</p> : <div className="gbpp-row">
      {posts.map((p) => { const upcoming = Date.parse(p.postAt) > Date.now(); return <article key={p.id} className="gbpp-card">
        <div className="gbpp-top"><span className="gbpp-avatar">{(businessName || "B").slice(0, 1)}</span><span><b>{businessName || "Your business"}</b><small>{when(p.postAt)}</small></span><em className={`gbpp-status ${upcoming ? "next" : /publish|posted|live|done/i.test(p.status) ? "live" : ""}`}>{upcoming ? "Scheduled" : /publish|posted|live|done/i.test(p.status) ? "Posted" : p.status || "Draft"}</em></div>
        {p.images[0] ? <img src={p.images[0]} alt="" loading="lazy" /> : null}
        <p>{p.caption || "No text yet"}</p>
        <span className="gbpp-cta">Learn more</span>
      </article>; })}
    </div>}
  </div>;
}

const CSS = `
.gbpp{margin-top:12px;display:flex;flex-direction:column;gap:8px}
.gbpp-head{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}.gbpp-head b{font-size:14px}.gbpp-head small{font-size:12px;opacity:.6}.gbpp-head .dh-golink{margin-left:auto}
.gbpp-row{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(220px,260px);gap:10px;overflow-x:auto;padding-bottom:6px;scroll-snap-type:x mandatory}
.gbpp-card{scroll-snap-align:start;border:1px solid rgba(127,127,127,.18);border-radius:14px;background:var(--f2b-white,#fff);overflow:hidden;display:flex;flex-direction:column}
body.f2b-dark .gbpp-card,.dark-mode .gbpp-card{background:rgba(255,255,255,.04)}
.gbpp-top{display:flex;align-items:center;gap:8px;padding:10px 12px}
.gbpp-avatar{width:30px;height:30px;border-radius:999px;display:grid;place-items:center;background:#1a73e8;color:#fff;font-weight:800;font-size:13px;flex:none}
.gbpp-top span{display:flex;flex-direction:column;min-width:0}.gbpp-top b{font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.gbpp-top small{font-size:11.5px;opacity:.6}
.gbpp-status{margin-left:auto;font-style:normal;font-size:10.5px;font-weight:800;padding:2px 7px;border-radius:999px;background:#f1f5f9;color:#475569;white-space:nowrap}
.gbpp-status.live{background:#dcfce7;color:#166534}.gbpp-status.next{background:#e0f2fe;color:#075985}
.gbpp-card img{width:100%;aspect-ratio:4/3;object-fit:cover;display:block}
.gbpp-card p{margin:0;padding:10px 12px 4px;font-size:13px;line-height:1.45;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}
.gbpp-cta{margin:4px 12px 12px;font-size:13px;font-weight:700;color:#1a73e8}
`;
