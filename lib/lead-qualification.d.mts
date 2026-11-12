export function explicitExclusion(values: Record<string, unknown>, configuredRules: string): string;
export function verifyLeadCore(profile: { niche?: string; icp?: string; exclude?: string; areas?: string }, values: Record<string, unknown>): { keep: boolean; reason: string } | null;
