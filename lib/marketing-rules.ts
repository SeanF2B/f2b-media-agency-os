export type MarketingOption = { label?: string; value?: string; price?: number; nextStep?: number };
export type MarketingCondition = { fieldId?: string; operator?: string; value?: string; equals?: string };
export type MarketingVisibility = MarketingCondition & { mode?: "and" | "or"; conditions?: MarketingCondition[] };
export type MarketingRateTier = { upTo?: number; pricePerUnit?: number };
export type MarketingCalculation = { operation?: "multiply" | "add" | "subtract" | "divide"; fieldIds?: [string, string, ...string[]] };
export type MarketingField = { id?: string; label?: string; type?: string; required?: boolean; min?: number; max?: number; step?: number; options?: MarketingOption[]; pricePerUnit?: number; unitLabel?: string; rateTiers?: MarketingRateTier[]; calculation?: MarketingCalculation; showWhen?: MarketingVisibility; priceWhen?: MarketingVisibility };
export type MarketingValues = Record<string, string | string[]>;
export type MarketingPricing = { fixedFee?: number; minimumCharge?: number; percentageAdjustmentPercent?: number; discountPercent?: number; taxPercent?: number; currency?: string };
export type MarketingQuoteLine = { fieldId: string; label: string; quantity?: number; unitLabel?: string; amount: number };
export type MarketingQuote = {
  lineItems: MarketingQuoteLine[];
  subtotal: number;
  fixedFee: number;
  minimumChargeAdjustment: number;
  percentageAdjustmentPercent: number;
  percentageAdjustment: number;
  discountPercent: number;
  discount: number;
  taxableSubtotal: number;
  taxPercent: number;
  tax: number;
  total: number;
};

const money = (value: number) => Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;

export function parseMarketingFieldValue(field: MarketingField, rawValues: string[]) {
  if (field.type === "calculated") return {};
  const values = rawValues.map((value) => value.trim().slice(0, 5000));
  const allowedOptions = new Set((field.options || []).map((option) => String(option.value || option.label || "")));
  if (["select", "radio"].includes(field.type || "") && values[0] && !allowedOptions.has(values[0])) return { error: "Choose one of the listed options." };
  if (field.type === "multiselect" && values.some((value) => !allowedOptions.has(value))) return { error: "Choose only listed options." };
  if (["checkbox", "consent"].includes(field.type || "") && values.some((value) => value !== "yes")) return { error: "Choose a valid checkbox value." };
  const value: string | string[] = field.type === "multiselect" ? [...new Set(values)].slice(0, 40) : values[0] || "";
  const scalar = Array.isArray(value) ? value.join(", ") : value;
  if (field.type === "email" && scalar && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(scalar)) return { error: "Enter a valid email address." };
  if (field.type === "number" && scalar && (!Number.isFinite(Number(scalar)) || (Number.isFinite(Number(field.min)) && Number(scalar) < Number(field.min)) || (Number.isFinite(Number(field.max)) && Number(scalar) > Number(field.max)))) return { error: "Enter a number within the allowed range." };
  return { value: scalar || Array.isArray(value) && value.length ? value : undefined };
}

export function isMarketingFieldVisible(field: MarketingField, values: MarketingValues) {
  return matchesMarketingConditions(field.showWhen, values);
}

export function matchesMarketingConditions(rule: MarketingVisibility | undefined, values: MarketingValues) {
  const conditions = rule?.conditions?.length ? rule.conditions : rule?.fieldId ? [rule] : [];
  if (!conditions.length) return true;
  const matches = (condition: MarketingCondition) => {
    if (!condition.fieldId) return false;
    const source = values[condition.fieldId];
    const expected = String(condition.value ?? condition.equals ?? "");
  const scalar = Array.isArray(source) ? source.join(", ") : String(source ?? "");
    switch (condition.operator || "equals") {
    case "notEquals": return Array.isArray(source) ? !source.includes(expected) : scalar !== expected;
    case "greaterThan": return scalar !== "" && Number.isFinite(Number(scalar)) && Number(scalar) > Number(expected);
    case "lessThan": return scalar !== "" && Number.isFinite(Number(scalar)) && Number(scalar) < Number(expected);
    case "contains": return Array.isArray(source) ? source.some((item) => item.toLowerCase().includes(expected.toLowerCase())) : scalar.toLowerCase().includes(expected.toLowerCase());
    case "isEmpty": return Array.isArray(source) ? source.length === 0 : scalar.trim() === "";
    case "isNotEmpty": return Array.isArray(source) ? source.length > 0 : scalar.trim() !== "";
    default: return Array.isArray(source) ? source.includes(expected) : scalar === expected;
    }
  };
  const results = conditions.map(matches);
  return rule?.mode === "or" ? results.some(Boolean) : results.every(Boolean);
}

