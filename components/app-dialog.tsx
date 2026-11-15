"use client";
// In-app replacements for the browser's confirm / alert / prompt boxes, styled with the current account's
// brand colours (rendered inside .app-shell so each sub-account's CSS variables apply).
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Request = { kind: "confirm" | "alert" | "prompt"; message: string; value?: string; resolve: (value: unknown) => void };
let push: ((request: Request) => void) | null = null;
const queue: Request[] = [];

function open(request: Request) { if (push) push(request); else queue.push(request); }
export const appConfirm = (message: string) => new Promise<boolean>((resolve) => open({ kind: "confirm", message, resolve: resolve as (value: unknown) => void }));
export const appAlert = (message: string) => new Promise<void>((resolve) => open({ kind: "alert", message, resolve: resolve as (value: unknown) => void }));
export const appPrompt = (message: string, value = "") => new Promise<string | null>((resolve) => open({ kind: "prompt", message, value, resolve: resolve as (value: unknown) => void }));

export function AppDialogHost() {
  const [current, setCurrent] = useState<Request | null>(null);
  const [text, setText] = useState("");
  const pending = useRef<Request[]>([]);
  const okRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    push = (request) => { setCurrent((active) => { if (active) { pending.current.push(request); return active; } setText(request.value || ""); return request; }); };
    while (queue.length) push(queue.shift()!);
    return () => { push = null; };
  }, []);
  useEffect(() => { if (current && current.kind !== "prompt") window.setTimeout(() => okRef.current?.focus(), 20); }, [current]);
  if (!current || typeof document === "undefined") return null;
  const finish = (value: unknown) => {
    current.resolve(value);
    const next = pending.current.shift() || null;
    setText(next?.value || "");
    setCurrent(next);
  };
  const cancel = () => finish(current.kind === "confirm" ? false : current.kind === "prompt" ? null : undefined);
  const ok = () => finish(current.kind === "confirm" ? true : current.kind === "prompt" ? text : undefined);
  const lines = current.message.split("\n");
  return createPortal(<div className="app-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) cancel(); }} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); cancel(); } }}>
    <div className={`app-dialog app-dialog-${current.kind}`} role={current.kind === "alert" ? "alertdialog" : "dialog"} aria-modal="true" aria-label={lines[0]}>
      <div className="app-dialog-body">{lines.map((line, index) => line.trim() ? <p key={index} className={index === 0 ? "lead" : ""}>{line}</p> : <br key={index} />)}</div>
      {current.kind === "prompt" && <input className="app-dialog-input" autoFocus value={text} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") ok(); }} />}
      <div className="app-dialog-actions">{current.kind !== "alert" && <button type="button" className="secondary-button" onClick={cancel}>Cancel</button>}<button ref={okRef} type="button" className={`primary-button${/delete|remove|void|stop|disconnect|clear/i.test(current.message) && current.kind === "confirm" ? " app-dialog-danger" : ""}`} onClick={ok}>{current.kind === "confirm" ? (/^\s*delete/i.test(current.message) ? "Delete" : "Confirm") : "OK"}</button></div>
    </div>
  </div>, document.querySelector(".app-shell") || document.body);
}
