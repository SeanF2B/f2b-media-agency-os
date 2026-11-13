"use client";

// Replaces emoji characters with matching line icons everywhere in the app (every tab, toast, list and
// activity entry), without touching the text that the rest of the app stores. Emojis stay in the saved data;
// only what is drawn on screen changes. Typographic marks (✓ ✕ ↗ ↻ …) and chess pieces are left alone.
import { useEffect, useRef } from "react";
import type { LucideIcon } from "lucide-react";
import {
  AlarmClock, Archive, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Award, BadgeCheck, Ban, Banknote, Bell, BellOff,
  BookOpen, Bookmark, Bot, Brain, BrickWall, BriefcaseBusiness, Building2, Calculator, Calendar, Camera, Car,
  ChartColumn, CircleAlert, CircleCheck, CircleHelp, CircleX, Clapperboard, ClipboardList, Clock, Cloud, Coins,
  Compass, Construction, CreditCard, Crown, Download, Earth, Eraser, Euro, Eye, Factory, FileText, Files, Flag, Flame,
  FlaskConical, Folder, FolderOpen, Gift, Globe, GraduationCap, Hammer, Hand, Hash, Heart, Hourglass, House, Image as ImageIcon,
  Inbox, Info, KeyRound, Laptop, Lightbulb, Link, Lock, LockOpen, Magnet, Mail, Mailbox, MailOpen, Map as MapIcon, MapPin,
  Megaphone, MessageCircle, Mic, Monitor, Moon, Music, Newspaper, NotebookPen, OctagonX, Package, Palette, Paperclip,
  PartyPopper, Pause, Pencil, PenLine, Phone, Pin, Play, Plug, Puzzle, Receipt, Recycle, Repeat, Rocket, Ruler, Save,
  Scale, ScanSearch, Scissors, Search, Send, Settings, Shield, ShoppingCart, Shuffle, Smartphone, Sparkles, Sprout,
  Square, Star, StickyNote, Sun, Tag, Target, ThumbsDown, ThumbsUp, Timer, Trash2, TrendingDown, TrendingUp, Trophy,
  Upload, User, Users, Video, Volume2, VolumeX, WandSparkles, Wrench, Zap,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  "🌐": Globe, "🌍": Earth, "🌎": Earth, "🌏": Earth, "✨": Sparkles, "🔎": Search, "🔍": Search, "📣": Megaphone,
  "📢": Megaphone, "🗣": Megaphone, "🎯": Target, "🗑": Trash2, "📝": NotebookPen, "📊": ChartColumn, "📈": TrendingUp,
  "📉": TrendingDown, "⚡": Zap, "⏳": Hourglass, "⌛": Hourglass, "👥": Users, "👤": User, "🧑": User, "👨": User,
  "👩": User, "✏": Pencil, "✍": PenLine, "🔌": Plug, "🔒": Lock, "🔐": Lock, "🔓": LockOpen, "📱": Smartphone,
  "🤖": Bot, "📋": ClipboardList, "🧭": Compass, "⚠": CircleAlert, "🧩": Puzzle, "📨": Send, "🔁": Repeat, "🔄": Repeat,
  "🔗": Link, "📄": FileText, "📃": FileText, "📑": Files, "⚙": Settings, "🚀": Rocket, "💶": Euro, "💰": Coins,
  "💵": Banknote, "💸": Banknote, "🪙": Coins, "🕘": Clock, "🕒": Clock, "🕐": Clock, "🕑": Clock, "🕓": Clock,
  "⏰": AlarmClock, "⏹": Square, "🏢": Building2, "🏬": Building2, "📁": Folder, "📂": FolderOpen, "🗂": Files,
  "🧱": BrickWall, "✅": CircleCheck, "☑": CircleCheck, "❌": CircleX, "❎": CircleX, "📅": Calendar, "📆": Calendar,
  "🗓": Calendar, "🎉": PartyPopper, "🥳": PartyPopper, "💬": MessageCircle, "🗨": MessageCircle, "🖼": ImageIcon,
  "🎨": Palette, "📧": Mail, "✉": Mail, "📩": Mail, "📍": MapPin, "⛔": Ban, "🚫": Ban, "🛑": OctagonX, "👁": Eye,
  "👀": Eye, "🔕": BellOff, "🔔": Bell, "🧾": Receipt, "⏱": Timer, "🏠": House, "🏡": House, "🧰": BriefcaseBusiness,
  "🔧": Wrench, "🛠": Wrench, "🔥": Flame, "📥": Inbox, "📤": Upload, "⏸": Pause, "▶": Play, "⏯": Play, "🗃": Archive,
  "🗄": Archive, "⬆": ArrowUp, "⬇": ArrowDown, "➡": ArrowRight, "⬅": ArrowLeft, "💡": Lightbulb, "🏆": Trophy,
  "⭐": Star, "🌟": Star, "📞": Phone, "☎": Phone, "📷": Camera, "📸": Camera, "🛒": ShoppingCart, "💳": CreditCard,
  "🔑": KeyRound, "🗝": KeyRound, "❤": Heart, "👍": ThumbsUp, "👎": ThumbsDown, "ℹ": Info, "📌": Pin, "📎": Paperclip,
  "⤵": Download, "🛡": Shield, "🧠": Brain, "👑": Crown, "🏅": Award, "🎖": Award, "🔨": Hammer, "📦": Package,
  "📰": Newspaper, "🗞": Newspaper, "🎬": Clapperboard, "🎥": Video, "📹": Video, "🎤": Mic, "🎵": Music, "🎶": Music,
  "🔖": Bookmark, "🚩": Flag, "🏁": Flag, "❓": CircleHelp, "❔": CircleHelp, "❗": CircleAlert, "❕": CircleAlert,
  "💼": BriefcaseBusiness, "🧑‍💼": BriefcaseBusiness, "👨‍💼": BriefcaseBusiness, "👩‍💼": BriefcaseBusiness, "🏭": Factory,
  "🕵": ScanSearch, "☁": Cloud, "🧪": FlaskConical, "📚": BookOpen, "📖": BookOpen, "🗺": MapIcon, "🧹": Eraser, "💾": Save,
  "🖥": Monitor, "💻": Laptop, "🔢": Hash, "🪄": WandSparkles, "🎁": Gift, "🧲": Magnet, "👋": Hand, "📮": Mailbox,
  "📬": MailOpen, "📭": Mailbox, "🏷": Tag, "📐": Ruler, "📏": Ruler, "✂": Scissors, "🔀": Shuffle, "⚖": Scale,
  "🧮": Calculator, "♻": Recycle, "🌱": Sprout, "🎓": GraduationCap, "🚧": Construction, "🏗": Construction,
  "🗒": StickyNote, "🔊": Volume2, "🔇": VolumeX, "🌙": Moon, "☀": Sun, "🚗": Car, "💯": BadgeCheck, "🔬": FlaskConical,
  "🧑‍💻": Laptop, "👨‍💻": Laptop, "👩‍💻": Laptop, "📲": Smartphone, "🖊": PenLine, "🖋": PenLine, "📒": NotebookPen,
  "📓": NotebookPen, "📔": NotebookPen, "🗳": Archive, "🕹": Puzzle, "🎲": Puzzle, "🏃": Zap, "💪": Award,
};

