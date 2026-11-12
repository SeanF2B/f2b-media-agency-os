const normalize = (value) => String(value ?? "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

export function explicitExclusion(values, configuredRules) {
  const terms = String(configuredRules || "").split(/[\n,;|]+/).map((term) => term.trim()).filter((term) => term.length >= 3 && !/^etc\.?$/i.test(term));
  const searchable = normalize(Object.values(values || {}).filter((value) => value !== null && value !== undefined).join(" "));
  for (const term of terms) {
    const needle = normalize(term);
    if (!needle) continue;
    const variants = [needle, ...needle.split(" ").map((word, index, words) => {
      if (!word.endsWith("s") || word.length < 5) return "";
      const singular = [...words]; singular[index] = word.slice(0, -1); return singular.join(" ");
    }).filter(Boolean)];
    if (/\bsuppliers?\b/.test(needle)) variants.push("supply store", "roofing supply", "building supply");
    if (variants.some((variant) => (` ${searchable} `).includes(` ${variant} `))) return term;
  }
  return "";
}

const industryFamilies = [
  { aliases: ["rooers", "roofer", "roofers", "roofing", "roofing contractor", "roofing contractors", "roof contractor", "roof contractors"] },
  { aliases: ["plumber", "plumbers", "plumbing", "plumbing contractor", "plumbing contractors"] },
  { aliases: ["electrician", "electricians", "electrical contractor", "electrical contractors", "electrical services"] },
  { aliases: ["painter", "painters", "painting contractor", "painting contractors", "painting and decorating", "decorator", "decorators"] },
];
const filler = new Set(["a", "an", "and", "business", "businesses", "company", "companies", "contractor", "contractors", "service", "services", "the"]);
const countryTokens = new Set(["ireland", "republic", "uk", "united", "kingdom"]);

function words(value) { return normalize(value).split(" ").filter(Boolean); }
function includesTerm(haystack, term) { return (` ${normalize(haystack)} `).includes(` ${normalize(term)} `); }
function industryMatches(niche, values) {
  const nicheText = normalize(niche);
  const evidence = [values["Business name"], values["Category"], values["Type"], values["Subtypes"], values["Industry"]].filter(Boolean).join(" ");
  const family = industryFamilies.find(({ aliases }) => aliases.some((alias) => includesTerm(nicheText, alias) || includesTerm(alias, nicheText)));
  if (family) return family.aliases.some((alias) => includesTerm(evidence, alias));
  const desired = words(niche).filter((word) => !filler.has(word));
  const supplied = new Set(words(evidence));
  return desired.length > 0 && desired.every((word) => supplied.has(word) || supplied.has(word.replace(/s$/, "")));
}

function areaMatches(areas, values) {
  const requested = String(areas || "").split(/[\r\n;]+/).map((area) => area.trim()).filter(Boolean);
  if (!requested.length) return true;
  const evidence = normalize([values.City, values.Region, values.Address, values.Postcode, values.Country].filter(Boolean).join(" "));
  return requested.some((area) => {
    const parts = area.split(",").map((part) => normalize(part)).filter(Boolean);
    const locationParts = parts.filter((part) => !countryTokens.has(part));
    const countryParts = parts.filter((part) => countryTokens.has(part));
    const placeMatches = !locationParts.length || locationParts.some((part) => (` ${evidence} `).includes(` ${part} `));
    const countryMatches = !countryParts.length || countryParts.every((part) => (` ${evidence} `).includes(` ${part} `));
    return placeMatches && countryMatches;
  });
}

/**
 * Deterministically verify the core lead request. A Google Maps primary
 * category/name can prove the business type; target-area fields prove place.
 * Extra services in the free-text ICP are not treated as mandatory unless
 * explicitly marked must/only/required, because Maps often omits service lists.
 */
export function verifyLeadCore(profile, values) {
  const exclusion = explicitExclusion(values, profile.exclude || "");
  if (exclusion) return { keep: false, reason: `Excluded by ICP rule: ${exclusion}` };
  const niche = String(profile.niche || "").trim();
  if (!niche || !industryMatches(niche, values)) return null;
  if (!areaMatches(profile.areas, values)) return null;
  const category = String(values.Category || values.Type || "").trim();
  const area = String(profile.areas || "").split(/[\r\n;]+/).map((item) => item.trim()).filter(Boolean).join(", ");
  const evidence = [category && `Maps category “${category}”`, area && `location “${area}”`].filter(Boolean).join(" and ");
  return { keep: true, reason: `Verified by ${evidence || "the supplied business details"}.` };
}
