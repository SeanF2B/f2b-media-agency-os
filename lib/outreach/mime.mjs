// Builds RFC 5322 messages for sending through Microsoft Graph (MIME sendMail), the Gmail
// API (raw) or SMTP. Follow-ups thread correctly via In-Reply-To/References, and every
// campaign email carries one-click unsubscribe headers (RFC 8058), which Google and Yahoo
// require of bulk senders and which keep complaint rates down.

const enc = new TextEncoder();

export function base64(bytesOrString) {
  const bytes = typeof bytesOrString === "string" ? enc.encode(bytesOrString) : bytesOrString;
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}
export const base64url = (value) => base64(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const wrap76 = (value) => value.replace(/(.{76})/g, "$1\r\n");

/** RFC 2047 encoded-word only when needed. */
export function encodeHeader(value) {
  const text = String(value ?? "").replace(/[\r\n]+/g, " ");
  return /^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${base64(text)}?=`;
}

export function formatAddress({ name = "", email }) {
  const address = String(email || "").trim();
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address)) throw new Error(`Invalid email address: ${address}`);
  if (!name) return address;
  const display = /^[\x20-\x7e]*$/.test(name) ? `"${String(name).replace(/["\\\r\n]/g, "")}"` : encodeHeader(name);
  return `${display} <${address}>`;
}

export function newMessageId(fromEmail) {
  const domain = String(fromEmail).split("@")[1] || "localhost";
  return `<${crypto.randomUUID()}@${domain}>`;
}

/** Plain-text to minimal HTML (keeps cold emails looking hand-written). */
export function textToHtml(text) {
  const escaped = String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<div>${escaped.split(/\r?\n/).map((line) => line || "<br>").join("<br>\n")}</div>`;
}

/**
 * @param {object} m
 * @param {{name?:string,email:string}} m.from
 * @param {{name?:string,email:string}} m.to
 * @param {string} m.subject
 * @param {string} m.text
 * @param {string} [m.html]
 * @param {string} m.messageId
 * @param {string} [m.inReplyTo]
 * @param {string[]} [m.references]
 * @param {string} [m.unsubscribeUrl]   https one-click endpoint (POST)
 * @param {string} [m.unsubscribeMailto]
 * @param {Date} [m.date]
 */
export function buildMessage(m) {
  if (!m.subject || !m.text) throw new Error("A message needs a subject and a body.");
  const boundary = `b_${crypto.randomUUID().replace(/-/g, "")}`;
  const headers = [
    `From: ${formatAddress(m.from)}`,
    `To: ${formatAddress(m.to)}`,
    `Subject: ${encodeHeader(m.subject)}`,
    `Date: ${(m.date || new Date()).toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: ${m.messageId}`,
    "MIME-Version: 1.0",
  ];
  if (m.inReplyTo) headers.push(`In-Reply-To: ${m.inReplyTo}`);
  const refs = [...(m.references || []), ...(m.inReplyTo && !(m.references || []).includes(m.inReplyTo) ? [m.inReplyTo] : [])];
  if (refs.length) headers.push(`References: ${refs.join(" ")}`);
  const unsubscribe = [m.unsubscribeUrl && `<${m.unsubscribeUrl}>`, m.unsubscribeMailto && `<mailto:${m.unsubscribeMailto}?subject=unsubscribe>`].filter(Boolean);
  if (unsubscribe.length) headers.push(`List-Unsubscribe: ${unsubscribe.join(", ")}`);
  if (m.unsubscribeUrl) headers.push("List-Unsubscribe-Post: List-Unsubscribe=One-Click");
  headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
  const html = m.html || textToHtml(m.text);
  const part = (type, body) => [`--${boundary}`, `Content-Type: ${type}; charset=UTF-8`, "Content-Transfer-Encoding: base64", "", wrap76(base64(body))].join("\r\n");
  return [...headers, "", part("text/plain", m.text), part("text/html", html), `--${boundary}--`, ""].join("\r\n");
}

/** "Re: " prefix for threaded follow-ups without stacking "Re: Re:". */
export function replySubject(subject) {
  const clean = String(subject || "").trim();
  return /^re:/i.test(clean) ? clean : `Re: ${clean}`;
}