// Coloured status dots keep their colour as a small filled dot.
const DOTS: Record<string, string> = {
  "🟢": "#22c55e", "🟡": "#eab308", "🟠": "#f97316", "🔴": "#ef4444", "🔵": "#3b82f6", "🟣": "#a855f7", "🟤": "#a16207",
  "⚫": "#52525b", "⚪": "#e4e4e7", "🟥": "#ef4444", "🟧": "#f97316", "🟨": "#eab308", "🟩": "#22c55e", "🟦": "#3b82f6",
};

// Text glyphs that read as typography rather than emoji stay as they are.
const KEEP = new Set(["↗", "↘", "↙", "↖", "↔", "↕", "↻", "↺", "↩", "↪", "↶", "↷", "⌄", "✓", "✔", "✕", "✖", "✦", "✧", "✎",
  "♟", "♙", "♔", "♕", "♖", "♗", "♘", "♚", "♛", "♜", "♝", "♞", "☷", "©", "®", "™", "‼", "⁉", "〰", "▪", "▫", "◼", "◻", "◾", "◽", "⏎"]);

const EMOJI = /(?:\p{Extended_Pictographic}|\p{Regional_Indicator})(?:️|︎|[\u{1F3FB}-\u{1F3FF}])?(?:‍\p{Extended_Pictographic}️?)*/gu;
const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "TEXTAREA", "INPUT", "CODE", "PRE", "NOSCRIPT", "svg", "SVG"]);
const STRIP_ONLY_TAGS = new Set(["OPTION", "OPTGROUP", "SELECT", "TITLE"]);
const keyFor = (match: string) => match.replace(/[️︎\u{1F3FB}-\u{1F3FF}]/gu, "");
const isKept = (match: string) => KEEP.has(keyFor(match));