export function isMarketingFieldPriceEnabled(field: MarketingField, values: MarketingValues) {
  return matchesMarketingConditions(field.priceWhen, values);
}

export function isMarketingRequiredValuePresent(value: string | string[] | undefined) {
  return Array.isArray(value) ? value.length > 0 : Boolean(value);
}

export function isMarketingSurveyStepVisible(fields: MarketingField[], step: number, values: MarketingValues) {
  return fields.some((field) => Math.max(1, Math.min(10, Math.floor(Number(field.step) || 1))) === step && isMarketingFieldVisible(field, values));
}

export function getMarketingSurveyPath(fields: MarketingField[], values: MarketingValues) {
  const steps = [...new Set(fields.map((field) => Math.max(1, Math.min(10, Math.floor(Number(field.step) || 1)))))].sort((a, b) => a - b);
  if (!steps.length) return [];
  const firstVisible = steps.find((step) => isMarketingSurveyStepVisible(fields, step, values));
  if (!firstVisible) return [];
  const visited = [firstVisible];
  while (visited.length < steps.length) {
    const current = visited[visited.length - 1];
    let target: number | undefined;
    for (const field of fields) {
      if (Math.max(1, Math.min(10, Math.floor(Number(field.step) || 1))) !== current || !isMarketingFieldVisible(field, values)) continue;
      const selected = values[String(field.id || "")];
      const selectedValues = Array.isArray(selected) ? selected : [String(selected ?? "")];
      const branch = (field.options || []).find((option) => selectedValues.includes(String(option.value || option.label || "")) && Number.isInteger(Number(option.nextStep)) && Number(option.nextStep) > current && steps.includes(Number(option.nextStep)));
      if (branch) { target = Number(branch.nextStep); break; }
    }
    const nextVisible = steps.find((step) => step >= (target ?? current + 1) && step > current && !visited.includes(step) && isMarketingSurveyStepVisible(fields, step, values));
    if (!nextVisible) break;
    visited.push(nextVisible);
  }
  return visited;
}

