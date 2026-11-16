export type Address = { name?: string; email: string };
export function base64(value: string | Uint8Array): string;
export function base64url(value: string | Uint8Array): string;
export function encodeHeader(value: string): string;
export function formatAddress(address: Address): string;
export function newMessageId(fromEmail: string): string;
export function textToHtml(text: string): string;
export function buildMessage(m: { from: Address; to: Address; subject: string; text: string; html?: string; messageId: string; inReplyTo?: string; references?: string[]; unsubscribeUrl?: string; unsubscribeMailto?: string; date?: Date }): string;
export function replySubject(subject: string): string;
