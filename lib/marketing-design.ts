export const MARKETING_EDITABLE_TEXT_CSS = ".wrap h1,.intro,.block h2,.block h3,.block p,.quote-block blockquote,.quote-block figcaption,.cta{white-space:pre-line}";

export type MarketingDesign = {
  brandColor: string;
  backgroundColor: string;
  textColor: string;
  fontFamily: "system" | "sans" | "serif" | "rounded";
  contentWidth: number;
};

export type MarketingBlockStyleValues = {
  backgroundColor?: string;
  textColor?: string;
  padding?: "compact" | "comfortable" | "spacious";
  alignment?: "left" | "center" | "right";
  imageFit?: "cover" | "contain";
  imageAspect?: "auto" | "landscape" | "square" | "portrait";
  imagePosition?: "center" | "top" | "bottom" | "left" | "right" | "top left" | "top right" | "bottom left" | "bottom right";
};

export type MarketingBlockStyle = MarketingBlockStyleValues & {
  responsive?: {
    tablet?: MarketingBlockStyleValues;
    mobile?: MarketingBlockStyleValues;
  };
};

export const DEFAULT_MARKETING_DESIGN: MarketingDesign = {
  brandColor: "#1877bd",
  backgroundColor: "#f5f7fa",
  textColor: "#18212f",
  fontFamily: "system",
  contentWidth: 760,
};

const color = (value: unknown, fallback: string) => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback;

export function normalizeMarketingDesign(value: unknown): MarketingDesign {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const width = Number(source.contentWidth);
  return {
    brandColor: color(source.brandColor, DEFAULT_MARKETING_DESIGN.brandColor),
    backgroundColor: color(source.backgroundColor, DEFAULT_MARKETING_DESIGN.backgroundColor),
    textColor: color(source.textColor, DEFAULT_MARKETING_DESIGN.textColor),
    fontFamily: ["system", "sans", "serif", "rounded"].includes(String(source.fontFamily)) ? source.fontFamily as MarketingDesign["fontFamily"] : DEFAULT_MARKETING_DESIGN.fontFamily,
    contentWidth: Number.isFinite(width) ? Math.round(Math.max(560, Math.min(1200, width))) : DEFAULT_MARKETING_DESIGN.contentWidth,
  };
}

export function marketingFontStack(fontFamily: MarketingDesign["fontFamily"]) {
  return {
    system: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    sans: "Arial, Helvetica, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'Trebuchet MS', Arial, sans-serif",
  }[fontFamily];
}

export function normalizeMarketingBlockStyle(value: unknown): MarketingBlockStyle {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const normalizeValues = (input: unknown): MarketingBlockStyleValues => {
    const values = input && typeof input === "object" ? input as Record<string, unknown> : {};
    const safeColor = (candidate: unknown) => typeof candidate === "string" && /^#[0-9a-f]{6}$/i.test(candidate) ? candidate.toLowerCase() : undefined;
    return {
      ...(safeColor(values.backgroundColor) ? { backgroundColor: safeColor(values.backgroundColor) } : {}),
      ...(safeColor(values.textColor) ? { textColor: safeColor(values.textColor) } : {}),
      ...(["compact", "comfortable", "spacious"].includes(String(values.padding)) ? { padding: values.padding as MarketingBlockStyleValues["padding"] } : {}),
      ...(["left", "center", "right"].includes(String(values.alignment)) ? { alignment: values.alignment as MarketingBlockStyleValues["alignment"] } : {}),
      ...(["cover", "contain"].includes(String(values.imageFit)) ? { imageFit: values.imageFit as MarketingBlockStyleValues["imageFit"] } : {}),
      ...(["auto", "landscape", "square", "portrait"].includes(String(values.imageAspect)) ? { imageAspect: values.imageAspect as MarketingBlockStyleValues["imageAspect"] } : {}),
      ...(["center", "top", "bottom", "left", "right", "top left", "top right", "bottom left", "bottom right"].includes(String(values.imagePosition)) ? { imagePosition: values.imagePosition as MarketingBlockStyleValues["imagePosition"] } : {}),
    };
  };
  const base = normalizeValues(source);
  const responsive = source.responsive && typeof source.responsive === "object" ? source.responsive as Record<string, unknown> : {};
  const tablet = normalizeValues(responsive.tablet);
  const mobile = normalizeValues(responsive.mobile);
  return {
    ...base,
    ...(Object.keys(tablet).length || Object.keys(mobile).length ? { responsive: {
      ...(Object.keys(tablet).length ? { tablet } : {}),
      ...(Object.keys(mobile).length ? { mobile } : {}),
    } } : {}),
  };
}

