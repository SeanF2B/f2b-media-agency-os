import type { DnsRecordSpec, InboundMessage } from "../server/hosts";
export function signServiceAccountJwt(p: { clientEmail: string; privateKey: string; scope: string; subject?: string; now?: number }): Promise<string>;
export function createGoogleClient(serviceAccount: { client_email: string; private_key: string }, adminEmail: string, deps?: { fetchImpl?: typeof fetch; sleepImpl?: (ms: number) => Promise<void>; now?: () => number }): {
  name: "google";
  spfInclude: string;
  verify(): Promise<{ domains: string[] }>;
  addDomain(domain: string): Promise<unknown>;
  getDomain(domain: string): Promise<unknown>;
  verificationRecords(domain: string): Promise<DnsRecordSpec[]>;
  verifyDomain(domain: string): Promise<unknown>;
  serviceRecords(domain: string): DnsRecordSpec[];
  createMailbox(input: { email: string; firstName: string; lastName: string; password: string }): Promise<{ id?: string; primaryEmail?: string }>;
  mailboxReady(email: string): Promise<boolean>;
  sendMime(email: string, rawMime: string): Promise<{ accepted: boolean; id: string }>;
  inboxDelta(email: string, cursor: string): Promise<{ items: InboundMessage[]; cursor: string; primed: boolean; gap?: boolean }>;
};
export function normaliseGmailMessage(message: unknown): InboundMessage;
