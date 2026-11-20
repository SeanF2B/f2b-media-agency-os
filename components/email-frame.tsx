"use client";

import { useState } from "react";

// Shows an email exactly as it was sent (its own HTML and CSS) inside a locked-down frame.
// The server sends it with a sandbox CSP (no scripts, no forms); links open in a new tab.
export function EmailFrame({ src, title }: { src: string; title: string }) {
  const [loaded, setLoaded] = useState(false);
  return <div className={`email-frame${loaded ? " loaded" : ""}`}>
    {!loaded && <div className="page-loading" role="status" aria-label="Loading email…"><i /></div>}
    <iframe src={src} title={`Email: ${title}`} sandbox="allow-popups allow-popups-to-escape-sandbox" loading="lazy" referrerPolicy="no-referrer" onLoad={() => setLoaded(true)} />
  </div>;
}
