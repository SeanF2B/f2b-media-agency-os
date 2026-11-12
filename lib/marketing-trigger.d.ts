export type MarketingConversionToolKind = "form" | "funnel" | "survey" | "calculator";

export type MarketingSubmissionTrigger = {
  id: string;
  label: string;
  kinds: string[];
  external?: boolean;
};

export const MARKETING_SUBMISSION_TRIGGERS: MarketingSubmissionTrigger[];
export function parseMarketingTrigger(config: unknown): { event: string; assetSlug: string; runAt?: string; timeZone?: string; tagName?: string; advanceAmount?: number; advanceUnit?: "minutes" | "hours" | "days"; birthdayTime?: string; leapDayPolicy?: "feb28" | "mar1"; customFieldId?: string; customFieldName?: string; customFieldType?: "DATE" | "DATE_TIME"; dateFieldTime?: string; statusFieldId?: string; statusFieldName?: string };
export function serializeMarketingTrigger(event: string, assetSlug: string, runAt?: string, timeZone?: string, tagName?: string, appointmentOffset?: { amount?: number; unit?: string }, birthdayOptions?: { time?: string; leapDayPolicy?: string }, dateFieldOptions?: { fieldId?: string; fieldName?: string; fieldType?: string; time?: string }, statusFieldOptions?: { fieldId?: string; fieldName?: string }): string;
export function isValidMarketingTriggerDateTime(value: unknown): boolean;
export function marketingTriggerMatches(config: unknown, asset: { kind: string; slug: string }, submission: { data?: Record<string, unknown> }): boolean;
export function isMarketingGhlContactTrigger(event: string): boolean;
export function marketingGhlContactTriggerMatches(config: unknown, webhookType: string): boolean;
