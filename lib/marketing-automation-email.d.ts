export type StaffEmailConfig = { recipientStaffId: string; subject: string; body: string };

export function parseStaffEmailConfig(config: string): StaffEmailConfig | null;
export function emailTemplateFieldIds(template: string): string[];
export function renderStaffEmailTemplate(template: string, values: Record<string, unknown>, context?: { clientName?: string; formName?: string }): string;
