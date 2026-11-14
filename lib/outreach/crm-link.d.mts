export const OPPORTUNITY_SOURCE: "Outreach";
export function opportunityKey(contactId: string): string;
export function emailThreadKey(p: { mailbox: string; prospect: string }): { channel: "email"; ourNumber: string; contact: string };
export function matchContact<T extends { email?: string; client_id?: string | null }>(candidates: T[], p: { email: string; clientId?: string | null }): T | null;
export function contactPatch(existing: Record<string, unknown>, incoming: Record<string, unknown>): Record<string, string>;
export function planPositiveReplyOpportunity(p: { existing: { id: string; stage_id: string; stage_category: "open" | "won" | "lost"; stage_position: number } | null; target: { pipelineId: string; stageId: string; stagePosition: number }; contactId?: string; contactName?: string; company?: string; campaignName?: string }): { op: "create" | "move" | "touch" | "none"; values?: Record<string, string>; reason?: string };
