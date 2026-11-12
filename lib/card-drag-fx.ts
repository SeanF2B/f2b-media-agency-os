// Shared "lifted card" effect for every drag-and-drop board (staff tasks, AI
// tasks and the CRM pipeline).
//
// While a card is dragged:
//  - it tilts in the direction it is being moved (right = clockwise, left =
//    anticlockwise) and settles back to level when the pointer stops;
//  - a soft shadow slot appears in the column under the pointer, at the spot
//    where the card will be dropped.
//
// The helper only touches the floating preview and one temporary slot element.
// It never changes the React-managed cards, and `end()` always removes the slot.

export type CardDragFx = {
  move: (clientX: number, clientY: number, column?: HTMLElement | null) => void;
  /** Where the shadow slot currently sits: the column and the id of the card it is in front of (null = end of column). */
  dropPlacement: () => { column: HTMLElement; beforeId: string | null } | null;
  end: () => void;
};

type Options = {
  /** CSS selector that matches the cards inside a column. */
  cardSelector: string;
  /** Largest tilt in degrees. */
  maxTilt?: number;
};

let fxErrorShown = 0;
function showFxError(error: unknown) {
  if (typeof document === "undefined" || Date.now() - fxErrorShown < 5000) return;
  fxErrorShown = Date.now();
  const note = document.createElement("div");
  note.textContent = `Drag effect problem: ${error instanceof Error ? error.message : String(error)}`;
  note.style.cssText = "position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:2147483647;background:#7f1d1d;color:#fff;padding:8px 14px;border-radius:8px;font:12px/1.4 sans-serif;pointer-events:none";
  document.body.appendChild(note);
  window.setTimeout(() => note.remove(), 6000);
}
export { showFxError };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function createCardDragFx(preview: HTMLElement, source: HTMLElement, grab: { x: number; y: number }, options: Options): CardDragFx {
  const maxTilt = options.maxTilt ?? 9;
  let lastX: number | null = null;
  let velocity = 0;
  let idleTimer = 0;
  let slot: HTMLElement | null = null;
  let scrollFrame = 0;
  let lastColumn: HTMLElement | null = null;
  let lastY = 0;

  // Pivot around the point where the card is being held, like picking up a card.
  preview.style.transformOrigin = `${grab.x}px ${grab.y}px`;
  preview.style.transition = "transform 110ms ease-out, box-shadow 160ms ease-out";
  preview.style.willChange = "transform";
  // The cloned card still carries its "card appears" / "just dropped" animation.
  // CSS animations beat inline styles, which would freeze the tilt and shadow.
  preview.classList.add("card-drag-lifted");
  // The copied card carries each child's computed style, including pointer-events:auto.
  // Those children would be hit by elementFromPoint instead of the column underneath,
  // so no column (and no landing slot) would ever be found. Make every part click-through.
  preview.style.setProperty("pointer-events", "none", "important");
  preview.querySelectorAll<HTMLElement>("*").forEach((node) => node.style.setProperty("pointer-events", "none", "important"));
  preview.style.setProperty("animation", "none", "important");
  preview.style.setProperty("transform", "rotate(0deg) scale(1.03)", "important");
  preview.style.setProperty("box-shadow", "0 22px 44px rgba(8,22,34,.45), 0 6px 14px rgba(8,22,34,.3)", "important");

  const setTilt = (degrees: number) => {
    preview.style.setProperty("transform", `rotate(${degrees.toFixed(2)}deg) scale(1.03)`, "important");
  };

  // The landing slot is a floating outline positioned over the gap, and the cards
  // below it slide down with a transform. Nothing is inserted into the React-managed
  // card list, so re-renders and different column layouts cannot break it.
  let target: { column: HTMLElement; beforeCard: HTMLElement | null } | null = null;
  let shifted: HTMLElement[] = [];

  const ensureSlot = () => {
    if (slot) return slot;
    slot = document.createElement("div");
    slot.className = "card-drop-shadow-slot card-drop-shadow-floating";
    slot.setAttribute("aria-hidden", "true");
    document.body.appendChild(slot);
    return slot;
  };

  const clearShift = () => {
    shifted.forEach((card) => { card.style.removeProperty("transform"); card.style.removeProperty("transition"); });
    shifted = [];
  };

  const removeSlot = () => {
    slot?.remove();
    slot = null;
    clearShift();
    target = null;
  };

  const placeSlot = (clientY: number, column: HTMLElement) => {
    const cards = Array.from(column.querySelectorAll<HTMLElement>(options.cardSelector)).filter((card) => card !== source && card !== preview && !card.classList.contains("is-dragging") && !preview.contains(card) && card.getClientRects().length > 0);
    // Natural (un-shifted) top of each card, so the maths is stable while cards are sliding.
    const natural = (card: HTMLElement) => {
      const match = /translateY\((-?[\d.]+)px\)/.exec(card.style.transform || "");
      return card.getBoundingClientRect().top - (match ? Number(match[1]) : 0);
    };
    const before = cards.find((card) => clientY < natural(card) + card.offsetHeight / 2) || null;
    const slotHeight = Math.max(48, preview.offsetHeight || source.offsetHeight);
    const gap = cards.length > 1 ? Math.max(0, natural(cards[1]) - (natural(cards[0]) + cards[0].offsetHeight)) : 10;
    const first = cards[0];
    const colRect = column.getBoundingClientRect();
    const left = first ? first.getBoundingClientRect().left : colRect.left + 10;
    const width = first ? first.getBoundingClientRect().width : Math.max(120, colRect.width - 20);
    const last = cards[cards.length - 1];
    const slotTop = before ? natural(before) : last ? natural(last) + last.offsetHeight + gap : colRect.top + 70;
    const element = ensureSlot();
    element.style.cssText = `position:fixed;left:${left}px;top:${slotTop - (before ? 0 : 0)}px;width:${width}px;height:${slotHeight}px;box-sizing:border-box;z-index:2147482000;pointer-events:none;transition:top 150ms ease-out;`;
    const accent = getComputedStyle(column).getPropertyValue("--stage-color").trim() || "#3b82f6";
    element.style.setProperty("border", `2px dashed ${accent}`, "important");
    element.style.setProperty("border-radius", "14px", "important");
    element.style.setProperty("background", `color-mix(in srgb, ${accent} 16%, transparent)`, "important");
    element.style.setProperty("box-shadow", "inset 0 6px 18px rgba(0,0,0,.28), 0 8px 20px rgba(0,0,0,.22)", "important");
    // Cards at and after the slot slide down to make room (Trello-style).
    const index = before ? cards.indexOf(before) : cards.length;
    const push = slotHeight + gap;
    const nextShifted: HTMLElement[] = [];
    cards.forEach((card, position) => {
      if (position >= index) { card.style.setProperty("transition", "transform 150ms cubic-bezier(.2,.75,.25,1)", "important"); card.style.setProperty("transform", `translateY(${push}px)`, "important"); nextShifted.push(card); }
      else { card.style.removeProperty("transform"); card.style.removeProperty("transition"); }
    });
    shifted.filter((card) => !nextShifted.includes(card)).forEach((card) => { card.style.removeProperty("transform"); card.style.removeProperty("transition"); });
    shifted = nextShifted;
    target = { column, beforeCard: before };
  };

  // Trello-style: dragging near the top or bottom edge of a long column scrolls it.
  const EDGE = 70;
  const MAX_STEP = 18;
  let lastPointerX = 0;
  const scrollableParent = (start: HTMLElement | null, axis: "x" | "y"): HTMLElement | null => {
    for (let node = start; node && node !== document.body; node = node.parentElement) {
      const style = getComputedStyle(node);
      const overflow = axis === "y" ? style.overflowY : style.overflowX;
      const room = axis === "y" ? node.scrollHeight > node.clientHeight + 1 : node.scrollWidth > node.clientWidth + 1;
      if (room && /(auto|scroll)/.test(overflow)) return node;
    }
    return null;
  };
  const edgeStep = (position: number, start: number, end: number) => {
    if (position < start + EDGE) return -MAX_STEP * clamp(1 - (position - start) / EDGE, 0, 1);
    if (position > end - EDGE) return MAX_STEP * clamp(1 - (end - position) / EDGE, 0, 1);
    return 0;
  };
  const autoScroll = () => {
    scrollFrame = 0;
    let moved = false;
    const column = lastColumn;
    // 1. The column under the pointer scrolls when you reach its top or bottom edge.
    if (column && column.scrollHeight > column.clientHeight + 1) {
      const rect = column.getBoundingClientRect();
      const step = edgeStep(lastY, rect.top, rect.bottom);
      if (step) { column.scrollTop += step; moved = true; }
    }
    // 2. The page scrolls when you reach the top or bottom of the window.
    const pageStep = edgeStep(lastY, 0, window.innerHeight);
    if (pageStep) {
      const pageScroller = scrollableParent(column?.parentElement || source.parentElement, "y");
      if (pageScroller) pageScroller.scrollTop += pageStep; else window.scrollBy(0, pageStep);
      moved = true;
    }
    // 3. The board scrolls sideways when you reach the left or right of the window.
    const sideStep = edgeStep(lastPointerX, 0, window.innerWidth);
    if (sideStep) {
      const sideScroller = scrollableParent(column?.parentElement || source.parentElement, "x");
      if (sideScroller) sideScroller.scrollLeft += sideStep; else window.scrollBy(sideStep, 0);
      moved = true;
    }
    if (moved && column) placeSlot(lastY, column);
    if (dragging) scrollFrame = window.requestAnimationFrame(autoScroll);
  };
  let dragging = true;

  const moveInner = (clientX: number, clientY: number, column?: HTMLElement | null) => {
    if (lastX !== null) {
      const dx = clientX - lastX;
      // Smooth the horizontal speed so the tilt eases in and out.
      velocity = velocity * 0.6 + dx * 0.4;
      setTilt(clamp(velocity * 1.1, -maxTilt, maxTilt));
    }
    lastX = clientX;
    window.clearTimeout(idleTimer);
    idleTimer = window.setTimeout(() => {
      velocity = 0;
      setTilt(0);
    }, 110);
    lastColumn = column || null;
    lastY = clientY;
    lastPointerX = clientX;
    if (column) placeSlot(clientY, column); else removeSlot();
    if (!scrollFrame) scrollFrame = window.requestAnimationFrame(autoScroll);
  };

  return {
    move(clientX, clientY, column) {
      try { moveInner(clientX, clientY, column); } catch (error) { console.warn("card drag effect failed", error); showFxError(error); }
    },
    dropPlacement() {
      if (!target) return null;
      const beforeCard = target.beforeCard;
      return { column: target.column, beforeId: beforeCard ? beforeCard.dataset.opportunityId || beforeCard.id.replace(/^task-/, "") || null : null };
    },
    end() {
      dragging = false;
      window.clearTimeout(idleTimer);
      if (scrollFrame) window.cancelAnimationFrame(scrollFrame);
      scrollFrame = 0;
      lastColumn = null;
      removeSlot();
    },
  };
}
