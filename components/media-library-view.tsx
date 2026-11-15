"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import "./media-library.css";
import { readPhotoGeo } from "@/lib/media-library/exif";

type Client = { id: string; name: string; logo?: string; color?: string ; seoServices?: string[]; seoLocations?: string[]; services?: Array<{ name?: string; campaignName?: string }> };
type MediaItem = { id: string; scopeId: string; name: string; folder: string; kind: "image" | "video" | "document"; mime: string; size: number; width: number | null; height: number | null; url: string; source: string; sourceUrl: string; credit: string; alt: string; project?: Project; createdBy: string; createdAt: string };
type Project = { location?: string; service?: string; date?: string; notes?: string; lat?: number; lng?: number };
type Provider = { id: "unsplash" | "pexels" | "pixabay" | "openverse"; label: string; ready: boolean; signup: string };
type Status = { providers: Provider[]; drive: { available: boolean; connected: boolean; email: string }; clients: Array<{ id: string; name: string }>; canUseAgency: boolean; isAdmin: boolean };
type StockResult = { provider: Provider["id"]; id: string; thumb: string; preview: string; width: number; height: number; alt: string; credit: string; creditUrl: string; pageUrl: string };
type DriveFile = { id: string; name: string; mimeType: string; size?: string; thumbnailLink?: string; iconLink?: string };
type Upload = { id: string; name: string; progress: number; error?: string; done?: boolean };

