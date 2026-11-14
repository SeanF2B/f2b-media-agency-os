export function contactVariables(contact?: Record<string, unknown>, extra?: Record<string, unknown>): Record<string, string>;
export function renderTemplate(template: string, variables: Record<string, string>, seed?: string): { text: string; missing: string[]; ok: boolean };
export function templateVariables(template: string): string[];