export function validateMarketingRules(fields: MarketingField[], survey = false) {
  const allIds = fields.map((field) => String(field.id || ""));
  if (new Set(allIds).size !== allIds.length) return "Each question needs its own unique ID.";
  const ids = new Set(allIds);
  const byId = new Map(fields.map((field) => [String(field.id || ""), field]));
  const steps = new Set(fields.map((field) => Math.max(1, Math.min(10, Math.floor(Number(field.step) || 1)))));
  const dependencies = new Map<string, string[]>();
  for (const field of fields) {
    const id = String(field.id || "");
    const conditions = field.showWhen?.conditions?.length ? field.showWhen.conditions : field.showWhen?.fieldId ? [field.showWhen] : [];
    const refs: string[] = [];
    for (const condition of conditions) {
      const sourceId = String(condition.fieldId || "");
      if (!ids.has(sourceId) || sourceId === id) return `Question “${id}” refers to a missing or circular visibility question.`;
      const source = byId.get(sourceId)!;
      if (survey && Math.max(1, Math.min(10, Math.floor(Number(source.step) || 1))) > Math.max(1, Math.min(10, Math.floor(Number(field.step) || 1)))) return `Question “${id}” cannot depend on a later survey step.`;
      refs.push(sourceId);
    }
    const priceConditions = field.priceWhen?.conditions?.length ? field.priceWhen.conditions : field.priceWhen?.fieldId ? [field.priceWhen] : [];
    if (priceConditions.length > 8) return `Question “${id}” can have up to eight pricing conditions.`;
    for (const condition of priceConditions) {
      if (!ids.has(String(condition.fieldId || ""))) return `Question “${id}” pricing refers to a missing condition question.`;
    }
    if (refs.length) dependencies.set(id, refs);
    const currentStep = Math.max(1, Math.min(10, Math.floor(Number(field.step) || 1)));
    for (const option of survey ? field.options || [] : []) {
      if (option.nextStep !== undefined && (!steps.has(option.nextStep) || option.nextStep <= currentStep)) return `Survey branches must point to an existing later step (question “${id}”).`;
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const hasCycle = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const source of dependencies.get(id) || []) if (hasCycle(source)) return true;
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  if ([...dependencies.keys()].some(hasCycle)) return "Visibility rules cannot contain circular question references.";
  return null;
}

export function validateMarketingSectionRules(fields: MarketingField[], sections: Array<{ showWhen?: MarketingVisibility; children?: unknown[] }>) {
  const fieldIds = new Set(fields.map((field) => String(field.id || "")));
  const pending: Array<{ showWhen?: MarketingVisibility; children?: unknown[] }> = [...sections];
  while (pending.length) {
    const section = pending.pop()!;
    const conditions = section.showWhen?.conditions?.length ? section.showWhen.conditions : section.showWhen?.fieldId ? [section.showWhen] : [];
    if (conditions.some((condition) => !condition.fieldId || !fieldIds.has(condition.fieldId))) return "A section refers to a missing condition question.";
    if (Array.isArray(section.children)) pending.push(...section.children as Array<{ showWhen?: MarketingVisibility; children?: unknown[] }>);
  }
  return null;
}

export function validateMarketingSurvey(fields: MarketingField[]) {
  return validateMarketingRules(fields, true);
}

export function validateMarketingCalculator(fields: MarketingField[]) {
  const seen = new Map<string, string>();
  for (const field of fields) {
    const id = String(field.id || "");
    if (field.type === "calculated") {
      const calculation = field.calculation;
      const refs = calculation?.fieldIds;
      const operation = String(calculation?.operation || "");
      const minimumRefs = operation === "add" || operation === "multiply" ? 2 : 2;
      const maximumRefs = operation === "add" || operation === "multiply" ? 8 : 2;
      if (!calculation || !["multiply", "add", "subtract", "divide"].includes(operation) || !Array.isArray(refs) || refs.length < minimumRefs || refs.length > maximumRefs || refs.some((ref) => !["number", "calculated"].includes(seen.get(String(ref)) || ""))) return `Calculated field “${field.label || id || "(unnamed)"}” must use 2–8 earlier numeric fields for addition/multiplication or exactly two for subtraction/division.`;
      if (refs.some((ref) => String(ref) === id) || new Set(refs.map(String)).size !== refs.length) return `Calculated field “${field.label || id || "(unnamed)"}” cannot use itself or repeat an input.`;
      if (Number(field.pricePerUnit || 0) < 0) return "Calculator rates must be zero or more.";
    }
    if (field.type === "number" && Number(field.pricePerUnit || 0) < 0) return "Calculator rates must be zero or more.";
    if ((field.options || []).some((option) => Number(option.price || 0) < 0)) return "Calculator option prices must be zero or more.";
    const tiers = field.rateTiers || [];
    if (tiers.length > 20) return "A quantity field can have up to 20 rate tiers.";
    let previous = 0;
    for (const [index, tier] of tiers.entries()) {
      const rate = Number(tier.pricePerUnit);
      if (!Number.isFinite(rate) || rate < 0 || rate > 1_000_000) return "Tiered rates must be between zero and 1,000,000.";
      if (index < tiers.length - 1) {
        const upTo = Number(tier.upTo);
        if (!Number.isFinite(upTo) || upTo <= previous || upTo > 1_000_000) return "Rate tier limits must increase, and the last tier must cover the remaining quantity.";
        previous = upTo;
      }
    }
    seen.set(id, String(field.type || ""));
  }
  return null;
}

export function calculateMarketingDerivedValues(fields: MarketingField[], values: MarketingValues): MarketingValues {
  const result: MarketingValues = { ...values };
  for (const field of fields) {
    if (field.type !== "calculated") continue;
    const id = String(field.id || "");
    if (!isMarketingFieldVisible(field, result)) { delete result[id]; continue; }
    const refs = field.calculation?.fieldIds || ["", ""];
    const operands = refs.map((reference) => Math.max(0, Math.min(1_000_000, Number(result[reference]) || 0)));
    const [left = 0, right = 0] = operands;
    let value = 0;
    switch (field.calculation?.operation) {
      case "multiply": value = operands.reduce((total, operand) => total * operand, 1); break;
      case "add": value = operands.reduce((total, operand) => total + operand, 0); break;
      case "subtract": value = Math.max(0, left - right); break;
      case "divide": value = right > 0 ? left / right : 0; break;
      default: value = 0;
    }
    result[id] = String(money(Math.max(0, Math.min(1_000_000_000, value))));
  }
  return result;
}

export function calculateMarketingQuote(fields: MarketingField[], values: MarketingValues, pricing: MarketingPricing = {}): MarketingQuote {
  let subtotal = 0;
  const lineItems: MarketingQuoteLine[] = [];
  const calculatedValues = calculateMarketingDerivedValues(fields, values);
  for (const field of fields) {
    if (!isMarketingFieldVisible(field, calculatedValues) || !isMarketingFieldPriceEnabled(field, calculatedValues)) continue;
    const value = calculatedValues[String(field.id || "")];
    if (field.type === "number" || field.type === "calculated") {
      const quantity = Math.max(0, Math.min(1_000_000, Number(value || 0) || 0));
      const tiers = field.rateTiers || [];
      let amount = 0;
      if (tiers.length) {
        let remaining = quantity; let previousLimit = 0;
        for (let index = 0; index < tiers.length && remaining > 0; index++) {
          const tier = tiers[index];
          const limit = index === tiers.length - 1 ? Infinity : Math.max(previousLimit, Number(tier.upTo) || previousLimit);
          const bandQuantity = Math.min(remaining, Math.max(0, limit - previousLimit));
          amount += bandQuantity * Math.max(0, Math.min(1_000_000, Number(tier.pricePerUnit) || 0));
          remaining -= bandQuantity;
          previousLimit = limit;
        }
      } else amount = quantity * Math.max(0, Math.min(1_000_000, Number(field.pricePerUnit) || 0));
      if (quantity > 0) {
        subtotal += amount;
        lineItems.push({ fieldId: String(field.id || ""), label: String(field.label || field.id || "Quantity"), quantity, ...(field.unitLabel ? { unitLabel: field.unitLabel } : {}), amount: money(amount) });
      }
    }
    if (["select", "radio"].includes(field.type || "")) {
      const option = field.options?.find((item) => String(item.value || item.label) === value);
      if (option) {
        const amount = Math.max(0, Number(option.price) || 0);
        subtotal += amount;
        lineItems.push({ fieldId: String(field.id || ""), label: `${String(field.label || field.id || "Option")}: ${String(option.label || option.value || "Selected option")}`, amount: money(amount) });
      }
    }
    if (field.type === "multiselect") {
      const selected = Array.isArray(value) ? value : [];
      for (const item of selected) {
        const option = field.options?.find((candidate) => String(candidate.value || candidate.label) === item);
        if (!option) continue;
        const amount = Math.max(0, Number(option.price) || 0);
        subtotal += amount;
        lineItems.push({ fieldId: String(field.id || ""), label: `${String(field.label || field.id || "Option")}: ${String(option.label || option.value || "Selected option")}`, amount: money(amount) });
      }
    }
  }
  const fixedFee = Math.max(0, Math.min(1_000_000, Number(pricing.fixedFee) || 0));
  const minimumCharge = Math.max(0, Math.min(1_000_000, Number(pricing.minimumCharge) || 0));
  const discountPercent = Math.max(0, Math.min(100, Number(pricing.discountPercent) || 0));
  const percentageAdjustmentPercent = Math.max(-100, Math.min(1000, Number(pricing.percentageAdjustmentPercent) || 0));
  const taxPercent = Math.max(0, Math.min(100, Number(pricing.taxPercent) || 0));
  const minimumChargeAdjustment = Math.max(0, minimumCharge - subtotal - fixedFee);
  const beforeDiscount = subtotal + fixedFee + minimumChargeAdjustment;
  const percentageAdjustment = beforeDiscount * percentageAdjustmentPercent / 100;
  const afterPercentageAdjustment = Math.max(0, beforeDiscount + percentageAdjustment);
  const discount = afterPercentageAdjustment * discountPercent / 100;
  const taxableSubtotal = afterPercentageAdjustment - discount;
  const tax = taxableSubtotal * taxPercent / 100;
  return {
    lineItems,
    subtotal: money(subtotal),
    fixedFee: money(fixedFee),
    minimumChargeAdjustment: money(minimumChargeAdjustment),
    percentageAdjustmentPercent,
    percentageAdjustment: money(percentageAdjustment),
    discountPercent,
    discount: money(discount),
    taxableSubtotal: money(taxableSubtotal),
    taxPercent,
    tax: money(tax),
    total: money(taxableSubtotal + tax),
  };
}

export function calculateMarketingTotal(fields: MarketingField[], values: MarketingValues, pricing: MarketingPricing = {}) {
  return calculateMarketingQuote(fields, values, pricing).total;
}