const KINDS = [{ id: "", label: "All" }, { id: "image", label: "Images" }, { id: "video", label: "Videos" }, { id: "document", label: "PDFs" }] as const;
const formatSize = (bytes: number) => bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`;
const sourceLabel: Record<string, string> = { upload: "Uploaded", "google-drive": "Google Drive", unsplash: "Unsplash", pexels: "Pexels", pixabay: "Pixabay", openverse: "Openverse", link: "Imported link", ai: "AI generated" };
const driveMessages: Record<string, string> = { connected: "Google Drive connected. Pick files to add.", cancelled: "Google Drive connection was cancelled.", "admin-required": "Only an agency owner or admin can connect Google Drive.", "not-configured": "Google sign-in isn't set up on the server yet (the same Google app used for Google Ads/Calendar).", "refresh-token-missing": "Google didn't return long-term access. Remove the app at myaccount.google.com/permissions and connect again.", "scope-missing": "Drive access wasn't granted. Connect again and tick “See and download your Google Drive files”.", "oauth-failed": "Google Drive could not be connected. Make sure the Google Drive API is enabled for the Google Cloud project, then try again.", "sign-in-required": "Sign in before connecting Google Drive.", "workspace-unavailable": "The workspace couldn't be loaded. Try again." };

async function api<T>(input: string, init?: RequestInit) {
  const response = await fetch(input, { cache: "no-store", ...init });
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "Something went wrong — please try again.");
  return data;
}

async function imageSize(file: File) {
  if (!file.type.startsWith("image/") || typeof createImageBitmap !== "function") return null;
  try { const bitmap = await createImageBitmap(file); const size = { w: bitmap.width, h: bitmap.height }; bitmap.close(); return size; } catch { return null; }
}

function uploadFile(file: File, query: URLSearchParams, onProgress: (value: number) => void) {
  return new Promise<MediaItem>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `/api/media-library?${query}`);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100)); };
    xhr.onload = () => { let data: { item?: MediaItem; error?: string } = {}; try { data = JSON.parse(xhr.responseText); } catch { /* not JSON */ } if (xhr.status >= 200 && xhr.status < 300 && data.item) resolve(data.item); else reject(new Error(data.error || (xhr.status === 413 ? "Files must be 50 MB or smaller." : "Upload failed."))); };
    xhr.onerror = () => reject(new Error("Upload failed — check your connection."));
    xhr.send(file);
  });
}

export function MediaLibraryView({ scopeClientId = "", clients, active }: { scopeClientId?: string; clients: Client[]; active: boolean }) {
  const inSubAccount = Boolean(scopeClientId);
  const [status, setStatus] = useState<Status | null>(null);
  const [picker, setPicker] = useState("agency");
  const [items, setItems] = useState<MediaItem[]>([]);
  const [cursor, setCursor] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [kind, setKind] = useState("");
  const [search, setSearch] = useState("");
  const [folder, setFolder] = useState("");
  const [uploadFolder, setUploadFolder] = useState("");
  const [uploadProject, setUploadProject] = useState<Project>({});
  const [projectOpen, setProjectOpen] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [picks, setPicks] = useState<Set<string>>(new Set());
  const queueUpload = (files: FileList | File[]) => { const list = Array.from(files); if (list.length) { setPendingFiles((current) => [...current, ...list]); setUploadOpen(true); } };
  const closeUpload = () => { setUploadOpen(false); setPendingFiles([]); };
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [selected, setSelected] = useState<MediaItem | null>(null);
  const [panel, setPanel] = useState<"" | "stock" | "drive" | "link" | "mobile" | "ai">("");
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);

  const allowedClients = useMemo(() => {
    const ids = new Set((status?.clients || []).map((client) => client.id));
    return clients.filter((client) => !status || ids.has(client.id));
  }, [clients, status]);
  const listScope = inSubAccount ? scopeClientId : picker;
  const uploadScope = inSubAccount ? scopeClientId : picker !== "all" ? picker : status?.canUseAgency === false ? allowedClients[0]?.id || "" : "agency";
  // The client's own services, offered as one-tap choices for "Service / job" (also become the folder).
  const scopeServices = useMemo(() => {
    const client = clients.find((item) => item.id === uploadScope);
    if (!client) return [] as string[];
    const billed = (client.services || []).map((service) => String(service.campaignName || "").replace(/^.*?\|\s*/, "").trim()).filter(Boolean);
    return [...new Set([...(client.seoServices || []), ...billed].map((item) => item.trim()).filter((item) => item.length > 1))].slice(0, 24);
  }, [clients, uploadScope]);
  // Placeholders use this client's own area and services, so examples fit the account.
  const scopeHints = useMemo(() => {
    const client = clients.find((item) => item.id === uploadScope);
    const area = (client?.seoLocations || [])[0] || "";
    return { location: area ? `e.g. ${area}` : "e.g. town or area of the job", service: scopeServices[0] ? `e.g. ${scopeServices[0]}` : "e.g. the job or service shown", notes: "e.g. before / after, what was done, customer feedback" };
  }, [clients, uploadScope, scopeServices]);
  const scopeName = (id: string) => id === "agency" || id === "" ? "Agency library" : clients.find((client) => client.id === id)?.name || "Client";
  const uploadScopeName = scopeName(uploadScope);

  const flash = (message: string) => { setNotice(message); window.setTimeout(() => setNotice((current) => current === message ? "" : current), 4000); };

  useEffect(() => {
    if (!active || status) return;
    api<Status>("/api/media-library?status=1").then((data) => { setStatus(data); if (!data.canUseAgency && !inSubAccount) setPicker(data.clients[0]?.id || "agency"); }).catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load the Media Library."));
  }, [active, status, inSubAccount]);

  // Arriving from the phone link or the Drive sign-in.
  useEffect(() => {
    if (!active) return;
    const params = new URLSearchParams(window.location.search);
    const drive = params.get("driveConnection");
    const upload = params.has("upload");
    if (!drive && !upload) return;
    params.delete("driveConnection"); params.delete("upload"); params.delete("page"); params.delete("client");
    const query = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
    if (drive) { if (drive === "connected") { flash(driveMessages.connected); setStatus(null); setPanel("drive"); } else setError(driveMessages[drive] || "Google Drive could not be connected."); }
  }, [active]);

  const load = useCallback(async (append = false, from = "") => {
    if (!listScope) return;
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams({ scope: listScope });
      if (kind) params.set("kind", kind);
      if (append && from) params.set("cursor", from);
      const data = await api<{ items: MediaItem[]; nextCursor: string }>(`/api/media-library?${params}`);
      setItems((current) => append ? [...current, ...data.items.filter((item) => !current.some((existing) => existing.id === item.id))] : data.items);
      setCursor(data.nextCursor);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load media."); }
    finally { setLoading(false); }
  }, [listScope, kind]);

  useEffect(() => { if (active && status) void load(); }, [active, status, load]);
  useEffect(() => { setSelected(null); setFolder(""); }, [listScope]);

  const folders = useMemo(() => [...new Set(items.map((item) => item.folder).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [items]);
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return items.filter((item) => (!folder || item.folder === folder) && (!term || [item.name, item.folder, item.alt, item.credit, item.project?.location || "", item.project?.service || "", item.project?.notes || ""].some((value) => value.toLowerCase().includes(term))));
  }, [items, folder, search]);

  const addItem = (item: MediaItem) => {
    const matches = listScope === "all" || (listScope === "agency" ? item.scopeId === "" : item.scopeId === listScope);
    if (matches && (!kind || item.kind === kind)) setItems((current) => [item, ...current.filter((existing) => existing.id !== item.id)]);
  };

  const uploadFiles = async (files: FileList | File[], projectOverride?: Project) => {
    const baseProject = projectOverride ?? uploadProject;
    const list = Array.from(files);
    if (!list.length) return;
    if (!uploadScope) { setError("Choose a client library to upload into."); return; }
    for (const file of list) {
      const id = crypto.randomUUID();
      setUploads((current) => [...current, { id, name: file.name, progress: 0 }]);
      if (file.size > 50_000_000) { setUploads((current) => current.map((entry) => entry.id === id ? { ...entry, error: "Over 50 MB" } : entry)); continue; }
      try {
        const size = await imageSize(file);
        const query = new URLSearchParams({ scope: uploadScope, name: file.name || "Photo" });
        const folderName = (uploadFolder === "__new__" ? "" : uploadFolder.trim()) || String(baseProject.service || "").trim();
        if (folderName) query.set("folder", folderName.slice(0, 60));
        if (size) { query.set("w", String(size.w)); query.set("h", String(size.h)); }
        // Project details for local SEO: what was typed above, plus GPS and date from the photo itself when present.
        const geo = await readPhotoGeo(file);
        const project = { ...baseProject, ...(geo.lat != null ? { lat: geo.lat, lng: geo.lng } : {}), date: baseProject.date || geo.takenAt || "" };
        if (Object.values(project).some((value) => value !== "" && value != null)) query.set("project", JSON.stringify(project));
        const item = await uploadFile(file, query, (progress) => setUploads((current) => current.map((entry) => entry.id === id ? { ...entry, progress } : entry)));
        addItem(item);
        setUploads((current) => current.map((entry) => entry.id === id ? { ...entry, progress: 100, done: true } : entry));
      } catch (reason) {
        setUploads((current) => current.map((entry) => entry.id === id ? { ...entry, error: reason instanceof Error ? reason.message : "Upload failed" } : entry));
      }
    }
    window.setTimeout(() => setUploads((current) => current.filter((entry) => !entry.done)), 2500);
  };

  const onDrop = (event: DragEvent) => { event.preventDefault(); setDragOver(false); if (event.dataTransfer.files?.length) queueUpload(event.dataTransfer.files); };

  const copy = async (text: string, label = "Link copied") => { try { await navigator.clipboard.writeText(text); flash(label); } catch { window.prompt("Copy this link:", text); } };
  const absolute = (path: string) => `${window.location.origin}${path}`;

  const saveItem = async (patch: Partial<Pick<MediaItem, "name" | "folder" | "alt" | "project">> & { scope?: string }) => {
    if (!selected) return;
    try {
      const data = await api<{ item: MediaItem | null }>("/api/media-library", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "update", id: selected.id, ...patch }) });
      if (!data.item) return;
      const moved = patch.scope !== undefined && listScope !== "all";
      setItems((current) => moved ? current.filter((item) => item.id !== data.item!.id) : current.map((item) => item.id === data.item!.id ? data.item! : item));
      setSelected(moved ? null : data.item);
      flash(moved ? `Moved to ${scopeName(patch.scope || "agency")}` : "Saved");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save."); }
  };

  const deleteItem = async (item: MediaItem) => {
    if (!window.confirm(`Delete “${item.name}”? Its public link will stop working on any website or ad that uses it.`)) return;
    try {
      await api("/api/media-library", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete", ids: [item.id] }) });
      setItems((current) => current.filter((entry) => entry.id !== item.id)); setSelected(null); flash("Deleted");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not delete."); }
  };

  const deletePicked = async () => {
    const ids = [...picks];
    if (!ids.length || !window.confirm(`Delete ${ids.length} file${ids.length === 1 ? "" : "s"}? Their public links will stop working on any website or ad that uses them.`)) return;
    try {
      for (let i = 0; i < ids.length; i += 100) await api("/api/media-library", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete", ids: ids.slice(i, i + 100) }) });
      setItems((current) => current.filter((entry) => !picks.has(entry.id))); setPicks(new Set()); flash(`Deleted ${ids.length}`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not delete."); }
  };

  if (!active) return null;

  return (
    <section className="ml-root" aria-labelledby="ml-title" onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); setDragOver(true); } }} onDragLeave={(event) => { if (event.currentTarget === event.target) setDragOver(false); }} onDrop={onDrop}>
      <header className="ml-heading">
        <div>
          <span className="eyebrow">MARKETING · MEDIA LIBRARY</span>
          <h1 id="ml-title">Media Library</h1>
          <p>{inSubAccount ? `Photos, videos and PDFs for ${scopeName(scopeClientId)}.` : "Every client's photos, videos and PDFs in one place. Pick a client to see only their files."}</p>
        </div>
        {!inSubAccount && (
          <label className="ml-scope">
            <span>Showing</span>
            <select value={picker} onChange={(event) => setPicker(event.target.value)} aria-label="Choose which client's media to show">
              {status?.canUseAgency !== false && <option value="agency">🏠 Agency library</option>}
              {status?.isAdmin && <option value="all">🗂 All clients</option>}
              {allowedClients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
            </select>
          </label>
        )}
      </header>

      <div className="ml-actions">
        <button type="button" className="primary-button" onClick={() => setUploadOpen(true)} disabled={!uploadScope}>⬆ Upload</button>
        <button type="button" className="secondary-button ml-camera" onClick={() => cameraInput.current?.click()} disabled={!uploadScope}>📷 Take photo</button>
        <button type="button" className="secondary-button" onClick={() => setPanel("drive")}>🟢 Google Drive</button>
        <button type="button" className="secondary-button" onClick={() => setPanel("ai")} disabled={!uploadScope}>✨ AI generate</button>
        <button type="button" className="secondary-button" onClick={() => setPanel("link")}>🔗 Import link</button>
        <button type="button" className="secondary-button" onClick={() => setPanel("mobile")}>📱 Mobile link</button>
        <input ref={fileInput} type="file" hidden multiple accept="image/*,video/mp4,video/quicktime,video/webm,application/pdf" onChange={(event) => { const files = event.currentTarget.files; if (files) queueUpload(files); event.currentTarget.value = ""; }} />
        <input ref={cameraInput} type="file" hidden accept="image/*,video/*" capture="environment" onChange={(event) => { const files = event.currentTarget.files; if (files) queueUpload(files); event.currentTarget.value = ""; }} />
      </div>
      <p className="ml-target">New files go to <b>{uploadScopeName}</b>{" "}
        <label className="ml-folder-input">· folder <input value={uploadFolder} onChange={(event) => setUploadFolder(event.target.value)} placeholder="optional, e.g. Job photos" maxLength={60} list="ml-folders" /></label>
        <datalist id="ml-folders">{[...new Set([...folders, ...scopeServices])].map((name) => <option key={name} value={name} />)}</datalist>
        <button type="button" className="text-button ml-project-toggle" onClick={() => setProjectOpen(!projectOpen)}>{projectOpen ? "Hide project details" : `📍 Project details${uploadProject.location || uploadProject.service ? ` · ${[uploadProject.service, uploadProject.location].filter(Boolean).join(", ")}` : ""}`}</button>
      </p>
      {projectOpen && <div className="ml-project-form"><p className="ml-hint">Added to every file you upload now. Used for local SEO: where the job was, what it was, and when. Phone photos also add their GPS location automatically.</p>
        <label className="field"><span>Location</span><input value={uploadProject.location || ""} onChange={(event) => setUploadProject({ ...uploadProject, location: event.target.value })} placeholder={scopeHints.location} maxLength={160} /></label>
        <label className="field"><span>Service / job</span><input value={uploadProject.service || ""} onChange={(event) => setUploadProject({ ...uploadProject, service: event.target.value })} placeholder={scopeHints.service} maxLength={120} /></label>
        <label className="field"><span>Date of job</span><input type="date" value={uploadProject.date || ""} onChange={(event) => setUploadProject({ ...uploadProject, date: event.target.value })} /></label>
        <label className="field ml-project-notes"><span>Notes</span><input value={uploadProject.notes || ""} onChange={(event) => setUploadProject({ ...uploadProject, notes: event.target.value })} placeholder={scopeHints.notes} maxLength={600} /></label>
        {(uploadProject.location || uploadProject.service || uploadProject.date || uploadProject.notes) && <button type="button" className="text-button" onClick={() => setUploadProject({})}>Clear</button>}
      </div>}

      {uploads.length > 0 && <ul className="ml-uploads" aria-live="polite">{uploads.map((entry) => <li key={entry.id} className={entry.error ? "is-error" : entry.done ? "is-done" : ""}><span>{entry.name}</span>{entry.error ? <small>{entry.error} <button type="button" className="text-button" onClick={() => setUploads((current) => current.filter((item) => item.id !== entry.id))}>Dismiss</button></small> : <i style={{ width: `${entry.progress}%` }} />}</li>)}</ul>}
      {error && <p className="form-error ml-error" role="alert">{error} <button type="button" className="text-button" onClick={() => setError("")}>Dismiss</button></p>}
      {notice && <p className="ml-notice" role="status">{notice}</p>}

      <div className="ml-filters">
        <div className="ml-kinds" role="tablist" aria-label="File type">{KINDS.map((entry) => <button type="button" role="tab" key={entry.id} aria-selected={kind === entry.id} className={kind === entry.id ? "active" : ""} onClick={() => setKind(entry.id)}>{entry.label}</button>)}</div>
        <input className="ml-search" type="search" placeholder="Search names, folders, alt text…" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search media" />
      </div>
      {folders.length > 0 && <div className="ml-folders">{["", ...folders].map((name) => <button type="button" key={name || "all"} className={folder === name ? "active" : ""} onClick={() => setFolder(name)}>{name ? `📁 ${name}` : "All folders"}</button>)}</div>}

      {visible.length > 0 && <div className={`ml-bulk${picks.size ? " has-picks" : ""}`} role="toolbar" aria-label="Bulk actions">
        <label className="ml-bulk-all"><input type="checkbox" checked={visible.length > 0 && visible.every((item) => picks.has(item.id))} onChange={(event) => setPicks(event.target.checked ? new Set(visible.map((item) => item.id)) : new Set())} /> {picks.size ? `${picks.size} selected` : "Select all"}</label>
        {picks.size > 0 && <><button type="button" className="secondary-button ml-danger" onClick={() => void deletePicked()}>🗑 Delete {picks.size}</button><button type="button" className="text-button" onClick={() => setPicks(new Set())}>Clear</button></>}
      </div>}
      <div className={`ml-grid${dragOver ? " is-drag" : ""}`}>
        {dragOver && <div className="ml-drop">Drop files to add them to {uploadScopeName}</div>}
        {visible.map((item) => (
          <div key={item.id} className={`ml-card-wrap${picks.has(item.id) ? " is-picked" : ""}`}>
          <label className="ml-pick" title="Select"><input type="checkbox" checked={picks.has(item.id)} onChange={(event) => setPicks((current) => { const next = new Set(current); if (event.target.checked) next.add(item.id); else next.delete(item.id); return next; })} aria-label={`Select ${item.name}`} /></label>
          <button type="button" className="ml-card" onClick={() => picks.size ? setPicks((current) => { const next = new Set(current); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; }) : setSelected(item)} aria-label={`Open ${item.name}`}>
            <span className="ml-thumb">
              {item.kind === "image" ? <img src={item.url} alt={item.alt || item.name} loading="lazy" /> : item.kind === "video" ? <><video src={`${item.url}#t=0.5`} preload="metadata" muted playsInline /><em>▶</em></> : <span className="ml-doc">PDF</span>}
            </span>
            <span className="ml-card-meta"><b>{item.name}</b><small>{listScope === "all" ? `${scopeName(item.scopeId)} · ` : ""}{formatSize(item.size)}{item.folder ? ` · ${item.folder}` : ""}</small>{(item.project?.location || item.project?.lat != null) && <small className="ml-card-geo">📍 {item.project?.location || "GPS from photo"}{item.project?.service ? ` · ${item.project.service}` : ""}</small>}</span>
          </button>
          </div>
        ))}
        {!loading && visible.length === 0 && (
          <div className="ml-empty">
            <b>{items.length ? "Nothing matches those filters." : `No media in ${scopeName(listScope)} yet.`}</b>
            <p>Drag files here, upload from your phone with the 📱 mobile link, or pull them in from Google Drive and stock photo libraries.</p>
          </div>
        )}
      </div>
      {loading && <p className="ml-loading" role="status">Loading media…</p>}
      {cursor && !loading && <button type="button" className="secondary-button ml-more" onClick={() => void load(true, cursor)}>Load more</button>}

      {selected && <DetailPanel item={selected} canMove={!inSubAccount} scopes={[...(status?.canUseAgency !== false ? [{ id: "agency", name: "Agency library" }] : []), ...allowedClients.map((client) => ({ id: client.id, name: client.name }))]} scopeName={scopeName} onClose={() => setSelected(null)} onSave={saveItem} onDelete={deleteItem} onCopy={(text, label) => void copy(text, label)} absolute={absolute} />}
      {panel === "stock" && status && <StockPanel providers={status.providers} isAdmin={status.isAdmin} target={uploadScope} targetName={uploadScopeName} folder={uploadFolder} onClose={() => setPanel("")} onAdded={(item) => { addItem(item); flash(`Added to ${uploadScopeName}`); }} onKeysChanged={() => setStatus(null)} />}
      {panel === "drive" && status && <DrivePanel drive={status.drive} isAdmin={status.isAdmin} target={uploadScope} targetName={uploadScopeName} folder={uploadFolder} onClose={() => setPanel("")} onAdded={(item) => { addItem(item); flash(`Added to ${uploadScopeName}`); }} />}
      {uploadOpen && <Modal title={`Upload to ${uploadScopeName}`} onClose={closeUpload}>
        <div className="ml-upload-details">
          <p className="ml-hint">📍 Project details for local SEO. Saved with every file in this upload. Phone photos add their GPS location and date automatically.</p>
          <label className="field"><span>Location</span><input autoFocus value={uploadProject.location || ""} onChange={(event) => setUploadProject({ ...uploadProject, location: event.target.value })} placeholder={scopeHints.location} maxLength={160} /></label>
          <label className="field"><span>Service / job</span><input value={uploadProject.service || ""} onChange={(event) => setUploadProject({ ...uploadProject, service: event.target.value })} placeholder={scopeHints.service} maxLength={120} list="ml-services" /></label>
          {scopeServices.length > 0 && <div className="ml-service-chips" role="group" aria-label="Choose a service">{scopeServices.map((service) => <button type="button" key={service} className={uploadProject.service === service ? "active" : ""} onClick={() => setUploadProject({ ...uploadProject, service: uploadProject.service === service ? "" : service })}>{service}</button>)}</div>}
          <datalist id="ml-services">{scopeServices.map((service) => <option key={service} value={service} />)}</datalist>
          <div className="ml-upload-row"><label className="field"><span>Date of job</span><input type="date" value={uploadProject.date || ""} onChange={(event) => setUploadProject({ ...uploadProject, date: event.target.value })} /></label><label className="field"><span>Folder</span>{(() => { const options = [...new Set([...folders, ...scopeServices])].sort((x, y) => x.localeCompare(y)); const custom = uploadFolder !== "" && !options.includes(uploadFolder); return custom || uploadFolder === "__new__" ? <span className="ml-folder-new"><input autoFocus value={uploadFolder === "__new__" ? "" : uploadFolder} onChange={(event) => setUploadFolder(event.target.value)} placeholder="New folder name" maxLength={60} /><button type="button" className="text-button" onClick={() => setUploadFolder("")}>✕</button></span> : <select value={uploadFolder} onChange={(event) => setUploadFolder(event.target.value)}><option value="">{uploadProject.service ? `${uploadProject.service} (same as service)` : "Same as service"}</option>{options.map((name) => <option key={name} value={name}>{folders.includes(name) ? `📁 ${name}` : name}</option>)}<option value="__new__">＋ New folder…</option></select>; })()}</label></div>
          <label className="field"><span>Notes</span><input value={uploadProject.notes || ""} onChange={(event) => setUploadProject({ ...uploadProject, notes: event.target.value })} placeholder={scopeHints.notes} maxLength={600} /></label>
          <div className="ml-upload-drop" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); if (event.dataTransfer.files?.length) setPendingFiles((current) => [...current, ...Array.from(event.dataTransfer.files)]); }}>
            {pendingFiles.length ? <ul className="ml-upload-files">{pendingFiles.slice(0, 8).map((file, index) => <li key={`${file.name}-${file.size}-${index}`}>{file.name}<button type="button" className="text-button" aria-label={`Remove ${file.name}`} onClick={() => setPendingFiles((current) => current.filter((_, i) => i !== index))}>✕</button></li>)}{pendingFiles.length > 8 && <li>+ {pendingFiles.length - 8} more</li>}</ul> : <p>Drop photos, videos or PDFs here</p>}
            <div className="ml-upload-pick"><button type="button" className="secondary-button" onClick={() => fileInput.current?.click()}>{pendingFiles.length ? "＋ Add more files" : "Choose files"}</button><button type="button" className="secondary-button ml-camera" onClick={() => cameraInput.current?.click()}>📷 Take photo</button></div>
          </div>
          <div className="ml-detail-actions"><button type="button" className="secondary-button" onClick={closeUpload}>Cancel</button><button type="button" className="primary-button" disabled={!pendingFiles.length} onClick={() => { const files = pendingFiles; closeUpload(); void uploadFiles(files); }}>{pendingFiles.length ? `Upload ${pendingFiles.length} file${pendingFiles.length === 1 ? "" : "s"}` : "Upload"}</button></div>
        </div>
      </Modal>}
      {panel === "ai" && <AiPanel target={uploadScope} targetName={uploadScopeName} folder={uploadFolder} project={uploadProject} onClose={() => setPanel("")} onAdded={(item) => { addItem(item); flash(`Added to ${uploadScopeName}`); setPanel(""); setSelected(item); }} />}
      {panel === "link" && <LinkPanel target={uploadScope} targetName={uploadScopeName} folder={uploadFolder} onClose={() => setPanel("")} onAdded={(item) => { addItem(item); flash(`Added to ${uploadScopeName}`); setPanel(""); }} />}
      {panel === "mobile" && <MobilePanel clientId={inSubAccount ? scopeClientId : picker !== "all" && picker !== "agency" ? picker : ""} clientName={inSubAccount ? scopeName(scopeClientId) : picker !== "all" && picker !== "agency" ? scopeName(picker) : ""} onClose={() => setPanel("")} onCopy={(text) => void copy(text)} />}
    </section>
  );
}

