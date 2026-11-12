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

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function createCardDragFx(preview: HTMLElement, source: HTMLElement, grab: { x: number; y: number }, options: Options): CardDragFx {
  const maxTilt = options.maxTilt ?? 9;
  let lastX: number | null = null;
  let velocity = 0;
  let idleTimer = 0;
  let slot: HTMLElement | null = null;

  // Pivot around the point where the card is being held, like picking up a card.
  preview.style.transformOrigin = `${grab.x}px ${grab.y}px`;
  preview.style.transition = "transform 110ms ease-out, box-shadow 160ms ease-out";
  preview.style.willChange = "transform";
  preview.style.transform = "rotate(0deg) scale(1.03)";
  preview.style.boxShadow = "0 22px 44px rgba(8,22,34,.34), 0 6px 14px rgba(8,22,34,.22)";

  const setTilt = (degrees: number) => {
    preview.style.transform = `rotate(${degrees.toFixed(2)}deg) scale(1.03)`;
  };

  const ensureSlot = () => {
    if (slot) return slot;
    slot = document.createElement("div");
    slot.className = "card-drop-shadow-slot";
    slot.setAttribute("aria-hidden", "true");
    slot.style.height = `${Math.max(48, preview.offsetHeight || source.offsetHeight)}px`;
    return slot;
  };

  const removeSlot = () => {
    slot?.remove();
    slot = null;
  };

  const placeSlot = (clientY: number, column: HTMLElement) => {
    const cards = Array.from(column.querySelectorAll<HTMLElement>(options.cardSelector)).filter((card) => card !== source && card !== preview && !card.classList.contains("is-dragging") && !preview.contains(card));
    const container = cards[0]?.parentElement || column.querySelector<HTMLElement>("[class*='cards'], [class*='list'], [class*='body']") || column;
    const before = cards.find((card) => {
      const rect = card.getBoundingClientRect();
      return clientY < rect.top + rect.height / 2;
    });
    const element = ensureSlot();
    const reference = before || null;
    if (element.parentElement === container && (reference ? element.nextElementSibling === reference : element === container.lastElementChild)) return;
    container.insertBefore(element, reference);
  };

  return {
    move(clientX, clientY, column) {
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
      if (column) placeSlot(clientY, column);
      else removeSlot();
    },
    dropPlacement() {
      const container = slot?.parentElement;
      if (!slot || !container) return null;
      const column = container.closest<HTMLElement>("[data-task-drop-stage],[data-crm-stage]") || container;
      let next = slot.nextElementSibling as HTMLElement | null;
      while (next && !next.matches(options.cardSelector)) next = next.nextElementSibling as HTMLElement | null;
      return { column, beforeId: next ? next.dataset.opportunityId || next.id.replace(/^task-/, "") || null : null };
    },
    end() {
      window.clearTimeout(idleTimer);
      removeSlot();
    },
  };
}
