// Reuses the existing F2B Telegram bot in SEND-ONLY mode.
// The OS never calls setWebhook, deleteWebhook or getUpdates, so whatever already handles the
// bot's incoming messages keeps working untouched. Buttons are URL buttons that open the OS
// (approve / edit happen there), so no callback handling is needed on the bot side.

import { ProviderError, providerRequest } from "./http.mjs";

const API = "https://api.telegram.org";
const escapeHtml = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function createTelegram({ botToken, chatId }, { fetchImpl, sleepImpl } = {}) {
  if (!/^\d{5,}:[A-Za-z0-9_-]{30,}$/.test(String(botToken || ""))) throw new ProviderError("Telegram", 0, "That doesn't look like a Telegram bot token.");
  const call = (method, body) => providerRequest({ provider: "Telegram", url: `${API}/bot${botToken}/${method}`, method: "POST", body, idempotent: method === "getMe", fetchImpl, sleepImpl, describeError: (status, payload) => status === 401 ? "Telegram rejected the bot token." : status === 400 && /chat not found/i.test(payload?.description || "") ? "Telegram can't find that chat. Send the bot a message first, or check the chat ID." : `Telegram: ${String(payload?.description || status).slice(0, 160)}` });
  return {
    async verify() { const me = await call("getMe", {}); return { username: me?.result?.username || "", name: me?.result?.first_name || "" }; },
    async send(text, buttons = []) {
      if (!chatId) throw new ProviderError("Telegram", 0, "Add the chat ID that should receive alerts.");
      const result = await call("sendMessage", { chat_id: chatId, text: text.slice(0, 4000), parse_mode: "HTML", disable_web_page_preview: true, ...(buttons.length ? { reply_markup: { inline_keyboard: [buttons.map((button) => ({ text: button.text, url: button.url }))] } } : {}) });
      return { messageId: result?.result?.message_id ?? null };
    },
  };
}

/** The positive-reply alert: prospect, company, campaign, their reply, our AI draft, and links. */
export function formatPositiveAlert({ prospectName, prospectEmail, company, campaign, replyText, suggestedReply, confidence, conversationUrl }) {
  const clip = (value, max) => { const text = String(value || "").trim().replace(/\n{3,}/g, "\n\n"); return text.length > max ? `${text.slice(0, max - 1)}…` : text; };
  const lines = [
    "🟢 <b>Positive reply</b>",
    `<b>${escapeHtml(prospectName || prospectEmail)}</b>${company ? ` · ${escapeHtml(company)}` : ""}`,
    `Campaign: ${escapeHtml(campaign || "—")}${typeof confidence === "number" ? ` · ${Math.round(confidence * 100)}% sure` : ""}`,
    "",
    "<b>They wrote</b>",
    `<blockquote>${escapeHtml(clip(replyText, 1200))}</blockquote>`,
  ];
  if (suggestedReply) lines.push("", "<b>Suggested reply</b> (not sent)", `<blockquote>${escapeHtml(clip(suggestedReply, 1400))}</blockquote>`);
  const buttons = conversationUrl ? [{ text: "✅ Approve & send", url: `${conversationUrl}${conversationUrl.includes("?") ? "&" : "?"}action=approve` }, { text: "✏️ Edit reply", url: conversationUrl }] : [];
  return { text: lines.join("\n"), buttons };
}

export function formatOperationalAlert({ title, detail, url }) {
  return { text: `⚠️ <b>${escapeHtml(title)}</b>\n${escapeHtml(String(detail || "").slice(0, 1500))}`, buttons: url ? [{ text: "Open Outreach", url }] : [] };
}
