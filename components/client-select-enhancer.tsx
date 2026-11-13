"use client";

import { useEffect, useRef } from "react";

type PickClient = { id: string; name: string; logo?: string; color?: string };

/**
 * Gives every client dropdown in the OS a logo picker. Any single <select> whose options are
 * clients is visually replaced by a button + list showing each client's logo (or colour + initials).
 * The native <select> stays in the DOM as the source of truth: picking an option sets its value and
 * fires a real change event, so React state, forms and existing handlers keep working unchanged.
 */
export function ClientSelectEnhancer({ clients }: { clients: PickClient[] }) {
  const clientsRef = useRef(clients);
  clientsRef.current = clients;

  useEffect(() => {
    const enhanced = new Map<HTMLSelectElement, { wrap: HTMLElement; button: HTMLButtonElement; last: string }>();
    let menu: HTMLElement | null = null;
    let menuOwner: HTMLSelectElement | null = null;
    const byId = () => new Map<string, PickClient>((clientsRef.current as PickClient[]).map((client: PickClient) => [client.id, client] as [string, PickClient]));
    const esc = (text: string) => text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
    const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?";
    const safeLogo = (logo?: string) => (logo && /^(https:\/\/|data:image\/|\/)/i.test(logo) ? logo : "");
    const mark = (value: string, label: string) => {
      const client = byId().get(value);
      if (client) {
        const logo = safeLogo(client.logo);
        return logo ? `<span class="client-pick-logo"><img src="${esc(logo)}" alt="" loading="lazy"></span>` : `<span class="client-pick-logo initials" style="background:${esc(client.color || "#d9dee3")}">${esc(initials(client.name))}</span>`;
      }
      const isAgency = /agency|f2b/i.test(label) && value !== "";
      return `<span class="client-pick-logo generic">${isAgency ? "★" : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>'}</span>`;
    };

    const isClientSelect = (select: HTMLSelectElement) => {
      if (select.multiple || select.dataset.noClientPick !== undefined || select.closest("[data-no-client-pick]")) return false;
      const ids = byId();
      const options = [...select.options].filter((option) => option.value !== "" && !/^(all|agency|none)$/i.test(option.value));
      if (!options.length) return false;
      const matches = options.filter((option) => ids.has(option.value)).length;
      return matches >= 1 && matches / options.length >= 0.8;
    };

    const setValue = (select: HTMLSelectElement, value: string) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
      setter ? setter.call(select, value) : (select.value = value);
      select.dispatchEvent(new Event("input", { bubbles: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
    };

    const render = (select: HTMLSelectElement) => {
      const entry = enhanced.get(select); if (!entry) return;
      const option = select.selectedOptions[0] || select.options[0];
      const label = option?.textContent?.trim() || "Choose a client";
      entry.button.innerHTML = `${mark(option?.value || "", label)}<span class="client-pick-label">${esc(label)}</span><svg class="client-pick-caret" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>`;
      entry.button.disabled = select.disabled;
      entry.last = `${select.value}|${select.options.length}|${select.disabled}|${label}`;
    };

    const closeMenu = (focusButton = false) => {
      if (!menu) return;
      const owner = menuOwner;
      menu.remove(); menu = null; menuOwner = null;
      document.removeEventListener("mousedown", outside, true);
      window.removeEventListener("resize", reposition); window.removeEventListener("scroll", reposition, true);
      if (focusButton && owner) enhanced.get(owner)?.button.focus();
      if (owner) enhanced.get(owner)?.button.setAttribute("aria-expanded", "false");
    };
    const outside = (event: MouseEvent) => { if (menu && !menu.contains(event.target as Node) && !(menuOwner && enhanced.get(menuOwner)?.button.contains(event.target as Node))) closeMenu(); };
    const reposition = () => {
      if (!menu || !menuOwner) return;
      const rect = enhanced.get(menuOwner)!.button.getBoundingClientRect();
      const below = window.innerHeight - rect.bottom;
      const height = Math.min(360, menu.scrollHeight);
      menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - Math.max(rect.width, 240) - 8))}px`;
      menu.style.minWidth = `${Math.max(rect.width, 240)}px`;
      menu.style.top = below < height + 12 && rect.top > below ? `${Math.max(8, rect.top - height - 6)}px` : `${rect.bottom + 6}px`;
    };

    const openMenu = (select: HTMLSelectElement) => {
      if (menuOwner === select) { closeMenu(); return; }
      closeMenu();
      const entry = enhanced.get(select)!;
      menu = document.createElement("div");
      menu.className = "client-pick-menu";
      menu.setAttribute("role", "listbox");
      const many = select.options.length > 8;
      menu.innerHTML = `${many ? '<input class="client-pick-search" type="search" placeholder="Search clients" aria-label="Search clients">' : ""}<div class="client-pick-options"></div>`;
      const list = menu.querySelector(".client-pick-options") as HTMLElement;
      const fill = (query = "") => {
        const q = query.trim().toLowerCase();
        list.innerHTML = [...select.options].map((option, index) => ({ option, index })).filter(({ option }) => !option.hidden && (!q || (option.textContent || "").toLowerCase().includes(q))).map(({ option, index }) => `<button type="button" role="option" data-index="${index}" aria-selected="${option.selected}" class="client-pick-option${option.selected ? " on" : ""}"${option.disabled ? " disabled" : ""}>${mark(option.value, option.textContent || "")}<span>${esc(option.textContent?.trim() || "")}</span></button>`).join("") || '<p class="client-pick-empty">No clients match.</p>';
      };
      fill();
      list.addEventListener("click", (event) => {
        const target = (event.target as HTMLElement).closest("button[data-index]") as HTMLButtonElement | null;
        if (!target || target.disabled) return;
        const option = select.options[Number(target.dataset.index)];
        if (option && option.value !== select.value) setValue(select, option.value);
        render(select); closeMenu(true);
      });
      menu.addEventListener("keydown", (event) => {
        const buttons = [...list.querySelectorAll<HTMLButtonElement>("button[data-index]:not([disabled])")];
        const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (event.key === "Escape") { event.preventDefault(); closeMenu(true); }
        else if (event.key === "ArrowDown") { event.preventDefault(); buttons[Math.min(buttons.length - 1, at + 1)]?.focus(); }
        else if (event.key === "ArrowUp") { event.preventDefault(); if (at <= 0) (menu?.querySelector(".client-pick-search") as HTMLInputElement | null)?.focus(); else buttons[at - 1]?.focus(); }
        else if (event.key === "Tab") closeMenu();
      });
      const search = menu.querySelector(".client-pick-search") as HTMLInputElement | null;
      search?.addEventListener("input", () => fill(search.value));
      search?.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); (list.querySelector("button[data-index]:not([disabled])") as HTMLButtonElement | null)?.click(); } });
      document.body.appendChild(menu);
      menuOwner = select;
      entry.button.setAttribute("aria-expanded", "true");
      reposition();
      document.addEventListener("mousedown", outside, true);
      window.addEventListener("resize", reposition); window.addEventListener("scroll", reposition, true);
      (search || (list.querySelector(".on") as HTMLElement | null) || (list.querySelector("button") as HTMLElement | null))?.focus();
    };

    const enhance = (select: HTMLSelectElement) => {
      select.dataset.clientEnhanced = "1";
      const wrap = document.createElement("span");
      wrap.className = "client-pick";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "client-pick-btn";
      button.setAttribute("aria-haspopup", "listbox");
      button.setAttribute("aria-expanded", "false");
      const labelText = select.getAttribute("aria-label") || select.closest("label")?.firstChild?.textContent?.trim() || "Client";
      button.setAttribute("aria-label", `${labelText}: choose a client`);
      button.addEventListener("click", () => openMenu(select));
      button.addEventListener("keydown", (event) => { if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) { event.preventDefault(); openMenu(select); } });
      wrap.appendChild(button);
      select.insertAdjacentElement("afterend", wrap);
      select.classList.add("client-pick-native");
      select.tabIndex = -1;
      select.setAttribute("aria-hidden", "true");
      enhanced.set(select, { wrap, button, last: "" });
      render(select);
    };

    const scan = () => {
      for (const [select, entry] of enhanced) {
        if (!select.isConnected) { entry.wrap.remove(); enhanced.delete(select); if (menuOwner === select) closeMenu(); continue; }
        if (!entry.wrap.isConnected || select.nextElementSibling !== entry.wrap) select.insertAdjacentElement("afterend", entry.wrap);
        const label = (select.selectedOptions[0] || select.options[0])?.textContent?.trim() || "";
        if (`${select.value}|${select.options.length}|${select.disabled}|${label}` !== entry.last) render(select);
      }
      document.querySelectorAll<HTMLSelectElement>("select:not([data-client-enhanced])").forEach((select) => { if (isClientSelect(select)) enhance(select); });
    };

    let queued = false;
    const queue = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; scan(); }); };
    const observer = new MutationObserver(queue);
    observer.observe(document.body, { childList: true, subtree: true });
    // React can change a controlled <select>'s value without any DOM mutation, so re-sync labels lightly.
    const timer = window.setInterval(queue, 700);
    document.addEventListener("change", queue, true);
    scan();
    return () => {
      observer.disconnect(); window.clearInterval(timer); document.removeEventListener("change", queue, true); closeMenu();
      for (const [select, entry] of enhanced) { entry.wrap.remove(); select.classList.remove("client-pick-native"); select.removeAttribute("aria-hidden"); select.removeAttribute("tabindex"); delete select.dataset.clientEnhanced; }
      enhanced.clear();
    };
  }, []);

  return null;
}
