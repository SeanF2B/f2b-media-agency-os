export function ghlFunnelsV4Path(locationId: string, skip?: number, limit?: number): string;
export function ghlFunnelPagesV4Path(funnelId: string, locationId: string, skip?: number, limit?: number): string;
export function normalizeGhlFunnels(payload: unknown): unknown[];
export function normalizeGhlPages(payload: unknown): unknown[];
export function ghlProviderError(payload: unknown, status: number): string;