function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => { const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, [onClose]);
  return <div className="ml-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className={`ml-modal${wide ? " is-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}><header><h2>{title}</h2><button type="button" className="ml-close" onClick={onClose} aria-label="Close">✕</button></header><div className="ml-modal-body">{children}</div></div></div>;
}

function DetailPanel({ item, canMove, scopes, scopeName, onClose, onSave, onDelete, onCopy, absolute }: { item: MediaItem; canMove: boolean; scopes: Array<{ id: string; name: string }>; scopeName: (id: string) => string; onClose: () => void; onSave: (patch: { name?: string; folder?: string; alt?: string; scope?: string; project?: Project }) => void; onDelete: (item: MediaItem) => void; onCopy: (text: string, label?: string) => void; absolute: (path: string) => string }) {
  const [name, setName] = useState(item.name);
  const [folder, setFolder] = useState(item.folder);
  const [alt, setAlt] = useState(item.alt);
  const [project, setProject] = useState<Project>(item.project || {});
  useEffect(() => { setName(item.name); setFolder(item.folder); setAlt(item.alt); setProject(item.project || {}); }, [item]);
  const link = absolute(item.url);
  const dirty = name !== item.name || folder !== item.folder || alt !== item.alt || JSON.stringify(project) !== JSON.stringify(item.project || {});
  return (
    <Modal title={item.name} onClose={onClose} wide>
      <div className="ml-detail">
        <div className="ml-preview">{item.kind === "image" ? <img src={item.url} alt={item.alt || item.name} /> : item.kind === "video" ? <video src={item.url} controls playsInline /> : <iframe src={item.url} title={item.name} />}</div>
        <div className="ml-detail-side">
          <label className="field"><span>Name</span><input value={name} onChange={(event) => setName(event.target.value)} maxLength={140} /></label>
          <label className="field"><span>Folder</span><input value={folder} onChange={(event) => setFolder(event.target.value)} maxLength={60} placeholder="e.g. Job photos" /></label>
          {item.kind === "image" && <label className="field"><span>Alt text (for SEO)</span><input value={alt} onChange={(event) => setAlt(event.target.value)} maxLength={300} placeholder="Describe the image" /></label>}
          <fieldset className="ml-project-fields"><legend>📍 Project details (local SEO)</legend>
            <label className="field"><span>Location</span><input value={project.location || ""} onChange={(event) => setProject({ ...project, location: event.target.value })} placeholder="Town or area of the job" maxLength={160} /></label>
            <label className="field"><span>Service / job</span><input value={project.service || ""} onChange={(event) => setProject({ ...project, service: event.target.value })} placeholder="The job or service shown" maxLength={120} /></label>
            <label className="field"><span>Date of job</span><input type="date" value={project.date || ""} onChange={(event) => setProject({ ...project, date: event.target.value })} /></label>
            <label className="field"><span>Notes</span><input value={project.notes || ""} onChange={(event) => setProject({ ...project, notes: event.target.value })} placeholder="Before / after, materials, details" maxLength={600} /></label>
            {project.lat != null && project.lng != null ? <p className="ml-hint">GPS from photo: <a href={`https://www.google.com/maps?q=${project.lat},${project.lng}`} target="_blank" rel="noreferrer">{project.lat}, {project.lng}</a> <button type="button" className="text-button" onClick={() => { const next = { ...project }; delete next.lat; delete next.lng; setProject(next); }}>Remove</button></p> : <p className="ml-hint">No GPS in this file. Phone photos usually include it.</p>}
          </fieldset>
          {dirty && <button type="button" className="primary-button" onClick={() => onSave({ name, folder: folder.trim() || String(project.service || "").trim().slice(0, 60), alt, project })}>Save changes</button>}
          {canMove && <label className="field"><span>Client library</span><select value={item.scopeId || "agency"} onChange={(event) => onSave({ scope: event.target.value })}>{scopes.map((scope) => <option key={scope.id} value={scope.id}>{scope.name}</option>)}</select></label>}
          <dl className="ml-facts">
            <div><dt>Library</dt><dd>{scopeName(item.scopeId)}</dd></div>
            <div><dt>Size</dt><dd>{formatSize(item.size)}{item.width && item.height ? ` · ${item.width}×${item.height}` : ""}</dd></div>
            <div><dt>Source</dt><dd>{item.sourceUrl ? <a href={item.sourceUrl} target="_blank" rel="noreferrer">{sourceLabel[item.source] || item.source}</a> : sourceLabel[item.source] || item.source}</dd></div>
            {item.credit && <div><dt>Credit</dt><dd>{item.credit}</dd></div>}
            <div><dt>Added</dt><dd>{new Date(item.createdAt).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric" })}{item.createdBy ? ` · ${item.createdBy}` : ""}</dd></div>
          </dl>
          <div className="ml-detail-actions">
            <button type="button" className="secondary-button" onClick={() => onCopy(link)}>🔗 Copy link</button>
            {item.credit && <button type="button" className="secondary-button" onClick={() => onCopy(item.credit, "Credit copied")}>© Copy credit</button>}
            <a className="secondary-button" href={`${item.url}&download=1&name=${encodeURIComponent(`${item.name}.${item.mime.split("/")[1]?.replace("jpeg", "jpg").replace("quicktime", "mov") || "file"}`)}`}>⤓ Download</a>
            <a className="secondary-button" href={item.url} target="_blank" rel="noreferrer">↗ Open</a>
            <button type="button" className="secondary-button ml-danger" onClick={() => onDelete(item)}>🗑 Delete</button>
          </div>
          <small className="ml-hint">The link is public but unguessable — paste it into websites, ads or emails. Deleting the file stops the link working.</small>
        </div>
      </div>
    </Modal>
  );
}

function StockPanel({ providers, isAdmin, target, targetName, folder, onClose, onAdded, onKeysChanged }: { providers: Provider[]; isAdmin: boolean; target: string; targetName: string; folder: string; onClose: () => void; onAdded: (item: MediaItem) => void; onKeysChanged: () => void }) {
  const [provider, setProvider] = useState<Provider["id"]>(providers.find((item) => item.ready && item.id !== "openverse")?.id || "openverse");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StockResult[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState<Record<string, "busy" | "done">>({});
  const [error, setError] = useState("");
  const [keyDraft, setKeyDraft] = useState("");
  const current = providers.find((item) => item.id === provider);

  const run = async (nextPage = 1) => {
    if (!query.trim()) return;
    setBusy(true); setError("");
    try {
      const data = await api<{ results: StockResult[]; total: number; needsKey?: boolean }>(`/api/media-library?stock=${provider}&q=${encodeURIComponent(query.trim())}&page=${nextPage}`);
      if (data.needsKey) { setError(`Add a ${current?.label} key to search it.`); return; }
      setResults((existing) => nextPage === 1 ? data.results : [...existing, ...data.results]); setTotal(data.total); setPage(nextPage);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Search failed."); }
    finally { setBusy(false); }
  };
  useEffect(() => { setResults([]); setTotal(0); setPage(1); if (query.trim() && current?.ready) void run(1); }, [provider]); // eslint-disable-line react-hooks/exhaustive-deps

  const add = async (photo: StockResult) => {
    const key = `${photo.provider}:${photo.id}`;
    setAdding((state) => ({ ...state, [key]: "busy" }));
    try {
      const data = await api<{ item: MediaItem }>("/api/media-library", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "importStock", provider: photo.provider, id: photo.id, scope: target, folder }) });
      onAdded(data.item); setAdding((state) => ({ ...state, [key]: "done" }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not add that photo."); setAdding((state) => { const next = { ...state }; delete next[key]; return next; }); }
  };

  const saveKey = async () => {
    if (!current) return;
    setBusy(true); setError("");
    try {
      await api("/api/settings/custom-api-keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label: current.label, note: "Media Library stock photos", apiKey: keyDraft.trim() }) });
      setKeyDraft(""); onKeysChanged();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save the key."); }
    finally { setBusy(false); }
  };

  return (
    <Modal title="Stock photos" onClose={onClose} wide>
      <div className="ml-tabs" role="tablist">{providers.map((item) => <button type="button" role="tab" key={item.id} aria-selected={provider === item.id} className={provider === item.id ? "active" : ""} onClick={() => setProvider(item.id)}>{item.label}{!item.ready && <small> · add key</small>}</button>)}</div>
      {current && !current.ready ? (
        <div className="ml-connect">
          <p><b>Connect {current.label}</b> — it's free. Create an app at <a href={current.signup} target="_blank" rel="noreferrer">{current.signup.replace(/^https:\/\//, "")}</a>, copy its {current.id === "unsplash" ? "Access Key" : "API key"} and paste it here. It's stored encrypted (Settings → API keys).</p>
          {isAdmin ? <div className="ml-inline"><input value={keyDraft} onChange={(event) => setKeyDraft(event.target.value)} placeholder={`${current.label} key`} aria-label={`${current.label} API key`} /><button type="button" className="primary-button" disabled={busy || keyDraft.trim().length < 8} onClick={() => void saveKey()}>Save key</button></div> : <p className="ml-hint">Ask an agency admin to add the key.</p>}
          <p className="ml-hint">Openverse works straight away with no key (Creative Commons images — check each credit).</p>
          {error && <p className="form-error">{error}</p>}
        </div>
      ) : (
        <>
          <form className="ml-inline" onSubmit={(event) => { event.preventDefault(); void run(1); }}><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${current?.label}… e.g. roofer, kitchen, Galway`} autoFocus aria-label="Search stock photos" /><button type="submit" className="primary-button" disabled={busy || !query.trim()}>{busy ? "Searching…" : "Search"}</button></form>
          <p className="ml-hint">Click a photo to add it to <b>{targetName}</b>. The photographer credit is saved with it.</p>
          {error && <p className="form-error">{error}</p>}
          <div className="ml-stock-grid">{results.map((photo) => { const key = `${photo.provider}:${photo.id}`; const state = adding[key]; return <button type="button" key={key} className={`ml-stock${state ? ` is-${state}` : ""}`} disabled={Boolean(state) || !target} onClick={() => void add(photo)} title={photo.credit}><img src={photo.thumb} alt={photo.alt} loading="lazy" /><span>{state === "done" ? "✓ Added" : state === "busy" ? "Adding…" : "+ Add"}</span><small>{photo.credit}</small></button>; })}</div>
          {results.length > 0 && results.length < total && <button type="button" className="secondary-button ml-more" disabled={busy} onClick={() => void run(page + 1)}>More results</button>}
        </>
      )}
    </Modal>
  );
}

function DrivePanel({ drive, isAdmin, target, targetName, folder, onClose, onAdded }: { drive: Status["drive"]; isAdmin: boolean; target: string; targetName: string; folder: string; onClose: () => void; onAdded: (item: MediaItem) => void }) {
  const [trail, setTrail] = useState<Array<{ id: string; name: string }>>([{ id: "root", name: "My Drive" }]);
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [next, setNext] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState<Record<string, "busy" | "done">>({});
  const [link, setLink] = useState("");
  const folderId = trail[trail.length - 1].id;

  const list = useCallback(async (pageToken = "", search = "") => {
    if (!drive.connected) return;
    setBusy(true); setError("");
    try {
      const params = new URLSearchParams({ drive: "1", folder: folderId }); if (search) params.set("q", search); if (pageToken) params.set("pageToken", pageToken);
      const data = await api<{ files: DriveFile[]; nextPageToken: string }>(`/api/media-library?${params}`);
      setFiles((current) => pageToken ? [...current, ...data.files] : data.files); setNext(data.nextPageToken);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Google Drive could not be listed."); }
    finally { setBusy(false); }
  }, [drive.connected, folderId]);
  useEffect(() => { void list(); }, [list]);

  const importFile = async (payload: { fileId?: string; link?: string; name?: string }, key: string) => {
    setAdding((state) => ({ ...state, [key]: "busy" })); setError("");
    try {
      const data = await api<{ item: MediaItem }>("/api/media-library", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "importDrive", scope: target, folder, ...payload }) });
      onAdded(data.item); setAdding((state) => ({ ...state, [key]: "done" }));
      return true;
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not add that file."); setAdding((state) => { const copy = { ...state }; delete copy[key]; return copy; }); return false; }
  };

  return (
    <Modal title="Google Drive" onClose={onClose} wide>
      {!drive.connected ? (
        <div className="ml-connect">
          <p><b>Connect Google Drive</b> to browse your folders and pull photos straight into {targetName}.</p>
          {isAdmin ? (drive.available ? <a className="primary-button" href="/api/media-library/drive">Connect Google Drive</a> : <p className="ml-hint">Google sign-in isn't configured on the server yet.</p>) : <p className="ml-hint">Ask an agency admin to connect Google Drive.</p>}
        </div>
      ) : (
        <>
          <p className="ml-hint">Connected as <b>{drive.email || "your Google account"}</b> · <a href="/api/media-library/drive">Reconnect</a> · Click a file to add it to <b>{targetName}</b>.</p>
          <form className="ml-inline" onSubmit={(event) => { event.preventDefault(); void list("", query.trim()); }}><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Drive by file name" aria-label="Search Google Drive" /><button type="submit" className="secondary-button" disabled={busy}>Search</button></form>
          <nav className="ml-trail" aria-label="Drive folders">{trail.map((crumb, index) => <button type="button" key={crumb.id} onClick={() => { setQuery(""); setTrail(trail.slice(0, index + 1)); }}>{crumb.name}</button>)}</nav>
          {error && <p className="form-error">{error}</p>}
          <div className="ml-drive-grid">
            {files.map((file) => {
              const isFolder = file.mimeType === "application/vnd.google-apps.folder"; const state = adding[file.id];
              return <button type="button" key={file.id} className={`ml-drive${isFolder ? " is-folder" : ""}${state ? ` is-${state}` : ""}`} disabled={Boolean(state) || (!isFolder && !target)} onClick={() => isFolder ? (setQuery(""), setTrail([...trail, { id: file.id, name: file.name }])) : void importFile({ fileId: file.id, name: file.name }, file.id)}>
                <span className="ml-drive-thumb">{isFolder ? "📁" : file.thumbnailLink ? <img src={file.thumbnailLink} alt="" loading="lazy" referrerPolicy="no-referrer" /> : file.mimeType.startsWith("video/") ? "🎬" : "📄"}</span>
                <b>{file.name}</b><small>{isFolder ? "Folder" : state === "done" ? "✓ Added" : state === "busy" ? "Adding…" : file.size ? formatSize(Number(file.size)) : "+ Add"}</small>
              </button>;
            })}
            {!busy && files.length === 0 && <p className="ml-hint">No images, videos or PDFs here.</p>}
          </div>
          {busy && <p className="ml-loading">Loading…</p>}
          {next && !busy && <button type="button" className="secondary-button ml-more" onClick={() => void list(next, query.trim())}>Load more</button>}
        </>
      )}
      <div className="ml-connect ml-paste">
        <p><b>Or paste a Drive share link</b>{drive.connected ? "" : " (file must be shared as “Anyone with the link”)"}</p>
        <form className="ml-inline" onSubmit={async (event) => { event.preventDefault(); if (await importFile({ link }, `link:${link}`)) setLink(""); }}><input value={link} onChange={(event) => setLink(event.target.value)} placeholder="https://drive.google.com/file/d/…" aria-label="Google Drive link" /><button type="submit" className="primary-button" disabled={!link.trim() || !target}>Add</button></form>
      </div>
    </Modal>
  );
}

function LinkPanel({ target, targetName, folder, onClose, onAdded }: { target: string; targetName: string; folder: string; onClose: () => void; onAdded: (item: MediaItem) => void }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal title="Import from a link" onClose={onClose}>
      <p className="ml-hint">Paste a direct link to an image, video or PDF (or a Google Drive / Dropbox share link). It's copied into <b>{targetName}</b>.</p>
      <form className="ml-inline" onSubmit={async (event) => { event.preventDefault(); setBusy(true); setError(""); try { const fixed = url.trim().replace(/^(https:\/\/www\.dropbox\.com\/.*?)([?&])dl=0/, "$1$2dl=1"); const data = await api<{ item: MediaItem }>("/api/media-library", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "importUrl", url: fixed, scope: target, folder }) }); onAdded(data.item); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not import that link."); } finally { setBusy(false); } }}>
        <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://…" autoFocus aria-label="File link" />
        <button type="submit" className="primary-button" disabled={busy || !url.trim() || !target}>{busy ? "Importing…" : "Import"}</button>
      </form>
      {error && <p className="form-error">{error}</p>}
    </Modal>
  );
}

function MobilePanel({ clientId, clientName, onClose, onCopy }: { clientId: string; clientName: string; onClose: () => void; onCopy: (text: string) => void }) {
  const link = `${window.location.origin}/media?upload=1${clientId ? `&client=${encodeURIComponent(clientId)}` : ""}`;
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  return (
    <Modal title="Mobile link" onClose={onClose}>
      <div className="ml-mobile">
        <img className="ml-qr" src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=8&data=${encodeURIComponent(link)}`} alt="QR code for the mobile Media Library link" width={220} height={220} />
        <div>
          <p>Scan with your phone camera (or send yourself the link) to open the Media Library{clientName ? <> for <b>{clientName}</b></> : ""} and upload photos and videos straight from the camera roll or camera.</p>
          <code className="ml-link">{link}</code>
          <div className="ml-detail-actions">
            <button type="button" className="primary-button" onClick={() => onCopy(link)}>Copy link</button>
            {canShare && <button type="button" className="secondary-button" onClick={() => void navigator.share({ title: "F2B Media Library", url: link }).catch(() => undefined)}>Share…</button>}
            <a className="secondary-button" href={`https://wa.me/?text=${encodeURIComponent(`F2B Media Library${clientName ? ` – ${clientName}` : ""}: ${link}`)}`} target="_blank" rel="noreferrer">WhatsApp it to me</a>
          </div>
          <small className="ml-hint">On your phone, tap Share → <b>Add to Home Screen</b> for a one-tap icon. Long-pressing the installed F2B app icon also shows a “Media Library” shortcut. You'll sign in with your usual work email.</small>
        </div>
      </div>
    </Modal>
  );
}

function AiPanel({ target, targetName, folder, project, onClose, onAdded }: { target: string; targetName: string; folder: string; project: Project; onClose: () => void; onAdded: (item: MediaItem) => void }) {
  const [prompt, setPrompt] = useState("");
  const [size, setSize] = useState("1536x1024");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const generate = async () => {
    if (prompt.trim().length < 4) { setError("Describe the image you want."); return; }
    setBusy(true); setError("");
    try {
      const data = await api<{ item: MediaItem }>("/api/media-library", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "generate", scope: target, folder: folder || "AI images", prompt: prompt.trim(), size, project }) });
      onAdded(data.item);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The image couldn’t be generated."); }
    finally { setBusy(false); }
  };
  return (
    <Modal title="✨ Generate an image with AI" onClose={onClose}>
      <div className="ml-ai-panel">
        <label className="field"><span>Describe the image</span><textarea rows={4} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="e.g. Bright modern kitchen with oak cabinets and a white island, natural daylight, photo style" maxLength={1500} autoFocus /></label>
        <label className="field"><span>Shape</span><select value={size} onChange={(event) => setSize(event.target.value)}><option value="1536x1024">Landscape (web banners, ads)</option><option value="1024x1024">Square (social posts)</option><option value="1024x1536">Portrait (stories, posters)</option></select></label>
        <p className="ml-hint">Saved to <b>{targetName}</b>{folder ? ` · ${folder}` : " · AI images"}. AI images are illustrations — don’t present them as real completed jobs.</p>
        {error && <p className="ml-error" role="alert">{error}</p>}
        <div className="ml-detail-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button type="button" className="primary-button" disabled={busy || !target} onClick={() => void generate()}>{busy ? "Generating… (up to a minute)" : "Generate image"}</button></div>
      </div>
    </Modal>
  );
}
