"use client";

// One small icon per messaging channel (real product logos, simple drawn fallback until they load).
export const CHANNELS = [
  { key: "whatsapp", label: "WhatsApp", short: "WhatsApp" },
  { key: "instagram", label: "Instagram", short: "Instagram" },
  { key: "messenger", label: "Facebook Messenger", short: "Facebook" },
  { key: "sms", label: "SMS", short: "SMS" },
  { key: "email", label: "Email", short: "Email" },
] as const;
export type ChannelKey = typeof CHANNELS[number]["key"];
export const channelLabel = (key: string) => CHANNELS.find((c) => c.key === key)?.label || key;

const FALLBACK: Record<string, React.ReactNode> = {
  whatsapp: <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#25D366" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Z" /><path fill="#fff" d="M8.6 7.3c.2-.4.4-.4.7-.4h.5c.2 0 .4 0 .6.5l.8 1.9c.1.2 0 .4-.1.6l-.5.6c-.1.2-.2.3 0 .6.9 1.5 2 2.4 3.4 3 .3.1.4.1.6-.1l.7-.8c.2-.2.4-.2.6-.1l1.8.9c.3.1.4.2.4.4 0 .5-.2 1.3-.9 1.7-.6.4-1.6.5-3-.1a10 10 0 0 1-4.6-4.2c-.8-1.4-.9-2.6-.4-3.5Z" /></svg>,
  instagram: <svg viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="ig-g" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stopColor="#feda75" /><stop offset=".5" stopColor="#d62976" /><stop offset="1" stopColor="#4f5bd5" /></linearGradient></defs><rect x="2" y="2" width="20" height="20" rx="6" fill="url(#ig-g)" /><circle cx="12" cy="12" r="4.2" fill="none" stroke="#fff" strokeWidth="2" /><circle cx="17.3" cy="6.7" r="1.2" fill="#fff" /></svg>,
  messenger: <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#0866FF" d="M12 2C6.4 2 2 6.1 2 11.7c0 2.9 1.2 5.5 3.2 7.2V22l3-1.6c1.2.3 2.4.5 3.8.5 5.6 0 10-4.1 10-9.7S17.6 2 12 2Z" /><path fill="#fff" d="m6.5 14.4 3-4.7 2.4 1.8 3.2-1.8-3 4.7-2.4-1.8Z" /></svg>,
  sms: <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="3" width="20" height="15" rx="4" fill="#34C759" /><path fill="#34C759" d="M7 17h5l-5 4Z" /><circle cx="8" cy="10.5" r="1.3" fill="#fff" /><circle cx="12" cy="10.5" r="1.3" fill="#fff" /><circle cx="16" cy="10.5" r="1.3" fill="#fff" /></svg>,
  email: <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="3" fill="#EA4335" /><path fill="none" stroke="#fff" strokeWidth="2" d="m4 7 8 6 8-6" /></svg>,
};
// Drawn logos only: the favicon service returns a generic globe for some (e.g. whatsapp.com), so channels never use it.
export function ChannelIcon({ channel, size = 18, className = "" }: { channel: string; size?: number; className?: string }) {
  return <span className={`ch-icon-fb ${className}`} style={{ width: size, height: size, display: "inline-flex", flex: "none" }} aria-hidden="true">{FALLBACK[channel] || FALLBACK.sms}</span>;
}
