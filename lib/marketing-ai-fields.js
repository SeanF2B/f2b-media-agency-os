const fieldTypes = new Set(["text", "email", "tel", "address", "number", "date", "time", "select", "radio", "multiselect", "textarea", "checkbox", "consent", "file", "hidden", "heading", "description", "divider", "progress", "calculated"]);
const contentOnlyTypes = new Set(["heading", "description", "divider", "progress"]);
const contactFields = new Set(["auto", "none", "name", "firstName", "lastName", "email", "phone", "companyName", "address1", "city", "state", "postalCode"]);
const calculationOperations = new Set(["multiply", "add", "subtract", "divide"]);
const conditionOperators = new Set(["equals", "notEquals", "contains", "greaterThan", "lessThan", "isEmpty", "isNotEmpty"]);

function normalizeVisibility(rawRule, earlierIds) {
  if (!rawRule || typeof rawRule !== "object" || Array.isArray(rawRule)) return undefined;
  const rawConditions = Array.isArray(rawRule.conditions) && rawRule.conditions.length
    ? rawRule.conditions
    : rawRule.fieldId ? [rawRule] : [];
  const conditions = rawConditions.slice(0, 8).flatMap((rawCondition) => {
    const condition = rawCondition && typeof rawCondition === "object" ? rawCondition : {};
    const fieldId = String(condition.fieldId || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
    const operator = conditionOperators.has(String(condition.operator)) ? String(condition.operator) : "equals";
    if (!earlierIds.has(fieldId)) return [];
    return [{ fieldId, operator, value: String(condition.value ?? condition.equals ?? "").slice(0, 160) }];
  });
  return conditions.length ? { mode: rawRule.mode === "or" ? "or" : "and", conditions } : undefined;
}

export function normalizeMarketingAiFields(rawFields, kind = "form") {
  const seenIds = new Set();
  const fields = Array.isArray(rawFields) ? rawFields.slice(0, 24).reduce((fieldsSoFar, raw, index) => {
    const field = raw && typeof raw === "object" ? raw : {};
    const type = fieldTypes.has(String(field.type)) ? String(field.type) : "text";
    const baseId = String(field.id || `field-${index + 1}`).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 56) || `field-${index + 1}`;
    let id = baseId;
    let suffix = 2;
    while (seenIds.has(id)) id = `${baseId.slice(0, 56 - String(suffix).length - 1)}-${suffix++}`;
    seenIds.add(id);
    const earlierIds = new Set(fieldsSoFar.map((item) => item.id));
    const options = Array.isArray(field.options) ? field.options.slice(0, 30).map((rawOption) => {
      const option = rawOption && typeof rawOption === "object" ? rawOption : {};
      const nextStep = Number(option.nextStep);
      return {
        label: String(option.label || "Option").slice(0, 120),
        value: String(option.value || option.label || "option").slice(0, 120),
        price: 0,
        ...(kind === "survey" && Number.isInteger(nextStep) && nextStep >= 1 && nextStep <= 10 ? { nextStep } : {}),
      };
    }) : [];
    const result = {
      id,
      label: String(field.label || `Question ${index + 1}`).slice(0, 160),
      type,
      required: contentOnlyTypes.has(type) ? false : Boolean(field.required),
      options,
      pricePerUnit: 0,
      contactField: contactFields.has(String(field.contactField)) ? String(field.contactField) : "auto",
      ...(field.unitLabel ? { unitLabel: String(field.unitLabel).slice(0, 24) } : {}),
      ...(kind === "survey" ? { step: Math.max(1, Math.min(10, Math.floor(Number(field.step) || 1))) } : {}),
      ...(normalizeVisibility(field.showWhen, earlierIds) ? { showWhen: normalizeVisibility(field.showWhen, earlierIds) } : {}),
      ...(kind === "calculator" && normalizeVisibility(field.priceWhen, earlierIds) ? { priceWhen: normalizeVisibility(field.priceWhen, earlierIds) } : {}),
    };
    if (kind === "calculator" && ["number", "calculated"].includes(type) && Array.isArray(field.rateTiers)) {
      const tiers = field.rateTiers.slice(0, 20).map((rawTier) => {
        const tier = rawTier && typeof rawTier === "object" ? rawTier : {};
        const upTo = Number(tier.upTo);
        return { ...(Number.isFinite(upTo) && upTo > 0 && upTo <= 1_000_000 ? { upTo } : {}), pricePerUnit: 0 };
      });
      let previous = 0;
      const validTiers = tiers.every((tier, tierIndex) => {
        if (tierIndex === tiers.length - 1) return true;
        if (!Number.isFinite(tier.upTo) || tier.upTo <= previous) return false;
        previous = tier.upTo;
        return true;
      });
      if (validTiers && tiers.length >= 2) {
        delete tiers[tiers.length - 1].upTo;
        result.rateTiers = tiers;
      }
    }
    if (type === "calculated" && field.calculation && typeof field.calculation === "object") {
      const operation = String(field.calculation.operation || "");
      const refs = Array.isArray(field.calculation.fieldIds) ? field.calculation.fieldIds.map(String) : [];
      const allowedRefCount = operation === "add" || operation === "multiply" ? refs.length >= 2 && refs.length <= 8 : refs.length === 2;
      if (calculationOperations.has(operation) && allowedRefCount && new Set(refs).size === refs.length) result.calculation = { operation, fieldIds: refs };
    }
    fieldsSoFar.push(result);
    return fieldsSoFar;
  }, []) : [];

  const earlier = new Map();
  const invalidCalculations = [];
  for (const field of fields) {
    if (field.type === "calculated") {
      const refs = field.calculation?.fieldIds || [];
      if (!field.calculation || refs.some((id) => !["number", "calculated"].includes(earlier.get(id)))) invalidCalculations.push(field.id);
    }
    earlier.set(field.id, field.type);
  }
  return { fields, invalidCalculations };
}