export function marketingBlockStyleForDevice(value: unknown, device: "desktop" | "tablet" | "mobile"): MarketingBlockStyleValues {
  const style = normalizeMarketingBlockStyle(value);
  const { responsive, ...base } = style;
  return device === "desktop" ? base : { ...base, ...(responsive?.[device] || {}) };
}

export function marketingResponsiveBlockCss(sections: Array<{ style?: unknown }>) {
  const scopedRule = (index: number, values: unknown) => {
    const selector = `.block.marketing-published-block-${index}`;
    const block = marketingBlockStyleCss(values);
    const image = marketingBlockImageCss(values);
    return `${block ? `${selector}{${block}}` : ""}${image ? `${selector} img{${image}}` : ""}`;
  };
  const base = sections.flatMap((section, index) => {
    const rule = scopedRule(index, section.style);
    return rule ? [rule] : [];
  }).join("");
  const rules = (device: "tablet" | "mobile") => sections.flatMap((section, index) => {
    const normalized = normalizeMarketingBlockStyle(section.style);
    const values = normalized.responsive?.[device];
    const rule = scopedRule(index, values);
    return rule ? [rule] : [];
  }).join("");
  const tablet = rules("tablet");
  const mobile = rules("mobile");
  return `${base}${tablet ? `@media(max-width:900px){${tablet}}` : ""}${mobile ? `@media(max-width:640px){${mobile}}` : ""}`;
}

export function marketingBlockStyleCss(value: unknown) {
  const style = normalizeMarketingBlockStyle(value);
  const padding = { compact: "12px", comfortable: "24px", spacious: "40px" }[style.padding || "comfortable"];
  return [
    style.backgroundColor ? `background-color:${style.backgroundColor}` : "",
    style.textColor ? `color:${style.textColor}` : "",
    style.padding ? `padding:${padding}` : "",
    style.alignment ? `text-align:${style.alignment}` : "",
  ].filter(Boolean).join(";");
}

export function marketingBlockStyleProperties(value: unknown) {
  const style = normalizeMarketingBlockStyle(value);
  const padding = style.padding ? { compact: "12px", comfortable: "24px", spacious: "40px" }[style.padding] : undefined;
  return {
    ...(style.backgroundColor ? { backgroundColor: style.backgroundColor } : {}),
    ...(style.textColor ? { color: style.textColor } : {}),
    ...(padding ? { padding } : {}),
    ...(style.alignment ? { textAlign: style.alignment } : {}),
  };
}

export function marketingBlockImageProperties(value: unknown) {
  const style = normalizeMarketingBlockStyle(value);
  const aspectRatio = style.imageAspect ? { auto: undefined, landscape: "16 / 9", square: "1 / 1", portrait: "4 / 5" }[style.imageAspect] : undefined;
  return {
    ...(style.imageFit ? { objectFit: style.imageFit } : {}),
    ...(aspectRatio ? { width: "100%", height: "auto" } : {}),
    ...(aspectRatio ? { aspectRatio } : {}),
    ...(style.imagePosition ? { objectPosition: style.imagePosition } : {}),
  };
}

export function marketingBlockImageCss(value: unknown) {
  const style = normalizeMarketingBlockStyle(value);
  const aspectRatio = style.imageAspect ? { auto: undefined, landscape: "16 / 9", square: "1 / 1", portrait: "4 / 5" }[style.imageAspect] : undefined;
  return [
    style.imageFit ? `object-fit:${style.imageFit}` : "",
    aspectRatio ? "width:100%;height:auto" : "",
    aspectRatio ? `aspect-ratio:${aspectRatio}` : "",
    style.imagePosition ? `object-position:${style.imagePosition}` : "",
  ].filter(Boolean).join(";");
}
