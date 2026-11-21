// Trades (roofers, plumbers, electricians, cleaners …) book jobs, not appointments: one place for that wording.
const TRADE_RE = /roof|plumb|heat|electric|handy ?man|clean|build|construct|carpent|joiner|plaster|paint|decorat|gutter|drain|landscap|garden|fenc|tiling|tiler|kitchen|bathroom|interior|renovat|glaz|window|door|solar|boiler|hvac|\bgas\b|scaffold|paving|driveway|groundwork|flooring|locksmith|pest control|removals?\b/i;
export const isTradeBusiness = (name = "", services: Array<{ name?: string } | string> = []) =>
  TRADE_RE.test(name) || services.some((s) => TRADE_RE.test(typeof s === "string" ? s : s?.name || ""));
/** "Book job" for trades, otherwise the appointment wording passed in. */
export const bookWord = (trade: boolean, fallback = "Book appointment") => (trade ? "Book job" : fallback);
