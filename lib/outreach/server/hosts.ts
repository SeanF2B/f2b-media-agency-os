// Interchangeable mail hosts. Everything above this file talks to the MailHost shape only,
// so Microsoft, Google (or a later SMTP/IMAP host) can be swapped per mailbox.
import { createMicrosoftClient } from "@/lib/outreach/providers/microsoft-graph.mjs";
import { createGoogleClient } from "@/lib/outreach/providers/google-workspace.mjs";
import { loadConnection, updateConnectionStatus } from "./store";

export type HostName = "microsoft" | "google";
export type InboundMessage = { id: string; messageId: string; threadRef: string; inReplyTo?: string; from: string; fromName: string; subject: string; text: string; headers?: Record<string, string>; receivedAt: string };
export type DnsRecordSpec = { type: string; name: string; content: string; priority?: number };

export interface MailHost {
  name: HostName;
  spfInclude: string;
  dkimSelectors: string[];
  verify(): Promise<Record<string, unknown>>;
  addDomain(domain: string): Promise<unknown>;
  verificationRecords(domain: string): Promise<DnsRecordSpec[]>;
  verifyDomain(domain: string): Promise<unknown>;
  serviceRecords(domain: string): Promise<DnsRecordSpec[]>;
  createMailbox(input: { email: string; displayName: string; firstName: string; lastName: string; password: string }): Promise<{ id?: string; userPrincipalName?: string; primaryEmail?: string }>;
  assignSeat(userRef: string): Promise<void>;
  mailboxReady(userRef: string): Promise<boolean>;
  updateName(userRef: string, name: { firstName: string; lastName: string }): Promise<void>;
  setPhoto(userRef: string, bytes: Uint8Array, contentType: string): Promise<void>;
  sendMime(userRef: string, raw: string): Promise<{ accepted: boolean }>;
  inboxDelta(userRef: string, cursor: string): Promise<{ items: InboundMessage[]; cursor: string; primed: boolean }>;
  seats(): Promise<Array<{ sku: string; free: number; total: number }>>;
}

export async function mailHost(ownerId: string, name: HostName): Promise<MailHost> {
  if (name === "microsoft") {
    const connection = await loadConnection<{ clientSecret: string }>(ownerId, "microsoft");
    if (!connection) throw new Error("Connect Microsoft 365 in Outreach → Infrastructure first.");
    const client = createMicrosoftClient({ tenantId: String(connection.config.tenantId || ""), clientId: String(connection.config.clientId || ""), clientSecret: connection.secret.clientSecret });
    let skuId = "";
    return {
      name, spfInclude: "spf.protection.outlook.com", dkimSelectors: ["selector1", "selector2"],
      verify: () => client.verify(),
      addDomain: (domain) => client.addDomain(domain),
      verificationRecords: (domain) => client.verificationRecords(domain),
      verifyDomain: (domain) => client.verifyDomain(domain),
      serviceRecords: (domain) => client.serviceRecords(domain),
      createMailbox: async (input) => client.createMailbox({ email: input.email, displayName: input.displayName, password: input.password }),
      async assignSeat(userRef) {
        if (!skuId) { const seats = await client.seats(); const free = seats.find((seat: { free: number }) => seat.free > 0); if (!free) throw Object.assign(new Error("No free Exchange Online seats. Buy one more seat in the Microsoft admin centre, then this step retries by itself."), { waiting: true }); skuId = free.skuId; }
        await client.assignLicense(userRef, skuId);
      },
      mailboxReady: (userRef) => client.mailboxReady(userRef),
      updateName: (userRef, name) => client.updateName(userRef, name),
      setPhoto: (userRef, bytes, type) => client.setPhoto(userRef, bytes, type),
      sendMime: (userRef, raw) => client.sendMime(userRef, raw),
      inboxDelta: (userRef, cursor) => client.inboxDelta(userRef, cursor),
      seats: () => client.seats(),
    };
  }
  const connection = await loadConnection<{ serviceAccount: { client_email: string; private_key: string } }>(ownerId, "google");
  if (!connection) throw new Error("Connect Google Workspace in Outreach → Infrastructure first.");
  const client = createGoogleClient(connection.secret.serviceAccount, String(connection.config.adminEmail || ""));
  return {
    name, spfInclude: "_spf.google.com", dkimSelectors: ["google"],
    verify: () => client.verify(),
    addDomain: (domain) => client.addDomain(domain),
    verificationRecords: (domain) => client.verificationRecords(domain),
    verifyDomain: (domain) => client.verifyDomain(domain),
    serviceRecords: async (domain) => client.serviceRecords(domain),
    createMailbox: (input) => client.createMailbox({ email: input.email, firstName: input.firstName, lastName: input.lastName, password: input.password }),
    assignSeat: async () => undefined, // Google bills seats automatically when a user is created.
    mailboxReady: (userRef) => client.mailboxReady(userRef),
    updateName: (userRef, name) => client.updateName(userRef, name),
    setPhoto: (userRef, bytes, type) => client.setPhoto(userRef, bytes, type),
    sendMime: (userRef, raw) => client.sendMime(userRef, raw),
    inboxDelta: (userRef, cursor) => client.inboxDelta(userRef, cursor),
    seats: async () => [],
  };
}

export async function verifyHost(ownerId: string, name: HostName) {
  try {
    const host = await mailHost(ownerId, name);
    const info = await host.verify();
    await updateConnectionStatus(ownerId, name, "ok");
    return { ok: true as const, info };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not verify the connection.";
    await updateConnectionStatus(ownerId, name, "error", message).catch(() => undefined);
    return { ok: false as const, error: message };
  }
}

/** Strong random password for a new mailbox (never shown; the OS sends via API). */
export function mailboxPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return `F2b!${btoa(String.fromCharCode(...bytes)).replace(/[^a-zA-Z0-9]/g, "").slice(0, 20)}9a`;
}
