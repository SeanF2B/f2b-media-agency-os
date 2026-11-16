export type Candidate = { variantId: string; seed: string; subject: string; body: string; missing?: string[] };
export type LintIssue = { level: "block" | "warn"; code: string; message: string };
export function fingerprint(text: string, size?: number): Set<string>;
export function serialiseFingerprint(set: Set<string>): string;
export function parseFingerprint(text: string): Set<string>;
export function similarity(a: Set<string>, b: Set<string>): number;
export function lintEmail(p: { subject?: string; body?: string; step?: number }): { ok: boolean; issues: LintIssue[] };
export function chooseFreshest(candidates: Candidate[], recent: Set<string>[], options?: { threshold?: number; step?: number }): { chosen: (Candidate & { print: Set<string>; maxSimilarity: number; lint: { ok: boolean; issues: LintIssue[] }; score: number }) | null; repetitive?: boolean; reason: string };
export function renderCandidates(p: { variants: Array<{ id: string; subject?: string; body: string }>; variables: Record<string, string>; openers?: string[]; enrollmentId: string; step: number; subjectFallback?: string }): Candidate[];
