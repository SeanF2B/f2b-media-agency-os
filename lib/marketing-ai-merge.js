function mergeById(existing = [], proposed = [], preserve = true) {
  if (!preserve) return proposed;
  const remaining = new Map(existing.map((item) => [String(item.id || ""), item]));
  const merged = proposed.map((item) => {
    const previous = remaining.get(String(item.id || ""));
    if (previous) remaining.delete(String(item.id || ""));
    if (!previous) return item;
    const result = { ...previous, ...item };
    if (Array.isArray(item.options) && Array.isArray(previous.options)) {
      const oldOptions = new Map(previous.options.map((option) => [String(option.value || ""), option]));
      result.options = item.options.map((option) => {
        const oldOption = oldOptions.get(String(option.value || ""));
        if (!oldOption) return option;
        oldOptions.delete(String(option.value || ""));
        return { ...oldOption, ...option, price: oldOption.price ?? option.price };
      }).concat([...oldOptions.values()]);
    }
    if (previous.pricePerUnit !== undefined) result.pricePerUnit = previous.pricePerUnit;
    if (previous.rateTiers !== undefined) result.rateTiers = previous.rateTiers;
    if (previous.calculation !== undefined) result.calculation = previous.calculation;
    return result;
  });
  return merged.concat([...remaining.values()]);
}

function mergeSections(existing = [], proposed = [], preserve = true) {
  if (!preserve) return proposed;
  return proposed.map((section, index) => {
    const previous = existing[index] || {};
    const merged = { ...previous, ...section, style: { ...(previous.style || {}), ...(section.style || {}) } };
    for (const key of ["buttonUrl", "imageUrl", "videoUrl", "embeddedAssetId"]) {
      if (!section[key] && previous[key]) merged[key] = previous[key];
    }
    return merged;
  })
    .concat(existing.slice(proposed.length));
}

export function mergeMarketingAiDraft(existing, proposed, kind, preserveExisting = true, allowDesignChange = false) {
  if (!preserveExisting) return { ...existing, ...proposed };
  const merged = { ...existing, ...proposed };
  merged.fields = mergeById(existing.fields || [], proposed.fields || [], true);
  merged.sections = mergeSections(existing.sections || [], proposed.sections || [], true);
  merged.nodes = mergeById(existing.nodes || [], proposed.nodes || [], true);
  // AI may suggest calculator structure, but never changes owner-approved rates or design settings.
  if (kind === "calculator") {
    for (const key of ["currency", "fixedFee", "minimumCharge", "percentageAdjustmentPercent", "discountPercent", "taxPercent"]) merged[key] = existing[key];
  }
  if (existing.design !== undefined && !allowDesignChange) merged.design = existing.design;
  for (const key of ["funnelSteps", "allowedDomains", "seoTitle", "seoDescription", "canonicalUrl", "ogImageUrl", "noIndex"]) {
    if (existing[key] !== undefined && proposed[key] === undefined) merged[key] = existing[key];
  }
  return merged;
}