export function EmojiIcons() {
  const templateRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const templates = new Map<string, Element>();
    templateRef.current?.querySelectorAll("[data-emoji]").forEach((node) => {
      const svg = node.querySelector("svg");
      if (svg) templates.set(node.getAttribute("data-emoji") || "", svg);
    });
    // Icons inserted next to each text node, so they can be cleared when React changes or removes that text.
    const owned = new WeakMap<Text, HTMLElement[]>();
    const ownedNodes = new Set<Text>();

    const iconFor = (match: string): HTMLElement | null => {
      const key = keyFor(match);
      const span = document.createElement("span");
      span.className = "f2b-ico";
      span.setAttribute("aria-hidden", "true");
      span.dataset.f2bIco = "1";
      if (DOTS[key]) { span.classList.add("f2b-ico-dot"); span.style.setProperty("--f2b-dot", DOTS[key]); return span; }
      const template = templates.get(key);
      if (!template) return null;
      span.appendChild(template.cloneNode(true));
      return span;
    };

    const clearOwned = (text: Text) => {
      owned.get(text)?.forEach((span) => span.remove());
      owned.delete(text);
      ownedNodes.delete(text);
    };

    const skipped = (node: Node) => {
      for (let el = node.parentElement; el; el = el.parentElement) {
        if (SKIP_TAGS.has(el.tagName) || el.isContentEditable || el.hasAttribute("data-f2b-ico") || el.closest("[data-keep-emoji]")) return true;
        if (el === document.body) return false;
      }
      return true;
    };

    const processText = (text: Text) => {
      const value = text.nodeValue || "";
      EMOJI.lastIndex = 0;
      if (!EMOJI.test(value) || skipped(text)) return;
      const matches = value.match(EMOJI) || [];
      const replaced = matches.filter((match) => !isKept(match));
      if (!replaced.length) return;
      const stripped = value.replace(EMOJI, (match) => isKept(match) ? match : "").replace(/^[  ·]+/, "").replace(/ {2,}/g, " ");
      const parent = text.parentElement;
      if (parent && STRIP_ONLY_TAGS.has(parent.tagName)) { text.nodeValue = stripped; return; }
      clearOwned(text);
      const spans = replaced.map(iconFor).filter((span): span is HTMLElement => Boolean(span));
      spans.forEach((span) => text.parentNode?.insertBefore(span, text));
      if (spans.length) { owned.set(text, spans); ownedNodes.add(text); }
      text.nodeValue = stripped;
    };

    const processAttributes = (el: Element) => {
      for (const attr of ["title", "placeholder", "aria-label"]) {
        const value = el.getAttribute(attr);
        if (!value) continue;
        EMOJI.lastIndex = 0;
        if (!EMOJI.test(value)) continue;
        const next = value.replace(EMOJI, (match) => isKept(match) ? match : "").replace(/^\s+/, "").replace(/ {2,}/g, " ");
        if (next !== value) el.setAttribute(attr, next);
      }
    };

    const processTree = (root: Node) => {
      if (root.nodeType === Node.TEXT_NODE) { processText(root as Text); return; }
      if (root.nodeType !== Node.ELEMENT_NODE) return;
      const el = root as Element;
      if (SKIP_TAGS.has(el.tagName) || el.hasAttribute("data-f2b-ico")) return;
      processAttributes(el);
      el.querySelectorAll("[title],[placeholder],[aria-label]").forEach(processAttributes);
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const texts: Text[] = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) texts.push(node as Text);
      texts.forEach(processText);
    };

    let queued = new Set<Node>();
    let frame = 0; // setTimeout, not requestAnimationFrame: rAF pauses in background panes and tabs
    const flush = () => {
      frame = 0;
      const batch = queued; queued = new Set();
      batch.forEach((node) => { if (node.isConnected) processTree(node); });
      // Drop icons whose text React has since removed from the page.
      ownedNodes.forEach((text) => { if (!text.isConnected) clearOwned(text); });
    };
    const queue = (node: Node) => { queued.add(node); if (!frame) frame = window.setTimeout(flush, 30); };

    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "characterData") queue(record.target);
        else if (record.type === "attributes") queue(record.target);
        else {
          record.addedNodes.forEach((node) => { if (!(node instanceof HTMLElement && node.dataset.f2bIco)) queue(node); });
          record.removedNodes.forEach((node) => { if (node.nodeType === Node.TEXT_NODE && ownedNodes.has(node as Text)) clearOwned(node as Text); });
        }
      }
    });
    processTree(document.body);
    if (document.title) document.title = document.title.replace(EMOJI, (match) => isKept(match) ? match : "").trim();
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["title", "placeholder", "aria-label"] });
    return () => { observer.disconnect(); if (frame) window.clearTimeout(frame); };
  }, []);

  return <div ref={templateRef} hidden aria-hidden="true" data-f2b-ico="templates">
    {Object.entries(ICONS).map(([emoji, Icon]) => <span key={emoji} data-emoji={emoji}><Icon size={16} strokeWidth={1.9} /></span>)}
  </div>;
}
