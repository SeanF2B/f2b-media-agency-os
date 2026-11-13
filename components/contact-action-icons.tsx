export function PhoneActionIcon({ className = "" }: { className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.02-.24c1.12.37 2.33.56 3.57.56.55 0 1 .45 1 1V20c0 .55-.45 1-1 1C10.61 21 3 13.39 3 4c0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.24.2 2.45.56 3.57.11.36.02.76-.24 1.02l-2.2 2.2Z" /></svg>;
}

export function WhatsAppActionIcon({ className = "" }: { className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12.04 2C6.51 2 2.01 6.5 2.01 12.03c0 1.77.47 3.5 1.36 5.01L2 22l5.1-1.34a10.01 10.01 0 0 0 4.94 1.3h.01c5.53 0 10.03-4.5 10.03-10.03 0-2.68-1.04-5.2-2.94-7.1A9.97 9.97 0 0 0 12.04 2Zm.01 18.25h-.01a8.33 8.33 0 0 1-4.25-1.16l-.3-.18-3.02.8.81-2.94-.2-.31a8.26 8.26 0 0 1-1.27-4.43 8.25 8.25 0 0 1 8.25-8.25c2.2 0 4.27.86 5.83 2.42a8.2 8.2 0 0 1 2.42 5.83 8.25 8.25 0 0 1-8.26 8.22Zm4.53-6.18c-.25-.13-1.47-.73-1.7-.81-.23-.08-.4-.13-.56.13-.17.25-.64.81-.78.98-.14.17-.29.19-.54.06-.25-.13-1.05-.39-2-.1-.73-.67-1.23-1.5-1.37-1.75-.14-.25-.02-.39.1-.51.11-.11.25-.29.38-.43.12-.14.16-.25.25-.42.08-.17.04-.31-.02-.44-.06-.13-.56-1.35-.77-1.85-.2-.48-.4-.42-.56-.43h-.48c-.17 0-.44.06-.67.31-.23.25-.88.86-.88 2.08s.9 2.41 1.02 2.58c.13.17 1.77 2.71 4.29 3.8.6.26 1.06.42 1.43.53.6.19 1.15.16 1.58.1.48-.07 1.47-.6 1.68-1.18.21-.58.21-1.08.15-1.18-.06-.1-.23-.16-.48-.29Z" /></svg>;
}

export function toPhoneHref(value: string) {
  const trimmed = value.trim();
  const normalized = trimmed.startsWith("00") ? `+${trimmed.slice(2)}` : trimmed;
  return `tel:${normalized.replace(/[^+\d]/g, "")}`;
}

export function toWhatsAppNumber(value: string) {
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+")) return digits;
  if (digits.startsWith("00")) return digits.slice(2);
  if (digits.startsWith("353")) return digits;
  if (/^0\d{8,10}$/.test(digits)) return `353${digits.slice(1)}`;
  return digits;
}

export function SmsActionIcon({ className = "" }: { className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M4 3h16a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H8l-4.6 3.45A.9.9 0 0 1 2 20.73V5a2 2 0 0 1 2-2Zm3 6.25a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5Zm5 0a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5Zm5 0a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5Z" /></svg>;
}

export function EmailActionIcon({ className = "" }: { className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm0 3.2V18h16V7.2l-7.4 5.18a1 1 0 0 1-1.2 0L4 7.2ZM5.3 6l6.7 4.7L18.7 6H5.3Z" /></svg>;
}

export function toSmsHref(value: string) {
  return toPhoneHref(value).replace(/^tel:/, "sms:");
}
