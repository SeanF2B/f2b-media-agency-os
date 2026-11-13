"use client";
import { AiEyesIcon, AiIcon } from "./ai-eyes-icon";

import { Component, Fragment, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type Dispatch, type PointerEvent as ReactPointerEvent, type ReactNode, type SetStateAction } from "react";
import { fullTeamPermissions, getMemberPermissions, getTeamPermissions, type TeamPermissions } from "@/lib/access-permissions";
import { canOpenPage } from "@/lib/sidebar-access";
import { canViewAiAssignedTask, getAiTaskStage, isAiAssignedTask, isCompletedAiTask } from "@/lib/ai-task-access";
import { googleAdsDateSelectionFromMessage } from "@/lib/google-ads-date-range";
import { localTaskDueAt, localTimeFromIso, nextRecurringTaskDate } from "@/lib/task-recurrence";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { SiteLandingDomainCheck, SitePageMetadata } from "@/components/sites-view";
import { normalizeSitePagePlan, type SitePagePlan } from "@/lib/site-page-plan";
const ChessView = lazy(() => import("@/components/chess-view").then((module) => ({ default: module.ChessView })));
const SitesView = lazy(() => import("@/components/sites-view").then((module) => ({ default: module.SitesView })));
const SeoView = lazy(() => import("@/components/seo-view").then((module) => ({ default: module.SeoView })));
const GoogleAdsView = lazy(() => import("@/components/google-ads-view").then((module) => ({ default: module.GoogleAdsView })));
const MetaAdsView = lazy(() => import("@/components/meta-ads-view").then((module) => ({ default: module.MetaAdsView })));
const CustomApiKeysPanel = lazy(() => import("@/components/custom-api-keys-panel").then((module) => ({ default: module.CustomApiKeysPanel })));
const DomainsDnsView = lazy(() => import("@/components/domains-dns-view").then((module) => ({ default: module.DomainsDnsView })));
const IntegrationsView = lazy(() => import("@/components/integrations-view").then((module) => ({ default: module.IntegrationsView })));
const SettingsView = lazy(() => import("@/components/settings-view").then((module) => ({ default: module.SettingsView })));
import { MarketingStudioView } from "@/components/marketing-studio-view";
import { MediaLibraryView } from "@/components/media-library-view";
import { CrmView } from "@/components/crm-view";
import { CrmAutomationsView } from "@/components/crm-automations-view";
import { ConversationsView } from "@/components/conversations-view";
import { InvoicingView } from "@/components/invoicing-view";
import { PhoneActionIcon, toPhoneHref, toWhatsAppNumber, WhatsAppActionIcon } from "@/components/contact-action-icons";
import { createCardDragFx, showFxError, type CardDragFx } from "@/lib/card-drag-fx";
const FullMarketingAudit = lazy(() => import("@/components/full-marketing-audit").then((module) => ({ default: module.FullMarketingAudit })));
import type { MarketingAuditRun, MarketingService } from "@/lib/marketing-audit";
import { resolveAgencyLogoUrl } from "@/lib/report-branding";
import { upsertClientReport } from "@/lib/report-history";
import { reportSourceEvidenceHtml, summarizeReportSources } from "@/lib/report-source-summary.mjs";
import { loadChessSnapshot } from "@/lib/chess-offline-store";
import { fetchReadWithRetry, isSignInRequired, readApiJson } from "@/lib/read-api-json";
import { CURRENCIES, getDisplayCurrency, setDisplayCurrency } from "@/lib/display-currency";
import { estimatePersonalTax, estimateCompanyTax, taxCountry, TAX_COUNTRIES, type TaxSettings } from "@/lib/tax-rules";
import { BusinessSettings } from "@/components/business-settings";
import { BookkeepingConnections } from "@/components/bookkeeping-connections";
import { applyBranding, extractLogoColours, useBranding, type Branding } from "@/lib/branding";
import { approvalEvidenceBlockReason, canCloseAiTask, canResumeAiTaskRun, hasRunnablePendingApproval, isApprovalReady } from "@/lib/ai-task-lifecycle";
import { agentIconFor, withAgentIcon } from "@/lib/agent-icons";
import { GOOGLE_ADS_TASK_TEMPLATES, RETIRED_GOOGLE_ADS_TASK_TEMPLATE_IDS, defaultGoogleAdsTaskSettings, googleAdsTemplateEnabled, nextGoogleAdsTemplateDate, type GoogleAdsTaskSettings } from "@/lib/google-ads-task-templates";

type ServiceLine = { name: string; fee: number; mediaSpend: number; campaignName?: string; landingPageUrl?: string; landingPagePlatform?: "WordPress" | "GoHighLevel" | "Other" };
type ClientServiceFormRow = { id: string; name: string; campaignName: string; fee: string; mediaSpend: string; landingPageUrl?: string; landingPagePlatform?: "WordPress" | "GoHighLevel" | "Other" };
type CampaignSetup = { platform: string; name: string; objective: string; budget: number; status: string };
type TaxBookEntry = { id: string; kind: "Income" | "Expense"; date: string; description: string; category: string; amount: number };
type ClientTaxBooks = { businessType?: "sole_trader" | "company"; household?: "single" | "joint"; otherIncome?: number; feesFrom?: string; entries: TaxBookEntry[] };
type Client = { id: string; name: string; company: string; branding?: Partial<Branding>; currency?: string; tax?: TaxSettings; taxBooks?: ClientTaxBooks; contact: string; email: string; phone?: string; status: string; color: string; logo?: string; services: ServiceLine[]; seoServices?: string[]; seoLocations?: string[]; codexUrl: string; serviceChats?: Record<string, string>; monthlyBudget?: number; billingDay?: number; campaigns?: CampaignSetup[]; googleAdsAccountId?: string; googleAdsTaskSettings?: GoogleAdsTaskSettings; googleAdsCampaignTaskSettings?: Record<string, GoogleAdsTaskSettings>; metaAdsAccountId?: string; googleSearchConsoleAccountId?: string; googleAnalyticsAccountId?: string; googleBusinessProfileAccountId?: string; googleBusinessProfileLocationId?: string; wordpressSiteUrl?: string };
type Staff = { id: string; name: string; email: string; role: string; costRate: number; avatar: string; isBot?: boolean; agentPrompt?: string; aiModel?: string; permissions?: Partial<TeamPermissions>; clientAccessIds?: string[]; vaultAccessEntryIds?: string[]; aiModeAccess?: AiMode[] };
type Project = { id: string; clientId: string; name: string; status: string; due: string };
type AiMode = "Google Ads" | "Meta Ads" | "SEO" | "Audit" | "Research" | "Setup" | "Sites";
type TaskChecklistItem = { id: string; text: string; done: boolean; evidence?: string };
type AiApprovalItem = { id: string; checklistIndex: number; title: string; actionType: string; campaignId: string; campaignName: string; adGroupId?: string; adGroupName?: string; keyword?: string; matchType?: "EXACT" | "PHRASE" | "BROAD"; dailyBudget?: number; rationale: string; evidence: string; pendingChangeId: string; actionSignature?: string; feedback?: string; feedbackUpdatedAt?: string; status: "pending" | "applying" | "applied" | "rejected"; verification?: "verified" | "unverified"; startedAt?: string; decidedAt?: string; decidedBy?: string; resultDetail?: string };
type AiRecommendation = { id: string; category: string; title: string; detail: string; rationale: string; evidence: string; priority: "high" | "normal" | "low"; expectedImpact?: string; confidence?: "high" | "medium" | "low"; ownerFeedback?: string; ownerFeedbackChoices?: string[]; ownerFeedbackUpdatedAt?: string; ownerRefinementNote?: string; refinedAt?: string; refinementAlternatives?: string[]; followUpTaskId?: string; startedAt?: string; rejectedAt?: string; rejectedBy?: string; supersededAt?: string };
type AiLandingPageRecommendation = { id: string; url: string; section: string; currentCopy: string; suggestedCopy: string; rationale: string; evidence: string; expectedImpact?: string; confidence?: "high" | "medium" | "low"; ownerFeedback?: string; ownerFeedbackChoices?: string[]; ownerFeedbackUpdatedAt?: string; ownerRefinementNote?: string; refinedAt?: string; refinementAlternatives?: string[]; followUpTaskId?: string; startedAt?: string; rejectedAt?: string; rejectedBy?: string; supersededAt?: string };
const aiRecommendationIssueKey = (title: string, category: string, detail = "", url = "", section = "") => {
  const text = `${title} ${category} ${detail}`.toLowerCase().replace(/[’']/g, "");
  if (/change[\s-]?history|history access|change log|recent change access/.test(text)) return "google-ads-change-history-access";
  if (/account access|api permission|administrator access|account permission/.test(text)) return "account-access";
  if (url) return `page:${url.toLowerCase().replace(/https?:\/\//, "").replace(/\/$/, "")}:${section.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const normalized = title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter((word) => word && !["a", "an", "and", "the", "to", "for", "of", "in", "on", "with", "before", "after", "restore", "check", "review", "verify", "resolve", "google", "ads", "campaign", "campaigns", "account"].includes(word)).sort().join("-");
  return `${category.toLowerCase().replace(/[^a-z0-9]+/g, "-")}:${normalized || title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
};
// Google Ads' UI requires its internal account context ID (ocid), not the
// customer ID. These were read from Sean's signed-in Ads account selector.
const googleAdsUiAccountIds: Record<string, string> = {
  "3792470066": "6494761093",
  "5210289637": "6891985845",
  "3933495250": "7944677738",
  "7454677662": "8192143111",
  "9917943844": "270236359",
  "4010736588": "7041008364",
  "3012202162": "8529815436",
  "3073985700": "8608572604",
  "7277000372": "589836383",
};
function approvalIsLiveVerified(approval: AiApprovalItem) {
  const detail = approval.resultDetail || "";
  const detailVerified = /(?:Google|Meta) Ads (?:read[- ]back|readback) confirmed the (?:change|new copy|campaign status)/i.test(detail);
  const detailUnverified = /could not verify the final live state|not verified/i.test(detail);
  if (approval.verification) return approval.verification === "verified" && !detailUnverified;
  return detailVerified && !detailUnverified;
}
type TaskAttachment = { id: string; name: string; type: string; size: number; uploadedAt: string; uploadedBy: string; storageKey?: string };
type Task = { boardOrder?: number; id: string; clientId: string; projectId: string; title: string; assigneeId: string; status: string; priority: string; service: string; estimate: number; due?: string; dueAt?: string; completedAt?: string; createdAt?: string; pendingReason?: string; pendingReasonBy?: string; pendingReasonAt?: string; repeatTime?: string; recurrenceNoticePending?: boolean; recurrenceEmailStatus?: "pending" | "sent" | "blocked" | "failed" | "digest"; recurrenceEmailDetail?: string; createdById?: string; note?: string; notes?: string; aiInstructions?: string; aiFeedback?: string; aiCampaignNotes?: Array<{ campaignId: string; campaignName: string; note: string }>; aiRecommendations?: AiRecommendation[]; aiLandingPageRecommendations?: AiLandingPageRecommendation[]; aiReferenceFileId?: string; aiReferenceFileName?: string; wordpressDraftUrl?: string; wordpressDraftTitle?: string; sitePagePlan?: SitePagePlan; campaignId?: string; campaignName?: string; campaignContext?: string; googleAdsTemplateId?: string; googleAdsTemplateVersion?: number; checklist?: TaskChecklistItem[]; attachments?: TaskAttachment[]; aiApprovals?: AiApprovalItem[]; reviewStatus?: "submitted" | "approved" | "changes_requested"; reviewSubmittedAt?: string; reviewSubmittedBy?: string; reviewSubmissionNote?: string; reviewApproverId?: string; reviewDecidedAt?: string; reviewDecidedBy?: string; reviewNote?: string; reviewHistory?: Array<{ id: string; action: string; at: string; by: string; note?: string }>; aiReviewedAt?: string; aiReviewedBy?: string; aiRunStartedAt?: string; aiRunAttempt?: number; aiStartNowRequestedAt?: string; aiNotificationStatus?: "pending" | "sending" | "sent" | "blocked" | "failed" | "not_required"; aiNotificationDetail?: string; aiNotificationDismissedAt?: string; aiDismissedAt?: string; aiDismissedBy?: string; aiProgressText?: string; aiProgressAt?: string; aiCancelRequestedAt?: string; aiCancelRequestedBy?: string; aiCancelledAt?: string; aiCancelledBy?: string; repeat?: "None" | "Daily" | "Weekly" | "Fortnightly" | "Monthly"; seriesId?: string; occurrence?: number; aiMode?: AiMode; aiRunState?: "scheduled" | "running" | "completed" | "needs_review" | "needs_connection" | "failed" | "cancelled"; aiRunAt?: string; aiCompletedWithGaps?: boolean };
type TaskHistoryCardProps = { clientName: string; clientLogo?: string; hideClient?: boolean; fallbackIcon: string; service: string; assigneeName: string; title: string; status?: string; date?: string; children: ReactNode };
function TaskHistoryCard({ clientName, clientLogo, hideClient = false, fallbackIcon, service, assigneeName, title, status = "✅ Completed", date, children }: TaskHistoryCardProps) {
  return <article className="ai-review-card task-history-card">
    <header className="ai-review-card-head">
      <div className="ai-review-report-name">{!hideClient && <span className={`task-client-mark ${clientLogo ? "has-logo" : ""}`}>{clientLogo ? <img src={clientLogo} alt={`${clientName} logo`} /> : fallbackIcon}</span>}<div><span><AiIcon v={serviceIcons[service] || fallbackIcon} /> {hideClient ? "" : `${clientName} · `}{service}</span><h3>{title}</h3><small>{assigneeName}</small></div></div>
      <div className="ai-review-report-meta"><span className="ai-review-status">{status}</span>{date && <time>{new Date(date).toLocaleString("en-IE", { dateStyle: "medium", timeStyle: "short" })}</time>}</div>
    </header>
    {children}
  </article>;
}
type AdsCampaignOption = { id: string; name: string; status: string; dailyBudget?: string };
type GoogleAdsTaskScope = { clientId: string; campaignId: string; campaignName: string };
type AssistantTaskDraft = { clientId: string; service: string; title: string; due: string; dueAt?: string; repeat: Task["repeat"]; assigneeId: string; notes: string; campaignId?: string; campaignName?: string; aiReferenceFileId?: string; aiReferenceFileName?: string };
type Entry = { id: string; taskId: string; clientId: string; staffId: string; startAt: string; endAt: string; seconds: number; note: string; billable: boolean };
type FinanceRecord = { id: string; kind: "Income" | "Expense"; description: string; category: string; amount: number; date: string; clientId: string; seriesId?: string };
type FinanceRecurring = { id: string; kind: "Income" | "Expense"; description: string; category: string; amount: number; clientId: string; frequency: "Weekly" | "Monthly" | "Quarterly" | "Yearly"; nextDate: string; startDate?: string; endDate?: string; anchorDay?: number; anchorMonth?: number };
type Note = { id: string; clientId: string; taskId?: string; body: string; createdAt: string; authorId?: string; authorName?: string; authorAvatar?: string };
type ClientFile = { id: string; clientId: string; name: string; type: string; size: number; uploadedAt: string; uploadedBy?: string; key?: string; taskId?: string; taskTitle?: string };
type Vault = { salt: string; verifierIv: string; verifierCipher: string };
type VaultEntry = { id: string; clientId: string; iv: string; ciphertext: string; createdAt: string };
type DecryptedVaultEntry = { id: string; clientId: string; title: string; kind: string; username: string; secret: string; url: string; host?: string; port?: string; protocol?: string; path?: string; notes: string; createdAt: string };
type ReportTemplate = { id: string; name: string; source: string; instructions: string; formulas: string };
type GeneratedReport = { id: string; clientId: string; clientName: string; company?: string; templateName: string; title: string; period: string; text: string; generatedAt: string; logo?: string; color?: string; campaignId?: string; campaignName?: string; sourceData?: Record<string, unknown>; completedTasks?: Array<{ title: string; service: string; outcome: string }> };
type LeadProfile = { id: string; name: string; niche: string; icp: string; exclude: string; areas?: string; country?: string; regions?: string[]; cities?: string[]; icon?: string; iconColor?: string };
const leadLocationOptions: Record<string, { regions: string[]; cities: string[] }> = {
  Ireland: { regions: "Antrim,Armagh,Carlow,Cavan,Clare,Cork,Derry,Donegal,Down,Dublin,Fermanagh,Galway,Kerry,Kildare,Kilkenny,Laois,Leitrim,Limerick,Longford,Louth,Mayo,Meath,Monaghan,Offaly,Roscommon,Sligo,Tipperary,Waterford,Westmeath,Wexford,Wicklow".split(","), cities: "Dublin,Cork,Galway,Limerick,Waterford,Drogheda,Dundalk,Swords,Bray,Ennis,Tralee,Kilkenny".split(",") },
  "United Kingdom": { regions: "England,Scotland,Wales,Northern Ireland".split(","), cities: "London,Manchester,Birmingham,Leeds,Glasgow,Liverpool,Bristol,Edinburgh,Cardiff,Belfast,Newcastle,Sheffield".split(",") },
  "United States": { regions: "Alabama,Alaska,Arizona,California,Colorado,Florida,Georgia,Illinois,Massachusetts,New Jersey,New York,North Carolina,Ohio,Pennsylvania,Texas,Virginia,Washington".split(","), cities: "New York,Los Angeles,Chicago,Houston,Phoenix,Philadelphia,San Antonio,San Diego,Dallas,Austin,San Jose,Jacksonville".split(",") },
  Canada: { regions: "Alberta,British Columbia,Manitoba,New Brunswick,Newfoundland and Labrador,Nova Scotia,Ontario,Quebec,Saskatchewan".split(","), cities: "Toronto,Montreal,Vancouver,Calgary,Edmonton,Ottawa,Winnipeg,Quebec City,Hamilton,Halifax".split(",") },
  Australia: { regions: "Australian Capital Territory,New South Wales,Northern Territory,Queensland,South Australia,Tasmania,Victoria,Western Australia".split(","), cities: "Sydney,Melbourne,Brisbane,Perth,Adelaide,Gold Coast,Canberra,Newcastle,Hobart,Darwin".split(",") },
};
type OutscraperSearchReview = { savedProfile: LeadProfile; areas: string[]; terms: string[]; queries: string[]; allAvailable: boolean; onlyWithWebsite: boolean; resultLimit: number; negatives: string[] };
type LeadRow = { values: Record<string, string>; keep?: boolean; reason?: string; sourceRow: number };
type LeadList = { id: string; name: string; profileId: string; createdAt: string; rows: LeadRow[]; exports?: Array<{ format: "csv" | "xlsx"; createdAt: string }> };
type LeadQueueItem = { id: string; name: string; profileId: string; rows: LeadRow[]; status: "ready" | "running" | "done" | "error"; completedBatches: number; totalBatches: number; error?: string; saved?: boolean; previewOpen?: boolean };
type StudioSettings = { designFormula?: string };
type Activity = { id: string; title: string; detail: string; icon: string; at: string; actor: string; actorAvatar?: string; staffId?: string; clientId?: string; projectId?: string; taskId?: string; note?: string; durationSeconds?: number; service?: string; kind: "task" | "client" | "project" | "time" | "finance" | "note" | "team" | "workspace" };
type Workspace = { ownerId: string; settings: { adminEmail: string; currency: string; weekStarts: string; branding?: Partial<Branding>; tax?: TaxSettings }; staff: Staff[]; clients: Client[]; projects: Project[]; tasks: Task[]; entries: Entry[]; financeRecords: FinanceRecord[]; financeRecurring?: FinanceRecurring[]; notes: Note[]; files: ClientFile[]; vault: Vault | null; vaultEntries: VaultEntry[]; hiddenAiAgentIds?: string[]; reportTemplates?: ReportTemplate[]; generatedReports?: GeneratedReport[]; auditRuns?: MarketingAuditRun[]; sitePageMetadata?: SitePageMetadata[]; siteLandingDomainChecks?: SiteLandingDomainCheck[]; leadProfiles?: LeadProfile[]; leadLists?: LeadList[]; studioSettings?: StudioSettings; aiPrompts?: Partial<Record<AiMode, string>>; activity?: Activity[]; activeTimer: { taskId: string; staffId: string; startedAt: string } | null };
type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }> };
type GlobalAppError = { id: string; source: string; message: string; at: number; requiresSignIn?: boolean };
type SpeechRecognitionResult = { isFinal: boolean; 0: { transcript: string } };
type SpeechRecognitionLike = { lang: string; continuous: boolean; interimResults: boolean; onresult: ((event: { results: ArrayLike<SpeechRecognitionResult>; resultIndex: number }) => void) | null; onerror: ((event: { error: string }) => void) | null; onend: (() => void) | null; start: () => void; stop: () => void };
type SpeechWindow = Window & { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };

const serviceTypes = ["AI Automation", "Web Design & Development", "Google Ads", "Meta Ads", "SEO", "Debug", "CRM", "Miscellaneous"];
const taskCategories = [...serviceTypes, "Audit", "Research", "Setup", "Sites", "Lead Generation", "Sales", "Email Marketing"];
const serviceIcons: Record<string, string> = { "AI Automation": "🤖", "Web Design & Development": "🌐", "Google Ads": "📣", "Meta Ads": "📱", SEO: "🔎", Debug: "🐞", CRM: "👥", Miscellaneous: "🧩", Audit: "📋", Research: "🔬", Setup: "🛠️", Sites: "🌐", "Lead Generation": "🎯", Sales: "☎️", "Email Marketing": "📧" };
const serviceCardClasses: Record<string, string> = { "AI Automation": "ai-automation", "Web Design & Development": "web-design", "Google Ads": "google-ads", "Meta Ads": "meta-ads", SEO: "seo", Debug: "debug", CRM: "crm", Miscellaneous: "misc", Audit: "audit", Research: "research", Setup: "setup", "Lead Generation": "lead-generation", Sales: "sales", "Email Marketing": "email-marketing" };
function renderAssistantText(content: string) {
  return content.split("\n").map((line, lineIndex) => <Fragment key={lineIndex}>{lineIndex > 0 && <br />}{line.split(/(\*\*[^*]+\*\*)/g).map((part, partIndex) => part.startsWith("**") && part.endsWith("**") ? <strong key={partIndex}>{part.slice(2, -2)}</strong> : <Fragment key={partIndex}>{part}</Fragment>)}</Fragment>);
}
// Cards the team has dragged into a manual position keep it; other cards sit above them with Urgent/High priority first.
const priorityRank = (task: Task) => ({ Urgent: 0, High: 1, Normal: 2, Low: 3 } as Record<string, number>)[task.priority] ?? 4;
const byBoardOrder = (list: Task[]) => [...list.filter((task) => task.boardOrder == null).sort((a, b) => priorityRank(a) - priorityRank(b)), ...list.filter((task) => task.boardOrder != null).sort((a, b) => (a.boardOrder as number) - (b.boardOrder as number))];
const nav = [
  { key: "Overview", icon: "📊" }, { key: "Settings", icon: "⚙️" }, { key: "Clients", icon: "👥" }, { key: "CRM", icon: "🗂️" }, { key: "CRM Automations", icon: "⚡" }, { key: "Conversations", icon: "💬" }, { key: "Invoicing", icon: "💶" }, { key: "Tasks", icon: "✅" }, { key: "Lead Factory", icon: "🎯" }, { key: "Marketing", icon: "📣" }, { key: "Team", icon: "🧑‍💼" }, { key: "Chess", icon: "♟️" }, { key: "Activity", icon: "🕘" }, { key: "AI Assistant", icon: "" }, { key: "Integrations", icon: "🚀" },
];
const marketingPages: Array<{ key: string; label: string; icon: string }> = [
  { key: "Sites", label: "Websites", icon: "🌐" },
  { key: "Media Library", label: "Media Library", icon: "🖼️" },
  { key: "Tracking & Analytics", label: "Tracking & Analytics", icon: "📊" },
  { key: "SEO", label: "SEO", icon: "🔎" },
  { key: "Google Ads", label: "Google Ads", icon: "📣" },
  { key: "Email Marketing", label: "Email Marketing", icon: "✉️" },
  { key: "Cold Outreach", label: "Cold Outreach", icon: "📨" },
  { key: "Automations", label: "Marketing Automations", icon: "⚡" },
  { key: "Meta Ads", label: "Meta Ads", icon: "📱" },
  { key: "Proposal Studio", label: "Proposals", icon: "🎨" },
  { key: "Report Studio", label: "Reporting", icon: "📈" },
];
const marketingFoundationPages: Record<string, { title: string; summary: string; status: string; details: string[]; links: Array<{ label: string; page: string }> }> = {
  "Tracking & Analytics": { title: "Tracking & Analytics", summary: "A central place for client tracking setup and verification.", status: "Existing connections reused", details: ["GA4 and Search Console connections are handled through the existing Google reporting setup and client mappings.", "Google Ads reporting remains in Google Ads. A single cross-client tracking dashboard and live tag verification are not in place yet."], links: [{ label: "Open SEO", page: "SEO" }, { label: "Open Launchpad", page: "Integrations" }] },
  "Email Marketing": { title: "Email Marketing", summary: "Campaigns, audiences, templates and results for client email marketing.", status: "Provider not connected", details: ["The existing Resend connection is used for internal notifications; it is not a client campaign system.", "No email campaign provider, campaign editor, audience consent controls or campaign reporting were found in the current app."], links: [{ label: "Open Pipeline", page: "CRM" }, { label: "Open Launchpad", page: "Integrations" }] },
  "Cold Outreach": { title: "Cold Outreach", summary: "Manage outbound campaigns through the connected sending platform.", status: "Instantly not connected", details: ["No Instantly account connection or campaign synchronisation was found in the current app.", "Campaigns, mailboxes and reply metrics will only appear after a supported Instantly connection is added."], links: [{ label: "Open Lead Factory", page: "Lead Factory" }, { label: "Open Launchpad", page: "Integrations" }] },
};
function MarketingFoundationPage({ page, onNavigate }: { page: string; onNavigate: (page: string) => void }) {
  const data = marketingFoundationPages[page];
  if (!data) return null;
  return <section className="marketing-foundation-page" aria-labelledby="marketing-foundation-title"><div className="marketing-foundation-heading"><div><span className="eyebrow">MARKETING WORKSPACE</span><h1 id="marketing-foundation-title">{data.title}</h1><p>{data.summary}</p></div><span className="marketing-foundation-status">{data.status}</span></div><div className="marketing-foundation-grid">{data.details.map((detail, index) => <article className="marketing-foundation-card" key={detail}><span className="marketing-foundation-step">{index === 0 ? "CURRENT" : "GAP"}</span><p>{detail}</p></article>)}</div><div className="marketing-foundation-actions">{data.links.map((link) => <button type="button" key={link.page} onClick={() => onNavigate(link.page)}>{link.label} ↗</button>)}</div></section>;
}
const botTeammates: Staff[] = [{ id: "f2b-ai-agent", name: "AI Assistant", email: "", role: "AI teammate", costRate: 0, avatar: "", isBot: true, aiModeAccess: ["Google Ads", "Meta Ads", "SEO", "Audit", "Research", "Setup", "Sites"] }];
const retiredAiAgentIds = new Set(["f2b-audit-agent", "f2b-reporting-agent"]);
function publishAppError(message: string, source: string) {
  if (!message || typeof window === "undefined") return;
  if (/unexpected token\s+['\"]?<|<!doctype\s+html|not valid json|json parse error/i.test(message)) {
    message = `${source} couldn’t load this update. Your saved data is safe; try again in a moment.`;
  }
  const networkFailure = /^(failed to fetch|networkerror when attempting to fetch resource\.?|load failed)$/i.test(message.trim());
  if (networkFailure) message = source === "AI Assistant"
    ? "Couldn’t reach the AI Assistant. Check your connection or sign-in, then try again."
    : `Couldn’t reach ${source.toLowerCase()}. Check your connection or sign-in, then try again.`;
  window.dispatchEvent(new CustomEvent("f2b:app-error", { detail: { message, source, requiresSignIn: message.startsWith("Sign-in required:") } }));
}
function clearAppErrorNotice(source: string) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("f2b:app-error-cleared", { detail: { source } }));
}
function useGlobalErrorNotice(message: string, source: string) {
  useEffect(() => { if (message) publishAppError(message, source); }, [message, source]);
}
function useAppErrorState(source: string): [string, (message: string) => void] {
  const [message, setMessage] = useState("");
  const setError = useCallback((next: string) => {
    if (next) publishAppError(next, source);
    else clearAppErrorNotice(source);
    setMessage(next);
  }, [source]);
  return [message, setError];
}
function withAiTeammates(staff: Staff[], hiddenAiAgentIds: string[] = []) {
  const result = staff.filter((member) => !retiredAiAgentIds.has(member.id));
  for (const bot of botTeammates) {
    if (hiddenAiAgentIds.includes(bot.id)) continue;
    const existingIndex = result.findIndex((member) => member.id === bot.id);
    if (existingIndex < 0) result.push(bot);
    else if (bot.id === aiTeammate.id) {
      const existing = result[existingIndex];
      result[existingIndex] = { ...existing, aiModeAccess: [...new Set([...(existing.aiModeAccess || []), ...bot.aiModeAccess || []])] };
    }
  }
  return result.map(withAgentIcon);
}
const aiModes: { name: AiMode; icon: string; description: string }[] = [
  { name: "Google Ads", icon: "📣", description: "Search terms, wasted spend, negatives, ad relevance and CPC caps." },
  { name: "Meta Ads", icon: "📱", description: "Campaign, ad set and ad delivery, spend, clicks and platform-reported leads." },
  { name: "SEO", icon: "🔎", description: "Technical checks, sitemap, metadata, image alt text and local SEO." },
  { name: "Audit", icon: "🧾", description: "Find account, tracking, landing page and technical SEO issues." },
  { name: "Research", icon: "🕵️", description: "Research competitors across search, SEO and Meta Ad Library." },
  { name: "Setup", icon: "🛠️", description: "Guided setup for Ads, Business Profile and GoHighLevel." },
  { name: "Sites", icon: "🌐", description: "Build a WordPress page draft from your brief and optional image reference." },
];
const aiTeammate = botTeammates[0];
const permissionKeys: (keyof TeamPermissions)[] = ["overview", "clients", "tasks", "allTasks", "aiTasks", "aiApprovals", "aiCompletedTasks", "timesheets", "allTimesheets", "team", "vault", "finance", "aiAssistant", "clientActivity", "allActivity", "reports"];
const permissionLabels: Record<keyof TeamPermissions, string> = { overview: "Overview", clients: "Client details", projects: "Projects", tasks: "Assigned tasks", allTasks: "All team task cards", aiTasks: "AI task tab and active AI tasks", aiApprovals: "Google Ads change approvals", aiCompletedTasks: "AI task history and completed results", timesheets: "Timesheets", allTimesheets: "All team timesheets", team: "Team profiles", vault: "Client login vault", finance: "Agency income & expenses", aiAssistant: "AI Assistant", clientActivity: "Activity for permitted clients", allActivity: "All agency activity", reports: "Reports & templates" };
const permissionGroups: Array<{ title: string; keys: (keyof TeamPermissions)[] }> = [
  { title: "Clients and workspaces", keys: ["clients", "projects", "vault", "finance"] },
  { title: "Tasks and AI task tabs", keys: ["tasks", "allTasks", "aiTasks", "aiApprovals", "aiCompletedTasks"] },
  { title: "Activity and timesheets", keys: ["clientActivity", "allActivity", "timesheets", "allTimesheets"] },
  { title: "Team and assistant", keys: ["team", "aiAssistant"] },
  { title: "Reports", keys: ["reports"] },
];
function permissionFormValues(permissions: TeamPermissions) { return Object.fromEntries(permissionKeys.map((key) => [`permission_${key}`, String(permissions[key])])) as Record<string, string>; }
function selectedFormIds(form: Record<string, string>, key: string): string[] { try { const value = JSON.parse(form[key] || "[]"); return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; } catch { return []; } }
function parseObjectForm(value: string | undefined): Record<string, unknown> | null { try { const parsed = JSON.parse(value || ""); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null; } catch { return null; } }
function permissionsFromForm(form: Record<string, string>, role: string): TeamPermissions { const defaults = getTeamPermissions(role); const permissions = Object.fromEntries(permissionKeys.map((key) => [key, form[`permission_${key}`] === undefined ? defaults[key] : form[`permission_${key}`] === "true"])) as TeamPermissions; if (role !== "Owner") permissions.overview = false; if (!permissions.aiTasks) { permissions.aiApprovals = false; permissions.aiCompletedTasks = false; } return permissions; }
const emptyWorkspace = (): Workspace => ({ ownerId: "", settings: { adminEmail: "sean@f2bmedia.com", currency: "EUR", weekStarts: "Monday" }, staff: botTeammates, clients: [], projects: [], tasks: [], entries: [], financeRecords: [], financeRecurring: [], notes: [], files: [], vault: null, vaultEntries: [], hiddenAiAgentIds: [], reportTemplates: [], leadProfiles: [], leadLists: [], activity: [], activeTimer: null });
function ClientScopePicker({ value, clients, onChange }: { value: string; clients: Client[]; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => { if (event instanceof KeyboardEvent ? event.key === "Escape" : !rootRef.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close); document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [open]);
  const current = clients.find((item) => item.id === value);
  const badge = (client?: Client) => client ? <span className={`client-dot ${client.logo ? "has-logo" : ""}`} style={{ background: client.color }}>{client.logo ? <img src={client.logo} alt="" /> : initials(client.name).slice(0, 1)}</span> : <span className="client-dot agency-dot"><img src="/f2b-home-icon.png" alt="" /></span>;
  const pick = (id: string) => { onChange(id); setOpen(false); };
  return <div className="client-scope" ref={rootRef}>
    <label id="client-scope-label">Viewing</label>
    <button type="button" className="client-scope-trigger" aria-haspopup="listbox" aria-expanded={open} aria-labelledby="client-scope-label" onClick={() => setOpen((state) => !state)}>{badge(current)}<span className="client-scope-name">{current ? current.name : "Agency"}</span><span className="client-scope-caret" aria-hidden="true">▾</span></button>
    {open && <ul className="client-scope-menu" role="listbox" aria-labelledby="client-scope-label">
      <li><button type="button" role="option" aria-selected={!value} className={!value ? "active" : ""} onClick={() => pick("")}>{badge()}<span>Agency</span></button></li>
      {clients.map((client) => <li key={client.id}><button type="button" role="option" aria-selected={value === client.id} className={value === client.id ? "active" : ""} onClick={() => pick(client.id)}>{badge(client)}<span>{client.name}</span></button></li>)}
    </ul>}
  </div>;
}

function scopeWorkspaceToClient(workspace: Workspace, clientId: string): Workspace {
  if (!clientId) return workspace;
  const taskIds = new Set(workspace.tasks.filter((task) => task.clientId === clientId).map((task) => task.id));
  return {
    ...workspace,
    clients: workspace.clients.filter((client) => client.id === clientId),
    projects: workspace.projects.filter((project) => project.clientId === clientId),
    tasks: workspace.tasks.filter((task) => task.clientId === clientId),
    entries: workspace.entries.filter((entry) => entry.clientId === clientId || taskIds.has(entry.taskId)),
    financeRecords: workspace.financeRecords.filter((record) => record.clientId === clientId),
    financeRecurring: (workspace.financeRecurring || []).filter((record) => record.clientId === clientId),
    notes: workspace.notes.filter((note) => note.clientId === clientId),
    files: workspace.files.filter((file) => file.clientId === clientId),
    vaultEntries: workspace.vaultEntries.filter((entry) => entry.clientId === clientId),
    activity: (workspace.activity || []).filter((item) => item.clientId === clientId || (item.taskId ? taskIds.has(item.taskId) : false)),
    generatedReports: (workspace.generatedReports || []).filter((report) => report.clientId === clientId),
    auditRuns: (workspace.auditRuns || []).filter((run) => run.clientId === clientId),
  };
}

function previewWorkspaceForStaff(workspace: Workspace, member: Staff) {
  const permissions = getTeamPermissions(member.role, member.permissions);
  const scoped = Array.isArray(member.clientAccessIds);
  const allowedClientIds = new Set(scoped ? member.clientAccessIds! : workspace.clients.map((client) => client.id));
  const canAccessClient = (clientId: string | undefined) => !clientId || allowedClientIds.has(clientId);
  const allowedAiModes = Array.isArray(member.aiModeAccess) ? member.aiModeAccess : ["Google Ads", "Meta Ads", "SEO", "Audit", "Research", "Setup", "Sites"];
  const tasks = workspace.tasks.filter((task) => (isAiAssignedTask(task)
    ? canViewAiAssignedTask(task, permissions, allowedAiModes)
    : permissions.tasks && (permissions.allTasks || task.assigneeId === member.id || task.reviewApproverId === member.id)) && canAccessClient(task.clientId));
  const assignedClientIds = new Set(tasks.map((task) => task.clientId).filter(Boolean));
  const assignedProjectIds = new Set(tasks.map((task) => task.projectId).filter(Boolean));
  const clients = workspace.clients.filter((client) => canAccessClient(client.id) && (permissions.clients || assignedClientIds.has(client.id)));
  const visibleClientIds = new Set(clients.map((client) => client.id));
  const visibleTaskIds = new Set(tasks.map((task) => task.id));
  const projects = workspace.projects.filter((project) => canAccessClient(project.clientId) && (permissions.projects ? visibleClientIds.has(project.clientId) : assignedProjectIds.has(project.id)));
  const hiddenAiTaskIds = new Set(workspace.tasks.filter((task) => isAiAssignedTask(task) && !visibleTaskIds.has(task.id)).map((task) => task.id));
  const activity = permissions.allActivity ? (workspace.activity || []).filter((item) => !item.taskId || !hiddenAiTaskIds.has(item.taskId)) : (permissions.overview || permissions.clientActivity || permissions.timesheets) ? (workspace.activity || []).filter((item) => (!item.taskId || !hiddenAiTaskIds.has(item.taskId)) && (item.staffId === member.id || ((permissions.overview || permissions.clientActivity) && Boolean(item.clientId && visibleClientIds.has(item.clientId))) || Boolean(item.taskId && visibleTaskIds.has(item.taskId)))) : [];
  return {
    ...workspace,
    settings: { ...workspace.settings, adminEmail: "" },
    staff: permissions.team ? workspace.staff : workspace.staff.filter((staff) => staff.id === member.id),
    clients: permissions.clients || scoped ? clients : clients.map((client) => ({ ...client, company: "", contact: "", email: "", phone: "", services: [], seoServices: [], seoLocations: [], googleAdsAccountId: "", metaAdsAccountId: "", googleSearchConsoleAccountId: "", googleAnalyticsAccountId: "", googleBusinessProfileAccountId: "", googleBusinessProfileLocationId: "", wordpressSiteUrl: "" })),
    projects, tasks,
    entries: permissions.timesheets ? workspace.entries.filter((entry) => (permissions.allTimesheets || entry.staffId === member.id) && canAccessClient(entry.clientId)) : [],
    activeTimer: permissions.timesheets && (permissions.allTimesheets || workspace.activeTimer?.staffId === member.id) && canAccessClient(workspace.tasks.find((task) => task.id === workspace.activeTimer?.taskId)?.clientId) ? workspace.activeTimer : null,
    financeRecords: permissions.finance ? workspace.financeRecords.filter((record) => canAccessClient(record.clientId)) : [],
    financeRecurring: permissions.finance ? (workspace.financeRecurring || []).filter((record) => canAccessClient(record.clientId)) : [],
    activity,
    reportTemplates: permissions.reports ? workspace.reportTemplates || [] : [],
    generatedReports: permissions.reports ? (workspace.generatedReports || []).filter((report) => report.clientId && visibleClientIds.has(report.clientId)) : [],
    auditRuns: (workspace.auditRuns || []).filter((run) => visibleClientIds.has(run.clientId)),
    leadProfiles: [], leadLists: [], studioSettings: permissions.reports ? workspace.studioSettings || {} : {},
    notes: workspace.notes.filter((note) => (note.clientId ? visibleClientIds.has(note.clientId) : Boolean(note.taskId && visibleTaskIds.has(note.taskId))) && (!note.taskId || visibleTaskIds.has(note.taskId))),
    files: permissions.clients ? workspace.files.filter((file) => visibleClientIds.has(file.clientId)) : [],
    vault: permissions.vault ? workspace.vault : null,
    vaultEntries: permissions.vault ? workspace.vaultEntries.filter((entry) => visibleClientIds.has(entry.clientId) && (member.vaultAccessEntryIds || []).includes(entry.id)) : [],
  };
}
function StaffProfileAvatar({ member, className = "", fallbackName = "User" }: { member?: Staff; className?: string; fallbackName?: string }) {
  const avatar = (member && agentIconFor(member)) || member?.avatar || "";
  const image = avatar.startsWith("data:image/") || avatar.startsWith("https://");
  return <span className={`avatar ${className} ${member?.isBot && !image ? "ai-avatar" : ""}`} title={member?.name || fallbackName} style={image ? { backgroundImage: `url(${avatar})`, backgroundSize: "cover", color: "transparent" } : undefined}>{image ? "" : member?.isBot ? <AiEyesIcon /> : avatar || initials(member?.name || fallbackName)}</span>;
}
const uid = () => crypto.randomUUID();
function formatAiRunForDisplay(value: string) {
  return String(value || "")
    .replace(/Too many subrequests by single Worker invocation[^.]*\.?/gi, "This review needed more account data than could be loaded in one run, so it stopped safely. No account changes were made.")
    .replace(/(?:Provide|Need|Requires?)\s+(?:a\s+)?(?:working\s+)?shared[- ]note persistence tool[^.]*\.?/gi, "The app saves these findings to the client’s shared notes automatically.")
    .replace(/(?:The AI response request failed|The scheduled AI run could not finish):?\s*Too many subrequests[^.]*\.?/gi, "The AI needed more account data than could be loaded in one run, so it stopped safely. No account changes were made.")
    .replace(/(^|\n)\s*✅\s*/g, "$1VERIFIED · ")
    .replace(/(^|\n)\s*⬜\s*/g, "$1NEEDS DATA · ")
    .replace(/\b(VERIFIED ·|NEEDS DATA ·)\s*(\d+)\.\s*\2\.\s*/g, "$1 $2. ")
    .replace(/☐|☑|\[(?:\s|x|X)\]/g, "")
    .replace(/\n{3,}/g, "\n\n");
}
function auditCampaignNotes(task: Task) {
  if (task.aiCampaignNotes?.length) return task.aiCampaignNotes;
  const report = String(task.aiFeedback || "");
  const section = report.split("📊 CAMPAIGN PERFORMANCE")[1]?.split("🧩 SITELINKS & AD ASSETS")[0] || "";
  return section.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.startsWith("• ")).map((line, index) => {
    const fields = line.slice(2).split(" · ");
    const campaignName = fields[0]?.trim();
    if (!campaignName) return null;
    const metric = (pattern: RegExp) => line.match(pattern)?.[1]?.trim();
    const note = [fields[1], metric(/· ([^·]+ impressions)/), metric(/· ([^·]+ clicks)/), metric(/· ([^·]+ spend)/), metric(/· ([^·]+ conversions)/)].filter(Boolean).join(" · ") || "Campaign details are in the full audit report.";
    return { campaignId: task.campaignId && fields.length === 1 ? task.campaignId : `report-campaign-${index}`, campaignName, note: `${note}. Last 30 days.` };
  }).filter((item): item is { campaignId: string; campaignName: string; note: string } => Boolean(item));
}
function downloadAiTaskReport(task: Task) {
  const report = String(task.aiFeedback || "").trim();
  if (!report) return;
  const blob = new Blob([report], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const safeTitle = `${task.title || "AI task report"}`.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 80) || "ai-task-report";
  link.href = url;
  link.download = `${safeTitle}-report.txt`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function friendlyAiTaskReason(value: string) {
  const text = String(value || "").trim();
  if (/too many subrequests|subrequest limit|single worker invocation/i.test(text)) return "The AI needed more account data than could be loaded in one run, so it stopped safely. No account changes were made. The task is saved and can be retried.";
  if (/shared[- ]note persistence|persistence tool/i.test(text)) return "The app saves findings to the client’s shared notes automatically. This did not stop the task; review the saved notes and remaining checks.";
  if (/could not finish this task|scheduled AI run could not finish|AI response request failed/i.test(text)) return "The AI could not finish this task. It is still saved and open for review. No account changes were made.";
  if (/HTTP\s*(?:502|503|504)|temporarily unavailable|web page instead of data|incomplete data/i.test(text)) return "A connected service is temporarily unavailable. Your saved task and data are safe; the app will reconnect automatically.";
  if (/provide readable public-page snapshots|public-page snapshots|landing page.*(?:unavailable|missing)|visible CTA/i.test(text)) return "The AI could not verify every landing page for this campaign. Check the campaign’s saved page links, then retry.";
  if (/campaign-scoped.*(?:change|history|spend)|full spend report|alerts\/delivery/i.test(text)) return "Some Google Ads details needed for this review are not available from the current account connection. Reconnect Google Ads, then retry the task.";
  return formatAiRunForDisplay(text);
}
function cleanChecklistStep(value: string) {
  return String(value || "").replace(/☐|☑|⬜|✅|\[(?:\s|x|X)\]/g, "").replace(/^\s*\d+\.\s*/, "").trim();
}
const localDateKey = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
function nextFinanceOccurrence(date: string, frequency: FinanceRecurring["frequency"], anchorDay?: number, anchorMonth?: number) {
  const [year, month, day] = date.split("-").map(Number);
  if (frequency === "Weekly") { const next = new Date(year, month - 1, day + 7, 12); return localDateKey(next); }
  const monthIndex = month - 1 + (frequency === "Yearly" ? 12 : frequency === "Quarterly" ? 3 : 1);
  const targetYear = year + Math.floor(monthIndex / 12), targetMonth = monthIndex % 12;
  const chosenMonth = frequency === "Yearly" ? (anchorMonth || month) - 1 : targetMonth;
  const chosenYear = frequency === "Yearly" ? year + 1 : targetYear;
  const lastDay = new Date(chosenYear, chosenMonth + 1, 0).getDate();
  return localDateKey(new Date(chosenYear, chosenMonth, Math.min(anchorDay || day, lastDay), 12));
}
function previousFinanceOccurrence(date: string, frequency: FinanceRecurring["frequency"], anchorDay?: number, anchorMonth?: number) {
  const [year, month, day] = date.split("-").map(Number);
  if (frequency === "Weekly") return localDateKey(new Date(year, month - 1, day - 7, 12));
  const monthStep = frequency === "Quarterly" ? 3 : frequency === "Yearly" ? 12 : 1;
  const monthIndex = month - 1 - monthStep;
  const targetYear = year + Math.floor(monthIndex / 12), targetMonth = (monthIndex % 12 + 12) % 12;
  const chosenMonth = frequency === "Yearly" ? (anchorMonth || month) - 1 : targetMonth;
  const chosenYear = frequency === "Yearly" ? year - 1 : targetYear;
  const lastDay = new Date(chosenYear, chosenMonth + 1, 0).getDate();
  return localDateKey(new Date(chosenYear, chosenMonth, Math.min(anchorDay || day, lastDay), 12));
}
function recurringExpensesExpectedThisMonth(workspace: Workspace, today = new Date()) {
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const monthStartKey = localDateKey(monthStart), monthEndKey = localDateKey(monthEnd);
  return (workspace.financeRecurring || []).flatMap((schedule) => {
    if (schedule.kind !== "Expense" || !schedule.nextDate || !["Weekly", "Monthly", "Quarterly", "Yearly"].includes(schedule.frequency)) return [];
    let occurrence = schedule.nextDate;
    let guard = 0;
    while (occurrence > monthEndKey && guard++ < 120) occurrence = previousFinanceOccurrence(occurrence, schedule.frequency, schedule.anchorDay, schedule.anchorMonth);
    while (occurrence < monthStartKey && guard++ < 240) occurrence = nextFinanceOccurrence(occurrence, schedule.frequency, schedule.anchorDay, schedule.anchorMonth);
    const expected: { schedule: FinanceRecurring; date: string }[] = [];
    while (occurrence >= monthStartKey && occurrence <= monthEndKey && guard++ < 300) {
      if (schedule.startDate && occurrence < schedule.startDate) break;
      const alreadyRecorded = (workspace.financeRecords || []).some((record) => record.kind === "Expense" && record.date === occurrence && (record.seriesId === schedule.id || record.id === `recurring-${schedule.id}-${occurrence}`));
      if (!alreadyRecorded && (!schedule.endDate || occurrence <= schedule.endDate)) expected.push({ schedule, date: occurrence });
      if (!schedule.startDate) break;
      occurrence = previousFinanceOccurrence(occurrence, schedule.frequency, schedule.anchorDay, schedule.anchorMonth);
    }
    return expected;
  });
}
function currentMonthFinanceSummary(workspace: Workspace, today = new Date()) {
  const month = localDateKey(today).slice(0, 7);
  const monthlyRecords = (workspace.financeRecords || []).filter((record) => record.date.startsWith(month));
  const retainer = workspace.clients.reduce((sum, client) => sum + client.services.reduce((inner, service) => inner + service.fee, 0), 0);
  const recordedIncome = monthlyRecords.filter((record) => record.kind === "Income").reduce((sum, record) => sum + record.amount, 0);
  const recordedExpense = monthlyRecords.filter((record) => record.kind === "Expense").reduce((sum, record) => sum + record.amount, 0);
  const recurring = recurringExpensesExpectedThisMonth(workspace, today);
  const expectedExpense = recurring.reduce((sum, item) => sum + item.schedule.amount, 0);
  const businessExpenses = recordedExpense + expectedExpense;
  const labor = (workspace.entries || []).filter((entry) => localDateKey(new Date(entry.startAt)).startsWith(month)).reduce((sum, entry) => sum + entry.seconds / 3600 * (workspace.staff.find((member) => member.id === entry.staffId)?.costRate || 0), 0);
  const income = retainer + recordedIncome;
  return { retainer, recordedIncome, recordedExpense, recurring, expectedExpense, businessExpenses, labor, income, profit: income - businessExpenses - labor };
}
function formatTaskEstimate(hours: number) {
  const minutes = Math.max(0, Math.round((Number.isFinite(hours) ? hours : 0) * 60));
  if (!minutes) return "0m";
  const wholeHours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return wholeHours ? `${wholeHours}h${remainingMinutes ? ` ${remainingMinutes}m` : ""}` : `${remainingMinutes}m`;
}

function estimateIrishSoleTraderTax(profit: number, otherIncome: number, household: "single" | "joint") {
  const businessProfit = Math.max(0, profit);
  const other = Math.max(0, otherIncome);
  const standardBand = household === "joint" ? 53_000 : 44_000;
  const personalCredit = household === "joint" ? 4_000 : 2_000;
  const earnedIncomeCredit = Math.min(2_000, businessProfit * 0.2);
  const incomeTaxBeforeCredits = (income: number) => Math.min(income, standardBand) * 0.2 + Math.max(0, income - standardBand) * 0.4;
  const totalIncomeTax = Math.max(0, incomeTaxBeforeCredits(other + businessProfit) - personalCredit - earnedIncomeCredit);
  const baselineIncomeTax = Math.max(0, incomeTaxBeforeCredits(other) - personalCredit);
  const incomeTax = Math.max(0, totalIncomeTax - baselineIncomeTax);
  const usc = (income: number) => {
    if (income <= 13_000) return 0;
    return Math.min(income, 12_012) * 0.005 + Math.min(Math.max(0, income - 12_012), 16_688) * 0.02 + Math.min(Math.max(0, income - 28_700), 41_344) * 0.03 + Math.max(0, income - 70_044) * 0.08;
  };
  const universalSocialCharge = Math.max(0, usc(other + businessProfit) - usc(other));
  const prsi = businessProfit >= 5_000 ? Math.max(650, businessProfit * 0.042375) : 0;
  return { incomeTax, universalSocialCharge, prsi, total: incomeTax + universalSocialCharge + prsi, monthly: (incomeTax + universalSocialCharge + prsi) / 12 };
}
function seedActivity(data: Workspace): Activity[] {
  const entries: Activity[] = data.entries.map((entry) => {
    const task = data.tasks.find((item) => item.id === entry.taskId), client = data.clients.find((item) => item.id === entry.clientId), staff = data.staff.find((item) => item.id === entry.staffId);
    return { id: `legacy-time-${entry.id}`, title: "Time recorded", detail: `${task?.title || entry.note || "Timesheet entry"}${client?.name ? ` · ${client.name}` : ""}`, icon: "⏱️", at: entry.endAt || entry.startAt, actor: staff?.name || "Team member", actorAvatar: staff?.avatar, staffId: entry.staffId, clientId: entry.clientId || undefined, projectId: task?.projectId || undefined, taskId: entry.taskId || undefined, durationSeconds: entry.seconds, service: task?.service, kind: "time" };
  });
  const notes: Activity[] = data.notes.filter((note) => Boolean(note.createdAt)).map((note) => ({ id: `legacy-note-${note.id}`, title: note.taskId ? "Task work note added" : "Client work note added", detail: `${note.body.slice(0, 72)}${note.body.length > 72 ? "…" : ""} · ${data.tasks.find((task) => task.id === note.taskId)?.title || data.clients.find((client) => client.id === note.clientId)?.name || "Client"}`, icon: "📝", at: note.createdAt, actor: note.authorName || "Team member", actorAvatar: note.authorAvatar, clientId: note.clientId, taskId: note.taskId, kind: "note" }));
  return [...entries, ...notes].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 100);
}
function buildActivity(previous: Workspace, next: Workspace, fallback: string): Activity {
  const clientName = (id?: string) => next.clients.find((client) => client.id === id)?.name || previous.clients.find((client) => client.id === id)?.name || "Internal";
  const owner = next.staff.find((member) => member.id === next.ownerId) || previous.staff.find((member) => member.id === previous.ownerId);
  const changed = <T extends { id: string }>(before: T[], after: T[]) => ({ added: after.find((item) => !before.some((old) => old.id === item.id)), removed: before.find((item) => !after.some((current) => current.id === item.id)), updated: after.find((item) => before.some((old) => old.id === item.id && JSON.stringify(old) !== JSON.stringify(item))) });
  let title = fallback, detail = "Workspace update", icon = "✦", kind: Activity["kind"] = "workspace", clientId: string | undefined, projectId: string | undefined, taskId: string | undefined;
  let staffId: string | undefined, durationSeconds: number | undefined, explicitActorName: string | undefined, explicitActorAvatar: string | undefined;
  const taskChange = changed(previous.tasks, next.tasks);
  const completedTask = next.tasks.find((task) => task.status === "Done" && previous.tasks.some((old) => old.id === task.id && old.status !== "Done"));
  if (taskChange.added?.occurrence && taskChange.added.occurrence > 1) { const task = taskChange.added; const client = next.clients.find((item) => item.id === task.clientId); title = "Recurring task added to To do"; detail = `${task.title} · ${client?.name || "Internal"} · ${task.due || "No date"} ${task.repeatTime || "09:00"}`; icon = "🔁"; kind = "task"; clientId = task.clientId; projectId = task.projectId || undefined; taskId = task.id; }
  else if (completedTask) { title = "Task completed"; detail = completedTask.title; icon = "🎉"; kind = "task"; clientId = completedTask.clientId; projectId = completedTask.projectId || undefined; taskId = completedTask.id; }
  else if (taskChange.added) { const task = taskChange.added; title = "Task created"; detail = task.title; icon = "✅"; kind = "task"; clientId = task.clientId; projectId = task.projectId || undefined; taskId = task.id; }
  else if (taskChange.removed) { const task = taskChange.removed; title = "Task deleted"; detail = task.title; icon = "🗑️"; kind = "task"; clientId = task.clientId; projectId = task.projectId || undefined; taskId = task.id; }
  else if (taskChange.updated) {
    const task = taskChange.updated, old = previous.tasks.find((item) => item.id === task.id)!;
    title = old.note !== task.note ? (task.note ? (old.note ? "Task note updated" : "Task note added") : "Task note removed") : old.status !== task.status ? (task.status === "Done" ? "Task completed" : `Task moved to ${task.status === "Blocked" ? "Pending" : task.status}`) : "Task updated"; detail = task.title; icon = old.note !== task.note ? "📝" : task.status === "Done" ? "🎉" : "✅"; kind = old.note !== task.note ? "note" : "task"; clientId = task.clientId; projectId = task.projectId || undefined; taskId = task.id;
  } else {
    const clientChange = changed(previous.clients, next.clients);
    if (clientChange.added || clientChange.removed || clientChange.updated) { const client = clientChange.added || clientChange.removed || clientChange.updated!; title = clientChange.added ? "Client added" : clientChange.removed ? "Client removed" : "Client updated"; detail = client.name; icon = "👥"; kind = "client"; clientId = client.id; }
    else {
      const projectChange = changed(previous.projects, next.projects);
      if (projectChange.added || projectChange.removed || projectChange.updated) { const project = projectChange.added || projectChange.removed || projectChange.updated!; title = projectChange.added ? "Project created" : projectChange.removed ? "Project removed" : "Project updated"; detail = `${project.name} · ${clientName(project.clientId)}`; icon = "📁"; kind = "project"; clientId = project.clientId; projectId = project.id; }
      else if (next.entries.length > previous.entries.length) { const entry = next.entries.find((item) => !previous.entries.some((old) => old.id === item.id))!; const task = next.tasks.find((item) => item.id === entry.taskId); title = "Time recorded"; detail = task?.title || "Timesheet entry"; icon = "⏱️"; kind = "time"; clientId = entry.clientId; projectId = task?.projectId || undefined; taskId = entry.taskId; staffId = entry.staffId; durationSeconds = entry.seconds; }
      else if (next.financeRecords.length > previous.financeRecords.length) { const record = next.financeRecords.find((item) => !previous.financeRecords.some((old) => old.id === item.id))!; title = `${record.kind} added`; detail = record.description; icon = record.kind === "Income" ? "💶" : "💸"; kind = "finance"; clientId = record.clientId || undefined; }
      else if (next.notes.length > previous.notes.length) { const note = next.notes.find((item) => !previous.notes.some((old) => old.id === item.id))!; title = note.taskId ? "Task work note added" : "Client work note added"; detail = `${note.body.slice(0, 72)}${note.body.length > 72 ? "…" : ""} · ${note.taskId ? next.tasks.find((item) => item.id === note.taskId)?.title || "Task" : clientName(note.clientId)}`; icon = "📝"; kind = "note"; clientId = note.clientId || undefined; taskId = note.taskId; staffId = note.authorId; explicitActorName = note.authorName; explicitActorAvatar = note.authorAvatar; }
      else if (JSON.stringify(previous.staff) !== JSON.stringify(next.staff)) { title = "Team profile updated"; detail = "Agency team"; icon = "🧑‍💼"; kind = "team"; }
    }
  }
  const task = taskId ? next.tasks.find((item) => item.id === taskId) || previous.tasks.find((item) => item.id === taskId) : undefined;
  const newEntry = next.entries.find((entry) => !previous.entries.some((old) => old.id === entry.id) && (!taskId || entry.taskId === taskId));
  if (newEntry) { staffId = newEntry.staffId; durationSeconds = newEntry.seconds; }
  const actor = staffId ? next.staff.find((member) => member.id === staffId) || previous.staff.find((member) => member.id === staffId) : undefined;
  return { id: uid(), title, detail, icon, at: new Date().toISOString(), actor: explicitActorName || actor?.name || owner?.name || "Sean", actorAvatar: explicitActorAvatar || actor?.avatar || owner?.avatar, staffId, clientId, projectId, taskId, note: task?.notes, durationSeconds, service: task?.service, kind };
}
function nextRecurringTaskDueAt(task: Task, due: string): string | undefined {
  return localTaskDueAt(due, task.repeatTime || localTimeFromIso(task.dueAt));
}
function nextTemplateOrRecurringDate(task: Task) {
  const template = GOOGLE_ADS_TASK_TEMPLATES.find((item) => item.id === task.googleAdsTemplateId);
  return template ? nextGoogleAdsTemplateDate(template, new Date(), task.due) : nextRecurringTaskDate(task);
}
function recurringTaskTemplateEnabled(task: Task, clients: Client[]) {
  const template = GOOGLE_ADS_TASK_TEMPLATES.find((item) => item.id === task.googleAdsTemplateId);
  const client = clients.find((item) => item.id === task.clientId);
  return !template || googleAdsTemplateEnabled(task.campaignId ? client?.googleAdsCampaignTaskSettings?.[task.campaignId] || client?.googleAdsTaskSettings : client?.googleAdsTaskSettings, template);
}
const money = (n: number, currency = getDisplayCurrency()) => new Intl.NumberFormat("en-IE", { style: "currency", currency, maximumFractionDigits: 0 }).format(n || 0);
const initials = (s: string) => s.trim().split(/\s+/).slice(0, 2).map((v) => v[0]).join("").toUpperCase() || "F";
let taskUiAudioContext: AudioContext | null = null;
function playTaskUiSound(kind: "open" | "complete" | "move" | "drop") {
  if (typeof window === "undefined") return;
  const AudioContextClass = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return;
  try {
    taskUiAudioContext ||= new AudioContextClass();
    const context = taskUiAudioContext;
    if (context.state === "suspended") void context.resume();
    const notes = kind === "complete" ? [660, 880] : kind === "drop" ? [520, 740] : kind === "move" ? [520, 660] : [740];
    notes.forEach((frequency, index) => {
      const start = context.currentTime + index * 0.075;
      const oscillator = context.createOscillator();
      const volume = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, start);
      volume.gain.setValueAtTime(0.0001, start);
      volume.gain.exponentialRampToValueAtTime(kind === "open" ? 0.018 : kind === "drop" ? 0.022 : 0.028, start + 0.012);
      volume.gain.exponentialRampToValueAtTime(0.0001, start + (kind === "open" ? 0.055 : 0.11));
      oscillator.connect(volume);
      volume.connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + (kind === "open" ? 0.06 : 0.12));
    });
  } catch { /* Audio is a progressive enhancement; task actions still work when sound is unavailable. */ }
}

type BotGeo = { body: string; eyes: Array<{ x: number; y: number; w: number; h: number; url: string }>; mouthX: number; mouthY: number };
const botGeoCache = new Map<string, Promise<BotGeo | null>>();
// Cuts the two dark eyes out of an agent's own picture: the body is repainted without them and each eye becomes its own
// sprite, so the original icon looks identical while the eyes can move and the face can change expression.
function detectBotEyes(src: string): Promise<BotGeo | null> {
  const hit = botGeoCache.get(src); if (hit) return hit;
  const job = new Promise<BotGeo | null>((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const W = 128, H = 128, canvas = document.createElement("canvas"); canvas.width = W; canvas.height = H;
        const ctx = canvas.getContext("2d", { willReadFrequently: true })!; ctx.drawImage(img, 0, 0, W, H);
        const frame = ctx.getImageData(0, 0, W, H), data = frame.data;
        const lum = (i: number) => data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11;
        const dark = (x: number, y: number) => { const i = (y * W + x) * 4; return data[i + 3] > 200 && Math.max(data[i], data[i + 1], data[i + 2]) < 75; };
        const seen = new Uint8Array(W * H), comps: Array<{ x0: number; x1: number; y0: number; y1: number; n: number }> = [];
        for (let y = Math.round(H * 0.15); y < H * 0.85; y++) for (let x = Math.round(W * 0.1); x < W * 0.9; x++) {
          const k = y * W + x; if (seen[k] || !dark(x, y)) continue;
          const stack = [[x, y]]; seen[k] = 1; const c = { x0: x, x1: x, y0: y, y1: y, n: 0 };
          while (stack.length) { const [cx, cy] = stack.pop()!; c.n++; c.x0 = Math.min(c.x0, cx); c.x1 = Math.max(c.x1, cx); c.y0 = Math.min(c.y0, cy); c.y1 = Math.max(c.y1, cy);
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = cx + dx, ny = cy + dy, nk = ny * W + nx; if (nx >= 0 && ny >= 0 && nx < W && ny < H && !seen[nk] && dark(nx, ny)) { seen[nk] = 1; stack.push([nx, ny]); } } }
          if (c.n >= 30) comps.push(c);
        }
        comps.sort((p, q) => q.n - p.n);
        const first = comps[0]; const second = first && comps.slice(1).find((c) => Math.abs((c.y0 + c.y1) / 2 - (first.y0 + first.y1) / 2) < H * 0.14 && Math.abs((c.x0 + c.x1) / 2 - (first.x0 + first.x1) / 2) > W * 0.08);
        if (!first || !second) { resolve(null); return; }
        const pair = [first, second].sort((p, q) => p.x0 - q.x0), M = 4;
        // body colour from the ring around each eye
        const bodyRgb = (c: { x0: number; x1: number; y0: number; y1: number }) => { let r = 0, g = 0, b = 0, n = 0;
          for (let y = Math.max(0, c.y0 - 7); y <= Math.min(H - 1, c.y1 + 7); y++) for (let x = Math.max(0, c.x0 - 7); x <= Math.min(W - 1, c.x1 + 7); x++) {
            if (x >= c.x0 - M && x <= c.x1 + M && y >= c.y0 - M && y <= c.y1 + M) continue; const i = (y * W + x) * 4;
            if (data[i + 3] < 250 || Math.max(data[i], data[i + 1], data[i + 2]) < 75) continue; r += data[i]; g += data[i + 1]; b += data[i + 2]; n++; }
          return n ? [r / n, g / n, b / n] : [128, 128, 128]; };
        const bodyCanvas = document.createElement("canvas"); bodyCanvas.width = W; bodyCanvas.height = H;
        const bctx = bodyCanvas.getContext("2d")!; const bodyImg = bctx.createImageData(W, H); bodyImg.data.set(data);
        const eyes = pair.map((c) => {
          const [br, bg, bb] = bodyRgb(c), bl = br * 0.3 + bg * 0.59 + bb * 0.11;
          let el = 255, er = 0, eg = 0, eb = 0; for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) { const i = (y * W + x) * 4; const l = lum(i); if (l < el) { el = l; er = data[i]; eg = data[i + 1]; eb = data[i + 2]; } }
          const x0 = Math.max(0, c.x0 - M), x1 = Math.min(W - 1, c.x1 + M), y0 = Math.max(0, c.y0 - M), y1 = Math.min(H - 1, c.y1 + M), w = x1 - x0 + 1, h = y1 - y0 + 1;
          const sprite = document.createElement("canvas"); sprite.width = w; sprite.height = h; const sctx = sprite.getContext("2d")!, simg = sctx.createImageData(w, h);
          for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
            const i = (y * W + x) * 4; if (data[i + 3] < 200) continue;
            const a = Math.max(0, Math.min(1, (bl - lum(i)) / Math.max(1, bl - el)));
            if (a < 0.04) continue;
            const o = ((y - y0) * w + (x - x0)) * 4; simg.data[o] = er; simg.data[o + 1] = eg; simg.data[o + 2] = eb; simg.data[o + 3] = Math.round(a * 255);
            bodyImg.data[i] = br; bodyImg.data[i + 1] = bg; bodyImg.data[i + 2] = bb; bodyImg.data[i + 3] = data[i + 3];
          }
          sctx.putImageData(simg, 0, 0);
          return { x: (x0 + w / 2) / W, y: (y0 + h / 2) / H, w: w / W, h: h / H, url: sprite.toDataURL() };
        });
        bctx.putImageData(bodyImg, 0, 0);
        resolve({ body: bodyCanvas.toDataURL(), eyes, mouthX: (eyes[0].x + eyes[1].x) / 2, mouthY: (eyes[0].y + eyes[1].y) / 2 + Math.max(eyes[0].h, eyes[1].h) * 0.62 });
      } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
  botGeoCache.set(src, job); return job;
}
const DRAG_COPY_PROPS = ["display", "position", "box-sizing", "width", "height", "min-width", "min-height", "max-width", "margin", "padding", "border", "border-radius", "background", "background-color", "background-image", "background-size", "background-position", "color", "font", "letter-spacing", "line-height", "text-align", "text-transform", "white-space", "overflow", "text-overflow", "flex", "flex-direction", "flex-wrap", "align-items", "justify-content", "gap", "grid-template-columns", "opacity", "box-shadow", "object-fit", "fill", "stroke", "stroke-width", "visibility"];
const botEls = new Set<HTMLElement>();
let botMouseOn = false;
function ensureBotMouse() {
  if (botMouseOn || typeof window === "undefined") return; botMouseOn = true;
  let raf = 0, mx = 0, my = 0;
  const run = () => {
    raf = 0;
    if (document.body.classList.contains("task-card-drag-active")) return;
    const vh = window.innerHeight;
    botEls.forEach((el) => {
      const box = el.getBoundingClientRect(); if (box.bottom < -40 || box.top > vh + 40) return;
      const dx = mx - (box.left + box.width / 2), dy = my - (box.top + box.height / 2), len = Math.hypot(dx, dy) || 1, k = Math.min(1, len / 90);
      el.style.setProperty("--lx", ((dx / len) * k * 3).toFixed(2) + "px"); el.style.setProperty("--ly", ((dy / len) * k * 2.4).toFixed(2) + "px"); el.style.setProperty("--tx", ((dx / len) * k * 1.2).toFixed(2) + "px"); el.style.setProperty("--ta", ((dx / len) * k * 7).toFixed(1) + "deg");
    });
  };
  window.addEventListener("mousemove", (event) => { mx = event.clientX; my = event.clientY; if (!raf) raf = window.requestAnimationFrame(run); }, { passive: true });
}
function AnimatedBot({ status, member }: { status: string; member: Staff }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [geo, setGeo] = useState<BotGeo | null>(null);
  useEffect(() => {
    let live = true; const avatar = agentIconFor(member) || member.avatar || "";
    if (avatar.startsWith("data:image/") || avatar.startsWith("https://")) void detectBotEyes(avatar).then((g) => { if (live) setGeo(g); });
    return () => { live = false; };
  }, [member.avatar]);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    botEls.add(el); ensureBotMouse();
    return () => { botEls.delete(el); };
  }, []);
  const mood = status === "Done" ? "relax" : status === "Blocked" ? "bored" : status === "In progress" ? "run" : "eager";
  const pct = (n: number) => `${(n * 100).toFixed(2)}%`;
  return <span ref={ref} className={`bot-live bot-${mood} ${geo ? "bot-ready" : ""}`} title={`${member.name} · ${mood === "relax" ? "all done" : mood === "bored" ? "waiting" : mood === "run" ? "working on it" : "ready to go"}`}>
    <span className="bot-body">{geo ? <span className="avatar task-avatar bot-flat" style={{ backgroundImage: `url(${geo.body})`, backgroundSize: "cover" }} /> : <StaffProfileAvatar member={member} className="task-avatar" />}
      {geo && <>{geo.eyes.map((eye, index) => <img key={index} className="bot-pupil" alt="" src={eye.url} style={{ left: pct(eye.x), top: pct(eye.y), width: pct(eye.w), height: pct(eye.h) }} />)}<span className="bot-mouth" style={{ left: pct(geo.mouthX), top: pct(geo.mouthY) }} /></>}
    </span>
    {mood === "run" && <span className="bot-speed"><b /><b /><b /></span>}{mood === "bored" && <span className="bot-bubble">…</span>}
  </span>;
}
function BrandLogo({ className }: { className: string }) {
  const branding = useBranding();
  return <div className={`brand-lockup ${className}`}><img className="brand-icon-image" src={branding.logo || "/f2b-home-icon.png"} alt={branding.name || "F2B Media"} /></div>;
}
async function resizeClientLogo(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Please choose an image file.");
  if (file.size > 12 * 1024 * 1024) throw new Error("Please choose an image under 12 MB.");
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 320 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) { bitmap.close(); throw new Error("This image could not be prepared."); }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.88));
  if (!blob) throw new Error("This image could not be prepared.");
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("This image could not be saved."));
    reader.onerror = () => reject(new Error("This image could not be saved."));
    reader.readAsDataURL(blob);
  });
}
async function prepareAiTaskReference(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) throw new Error("Choose a PNG, JPG, WebP or GIF image.");
  if (file.size > 12 * 1024 * 1024) throw new Error("Choose an image smaller than 12 MB.");
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) { bitmap.close(); throw new Error("This image could not be prepared."); }
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  for (const quality of [0.82, 0.72, 0.62, 0.5]) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (blob && blob.size <= 900 * 1024) return new File([blob], `${file.name.replace(/\.[^.]+$/, "") || "design-reference"}.jpg`, { type: "image/jpeg" });
  }
  throw new Error("This image is still too large after resizing. Choose a smaller screenshot.");
}
const toB64 = (bytes: Uint8Array) => btoa(Array.from(bytes, (x) => String.fromCharCode(x)).join(""));
const fromB64 = (value: string) => Uint8Array.from(atob(value), (x) => x.charCodeAt(0));
async function deriveVaultKey(passphrase: string, salt: Uint8Array) {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt: Uint8Array.from(salt), iterations: 310000, hash: "SHA-256" }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
async function encryptVault(value: string, key: CryptoKey) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(value));
  return { iv: toB64(iv), ciphertext: toB64(new Uint8Array(data)) };
}
async function decryptVault(iv: string, ciphertext: string, key: CryptoKey) {
  const clear = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(iv) as BufferSource }, key, fromB64(ciphertext) as BufferSource);
  return new TextDecoder().decode(clear);
}

export function AgencyApp() {
  const [workspace, setWorkspace] = useState<Workspace>(emptyWorkspace());
  const workspaceLiveRef = useRef(workspace);
  if (workspace.settings?.currency) setDisplayCurrency(workspace.settings.currency);
  workspaceLiveRef.current = workspace;
  const approvalFeedbackTimers = useRef<Record<string, number>>({});
  const [page, setPage] = useState("Overview");
  const [marketingTab, setMarketingTab] = useState("Google Ads");
  const [settingsTab, setSettingsTab] = useState<"business" | "apis" | "dns">("business");
  const [sitesBuilderTab, setSitesBuilderTab] = useState<"Website" | "Landing Pages" | "Forms" | "Surveys">("Website");
  const [visitedPages, setVisitedPages] = useState(() => new Set(["Overview"]));
  useEffect(() => {
    setVisitedPages((current) => current.has(page) ? current : new Set([...current, page]));
  }, [page]);
  useEffect(() => {
    if (marketingPages.some((subpage) => subpage.key === page)) setMarketingTab(page);
  }, [page]);
  const [chessInvitePopup, setChessInvitePopup] = useState<{ id: string; challenger: string } | null>(null);
  const [chessInviteOpenId, setChessInviteOpenId] = useState<string | null>(null);
  const chessInviteSeenIds = useRef(new Set<string>());
  const chessInviteBaselineLoaded = useRef(false);
  const [offlineChessUserId, setOfflineChessUserId] = useState("");
  const [selectedClient, setSelectedClient] = useState("");
  const [reportToOpenId, setReportToOpenId] = useState("");
  const [reportContext, setReportContext] = useState<{ clientId: string; campaignId: string; campaignName: string; range: string; from: string; to: string } | null>(null);
  const [ready, setReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [googleCalendarStatus, setGoogleCalendarStatus] = useState<{ connected: boolean; accountEmail?: string; available?: boolean; syncedCount?: number } | null>(null);
  const [sessionUser, setSessionUser] = useState<{ id: string; email: string; name: string }>({ id: "", email: "", name: "" });
  const [previewMemberId, setPreviewMemberId] = useState("");
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [activityMenuOpen, setActivityMenuOpen] = useState(false);
  const [aiAssistantPopupOpen, setAiAssistantPopupOpen] = useState(false);
  useEffect(() => {
    if (!aiAssistantPopupOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setAiAssistantPopupOpen(false); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [aiAssistantPopupOpen]);
  const [access, setAccess] = useState<TeamPermissions>(getTeamPermissions("Viewer"));
  const [allowedAiModes, setAllowedAiModes] = useState<AiMode[]>([]);
  const [vaultKey, setVaultKey] = useState<CryptoKey | null>(null);
  const [vaultRows, setVaultRows] = useState<DecryptedVaultEntry[]>([]);
  const [vaultError, setVaultError] = useAppErrorState("Client login vault");
  const [activityTimeTab, setActivityTimeTab] = useState<"Activity" | "Timesheets">("Activity");
  const [saving, setSaving] = useState(false);
  const [recommendationFeedbackDrafts, setRecommendationFeedbackDrafts] = useState<Record<string, string>>({});
  const [startingRecommendationId, setStartingRecommendationId] = useState("");
  const [error, setError] = useAppErrorState("Workspace");
  const initialWorkspaceLoadFailed = useRef(false);
  const [globalErrors, setGlobalErrors] = useState<GlobalAppError[]>([]);
  const [aiTaskUpdatesUnavailable, setAiTaskUpdatesUnavailable] = useState(false);
  const [toast, setToast] = useState("");
  const [modal, setModal] = useState("");
  const [timerNow, setTimerNow] = useState(Date.now());
  const [darkMode, setDarkMode] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [showInstallHelp, setShowInstallHelp] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [staffInviteSending, setStaffInviteSending] = useState(false);
  const [staffInviteStatus, setStaffInviteStatus] = useState("");
  const [clientServiceRows, setClientServiceRows] = useState<ClientServiceFormRow[]>([]);
  const [serviceToAdd, setServiceToAdd] = useState("");
  const [taskCampaigns, setTaskCampaigns] = useState<AdsCampaignOption[]>([]);
  const [taskCampaignsLoading, setTaskCampaignsLoading] = useState(false);
  const [taskCampaignsError, setTaskCampaignsError] = useAppErrorState("Google Ads campaigns");
  const [googleAdsTaskModalSettings, setGoogleAdsTaskModalSettings] = useState<GoogleAdsTaskSettings>(defaultGoogleAdsTaskSettings());
  const [googleAdsTaskModalSetupNotice, setGoogleAdsTaskModalSetupNotice] = useState("");
  const [googleAdsTaskModalSetupSaving, setGoogleAdsTaskModalSetupSaving] = useState(false);

  useGlobalErrorNotice(form.avatarError || "", "Team profile image");
  useGlobalErrorNotice(form.logoError || "", "Client logo");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("page") === "Tasks" || params.has("taskId")) setPage("Tasks");
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get("metaAdsConnection");
    if (!status) return;
    params.delete("metaAdsConnection");
    const query = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
    if (status === "connected") {
      setPage("Meta Ads");
      setToast("Meta Ads connected directly. Choose its account and map it to the client.");
      window.setTimeout(() => setToast(""), 5000);
      return;
    }
    setPage("Meta Ads");
    const messages: Record<string, string> = { cancelled: "Meta Ads connection was cancelled.", "sign-in-required": "Sign in before connecting Meta Ads.", "admin-required": "Only an agency owner or admin can connect Meta Ads.", "workspace-unavailable": "The workspace could not be loaded during Meta Ads setup.", "token-exchange-failed": "Meta did not issue a long-lived access token. Check app permissions and try connecting again.", "oauth-failed": "Meta could not complete the connection. Confirm the app settings and redirect URL, then retry.", "not-configured": "Direct Meta Ads is not set up yet. Add META_APP_ID, META_APP_SECRET, and META_TOKEN_ENCRYPTION_KEY in Cloudflare Worker settings, then follow META-ADS-CONNECTION.md.", "version-not-configured": "Direct Meta Ads is missing META_MARKETING_API_VERSION in Cloudflare Worker settings." };
    publishAppError(messages[status] || "Meta Ads connection could not be completed.", "Meta Ads");
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get("searchConsoleConnection");
    if (!status) return;
    params.delete("searchConsoleConnection");
    const query = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
    setPage("SEO");
    const messages: Record<string, string> = {
      connected: "Google Search Console connected. Open SEO and choose Find properties to link each client site.",
      cancelled: "Search Console connection was cancelled.",
      "sign-in-required": "Sign in before connecting Search Console.",
      "admin-required": "Only an agency owner or admin can connect Search Console.",
      "workspace-unavailable": "The workspace could not be loaded during Search Console setup.",
      "refresh-token-missing": "Google did not return a long-term Search Console connection. Retry and approve the requested access.",
      "oauth-failed": "Google Search Console could not complete the connection. Confirm the Google account and try again.",
    };
    if (status === "connected") {
      setToast(messages[status]);
      window.setTimeout(() => setToast(""), 6500);
    } else publishAppError(messages[status] || "Search Console connection could not be completed.", "Google Search Console");
  }, []);

  useEffect(() => {
    const onAppError = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string; source?: string; requiresSignIn?: boolean }>).detail;
      if (!detail?.message) return;
      const message = detail.message;
      const source = detail.source || "Application";
      const now = Date.now();
      setGlobalErrors((current) => {
        const existing = current.find((item) => item.source === source);
        if (existing?.message === message) return current;
        return [{ id: existing?.id || uid(), source, message, at: now, requiresSignIn: detail.requiresSignIn }, ...current.filter((item) => item.source !== source)].slice(0, 2);
      });
    };
    const onAppErrorCleared = (event: Event) => {
      const detail = (event as CustomEvent<{ source?: string }>).detail;
      if (detail?.source) setGlobalErrors((current) => current.filter((item) => item.source !== detail.source));
    };
    const onUnexpectedError = (event: ErrorEvent) => {
      console.error("Unhandled application error", event.error || event.message);
      publishAppError("The app hit an unexpected error. Try that action again; if it repeats, refresh the page and note what you were doing.", "Unexpected error");
    };
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      console.error("Unhandled application promise rejection", event.reason);
      publishAppError("A background action failed unexpectedly. Try again; if it repeats, refresh the page and note what you were doing.", "Background action");
    };
    window.addEventListener("f2b:app-error", onAppError);
    window.addEventListener("f2b:app-error-cleared", onAppErrorCleared);
    window.addEventListener("error", onUnexpectedError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => {
      window.removeEventListener("f2b:app-error", onAppError);
      window.removeEventListener("f2b:app-error-cleared", onAppErrorCleared);
      window.removeEventListener("error", onUnexpectedError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);

  const selectedTaskAssignee = workspace.staff.find((member) => member.id === form.assigneeId);
  const isAiRun = modal === "task" && Boolean(selectedTaskAssignee?.isBot);
  const taskCampaignClientId = modal === "task" && ["Google Ads", "Meta Ads", "Audit"].includes(form.service || "") ? form.clientId || "" : "";
  useEffect(() => {
    if (modal !== "task" || form.service !== "Google Ads") return;
    const client = workspace.clients.find((item) => item.id === form.clientId);
    setGoogleAdsTaskModalSettings((form.campaignId ? client?.googleAdsCampaignTaskSettings?.[form.campaignId] : undefined) || client?.googleAdsTaskSettings || defaultGoogleAdsTaskSettings());
    setGoogleAdsTaskModalSetupNotice("");
  }, [modal, form.clientId, form.service, form.campaignId]);
  useEffect(() => {
    if (!taskCampaignClientId) { setTaskCampaigns([]); setTaskCampaignsLoading(false); setTaskCampaignsError(""); return; }
    const controller = new AbortController();
    setTaskCampaigns([]); setTaskCampaignsLoading(true); setTaskCampaignsError("");
    const campaignsUrl = form.service === "Meta Ads"
      ? `/api/meta-ads/workspace?clientId=${encodeURIComponent(taskCampaignClientId)}&section=campaigns&range=last_30d`
      : `/api/google-ads?campaignsForClient=${encodeURIComponent(taskCampaignClientId)}`;
    fetch(campaignsUrl, { cache: "no-store", signal: controller.signal })
      .then(async (response) => { const result = await response.json() as { campaigns?: AdsCampaignOption[]; rows?: Array<{ id: string; name: string; status: string }>; status?: string; message?: string; error?: string }; if (!response.ok || result.status && !["connected", "no_data"].includes(result.status)) throw new Error(result.error || result.message || "Could not load campaigns."); const campaigns = form.service === "Meta Ads" ? (result.rows || []).map((row) => ({ id: row.id, name: row.name, status: row.status })) : result.campaigns || []; if (!controller.signal.aborted) setTaskCampaigns(campaigns); })
      .catch((reason) => { if (!controller.signal.aborted) setTaskCampaignsError(reason instanceof Error ? reason.message : "Could not load campaigns."); })
      .finally(() => { if (!controller.signal.aborted) setTaskCampaignsLoading(false); });
    return () => controller.abort();
  }, [taskCampaignClientId, form.service]);

  useEffect(() => {
    if (modal !== "task" || !taskCampaignClientId || taskCampaignsLoading || !form.campaignName || !taskCampaigns.length) return;
    if (form.campaignId && taskCampaigns.some((campaign) => campaign.id === form.campaignId)) return;
    const matches = taskCampaigns.filter((campaign) => campaign.name.trim().toLocaleLowerCase() === String(form.campaignName).trim().toLocaleLowerCase());
    if (matches.length === 1) setForm((current) => ({ ...current, campaignId: matches[0].id, campaignName: matches[0].name }));
  }, [modal, taskCampaignClientId, taskCampaignsLoading, taskCampaigns, form.campaignId, form.campaignName]);

  useEffect(() => {
    const loadWorkspace = async () => {
      let lastError: unknown = new Error("Could not open the workspace.");
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          const response = await fetch("/api/workspace", { cache: "no-store" });
          const result = await readApiJson<{ data: Workspace; user?: { id: string; email: string; name: string }; canManage?: boolean; permissions?: TeamPermissions; aiModes?: string[]; error?: string }>(response, "Workspace");
          if (!response.ok) throw new Error(result.error || `Could not open the workspace (HTTP ${response.status}).`);
          return result;
        } catch (reason) {
          lastError = reason;
          if (isSignInRequired(reason)) break;
          if (attempt < 4) await new Promise((resolve) => window.setTimeout(resolve, 600 * (attempt + 1)));
        }
      }
      throw lastError;
    };
    loadWorkspace().then((j) => {
      const hiddenAiAgentIds = Array.isArray(j.data.hiddenAiAgentIds) ? j.data.hiddenAiAgentIds : [];
      const normalizedStaff = withAiTeammates(j.data.staff || [], hiddenAiAgentIds);
      const loadedActivity = (j.data.activity || []).filter((item: Activity) => !String(item.title || "").startsWith("Chess ")).map((item: Activity) => {
        if (typeof item.actorAvatar === "string" && item.actorAvatar.startsWith("data:image/")) {
          const { actorAvatar: _duplicateAvatar, ...compactItem } = item;
          return compactItem;
        }
        return item;
      });
      const loadedWorkspace: Workspace = { ...emptyWorkspace(), ...j.data, hiddenAiAgentIds, staff: normalizedStaff, files: j.data.files || [], vaultEntries: j.data.vaultEntries || [], financeRecords: j.data.financeRecords || [], activity: loadedActivity };
      const savedActivity = loadedWorkspace.activity || [];
      const historical = seedActivity(loadedWorkspace);
      for (const saved of savedActivity) {
        const match = historical.findIndex((item) => {
          const sameTask = Boolean(saved.taskId && item.taskId === saved.taskId);
          const sameClientAndDetail = item.clientId === saved.clientId && (item.detail === saved.detail || item.detail.startsWith(`${saved.detail} · `) || saved.detail.startsWith(`${item.detail} · `));
          return item.kind === saved.kind && (sameTask || sameClientAndDetail) && Math.abs(new Date(saved.at).getTime() - new Date(item.at).getTime()) < 24 * 60 * 60_000;
        });
        if (match >= 0) historical.splice(match, 1);
      }
      const seenActivity = new Set<string>();
      loadedWorkspace.activity = [...savedActivity, ...historical]
        .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
        .filter((item) => {
          const minute = Math.floor(new Date(item.at).getTime() / 60_000);
          const key = [item.kind, item.clientId || "", item.taskId || "", item.actor, item.detail, minute].join("|");
          if (seenActivity.has(key)) return false;
          seenActivity.add(key);
          return true;
        })
        .slice(0, 100);
      setWorkspace(loadedWorkspace);
      const resolvedUser = j.user || { id: loadedWorkspace.ownerId, email: loadedWorkspace.settings.adminEmail, name: "Workspace owner" };
      setSessionUser(resolvedUser);
      try { if (resolvedUser.id) sessionStorage.setItem("f2b-chess-user", resolvedUser.id); } catch { /* Session storage is optional; online workspace access must still work. */ }
      setOfflineChessUserId("");
      setIsAdmin(Boolean(j.canManage));
      const permissions = j.permissions || (j.canManage ? getTeamPermissions("Admin") : getTeamPermissions("Viewer"));
      setAccess(permissions);
      setAllowedAiModes(Array.isArray(j.aiModes) ? j.aiModes.filter((mode: string): mode is AiMode => aiModes.some((item) => item.name === mode)) : j.canManage ? aiModes.map((item) => item.name) : []);
      setActivityTimeTab(permissions.overview || permissions.clientActivity || permissions.allActivity ? "Activity" : "Timesheets");
      setPage(permissions.overview ? "Overview" : permissions.tasks ? "Tasks" : permissions.clients ? "Clients" : permissions.timesheets ? "Activity" : permissions.aiAssistant ? "AI Assistant" : permissions.reports ? "Reports" : permissions.team ? "Team" : "Overview");
      setReady(true);
    }).catch(async (e) => {
      initialWorkspaceLoadFailed.current = true;
      let cachedUserId = "";
      try { cachedUserId = sessionStorage.getItem("f2b-chess-user") || ""; } catch { /* Offline recovery is unavailable when browser storage is blocked. */ }
      const cachedChess = cachedUserId ? await loadChessSnapshot(cachedUserId).catch(() => null) : null;
      if (cachedUserId && cachedChess?.games?.length) {
        setOfflineChessUserId(cachedUserId);
        setSessionUser({ id: cachedUserId, email: "", name: "Signed-in player" });
        setPage("Chess");
        setError("");
      } else setError(e instanceof Error ? e.message : "Could not open the workspace.");
      setReady(true);
    });
  }, []);

  useEffect(() => {
    if (!ready || saving) return;
    let cancelled = false;
    let inFlight = false;
    let refreshFailureReported = false;
    const controller = new AbortController();
    let retryTimer = 0;
    let nextDelay = 30_000;
    const refresh = async () => {
      if (document.hidden || saving || inFlight) return;
      inFlight = true;
      try {
        const response = await fetchReadWithRetry("/api/workspace", { cache: "no-store", signal: controller.signal });
        const payload = await readApiJson<{ data?: Workspace; user?: { id: string; email: string; name: string }; error?: string; aiModes?: string[]; canManage?: boolean; permissions?: TeamPermissions }>(response, "Workspace");
        if (!response.ok || !payload.data) throw new Error(payload.error || `Workspace refresh failed (HTTP ${response.status}).`);
        if (cancelled) return;
        refreshFailureReported = false;
        clearAppErrorNotice("Workspace sync");
        setError("");
        nextDelay = 30_000;
        const workspaceData = payload.data;
        setAllowedAiModes(Array.isArray(payload.aiModes) ? payload.aiModes.filter((mode: string): mode is AiMode => aiModes.some((item) => item.name === mode)) : payload.canManage ? aiModes.map((item) => item.name) : []);
        const hiddenAiAgentIds = Array.isArray(workspaceData.hiddenAiAgentIds) ? workspaceData.hiddenAiAgentIds : [];
        const staff = withAiTeammates(workspaceData.staff || [], hiddenAiAgentIds);
        setWorkspace((current) => cancelled ? current : { ...current, ...workspaceData, hiddenAiAgentIds, staff, files: workspaceData.files || [], vaultEntries: workspaceData.vaultEntries || [], financeRecords: workspaceData.financeRecords || [], activity: workspaceData.activity || [] });
        if (initialWorkspaceLoadFailed.current) {
          const manager = Boolean(payload.canManage);
          const permissions = payload.permissions || (manager ? fullTeamPermissions : getTeamPermissions("Viewer"));
          initialWorkspaceLoadFailed.current = false;
          setSessionUser(payload.user || { id: workspaceData.ownerId || "", email: workspaceData.settings?.adminEmail || "", name: "Workspace owner" });
          setIsAdmin(manager); setAccess(permissions);
          setActivityTimeTab(permissions.overview || permissions.clientActivity || permissions.allActivity ? "Activity" : "Timesheets");
          setPage(permissions.overview ? "Overview" : permissions.tasks ? "Tasks" : permissions.clients ? "Clients" : permissions.timesheets ? "Activity" : permissions.aiAssistant ? "AI Assistant" : permissions.reports ? "Reports" : permissions.team ? "Team" : "Overview");
          setError("");
        }
      } catch (reason) {
        if (controller.signal.aborted || cancelled) return;
        if (isSignInRequired(reason) && !refreshFailureReported) {
          refreshFailureReported = true;
          publishAppError(reason instanceof Error ? reason.message : "Could not refresh workspace data. Your screen may be out of date.", "Workspace sync");
        }
        nextDelay = Math.min(Math.max(nextDelay, 30_000) * 2, 5 * 60_000);
      } finally {
        inFlight = false;
        if (!cancelled) retryTimer = window.setTimeout(() => void refresh(), nextDelay);
      }
    };
    if (initialWorkspaceLoadFailed.current) void refresh();
    else retryTimer = window.setTimeout(() => void refresh(), nextDelay);
    const onVisibility = () => { if (!document.hidden) { window.clearTimeout(retryTimer); void refresh(); } };
    document.addEventListener("visibilitychange", onVisibility);
    return () => { cancelled = true; controller.abort(); window.clearTimeout(retryTimer); document.removeEventListener("visibilitychange", onVisibility); };
  }, [ready, saving, page]);

  useEffect(() => {
    if (!ready || page !== "Tasks") return;
    let cancelled = false;
    let inFlight = false;
    let failures = 0;
    let timer = 0;
    const controller = new AbortController();
    const scheduleNext = (delay: number) => {
      window.clearTimeout(timer);
      if (!cancelled) timer = window.setTimeout(() => void refreshAiTasks(), delay);
    };
    const refreshAiTasks = async () => {
      if (cancelled || document.hidden || inFlight) return;
      inFlight = true;
      let nextDelay = 15_000;
      try {
        const response = await fetchReadWithRetry("/api/tasks/live", { cache: "no-store", signal: controller.signal });
        const payload = await readApiJson<{ tasks?: Task[]; clients?: Client[]; error?: string }>(response, "AI task sync");
        if (!response.ok) throw new Error(payload.error || "Could not refresh live AI task progress.");
        if (!Array.isArray(payload.tasks) || !Array.isArray(payload.clients)) throw new Error("AI task sync could not load the latest update.");
        if (cancelled) return;
        failures = 0;
        setAiTaskUpdatesUnavailable(false);
        const liveTasks = payload.tasks;
        const liveClients = payload.clients;
        const refreshedTasks = new Map(liveTasks.map((task) => [task.id, task]));
        setWorkspace((current) => {
          if (cancelled) return current;
          const clientsById = new Map(current.clients.map((client) => [client.id, client]));
          for (const client of liveClients) clientsById.set(client.id, { ...clientsById.get(client.id), ...client } as Client);
          const existingAiTaskIds = new Set(current.tasks.filter(isAiAssignedTask).map((task) => task.id));
          const tasks = current.tasks.map((task) => {
            if (!isAiAssignedTask(task)) return task;
            const refreshed = refreshedTasks.get(task.id);
            return refreshed ? { ...task, ...refreshed } : task;
          });
          for (const task of liveTasks) if (!existingAiTaskIds.has(task.id)) tasks.push(task);
          return { ...current, clients: [...clientsById.values()], tasks };
        });
      } catch (reason) {
        if (controller.signal.aborted || cancelled) return;
        failures += 1;
        nextDelay = Math.min(15_000 * (2 ** Math.min(failures, 3)), 120_000);
        if (failures >= 3) setAiTaskUpdatesUnavailable(true);
      } finally {
        inFlight = false;
        scheduleNext(nextDelay);
      }
    };
    const onVisibility = () => { if (!document.hidden) void refreshAiTasks(); };
    void refreshAiTasks();
    document.addEventListener("visibilitychange", onVisibility);
    return () => { cancelled = true; controller.abort(); window.clearTimeout(timer); document.removeEventListener("visibilitychange", onVisibility); };
  }, [ready, page]);

  useEffect(() => { setDarkMode(window.localStorage.getItem("f2b-dark-mode") === "true"); }, []);
  useEffect(() => {
    void navigator.serviceWorker?.register("/sw.js").catch(() => undefined);
    const onInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onInstall);
    return () => window.removeEventListener("beforeinstallprompt", onInstall);
  }, []);
  const installApp = async () => {
    if (!installPrompt) { setShowInstallHelp(true); return; }
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") setInstallPrompt(null);
  };
  const toggleDarkMode = () => setDarkMode((current) => {
    const next = !current;
    window.localStorage.setItem("f2b-dark-mode", String(next));
    return next;
  });

  useEffect(() => {
    if (!workspace.activeTimer && !workspace.tasks.some((task) => task.aiRunState === "running" && task.aiRunStartedAt)) return;
    const id = window.setInterval(() => setTimerNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [workspace.activeTimer]);

  const persist = useCallback(async (next: Workspace, message = "Saved") => {
    if (previewMemberId) { setError("Exit staff preview before making workspace changes."); return false; }
    const currentWorkspace = workspaceLiveRef.current;
    const at = new Date().toISOString();
    const previousTasks = new Map((currentWorkspace.tasks || []).map((task) => [task.id, task]));
    const nextWithCompletion = { ...next, tasks: next.tasks.map((task) => {
      const before = previousTasks.get(task.id);
      if (task.status === "Done" && before?.status !== "Done") return { ...task, completedAt: at };
      if (task.status !== "Done" && before?.status === "Done") return { ...task, completedAt: undefined };
      return task;
    }) };
    const event = buildActivity(currentWorkspace, nextWithCompletion, message);
    const saved = { ...nextWithCompletion, activity: [event, ...(nextWithCompletion.activity || currentWorkspace.activity || [])].slice(0, 100) };
    workspaceLiveRef.current = saved;
    setWorkspace(saved); setSaving(true); setError("");
    try {
      const r = await fetch("/api/workspace", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(saved) });
      const j = await r.json() as { error?: string };
      if (!r.ok) throw new Error(j.error || "Could not save the change.");
      setToast(message); window.setTimeout(() => setToast(""), 2200);
      const beforeTasks = new Map((currentWorkspace.tasks || []).map((task) => [task.id, task]));
      const afterTasks = new Map((next.tasks || []).map((task) => [task.id, task]));
      const syncFields = (task: Task) => JSON.stringify([task.title, task.clientId, task.service, task.priority, task.assigneeId, task.due]);
      const changedCalendarTaskIds = [...(next.tasks || []).filter((task) => { const previous = beforeTasks.get(task.id); return task.due && (!previous || syncFields(previous) !== syncFields(task)); }).map((task) => task.id), ...(currentWorkspace.tasks || []).filter((task) => !afterTasks.has(task.id)).map((task) => task.id), ...(next.tasks || []).filter((task) => !task.due && beforeTasks.get(task.id)?.due).map((task) => task.id)];
      if (changedCalendarTaskIds.length) void fetch("/api/google-calendar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ taskIds: [...new Set(changedCalendarTaskIds)] }) }).then(async (syncResponse) => { const syncResult = await syncResponse.json() as { connected?: boolean; synced?: number; removed?: number; error?: string }; if (!syncResponse.ok) throw new Error(syncResult.error || "Calendar sync failed."); if (syncResult.connected && syncResult.synced) { setToast(`${message} · Calendar updated`); window.setTimeout(() => setToast(""), 2600); } }).catch((error) => { setError(`Task saved, but Google Calendar did not update: ${error instanceof Error ? error.message : "Please reconnect Google Calendar."}`); });
      return true;
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save the change."); return false; }
    finally { setSaving(false); }
  }, [previewMemberId]);

  const updateApprovalFeedback = useCallback((taskId: string, approvalId: string, feedback: string) => {
    if (previewMemberId || !isAdmin) return;
    const key = `${taskId}:${approvalId}`;
    const next: Workspace = { ...workspaceLiveRef.current, tasks: workspaceLiveRef.current.tasks.map((task) => task.id !== taskId ? task : { ...task, aiApprovals: (task.aiApprovals || []).map((approval) => approval.id === approvalId ? { ...approval, feedback } : approval) }) };
    workspaceLiveRef.current = next;
    setWorkspace(next);
    window.clearTimeout(approvalFeedbackTimers.current[key]);
    approvalFeedbackTimers.current[key] = window.setTimeout(async () => {
      try {
        const feedbackUpdatedAt = new Date().toISOString();
        const latest: Workspace = { ...workspaceLiveRef.current, tasks: workspaceLiveRef.current.tasks.map((task) => task.id !== taskId ? task : { ...task, aiApprovals: (task.aiApprovals || []).map((approval) => approval.id === approvalId ? { ...approval, feedbackUpdatedAt } : approval) }) };
        workspaceLiveRef.current = latest;
        setWorkspace(latest);
        const response = await fetch("/api/workspace", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(latest) });
        const result = await response.json() as { error?: string };
        if (!response.ok) throw new Error(result.error || "Feedback could not be saved.");
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Approval feedback could not be saved.");
      }
    }, 650);
  }, [isAdmin, previewMemberId]);

  const saveRecommendationFeedback = async (taskId: string, recommendationId: string, feedback: string, choices: string[] = []): Promise<{ ok: boolean; message?: string }> => {
    if (!isAdmin || previewMemberId) return { ok: false, message: "Only the workspace owner or admin can save this." };
    try {
      const response = await fetch("/api/tasks/recommendations/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ taskId, recommendationId, feedback: feedback.trim().slice(0, 500), choices: choices.slice(0, 8) }) });
      const result = await response.json().catch(() => null) as { error?: string; savedAt?: string } | null;
      if (!response.ok || !result?.savedAt) throw new Error(result?.error || "Couldn’t save. Your note is still here—try again.");
      const current = workspaceLiveRef.current;
      const savedAt = result.savedAt;
      const next = { ...current, tasks: current.tasks.map((item) => item.id !== taskId ? item : { ...item,
        aiRecommendations: (item.aiRecommendations || []).map((recommendation) => recommendation.id === recommendationId ? { ...recommendation, ownerFeedback: feedback.trim().slice(0, 500), ownerFeedbackChoices: choices.slice(0, 8), ownerFeedbackUpdatedAt: savedAt } : recommendation),
        aiLandingPageRecommendations: (item.aiLandingPageRecommendations || []).map((recommendation) => recommendation.id === recommendationId ? { ...recommendation, ownerFeedback: feedback.trim().slice(0, 500), ownerFeedbackChoices: choices.slice(0, 8), ownerFeedbackUpdatedAt: savedAt } : recommendation),
      }) };
      workspaceLiveRef.current = next;
      setWorkspace(next);
      setToast("Feedback saved for this client and campaign."); window.setTimeout(() => setToast(""), 2500);
      return { ok: true };
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Couldn’t save. Your note is still here—try again.";
      setError(message);
      return { ok: false, message };
    }
  };

  const refineRecommendation = async (taskId: string, recommendationId: string, instruction: string) => {
    if (!isAdmin || previewMemberId || !instruction.trim()) return false;
    try {
      const response = await fetch("/api/tasks/recommendations/refine", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ taskId, recommendationId, instruction: instruction.trim().slice(0, 500) }) });
      const result = await response.json().catch(() => null) as { error?: string; taskId?: string; recommendation?: AiRecommendation | AiLandingPageRecommendation } | null;
      if (!response.ok || !result?.recommendation) throw new Error(result?.error || "The AI couldn’t update this suggestion right now. Your saved note is safe; please try again.");
      const current = workspaceLiveRef.current;
      const next = { ...current, tasks: current.tasks.map((task) => task.id !== taskId ? task : {
        ...task,
        aiRecommendations: (task.aiRecommendations || []).map((item) => item.id === recommendationId ? result.recommendation as AiRecommendation : item),
        aiLandingPageRecommendations: (task.aiLandingPageRecommendations || []).map((item) => item.id === recommendationId ? result.recommendation as AiLandingPageRecommendation : item),
      }) };
      workspaceLiveRef.current = next;
      setWorkspace(next);
      setToast("Recommendation updated. Your other suggestions are unchanged.");
      window.setTimeout(() => setToast(""), 4000);
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The AI could not refine this recommendation.");
      return false;
    }
  };

  const rejectRecommendations = async (recommendations: Array<{ taskId: string; recommendationId: string }>) => {
    if (!isAdmin || previewMemberId || !recommendations.length) return false;
    const current = workspaceLiveRef.current;
    const rejected = new Set(recommendations.map((item) => `${item.taskId}:${item.recommendationId}`));
    const rejectedIssues = new Set(recommendations.flatMap((selection) => {
      const task = current.tasks.find((item) => item.id === selection.taskId);
      if (!task) return [];
      const scope = `${task.clientId}:${task.campaignId || String(task.campaignName || task.service).trim().toLowerCase()}`;
      const item = [...(task.aiRecommendations || []), ...(task.aiLandingPageRecommendations || [])].find((candidate) => candidate.id === selection.recommendationId);
      if (!item) return [];
      const issue = "url" in item ? aiRecommendationIssueKey(item.section, "Landing page", item.rationale, item.url, item.section) : aiRecommendationIssueKey(item.title, item.category, item.detail);
      return [`${scope}:${issue}`];
    }));
    const rejectedAt = new Date().toISOString();
    const next = { ...current, tasks: current.tasks.map((task) => ({
      ...task,
      aiRecommendations: (task.aiRecommendations || []).map((item) => {
        if (rejected.has(`${task.id}:${item.id}`)) return { ...item, rejectedAt, rejectedBy: sessionUser.name || "Owner" };
        const scope = `${task.clientId}:${task.campaignId || String(task.campaignName || task.service).trim().toLowerCase()}`;
        return rejectedIssues.has(`${scope}:${aiRecommendationIssueKey(item.title, item.category, item.detail)}`) ? { ...item, supersededAt: rejectedAt } : item;
      }),
      aiLandingPageRecommendations: (task.aiLandingPageRecommendations || []).map((item) => {
        if (rejected.has(`${task.id}:${item.id}`)) return { ...item, rejectedAt, rejectedBy: sessionUser.name || "Owner" };
        const scope = `${task.clientId}:${task.campaignId || String(task.campaignName || task.service).trim().toLowerCase()}`;
        return rejectedIssues.has(`${scope}:${aiRecommendationIssueKey(item.section, "Landing page", item.rationale, item.url, item.section)}`) ? { ...item, supersededAt: rejectedAt } : item;
      }),
    })) };
    const saved = await persist(next, `${recommendations.length} recommendation${recommendations.length === 1 ? "" : "s"} rejected`);
    if (saved) return true;
    workspaceLiveRef.current = current;
    setWorkspace(current);
    return false;
  };

  const counts = useMemo(() => {
    const activeTasks = workspace.tasks.filter((t) => t.status !== "Done").length;
    const tracked = workspace.entries.reduce((s, e) => s + e.seconds, 0) + (workspace.activeTimer ? Math.floor((timerNow - new Date(workspace.activeTimer.startedAt).getTime()) / 1000) : 0);
    const finance = currentMonthFinanceSummary(workspace);
    const teamMembers = workspace.staff.filter((member) => !member.isBot).length;
    return { activeTasks, tracked, retainer: finance.retainer, labor: finance.labor, expenses: finance.businessExpenses, profit: finance.profit, teamMembers };
  }, [workspace, timerNow]);
  const teamClientIds = selectedFormIds(form, "clientAccessIds");
  const teamVaultEntryIds = selectedFormIds(form, "vaultAccessEntryIds");
  const teamVaultPermitted = form[`permission_vault`] === undefined ? getTeamPermissions(form.role || "Staff")["vault"] : form[`permission_vault`] === "true";
  const selfProfile = workspace.staff.find((member) => member.id === sessionUser.id || Boolean(sessionUser.email && member.email.toLowerCase() === sessionUser.email.toLowerCase()));
  useEffect(() => {
    if (!ready || !isAdmin || previewMemberId) { setGoogleCalendarStatus(null); return; }
    let cancelled = false;
    fetch("/api/google-calendar", { cache: "no-store" }).then((response) => response.ok ? response.json() as Promise<{ connected: boolean; accountEmail?: string; available?: boolean; syncedCount?: number }> : null).then((result) => { if (!cancelled && result) setGoogleCalendarStatus(result); }).catch(() => { if (!cancelled) setGoogleCalendarStatus(null); });
    return () => { cancelled = true; };
  }, [ready, isAdmin, previewMemberId]);
  useEffect(() => {
    if (!ready || !selfProfile?.id || offlineChessUserId || previewMemberId) return;
    let cancelled = false;
    const checkInvites = async () => {
      try {
        const response = await fetch("/api/chess", { cache: "no-store" });
        if (!response.ok) return;
        const result = await response.json() as { games?: Array<{ id: string; status: string; challengedId?: string; challengerId?: string; createdAt?: string }> };
        if (cancelled) return;
        const invites = (result.games || []).filter((game) => game.status === "pending" && game.challengedId === selfProfile.id);
        if (!chessInviteBaselineLoaded.current) {
          invites.forEach((game) => chessInviteSeenIds.current.add(game.id));
          chessInviteBaselineLoaded.current = true;
          return;
        }
        const fresh = invites.filter((game) => !chessInviteSeenIds.current.has(game.id));
        if (fresh.length && !chessInvitePopup) {
          const invite = fresh.sort((a, b) => Date.parse(b.createdAt || "") - Date.parse(a.createdAt || ""))[0];
          chessInviteSeenIds.current.add(invite.id);
          const challenger = workspace.staff.find((member) => member.id === invite.challengerId)?.name || "A teammate";
          setChessInvitePopup({ id: invite.id, challenger });
        }
      } catch { /* A temporary chess polling failure should not interrupt normal CRM work. */ }
    };
    void checkInvites();
    const timer = window.setInterval(() => void checkInvites(), 12_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [ready, selfProfile?.id, offlineChessUserId, previewMemberId, chessInvitePopup, workspace.staff]);
  const hasClientScope = Array.isArray(selfProfile?.clientAccessIds);
  const availableTeamVaultRows = vaultRows.filter((row) => form.limitClientAccess !== "true" || teamClientIds.includes(row.clientId));
  const previewMember = workspace.staff.find((member) => member.id === previewMemberId && !member.isBot);
  const isWorkspaceOwner = Boolean(sessionUser.id && sessionUser.id === workspace.ownerId);
  const previewPermissions = previewMember ? getTeamPermissions(previewMember.role, previewMember.permissions) : access;
  const [clientScope, setClientScopeState] = useState("");
  useEffect(() => { try { const saved = window.localStorage.getItem("f2b-client-scope"); if (saved) setClientScopeState(saved); document.cookie = `f2b_client=${encodeURIComponent(saved || "agency")}; Path=/; Max-Age=31536000; SameSite=Lax; Secure`; } catch { /* storage unavailable */ } }, []);
  const activeScopeId = workspace.clients.some((item) => item.id === clientScope) ? clientScope : "";
  const scopedClient = activeScopeId ? workspace.clients.find((item) => item.id === activeScopeId) : undefined;
  if (scopedClient?.currency) setDisplayCurrency(scopedClient.currency);
  useEffect(() => { if (activeScopeId && page === "Clients" && !selectedClient) setPage("Overview"); }, [activeScopeId, page, selectedClient]);
  const [autoColours, setAutoColours] = useState<{ logo: string; primary: string; secondary: string } | null>(null);
  const clientLogo = scopedClient?.logo && /^(data:image\/|https?:\/\/|\/)/.test(scopedClient.logo) ? scopedClient.logo : "";
  useEffect(() => { let live = true; setAutoColours(null); if (clientLogo && !scopedClient?.branding) void extractLogoColours(clientLogo).then((colours) => { if (live && colours) setAutoColours({ logo: clientLogo, ...colours }); }); return () => { live = false; }; /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [clientLogo, scopedClient?.id, Boolean(scopedClient?.branding)]);
  const scopedBranding: Partial<Branding> | undefined = scopedClient ? (scopedClient.branding || (clientLogo ? { ...(autoColours ? { primary: autoColours.primary, secondary: autoColours.secondary } : scopedClient.color && /^#[0-9a-fA-F]{6}$/.test(scopedClient.color) ? { primary: scopedClient.color } : {}), logo: clientLogo } : undefined)) : undefined;
  useEffect(() => { if (page === "Chess" && scopedClient && !/^agency$/i.test(scopedClient.name.trim())) setPage("Overview"); }, [page, scopedClient?.id]);
  useEffect(() => { const own = scopedBranding && (scopedBranding.primary || scopedBranding.secondary || scopedBranding.logo); applyBranding(own ? { ...workspace.settings?.branding, ...scopedBranding } : workspace.settings?.branding); }, [workspace.settings?.branding, JSON.stringify(scopedBranding)]);
  const setClientScope = (id: string) => { setClientScopeState(id); try { document.cookie = `f2b_client=${encodeURIComponent(id || "agency")}; Path=/; Max-Age=31536000; SameSite=Lax; Secure`; window.dispatchEvent(new CustomEvent("f2b-scope", { detail: id })); } catch { /* cookie unavailable */ } try { if (id) window.localStorage.setItem("f2b-client-scope", id); else window.localStorage.removeItem("f2b-client-scope"); } catch { /* storage unavailable */ } if (id) setSelectedClient(id); else setSelectedClient(""); if (id && page === "Lead Factory") setPage("Overview"); };
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("page") !== "Media Library") return;
    const linkedClient = params.get("client");
    if (linkedClient) setClientScope(linkedClient);
    setPage("Media Library");
    if (!params.has("driveConnection") && !params.has("upload")) { params.delete("page"); params.delete("client"); const query = params.toString(); window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const baseViewWorkspace = previewMember ? previewWorkspaceForStaff(workspace, previewMember) : workspace;
  const hideAgencyOnlyAgents = Boolean(previewMember) || !isAdmin || Boolean(scopedClient && !/^agency$/i.test(scopedClient.name.trim()));
  const viewWorkspace = useMemo(() => {
    const scoped = scopeWorkspaceToClient(baseViewWorkspace, activeScopeId);
    return hideAgencyOnlyAgents ? { ...scoped, staff: scoped.staff.filter((member) => !(member.isBot && /client\s*brief/i.test(member.name))) } : scoped;
  }, [baseViewWorkspace, activeScopeId, hideAgencyOnlyAgents]);
  const viewHasClientScope = previewMember ? Array.isArray(previewMember.clientAccessIds) : hasClientScope;
  const viewIsAdmin = previewMember ? false : isAdmin;
  const viewAccess = previewMember ? previewPermissions : access;
  const canViewActivity = viewAccess.overview || viewAccess.clientActivity || viewAccess.allActivity;
  const recentActivityPreview = (viewWorkspace.activity || []).slice().sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 4);
  const viewCounts = useMemo(() => {
    if (!previewMember && !activeScopeId) return counts;
    const activeTasks = viewWorkspace.tasks.filter((task) => task.status !== "Done" && !task.aiDismissedAt).length;
    const tracked = viewWorkspace.entries.reduce((sum, entry) => sum + entry.seconds, 0) + (viewWorkspace.activeTimer ? Math.floor((timerNow - new Date(viewWorkspace.activeTimer.startedAt).getTime()) / 1000) : 0);
    const finance = currentMonthFinanceSummary(viewWorkspace);
    return { activeTasks, tracked, retainer: finance.retainer, labor: finance.labor, expenses: finance.businessExpenses, profit: finance.profit, teamMembers: viewWorkspace.staff.filter((member) => !member.isBot).length };
  }, [previewMember, activeScopeId, counts, viewWorkspace, timerNow]);
  const viewClient = viewWorkspace.clients.find((item) => item.id === selectedClient);
  const startStaffPreview = (memberId: string) => {
    const member = workspace.staff.find((item) => item.id === memberId && !item.isBot);
    if (!member) { setPreviewMemberId(""); setSelectedClient(""); setPage("Overview"); setProfileMenuOpen(false); return; }
    const permissions = getMemberPermissions(member, workspace.ownerId);
    const scoped = Array.isArray(member.clientAccessIds);
    const hasScope = scoped;
    const firstPage = ["Overview", "Tasks", "Clients", "Activity", "AI Assistant", "Report Studio", "Proposal Studio", "Team"].find((candidate) => canOpenPage(candidate, permissions, false, hasScope)) || "Overview";
    setPreviewMemberId(member.id);
    setSelectedClient("");
    setPage(firstPage);
    setModal("");
    setForm({});
    setProfileMenuOpen(false);
  };
  const pageAllowed = canOpenPage(page, viewAccess, viewIsAdmin, viewHasClientScope);
  const availableMarketingPages = marketingPages.filter((subpage) => !["Tracking & Analytics", "Email Marketing", "Cold Outreach"].includes(subpage.key) && canOpenPage(subpage.key, viewAccess, viewIsAdmin, viewHasClientScope));
  const marketingPageActive = marketingPages.some((subpage) => subpage.key === page);

  const openModal = (name: string, initial: Record<string, string> = {}) => { if (name === "client" && !initial.clientId) setClientServiceRows(serviceTypes.map((service, index) => ({ id: `service-${index}`, name: service, campaignName: "", fee: "", mediaSpend: "", landingPageUrl: "", landingPagePlatform: "Other" }))); if (name === "client") setServiceToAdd(""); if (name === "staff" && !initial.staffId) setForm({ ...permissionFormValues(getTeamPermissions("Staff")), limitClientAccess: "true", clientAccessIds: "[]", aiModeAccess: "[]", vaultAccessEntryIds: "[]", ...initial }); else { const scopedDefaults: Record<string, string> = activeScopeId && name !== "client" && name !== "staff" && !initial.clientId ? { clientId: activeScopeId } : {}; setForm(name === "task" && !initial.taskId && initial.assigneeId === undefined ? { assigneeId: selfProfile?.id || sessionUser.id, ...scopedDefaults, ...initial } : { ...scopedDefaults, ...initial }); } setModal(name); };
  const editClient = (client: Client) => {
    const initial: Record<string, string> = { clientId: client.id, name: client.name, company: client.company, contact: client.contact, email: client.email, phone: client.phone || "", logo: client.logo || "", seoServices: (client.seoServices || []).join("\n"), seoLocations: (client.seoLocations || []).join("\n"), monthlyBudget: String(client.monthlyBudget || ""), billingDay: client.billingDay ? String(client.billingDay) : "", googleAdsAccountId: client.googleAdsAccountId || "", metaAdsAccountId: client.metaAdsAccountId || "", googleSearchConsoleAccountId: client.googleSearchConsoleAccountId || "", googleAnalyticsAccountId: client.googleAnalyticsAccountId || "", googleBusinessProfileAccountId: client.googleBusinessProfileAccountId || "", googleBusinessProfileLocationId: client.googleBusinessProfileLocationId || "", wordpressSiteUrl: client.wordpressSiteUrl || "" };
    setClientServiceRows(client.services.map((service, index) => ({ id: `service-${index}`, name: service.name, campaignName: service.campaignName || "", fee: service.fee ? String(service.fee) : "", mediaSpend: service.mediaSpend ? String(service.mediaSpend) : "", landingPageUrl: service.landingPageUrl || "", landingPagePlatform: service.landingPagePlatform || "Other" })));
    openModal("client", initial);
  };
  const editTask = (task: Task) => openModal("task", { taskId: task.id, clientId: task.clientId, projectId: task.projectId, title: task.title, assigneeId: task.assigneeId, priority: task.priority, service: task.service, estimate: String(task.estimate || 0), due: task.due || "", dueTime: task.repeatTime || localTimeFromIso(task.dueAt), notes: task.aiInstructions || task.notes || "", checklist: (task.checklist || []).map((item) => item.text).join("\n"), repeat: task.repeat || "None", campaignId: task.campaignId || "", campaignName: task.campaignName || "", campaignContext: task.campaignContext || "", sitePagePlan: task.sitePagePlan ? JSON.stringify(task.sitePagePlan) : "" });
  const duplicateTask = (task: Task) => openModal("task", { clientId: task.clientId, projectId: task.projectId, title: `${task.title} (copy)`, assigneeId: task.aiRunState === "scheduled" ? task.assigneeId : "", priority: task.priority, service: task.service, estimate: String(task.estimate || 0), due: task.due || "", dueTime: task.repeatTime || localTimeFromIso(task.dueAt), notes: task.aiInstructions || task.notes || "", checklist: (task.checklist || []).map((item) => item.text).join("\n"), repeat: task.repeat || "None", campaignId: task.campaignId || "", campaignName: task.campaignName || "", campaignContext: task.campaignContext || "", sitePagePlan: task.sitePagePlan ? JSON.stringify(task.sitePagePlan) : "" });
  const saveClient = () => {
    const services = clientServiceRows.map((row) => ({ name: row.name, campaignName: row.campaignName.trim() || undefined, fee: Number(row.fee || 0), mediaSpend: row.name === "Google Ads" || row.name === "Meta Ads" ? Number(row.mediaSpend || 0) : 0, landingPageUrl: row.landingPageUrl?.trim() || undefined, landingPagePlatform: row.landingPagePlatform })).filter((service) => service.fee || service.mediaSpend || service.campaignName || service.landingPageUrl);
    const oldClient = workspace.clients.find((client) => client.id === form.clientId);
    const billingDayInput = Number(form.billingDay || 0);
    const billingDay = Number.isInteger(billingDayInput) && billingDayInput >= 1 && billingDayInput <= 31 ? billingDayInput : undefined;
    const parseLines = (value?: string) => [...new Set((value || "").split(/[\r\n,;]/).map((item) => item.trim()).filter(Boolean))].slice(0, 40);
    const nextClient: Client = { id: oldClient?.id || uid(), name: form.name?.trim() || "", company: form.company || "", contact: form.contact || "", email: form.email || "", phone: form.phone || "", status: oldClient?.status || "Active", color: oldClient?.color || ["#d6edeb", "#f8e5d7", "#e5e0f5", "#dce9fa"][workspace.clients.length % 4], logo: form.logo || "", services, seoServices: parseLines(form.seoServices), seoLocations: parseLines(form.seoLocations), codexUrl: oldClient?.codexUrl || "", serviceChats: oldClient?.serviceChats || {}, monthlyBudget: form.monthlyBudget === undefined ? Number(oldClient?.monthlyBudget || 0) : Number(form.monthlyBudget || 0), billingDay, campaigns: oldClient?.campaigns || [], googleAdsAccountId: form.googleAdsAccountId?.replace(/\s/g, "") || "", metaAdsAccountId: form.metaAdsAccountId?.trim().replace(/^act_/i, "").replace(/\D/g, "") || "", googleSearchConsoleAccountId: form.googleSearchConsoleAccountId?.trim() || "", googleAnalyticsAccountId: form.googleAnalyticsAccountId?.trim() || "", googleBusinessProfileAccountId: form.googleBusinessProfileAccountId?.trim() || "", googleBusinessProfileLocationId: form.googleBusinessProfileLocationId?.trim() || "", wordpressSiteUrl: form.wordpressSiteUrl?.trim().replace(/\/$/, "") || "" };
    if (!nextClient.name) return;
    if (oldClient) {
      persist({ ...workspace, clients: workspace.clients.map((client) => client.id === oldClient.id ? nextClient : client) }, "Client updated");
      setModal("");
      return;
    }
    persist({ ...workspace, clients: [nextClient, ...workspace.clients] }, "Client added"); setModal(""); setPage("Clients"); setSelectedClient(nextClient.id);
  };
  const deleteClient = async (client: Client) => {
    const related = {
      tasks: workspace.tasks.filter((item) => item.clientId === client.id).length,
      projects: workspace.projects.filter((item) => item.clientId === client.id).length,
      files: workspace.files.filter((item) => item.clientId === client.id).length,
      notes: workspace.notes.filter((item) => item.clientId === client.id).length,
    };
    const summary = [related.tasks && `${related.tasks} task${related.tasks === 1 ? "" : "s"}`, related.projects && `${related.projects} project${related.projects === 1 ? "" : "s"}`, related.files && `${related.files} file${related.files === 1 ? "" : "s"}`, related.notes && `${related.notes} note${related.notes === 1 ? "" : "s"}`].filter(Boolean).join(", ");
    if (!window.confirm(`Remove ${client.name} from the agency workspace?${summary ? ` This also removes ${summary}, time entries, client vault entries, and this client's assistant chat history.` : " This also removes its related records, vault entries, and assistant chat history."} This cannot be undone.`)) return;
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/workspace", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId: client.id }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Could not remove this client.");
      const loaded = await fetch("/api/workspace", { cache: "no-store" });
      const payload = await readApiJson<{ data?: Workspace; error?: string }>(loaded, "Workspace");
      if (!loaded.ok || !payload.data) throw new Error(payload.error || "The client was removed, but the workspace could not refresh.");
      const hiddenAiAgentIds = Array.isArray(payload.data.hiddenAiAgentIds) ? payload.data.hiddenAiAgentIds : [];
      setWorkspace({ ...emptyWorkspace(), ...payload.data, hiddenAiAgentIds, staff: withAiTeammates(payload.data.staff || [], hiddenAiAgentIds), files: payload.data.files || [], vaultEntries: payload.data.vaultEntries || [], financeRecords: payload.data.financeRecords || [], activity: payload.data.activity || [] });
      setSelectedClient(""); setPage("Clients"); setToast(`${client.name} removed`); window.setTimeout(() => setToast(""), 2500);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not remove this client."); }
    finally { setSaving(false); }
  };
  const saveStaff = async () => {
    if (form.isAiProfile === "true") {
      const currentAi = workspace.staff.find((member) => member.id === form.staffId && member.isBot);
      if (!form.name?.trim()) return;
      const profileUrl = form.avatarUrl?.trim() || "";
      const uploadedAvatar = form.avatarImage?.startsWith("data:image/") ? form.avatarImage : "";
      const avatar = uploadedAvatar || (/^https:\/\//i.test(profileUrl) ? profileUrl : initials(form.name));
      const agent: Staff = { ...(currentAi || {} as Staff), id: currentAi?.id || `f2b-ai-agent-${uid()}`, name: form.name.trim(), email: "", role: currentAi?.id === aiTeammate.id ? "AI teammate" : "AI agent", costRate: 0, avatar, isBot: true, aiModeAccess: aiModes.map((mode) => mode.name), clientAccessIds: undefined, agentPrompt: String(form.agentPrompt || "").trim().slice(0, 4000), aiModel: String(form.aiModel || "x-ai/grok-4.7") };
      const staff = currentAi ? workspace.staff.map((member) => member.id === currentAi.id ? agent : member) : [...workspace.staff, agent];
      await persist({ ...workspace, staff }, currentAi ? "AI agent profile updated" : "AI agent created");
      setModal(""); setForm({}); return;
    }
    if (!form.name?.trim() || !form.email?.trim()) return;
    const profileUrl = form.avatarUrl?.trim() || "";
    const uploadedAvatar = form.avatarImage?.startsWith("data:image/") ? form.avatarImage : "";
    const safeAvatar = uploadedAvatar || (/^https:\/\//i.test(profileUrl) ? profileUrl : initials(form.name));
    const current = workspace.staff.find((member) => member.id === form.staffId && !member.isBot);
    const role = form.role || "Staff";
    const permissions = permissionsFromForm(form, role);
    if (current?.id !== workspace.ownerId) permissions.overview = false;
    const staff: Staff = { id: current?.id || uid(), name: form.name.trim(), email: form.email.trim().toLowerCase(), role, costRate: Number(form.costRate || 0), avatar: safeAvatar, permissions, ...(form.limitClientAccess === "true" ? { clientAccessIds: selectedFormIds(form, "clientAccessIds") } : {}), vaultAccessEntryIds: permissions.vault ? selectedFormIds(form, "vaultAccessEntryIds") : [], aiModeAccess: permissions.aiAssistant ? selectedFormIds(form, "aiModeAccess") as AiMode[] : [] };
    const saved = await persist({ ...workspace, staff: current ? workspace.staff.map((member) => member.id === current.id ? staff : member) : [...workspace.staff, staff] }, current ? "Team profile updated" : "Team profile added");
    if (!saved) return;
    setModal("");
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/staff-access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ staffId: staff.id }) });
      const result = await response.json() as { error?: string; changed?: boolean };
      if (!response.ok) throw new Error(`Staff profile saved, but workspace access could not be synced. ${result.error || "Check the one-time Cloudflare connection."}`);
      setToast(result.changed ? "Staff profile saved and workspace access added" : "Staff profile saved; workspace access is already set");
      window.setTimeout(() => setToast(""), 3200);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Staff profile saved, but workspace access could not be synced.");
    } finally { setSaving(false); }
  };
  const editStaff = (member: Staff) => {
    if (member.isBot) {
      setStaffInviteStatus("");
      openModal("staff", { isAiProfile: "true", staffId: member.id, name: member.name, aiMode: member.aiModeAccess?.[0] || "Google Ads", aiModel: member.aiModel || "x-ai/grok-4.7", agentPrompt: member.agentPrompt || "", limitClientAccess: String(Array.isArray(member.clientAccessIds)), clientAccessIds: JSON.stringify(member.clientAccessIds || []), avatarImage: member.avatar.startsWith("data:image/") ? member.avatar : "", avatarUrl: member.avatar.startsWith("https://") ? member.avatar : "" });
      return;
    }
    setStaffInviteStatus("");
    const senderName = sessionUser.name || "F2B Media";
    openModal("staff", { staffId: member.id, name: member.name, email: member.email, role: member.role, costRate: String(member.costRate || 0), avatarImage: member.avatar.startsWith("data:image/") ? member.avatar : "", avatarUrl: member.avatar.startsWith("https://") ? member.avatar : "", inviteSubject: "You’re invited to join F2B Media", inviteMessage: `Hi ${member.name},

I’ve added your profile to the F2B Media workspace. Click the Join now button below to sign in.

Please use your own verified account to sign in. Your sign-in email is ${member.email}.

If you can’t open the workspace, reply to me so I can check your access.

Thanks,
${senderName}`, limitClientAccess: String(Array.isArray(member.clientAccessIds)), clientAccessIds: JSON.stringify(member.clientAccessIds || []), aiModeAccess: JSON.stringify(member.aiModeAccess ?? (getTeamPermissions(member.role, member.permissions).aiAssistant ? aiModes.map((item) => item.name) : [])), vaultAccessEntryIds: JSON.stringify(member.vaultAccessEntryIds || []), ...permissionFormValues(getTeamPermissions(member.role, member.permissions)) });
  };
  const sendStaffInvite = async () => {
    if (!form.staffId || staffInviteSending) return;
    setStaffInviteSending(true); setStaffInviteStatus("");
    try {
      const response = await fetch("/api/staff-invite", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ staffId: form.staffId, subject: form.inviteSubject, message: form.inviteMessage }) });
      const result = await response.json() as { error?: string; email?: string };
      if (!response.ok) throw new Error(result.error || "The login email could not be sent.");
    setStaffInviteStatus(`Workspace access confirmed and email accepted by the email service for ${result.email}. This confirms submission, not inbox delivery.`);
    } catch (reason) {
      setStaffInviteStatus(reason instanceof Error ? reason.message : "The login email could not be sent.");
    } finally { setStaffInviteSending(false); }
  };
  const removeAiTeammate = (member: Staff) => {
    if (!member.isBot) return;
    const assignedTasks = workspace.tasks.filter((task) => task.assigneeId === member.id && task.status !== "Done");
    const message = `Remove ${member.name} from the team?${assignedTasks.length ? ` ${assignedTasks.length} open task${assignedTasks.length === 1 ? "" : "s"} will be unassigned, and scheduled AI runs on them will stop.` : ""} You can create another AI agent later.`;
    if (!window.confirm(message)) return;
    const hiddenAiAgentIds = [...new Set([...(workspace.hiddenAiAgentIds || []), member.id])];
    const tasks = workspace.tasks.map((task) => task.assigneeId !== member.id || task.status === "Done" ? task : { ...task, assigneeId: "", ...(task.aiRunState === "scheduled" || task.aiRunState === "running" ? { aiRunState: "needs_connection" as const, aiFeedback: `${member.name} was removed from the team; assign this task to an available teammate before it runs again.` } : {}) });
    persist({ ...workspace, hiddenAiAgentIds, staff: workspace.staff.filter((item) => item.id !== member.id), tasks }, `${member.name} removed from team`);
  };
  const removeStaffMember = (member: Staff) => {
    if (member.isBot || member.id === workspace.ownerId || member.id === (selfProfile?.id || sessionUser.id)) return;
    const assigned = workspace.tasks.filter((task) => task.assigneeId === member.id && task.status !== "Done");
    if (!window.confirm(`Delete ${member.name} from the team?${assigned.length ? ` ${assigned.length} open task${assigned.length === 1 ? "" : "s"} will be unassigned.` : ""} Their past time entries stay on record. This removes them from the workspace staff list.`)) return;
    const tasks = workspace.tasks.map((task) => task.assigneeId === member.id && task.status !== "Done" ? { ...task, assigneeId: "" } : task);
    persist({ ...workspace, staff: workspace.staff.filter((item) => item.id !== member.id), tasks }, `${member.name} removed from team`);
  };
  const restoreAiTeammate = () => {
    const teammate = botTeammates[0];
    persist({ ...workspace, hiddenAiAgentIds: (workspace.hiddenAiAgentIds || []).filter((id) => id !== teammate.id), staff: [...workspace.staff.filter((member) => member.id !== teammate.id), teammate] }, "F2B AI added to team");
  };
  const saveTask = () => {
    if (!form.title?.trim()) return;
    const current = workspace.tasks.find((task) => task.id === form.taskId);
    const assignedAgent = workspace.staff.find((member) => member.id === form.assigneeId && member.isBot);
    const isAiRun = Boolean(assignedAgent);
    if (isAiRun && (!form.clientId || !form.due)) { setError("AI tasks need a client and a due date so the scheduled run knows what to work on and when."); return; }
    if (isAiRun && !aiModes.some((mode) => mode.name === form.service)) { setError("Choose a supported AI task type."); return; }
    if (form.referenceUploading === "true") { setError("Wait for the design reference to finish uploading before creating the task."); return; }
    const sitePagePlan = form.service === "Sites" ? normalizeSitePagePlan(parseObjectForm(form.sitePagePlan)) || undefined : undefined;
    if (form.campaignId && !taskCampaigns.some((campaign) => campaign.id === form.campaignId) && !(sitePagePlan?.campaignId === form.campaignId)) { setError("Reload the campaign list and choose a campaign connected to this client."); return; }
    if (isAiRun && form.service === "Sites" && !workspace.clients.find((client) => client.id === form.clientId)?.wordpressSiteUrl) { setError("Add this client’s WordPress website in the client profile before assigning a Sites task."); return; }
    const instructions = String(form.notes || "").trim();
    const checklist = String(form.checklist || "").split(/\r?\n/).map(cleanChecklistStep).filter(Boolean).slice(0, 20).map((text) => {
      const existingItem = current?.checklist?.find((item) => item.text === text);
      return { id: existingItem?.id || uid(), text: text.slice(0, 240), done: existingItem?.done || false };
    });
    const dueTime = String(form.dueTime || "09:00");
    const dueAt = localTaskDueAt(form.due || "", dueTime);
    const selectedCampaign = taskCampaigns.find((campaign) => campaign.id === form.campaignId);
    const task: Task = { id: current?.id || uid(), clientId: form.clientId || "", projectId: "", title: form.title.trim(), assigneeId: form.assigneeId || "", status: current?.status || "To do", priority: form.priority || "Normal", service: form.service || "SEO", estimate: Number(form.estimate || 0), due: form.due || "", ...(dueAt ? { dueAt } : {}), repeatTime: dueTime, createdAt: current?.createdAt || new Date().toISOString(), createdById: current?.createdById || sessionUser.id, notes: instructions, checklist, repeat: form.service === "Sites" ? "None" : (form.repeat as Task["repeat"]) || "None", seriesId: current?.seriesId, occurrence: current?.occurrence, ...(form.campaignId ? { campaignId: form.campaignId, campaignName: selectedCampaign?.name || form.campaignName || sitePagePlan?.campaignName || "", campaignContext: String(form.campaignContext || "").trim().slice(0, 1200) } : {}), ...(sitePagePlan ? { sitePagePlan } : {}), ...(isAiRun ? { aiMode: (form.service || "SEO") as AiMode, aiRunState: "scheduled" as const, aiInstructions: instructions, ...(form.service === "Sites" && form.aiReferenceFileId ? { aiReferenceFileId: form.aiReferenceFileId, aiReferenceFileName: form.aiReferenceFileName || "Design reference" } : {}) } : {}) };
    persist({ ...workspace, tasks: current ? workspace.tasks.map((item) => item.id === current.id ? task : item) : [task, ...workspace.tasks] }, current ? "Task updated" : "Task created"); setModal(""); setPage("Tasks");
  };
  const saveGoogleAdsTaskSettings = async (clientId: string, settings: GoogleAdsTaskSettings) => {
    if (!isAdmin || previewMemberId) return false;
    return persist({ ...workspace, clients: workspace.clients.map((client) => client.id === clientId ? { ...client, googleAdsTaskSettings: settings } : client) }, "Google Ads task preferences saved");
  };
  const setupGoogleAdsTasks = async (targetClientId?: string, settingsOverride?: GoogleAdsTaskSettings, campaignScopes?: GoogleAdsTaskScope[], persistSettingsOverride = true) => {
    if (!isAdmin || previewMemberId) return { created: 0, skipped: 0, message: "Only an administrator can set up these tasks." };
    const conor = workspace.staff.find((member) => member.isBot && /\bconor\b/i.test(member.name) && (!Array.isArray(member.aiModeAccess) || member.aiModeAccess.includes("Google Ads")))
      || workspace.staff.find((member) => member.id === aiTeammate.id && member.isBot && (!Array.isArray(member.aiModeAccess) || member.aiModeAccess.includes("Google Ads")));
    const candidates = workspace.clients.filter((client) => !targetClientId || client.id === targetClientId);
    const tasksToAdd: Task[] = [];
    let skipped = 0;
    const now = new Date();
    for (const client of candidates) {
      if (client.status.toLowerCase() !== "active" || !/^[0-9-]{6,24}$/.test(String(client.googleAdsAccountId || "")) || !conor) { skipped += 1; continue; }
      const clientCampaignScopes = campaignScopes ? campaignScopes.filter((scope) => scope.clientId === client.id) : [undefined];
      if (!clientCampaignScopes.length) { skipped += 1; continue; }
      for (const scope of clientCampaignScopes) for (const template of GOOGLE_ADS_TASK_TEMPLATES) {
        const settings = client.id === targetClientId && settingsOverride ? settingsOverride : scope?.campaignId ? client.googleAdsCampaignTaskSettings?.[scope.campaignId] || client.googleAdsTaskSettings : client.googleAdsTaskSettings;
        if (!(settings?.[template.id] ?? !template.onDemand)) continue;
        const campaignKey = scope?.campaignId || "";
        if (workspace.tasks.some((task) => task.clientId === client.id && task.googleAdsTemplateId === template.id && (task.campaignId || "") === campaignKey) || tasksToAdd.some((task) => task.clientId === client.id && task.googleAdsTemplateId === template.id && (task.campaignId || "") === campaignKey)) continue;
        const due = template.onDemand ? localDateKey() : nextGoogleAdsTemplateDate(template, now);
        const dueTime = "09:00";
        const dueAt = template.onDemand ? now.toISOString() : localTaskDueAt(due, dueTime);
        const campaignInstruction = scope ? ` Restrict every check and proposal to campaign ${scope.campaignName} (${scope.campaignId}); do not affect other campaigns.` : " This is an account-wide review unless the task card is later edited to select one campaign.";
        const instructions = `Google Ads template task for ${client.name}.${campaignInstruction} Use only the linked Google Ads account ${client.googleAdsAccountId} and this client's connected evidence. Read previous task notes and change history first. Record a structured shared note with findings, evidence, recommendations, priority, risk, action taken, approval status, verification and follow-up. Account changes are proposals until separately approved; verify live state after any approved change. If a required integration or data source is unavailable, mark the relevant check blocked and explain the exact missing access. Do not invent metrics or Keyword Planner results.`;
        tasksToAdd.push({ id: uid(), clientId: client.id, projectId: "", title: `${template.title}${scope ? ` · ${scope.campaignName}` : ""}`, ...(scope ? { campaignId: scope.campaignId, campaignName: scope.campaignName } : {}), assigneeId: conor.id, status: "To do", priority: "Normal", service: "Google Ads", estimate: 0, due, dueAt, repeatTime: template.onDemand ? localTimeFromIso(dueAt) : dueTime, createdById: sessionUser.id, notes: instructions, aiInstructions: instructions, checklist: template.checklist.map((text) => ({ id: uid(), text, done: false })), repeat: template.repeat, seriesId: `google-ads:${client.id}:${scope?.campaignId || "account"}:${template.id}:v1`, occurrence: 1, aiMode: "Google Ads", aiRunState: "scheduled", googleAdsTemplateId: template.id, googleAdsTemplateVersion: 1 });
      }
    }
    const clients = settingsOverride && targetClientId && persistSettingsOverride ? workspace.clients.map((client) => {
      if (client.id !== targetClientId) return client;
      if (campaignScopes?.length) {
        const campaignSettings = { ...(client.googleAdsCampaignTaskSettings || {}) };
        for (const scope of campaignScopes.filter((item) => item.clientId === client.id)) campaignSettings[scope.campaignId] = settingsOverride;
        return { ...client, googleAdsCampaignTaskSettings: campaignSettings };
      }
      return { ...client, googleAdsTaskSettings: settingsOverride };
    }) : workspace.clients;
    const disabledTemplateIds = settingsOverride && targetClientId && persistSettingsOverride
      ? new Set(GOOGLE_ADS_TASK_TEMPLATES.filter((template) => !googleAdsTemplateEnabled(settingsOverride, template)).map((template) => template.id))
      : new Set<string>();
    let stoppedScheduled = 0;
    const existingTasks = workspace.tasks.map((task) => {
      const inSetupScope = (targetClientId ? task.clientId === targetClientId : candidates.some((client) => client.id === task.clientId))
        && (!campaignScopes?.length || campaignScopes.some((scope) => scope.clientId === task.clientId && scope.campaignId === task.campaignId));
      const shouldStop = Boolean(task.googleAdsTemplateId && (RETIRED_GOOGLE_ADS_TASK_TEMPLATE_IDS.has(task.googleAdsTemplateId) || disabledTemplateIds.has(task.googleAdsTemplateId)));
      if (!inSetupScope || !shouldStop || task.status === "Done" || task.aiRunState !== "scheduled") return task;
      stoppedScheduled += 1;
      return { ...task, status: "Blocked", aiRunState: "cancelled" as const, aiStartNowRequestedAt: undefined, recurrenceNoticePending: false, aiProgressText: "Replaced by the simpler Google Ads review", aiFeedback: "This scheduled task was stopped and kept in history when Google Ads automation was simplified." };
    });
    const hasSettingsToPersist = Boolean(settingsOverride && targetClientId && persistSettingsOverride);
    if (!tasksToAdd.length && !hasSettingsToPersist && !stoppedScheduled) return { created: 0, skipped, message: targetClientId ? "Your weekly review is already set up." : "Weekly reviews are already set up for eligible clients." };
    const clientCount = new Set(tasksToAdd.map((task) => task.clientId)).size;
    const saved = await persist({ ...workspace, clients, tasks: [...tasksToAdd, ...existingTasks] }, `Google Ads task setup · ${tasksToAdd.length} tasks for ${clientCount} clients`);
    if (!saved) return { created: 0, skipped, message: "The task setup could not be saved." };
    if (!tasksToAdd.length) return { created: 0, skipped, message: `Weekly review preferences saved.${stoppedScheduled ? ` ${stoppedScheduled} old scheduled task${stoppedScheduled === 1 ? " was" : "s were"} stopped; history was kept.` : ""}` };
    return { created: tasksToAdd.length, skipped, message: `${tasksToAdd.length} task${tasksToAdd.length === 1 ? "" : "s"} scheduled for ${clientCount} client${clientCount === 1 ? "" : "s"}.${stoppedScheduled ? ` ${stoppedScheduled} old scheduled task${stoppedScheduled === 1 ? " was" : "s were"} stopped; history was kept.` : ""}${skipped ? ` ${skipped} client${skipped === 1 ? " was" : "s were"} skipped because its Google Ads account or AI agent is not ready.` : ""}` };
  };
  const runGoogleAdsTestAudit = async (clientId: string): Promise<boolean> => {
    const current = workspaceLiveRef.current;
    const client = current.clients.find((item) => item.id === clientId);
    const agent = current.staff.find((member) => member.isBot && /\\bconor\\b/i.test(member.name) && (!Array.isArray(member.aiModeAccess) || member.aiModeAccess.includes("Google Ads")))
      || current.staff.find((member) => member.id === aiTeammate.id && member.isBot && (!Array.isArray(member.aiModeAccess) || member.aiModeAccess.includes("Google Ads")));
    if (!isAdmin || previewMemberId || !client || client.status.toLowerCase() !== "active" || !/^[0-9-]{6,24}$/.test(String(client.googleAdsAccountId || "")) || !agent) {
      setError("Heatwise needs an active Google Ads account link and AI access before a test can run.");
      return false;
    }
    const existingTest = current.tasks.find((task) => task.clientId === clientId && task.title === "Google Ads test audit" && isAiAssignedTask(task) && ["scheduled", "running"].includes(task.aiRunState || ""));
    if (existingTest) {
      if (existingTest.aiRunState === "scheduled") return startAiTaskNow(existingTest.id);
      setError("A Google Ads test audit is already running for this client.");
      return false;
    }
    const template = GOOGLE_ADS_TASK_TEMPLATES[0];
    const now = new Date();
    const dueAt = now.toISOString();
    const instructions = `Run a one-time, read-only Google Ads performance audit for ${client.name}. Use only linked account ${client.googleAdsAccountId}. Review available account and campaign performance for the latest complete 30 days and compare with the previous 30 days where the connected data supports it. Check delivery, spend, budgets, conversions, search terms and keywords, ads and available assets, conversion setup, and each campaign's linked landing page where accessible. Save a clear full report with key metrics, period, evidence, unavailable data, and the most important findings. Create no more than three distinct, high-quality recommendations; do not repeat open or previously actioned recommendations for the same issue. Put exact proposed Google Ads edits in To approve. Do not make any Ads, landing-page, or website changes during this test.`;
    const taskId = uid();
    const task: Task = {
      id: taskId, clientId, projectId: "", title: "Google Ads test audit", assigneeId: agent.id,
      status: "To do", priority: "Normal", service: "Google Ads", estimate: 0,
      due: localDateKey(now), dueAt, repeatTime: localTimeFromIso(dueAt), createdAt: dueAt,
      createdById: sessionUser.id, notes: instructions, aiInstructions: instructions,
      checklist: template.checklist.map((text) => ({ id: uid(), text, done: false })),
      repeat: "None", aiMode: "Google Ads", aiRunState: "scheduled",
    };
    const saved = await persist({ ...current, tasks: [task, ...current.tasks] }, `Google Ads test audit created · ${client.name}`);
    return saved ? startAiTaskNow(taskId) : false;
  };
  const saveProject = () => {
    if (!form.name?.trim()) return;
    const project: Project = { id: uid(), clientId: form.clientId || "", name: form.name.trim(), status: "Active", due: form.due || "" };
    persist({ ...workspace, projects: [project, ...workspace.projects] }, "Project created"); setModal(""); setPage("Projects");
  };
  const saveFinanceRecord = () => {
    const amount = Number(form.amount || 0);
    if (!form.description?.trim() || amount <= 0) return;
    if (form.financeRecurringId) {
      const schedule = (workspace.financeRecurring || []).find((item) => item.id === form.financeRecurringId);
      if (!schedule) { setError("This recurring item no longer exists. Refresh and try again."); return; }
      const nextDate = form.date || schedule.nextDate;
      if (form.repeatEnd && form.repeatEnd < nextDate) { setError("The repeat-until date must be on or after the next due date."); return; }
      const [year, month, day] = nextDate.split("-").map(Number);
      const updated: FinanceRecurring = { ...schedule, description: form.description.trim(), category: form.category || "Other", amount, kind: form.kind === "Expense" ? "Expense" : "Income", clientId: form.clientId || "", frequency: form.repeat as FinanceRecurring["frequency"], nextDate, endDate: form.repeatEnd || undefined, anchorDay: day, anchorMonth: month };
      persist({ ...workspace, financeRecurring: (workspace.financeRecurring || []).map((item) => item.id === schedule.id ? updated : item) }, "Recurring finance item updated");
      setModal(""); setForm({}); return;
    }
    const record: FinanceRecord = { id: form.financeRecordId || uid(), kind: form.kind === "Expense" ? "Expense" : "Income", description: form.description.trim(), category: form.category || "Other", amount, date: form.date || localDateKey(), clientId: form.clientId || "" };
    if (form.repeat && form.repeat !== "None" && form.repeatEnd && form.repeatEnd < record.date) { setError("The repeat-until date must be on or after the first entry date."); return; }
    const editing = Boolean(form.financeRecordId);
    const current = editing ? workspace.financeRecords.find((item) => item.id === record.id) : undefined;
    const inferredSeriesId = current?.seriesId || current?.id.match(/^recurring-(.+)-\d{4}-\d{2}-\d{2}$/)?.[1];
    const existingSchedule = inferredSeriesId ? (workspace.financeRecurring || []).find((item) => item.id === inferredSeriesId) : undefined;
    const financeRecurring = [...(workspace.financeRecurring || [])];
    let seriesId = existingSchedule?.id;
    const frequencyChoice = form.repeat || "None";
    if (["Weekly", "Monthly", "Quarterly", "Yearly"].includes(frequencyChoice)) {
      const start = new Date(`${record.date}T12:00:00`);
      const frequency = frequencyChoice as FinanceRecurring["frequency"];
      seriesId ||= uid();
      const schedule: FinanceRecurring = { id: seriesId, kind: record.kind, description: record.description, category: record.category, amount: record.amount, clientId: record.clientId, frequency, nextDate: nextFinanceOccurrence(record.date, frequency, start.getDate(), start.getMonth() + 1), startDate: existingSchedule?.startDate || record.date, endDate: form.repeatEnd || undefined, anchorDay: start.getDate(), anchorMonth: start.getMonth() + 1 };
      const scheduleIndex = financeRecurring.findIndex((item) => item.id === seriesId);
      if (scheduleIndex >= 0) financeRecurring[scheduleIndex] = schedule;
      else financeRecurring.unshift(schedule);
      record.seriesId = seriesId;
    } else if (existingSchedule) {
      financeRecurring.splice(financeRecurring.findIndex((item) => item.id === existingSchedule.id), 1);
      record.seriesId = undefined;
    } else if (editing) {
      record.seriesId = undefined;
    }
    persist({ ...workspace, financeRecurring, financeRecords: editing ? workspace.financeRecords.map((item) => item.id === record.id ? record : item) : [record, ...workspace.financeRecords] }, editing ? `${record.kind} updated` : `${record.kind} saved`); setModal(""); setForm({});
  };
  const editFinanceRecord = (record: FinanceRecord) => {
    const seriesId = record.seriesId || record.id.match(/^recurring-(.+)-\d{4}-\d{2}-\d{2}$/)?.[1];
    const schedule = seriesId ? (workspace.financeRecurring || []).find((item) => item.id === seriesId) : undefined;
    openModal("finance", { financeRecordId: record.id, kind: record.kind, description: record.description, category: record.category, amount: String(record.amount), date: record.date, clientId: record.clientId || "", repeat: schedule?.frequency || "None", repeatEnd: schedule?.endDate || "" });
  };
  const editFinanceRecurring = (schedule: FinanceRecurring) => openModal("finance", { financeRecurringId: schedule.id, kind: schedule.kind, description: schedule.description, category: schedule.category, amount: String(schedule.amount), date: schedule.nextDate, clientId: schedule.clientId || "", repeat: schedule.frequency, repeatEnd: schedule.endDate || "" });
  const deleteFinanceRecord = (id: string) => persist({ ...workspace, financeRecords: workspace.financeRecords.filter((record) => record.id !== id) }, "Finance entry removed");
  const deleteFinanceRecurring = (id: string) => {
    if (!window.confirm("Stop this recurring income or expense? Past entries will stay in your records.")) return;
    persist({ ...workspace, financeRecurring: (workspace.financeRecurring || []).filter((item) => item.id !== id) }, "Recurring finance item stopped");
  };
  const reorderTasks = (orderedIds: string[], status: string) => {
    const live = workspaceLiveRef.current;
    if (!live?.tasks) return;
    const rank = new Map(orderedIds.map((id, index) => [id, index] as const));
    let changed = false;
    const tasks = live.tasks.map((item) => {
      const position = rank.get(item.id);
      if (position === undefined || item.status !== status || item.boardOrder === position) return item;
      changed = true;
      return { ...item, boardOrder: position };
    });
    if (changed) void persist({ ...live, tasks }, "Task order updated");
  };
  const updateTask = (id: string, status: string, pendingReasonOverride?: string) => {
    const current = workspace.tasks.find((task) => task.id === id);
    if (!current) return;
    let pendingReason = current.pendingReason;
    if (status === "Blocked" && current.status !== "Blocked" && current.status !== "Pending") {
      pendingReason = String(pendingReasonOverride || "").trim().slice(0, 150);
      if (!pendingReason) { setError("A short reason is required before a task can be moved to Pending."); return; }
    }
    const now = new Date();
    const nowIso = now.toISOString();
    const resumeAiRun = isAiAssignedTask(current) && status === "In progress" && canResumeAiTaskRun(current.aiRunState, current.aiApprovals || [], current.checklist || []);
    let entries = workspace.entries;
    let activeTimer = workspace.activeTimer;
    const saveActiveTimer = (timer: NonNullable<Workspace["activeTimer"]>, note: string) => {
      const task = workspace.tasks.find((item) => item.id === timer.taskId);
      const seconds = Math.max(1, Math.floor((now.getTime() - new Date(timer.startedAt).getTime()) / 1000));
      entries = [{ id: uid(), taskId: timer.taskId, clientId: task?.clientId || "", staffId: timer.staffId, startAt: timer.startedAt, endAt: nowIso, seconds, note, billable: true }, ...entries];
    };
    let message = "Task updated";
    if (status === "In progress" && current.status !== "In progress") {
      if (resumeAiRun) {
        if (activeTimer) {
          saveActiveTimer(activeTimer, activeTimer.taskId === id ? "Timer stopped when the AI resumed the AI task" : "Timer saved when the AI resumed an AI task");
          activeTimer = null;
        }
        message = `AI task resumed · queued for the AI and will move to Doing when work starts`;
      } else if (activeTimer?.taskId === id) {
        message = `In progress · timer continues for ${current.title}`;
      } else {
        if (activeTimer) saveActiveTimer(activeTimer, "Timer saved when another task started");
        activeTimer = { taskId: id, staffId: current.assigneeId || workspace.staff.find((member) => !member.isBot)?.id || workspace.staff[0]?.id || "", startedAt: nowIso };
        message = `In progress · timer started for ${current.title}`;
      }
    } else if (status !== "In progress" && activeTimer?.taskId === id) {
      const movedTo = status === "Blocked" ? "Pending" : status;
      saveActiveTimer(activeTimer, status === "Done" ? "Timer saved when task completed" : `Timer stopped automatically when task moved to ${movedTo}`);
      activeTimer = null;
      message = status === "Done" ? "Task completed · timer saved" : `Task moved to ${movedTo} · timer stopped and saved`;
    }
    const tasks = workspace.tasks.map((task) => task.id === id ? { ...task, status, ...(status === "Blocked" && pendingReason ? { pendingReason, pendingReasonBy: sessionUser.name || sessionUser.email || "Team member", pendingReasonAt: nowIso } : {}), ...(resumeAiRun ? { pendingReason: undefined, pendingReasonBy: undefined, pendingReasonAt: undefined, aiRunState: "scheduled" as const, aiRunStartedAt: undefined, aiRunAt: undefined, aiStartNowRequestedAt: undefined, aiRunAttempt: (task.aiRunAttempt || 0) + 1, dueAt: nowIso } : {}) } : task);
    if (status === "Done" && current && current.status !== "Done" && current.repeat && current.repeat !== "None" && recurringTaskTemplateEnabled(current, workspace.clients)) {
      const nextDue = nextTemplateOrRecurringDate(current);
      const nextTask: Task = { ...current, id: uid(), seriesId: current.seriesId || current.id, occurrence: (current.occurrence || 1) + 1, status: "To do", due: nextDue, dueAt: nextRecurringTaskDueAt(current, nextDue), repeatTime: current.repeatTime || localTimeFromIso(current.dueAt), createdAt: nowIso, recurrenceNoticePending: true, createdById: sessionUser.id, aiRunState: workspace.staff.find((member) => member.id === current.assigneeId)?.isBot ? "scheduled" : undefined, aiRunAt: undefined, aiFeedback: undefined, aiRecommendations: [], aiLandingPageRecommendations: [], aiApprovals: [], checklist: (current.checklist || []).map((item) => ({ ...item, done: false, evidence: undefined })) };
      persist({ ...workspace, tasks: [nextTask, ...tasks], entries, activeTimer }, `Recurring task added to To do · ${nextTask.due} at ${nextTask.repeatTime} · included in weekly client summary`);
      return;
    }
    persist({ ...workspace, tasks, entries, activeTimer }, message);
  };
  const savePendingReason = (taskId: string, reason: string) => {
    const current = workspace.tasks.find((task) => task.id === taskId);
    const pendingReason = reason.trim().slice(0, 150);
    if (!current || !pendingReason) { setError("A short reason is required before a task can stay Pending."); return; }
    const now = new Date().toISOString();
    const tasks = workspace.tasks.map((task) => task.id === taskId ? { ...task, pendingReason, pendingReasonBy: sessionUser.name || sessionUser.email || "Team member", pendingReasonAt: now } : task);
    persist({ ...workspace, tasks }, "Pending reason saved");
  };
  const updateTaskDueDate = (taskId: string, due: string) => {
    const current = workspace.tasks.find((task) => task.id === taskId);
    if (!current || current.due === due || (isAiAssignedTask(current) && !due)) return;
    const dueAt = due ? localTaskDueAt(due, current.repeatTime || localTimeFromIso(current.dueAt)) : undefined;
    const tasks = workspace.tasks.map((task) => task.id === taskId ? { ...task, due, dueAt } : task);
    persist({ ...workspace, tasks }, due ? `Due date changed · ${current.title}` : `Due date removed · ${current.title}`);
  };
  const reviewStaffTask = async (taskId: string, action: "submit" | "approve" | "request_changes", note = "", approverId = "") => {
    try {
      const response = await fetch("/api/tasks/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ taskId, action, note, approverId }) });
      const result = await response.json() as { task?: Task; event?: Activity; error?: string };
      if (!response.ok || !result.task) throw new Error(result.error || "The task review could not be saved.");
      const latest = workspaceLiveRef.current;
      const next = { ...latest, tasks: latest.tasks.map((task) => task.id === taskId ? result.task! : task), activity: result.event ? [result.event, ...(latest.activity || [])].slice(0, 100) : latest.activity };
      workspaceLiveRef.current = next;
      setWorkspace(next);
      const message = action === "submit" ? `Sent to ${next.staff.find((member) => member.id === approverId)?.name || "the selected approver"}'s Approvals tab` : action === "approve" ? "Task approved and completed" : "Changes sent back to the worker";
      setToast(message); window.setTimeout(() => setToast(""), 3000);
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The task review could not be saved.");
      return false;
    }
  };
  const reviewAllStaffTasks = async (taskIds: string[]) => {
    try {
      const response = await fetch("/api/tasks/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "approve_all", taskIds }) });
      const result = await response.json() as { tasks?: Task[]; events?: Activity[]; approvedCount?: number; error?: string };
      if (!response.ok || !result.tasks?.length) throw new Error(result.error || "The pending tasks could not be approved.");
      const latest = workspaceLiveRef.current;
      const approvedById = new Map(result.tasks.map((task) => [task.id, task]));
      const next = { ...latest, tasks: latest.tasks.map((task) => approvedById.get(task.id) || task), activity: [...(result.events || []), ...(latest.activity || [])].slice(0, 100) };
      workspaceLiveRef.current = next;
      setWorkspace(next);
      setToast(`${result.approvedCount || result.tasks.length} staff task${(result.approvedCount || result.tasks.length) === 1 ? "" : "s"} approved`);
      window.setTimeout(() => setToast(""), 3000);
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The pending tasks could not be approved.");
      return false;
    }
  };
  const dismissAiTaskEmailNotice = (taskId: string) => {
    const task = workspace.tasks.find((item) => item.id === taskId);
    if (!task || !task.aiNotificationStatus || task.aiNotificationDismissedAt) return;
    const dismissedAt = new Date().toISOString();
    const tasks = workspace.tasks.map((item) => item.id === taskId ? { ...item, aiNotificationDismissedAt: dismissedAt } : item);
    persist({ ...workspace, tasks }, "Email notice cleared · task remains open");
  };
  const dismissAiTask = (taskId: string) => {
    const task = workspace.tasks.find((item) => item.id === taskId);
    if (!task || !isAiAssignedTask(task) || task.aiDismissedAt || !isAdmin) return;
    if (task.aiRunState === "running" || (task.aiApprovals || []).some((approval) => approval.status === "applying")) { setError("This task is actively running or applying a Google Ads change. Wait for it to finish before dismissing it."); return; }
    if (!window.confirm(`Dismiss “${task.title}” from the active AI task list? It will not be marked complete or deleted. You can find it in Dismissed and restore it later.`)) return;
    const dismissedAt = new Date().toISOString();
    const actor = sessionUser.name || "Workspace owner";
    const event: Activity = { id: uid(), title: "AI task dismissed", detail: `${task.title} · ${workspace.clients.find((client) => client.id === task.clientId)?.name || "Internal"} · ${task.aiMode || task.service}${task.campaignName ? ` · ${task.campaignName}` : ""}`, icon: "🗃️", at: dismissedAt, actor, actorAvatar: selfProfile?.avatar, staffId: sessionUser.id, clientId: task.clientId, taskId: task.id, service: task.aiMode || task.service, kind: "task", note: `${actor} dismissed this AI task from the active queue. It was not marked complete, no Ads changes were made, and the task can be restored from History.` };
    const tasks = workspace.tasks.map((item) => item.id === taskId ? { ...item, status: "Cancelled", aiDismissedAt: dismissedAt, aiDismissedBy: actor, aiStartNowRequestedAt: undefined } : item);
    persist({ ...workspace, tasks, activity: [event, ...(workspace.activity || [])].slice(0, 100) }, "AI task dismissed · saved in Dismissed");
  };
  const restoreAiTask = (taskId: string) => {
    const task = workspace.tasks.find((item) => item.id === taskId && item.aiDismissedAt);
    if (!task || !isAiAssignedTask(task) || !isAdmin) return;
    const restoredAt = new Date().toISOString();
    const actor = sessionUser.name || "Workspace owner";
    const event: Activity = { id: uid(), title: "AI task restored", detail: `${task.title} · ${workspace.clients.find((client) => client.id === task.clientId)?.name || "Internal"} · ${task.aiMode || task.service}`, icon: "↩️", at: restoredAt, actor, actorAvatar: selfProfile?.avatar, staffId: sessionUser.id, clientId: task.clientId, taskId: task.id, service: task.aiMode || task.service, kind: "task", note: `${actor} restored this AI task to the active queue. Its checklist, report and account-change history were preserved.` };
    const tasks = workspace.tasks.map((item) => item.id === taskId ? { ...item, status: "Blocked", aiDismissedAt: undefined, aiDismissedBy: undefined } : item);
    persist({ ...workspace, tasks, activity: [event, ...(workspace.activity || [])].slice(0, 100) }, "AI task restored to active queue");
  };
  const toggleTaskChecklistItem = (taskId: string, itemId: string) => {
    const tasks = workspace.tasks.map((task) => task.id !== taskId ? task : { ...task, checklist: (task.checklist || []).map((item) => item.id === itemId ? { ...item, done: !item.done } : item) });
    persist({ ...workspace, tasks }, "Task checklist updated");
  };
  const updateTaskChecklist = (taskId: string, checklist: TaskChecklistItem[]) => {
    const current = workspace.tasks.find((task) => task.id === taskId);
    if (!current || current.aiRunState === "running" || current.aiApprovals?.some((approval) => approval.status === "applying")) return;
    const nextChecklist = checklist.map((item) => ({ ...item, text: cleanChecklistStep(item.text).slice(0, 240) })).filter((item) => item.text);
    const invalidatesClosedAiReview = isAiAssignedTask(current) && current.aiRunState === "completed" && nextChecklist.some((item) => !item.done);
    const tasks = workspace.tasks.map((task) => task.id !== taskId ? task : { ...task, checklist: nextChecklist, ...(invalidatesClosedAiReview ? { status: "Blocked", aiRunState: "needs_review" as const, aiReviewedAt: undefined } : {}) });
    persist({ ...workspace, tasks }, invalidatesClosedAiReview ? "Checklist changed · AI task reopened for review" : "Task checklist saved");
  };
  const scheduleAiTask = (taskId: string, due: string, time: string) => {
    const current = workspace.tasks.find((task) => task.id === taskId);
    if (!current || !isAiAssignedTask(current) || current.aiDismissedAt) return;
    if (current.aiRunState === "running" || current.aiApprovals?.some((approval) => approval.status === "pending" || approval.status === "applying")) { setError("Finish the current AI run and resolve pending account changes before rescheduling this task."); return; }
    const runAt = new Date(`${due}T${time}:00`).getTime();
    if (!Number.isFinite(runAt) || runAt <= Date.now()) { setError("Choose a future date and time for this AI task."); return; }
    const dueAt = new Date(runAt).toISOString();
    const tasks = workspace.tasks.map((task) => task.id === taskId ? { ...task, due, dueAt, repeatTime: time, status: "To do", aiRunState: "scheduled" as const, aiRunStartedAt: undefined, aiRunAt: undefined, aiStartNowRequestedAt: undefined, aiRunAttempt: (task.aiRunAttempt || 0) + 1 } : task);
    persist({ ...workspace, tasks }, `AI task scheduled for ${due} at ${time}`);
  };
  const startAiTaskNow = async (taskId: string): Promise<boolean> => {
    const current = workspaceLiveRef.current;
    const task = current.tasks.find((item) => item.id === taskId);
    if (!task || !isAiAssignedTask(task) || !isAdmin || task.aiDismissedAt || task.aiStartNowRequestedAt) return false;
    const isScheduled = task.aiRunState === "scheduled";
    const isRetryable = canResumeAiTaskRun(task.aiRunState, task.aiApprovals || [], task.checklist || []);
    if (!isScheduled && !isRetryable) return false;
    const pendingApprovals = (task.aiApprovals || []).filter((item) => item.status === "pending");
    const hasIncompleteChecklist = (task.checklist || []).some((step) => !step.done);
    const retryEvidenceBlockedApprovals = pendingApprovals.length > 0 && !hasRunnablePendingApproval(pendingApprovals, task.checklist || []);
    if ((task.aiApprovals || []).some((item) => item.status === "applying") || pendingApprovals.length > 0 && !retryEvidenceBlockedApprovals) { setError("Resolve Ads changes that already have enough evidence before starting this task. The AI can resume while the pending changes are blocked on missing checklist evidence."); return false; }
    const now = new Date();
    const dueAt = now.toISOString();
    setSaving(true);
    setError("");
    try {
      // Starting an AI run is a focused task action. Saving the full workspace
      // here needlessly parses and rewrites every client, note, and attachment.
      const response = await fetch("/api/tasks/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ taskId }) });
      const result = await response.json().catch(() => ({})) as { task?: Task; activity?: Activity; error?: string };
      if (!response.ok || !result.task) throw new Error(result.error || "The task could not be started. Please try again.");
      const latest = workspaceLiveRef.current;
      const next: Workspace = {
        ...latest,
        tasks: latest.tasks.map((item) => item.id === taskId ? { ...item, ...result.task } : item),
        activity: result.activity ? [result.activity, ...(latest.activity || []).filter((item) => item.id !== result.activity!.id)].slice(0, 100) : latest.activity,
      };
      workspaceLiveRef.current = next;
      setWorkspace(next);
      const message = `${isRetryable ? "Retry started" : "Task starting"} · moved to Doing`;
      setToast(message);
      window.setTimeout(() => setToast(""), 4000);
      return true;
    } catch (error) {
      setError(error instanceof Error ? error.message : "The task could not be started.");
      return false;
    } finally {
      setSaving(false);
    }
  };
  const startRecommendationFollowUp = async (sourceTaskId: string, recommendationId: string, title: string, detail: string, rationale: string, evidence: string, category: string, feedback: string, feedbackChoices: string[] = []): Promise<string | false> => {
    if (!isAdmin || previewMemberId || startingRecommendationId) return false;
    const current = workspaceLiveRef.current;
    const source = current.tasks.find((item) => item.id === sourceTaskId);
    const agent = source && current.staff.find((member) => member.id === source.assigneeId && member.isBot);
    if (!source || !agent || !source.clientId || !source.aiMode) {
      setError("This recommendation needs an assigned AI teammate and client before it can be started.");
      return false;
    }
    if ((agent.aiModeAccess?.length || 0) && !agent.aiModeAccess?.includes(source.aiMode)) {
      setError(`${agent.name} is not enabled for ${source.aiMode} tasks. Update the AI teammate’s access first.`);
      return false;
    }
    const alreadyStarted = [...(source.aiRecommendations || []), ...(source.aiLandingPageRecommendations || [])].some((item) => item.id === recommendationId && item.followUpTaskId);
    if (alreadyStarted) return false;
    const followUpId = uid();
    const now = new Date();
    const nowIso = now.toISOString();
    const due = localDateKey(now);
    const conciseTitle = `Recommendation · ${title}`.slice(0, 110);
    const ownerChoices = feedbackChoices.length ? `\nOwner choices: ${feedbackChoices.join("; ")}` : "";
    const ownerNote = feedback.trim() ? `\nOwner note: ${feedback.trim().slice(0, 500)}` : "";
    const taskInstructions = `Work on this recommendation for the selected client using only connected tools and verified evidence.\nRecommendation: ${title}\nWhat to do: ${detail}\nWhy: ${rationale}\nEvidence: ${evidence}\nCategory: ${category}${ownerChoices}${ownerNote}\n\nComplete any parts supported by the connected tools. For Google Ads, prepare exact evidence-backed changes for the separate owner approval queue; never apply account changes without that approval. Public landing-page snapshots are read-only: do not claim a website was edited. If a required connection or permission is missing, finish the available checks and give one short, plain-language next step. Save a concise result and attach supporting evidence. If a connected tool can capture a genuine screenshot of completed work, attach it to this task; never create a mock screenshot. If screenshot capture is unavailable, say so briefly in the result.`;
    const followUp: Task = { id: followUpId, clientId: source.clientId, projectId: source.projectId || "", title: conciseTitle, assigneeId: agent.id, status: "To do", priority: source.priority || "Normal", service: source.service, estimate: 0, due, dueAt: nowIso, repeatTime: localTimeFromIso(nowIso), createdAt: nowIso, createdById: sessionUser.id, notes: taskInstructions, aiInstructions: taskInstructions, aiMode: source.aiMode, aiRunState: "scheduled", ...(source.campaignId ? { campaignId: source.campaignId, campaignName: source.campaignName || "", campaignContext: source.campaignContext || "" } : {}), repeat: "None", checklist: [{ id: uid(), text: `Work on: ${title}`.slice(0, 240), done: false }] };
    setStartingRecommendationId(recommendationId);
    try {
      const updatedSource: Task = { ...source,
        aiRecommendations: (source.aiRecommendations || []).map((item) => item.id === recommendationId ? { ...item, followUpTaskId: followUpId, startedAt: nowIso, ownerFeedback: feedback.trim().slice(0, 500), ownerFeedbackChoices: feedbackChoices.slice(0, 8), ownerFeedbackUpdatedAt: nowIso } : item),
        aiLandingPageRecommendations: (source.aiLandingPageRecommendations || []).map((item) => item.id === recommendationId ? { ...item, followUpTaskId: followUpId, startedAt: nowIso, ownerFeedback: feedback.trim().slice(0, 500), ownerFeedbackChoices: feedbackChoices.slice(0, 8), ownerFeedbackUpdatedAt: nowIso } : item),
      };
      const sourceScope = `${source.clientId}:${source.campaignId || String(source.campaignName || source.service).trim().toLowerCase()}`;
      const sourceRecommendation = [...(source.aiRecommendations || []), ...(source.aiLandingPageRecommendations || [])].find((item) => item.id === recommendationId);
      const sourceIssue = sourceRecommendation ? ("url" in sourceRecommendation ? aiRecommendationIssueKey(sourceRecommendation.section, "Landing page", sourceRecommendation.rationale, sourceRecommendation.url, sourceRecommendation.section) : aiRecommendationIssueKey(sourceRecommendation.title, sourceRecommendation.category, sourceRecommendation.detail)) : "";
      const supersededAt = nowIso;
      const updatedTasks = current.tasks.map((item) => {
        if (item.id === sourceTaskId) return updatedSource;
        const scope = `${item.clientId}:${item.campaignId || String(item.campaignName || item.service).trim().toLowerCase()}`;
        if (!sourceIssue || scope !== sourceScope) return item;
        return {
          ...item,
          aiRecommendations: (item.aiRecommendations || []).map((recommendation) => aiRecommendationIssueKey(recommendation.title, recommendation.category, recommendation.detail) === sourceIssue ? { ...recommendation, supersededAt } : recommendation),
          aiLandingPageRecommendations: (item.aiLandingPageRecommendations || []).map((recommendation) => aiRecommendationIssueKey(recommendation.section, "Landing page", recommendation.rationale, recommendation.url, recommendation.section) === sourceIssue ? { ...recommendation, supersededAt } : recommendation),
        };
      });
      const saved = await persist({ ...current, tasks: [followUp, ...updatedTasks] }, `AI follow-up started · ${source.title}`);
       if (!saved) return false;
      const started = await startAiTaskNow(followUpId);
      if (started) {
        setToast("AI follow-up started · track it on the AI task board");
        window.setTimeout(() => setToast(""), 4500);
       } else {
         const latest = workspaceLiveRef.current;
         const rollback: Workspace = { ...latest, tasks: latest.tasks.filter((item) => item.id !== followUpId).map((item) => item.id !== sourceTaskId ? item : {
           ...item,
           aiRecommendations: (item.aiRecommendations || []).map((recommendation) => recommendation.id === recommendationId ? { ...recommendation, followUpTaskId: undefined, startedAt: undefined } : recommendation),
           aiLandingPageRecommendations: (item.aiLandingPageRecommendations || []).map((recommendation) => recommendation.id === recommendationId ? { ...recommendation, followUpTaskId: undefined, startedAt: undefined } : recommendation),
         }) };
         await persist(rollback, `Recommendation returned to approvals · ${source.title}`);
         setError("This recommendation could not start. It has been returned to Approvals so it isn’t lost.");
      }
      return started ? followUpId : false;
    } finally { setStartingRecommendationId(""); }
  };
  const cancelAiTaskRun = async (taskId: string): Promise<boolean> => {
    if (!isAdmin) return false;
    try {
      const response = await fetch("/api/tasks/live", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "cancel", taskId }) });
      const payload = await readApiJson<{ task?: Task; message?: string; error?: string }>(response, "Cancel AI task");
      if (!response.ok || !payload.task) throw new Error(payload.error || "Could not cancel this run.");
      setWorkspace((current) => ({ ...current, tasks: current.tasks.map((task) => task.id === taskId ? { ...task, ...payload.task } : task) }));
      setToast(payload.message || "Cancellation requested. The AI will stop at the next safe checkpoint.");
      window.setTimeout(() => setToast(""), 5000);
      return true;
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not cancel this run.");
      return false;
    }
  };
  const markAiTaskReviewed = (taskId: string) => {
    const task = workspace.tasks.find((item) => item.id === taskId && item.aiRunState === "needs_review");
    if (!task) return;
    if (!canCloseAiTask(task.checklist || [], task.aiApprovals || [])) {
      setError("This AI task is still pending: verify every checklist step, decide each proposed change, and confirm every applied change in Google Ads before marking it Done.");
      return;
    }
    const reviewedAt = new Date().toISOString();
    const actor = sessionUser.name || "Workspace owner";
    const event: Activity = { id: uid(), title: "AI task reviewed and closed", detail: `${task.title} · ${workspace.clients.find((client) => client.id === task.clientId)?.name || "Client"} · ${task.aiMode || task.service}`, icon: "✅", at: reviewedAt, actor, actorAvatar: selfProfile?.avatar, staffId: sessionUser.id, clientId: task.clientId, taskId: task.id, service: task.aiMode || task.service, kind: "task", note: `${actor} reviewed the AI’s findings and closed the task. This confirms review of the task result; it does not approve or apply a Google Ads account change.` };
    const reviewedTask = { ...task, status: "Done", aiRunState: "completed" as const, aiReviewedAt: reviewedAt, aiReviewedBy: actor };
    let tasks = workspace.tasks.map((item) => item.id === taskId ? reviewedTask : item);
    const activity = [event, ...(workspace.activity || [])];
    if (task.repeat && task.repeat !== "None" && recurringTaskTemplateEnabled(task, workspace.clients)) {
      const nextDue = nextTemplateOrRecurringDate(task);
      const nextTask: Task = { ...task, id: uid(), seriesId: task.seriesId || task.id, occurrence: (task.occurrence || 1) + 1, status: "To do", due: nextDue, dueAt: nextRecurringTaskDueAt(task, nextDue), repeatTime: task.repeatTime || localTimeFromIso(task.dueAt), recurrenceNoticePending: true, createdById: sessionUser.id, aiRunState: workspace.staff.find((member) => member.id === task.assigneeId)?.isBot ? "scheduled" : undefined, aiRunAt: undefined, aiReviewedAt: undefined, aiReviewedBy: undefined, aiFeedback: undefined, aiRecommendations: [], aiLandingPageRecommendations: [], aiApprovals: [], checklist: (task.checklist || []).map((item) => ({ ...item, done: false, evidence: undefined })) };
      tasks = [nextTask, ...tasks];
      activity.unshift({ id: uid(), title: "Recurring task added to To do", detail: `${nextTask.title} · ${workspace.clients.find((client) => client.id === task.clientId)?.name || "Client"} · ${task.repeat} · ${nextDue} at ${nextTask.repeatTime}`, icon: "🔁", at: reviewedAt, actor, actorAvatar: selfProfile?.avatar, staffId: sessionUser.id, clientId: task.clientId, taskId: nextTask.id, service: task.aiMode || task.service, kind: "task", note: `Next occurrence approved after reviewing the AI’s result. Scheduled for ${nextDue} at ${nextTask.repeatTime} Europe/Dublin; included in weekly client summary.` });
    }
    persist({ ...workspace, tasks, activity: activity.slice(0, 100) }, task.repeat && task.repeat !== "None" ? "AI task reviewed · next occurrence queued" : "AI task reviewed and closed");
  };
  const resolveAiApproval = async (taskId: string, approvalId: string, decision: "apply" | "reject" | "reconcile"): Promise<boolean> => {
    const currentWorkspace = workspaceLiveRef.current;
    const task = currentWorkspace.tasks.find((item) => item.id === taskId);
    const approval = task?.aiApprovals?.find((item) => item.id === approvalId && (item.status === "pending" || decision === "reconcile" && item.status === "applying"));
    if (!task || !approval || !(viewIsAdmin || viewAccess.aiApprovals)) return false;
    if (decision === "apply") {
      const evidenceBlockReason = approvalEvidenceBlockReason(approval, task.checklist || []);
      if (evidenceBlockReason) {
        setError(evidenceBlockReason);
        return false;
      }
    }
    setSaving(true); setError("");
    if (decision === "reconcile") {
      try {
        const isMetaApproval = approval.actionType.startsWith("META_");
        const response = await fetch(isMetaApproval ? "/api/meta-ads/changes" : "/api/google-ads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(isMetaApproval ? { action: "reconcile", proposalId: approval.pendingChangeId, clientId: task.clientId, taskId } : { reconcilePendingChangeId: approval.pendingChangeId }) });
        const result = await response.json() as { error?: string; applied?: boolean; verified?: boolean; keywordStatus?: string; checkedAt?: string; detail?: string };
        if (!response.ok || result.verified !== true) throw new Error(result.error || "Google Ads could not verify this interrupted approval.");
        const checkedAt = result.checkedAt || new Date().toISOString();
        const resultDetail = result.applied
          ? `${result.detail || "Google Ads confirmed the requested keyword is enabled."} The original change time could not be recovered.`
          : `${result.detail || "Google Ads confirmed the requested keyword is absent."} No change was confirmed; the approval is ready for review again.`;
        const nextTasks = workspaceLiveRef.current.tasks.map((item) => item.id !== taskId ? item : {
          ...item,
          status: "Blocked",
          aiRunState: "needs_review" as const,
          aiRunStartedAt: undefined,
          aiApprovals: (item.aiApprovals || []).map((entry) => entry.id !== approvalId ? entry : {
            ...entry,
            status: result.applied ? "applied" as const : "pending" as const,
            startedAt: undefined,
            verification: result.applied ? "verified" as const : undefined,
            decidedAt: result.applied ? checkedAt : undefined,
            decidedBy: result.applied ? sessionUser.name || "Workspace owner" : undefined,
            resultDetail,
          }),
        });
        const persisted = await persist({ ...workspaceLiveRef.current, tasks: nextTasks }, resultDetail);
        if (persisted) setToast(result.applied ? `Stuck approval cleared · change confirmed in ${approval.actionType.startsWith("META_") ? "Meta Ads" : "Google Ads"}` : "Stuck approval cleared · no change confirmed; ready for review");
        return persisted;
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Could not recover this Google Ads approval.");
        return false;
      } finally { setSaving(false); }
    }
    if (decision === "apply") {
      const startedAt = new Date().toISOString();
      const latestWorkspace = workspaceLiveRef.current;
      const startedWorkspace = { ...latestWorkspace, tasks: latestWorkspace.tasks.map((item) => item.id !== taskId ? item : { ...item, status: "In progress", aiApprovals: (item.aiApprovals || []).map((entry) => entry.id === approvalId ? { ...entry, status: "applying" as const, startedAt } : entry) }) };
      const savedStart = await persist(startedWorkspace, `Doing · applying ${approval.title}`);
      if (!savedStart) { setSaving(false); return false; }
      setToast(`Doing · applying and checking ${approval.actionType.startsWith("META_") ? "Meta Ads" : "Google Ads"}`);
    }
    try {
      const isMetaApproval = approval.actionType.startsWith("META_");
      const response = await fetch(isMetaApproval ? "/api/meta-ads/changes" : "/api/google-ads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(isMetaApproval ? { action: decision === "apply" ? "approve" : "reject", proposalId: approval.pendingChangeId, clientId: task.clientId, taskId } : { confirmed: true, pendingChangeId: approval.pendingChangeId, ...(decision === "reject" ? { decision: "reject" } : {}) }) });
      const result = await response.json() as { error?: string; detail?: string; changedAt?: string; actor?: string; verified?: boolean; client?: string; campaign?: string; campaignId?: string; action?: string; oldValue?: string; newValue?: string };
      if (!response.ok) throw new Error(result.error || "Could not resolve this Google Ads approval.");
      const decidedAt = result.changedAt || new Date().toISOString();
      const decidedBy = sessionUser.name || result.actor || "Workspace owner";
      const provider = isMetaApproval ? "Meta Ads" : "Google Ads";
      const resultDetail = decision === "reject" ? `Rejected recommendation: ${approval.title}. No ${provider} change was made.` : `${result.client || "Client"}: ${result.campaign || approval.campaignName} · ${result.detail || approval.title}. ${result.verified ? `${provider} read-back confirmed the change.` : `The provider accepted the request, but could not verify the final live state.`}`;
      let nextTasks = workspaceLiveRef.current.tasks.map((item) => {
        if (item.id !== taskId) return item;
        const aiApprovals = (item.aiApprovals || []).map((entry) => entry.id !== approvalId ? entry : { ...entry, status: decision === "apply" ? "applied" as const : "rejected" as const, startedAt: undefined, verification: decision === "apply" ? result.verified ? "verified" as const : "unverified" as const : undefined, decidedAt, decidedBy, resultDetail });
        const closeTask = item.aiRunState === "needs_review" && canCloseAiTask(item.checklist || [], aiApprovals);
        return { ...item, aiApprovals, ...(closeTask ? { pendingReason: undefined, pendingReasonBy: undefined, pendingReasonAt: undefined } : { pendingReason: decision === "reject" ? "A recommendation was rejected; review any remaining checklist work." : result.verified ? "The approved change is verified; remaining task checks are still open." : "The approved change needs live verification." , pendingReasonBy: decidedBy, pendingReasonAt: decidedAt }), status: closeTask ? "Done" : decision === "apply" ? "Blocked" : item.status, ...(closeTask ? { aiRunState: "completed" as const, aiReviewedAt: decidedAt, aiReviewedBy: sessionUser.name || "Workspace owner" } : decision === "apply" ? { aiRunState: "needs_review" as const, aiRunStartedAt: undefined } : {}) };
      });
      const newlyCompleted = nextTasks.find((item) => item.id === taskId && item.aiRunState === "completed" && item.status === "Done" && task.aiRunState !== "completed");
      if (newlyCompleted?.repeat && newlyCompleted.repeat !== "None" && recurringTaskTemplateEnabled(newlyCompleted, workspaceLiveRef.current.clients)) {
        const nextDue = nextTemplateOrRecurringDate(newlyCompleted);
        const nextTask: Task = { ...newlyCompleted, id: uid(), seriesId: newlyCompleted.seriesId || newlyCompleted.id, occurrence: (newlyCompleted.occurrence || 1) + 1, status: "To do", due: nextDue, dueAt: nextRecurringTaskDueAt(newlyCompleted, nextDue), repeatTime: newlyCompleted.repeatTime || localTimeFromIso(newlyCompleted.dueAt), recurrenceNoticePending: true, createdById: sessionUser.id, aiRunState: workspace.staff.find((member) => member.id === newlyCompleted.assigneeId)?.isBot ? "scheduled" : undefined, aiRunStartedAt: undefined, aiRunAttempt: 0, aiRunAt: undefined, aiReviewedAt: undefined, aiReviewedBy: undefined, aiFeedback: undefined, aiRecommendations: [], aiLandingPageRecommendations: [], aiApprovals: [], checklist: (newlyCompleted.checklist || []).map((item) => ({ ...item, done: false, evidence: undefined })) };
        nextTasks = [nextTask, ...nextTasks];
      }
      const persisted = await persist({ ...workspaceLiveRef.current, tasks: nextTasks }, resultDetail);
      return persisted && (decision === "reject" || result.verified === true);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : `Could not resolve this ${approval.actionType.startsWith("META_") ? "Meta Ads" : "Google Ads"} approval.`;
      if (message.includes("already been applied or decided")) {
        try {
          const latest = await fetch("/api/workspace", { cache: "no-store" });
          const payload = await readApiJson<{ data?: Workspace }>(latest, "Workspace");
            if (latest.ok && payload.data) {
              const workspaceData = payload.data;
              const hiddenAiAgentIds = Array.isArray(workspaceData.hiddenAiAgentIds) ? workspaceData.hiddenAiAgentIds : [];
              const staff = withAiTeammates(workspaceData.staff || [], hiddenAiAgentIds);
              setWorkspace((current) => ({ ...current, ...workspaceData, hiddenAiAgentIds, staff, files: workspaceData.files || [], vaultEntries: workspaceData.vaultEntries || [], financeRecords: workspaceData.financeRecords || [], activity: workspaceData.activity || [] }));
            setToast("This approval was already resolved. The task list is up to date.");
            window.setTimeout(() => setToast(""), 3000);
            return false;
          }
        } catch { /* Keep the original response if the refresh is unavailable. */ }
      }
      if (decision === "apply") {
        const latestWorkspace = workspaceLiveRef.current;
        const latestTask = latestWorkspace.tasks.find((item) => item.id === taskId);
        if (latestTask) await persist({ ...latestWorkspace, tasks: latestWorkspace.tasks.map((item) => item.id !== taskId ? item : { ...item, status: "Blocked", aiRunState: "needs_review" as const, aiApprovals: (item.aiApprovals || []).map((entry) => entry.id === approvalId && entry.status === "applying" ? { ...entry, status: "pending" as const, startedAt: undefined } : entry) }) }, "Google Ads approval paused · needs review");
      }
      setError(message);
      return false;
    }
    finally { setSaving(false); }
  };
  const deleteTask = (id: string) => {
    const task = workspace.tasks.find((item) => item.id === id);
    if (!task) return;
    if (task.aiRunState === "running" || (task.aiApprovals || []).some((approval) => approval.status === "applying")) { setError("This AI task is running or applying a Google Ads change. Wait for it to finish before deleting it."); return; }
    const timer = workspace.activeTimer?.taskId === id ? workspace.activeTimer : null;
    const isScheduledAiTask = task.aiRunState === "scheduled" && isAiAssignedTask(task);
    const repeatNote = task.repeat && task.repeat !== "None" ? " This also cancels its future repeats." : "";
    if (!window.confirm(`${isScheduledAiTask ? "Delete scheduled AI task" : "Delete"} “${task.title}”? This removes the task${timer ? " and saves its running timer" : ""}.${repeatNote} This cannot be undone.`)) return;
    const entries = [...workspace.entries];
    if (timer) {
      const seconds = Math.max(1, Math.floor((Date.now() - new Date(timer.startedAt).getTime()) / 1000));
      entries.unshift({ id: uid(), taskId: timer.taskId, clientId: task.clientId || "", staffId: timer.staffId, startAt: timer.startedAt, endAt: new Date().toISOString(), seconds, note: "Timer saved when task was deleted", billable: true });
    }
    const now = new Date().toISOString();
    const activity: Activity = { id: uid(), title: isScheduledAiTask ? "Scheduled AI task deleted" : "Task deleted", detail: `${task.title} · ${workspace.clients.find((client) => client.id === task.clientId)?.name || "Internal"} · ${task.aiMode || task.service}${task.campaignName ? ` · ${task.campaignName}` : ""}`, icon: "🗑️", at: now, actor: sessionUser.name || "Workspace owner", actorAvatar: selfProfile?.avatar, staffId: sessionUser.id, clientId: task.clientId, taskId: task.id, service: task.aiMode || task.service, kind: "task", note: `${sessionUser.name || "Workspace owner"} deleted this ${isScheduledAiTask ? "scheduled AI task" : "task"}.${repeatNote}` };
    persist({ ...workspace, tasks: workspace.tasks.filter((item) => item.id !== id), entries, activeTimer: timer ? null : workspace.activeTimer, activity: [activity, ...(workspace.activity || [])].slice(0, 100) }, isScheduledAiTask ? "Scheduled AI task deleted" : "Task deleted");
  };
  const saveNote = async () => {
    const clientId = form.taskId ? form.clientId || workspace.tasks.find((task) => task.id === form.taskId)?.clientId || "" : form.clientId || selectedClient;
    if ((!clientId && !form.taskId) || !form.body?.trim()) return;
    const note: Note = { id: uid(), clientId, ...(form.taskId ? { taskId: form.taskId } : {}), body: form.body.trim(), createdAt: new Date().toISOString(), authorId: sessionUser.id, authorName: sessionUser.name || "Team member", authorAvatar: selfProfile?.avatar };
    const saved = await persist({ ...workspace, notes: [note, ...workspace.notes] }, form.taskId ? "Task work note saved" : "Client work note saved");
    if (saved) { setModal(""); setForm({}); }
  };
  const addManualTime = () => {
    if (!form.taskId || !Number(form.minutes)) return;
    const task = workspace.tasks.find((t) => t.id === form.taskId);
    const now = new Date();
    const entry: Entry = { id: uid(), taskId: form.taskId, clientId: task?.clientId || "", staffId: form.staffId || workspace.staff[0]?.id || "", startAt: new Date(now.getTime() - Number(form.minutes) * 60000).toISOString(), endAt: now.toISOString(), seconds: Number(form.minutes) * 60, note: form.note || "Manual time entry", billable: true };
    persist({ ...workspace, entries: [entry, ...workspace.entries] }, "Timesheet entry added"); setModal("");
  };
  const mutate = (label: string, fn: (x: Workspace) => Workspace) => persist(fn(workspace), label);
  const client = viewClient;

  const unlockVault = async () => {
    const passphrase = form.passphrase || "";
    setVaultError("");
    if (passphrase.length < 12) { setVaultError("Use at least 12 characters for your vault passphrase."); return; }
    try {
      if (!workspace.vault) {
        if (passphrase !== form.confirmPassphrase) { setVaultError("The passphrases do not match."); return; }
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const key = await deriveVaultKey(passphrase, salt);
        const encrypted = await encryptVault("F2B_CLIENT_VAULT_V1", key);
        const vault = { salt: toB64(salt), verifierIv: encrypted.iv, verifierCipher: encrypted.ciphertext };
        setVaultKey(key); setVaultRows([]); setModal(""); setForm({});
        await persist({ ...workspace, vault }, "Private vault created");
      } else {
        const key = await deriveVaultKey(passphrase, fromB64(workspace.vault.salt));
        const marker = await decryptVault(workspace.vault.verifierIv, workspace.vault.verifierCipher, key);
        if (marker !== "F2B_CLIENT_VAULT_V1") throw new Error("That passphrase did not unlock the vault.");
        const rows = await Promise.all(workspace.vaultEntries.map(async (row) => ({ id: row.id, clientId: row.clientId, ...JSON.parse(await decryptVault(row.iv, row.ciphertext, key)), createdAt: row.createdAt } as DecryptedVaultEntry)));
        setVaultKey(key); setVaultRows(rows); setModal(""); setForm({});
      }
    } catch (e) { setVaultError(e instanceof Error ? e.message : "Could not unlock the vault."); }
  };
  const saveVaultEntry = async () => {
    if (!vaultKey || !form.title?.trim() || !form.clientId) return;
    try {
      const payload = { title: form.title.trim(), kind: form.kind || "Website", username: form.username || "", secret: form.secret || "", url: form.url || "", host: form.host || "", port: form.port || "", protocol: form.protocol || "SFTP", path: form.path || "", notes: form.notes || "" };
      const encrypted = await encryptVault(JSON.stringify(payload), vaultKey);
      const row: VaultEntry = { id: uid(), clientId: form.clientId, ...encrypted, createdAt: new Date().toISOString() };
      setVaultRows([{ ...row, ...payload }, ...vaultRows]);
      await persist({ ...workspace, vaultEntries: [row, ...workspace.vaultEntries] }, "Login saved in encrypted vault");
      setModal(""); setForm({});
    } catch (e) { setVaultError(e instanceof Error ? e.message : "Could not save this login."); }
  };
  const uploadClientFile = async (clientId: string, file: File) => {
    const formData = new FormData(); formData.set("clientId", clientId); formData.set("file", file);
    const response = await fetch("/api/client-files", { method: "POST", body: formData });
    const result = await response.json() as { error?: string; file?: ClientFile };
    if (!response.ok) throw new Error(result.error || "Could not upload this file.");
    if (!result.file) throw new Error("The uploaded file could not be confirmed in the client workspace.");
    await persist({ ...workspace, files: [result.file, ...workspace.files] }, "Client file uploaded");
    return result.file;
  };
  const uploadTaskFile = async (taskId: string, file: File) => {
    const formData = new FormData(); formData.set("taskId", taskId); formData.set("file", file);
    const response = await fetch("/api/tasks/files", { method: "POST", body: formData });
    const result = await response.json() as { error?: string; attachment?: TaskAttachment };
    if (!response.ok) throw new Error(result.error || "Could not attach this task document.");
    if (!result.attachment) throw new Error("The uploaded document could not be confirmed on the task.");
    setWorkspace((current) => ({ ...current, tasks: current.tasks.map((task) => task.id === taskId ? { ...task, attachments: [...(task.attachments || []).filter((item) => item.id !== result.attachment!.id), result.attachment!] } : task) }));
    return result.attachment;
  };
  const deleteTaskFile = async (taskId: string, fileId: string) => {
    const response = await fetch(`/api/tasks/files?taskId=${encodeURIComponent(taskId)}&id=${encodeURIComponent(fileId)}`, { method: "DELETE" });
    const result = await response.json() as { error?: string };
    if (!response.ok) throw new Error(result.error || "Could not remove this task document.");
    const latest = workspaceLiveRef.current;
    const next = { ...latest, tasks: latest.tasks.map((task) => task.id === taskId ? { ...task, attachments: (task.attachments || []).filter((file) => file.id !== fileId) } : task) };
    workspaceLiveRef.current = next;
    setWorkspace(next);
    setToast("Task document removed"); window.setTimeout(() => setToast(""), 2500);
  };
  const deleteClientFile = async (fileId: string, taskId?: string) => {
    const endpoint = taskId ? `/api/tasks/files?taskId=${encodeURIComponent(taskId)}&id=${encodeURIComponent(fileId)}` : `/api/client-files?id=${encodeURIComponent(fileId)}`;
    const response = await fetch(endpoint, { method: "DELETE" });
    const result = await response.json() as { error?: string };
    if (!response.ok) throw new Error(result.error || "Could not remove this client file.");
    const latest = workspaceLiveRef.current;
    const next = taskId
      ? { ...latest, tasks: latest.tasks.map((task) => task.id === taskId ? { ...task, attachments: (task.attachments || []).filter((file) => file.id !== fileId) } : task) }
      : { ...latest, files: latest.files.filter((file) => file.id !== fileId) };
    workspaceLiveRef.current = next;
    setWorkspace(next);
    setToast("File removed"); window.setTimeout(() => setToast(""), 2500);
  };

  if (!ready) return <main className="loading-screen"><div className="spinner" /><span>Opening your private workspace…</span></main>;
  if (offlineChessUserId) return <main className="offline-chess-screen"><div className="offline-chess-banner"><b>Offline chess backup</b><span>Showing games saved on this device. Moves are stored locally and will sync when the connection returns.</span><button type="button" onClick={() => window.location.reload()} disabled={!navigator.onLine}>Reconnect and reopen workspace</button></div><Suspense fallback={<p role="status">Loading chess…</p>}><ChessView staff={[]} currentUserId={offlineChessUserId} canPlay={false} /></Suspense></main>;
  if (error && !workspace.ownerId) return <main className="sign-in-page"><div className="sign-in-card"><BrandLogo className="sign-in-logo" /><p className="eyebrow">WORKSPACE ACCESS</p><h1>We couldn’t load your workspace.</h1><p className="muted">{error}</p><button type="button" className="primary-button sign-in-button" onClick={() => window.location.reload()}>Try again</button><p className="tiny-note">If this keeps happening, wait a minute and try again, or contact your F2B Media admin. Staff need an invite before they can sign in.</p></div></main>;

  const assistantViewContent = <AssistantView workspace={viewWorkspace} allowedAiModes={previewMember ? (Array.isArray(previewMember.aiModeAccess) ? previewMember.aiModeAccess : aiModes.map((mode) => mode.name)) : allowedAiModes} onSavePrompt={(mode, prompt) => mutate("AI agent instructions saved", (current) => ({ ...current, aiPrompts: { ...(current.aiPrompts || {}), [mode]: prompt.slice(0, 4000) } }))} onOpenTasks={() => { setAiAssistantPopupOpen(false); setPage("Tasks"); }} onScheduleTask={async (draft) => {
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/assistant/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Could not schedule this AI task.");
      const loaded = await fetch("/api/workspace", { cache: "no-store" });
      const payload = await readApiJson<{ data?: Workspace; error?: string }>(loaded, "Workspace");
      if (!loaded.ok || !payload.data) throw new Error(payload.error || "The task was scheduled, but the workspace did not refresh.");
      const workspaceData = payload.data;
      const hiddenAiAgentIds = Array.isArray(workspaceData.hiddenAiAgentIds) ? workspaceData.hiddenAiAgentIds : [];
      setWorkspace({ ...emptyWorkspace(), ...workspaceData, hiddenAiAgentIds, staff: withAiTeammates(workspaceData.staff || [], hiddenAiAgentIds), files: workspaceData.files || [], vaultEntries: workspaceData.vaultEntries || [], activity: workspaceData.activity || [] });
      setToast("AI task scheduled"); window.setTimeout(() => setToast(""), 2200);
      return true;
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not schedule this AI task."); return false; }
    finally { setSaving(false); }
  }} onUploadReference={uploadClientFile} isAdmin={viewIsAdmin} onRecordAdsChange={async (event) => {
    const note: Note = { id: uid(), clientId: event.clientId, body: event.note, createdAt: event.changedAt };
    return persist({ ...workspace, notes: [note, ...workspace.notes] }, `Google Ads change recorded for ${event.clientName}`);
  }} />;

  return <div className={`app-shell ${darkMode ? "dark-mode" : ""} ${activeScopeId ? "client-scoped" : ""}`}>
    <aside className="sidebar">
      <div className="sidebar-brand"><BrandLogo className="sidebar-logo" /></div>
      {viewWorkspace.clients.length > 0 || activeScopeId ? <ClientScopePicker value={activeScopeId} clients={workspace.clients.filter((item) => (previewMember ? baseViewWorkspace.clients.some((allowed) => allowed.id === item.id) : true))} onChange={setClientScope} /> : null}
      <div className="nav-label">WORKSPACE</div>
      <nav aria-label="Workspace">{nav.filter((item) => item.key === "Settings" || item.key === "Integrations" ? false : (item.key === "Lead Factory" || item.key === "Clients") && activeScopeId ? false : item.key === "Chess" && activeScopeId && scopedClient && !/^agency$/i.test(scopedClient.name.trim()) ? false : item.key === "Marketing" ? availableMarketingPages.length > 0 : canOpenPage(item.key, viewAccess, viewIsAdmin, viewHasClientScope)).map((item) => <button key={item.key} className={`nav-item ${page === item.key || (item.key === "Marketing" && marketingPageActive) ? "active" : ""}`} aria-current={page === item.key || (item.key === "Marketing" && marketingPageActive) ? "page" : undefined} onClick={() => { if (item.key === "Marketing") { const next = availableMarketingPages.some((entry) => entry.key === marketingTab) ? marketingTab : availableMarketingPages[0]?.key; if (next) { setMarketingTab(next); setPage(next); } } else setPage(item.key); setSelectedClient(""); }}><span className="nav-icon">{item.key === "AI Assistant" ? <AiEyesIcon /> : item.key === "Lead Factory" ? <img className="nav-image-icon" src="/lead-factory-icon.png" alt="" /> : item.icon}</span>{item.key === "Integrations" ? "Launchpad" : item.key === "CRM" ? "Pipeline" : item.key === "CRM Automations" ? "Automations" : item.key}{item.key === "Tasks" && viewWorkspace.tasks.filter((t) => t.status !== "Done" && !t.aiDismissedAt).length > 0 && <span className="nav-count">{viewWorkspace.tasks.filter((t) => t.status !== "Done" && !t.aiDismissedAt).length}</span>}</button>)}</nav>
      <div className="sidebar-bottom">{viewIsAdmin && <button type="button" className={`nav-item sidebar-settings-link ${page === "Settings" || page === "Integrations" ? "active" : ""}`} aria-current={page === "Settings" || page === "Integrations" ? "page" : undefined} onClick={() => { setPage("Settings"); setSelectedClient(""); }}><span className="nav-icon">⚙️</span>Settings</button>}<div className="profile-row"><StaffProfileAvatar member={selfProfile} className="owner" fallbackName={sessionUser.name || "Workspace owner"} /><div><b>{selfProfile?.name || sessionUser.name || "Workspace owner"}</b><small>{previewMember ? `Previewing ${previewMember.name}` : isAdmin ? "Owner · Admin" : selfProfile?.role || "Team member"}</small></div></div></div>
    </aside>
    <main className="main-area">
      <header className="topbar"><div className="breadcrumbs"><span>F2B Media</span><span className="slash">/</span><b>{client && page === "Clients" ? client.name : page === "CRM" ? "Pipeline" : page === "CRM Automations" ? "Automations" : page === "Integrations" ? "Launchpad" : marketingPages.find((item) => item.key === page)?.label || page}</b>{previewMember && <span className="preview-mode-badge">Read-only preview · {previewMember.name}</span>}</div><div className="top-actions">{canOpenPage("AI Assistant", viewAccess, viewIsAdmin, viewHasClientScope) && <button type="button" className={`ai-assistant-quick-link${aiAssistantPopupOpen ? " active" : ""}`} onClick={() => setAiAssistantPopupOpen(true)} aria-label="Open AI Assistant pop-up" aria-haspopup="dialog" aria-expanded={aiAssistantPopupOpen}><AiEyesIcon /><span>AI Assistant</span></button>}<div className="save-state"><span className={`save-dot ${saving ? "busy" : ""}`} />{saving ? "Saving…" : "All changes saved"}</div><button className="install-app-button" onClick={installApp} aria-label="Install F2B Agency on this device">＋<span>Install app</span></button>{isWorkspaceOwner && <label className="staff-view-pick" title="See the app exactly as a staff member sees it (read-only)"><span>👤 View as</span><select aria-label="View as staff member" value={previewMemberId} onChange={(event) => startStaffPreview(event.target.value)}><option value="">Owner</option>{workspace.staff.filter((member) => !member.isBot).map((member) => <option key={member.id} value={member.id}>{member.name} · {member.role}</option>)}</select></label>}<button className="theme-toggle" onClick={toggleDarkMode} aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"} title={darkMode ? "Switch to light mode" : "Switch to dark mode"}>{darkMode ? "☀️" : "🌙"}<span>{darkMode ? "Light mode" : "Dark mode"}</span></button>{(viewAccess.clients || viewAccess.tasks || viewIsAdmin) && <button type="button" className="notes-quick-trigger" aria-label={`Open all work notes (${viewWorkspace.notes.length})`} title="All client and task work notes" onClick={() => openModal("notes")}>📝{viewWorkspace.notes.length > 0 && <span>{viewWorkspace.notes.length}</span>}</button>}{canViewActivity && <div className="activity-quick-wrap"><button type="button" className={"icon-button activity-quick-trigger" + (activityMenuOpen ? " active" : "")} aria-label="Open recent activity" aria-haspopup="dialog" aria-expanded={activityMenuOpen} title="Recent activity" onClick={() => setActivityMenuOpen((open) => !open)}>🕘</button>{activityMenuOpen && <section className="activity-quick-popover" aria-label="Recent activity"><div className="activity-quick-head"><div><b>Recent activity</b><small>Latest workspace updates</small></div><button type="button" className="text-button" onClick={() => { setActivityMenuOpen(false); setActivityTimeTab("Activity"); setPage("Activity"); setSelectedClient(""); }}>View all ↗</button></div><div className="activity-quick-list">{recentActivityPreview.length ? recentActivityPreview.map((item) => <article className="activity-quick-row" key={item.id}><span className="activity-quick-icon">{item.icon || "✦"}</span><div><b>{item.title}</b><small>{item.detail}</small><time>{item.actor} · {new Date(item.at).toLocaleString("en-IE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</time></div></article>) : <p className="activity-quick-empty">No recent activity to show.</p>}</div><button type="button" className="activity-quick-link" onClick={() => { setActivityMenuOpen(false); setActivityTimeTab("Activity"); setPage("Activity"); setSelectedClient(""); }}>Open full activity →</button></section>}</div>}<div className="profile-menu-wrap"><button className="profile-trigger" aria-haspopup="menu" aria-expanded={profileMenuOpen} aria-label="Open profile menu" onClick={() => setProfileMenuOpen((open) => !open)}><StaffProfileAvatar member={selfProfile} className="owner" fallbackName={sessionUser.name || "Workspace owner"} /></button>{profileMenuOpen && <div className="profile-menu" role="menu"><div className="profile-menu-user"><StaffProfileAvatar member={selfProfile} className="owner" fallbackName={sessionUser.name || "Workspace owner"} /><span><b>{selfProfile?.name || sessionUser.name || "Workspace owner"}</b><small>{sessionUser.email || selfProfile?.email || "Signed in"}</small></span></div>{selfProfile && !previewMember && <button role="menuitem" onClick={() => { editStaff(selfProfile); setProfileMenuOpen(false); }}>Edit profile</button>}{isWorkspaceOwner && <><div className="profile-menu-separator" /><label className="profile-menu-label" htmlFor="staff-preview-select">Preview workspace as</label><select id="staff-preview-select" value={previewMemberId} onChange={(event) => startStaffPreview(event.target.value)}><option value="">Owner view</option>{workspace.staff.filter((member) => !member.isBot).map((member) => <option key={member.id} value={member.id}>{member.name} · {member.role}</option>)}</select>{previewMember && <button role="menuitem" onClick={() => startStaffPreview("")}>Exit staff preview</button>}</>}</div>}</div></div></header>
      <div className="page-content" inert={Boolean(previewMember)}>
        {error && <div className="error-banner">{error}<button onClick={() => setError("")}>Dismiss</button></div>}
        {marketingPageActive && <nav className="marketing-subnav marketing-hub-tabs" role="tablist" aria-label="Marketing tools">{availableMarketingPages.map((subpage) => <button type="button" role="tab" key={subpage.key} aria-selected={page === subpage.key} className={page === subpage.key ? "active" : ""} onClick={() => { setMarketingTab(subpage.key); setPage(subpage.key); setSelectedClient(""); }}>{subpage.icon} {subpage.label}</button>)}</nav>}
        {pageAllowed && marketingFoundationPages[page] && <MarketingFoundationPage page={page} onNavigate={(target) => { setPage(target); setSelectedClient(""); }} />}
        {!pageAllowed && <div className="empty-state"><div className="empty-icon">🔒</div><h2>This section isn’t included in your access.</h2><p>Ask an owner or admin to update your team permissions.</p></div>}
        {page === "Overview" && pageAllowed && <Overview scopeClientId={activeScopeId} workspace={viewWorkspace} counts={viewCounts} onAddClient={() => openModal("client")} onAddTask={() => openModal("task")} onNavigate={setPage} onSelectClient={(id) => { setSelectedClient(id); setPage("Clients"); }} onAddFinance={(kind) => openModal("finance", { kind, date: localDateKey() })} onEditClientFee={viewIsAdmin ? editClient : undefined} onEditFinance={editFinanceRecord} onEditRecurring={editFinanceRecurring} onDeleteFinance={deleteFinanceRecord} onStopRecurring={deleteFinanceRecurring} showCrmSummary={viewIsAdmin} onSaveClient={viewIsAdmin ? (client) => void persist({ ...workspaceLiveRef.current, clients: workspaceLiveRef.current.clients.map((item) => item.id === client.id ? client : item) }, "Tax records saved") : undefined} />}
        {page === "Invoicing" && pageAllowed && <InvoicingView key={activeScopeId || "agency"} scopeClientId={activeScopeId} />}
        {page === "Conversations" && pageAllowed && <ConversationsView key={activeScopeId || "agency"} scopeClientId={activeScopeId} clients={workspace.clients.map((item) => ({ id: item.id, name: item.name }))} />}
        {page === "CRM Automations" && pageAllowed && <CrmAutomationsView clientId={activeScopeId || null} />}
        {page === "CRM" && pageAllowed && <CrmView scopeClientId={activeScopeId} onOpenClient={(clientId) => { setSelectedClient(clientId); setPage("Clients"); }} />}
        {page === "Activity" && pageAllowed && <><div className="activity-time-switch" role="tablist" aria-label="Activity and time views">{(viewAccess.overview || viewAccess.clientActivity || viewAccess.allActivity) && <button role="tab" aria-selected={activityTimeTab === "Activity"} className={activityTimeTab === "Activity" ? "active" : ""} onClick={() => setActivityTimeTab("Activity")}>🕘 Activity</button>}{viewAccess.timesheets && <button role="tab" aria-selected={activityTimeTab === "Timesheets"} className={activityTimeTab === "Timesheets" ? "active" : ""} onClick={() => setActivityTimeTab("Timesheets")}>⏱️ Timesheets</button>}</div>{activityTimeTab === "Activity" && (viewAccess.overview || viewAccess.clientActivity || viewAccess.allActivity) ? <ActivityView workspace={viewWorkspace} /> : viewAccess.timesheets ? <TimesheetView workspace={viewWorkspace} onAdd={() => openModal("time")} /> : <div className="empty-state"><h2>This section isn’t included in your access.</h2><p>Ask an owner or admin to update your permissions.</p></div>}</>}
        {page === "Clients" && pageAllowed && <ClientsView workspace={viewWorkspace} selectedClient={client} onPick={(id) => setSelectedClient(id)} onAdd={() => openModal("client")} onViewNotes={(clientId) => openModal("notes", { clientId })} onOpenReports={(reportId) => { setReportToOpenId(reportId || ""); setPage("Report Studio"); }} onOpenMarketing={(clientId, targetPage) => { setSelectedClient(clientId); setPage(targetPage); }} canViewReports={viewAccess.reports || viewIsAdmin} canOpenAds={canOpenPage("Google Ads", viewAccess, viewIsAdmin, viewHasClientScope)} canOpenSeo={canOpenPage("SEO", viewAccess, viewIsAdmin, viewHasClientScope)} canOpenSites={canOpenPage("Sites", viewAccess, viewIsAdmin, viewHasClientScope)} canRunMarketingAudit={viewIsAdmin} auditRuns={viewWorkspace.auditRuns || []} onSaveMarketingAudit={(run) => mutate("Full marketing audit saved", (current) => ({ ...current, auditRuns: [run, ...(current.auditRuns || []).filter((item) => item.id !== run.id)].slice(0, 100) }))} onCreateMarketingAuditTask={(clientId, service, title, notes) => openModal("task", { clientId, title, service, notes })} onEdit={editClient} onDelete={deleteClient} onUpload={async (clientId, file) => { await uploadClientFile(clientId, file); }} onDeleteFile={deleteClientFile} canManage={viewIsAdmin} canAddNotes={viewAccess.clients || viewIsAdmin} canAccessVault={viewAccess.vault} canManageVaultEntries={viewIsAdmin} vaultUnlocked={!!vaultKey} vaultRows={vaultRows} onUnlockVault={() => openModal("vault-access")} onLockVault={() => { setVaultKey(null); setVaultRows([]); setForm({}); }} onAddVaultEntry={(clientId) => openModal("vault-entry", { clientId })} />}
        {page === "Tasks" && pageAllowed && <TasksViewErrorBoundary><TasksView scopeClientId={activeScopeId} workspace={viewWorkspace} activeTimer={viewWorkspace.activeTimer} timerNow={timerNow} currentStaffId={selfProfile?.id || ""} liveTaskUpdatesUnavailable={aiTaskUpdatesUnavailable} onAdd={() => openModal("task")} onEdit={editTask} onStatus={updateTask} onReorderTasks={reorderTasks} onSavePendingReason={savePendingReason} onChangeTaskDate={updateTaskDueDate} onDelete={deleteTask} onChecklistToggle={toggleTaskChecklistItem} onUpdateChecklist={updateTaskChecklist} onScheduleAiTask={scheduleAiTask} onStartAiTaskNow={startAiTaskNow} onCancelAiTask={cancelAiTaskRun} onReviewAiTask={markAiTaskReviewed} onReviewStaffTask={reviewStaffTask} onReviewAllStaffTasks={reviewAllStaffTasks} onDeleteTaskFile={deleteTaskFile} onResolveAiApproval={resolveAiApproval} onApprovalFeedback={updateApprovalFeedback} onDuplicate={duplicateTask} onViewNotes={(taskId, clientId) => openModal("notes", { taskId, clientId })} onUploadTaskFile={uploadTaskFile} onOpenClient={(clientId) => { setSelectedClient(clientId); setPage("Clients"); }} onDismissAiTaskEmailNotice={dismissAiTaskEmailNotice} onDismissAiTask={dismissAiTask} onRestoreAiTask={restoreAiTask} canApproveAiChanges={viewIsAdmin || viewAccess.aiApprovals} canReverseAdsChanges={viewIsAdmin} canSeePipeline={viewAccess.tasks} canSeeAiTasks={viewAccess.aiTasks} canSeeAiCompletedTasks={viewAccess.aiCompletedTasks} canSubmitStaffReviews={viewAccess.tasks} canManageStaffReviews={viewIsAdmin} canManageCalendar={viewIsAdmin} googleCalendarStatus={googleCalendarStatus} onOpenCalendarSettings={() => { if (selfProfile) editStaff(selfProfile); }} onSaveGoogleAdsTaskSettings={saveGoogleAdsTaskSettings} onSetupGoogleAdsTasks={setupGoogleAdsTasks} onRunGoogleAdsTest={runGoogleAdsTestAudit} canManageGoogleAdsTasks={viewIsAdmin} recommendationFeedbackDrafts={recommendationFeedbackDrafts} setRecommendationFeedbackDrafts={setRecommendationFeedbackDrafts} startingRecommendationId={startingRecommendationId} isAdmin={isAdmin} previewMemberId={previewMemberId} saveRecommendationFeedback={saveRecommendationFeedback} refineRecommendation={refineRecommendation} rejectRecommendations={rejectRecommendations} startRecommendationFollowUp={startRecommendationFollowUp} /></TasksViewErrorBoundary>}
        {page === "SEO" && pageAllowed && <Suspense fallback={<div className="empty-state" role="status">Loading SEO tools…</div>}><SeoView active={page === "SEO"} selectedClientId={client?.id} clients={viewWorkspace.clients} agents={viewWorkspace.staff.filter((member) => member.isBot)} onOpenTaskList={() => setPage("Tasks")} canOpenSites={viewIsAdmin} canManageMappings={viewIsAdmin} auditRuns={viewWorkspace.auditRuns || []} canRunAudit={viewIsAdmin} onSaveAudit={async (run) => mutate("SEO audit saved", (current) => ({ ...current, auditRuns: [run, ...(current.auditRuns || []).filter((item) => item.id !== run.id)].slice(0, 100) }))} onCreateAuditTask={(clientId, title, notes) => openModal("task", { clientId, title, service: "SEO", notes })} onMapAnalytics={async (clientId, propertyId) => {
          if (!viewIsAdmin) return false;
          return mutate("GA4 property mapped", (current) => ({
            ...current,
            clients: current.clients.map((item) => item.id === clientId ? { ...item, googleAnalyticsAccountId: propertyId } : item),
          }));
        }} onMapBusinessProfile={async (clientId, accountId, locationId) => {
          if (!viewIsAdmin) return false;
          return mutate("Google Business Profile mapped", (current) => ({
            ...current,
            clients: current.clients.map((item) => item.id === clientId ? { ...item, googleBusinessProfileAccountId: accountId, googleBusinessProfileLocationId: locationId } : item),
          }));
        }} onMapSearchConsole={async (clientId, propertyId) => {
          if (!viewIsAdmin) return false;
          return mutate("Search Console property mapped", (current) => ({
            ...current,
            clients: current.clients.map((item) => item.id === clientId ? { ...item, googleSearchConsoleAccountId: propertyId } : item),
          }));
        }} onOpenSites={() => setPage("Sites")} onCreateTask={(clientId, title, notes, checklist) => openModal("task", { clientId, title, service: "SEO", notes, checklist })} /></Suspense>}
        {page === "Google Ads" && pageAllowed && <Suspense fallback={<div className="empty-state" role="status">Loading Google Ads…</div>}><GoogleAdsView active={page === "Google Ads"} selectedClientId={client?.id} clients={viewWorkspace.clients} agents={viewWorkspace.staff.filter((member) => member.isBot)} onOpenTaskList={() => setPage("Tasks")} onOpenSites={() => setPage("Sites")} canEditClients={viewIsAdmin} auditRuns={viewWorkspace.auditRuns || []} canRunAudit={viewIsAdmin} onSaveAudit={async (run) => mutate("Google Ads audit saved", (current) => ({ ...current, auditRuns: [run, ...(current.auditRuns || []).filter((item) => item.id !== run.id)].slice(0, 100) }))} onCreateAuditTask={(clientId, title, notes) => openModal("task", { clientId, title, service: "Google Ads", notes })} onEditClient={(selected) => { const original = workspace.clients.find((item) => item.id === selected.id); if (original) editClient(original); }} onMapAccount={async (clientId, accountId) => { if (!viewIsAdmin) return false; return mutate("Google Ads account mapped", (current) => ({ ...current, clients: current.clients.map((item) => item.id === clientId ? { ...item, googleAdsAccountId: accountId } : item) })); }} onCreateCampaignReport={(clientId, campaignId, campaignName, range, from, to) => { setSelectedClient(clientId); setReportContext({ clientId, campaignId, campaignName, range, from, to }); setPage("Report Studio"); }} onCreateTask={(clientId, campaign, rangeLabel) => {
          const detail = campaign as typeof campaign & { kind?: string; campaignId?: string; campaignName?: string; adGroupId?: string; adGroupName?: string; matchType?: string };
          const entityType = detail.kind || "campaign";
          const campaignName = detail.campaignName || campaign.name;
          openModal("task", { clientId, title: `Review Google Ads ${entityType.toLowerCase()}: ${campaign.name}`, service: "Google Ads", campaignId: detail.campaignId || campaign.id, campaignName, campaignContext: `${entityType}: ${campaign.name}${detail.campaignId ? ` · campaign ID ${detail.campaignId}` : ""}. Campaign: ${campaignName}${detail.adGroupName ? ` · Ad group: ${detail.adGroupName}${detail.adGroupId ? ` (${detail.adGroupId})` : ""}` : ""}${detail.matchType ? ` · Match type: ${detail.matchType}` : ""}. Reporting period ${rangeLabel}: spend ${campaign.spend.toFixed(2)}, ${campaign.clicks} clicks, ${campaign.conversions} reported conversions, cost per conversion ${campaign.costPerConversion == null ? "not available" : campaign.costPerConversion.toFixed(2)}. Use live account data; recommendations are proposals until approved and verified.` });
        }} /></Suspense>}
        {page === "Meta Ads" && pageAllowed && <Suspense fallback={<div className="empty-state" role="status">Loading Meta Ads…</div>}><MetaAdsView active={page === "Meta Ads"} selectedClientId={client?.id} clients={viewWorkspace.clients} canEditClients={viewIsAdmin} auditRuns={viewWorkspace.auditRuns || []} canRunAudit={viewIsAdmin} onSaveAudit={async (run) => mutate("Meta Ads audit saved", (current) => ({ ...current, auditRuns: [run, ...(current.auditRuns || []).filter((item) => item.id !== run.id)].slice(0, 100) }))} onCreateAuditTask={(clientId, title, notes) => openModal("task", { clientId, title, service: "Meta Ads", notes })} onEditClient={(selected) => { const original = workspace.clients.find((item) => item.id === selected.id); if (original) editClient(original); }} onMapAccount={async (clientId, accountId) => { if (!viewIsAdmin) return false; return mutate("Meta Ads account mapped", (current) => ({ ...current, clients: current.clients.map((item) => item.id === clientId ? { ...item, metaAdsAccountId: accountId } : item) })); }} onCreateTask={(clientId, item, rangeLabel) => openModal("task", { clientId, title: `Review Meta Ads ${item.kind.toLowerCase()}: ${item.name}`, service: "Meta Ads", campaignId: item.campaignId, campaignName: item.campaignName, campaignContext: `${item.kind}: ${item.name}${item.id ? ` · ID ${item.id}` : ""}. Campaign: ${item.campaignName || "not supplied"}. Reporting period ${rangeLabel}: spend ${item.spend.toFixed(2)}, ${item.clicks} clicks, ${item.leads} reported leads. This task is a proposal; no account changes are made from this report.` })} /></Suspense>}

        {page === "Chess" && pageAllowed && <Suspense fallback={<div className="empty-state" role="status">Loading chess…</div>}><ChessView staff={workspace.staff.filter((member) => !member.isBot)} currentUserId={selfProfile?.id || sessionUser.id} canPlay={!previewMember} openInviteId={chessInviteOpenId} onInviteOpened={() => setChessInviteOpenId(null)} /></Suspense>}
        {canOpenPage("AI Assistant", viewAccess, viewIsAdmin, viewHasClientScope) && (aiAssistantPopupOpen ? <div className="assistant-popup-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setAiAssistantPopupOpen(false); }}><section className="assistant-popup-dialog" role="dialog" aria-modal="true" aria-label="AI Assistant"><div className="assistant-popup-toolbar"><span><AiEyesIcon /> AI Assistant</span><button type="button" className="assistant-popup-close" aria-label="Close AI Assistant pop-up" onClick={() => setAiAssistantPopupOpen(false)}>×</button></div><div className="assistant-popup-scroll">{assistantViewContent}</div></section></div> : <div hidden={page !== "AI Assistant"}>{assistantViewContent}</div>)}        {(viewAccess.reports || viewIsAdmin) && <div hidden={page !== "Report Studio"}><ReportsView templates={viewWorkspace.reportTemplates || []} clients={viewWorkspace.clients} reports={viewWorkspace.generatedReports || []} selectedClientId={client?.id} selectedReportId={reportToOpenId} reportContext={reportContext} onReportContextApplied={() => setReportContext(null)} onReportOpened={() => setReportToOpenId("")} onSave={(templates) => mutate("Report templates saved", (current) => ({ ...current, reportTemplates: templates }))} onSaveReport={(report) => mutate("Client report saved", (current) => ({ ...current, generatedReports: upsertClientReport(current.generatedReports || [], { ...report, text: report.text.slice(0, 20000) }) }))} /></div>}
        {viewIsAdmin && (page === "Settings" || page === "Integrations") && <div className="settings-subtabs" role="tablist" aria-label="Settings sections"><button type="button" role="tab" aria-selected={page === "Settings" && settingsTab === "business"} className={page === "Settings" && settingsTab === "business" ? "active" : ""} onClick={() => { setSettingsTab("business"); setPage("Settings"); }}>🏢 Business settings</button><button type="button" role="tab" aria-selected={page === "Settings" && settingsTab === "apis"} className={page === "Settings" && settingsTab === "apis" ? "active" : ""} onClick={() => { setSettingsTab("apis"); setPage("Settings"); }}>APIs</button><button type="button" role="tab" aria-selected={page === "Settings" && settingsTab === "dns"} className={page === "Settings" && settingsTab === "dns" ? "active" : ""} onClick={() => { setSettingsTab("dns"); setPage("Settings"); }}>🌐 Domains &amp; DNS</button><button type="button" role="tab" aria-selected={page === "Integrations"} className={page === "Integrations" ? "active" : ""} onClick={() => setPage("Integrations")}>🚀 Launchpad</button></div>}
        {viewIsAdmin && (page === "Integrations" || visitedPages.has("Integrations")) && <div hidden={page !== "Integrations"}><Suspense fallback={<div className="empty-state" role="status">Loading integrations…</div>}><IntegrationsView onNavigate={setPage} /></Suspense></div>}
        {viewIsAdmin && (page === "Settings" || visitedPages.has("Settings")) && <div hidden={page !== "Settings"}><Suspense fallback={<div className="empty-state" role="status">Loading settings…</div>}>{settingsTab === "dns" ? <DomainsDnsView clientHosts={scopedClient ? [scopedClient.wordpressSiteUrl, (scopedClient as { website?: string }).website].map((value) => { try { return new URL(/^https?:\/\//i.test(String(value || "")) ? String(value) : `https://${value}`).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; } }).filter(Boolean) : undefined} /> : settingsTab === "apis" ? <><SettingsView /><CustomApiKeysPanel /></> : <>{scopedClient && <div className="scope-note" role="note"><span>Business settings for <b>{scopedClient.name}</b>: its own brand, currency and tax country. {scopedClient.branding || scopedClient.currency || scopedClient.tax ? "Custom settings are on for this client." : "It currently follows the agency settings; saving here gives it its own."}</span>{(scopedClient.branding || scopedClient.currency || scopedClient.tax) && <button type="button" className="secondary-button" onClick={() => { const { branding: _b, currency: _c, tax: _t, ...rest } = scopedClient; void persist({ ...workspaceLiveRef.current, clients: workspaceLiveRef.current.clients.map((item) => item.id === scopedClient.id ? rest : item) }, "Now using the agency settings"); }}>Use agency settings</button>}</div>}<BusinessSettings key={scopedClient?.id || "agency"} value={scopedClient ? { currency: scopedClient.currency || workspace.settings?.currency, branding: scopedClient.branding || (scopedBranding ? { ...workspace.settings?.branding, ...scopedBranding } : workspace.settings?.branding), tax: scopedClient.tax || workspace.settings?.tax } : { currency: workspace.settings?.currency, branding: workspace.settings?.branding, tax: workspace.settings?.tax }} onSave={async (next) => { if (scopedClient) { if (next.currency) setDisplayCurrency(next.currency); await persist({ ...workspaceLiveRef.current, clients: workspaceLiveRef.current.clients.map((item) => item.id === scopedClient.id ? { ...item, branding: next.branding, currency: next.currency || item.currency, tax: next.tax } : item) }, `${scopedClient.name} settings saved`); return; } if (next.currency) setDisplayCurrency(next.currency); await persist({ ...workspaceLiveRef.current, settings: { ...workspaceLiveRef.current.settings, currency: next.currency || workspaceLiveRef.current.settings.currency, branding: next.branding, tax: next.tax } }, "Business settings saved"); }} /><BookkeepingConnections key={`books-${scopedClient?.id || "agency"}`} scopeName={scopedClient?.name || "the agency"} existingIds={scopedClient ? (scopedClient.taxBooks?.entries || []).map((entry) => entry.id) : (workspace.financeRecords || []).map((record) => record.id)} onImport={async (entries) => { if (scopedClient) { await persist({ ...workspaceLiveRef.current, clients: workspaceLiveRef.current.clients.map((item) => item.id === scopedClient.id ? { ...item, taxBooks: { ...(item.taxBooks || { entries: [] }), entries: [...entries, ...(item.taxBooks?.entries || []).filter((old) => !entries.some((entry) => entry.id === old.id))] } } : item) }, `${entries.length} bank transactions imported`); return; } await persist({ ...workspaceLiveRef.current, financeRecords: [...entries.map((entry) => ({ ...entry, clientId: "" })), ...(workspaceLiveRef.current.financeRecords || []).filter((old) => !entries.some((entry) => entry.id === old.id))] }, `${entries.length} bank transactions imported`); }} /></>}</Suspense></div>}
        {(viewAccess.reports || viewIsAdmin) && <div hidden={page !== "Proposal Studio"}><ProposalStudio workspace={viewWorkspace} onSaveFormula={(formula) => mutate("Design formula saved", (current) => ({ ...current, studioSettings: { ...(current.studioSettings || {}), designFormula: formula } }))} /></div>}
        {viewIsAdmin && page === "Sites" && <div className="marketing-subnav" role="tablist" aria-label="Websites tools">{(["Website", "Landing Pages", "Forms", "Surveys"] as const).map((tab) => <button type="button" role="tab" aria-selected={sitesBuilderTab === tab} className={sitesBuilderTab === tab ? "active" : ""} key={tab} onClick={() => setSitesBuilderTab(tab)}>{tab === "Website" ? "🌐 " : tab === "Landing Pages" ? "🚀 " : tab === "Forms" ? "📝 " : "📋 "}{tab}</button>)}</div>}
        {viewIsAdmin && (page === "Sites" || visitedPages.has("Sites")) && (sitesBuilderTab === "Website" || sitesBuilderTab === "Landing Pages") && <div hidden={page !== "Sites" || !["Website", "Landing Pages"].includes(sitesBuilderTab)}><Suspense fallback={<div className="empty-state" role="status">Loading Sites…</div>}><SitesView active={page === "Sites" && (sitesBuilderTab === "Website" || sitesBuilderTab === "Landing Pages")} initialSection={sitesBuilderTab === "Landing Pages" ? "landing" : "website"} hideSectionTabs clients={viewWorkspace.clients} vaultEntries={vaultRows} vaultUnlocked={!!vaultKey} pageMetadata={viewWorkspace.sitePageMetadata || []} landingDomainChecks={viewWorkspace.siteLandingDomainChecks || []} onSaveLandingDomainCheck={(check) => mutate("Landing domain check saved", (current) => ({ ...current, siteLandingDomainChecks: [check, ...(current.siteLandingDomainChecks || []).filter((item) => item.clientId !== check.clientId)] }))} onSavePageMetadata={(metadata) => mutate("Site page classification saved", (current) => ({ ...current, sitePageMetadata: [metadata, ...(current.sitePageMetadata || []).filter((item) => item.clientId !== metadata.clientId || item.pageId !== metadata.pageId)] }))} onUnlockVault={() => openModal("vault-access")} onCreateTask={(clientId, title, notes, checklist, service, sitePagePlan) => openModal("task", { clientId, title, service: service || "Sites", notes, checklist, ...(sitePagePlan ? { campaignId: sitePagePlan.campaignId || "", campaignName: sitePagePlan.campaignName || "", sitePagePlan: JSON.stringify(sitePagePlan) } : {}) })} /></Suspense></div>}
        {page === "Media Library" && pageAllowed && <MediaLibraryView scopeClientId={activeScopeId} clients={viewWorkspace.clients} active />}
        {viewIsAdmin && <div hidden={page !== "Automations"}><MarketingStudioView scopeClientId={activeScopeId} key="automation" kind="automation" clients={viewWorkspace.clients} staff={viewWorkspace.staff} active={page === "Automations"} /></div>}
        {viewIsAdmin && page === "Sites" && (sitesBuilderTab === "Forms" || sitesBuilderTab === "Surveys") && <MarketingStudioView scopeClientId={activeScopeId} key={sitesBuilderTab} kind={sitesBuilderTab === "Forms" ? "form" : "survey"} clients={viewWorkspace.clients} staff={viewWorkspace.staff} active={page === "Sites"} />}
        {viewIsAdmin && !activeScopeId && <div hidden={page !== "Lead Factory"}><LeadFactoryWorkspace profiles={viewWorkspace.leadProfiles || []} lists={viewWorkspace.leadLists || []} onSave={(profiles, lists) => mutate("Lead Factory updated", (current) => ({ ...current, leadProfiles: profiles, leadLists: lists }))} /></div>}
        {page === "Team" && pageAllowed && <TeamView workspace={viewWorkspace} onAdd={() => openModal("staff")} onAddAi={() => openModal("staff", { isAiProfile: "true", name: "", aiMode: "Google Ads", agentPrompt: "", limitClientAccess: "false", clientAccessIds: "[]" })} onEdit={editStaff} onRemoveAi={removeAiTeammate} onRemoveStaff={removeStaffMember} currentUserId={selfProfile?.id || sessionUser.id} onRestoreAi={restoreAiTeammate} />}
      </div>
    </main>
    {chessInvitePopup && <section className="chess-invite-popup" role="alertdialog" aria-label="Chess challenge invitation" aria-live="assertive"><span className="chess-invite-popup-icon" aria-hidden="true">♟</span><div><b>Chess challenge</b><p>{chessInvitePopup.challenger} invited you to play.</p><div className="chess-invite-popup-actions"><button type="button" onClick={() => { setChessInviteOpenId(chessInvitePopup.id); setChessInvitePopup(null); setSelectedClient(""); setPage("Chess"); }}>View and accept</button><button type="button" className="secondary-button" onClick={() => setChessInvitePopup(null)}>Dismiss</button></div></div><button type="button" className="chess-invite-popup-close" aria-label="Dismiss chess invitation" onClick={() => setChessInvitePopup(null)}>×</button></section>}
    {globalErrors.length > 0 && <section className="global-error-stack" aria-label="App service notices" aria-live="polite">{globalErrors.map((item) => <article className="global-error-card" role="status" key={item.id}><span className="global-error-icon" aria-hidden="true">!</span><div className="global-error-copy"><b>{item.requiresSignIn ? "Sign-in needed" : "Temporary service issue"}</b><p>{item.message}</p>{item.requiresSignIn && <button type="button" className="global-error-signin" onClick={() => window.location.reload()}>Sign in again</button>}</div><button type="button" aria-label={`Dismiss ${item.source} notice`} onClick={() => setGlobalErrors((current) => current.filter((entry) => entry.id !== item.id))}>×</button></article>)}<button type="button" className="global-error-dismiss-all" onClick={() => setGlobalErrors([])}>Dismiss</button></section>}
    {toast && <div className="toast">✓ &nbsp;{toast}</div>}
    {showInstallHelp && <div className="install-help-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowInstallHelp(false); }}><section className="install-help" role="dialog" aria-modal="true" aria-labelledby="install-help-title"><button className="icon-button install-help-close" onClick={() => setShowInstallHelp(false)} aria-label="Close">×</button><p className="eyebrow">F2B MEDIA · MOBILE APP</p><h2 id="install-help-title">Add F2B Agency to your phone</h2><p>It opens like an app from your home screen and signs in to the same private workspace.</p><div className="install-steps"><b>iPhone or iPad</b><span>Open this page in Safari, tap <strong>Share</strong>, then choose <strong>Add to Home Screen</strong>.</span><b>Android</b><span>Open this page in Chrome, tap the browser menu, then choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.</span></div><button className="primary-button" onClick={() => setShowInstallHelp(false)}>Got it</button></section></div>}
    {modal && <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) { setModal(""); setForm({}); setVaultError(""); } }}><section className="modal"><div className="modal-head"><div><p className="eyebrow">F2B MEDIA · AGENCY OS</p><h2>{({ client: form.clientId ? "Edit client" : "Add a client", staff: form.isAiProfile ? (form.staffId ? "Edit AI agent" : "Create AI agent") : form.staffId ? "Edit team profile" : "Add a team profile", task: form.taskId ? "Edit task" : "Create a task", project: "Create a project", note: "Add work note", notes: form.taskId ? "Task work notes · " + (workspace.tasks.find((task) => task.id === form.taskId)?.title || "Task") : form.clientId ? "Client work notes · " + (workspace.clients.find((client) => client.id === form.clientId)?.name || "Client") : "All work notes", time: "Log time", finance: form.financeRecordId ? `Edit ${form.kind === "Expense" ? "expense" : "income"}` : form.kind === "Expense" ? "Add an expense" : "Add income", "vault-access": workspace.vault ? "Unlock your client vault" : "Create your client vault", "vault-entry": "Save a client login" } as Record<string, string>)[modal]}</h2></div><button className="icon-button" onClick={() => { setModal(""); setForm({}); setVaultError(""); }}>×</button></div>
      {modal === "client" && <><div className="form-grid"><Field label="Client name" name="name" value={form.name} set={setForm} placeholder="e.g. Northshore Studio" required /><Field label="Company" name="company" value={form.company} set={setForm} placeholder="Legal or trading name" /><Field label="Main contact" name="contact" value={form.contact} set={setForm} placeholder="Contact name" /><Field label="Email" name="email" value={form.email} set={setForm} placeholder="name@company.ie" type="email" /><Field label="WhatsApp / phone" name="phone" value={form.phone} set={setForm} placeholder="+353…" type="tel" /><div className="client-logo-control full-field"><label className="field"><span>Client logo (optional)</span><input type="file" accept="image/*" onChange={async (event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (!file) return; try { const logo = await resizeClientLogo(file); setForm((current) => ({ ...current, logo, logoError: "" })); } catch (error) { setForm((current) => ({ ...current, logoError: error instanceof Error ? error.message : "Could not use that image." })); } }} /></label><p className="form-hint">PNG, JPG or WebP. The image is resized before saving.</p>{form.logo && <div className="client-logo-preview"><img src={form.logo} alt="Client logo preview" /><button type="button" className="text-button" onClick={() => setForm((current) => ({ ...current, logo: "" }))}>Remove logo</button></div>}{form.logoError && <p className="form-error">{form.logoError}</p>}</div></div><div className="service-form"><h3>Services & monthly values</h3><label className="field billing-day-field"><span>Monthly billing day</span><input type="number" min="1" max="31" step="1" inputMode="numeric" placeholder="e.g. 15" value={form.billingDay || ""} onChange={(event) => setForm((current) => ({ ...current, billingDay: event.target.value }))} /><small>Day of each month the client fee is due. Leave blank if not set.</small></label><div className="service-form-head"><span>Service</span><span>Campaign name</span><span>Fee / month</span><span>Ad spend</span><span></span></div>{clientServiceRows.map((row, index) => { const isAds = row.name === "Google Ads" || row.name === "Meta Ads"; return <Fragment key={row.id}><div className="service-form-row"><span><AiIcon v={serviceIcons[row.name] || "🧩"} /> {row.name}</span>{isAds ? <input aria-label={row.name + " campaign name " + (index + 1)} type="text" placeholder="Campaign name" value={row.campaignName} onChange={(event) => setClientServiceRows((current) => current.map((item) => item.id === row.id ? { ...item, campaignName: event.target.value } : item))} /> : <span className="service-form-muted">—</span>}<input aria-label={row.name + " fee per month " + (index + 1)} type="number" min="0" placeholder="€0" value={row.fee} onChange={(event) => setClientServiceRows((current) => current.map((item) => item.id === row.id ? { ...item, fee: event.target.value } : item))} />{isAds ? <input aria-label={row.name + " campaign ad spend " + (index + 1)} type="number" min="0" placeholder="€0" value={row.mediaSpend} onChange={(event) => setClientServiceRows((current) => current.map((item) => item.id === row.id ? { ...item, mediaSpend: event.target.value } : item))} /> : <span className="service-form-muted">—</span>}<button type="button" className="service-row-remove" aria-label={"Remove " + row.name + ((row.name === "Google Ads" || row.name === "Meta Ads") ? " campaign" : " service")} onClick={() => setClientServiceRows((current) => current.filter((item) => item.id !== row.id))}>×</button></div>{(isAds || row.name === "SEO") && <div className="campaign-landing-connection"><label><span>{row.name === "SEO" ? "Website URL" : "Landing page URL for this campaign"}</span><input type="url" placeholder={row.name === "SEO" ? "https://example.com" : "https://example.com/campaign-page"} value={row.landingPageUrl || ""} onChange={(event) => setClientServiceRows((current) => current.map((item) => item.id === row.id ? { ...item, landingPageUrl: event.target.value } : item))} /></label><label><span>Page platform</span><select value={row.landingPagePlatform || "Other"} onChange={(event) => setClientServiceRows((current) => current.map((item) => item.id === row.id ? { ...item, landingPagePlatform: event.target.value as ClientServiceFormRow["landingPagePlatform"] } : item))}><option>Other</option><option>WordPress</option><option>GoHighLevel</option></select></label><small>Separate read-only page source. Published pages are read without CMS credentials.</small></div>}</Fragment>; })}<div className="service-add-campaigns"><label className="field"><span>Add a service</span><select value={serviceToAdd} onChange={(event) => setServiceToAdd(event.target.value)}><option value="">Choose a service…</option>{serviceTypes.filter((service) => service === "Google Ads" || service === "Meta Ads" || !clientServiceRows.some((row) => row.name === service)).map((service) => <option key={service} value={service}>{serviceIcons[service] || "🧩"} {service}</option>)}</select></label><button type="button" className="secondary-button" disabled={!serviceToAdd} onClick={() => { const service = serviceToAdd; setClientServiceRows((current) => [...current, { id: `${service === "Google Ads" || service === "Meta Ads" ? "campaign-" : "service-"}${crypto.randomUUID()}`, name: service, campaignName: "", fee: "", mediaSpend: "" }]); setServiceToAdd(""); }}>＋ Add service</button><button type="button" className="secondary-button" onClick={() => setClientServiceRows((current) => [...current, { id: "campaign-" + crypto.randomUUID(), name: "Google Ads", campaignName: "", fee: "", mediaSpend: "" }])}>＋ Add Google Ads campaign</button><button type="button" className="secondary-button" onClick={() => setClientServiceRows((current) => [...current, { id: "campaign-" + crypto.randomUUID(), name: "Meta Ads", campaignName: "", fee: "", mediaSpend: "" }])}>＋ Add Meta Ads campaign</button></div></div><p className="form-hint">Ad spend is kept separate from agency revenue. Add an internal hourly cost to team profiles for margin estimates.</p><section className="service-form connected-client-data"><h3>Connected accounts & website</h3><Field label="Client monthly media budget (€)" name="monthlyBudget" value={form.monthlyBudget} set={setForm} type="number" placeholder="0" /><Field label="Windsor Google Ads account ID" name="googleAdsAccountId" value={form.googleAdsAccountId} set={setForm} placeholder="e.g. 123-456-7890" /><Field label="Windsor Meta Ads account ID" name="metaAdsAccountId" value={form.metaAdsAccountId} set={setForm} placeholder="e.g. 123456789 or act_123456789" /><Field label="Windsor Search Console site ID" name="googleSearchConsoleAccountId" value={form.googleSearchConsoleAccountId} set={setForm} placeholder="e.g. sc-domain:example.com or https://example.com/" /><Field label="Windsor Google Analytics 4 account ID" name="googleAnalyticsAccountId" value={form.googleAnalyticsAccountId} set={setForm} placeholder="e.g. 527514061" /><Field label="WordPress site URL" name="wordpressSiteUrl" value={form.wordpressSiteUrl} set={setForm} placeholder="https://example.com" /><label className="field full-field"><span>Business services for SEO planning</span><textarea name="seoServices" rows={3} value={form.seoServices || ""} onChange={(event) => setForm((current) => ({ ...current, seoServices: event.target.value }))} placeholder="One per line, e.g. boiler servicing, heat pump installation" /><small>Enter the clients actual services, not the agency services billed above.</small></label><label className="field full-field"><span>Service areas or locations for SEO planning</span><textarea name="seoLocations" rows={3} value={form.seoLocations || ""} onChange={(event) => setForm((current) => ({ ...current, seoLocations: event.target.value }))} placeholder="One per line, e.g. Galway, Oranmore, Athenry" /><small>Only add places the client genuinely serves.</small></label></section><ModalActions onCancel={() => setModal("")} onSave={saveClient} label={form.clientId ? "Save client changes" : "Add client"} />
      </>}
      {modal === "staff" && (form.isAiProfile === "true" ? <><div className="form-grid"><Field label="AI agent name" name="name" value={form.name} set={setForm} placeholder="Google Ads specialist" required /><label className="field"><span>Model via OpenRouter</span><select value={form.aiModel || "x-ai/grok-4.7"} onChange={(event) => setForm((current) => ({ ...current, aiModel: event.target.value }))}><option value="x-ai/grok-4.7">Grok 4.7</option><option value="anthropic/claude-sonnet-latest">Claude Sonnet (latest)</option></select></label><section className="permission-editor"><h3>Full agent access</h3><p>Every AI agent can be assigned any task mode and any client. Each task uses only integrations connected for its selected client.</p><small>Google Ads changes still wait for your approval. AI tasks can create WordPress drafts. Editing existing pages, publishing, and changing SEO plugin fields are not connected to the AI task runner yet.</small></section><label className="field full-field"><span>Unique agent instructions</span><textarea rows={4} maxLength={4000} value={form.agentPrompt || ""} onChange={(event) => setForm((current) => ({ ...current, agentPrompt: event.target.value }))} placeholder="How should this agent approach work? Add its specific role, priorities and reporting style." /></label><div className="team-photo-upload full-field"><label className="field"><span>Profile picture or logo</span><input type="file" accept="image/png,image/jpeg,image/webp" onChange={async (event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (!file) return; try { const avatarImage = await resizeClientLogo(file); setForm((current) => ({ ...current, avatarImage, avatarUrl: "", avatarError: "" })); } catch (error) { setForm((current) => ({ ...current, avatarError: error instanceof Error ? error.message : "Could not use that image." })); } }} /></label><p className="form-hint">Choose a PNG, JPG or WebP image. It is resized before saving.</p>{(form.avatarImage || form.avatarUrl) && <div className="client-logo-preview"><img src={form.avatarImage || form.avatarUrl} alt="AI teammate profile preview" /><button type="button" className="text-button" onClick={() => setForm((current) => ({ ...current, avatarImage: "", avatarUrl: "" }))}>Remove picture</button></div>}{form.avatarError && <p className="form-error">{form.avatarError}</p>}</div></div><p className="form-hint">This only changes the name and picture shown in the workspace. The AI task runner stays connected.</p><ModalActions onCancel={() => { setModal(""); setForm({}); }} onSave={saveStaff} label="Save agent" /></> : <><div className="form-grid"><Field label="Full name" name="name" value={form.name} set={setForm} placeholder="Team member" required /><Field label="Work email" name="email" value={form.email} set={setForm} placeholder="person@f2bmedia.com" type="email" required /><label className="field"><span>Role</span><select value={form.role || "Staff"} onChange={(e) => setForm({ ...form, role: e.target.value })}>{["Admin", "Account Manager", "Specialist", "Staff", "Viewer"].map((x) => <option key={x}>{x}</option>)}</select></label><Field label="Internal cost / hour (€)" name="costRate" value={form.costRate} set={setForm} type="number" placeholder="0" /><div className="team-photo-upload full-field"><label className="field"><span>Profile photo or logo (optional)</span><input type="file" accept="image/png,image/jpeg,image/webp" onChange={async (event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (!file) return; try { const avatarImage = await resizeClientLogo(file); setForm((current) => ({ ...current, avatarImage, avatarUrl: "", avatarError: "" })); } catch (error) { setForm((current) => ({ ...current, avatarError: error instanceof Error ? error.message : "Could not use that image." })); } }} /></label><p className="form-hint">Choose a PNG, JPG or WebP image. It is resized before saving.</p>{(form.avatarImage || form.avatarUrl) && <div className="client-logo-preview"><img src={form.avatarImage || form.avatarUrl} alt="Team profile preview" /><button type="button" className="text-button" onClick={() => setForm((current) => ({ ...current, avatarImage: "", avatarUrl: "" }))}>Remove photo</button></div>}{form.avatarError && <p className="form-error">{form.avatarError}</p>}</div></div><section className="permission-editor"><h3>Permissions &amp; access</h3><p>Set what this teammate can open here. Overview is private to you; changes apply when you save this profile.</p><div className="permission-owner-only"><span>🔒</span><div><b>Overview · Owner only</b><small>No teammate role can grant access to the agency overview.</small></div><strong>PRIVATE</strong></div>{permissionGroups.map((group) => <fieldset className="permission-group" key={group.title}><legend>{group.title}</legend><div className="permission-checks">{group.keys.map((key) => { const roleDefaults = getTeamPermissions(form.role || "Staff"); const checked = form[`permission_${key}`] === undefined ? roleDefaults[key] : form[`permission_${key}`] === "true"; const dependentKey = key === "aiApprovals" || key === "aiCompletedTasks" ? "aiTasks" : key === "allTasks" ? "tasks" : key === "allTimesheets" ? "timesheets" : null; const dependentAllowed = dependentKey ? (form[`permission_${dependentKey}`] === undefined ? roleDefaults[dependentKey] : form[`permission_${dependentKey}`] === "true") : true; return <label key={key}><input type="checkbox" checked={checked && dependentAllowed} disabled={!dependentAllowed} onChange={(event) => setForm({ ...form, [`permission_${key}`]: String(event.target.checked) })} /><span>{permissionLabels[key]}</span></label>; })}</div></fieldset>)}</section><section className="permission-editor"><h3>Client access</h3><p>Choose which client workrooms this account can access. Activity, chats and related records are restricted to this selection.</p><label className="permission-check"><input type="checkbox" checked={form.limitClientAccess === "true"} onChange={(event) => setForm({ ...form, limitClientAccess: String(event.target.checked) })} /><span>Limit access to selected clients</span></label>{form.limitClientAccess === "true" && <div className="permission-checks">{workspace.clients.map((client) => <label key={client.id}><input type="checkbox" checked={teamClientIds.includes(client.id)} onChange={(event) => setForm({ ...form, clientAccessIds: JSON.stringify(event.target.checked ? [...teamClientIds, client.id] : teamClientIds.filter((id) => id !== client.id)) })} /><span>{client.logo ? <img className="scope-client-logo" src={client.logo} alt="" /> : "👥 "}{client.name}</span></label>)}</div>}</section>{teamVaultPermitted && <section className="permission-editor"><h3>Client login access</h3><p>Select the specific encrypted vault entries they can open for their permitted clients.</p>{availableTeamVaultRows.length ? <div className="permission-checks">{availableTeamVaultRows.map((entry) => <label key={entry.id}><input type="checkbox" checked={teamVaultEntryIds.includes(entry.id)} onChange={(event) => setForm({ ...form, vaultAccessEntryIds: JSON.stringify(event.target.checked ? [...teamVaultEntryIds, entry.id] : teamVaultEntryIds.filter((id) => id !== entry.id)) })} /><span>{workspace.clients.find((client) => client.id === entry.clientId)?.name || "Client"} · {entry.title} ({entry.kind})</span></label>)}</div> : <p className="form-hint">Unlock the Client Vault first to choose individual logins. The teammate will also need the vault passphrase to decrypt approved entries.</p>}</section>}{(form.permission_aiAssistant === "true" || form.permission_aiAssistant === undefined && getTeamPermissions(form.role || "Staff").aiAssistant) && <section className="permission-editor"><h3>AI assistant access</h3><p>Choose which client-specific AI modes this teammate can use. Chat history stays separated by client and mode.</p><div className="permission-checks">{aiModes.map((mode) => { const selectedModes = selectedFormIds(form, "aiModeAccess"); return <label key={mode.name}><input type="checkbox" checked={selectedModes.includes(mode.name)} onChange={(event) => setForm({ ...form, aiModeAccess: JSON.stringify(event.target.checked ? [...selectedModes, mode.name] : selectedModes.filter((name) => name !== mode.name)) })} /><span><AiIcon v={mode.icon} /> {mode.name}</span></label>; })}</div></section>}{form.staffId === selfProfile?.id && isAdmin && !previewMemberId && <section className="permission-editor full-field staff-calendar-settings"><h3>📅 Google Calendar</h3><p>Connect once here. Dated tasks from both Workflow and AI tasks will be added and updated automatically.</p>{googleCalendarStatus?.connected ? <div className="staff-calendar-connected"><span>✅ Connected{googleCalendarStatus.accountEmail ? ` · ${googleCalendarStatus.accountEmail}` : ""}</span><small>{googleCalendarStatus.syncedCount || 0} task dates syncing</small><a className="secondary-button" href="/api/google-calendar/connect">Reconnect calendar</a></div> : <a className="primary-button" aria-disabled={googleCalendarStatus?.available === false} href={googleCalendarStatus?.available === false ? undefined : "/api/google-calendar/connect"}>{googleCalendarStatus?.available === false ? "Calendar connection unavailable" : "Connect Google Calendar"}</a>}</section>}<div className="invite-note"><b>Secure sign-in</b><p>Staff use their own verified email to sign in. Once the one-time Cloudflare connection is set up, saving this profile adds that exact email to the workspace allow list. You only need to add the person once here.</p></div>{form.staffId && isAdmin && <section className="permission-editor"><h3>Login email</h3><p>Customize the note for the saved email address {workspace.staff.find((member) => member.id === form.staffId)?.email || form.email}. Use <code>{"{{name}}"}</code>, <code>{"{{email}}"}</code>, <code>{"{{appUrl}}"}</code> and <code>{"{{sender}}"}</code> if you want recipient details filled in automatically. Their own verified sign-in is used; no password is sent.</p>{(form.email || "").trim().toLowerCase() !== (workspace.staff.find((member) => member.id === form.staffId)?.email || "").toLowerCase() && <p className="form-error">Save the changed email address before sending; this button sends to the saved profile address.</p>}<Field label="Email subject" name="inviteSubject" value={form.inviteSubject} set={setForm} placeholder="You’re invited to join F2B Media" required /><label className="field"><span>Custom message</span><textarea rows={7} maxLength={6000} value={form.inviteMessage || ""} onChange={(event) => setForm({ ...form, inviteMessage: event.target.value })} /></label><div className="invite-note"><b>Automatic access</b><p>Saving this profile adds their exact email to the workspace allow list. The login email button confirms access first, then sends your branded invitation.</p></div>{staffInviteStatus && <p className={staffInviteStatus.startsWith("Workspace access confirmed") ? "form-hint" : "form-error"} role="status">{staffInviteStatus}</p>}<button type="button" className="primary-button" onClick={sendStaffInvite} disabled={staffInviteSending || !form.inviteSubject?.trim() || !form.inviteMessage?.trim() || (form.email || "").trim().toLowerCase() !== (workspace.staff.find((member) => member.id === form.staffId)?.email || "").toLowerCase()}>{staffInviteSending ? "Sending…" : "✉ Send login email"}</button></section>}<ModalActions onCancel={() => setModal("")} onSave={saveStaff} label={form.staffId ? "Save changes" : "Add profile"} /></>) }
        {modal === "task" && <><div className="form-grid"><Field label="Task name" name="title" value={form.title} set={setForm} placeholder="What needs to get done?" required /><label className="field"><span>Client</span><select value={form.clientId || ""} onChange={(e) => setForm({ ...form, clientId: e.target.value, projectId: "", campaignId: "", campaignName: "" })}><option value="">Internal / unassigned</option>{workspace.clients.map((c) => <option value={c.id} key={c.id}>{c.name}</option>)}</select></label><TeamMemberSelect label="Assign to" value={form.assigneeId || ""} members={workspace.staff} allowUnassigned onChange={(value) => setForm({ ...form, assigneeId: value })} /><label className="field"><span>Service / task category</span><select value={form.service || "SEO"} onChange={(e) => setForm({ ...form, service: e.target.value })}>{taskCategories.map((x) => <option key={x} value={x}>{serviceIcons[x]} {x}</option>)}</select></label><label className="field"><span>Priority</span><select value={form.priority || "Normal"} onChange={(e) => setForm({ ...form, priority: e.target.value })}>{["Low", "Normal", "High", "Urgent"].map((x) => <option key={x}>{x}</option>)}</select></label><TaskDateField value={form.due || ""} onChange={(due) => setForm((current) => ({ ...current, due }))} /><label className="field"><span>Arrival / run time (local)</span><input type="time" value={form.dueTime || "09:00"} onChange={(e) => setForm({ ...form, dueTime: e.target.value })} /></label>{form.service === "Sites" ? <div className="field"><span>Repeat</span><p className="form-hint">Sites tasks run once so they do not create duplicate pages.</p></div> : <label className="field"><span>Repeat</span><select value={form.repeat || "None"} onChange={(e) => setForm({ ...form, repeat: e.target.value })}><option value="None">Does not repeat</option><option value="Daily">Daily</option><option value="Weekly">Weekly</option><option value="Fortnightly">Fortnightly</option><option value="Monthly">Monthly</option></select></label>}<label className="field task-estimate-field"><span>Estimated time</span><div className="task-estimate-input-row"><input aria-label="Estimated time in hours" name="estimate" type="number" min="0" step="any" inputMode="decimal" placeholder="0" value={form.estimate || ""} onChange={(event) => setForm((current) => ({ ...current, estimate: event.target.value }))} /><span>hours</span></div><div className="task-estimate-quick-add" aria-label="Add estimated time">{[5, 10, 15, 30].map((minutes) => <button type="button" key={minutes} onClick={() => setForm((current) => ({ ...current, estimate: String(Number((((Number(current.estimate) || 0) * 60 + minutes) / 60).toFixed(4))) }))}>＋{minutes}m</button>)}</div></label></div>{["Google Ads", "Meta Ads", "Audit"].includes(form.service || "") && <section className="task-campaign-fields"><label className="field"><span>{form.service === "Meta Ads" ? "Meta Ads campaign" : "Google Ads campaign"}</span><select value={form.campaignId || ""} disabled={!form.clientId || taskCampaignsLoading} onChange={(event) => { const campaign = taskCampaigns.find((item) => item.id === event.target.value); setForm({ ...form, campaignId: event.target.value, campaignName: campaign?.name || "" }); }}><option value="">{taskCampaignsLoading ? "Loading campaigns…" : "All campaigns (no campaign selected)"}</option>{taskCampaigns.map((campaign) => <option value={campaign.id} key={campaign.id}>{campaign.name} · {campaign.status}</option>)}</select></label>{taskCampaignsError && <p className="form-error">{taskCampaignsError}</p>}<label className="field"><span>Campaign context (optional)</span><textarea rows={2} maxLength={1200} value={form.campaignContext || ""} onChange={(event) => setForm({ ...form, campaignContext: event.target.value })} placeholder="Goal, offer, target location, known issues or other campaign-specific guidance…" /></label><small>The selected campaign and context are included in the assigned agent’s instructions and account evidence.</small></section>}{isAiRun && <label className="field task-note-field"><span>📋 Task instructions / AI brief</span><textarea rows={3} value={form.notes || ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Instructions for the AI task…" /></label>}{isAiRun && form.service === "Sites" && <section className="task-campaign-fields ai-site-reference"><label className="field"><span>🖼️ Page design reference (optional)</span><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={!form.clientId || form.referenceUploading === "true"} onChange={async (event) => { const original = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (!original || !form.clientId) return; setError(""); setForm((current) => ({ ...current, referenceUploading: "true" })); try { const prepared = await prepareAiTaskReference(original); const uploaded = await uploadClientFile(form.clientId, prepared); setForm((current) => ({ ...current, referenceUploading: "false", aiReferenceFileId: uploaded.id, aiReferenceFileName: uploaded.name })); } catch (reason) { setForm((current) => ({ ...current, referenceUploading: "false" })); setError(reason instanceof Error ? reason.message : "Could not upload the design reference."); } }} /></label>{form.referenceUploading === "true" ? <p className="form-hint">Preparing and uploading the image…</p> : form.aiReferenceFileId ? <p className="form-hint">✅ {form.aiReferenceFileName || "Design reference attached"} <button type="button" className="text-button" onClick={() => setForm((current) => ({ ...current, aiReferenceFileId: "", aiReferenceFileName: "" }))}>Remove</button></p> : <p className="form-hint">Upload a screenshot or image. The AI will use its layout and visual style when building the WordPress draft. Choose a client first. Images are resized and saved to that client’s files.</p>}</section>}<TaskChecklistForm value={form.checklist || ""} onChange={(checklist) => setForm((current) => ({ ...current, checklist }))} /><ModalActions onCancel={() => setModal("")} onSave={saveTask} label={form.taskId ? "Save task changes" : "Create task"} /></>}
      {modal === "project" && <><div className="form-grid"><Field label="Project name" name="name" value={form.name} set={setForm} placeholder="e.g. Q4 website refresh" required /><label className="field"><span>Client</span><select value={form.clientId || ""} onChange={(e) => setForm({ ...form, clientId: e.target.value })}><option value="">Internal project</option>{workspace.clients.map((c) => <option value={c.id} key={c.id}>{c.name}</option>)}</select></label><Field label="Target date" name="due" value={form.due} set={setForm} type="date" /></div><ModalActions onCancel={() => setModal("")} onSave={saveProject} label="Create project" /></>}
      {modal === "note" && <><label className="field"><span>Work note</span><textarea rows={5} value={form.body || ""} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder="Capture context, decisions or next steps…" /></label><ModalActions onCancel={() => setModal("")} onSave={saveNote} label="Save note" /></>}
      {modal === "notes" && <NotesCenter notes={workspace.notes} tasks={workspace.tasks} clients={workspace.clients} taskId={form.taskId} clientId={form.clientId} body={form.body || ""} onBodyChange={(body) => setForm((current) => ({ ...current, body }))} onSave={saveNote} onCancel={() => setModal("")} />}
      {modal === "time" && <><div className="form-grid"><label className="field"><span>Task</span><select value={form.taskId || ""} onChange={(e) => setForm({ ...form, taskId: e.target.value })}><option value="">Choose a task</option>{workspace.tasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</select></label><TeamMemberSelect label="Team member" value={form.staffId || ""} members={workspace.staff} onChange={(value) => setForm({ ...form, staffId: value })} /><Field label="Minutes" name="minutes" value={form.minutes} set={setForm} type="number" placeholder="30" required /><Field label="Note" name="note" value={form.note} set={setForm} placeholder="What was worked on?" /></div><ModalActions onCancel={() => setModal("")} onSave={addManualTime} label="Save time entry" /></>}
      {modal === "finance" && <><div className="form-grid"><Field label="Description" name="description" value={form.description} set={setForm} placeholder={form.kind === "Expense" ? "e.g. Software subscription" : "e.g. Website project payment"} required /><Field label="Amount (€)" name="amount" value={form.amount} set={setForm} type="number" placeholder="0.00" required /><label className="field"><span>Type</span><select value={form.kind || "Income"} onChange={(e) => setForm({ ...form, kind: e.target.value })}><option>Income</option><option>Expense</option></select></label>{!form.clientId && <label className="field"><span>Category</span><select value={form.category || "Other"} onChange={(e) => setForm({ ...form, category: e.target.value })}>{(form.kind === "Expense" ? ["Software", "Payroll", "Advertising", "Equipment", "Travel", "Office", "Tax", "Other"] : ["Client payment", "Project income", "Retainer", "Other"]).map((x) => <option key={x}>{x}</option>)}</select></label>}<Field label={form.financeRecurringId ? "Next due date" : "Date"} name="date" value={form.date} set={setForm} type="date" /><label className="field"><span>Repeat</span><select value={form.repeat || "None"} onChange={(e) => setForm((current) => ({ ...current, repeat: e.target.value }))}>{!form.financeRecurringId && <option value="None">One time</option>}<option value="Weekly">Weekly</option><option value="Monthly">Monthly</option><option value="Quarterly">Quarterly</option><option value="Yearly">Yearly</option></select></label>{form.repeat && form.repeat !== "None" && <Field label="Repeat until (optional)" name="repeatEnd" value={form.repeatEnd} set={setForm} type="date" />}<label className="field"><span>Client (optional)</span><select value={form.clientId || ""} onChange={(e) => setForm({ ...form, clientId: e.target.value })}><option value="">No client / agency-wide</option>{workspace.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label></div><p className="form-hint">{form.financeRecurringId ? "Changes apply to this recurring item and its future estimates. The next due date sets its schedule going forward." : "Save a one-time entry or repeat it weekly, monthly, quarterly or yearly. The first entry uses this date; blank dates use today."}</p><ModalActions onCancel={() => setModal("")} onSave={saveFinanceRecord} label={form.financeRecurringId ? "Save recurring item" : form.financeRecordId ? `Update ${form.kind === "Expense" ? "expense" : "income"}` : form.kind === "Expense" ? "Save expense" : "Save income"} /></>}
      {modal === "vault-access" && <><div className="security-callout"><span>🔐</span><div><b>Your login vault is encrypted before it is saved.</b><p>The passphrase stays on this device. If you forget it, saved logins cannot be recovered.</p></div></div><div className="form-grid"><Field label="Vault passphrase" name="passphrase" value={form.passphrase} set={setForm} type="password" placeholder="At least 12 characters" required />{!workspace.vault && <Field label="Repeat passphrase" name="confirmPassphrase" value={form.confirmPassphrase} set={setForm} type="password" placeholder="Type it again" required />}</div>{vaultError && <p className="form-error">{vaultError}</p>}<ModalActions onCancel={() => { setModal(""); setForm({}); setVaultError(""); }} onSave={unlockVault} label={workspace.vault ? "Unlock vault" : "Create encrypted vault"} /></>}
      {modal === "vault-entry" && <><div className="security-callout"><span>🛡️</span><div><b>Enter credentials here in the app.</b><p>They are encrypted in your browser before being sent to private storage. Don’t paste client passwords into chat.</p></div></div><div className="form-grid"><label className="field"><span>Client</span><select value={form.clientId || ""} onChange={(e) => setForm({ ...form, clientId: e.target.value })}><option value="">Choose a client</option>{workspace.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label className="field"><span>Login type</span><select value={form.kind || "Website"} onChange={(e) => setForm({ ...form, kind: e.target.value })}>{["Website", "Hosting", "FTP / SFTP", "Domain", "Google Ads", "Meta Ads", "SEO", "Email", "Other"].map((x) => <option key={x}>{x}</option>)}</select></label><Field label="Easy-to-recognise name" name="title" value={form.title} set={setForm} placeholder={form.kind === "FTP / SFTP" ? "e.g. Website file access" : "e.g. Google Ads account"} required />{form.kind === "FTP / SFTP" && <><label className="field"><span>Connection type</span><select value={form.protocol || "SFTP"} onChange={(e) => setForm({ ...form, protocol: e.target.value })}>{["SFTP", "FTP", "FTPS"].map((x) => <option key={x}>{x}</option>)}</select></label><Field label="Server / host" name="host" value={form.host} set={setForm} placeholder="ftp.example.com" required /><Field label="Port" name="port" value={form.port || (form.protocol === "FTP" ? "21" : form.protocol === "FTPS" ? "990" : "22")} set={setForm} placeholder="22" /><Field label="Remote folder / path" name="path" value={form.path} set={setForm} placeholder="/public_html" /></>}<Field label={form.kind === "FTP / SFTP" ? "Control panel URL (optional)" : "Login page or service URL"} name="url" value={form.url} set={setForm} placeholder="https://…" /><Field label="Username or email" name="username" value={form.username} set={setForm} placeholder={form.kind === "FTP / SFTP" ? "FTP username" : "Login email"} /><Field label={form.kind === "FTP / SFTP" ? "Password" : "Password or API key"} name="secret" value={form.secret} set={setForm} type="password" placeholder="Private credential" /><label className="field full-field"><span>Helpful note</span><textarea rows={3} value={form.notes || ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Account ID, access notes, recovery steps…" /></label></div>{vaultError && <p className="form-error">{vaultError}</p>}<ModalActions onCancel={() => { setModal(""); setForm({}); setVaultError(""); }} onSave={saveVaultEntry} label="Encrypt & save login" /></>}
    </section></div>}
  </div>;
}

function StaffAvatar({ member }: { member: Staff }) {
  const avatar = agentIconFor(member) || member.avatar || "";
  const hasImage = avatar.startsWith("http") || avatar.startsWith("data:image/");
  return <span className={"staff-select-avatar " + (hasImage ? "has-image" : "")} style={hasImage ? { backgroundImage: "url(" + avatar + ")" } : undefined}>{hasImage ? "" : <AiIcon v={member.isBot ? "🤖" : avatar || initials(member.name)} />}</span>;
}
function TeamMemberSelect({ label, value, members, onChange, allowUnassigned = false }: { label: string; value: string; members: Staff[]; onChange: (value: string) => void; allowUnassigned?: boolean }) {
  const selected = members.find((member) => member.id === value);
  const selectedValue = value || (allowUnassigned ? "__unassigned__" : members[0]?.id || "");
  return <label className="field"><span>{label}</span><Select value={selectedValue} onValueChange={(next) => onChange(next === "__unassigned__" ? "" : next)}><SelectTrigger className="team-select-trigger"><SelectValue placeholder="Choose a teammate">{selected ? <><StaffAvatar member={selected} />{selected.name}</> : <><span className="staff-select-avatar">—</span>Unassigned</>}</SelectValue></SelectTrigger><SelectContent position="popper" align="start">{allowUnassigned && <SelectItem value="__unassigned__"><span className="staff-select-avatar">—</span>Unassigned</SelectItem>}{members.map((member) => <SelectItem value={member.id} key={member.id}><StaffAvatar member={member} />{member.name}{member.isBot && <small className="staff-select-note">Scheduled AI</small>}</SelectItem>)}</SelectContent></Select></label>;
}
function TaskDateField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const displayDate = value ? new Date(`${value}T00:00:00`).toLocaleDateString("en-US") : "Choose date";
  return <div className="field task-date-field"><span>Task deadline / AI run date</span><label className="task-date-editor-trigger"><span>{displayDate}</span><span aria-hidden="true">▦</span><input className="task-date-picker-input task-date-editor-input" type="date" value={value} aria-label="Choose task deadline" onClick={(event) => { event.stopPropagation(); try { event.currentTarget.showPicker(); } catch { /* The native control may already have opened its picker. */ } }} onChange={(event) => onChange(event.target.value)} /></label></div>;
}
function Field({ label, name, value, set, placeholder, type = "text", required = false }: { label: string; name: string; value?: string; set: Dispatch<SetStateAction<Record<string, string>>>; placeholder?: string; type?: string; required?: boolean }) {
  return <label className="field"><span>{label}{required && <i> · required</i>}</span><input type={type} min={type === "number" ? "0" : undefined} value={value || ""} placeholder={placeholder} onChange={(e) => set((current) => ({ ...current, [name]: e.target.value }))} /></label>;
}
function ModalActions({ onCancel, onSave, label }: { onCancel: () => void; onSave: () => void; label: string }) { return <div className="modal-actions"><button className="secondary-button" onClick={onCancel}>Cancel</button><button className="primary-button" onClick={onSave}>{label}<span>↗</span></button></div>; }

function reportEscape(value: string) { return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#39;"); }
function reportMarkdownHtml(text: string) {
  const lines = reportEscape(text).split(/\r?\n/); const html: string[] = []; let list = false;
  for (const line of lines) {
    const value = line.trim(); if (!value) { if (list) { html.push("</ul>"); list = false; } continue; }
    const safe = value.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>"); const heading = safe.match(/^(#{1,3})\s+(.+)$/);
    if (heading) { if (list) { html.push("</ul>"); list = false; } html.push(`<h2>${heading[2]}</h2>`); }
    else if (/^[-*]\s+/.test(safe)) { if (!list) { html.push("<ul>"); list = true; } html.push(`<li>${safe.replace(/^[-*]\s+/, "")}</li>`); }
    else { if (list) { html.push("</ul>"); list = false; } html.push(`<p>${safe}</p>`); }
  }
  if (list) html.push("</ul>"); return html.join("");
}
function reportChart(report: GeneratedReport) {
  const sources = report.sourceData || {}; const ads = (sources.googleAds || sources.metaAds || {}) as Record<string, unknown>;
  const campaigns = Array.isArray(ads.campaigns) ? ads.campaigns as Array<Record<string, unknown>> : [];
  if (campaigns.length) return { title: "Spend by campaign", rows: campaigns.slice(0, 6).map((item) => ({ name: String(item.name || "Campaign"), value: Number(item.spend) || 0 })) };
  const seo = (sources.searchConsole || {}) as Record<string, unknown>; const queries = Array.isArray(seo.topQueries) ? seo.topQueries as Array<Record<string, unknown>> : [];
  if (queries.length) return { title: "Clicks by search query", rows: queries.slice(0, 6).map((item) => ({ name: String(item.name || "Search query"), value: Number(item.clicks) || 0 })) };
  return null;
}
function ReportChartView({ report }: { report: GeneratedReport }) {
  const chart = reportChart(report); if (!chart) return null;
  const max = Math.max(1, ...chart.rows.map((item) => item.value));
  return <section className="report-chart"><h3>{chart.title}</h3>{chart.rows.map((item) => <div className="report-chart-row" key={item.name}><span>{item.name}</span><div><i style={{ width: `${Math.max(0, Math.min(100, item.value / max * 100))}%` }} /></div><small>{item.value.toLocaleString("en-IE", { maximumFractionDigits: 2 })}</small></div>)}</section>;
}
function printGeneratedReport(report: GeneratedReport) {
  const popup = window.open("", "_blank"); if (!popup) return false;
  const clientLogo = report.logo && (report.logo.startsWith("data:image/") || report.logo.startsWith("https://")) ? `<img class="client-logo" src="${reportEscape(report.logo)}" alt="${reportEscape(report.clientName)}">` : ""; const logo = `<div class="brand-logos"><img class="agency-logo" src="${reportEscape(resolveAgencyLogoUrl(window.location.href))}" alt="F2B Media">${clientLogo}</div>`; const brandColor = /^#[0-9a-f]{6}$/i.test(report.color || "") ? report.color : "#1776c8";
  const tasks = report.completedTasks?.length ? `<section><h2>Completed work</h2>${report.completedTasks.map((task) => `<article><b>${reportEscape(task.title)}</b><small>${reportEscape(task.service)}</small>${task.outcome ? `<p>${reportEscape(task.outcome)}</p>` : ""}</article>`).join("")}</section>` : "";
  const chart = reportChart(report); const sourceEvidence = reportSourceEvidenceHtml(report.sourceData); const maxChart = Math.max(1, ...(chart?.rows.map((item) => item.value) || [])); const chartHtml = chart ? `<section><h2>${chart.title}</h2>${chart.rows.map((item) => `<div class="bar-row"><span>${reportEscape(item.name)}</span><div class="bar-track"><i style="width:${Math.max(0, Math.min(100, item.value / maxChart * 100))}%"></i></div><small>${item.value.toLocaleString("en-IE", { maximumFractionDigits: 2 })}</small></div>`).join("")}</section>` : "";
  popup.document.open();
  popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${reportEscape(report.clientName)} marketing report</title><style>@page{size:A4;margin:16mm}*{box-sizing:border-box}body{font:14px/1.65 Arial,sans-serif;color:#25313a;margin:0}.brand{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid ${brandColor};padding-bottom:18px;margin-bottom:24px}.brand-logos{display:flex;align-items:center;gap:14px}.brand-logos img{max-width:150px;max-height:64px;object-fit:contain}.brand-logos .client-logo{max-width:92px}.kicker,small{color:#697985;font-size:11px}h1{font-size:26px;margin:3px 0;color:#182c3b}h2{font-size:18px;color:#173b58;margin-top:25px}p{margin:0 0 10px;white-space:pre-wrap}pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere;margin:22px 0}article{padding:10px 0;border-bottom:1px solid #e4e9ed;break-inside:avoid}article small{display:block;margin:3px 0}.bar-row{display:grid;grid-template-columns:2fr 3fr auto;align-items:center;gap:10px;padding:6px 0;font-size:12px}.bar-track{height:10px;border-radius:8px;background:#e8eef3;overflow:hidden}.bar-track i{display:block;height:100%;background:${brandColor}}.footer{margin-top:36px;padding-top:10px;border-top:1px solid #dce3e8;color:#687680;font-size:11px}</style></head><body><header class="brand"><div><small>F2B MEDIA · CLIENT REPORT</small><h1>${reportEscape(report.clientName)}</h1>${report.company ? `<div>${reportEscape(report.company)}</div>` : ""}</div>${logo}</header><p><b>${reportEscape(report.templateName)}</b> · ${reportEscape(report.period)}</p><main>${reportMarkdownHtml(report.text)}</main>${chartHtml}${sourceEvidence}${tasks}<footer class="footer">Prepared by F2B Media · Generated ${new Date(report.generatedAt).toLocaleDateString("en-IE")}. Figures are limited to connected source data and saved CRM task results.</footer><script>window.addEventListener('load',()=>setTimeout(()=>window.print(),300))</script></body></html>`);
  popup.document.close(); return true;
}
function defaultReportTemplates(): ReportTemplate[] {
  return [
    { id: "report-template-google-ads", name: "Google Ads performance", source: "Google Ads", instructions: "Summarise spend, traffic, conversions and the strongest campaigns. Explain missing data clearly and keep the report client friendly.", formulas: "CTR = clicks ÷ impressions × 100. Cost per conversion = spend ÷ conversions." },
    { id: "report-template-meta-ads", name: "Meta Ads performance", source: "Meta Ads", instructions: "Summarise campaign delivery and platform reported leads. Clearly state that platform leads are not verified CRM leads.", formulas: "CTR = clicks ÷ impressions × 100. Cost per lead = spend ÷ platform reported leads." },
    { id: "report-template-seo", name: "SEO performance", source: "SEO", instructions: "Summarise Search Console visibility, clicks, impressions, CTR and average position. Explain the Search Console data lag.", formulas: "CTR = clicks ÷ impressions × 100. Average position is weighted by impressions." },
    { id: "report-template-ga4", name: "Google Analytics performance", source: "Google Analytics", instructions: "Summarise GA4 sessions, active users, engagement and configured conversions. Clearly state that Analytics conversions are configured events, not independently verified leads.", formulas: "Engagement rate = engaged sessions ÷ sessions × 100." },
    { id: "report-template-combined", name: "Combined marketing report", source: "Combined Marketing", instructions: "Combine connected Google Ads, Meta Ads and Search Console results. Separate each channel and do not compare unlike metrics as if they were equivalent.", formulas: "Show only supplied totals. Label missing or disconnected sources." },
    { id: "report-template-executive", name: "Executive summary", source: "Executive Summary", instructions: "Give a brief leadership overview of connected marketing results, completed work and next steps supported by the supplied evidence.", formulas: "Show only supplied totals. Distinguish platform reported leads from verified CRM leads." },
  ];
}

function ReportsView({ templates, clients, reports, selectedClientId, selectedReportId, reportContext, onReportContextApplied, onReportOpened, onSave, onSaveReport }: { templates: ReportTemplate[]; clients: Client[]; reports: GeneratedReport[]; selectedClientId?: string; selectedReportId?: string; reportContext?: { clientId: string; campaignId: string; campaignName: string; range: string; from: string; to: string } | null; onReportContextApplied: () => void; onReportOpened: () => void; onSave: (templates: ReportTemplate[]) => Promise<boolean>; onSaveReport: (report: GeneratedReport) => Promise<boolean> }) {
  const [local, setLocal] = useState<ReportTemplate[]>(templates.length ? templates : defaultReportTemplates());
  const [clientId, setClientId] = useState(selectedClientId || "");
  const [source, setSource] = useState("Google Ads"); const [templateId, setTemplateId] = useState(""); const [brief, setBrief] = useState(""); const [campaignId, setCampaignId] = useState(""); const [campaignName, setCampaignName] = useState("");
  const [range, setRange] = useState("last_30d"); const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const [includedServices, setIncludedServices] = useState(["Google Ads", "Meta Ads", "SEO", "Google Analytics"]);
  const [includeTasks, setIncludeTasks] = useState(true); const [includeCommentary, setIncludeCommentary] = useState(true);
  const [metrics, setMetrics] = useState(["Spend", "Impressions", "Clicks", "Leads / conversions", "CTR", "Top campaigns / queries"]);
  const [output, setOutput] = useState<GeneratedReport | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useAppErrorState("Report Studio"); const [saveStatus, setSaveStatus] = useState("");
  useEffect(() => { if (templates.length) setLocal(templates); }, [templates]);
  useEffect(() => { if (selectedClientId) { setClientId(selectedClientId); setOutput(null); setSaveStatus(""); } }, [selectedClientId]);
  useEffect(() => { if (!reportContext) return; setClientId(reportContext.clientId); setCampaignId(reportContext.campaignId); setCampaignName(reportContext.campaignName); setRange(reportContext.range); setFrom(reportContext.from); setTo(reportContext.to); setOutput(null); setError(""); setSaveStatus(""); const googleTemplate = local.find((item) => item.source === "Google Ads"); if (googleTemplate) { setTemplateId(googleTemplate.id); setSource(googleTemplate.source); } onReportContextApplied(); }, [reportContext]);
  useEffect(() => { if (!selectedReportId) return; const report = reports.find((item) => item.id === selectedReportId); if (!report) return; setClientId(report.clientId); setOutput(report); setError(""); setSaveStatus("Opened saved report."); onReportOpened(); }, [selectedReportId, reports, onReportOpened]);
  const addTemplate = () => { const id = uid(); setLocal((items) => [...items, { id, name: "New report template", source, instructions: "Describe the report audience and what it should explain.", formulas: "CTR = clicks ÷ impressions × 100\nCPL = spend ÷ leads" }]); setTemplateId(id); };
  const update = (id: string, key: "name" | "source" | "instructions" | "formulas", value: string) => setLocal((items) => items.map((item) => item.id === id ? { ...item, [key]: value } : item));
  const generate = async () => {
    setBusy(true); setError(""); setOutput(null);
    try {
      if (range === "custom" && (!from || !to || from > to)) throw new Error("Choose a valid start and end date.");
      if (!(await onSave(local))) throw new Error("Could not save the report template. Try again.");
      if (campaignId && selectedTemplate?.source !== "Google Ads") throw new Error("Choose a Google Ads report template for a campaign-specific report.");
      const response = await fetch("/api/studio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "report", clientId, templateId, brief, range, from, to, campaignId, campaignName, includeCompletedTasks: includeTasks, includeAiCommentary: includeCommentary, metrics, services: allowsServiceSelection ? includedServices : [selectedTemplate?.source] }) });
      const result = await response.json() as any; if (!response.ok) throw new Error(result.error || "Could not generate the report.");
      const client = clients.find((item) => item.id === clientId)!; const template = local.find((item) => item.id === templateId)!;
      const saved: GeneratedReport = { id: uid(), clientId, clientName: client.name, company: client.company, templateName: template.name, title: result.title || `${client.name} - ${template.name}`, period: result.period || "Reporting period unavailable", text: String(result.text || ""), generatedAt: result.generatedAt || new Date().toISOString(), logo: client.logo, color: client.color, campaignId: result.campaignScope?.id || undefined, campaignName: result.campaignScope?.name || undefined, sourceData: result.sourceData || {}, completedTasks: Array.isArray(result.completedTasks) ? result.completedTasks : [] };
      setOutput(saved); setSaveStatus(""); if (!(await onSaveReport(saved))) setError("Generated, but could not save this report to the client history. Select Save changes to retry."); else setSaveStatus("Saved to this client’s report history.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not generate the report."); } finally { setBusy(false); }
  };
  const saveReport = async () => { if (!output) return; setSaveStatus(""); const ok = await onSaveReport(output); setSaveStatus(ok ? "Saved to this client’s report history." : "Could not save. Check the workspace connection and try again."); };
  const selectedTemplate = local.find((item) => item.id === templateId);
  const allowsServiceSelection = ["Combined Marketing", "Executive Summary", "Audit"].includes(selectedTemplate?.source || "");
  const clientReports = reports.filter((report) => report.clientId === clientId).sort((a, b) => b.generatedAt.localeCompare(a.generatedAt)).slice(0, 20);
  const reportSources = ["Google Ads", "Meta Ads", "SEO", "Combined Marketing", "Executive Summary", "Agency delivery", "Audit", "Google Analytics"];
  return <><div className="page-heading"><div><p className="eyebrow">📈 CLIENT REPORTS · VERIFIED RESULTS</p><h1>Report Studio</h1><p className="muted">Build a client report from connected performance data and completed work, then print or save it as PDF.</p></div><button className="primary-button" onClick={addTemplate}>＋ New template</button></div>
    <section className="studio-panel"><h2>Generate a report</h2><div className="report-run-controls"><label className="field"><span>Client</span><select value={clientId} onChange={(event) => { setClientId(event.target.value); setCampaignId(""); setCampaignName(""); setOutput(null); setError(""); setSaveStatus(""); }}><option value="">Choose a client</option>{clients.map((client) => <option value={client.id} key={client.id}>{client.name}</option>)}</select></label><label className="field"><span>Saved template · report type</span><select value={templateId} onChange={(event) => setTemplateId(event.target.value)}><option value="">Choose a template</option>{local.map((item) => <option value={item.id} key={item.id} disabled={Boolean(campaignId) && item.source !== "Google Ads"}>{item.name} · {item.source}</option>)}</select></label></div>
    {campaignId && <div className="report-campaign-scope" role="status"><span>📣 Campaign report · <b>{campaignName || campaignId}</b> <small>ID {campaignId}</small></span><button type="button" className="text-button" onClick={() => { setCampaignId(""); setCampaignName(""); }}>Remove campaign filter</button></div>}
    <div className="report-run-controls"><label className="field"><span>Audit and report period</span><select value={range} onChange={(event) => setRange(event.target.value)}><option value="last_7d">Last 7 complete days</option><option value="last_30d">Last 30 complete days</option><option value="last_90d">Last 90 complete days</option><option value="custom">Custom dates</option></select></label>{range === "custom" && <><label className="field"><span>From</span><input type="date" aria-label="Report period start date" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label className="field"><span>To</span><input type="date" aria-label="Report period end date" value={to} onChange={(event) => setTo(event.target.value)} /></label></>}</div><p className="form-hint">This period is used to fetch the report data and is printed on the exported PDF.</p>
    {allowsServiceSelection && <fieldset className="report-options"><legend>Include marketing services</legend><div className="report-option-grid">{["Google Ads", "Meta Ads", "SEO", "Google Analytics"].map((service) => <label key={service}><input type="checkbox" checked={includedServices.includes(service)} onChange={(event) => setIncludedServices((items) => event.target.checked ? [...items, service] : items.filter((item) => item !== service))} />{service}</label>)}</div></fieldset>}<fieldset className="report-options"><legend>Include in report</legend><div className="report-option-grid">{["Spend", "Impressions", "Clicks", "Leads / conversions", "CTR", "Cost per lead / conversion", "Average position", "Sessions", "Organic sessions", "Organic key events", "Active users", "Engaged sessions", "Engagement rate", "Top campaigns / queries"].map((metric) => <label key={metric}><input type="checkbox" checked={metrics.includes(metric)} onChange={(event) => setMetrics((items) => event.target.checked ? [...items, metric] : items.filter((item) => item !== metric))} />{metric}</label>)}</div><label className="report-option-toggle"><input type="checkbox" checked={includeTasks} onChange={(event) => setIncludeTasks(event.target.checked)} /> Include completed CRM tasks</label><label className="report-option-toggle"><input type="checkbox" checked={includeCommentary} onChange={(event) => setIncludeCommentary(event.target.checked)} /> Add evidence-based AI commentary</label></fieldset>
    <label className="field"><span>Extra context or focus (optional)</span><input value={brief} onChange={(event) => setBrief(event.target.value)} placeholder="e.g. Focus on lead quality and the spring campaign" /></label><p className="form-hint">Only connected account data and completed tasks are included. Missing sources are labelled, not treated as zero. Meta leads are platform-reported, not CRM-verified. Search Console is not a technical crawl and recent data can be incomplete.</p><button className="primary-button" disabled={busy || !clientId || !templateId} onClick={generate}>{busy ? "Generating report…" : "✨ Generate report"}</button>{error && <p className="studio-error" role="alert">{error}</p>}
    {output && <section className="studio-output report-preview"><header className="report-preview-header"><div><img className="report-brand-logo" src="/f2b-media-logo.png" alt="F2B Media" />{output.logo ? <img src={output.logo} alt="" /> : <span className="report-client-mark">{initials(output.clientName)}</span>}<div><small>F2B MEDIA · CLIENT REPORT</small><h3>{output.clientName}</h3><p>{output.templateName} · {output.period}</p></div></div><div className="report-preview-actions"><button className="primary-button" onClick={() => { if (!printGeneratedReport(output)) setError("Allow pop-ups for this workspace, then select Print / Save as PDF again."); }}>⤓ Print / Save as PDF</button><button className="secondary-button" onClick={() => void saveReport()}>Save changes</button><button className="secondary-button" onClick={() => downloadText("f2b-report.md", output.text)}>Download text</button></div>{saveStatus && <small role="status">{saveStatus}</small>}</header><details className="report-edit"><summary>Edit report text</summary><textarea rows={14} value={output.text} onChange={(event) => setOutput({ ...output, text: event.target.value })} /></details><div className="report-preview-copy" dangerouslySetInnerHTML={{ __html: reportMarkdownHtml(output.text) }} />{reportChart(output) && <ReportChartView report={output} />}{output.completedTasks?.length ? <section className="report-preview-tasks"><h3>Completed work · {output.completedTasks.length}</h3>{output.completedTasks.map((task, index) => <article key={`${task.title}-${index}`}><b>{task.title}</b><small>{task.service}</small>{task.outcome && <p>{task.outcome}</p>}</article>)}</section> : null}<details className="report-evidence"><summary>View data and source status</summary>{summarizeReportSources(output.sourceData).length ? <ul className="report-source-list">{summarizeReportSources(output.sourceData).map((source) => <li key={source.key}><div><b>{source.label}</b><span>{source.status}</span></div>{source.source && <small>Source: {source.source}</small>}{source.period && <small>Period: {source.period}</small>}{source.comparison && <small>{source.comparison}</small>}{source.note && <p>{source.note}</p>}</li>)}</ul> : <p>No marketing data sources were included in this report.</p>}</details></section>}</section>
    {clientId && <section className="panel report-history"><div className="section-title"><h2>📚 {clients.find((client) => client.id === clientId)?.name} report history</h2><span>{clientReports.length} saved</span></div>{clientReports.length ? clientReports.map((report) => <button key={report.id} className="report-history-row" onClick={() => setOutput(report)}><span>{report.logo ? <img src={report.logo} alt="" /> : <span className="report-client-mark">{initials(report.clientName)}</span>}</span><span><b>{report.templateName}</b><small>{report.period} · {new Date(report.generatedAt).toLocaleString("en-IE", { dateStyle: "medium", timeStyle: "short" })}</small></span><span>Open report ↗</span></button>) : <p className="muted">No saved reports for this client yet.</p>}</section>}
    {local.length ? <div className="report-template-grid">{local.map((template) => <article className="report-template-card" key={template.id}><div className="report-template-heading"><span>📄</span><button className="text-button" onClick={() => setLocal((items) => items.filter((item) => item.id !== template.id))}>Remove</button></div><label className="field"><span>Template name</span><input value={template.name} onChange={(event) => update(template.id, "name", event.target.value)} /></label><label className="field"><span>Report type</span><select value={template.source} onChange={(event) => update(template.id, "source", event.target.value)}>{reportSources.map((item) => <option key={item}>{item}</option>)}</select></label><label className="field"><span>Report instructions</span><textarea rows={4} value={template.instructions} onChange={(event) => update(template.id, "instructions", event.target.value)} placeholder="What should the report explain?" /></label><label className="field"><span>Formulas & definitions</span><textarea rows={4} value={template.formulas} onChange={(event) => update(template.id, "formulas", event.target.value)} placeholder="e.g. CTR = clicks ÷ impressions × 100" /></label></article>)}</div> : <div className="empty-state slim"><div className="empty-icon">📈</div><h2>Start with a report template.</h2><p>Set report type, audience, instructions and formula definitions, then reuse the template across clients.</p><button className="primary-button" onClick={addTemplate}>＋ Create a report template</button></div>}
    <div className="report-save-row"><span>Template changes save to this private workspace.</span><button className="primary-button" onClick={() => onSave(local)}>Save templates</button></div></>;
}
function downloadText(filename: string, text: string) { const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" })); link.download = filename; link.click(); URL.revokeObjectURL(link.href); }

async function downloadLeadList(item: LeadList) {
  const { buildLeadCsv } = await import("@/lib/lead-export.mjs");
  const url = URL.createObjectURL(new Blob([buildLeadCsv(item.rows)], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${item.name.replace(/[^a-z0-9-_ ]/gi, "").trim() || "lead-list"}.csv`; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function downloadLeadListExcel(item: LeadList) {
  const { buildLeadXlsx } = await import("@/lib/lead-export.mjs");
  const bytes = buildLeadXlsx(item.rows);
  const fileBytes = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const url = URL.createObjectURL(new Blob([fileBytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${item.name.replace(/[^a-z0-9-_ ]/gi, "").trim() || "lead-list"}.xlsx`; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ProposalStudio({ workspace, onSaveFormula }: { workspace: Workspace; onSaveFormula: (formula: string) => Promise<boolean> }) {
  const [formula, setFormula] = useState(workspace.studioSettings?.designFormula || "");
  const [clientId, setClientId] = useState(""); const [kind, setKind] = useState("proposal"); const [brief, setBrief] = useState("");
  const [output, setOutput] = useState(""); const [image, setImage] = useState(""); const [creative, setCreative] = useState<any>(null); const [wpPreview, setWpPreview] = useState(""); const [wpDetails, setWpDetails] = useState<any>(null); const [copyMessage, setCopyMessage] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useAppErrorState("Proposal Studio");
  useEffect(() => setFormula(workspace.studioSettings?.designFormula || ""), [workspace.studioSettings?.designFormula]);
  const generate = async () => { setBusy(true); setError(""); setOutput(""); setImage(""); setCreative(null); setWpPreview(""); setWpDetails(null); setCopyMessage(""); try { if (!(await onSaveFormula(formula))) throw new Error("Could not save your design formula. Fix the workspace save error, then try again."); const response = await fetch("/api/studio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, clientId, brief }) }); const result = await response.json() as any; if (!response.ok) throw new Error(result.error || "Could not generate this design."); setOutput(result.text || ""); setImage(result.image || ""); setCreative(result.creative || null); if (kind === "wordpress-landing-page") { setWpPreview(result.preview || ""); setWpDetails({ title: result.pageTitle, slug: result.slug, metaDescription: result.metaDescription }); } } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not generate this design."); } finally { setBusy(false); } };
  const copyWordPressBlocks = async () => { try { await navigator.clipboard.writeText(output); setCopyMessage("Gutenberg blocks copied. Paste them into the WordPress editor."); } catch { setCopyMessage("Copy was blocked by the browser. Download the block file instead."); } };
  const selectedClient = workspace.clients.find((client) => client.id === clientId);
  return <><div className="page-heading"><div><p className="eyebrow">🎨 AI DESIGN WORKSPACE</p><h1>Proposal Studio</h1><p className="muted">Create proposals, landing pages and Meta poster concepts with your saved design formula.</p></div></div><section className="studio-panel"><label className="field"><span>Reusable design formula / brand rules</span><textarea rows={5} value={formula} onChange={(event) => setFormula(event.target.value)} placeholder="Add your layout formula, tone, brand rules, sections, colour palette and design preferences. Saved for future generations." /></label><div className="report-save-row"><span>Stored in this workspace until you change it.</span><button className="secondary-button" onClick={() => onSaveFormula(formula)}>Save design formula</button></div><div className="report-run-controls"><label className="field"><span>Client</span><select value={clientId} onChange={(event) => setClientId(event.target.value)}><option value="">Agency / choose a client</option>{workspace.clients.map((client) => <option value={client.id} key={client.id}>{client.name}</option>)}</select></label><label className="field"><span>Deliverable</span><select value={kind} onChange={(event) => setKind(event.target.value)}><option value="proposal">Proposal</option><option value="landing-page">HTML landing page</option><option value="wordpress-landing-page">WordPress landing page</option><option value="mobile-site">Mobile site</option><option value="meta-poster">Meta ad creative poster</option></select></label></div>{kind === "wordpress-landing-page" && <div className="wordpress-builder-note"><b>🧱 WordPress page builder</b><span>{selectedClient?.wordpressSiteUrl ? `Using ${selectedClient.wordpressSiteUrl} as client context.` : "Add the site's WordPress URL in the client profile for better context."} Creates editable Gutenberg core blocks. Copy them into the WordPress editor; direct publishing needs a site connection.</span></div>}<label className="field"><span>{kind === "wordpress-landing-page" ? "Page brief" : "Brief"}</span><textarea rows={4} value={brief} onChange={(event) => setBrief(event.target.value)} placeholder={kind === "wordpress-landing-page" ? "Describe the service, offer, ideal visitor, key proof, CTA and contact destination. Use only facts you can support." : "Tell the studio the goal, offer, audience, content and any required sections."} /></label><button className="primary-button" disabled={busy || !brief.trim() || (kind === "wordpress-landing-page" && !clientId)} onClick={generate}>{busy ? "Creating…" : kind === "wordpress-landing-page" ? "✨ Build WordPress page" : "✨ Create deliverable"}</button>{error && <p className="studio-error">{error}</p>}{creative && <article className="studio-output"><h3>{creative.headline}</h3><p>{creative.body}</p><p><b>CTA:</b> {creative.callToAction}</p>{image && <img className="studio-poster" src={image} alt={creative.altText || "Generated Meta ad poster"} />}<button className="secondary-button" onClick={() => downloadText("meta-poster.png.txt", JSON.stringify(creative, null, 2))}>Download creative copy</button>{image && <a className="secondary-button" href={image} download="f2b-meta-poster.png">Download poster</a>}</article>}{output && kind === "wordpress-landing-page" && <section className="studio-output wordpress-builder-output"><div className="wordpress-page-meta"><div><span>Page title</span><b>{wpDetails?.title}</b></div><div><span>Suggested URL slug</span><b>/{wpDetails?.slug}</b></div><div><span>SEO description</span><p>{wpDetails?.metaDescription}</p></div></div><div className="wordpress-builder-actions"><button className="primary-button" onClick={() => void copyWordPressBlocks()}>📋 Copy Gutenberg blocks</button><button className="secondary-button" onClick={() => downloadText(`${wpDetails?.slug || "wordpress-landing-page"}-blocks.txt`, output)}>⬇ Download blocks</button>{copyMessage && <small role="status">{copyMessage}</small>}</div><details className="wordpress-block-code"><summary>View WordPress blocks</summary><pre>{output}</pre></details><h3>Responsive preview</h3><p className="form-hint">Preview uses a neutral style. Your WordPress theme controls the final fonts and colours. Replace the sample CTA links with the client's contact form or booking link.</p><iframe title="WordPress landing page preview" sandbox="" srcDoc={wpPreview} className="studio-preview" /></section>}{output && kind !== "wordpress-landing-page" && <section className="studio-output"><div className="section-title"><h3>Preview</h3><button className="secondary-button" onClick={() => downloadText(kind === "proposal" ? "f2b-proposal.md" : "f2b-landing-page.html", output)}>{kind === "proposal" ? "Download proposal" : "Download HTML"}</button></div>{kind === "proposal" ? <pre>{output}</pre> : <iframe title="Generated page preview" sandbox="" srcDoc={output} className="studio-preview" />}</section>}</section></>;
}

function parseLeadCsv(input: string): LeadRow[] {
  const records: string[][] = []; let row: string[] = []; let cell = ""; let quoted = false;
  for (let index = 0; index < input.length; index++) { const char = input[index]; if (char === '"') { if (quoted && input[index + 1] === '"') { cell += '"'; index++; } else quoted = !quoted; } else if (char === "," && !quoted) { row.push(cell); cell = ""; } else if ((char === "\n" || char === "\r") && !quoted) { if (char === "\r" && input[index + 1] === "\n") index++; row.push(cell); if (row.some((value) => value.trim())) records.push(row); row = []; cell = ""; } else cell += char; }
  row.push(cell); if (row.some((value) => value.trim())) records.push(row);
  if (records.length < 2) return [];
  const headers = records[0].map((header, index) => header.trim() || `Column ${index + 1}`);
  return records.slice(1).map((values, index) => ({ sourceRow: index + 2, values: Object.fromEntries(headers.map((header, column) => [header, values[column] || ""])) }));
}

function flattenOutscraperPlaces(data: unknown): Record<string, unknown>[] {
  const places: Record<string, unknown>[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      if (record.name || record.business_name || record.place_id || record.google_id) places.push(record);
      else if (record.data) visit(record.data);
    }
  };
  visit(data);
  const unique = new Map<string, Record<string, unknown>>();
  for (const place of places) {
    const website = String(place.site || place.website || place.domain || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0];
    const phone = String(place.phone || place.phone_number || "").replace(/\D/g, "");
    const name = String(place.name || place.business_name || "").trim().toLowerCase();
    const address = String(place.full_address || place.address || "").trim().toLowerCase();
    const key = String(place.place_id || place.google_id || place.feature_id || "").trim() || website || phone || `${name}|${address}`;
    if (key && !unique.has(key)) unique.set(key, place);
  }
  return [...unique.values()];
}

function outscraperPlaceValues(place: Record<string, unknown>): Record<string, string> {
  const value = (...keys: string[]) => {
    for (const key of keys) { const item = place[key]; if (item !== undefined && item !== null && String(item).trim()) return Array.isArray(item) ? item.join("; ") : String(item); }
    return "";
  };
  return {
    "Business name": value("name", "business_name"),
    "Phone": value("phone", "phone_number"),
    "Website": value("site", "website", "domain"),
    "Address": value("full_address", "address"),
    "City": value("city"),
    "Region": value("state", "region", "county"),
    "Postcode": value("postal_code", "postcode", "zip"),
    "Country": value("country"),
    "Category": value("category", "type", "subtypes"),
    "Rating": value("rating"),
    "Review count": value("reviews", "reviews_count"),
    "Google Maps URL": value("google_maps_url", "link", "maps_url"),
    "Google Place ID": value("place_id", "google_id", "feature_id"),
    "Outscraper search query": value("query"),
  };
}

function LeadWorkflow({ onOpenEnrichment }: { onOpenEnrichment: (listId?: string) => void }) {
  return <div className="lead-workflow" aria-label="Lead workflow">
    <a className="lead-workflow-step" href="#lead-maps-title">
      <span className="lead-workflow-number">01</span><span className="lead-workflow-copy"><b>Find leads</b><small>AI searches Outscraper from your ICP</small></span><span className="lead-workflow-graph" aria-hidden="true"><i /><i /><i /><i /></span>
    </a>
    <div className="lead-workflow-step current" aria-current="step">
      <span className="lead-workflow-number">02</span><span className="lead-workflow-copy"><b>AI qualifies</b><small>Matches are checked and saved</small></span><span className="lead-workflow-graph" aria-hidden="true"><i /><i /><i /><i /></span>
    </div>
    <button className="lead-workflow-step" type="button" onClick={() => onOpenEnrichment()}>
      <span className="lead-workflow-number">03</span><span className="lead-workflow-copy"><b>Enrich contacts</b><small>Open the Enrichment tab</small></span><img className="lead-workflow-icon" src="/enrichment-center-icon.svg" alt="" />
    </button>
  </div>;
}

type LeadStudioTab = { id: string; label: string; icon: string; count?: number };
const leadIndustryIcons = [
  { icon: "🎯", label: "Target", words: "general other business goal focus" }, { icon: "🏢", label: "Office", words: "business office company building" },
  { icon: "🏠", label: "Home", words: "home house property roofing" }, { icon: "🏗️", label: "Construction", words: "construction builder site" },
  { icon: "🧰", label: "Toolbox", words: "tools repair maintenance trade" }, { icon: "🛠️", label: "Tools", words: "tool workshop repair" },
  { icon: "🔧", label: "Wrench", words: "plumbing mechanic heating engineer" }, { icon: "🔨", label: "Hammer", words: "builder carpenter construction" },
  { icon: "⚙️", label: "Settings", words: "engineering machinery mechanical" }, { icon: "🪛", label: "Screwdriver", words: "electrician fitting repair" },
  { icon: "🔥", label: "Heating", words: "hvac boiler furnace gas heating" }, { icon: "❄️", label: "Cooling", words: "hvac air conditioning aircon cooling cold" },
  { icon: "🌬️", label: "Ventilation", words: "hvac ventilation airflow extractor" }, { icon: "🌡️", label: "Thermostat", words: "hvac temperature climate control" },
  { icon: "💧", label: "Water", words: "plumbing water leak drainage" }, { icon: "🚿", label: "Shower", words: "bathroom plumbing shower" },
  { icon: "⚡", label: "Power", words: "electrical electrician energy" }, { icon: "🔌", label: "Plug", words: "electricity electrical socket" },
  { icon: "🧱", label: "Bricks", words: "builder brick masonry wall" }, { icon: "🪚", label: "Carpentry", words: "carpenter wood joinery saw" },
  { icon: "🚗", label: "Car", words: "automotive garage mechanic vehicle" }, { icon: "🚚", label: "Delivery", words: "delivery transport logistics" },
  { icon: "🌳", label: "Garden", words: "garden landscaping trees grounds" }, { icon: "🧹", label: "Cleaning", words: "cleaning cleaner tidy" },
  { icon: "🦷", label: "Dental", words: "dentist clinic orthodontist" }, { icon: "🍽️", label: "Food", words: "restaurant cafe food hospitality" },
  { icon: "💇", label: "Hair", words: "beauty salon hair barber" }, { icon: "🏋️", label: "Fitness", words: "fitness gym personal trainer" },
  { icon: "🐾", label: "Pets", words: "vet veterinary animal pet" }, { icon: "📚", label: "Learning", words: "education school tutor training" },
  { icon: "⚖️", label: "Balance", words: "lawyer solicitor legal law" }, { icon: "💻", label: "Computer", words: "technology software IT computer" },
  { icon: "📱", label: "Mobile", words: "phone app mobile technology" }, { icon: "📈", label: "Growth", words: "growth results chart analytics" },
  { icon: "💰", label: "Money", words: "finance accounting money sales revenue" }, { icon: "🧮", label: "Calculator", words: "accounting numbers calculator" },
  { icon: "📣", label: "Marketing", words: "marketing advertising promotion" }, { icon: "✉️", label: "Email", words: "email message communication" },
  { icon: "📞", label: "Phone", words: "call contact telephone sales" }, { icon: "🤝", label: "Partnership", words: "partnership clients relationship" },
  { icon: "⭐", label: "Star", words: "favorite featured quality" }, { icon: "🚀", label: "Launch", words: "launch startup progress" },
  { icon: "✅", label: "Done", words: "complete success verified" }, { icon: "🛡️", label: "Shield", words: "security safety protection" },
  { icon: "🔑", label: "Key", words: "access key security" }, { icon: "📦", label: "Package", words: "wholesale supplier distributor stock" },
  { icon: "🗺️", label: "Map", words: "location travel area" }, { icon: "📅", label: "Calendar", words: "date schedule appointment" },
];
function LeadStudioTabs({ tabs, active, onChange, label }: { tabs: LeadStudioTab[]; active: string; onChange: (id: string) => void; label: string }) {
  return <nav className="lead-studio-tabs" aria-label={label} role="tablist">{tabs.map((tab) => <button key={tab.id} type="button" role="tab" aria-selected={active === tab.id} className={active === tab.id ? "active" : ""} onClick={() => onChange(tab.id)}><span aria-hidden="true">{tab.icon}</span>{tab.label}{tab.count !== undefined && <b>{tab.count}</b>}</button>)}</nav>;
}

function leadResultField(row: LeadRow, aliases: string[]) {
  const normalizeKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const alias of aliases) {
    const match = Object.entries(row.values || {}).find(([key, value]) => normalizeKey(key) === normalizeKey(alias) && String(value || "").trim());
    if (match) return match[1];
  }
  return "";
}

function leadProfileSearchAreas(profile: LeadProfile) {
  const country = String(profile.country || "").trim();
  const structured = [...(profile.regions || []), ...(profile.cities || [])]
    .map((place) => [place.trim(), country].filter(Boolean).join(", "))
    .filter(Boolean);
  const legacy = String(profile.areas || "").split(/[\r\n;,]+/).map((area) => area.trim()).filter(Boolean);
  return [...new Set([...structured, ...legacy])];
}

function EnrichmentCenter({ lists, initialListId, onSave }: { lists: LeadList[]; initialListId?: string; onSave: (lists: LeadList[]) => Promise<boolean> }) {
  const [selectedListId, setSelectedListId] = useState(initialListId || lists[0]?.id || "");
  const [activeSection, setActiveSection] = useState(initialListId ? "enrich" : "import");
  const [error, setError] = useAppErrorState("Lead Factory · Enrichment"); const [savedMessage, setSavedMessage] = useState("");
  const [personalisingRow, setPersonalisingRow] = useState<number | null>(null);
  const [outscraperConfigured, setOutscraperConfigured] = useState(false); const [enriching, setEnriching] = useState(false); const [enrichProgress, setEnrichProgress] = useState(""); const [contactsPerCompany, setContactsPerCompany] = useState(3);
  useEffect(() => { void fetch("/api/outscraper", { cache: "no-store" }).then(async (response) => { if (!response.ok) throw new Error("Could not check the Outscraper connection."); return response.json() as Promise<{ configured?: boolean }>; }).then((status) => setOutscraperConfigured(Boolean(status.configured))).catch((reason) => { setOutscraperConfigured(false); publishAppError(reason instanceof Error ? reason.message : "Could not check the Outscraper connection.", "Lead Factory · Enrichment"); }); }, []);
  useEffect(() => { if (!lists.some((list) => list.id === selectedListId)) setSelectedListId(lists[0]?.id || ""); }, [lists, selectedListId]);
  useEffect(() => { if (initialListId && lists.some((list) => list.id === initialListId)) setSelectedListId(initialListId); }, [initialListId, lists]);
  const selected = lists.find((list) => list.id === selectedListId);
  useEffect(() => { if (initialListId && lists.some((list) => list.id === initialListId)) { setSelectedListId(initialListId); setActiveSection("enrich"); } }, [initialListId, lists]);
  const websites = (selected?.rows || []).filter((row) => row.keep !== false).map((row) => {
    const entry = Object.entries(row.values).find(([key, value]) => /website|domain|site|url/i.test(key) && value.trim());
    if (!entry) return "";
    try { return new URL(/^https?:\/\//i.test(entry[1].trim()) ? entry[1].trim() : `https://${entry[1].trim()}`).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
  });
  const uniqueWebsites = [...new Set(websites.filter(Boolean))];
  const importEnrichedCsv = async (file?: File) => {
    if (!file) return;
    setError(""); setSavedMessage("");
    try {
      const rows = /\.xlsx$/i.test(file.name) ? (await import("@/lib/lead-export.mjs")).parseLeadXlsx(await file.arrayBuffer()) : parseLeadCsv(await file.text());
      if (!rows.length) { setError("This file needs a header row and at least one lead."); return; }
      const name = `${selected?.name || file.name.replace(/\.(csv|xlsx)$/i, "")} · imported`;
      const enriched: LeadList = { id: uid(), name, profileId: selected?.profileId || "", createdAt: new Date().toISOString(), rows };
      const next = [enriched, ...lists];
      if (!(await onSave(next))) { setError("The enriched list could not be saved to the workspace."); return; }
      setSelectedListId(enriched.id); setSavedMessage(`${rows.length} enriched rows saved as “${name}”.`);
    } catch { setError("Could not read this file. Use a UTF-8 CSV or an Excel workbook with a header row on its first sheet."); }
  };
  const enrichWithOutscraper = async () => {
    if (!selected || !uniqueWebsites.length || !outscraperConfigured || enriching) return;
    const approved = window.confirm(`Send ${uniqueWebsites.length} unique website domains and available Google Maps places from “${selected.name}” to Outscraper? This looks up contacts and up to 10 recent review replies per place, then the separate Enrichment AI checks public websites for useful facts. Outscraper usage may consume credits.`);
    if (!approved) return;
    setEnriching(true); setError(""); setSavedMessage(""); setEnrichProgress("Preparing domains…");
    const results: Record<string, any>[] = [];
    const pause = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
    try {
      const batches: string[][] = [];
      for (let index = 0; index < uniqueWebsites.length; index += 1000) batches.push(uniqueWebsites.slice(index, index + 1000));
      for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
        setEnrichProgress(`Submitting batch ${batchIndex + 1} of ${batches.length}…`);
        const submittedResponse = await fetch("/api/outscraper", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ domains: batches[batchIndex], contactsPerCompany }) });
        const submitted = await submittedResponse.json() as { error?: string; requestId?: string; status?: string; data?: unknown };
        if (!submittedResponse.ok) throw new Error(submitted.error || "Outscraper could not accept this batch.");
        let batchResults = Array.isArray(submitted.data) ? submitted.data.flat(Infinity) as Record<string, any>[] : [];
        if (submitted.requestId) {
          let complete = false;
          for (let attempt = 0; attempt < 120; attempt += 1) {
            setEnrichProgress(`Outscraper is finding contacts · batch ${batchIndex + 1}/${batches.length} · check ${attempt + 1}/120`);
            await pause(10000);
            const resultResponse = await fetch(`/api/outscraper?requestId=${encodeURIComponent(submitted.requestId)}`, { cache: "no-store" });
            const result = await resultResponse.json() as { error?: string; status?: string; data?: unknown };
            if (!resultResponse.ok) throw new Error(result.error || "Could not retrieve the Outscraper results.");
            if (result.status === "Failure") throw new Error("Outscraper reported that this enrichment batch failed.");
            if (result.status === "Success" || Array.isArray(result.data) && result.data.length > 0) {
              batchResults = Array.isArray(result.data) ? result.data.flat(Infinity) as Record<string, any>[] : [];
              complete = true; break;
            }
          }
          if (!complete) throw new Error("Outscraper is still processing this batch. Results are available in your Outscraper account; try again later or import its CSV here.");
        }
        results.push(...batchResults.filter((result) => result && typeof result === "object"));
      }

      const reviewQueryByRow = new Map<number, string>();
      for (const row of selected.rows) {
        if (row.keep === false) continue;
        const placeId = leadResultField(row, ["google_id", "Google ID", "place_id", "Place ID", "CID"]);
        const name = leadResultField(row, ["Company name", "Company", "Business name", "Name"]);
        const address = leadResultField(row, ["Full address", "Address", "Street address"]);
        const query = placeId || (name && address ? `${name}, ${address}` : "");
        if (query) reviewQueryByRow.set(row.sourceRow, query);
      }
      const reviewQueries = [...new Set(reviewQueryByRow.values())];
      const reviewResults: Record<string, any>[] = [];
      const reviewBatches: string[][] = [];
      for (let index = 0; index < reviewQueries.length; index += 1000) reviewBatches.push(reviewQueries.slice(index, index + 1000));
      for (let batchIndex = 0; batchIndex < reviewBatches.length; batchIndex += 1) {
        setEnrichProgress(`Checking recent owner replies · batch ${batchIndex + 1}/${reviewBatches.length}…`);
        const response = await fetch("/api/outscraper", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "maps-reviews", queries: reviewBatches[batchIndex] }) });
        const submitted = await response.json() as { error?: string; requestId?: string; status?: string; data?: unknown };
        if (!response.ok) throw new Error(submitted.error || "Outscraper could not start the review lookup.");
        let batchResults = Array.isArray(submitted.data) ? submitted.data.flat(Infinity) as Record<string, any>[] : [];
        if (submitted.requestId) {
          let complete = false;
          for (let attempt = 0; attempt < 120; attempt += 1) {
            setEnrichProgress(`Outscraper is checking review replies · batch ${batchIndex + 1}/${reviewBatches.length} · check ${attempt + 1}/120`);
            await pause(10000);
            const resultResponse = await fetch(`/api/outscraper?requestId=${encodeURIComponent(submitted.requestId)}`, { cache: "no-store" });
            const result = await resultResponse.json() as { error?: string; status?: string; data?: unknown };
            if (!resultResponse.ok) throw new Error(result.error || "Could not retrieve Outscraper review results.");
            if (result.status === "Failure") throw new Error("Outscraper reported that this review lookup failed.");
            if (result.status === "Success" || Array.isArray(result.data) && result.data.length > 0) { batchResults = Array.isArray(result.data) ? result.data.flat(Infinity) as Record<string, any>[] : []; complete = true; break; }
          }
          if (!complete) throw new Error("Outscraper is still processing review replies. Try enrichment again later; the source list has not been changed.");
        }
        reviewResults.push(...batchResults.filter((result) => result && typeof result === "object"));
      }
      const normalizedPlace = (value: unknown) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const reviewsById = new Map<string, Record<string, any>>();
      const reviewsByName = new Map<string, Record<string, any>>();
      for (const result of reviewResults) {
        for (const id of [result.google_id, result.place_id, result.cid]) if (id) reviewsById.set(normalizedPlace(id), result);
        if (result.name) reviewsByName.set(normalizedPlace(result.name), result);
      }

      const byDomain = new Map<string, Record<string, any>>();
      for (const result of results) {
        const rawDomain = String(result.domain || result.query || "");
        try { byDomain.set(new URL(/^https?:\/\//i.test(rawDomain) ? rawDomain : `https://${rawDomain}`).hostname.toLowerCase().replace(/^www\./, ""), result); } catch { /* Ignore rows without a matchable website. */ }
      }
      const joined = selected.rows.map((row) => {
        if (row.keep === false) return row;
        const website = Object.entries(row.values).find(([key, value]) => /website|domain|site|url/i.test(key) && value.trim())?.[1] || "";
        let domain = "";
        try { domain = new URL(/^https?:\/\//i.test(website.trim()) ? website.trim() : `https://${website.trim()}`).hostname.toLowerCase().replace(/^www\./, ""); } catch { /* A blank domain is shown as not found below. */ }
        const result = byDomain.get(domain);
        const reviewQuery = reviewQueryByRow.get(row.sourceRow) || "";
        const name = leadResultField(row, ["Company name", "Company", "Business name", "Name"]);
        const placeReview = reviewsById.get(normalizedPlace(reviewQuery)) || reviewsByName.get(normalizedPlace(name));
        const ownerReplies = [...new Set((placeReview?.reviews_data || []).map((review: any) => String(review?.owner_answer || "").trim()).filter(Boolean))].slice(0, 5).join("\n");
        const emails = [...(result?.emails || []), ...(result?.contacts || []).flatMap((contact: any) => contact.emails || [])].map((item: any) => typeof item === "string" ? item : item?.value).filter(Boolean);
        const phones = (result?.phones || []).map((item: any) => typeof item === "string" ? item : item?.value).filter(Boolean);
        const contacts = (result?.contacts || []).map((contact: any) => [contact.full_name, contact.title].filter(Boolean).join(" — ")).filter(Boolean);
        const socials = Object.entries(result?.socials || {}).map(([network, url]) => `${network}: ${url}`).join(" · ");
        return { ...row, values: { ...row.values, "Outscraper emails": [...new Set(emails)].join("; "), "Outscraper phones": [...new Set(phones)].join("; "), "Outscraper contacts": [...new Set(contacts)].join("; "), "Outscraper socials": socials, "Outscraper owner replies": ownerReplies, "Outscraper result": result ? "Checked" : domain ? "No match returned" : "No website" } };
      });
      const aiReady = joined.filter((row) => row.keep !== false && (leadResultField(row, ["Website", "Website URL", "Domain", "URL"]) || leadResultField(row, ["Outscraper owner replies"])));
      for (let offset = 0; offset < aiReady.length; offset += 3) {
        const batch = aiReady.slice(offset, offset + 3);
        setEnrichProgress(`Enrichment AI is checking website facts · ${Math.min(offset + batch.length, aiReady.length)}/${aiReady.length}`);
        const personalized = await Promise.all(batch.map(async (row) => {
          const website = leadResultField(row, ["Website", "Website URL", "Domain", "URL"]);
          const reviewEvidence = leadResultField(row, ["Outscraper owner replies"]);
          try {
            const response = await fetch("/api/studio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "lead-personal-line", website, reviewEvidence }) });
            const result = await response.json() as { line?: string; evidence?: string; sourceUrl?: string; ownerName?: string; ownerEvidence?: string; status?: string };
            if (!response.ok || result.status !== "supported") return row;
            return { ...row, values: { ...row.values, ...(result.line ? { "Personal line": result.line, "Personal line source": result.sourceUrl || website, "Personal line evidence": result.evidence || "" } : {}), ...(result.ownerName ? { "Owner name": result.ownerName, "Owner name evidence": result.ownerEvidence || "" } : {}) } };
          } catch { return row; }
        }));
        for (const enrichedRow of personalized) {
          const index = joined.findIndex((row) => row.sourceRow === enrichedRow.sourceRow);
          if (index >= 0) joined[index] = enrichedRow;
        }
      }
      const enriched: LeadList = { id: uid(), name: `${selected.name} · Outscraper enriched`, profileId: selected.profileId, createdAt: new Date().toISOString(), rows: joined };
      if (!(await onSave([enriched, ...lists]))) throw new Error("Outscraper finished, but the enriched copy could not be saved. The original list is unchanged.");
      setSelectedListId(enriched.id); setSavedMessage(`Outscraper enrichment saved as “${enriched.name}”. ${results.length} result records received; the original list was kept.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Outscraper enrichment failed.");
    } finally { setEnriching(false); setEnrichProgress(""); }
  };
  const exportList = async (list: LeadList, format: "csv" | "xlsx") => {
    if (format === "csv") await downloadLeadList(list); else await downloadLeadListExcel(list);
    const next = lists.map((item) => item.id === list.id ? { ...item, exports: [...(item.exports || []), { format, createdAt: new Date().toISOString() }] } : item);
    if (!(await onSave(next))) setError("The file downloaded, but its export history could not be saved.");
  };
  const generatePersonalLine = async (row: LeadRow) => {
    const website = leadResultField(row, ["Website", "Website URL", "Domain", "URL"]);
    if (!selected || (!website && !leadResultField(row, ["Outscraper owner replies"])) || personalisingRow !== null) return;
    setPersonalisingRow(row.sourceRow); setError(""); setSavedMessage("");
    try {
      const response = await fetch("/api/studio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "lead-personal-line", website, reviewEvidence: leadResultField(row, ["Outscraper owner replies"]) }) });
      const result = await response.json() as { error?: string; line?: string; evidence?: string; sourceUrl?: string; ownerName?: string; ownerEvidence?: string; status?: string };
      if (!response.ok) throw new Error(result.error || "Could not create a supported personal line.");
      if ((!result.line && !result.ownerName) || result.status !== "supported") { setSavedMessage("No specific website fact or signed owner reply supported a useful enrichment. Nothing was added."); return; }
      const updatedRows = selected.rows.map((item) => item.sourceRow === row.sourceRow ? { ...item, values: { ...item.values, ...(result.line ? { "Personal line": result.line, "Personal line source": result.sourceUrl || website, "Personal line evidence": result.evidence || "" } : {}), ...(result.ownerName ? { "Owner name": result.ownerName, "Owner name evidence": result.ownerEvidence || "" } : {}) } } : item);
      const next = lists.map((item) => item.id === selected.id ? { ...item, rows: updatedRows } : item);
      if (!(await onSave(next))) throw new Error("The personal line was generated but could not be saved to the workspace.");
      setSavedMessage("Evidence-based personal line saved to this lead.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not create a supported personal line."); }
    finally { setPersonalisingRow(null); }
  };
  const tabs: LeadStudioTab[] = [
    { id: "import", label: "Import leads", icon: "📥", count: lists.length },
    { id: "enrich", label: "Enrich leads", icon: "✨" },
    { id: "results", label: "Enriched results", icon: "📊", count: selected?.rows.length || 0 },
    { id: "history", label: "Export history", icon: "📁", count: lists.reduce((n, list) => n + (list.exports?.length || 0), 0) },
  ];
  return <><div className="page-heading lead-module-heading"><div><p className="eyebrow enrichment-center-eyebrow"><img src="/enrichment-center-icon.svg" alt="" /> LEAD FACTORY</p><h1>Enrichment</h1><p className="muted">Use the separate Enrichment AI with Outscraper to find public contacts and evidence-backed personal details for your saved lists.</p></div></div>
    <LeadStudioTabs label="Enrichment" tabs={tabs} active={activeSection} onChange={setActiveSection} />
    {activeSection === "import" && <section className="studio-panel lead-studio-panel"><div className="lead-section-heading"><div><h2>📥 Import leads</h2><p>Choose a Lead Factory list or add a CSV / Excel file. Your original list stays unchanged.</p></div><span className="lead-result-count">{lists.length} saved {lists.length === 1 ? "list" : "lists"}</span></div>
      {lists.length > 0 ? <><label className="field"><span>Saved list</span><select value={selectedListId} onChange={(event) => setSelectedListId(event.target.value)}>{lists.map((list) => <option key={list.id} value={list.id}>{list.name} · {list.rows.length} rows</option>)}</select></label><div className="lead-saved-list-grid">{lists.map((list) => <button type="button" className={`lead-saved-list-card ${list.id === selectedListId ? "selected" : ""}`} key={list.id} onClick={() => setSelectedListId(list.id)}><b>{list.name}</b><span>{list.rows.length} rows · {new Date(list.createdAt).toLocaleDateString()}</span><small>{list.rows.filter((row) => row.keep !== false).length} available to enrich</small></button>)}</div></> : <div className="lead-inline-empty"><b>No saved lists yet</b><span>Save a qualified list in Lead Factory, or import a CSV / Excel file below.</span></div>}
      <label className="lead-upload-zone lead-enrichment-upload"><input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; void importEnrichedCsv(file); }} /><span className="lead-upload-icon">＋</span><b>Import CSV or Excel</b><small>Excel import reads the first worksheet. Source columns and row order are preserved.</small><span className="lead-upload-action">Browse files</span></label>
    </section>}
    {activeSection === "enrich" && <section className="studio-panel lead-studio-panel"><div className="lead-section-heading"><div><h2>✨ Enrich leads</h2><p>Find publicly available business contacts for qualified companies with websites.</p></div><span className={`lead-maps-connection ${outscraperConfigured ? "connected" : ""}`}>{outscraperConfigured ? "Outscraper connected" : "Connection needed"}</span></div>
      {lists.length ? <><label className="field"><span>List to enrich</span><select value={selectedListId} onChange={(event) => setSelectedListId(event.target.value)}>{lists.map((list) => <option key={list.id} value={list.id}>{list.name} · {list.rows.length} rows</option>)}</select></label><div className="lead-enrichment-actions"><label className="field lead-contact-count"><span>Contacts per company</span><select value={contactsPerCompany} onChange={(event) => setContactsPerCompany(Number(event.target.value))}><option value={1}>1 contact</option><option value={3}>3 contacts</option><option value={5}>5 contacts</option><option value={10}>10 contacts</option></select></label><div className="lead-enrichment-count"><b>{selected?.rows.filter((row) => row.keep !== false).length || 0}</b> businesses · <b>{uniqueWebsites.length}</b> websites ready</div><button type="button" className="primary-button outscraper-enrich-button" disabled={!outscraperConfigured || !uniqueWebsites.length || enriching} onClick={() => void enrichWithOutscraper()}>{enriching ? `⏳ ${enrichProgress || "Enriching…"}` : "✨ Enrich this list"}</button></div>
        {!outscraperConfigured && <p className="form-hint">Outscraper needs to be connected by an administrator before a live enrichment can run. Its key stays server-side.</p>}{outscraperConfigured && <p className="form-hint">This may use Outscraper credits. Results are saved as a new list; the selected source list is preserved.</p>}{enriching && <p className="lead-enrichment-progress" role="status">{enrichProgress}</p>}
      </> : <div className="lead-inline-empty"><b>Add a lead list first</b><span>Import a CSV / Excel file or save a qualified list in Lead Factory.</span><button className="secondary-button" onClick={() => setActiveSection("import")}>Go to import</button></div>}
    </section>}
    {activeSection === "results" && <section className="studio-panel lead-studio-panel"><div className="lead-section-heading"><div><h2>📊 Enriched results</h2><p>Review available contact details, then export the list.</p></div>{selected && <div className="lead-enrichment-actions"><button className="secondary-button" disabled={!selected.rows.length} onClick={() => void exportList(selected, "csv")}>⬇ CSV</button><button className="secondary-button" disabled={!selected.rows.length} onClick={() => void exportList(selected, "xlsx")}>⬇ Excel</button></div>}</div>
      {lists.length ? <><label className="field"><span>List</span><select value={selectedListId} onChange={(event) => setSelectedListId(event.target.value)}>{lists.map((list) => <option key={list.id} value={list.id}>{list.name} · {list.rows.length} rows</option>)}</select></label>{selected?.rows.length ? <div className="lead-results lead-enriched-table"><table><thead><tr><th>Company</th><th>Email</th><th>Phone</th><th>Website</th><th>Public contacts</th><th>Verified owner name</th><th>Personal line</th></tr></thead><tbody>{selected.rows.map((row) => <tr key={row.sourceRow}><td>{leadResultField(row, ["Company name", "Company", "Business name", "Name"]) || "—"}</td><td>{leadResultField(row, ["Outscraper emails", "Email", "Emails"]) || "—"}</td><td>{leadResultField(row, ["Outscraper phones", "Mobile", "Phone", "Phones"]) || "—"}</td><td>{leadResultField(row, ["Website", "Domain", "URL"]) || "—"}</td><td>{leadResultField(row, ["Outscraper contacts", "Owner name", "Contact name"]) || "—"}</td><td>{leadResultField(row, ["Owner name"]) || "—"}{leadResultField(row, ["Owner name evidence"]) && <small>Review reply: “{leadResultField(row, ["Owner name evidence"])}”</small>}</td><td className="lead-personal-line-cell">{leadResultField(row, ["Personal line"]) || <span className="lead-no-evidence">No supported fact</span>}{leadResultField(row, ["Personal line evidence"]) && <small>Evidence: “{leadResultField(row, ["Personal line evidence"])}”</small>}{leadResultField(row, ["Outscraper owner replies"]) && <small>Owner reply: “{leadResultField(row, ["Outscraper owner replies"])}”</small>}<button type="button" className="text-button" disabled={(!leadResultField(row, ["Website", "Website URL", "Domain", "URL"]) && !leadResultField(row, ["Outscraper owner replies"])) || personalisingRow !== null} onClick={() => void generatePersonalLine(row)}>{personalisingRow === row.sourceRow ? "Reading website…" : leadResultField(row, ["Personal line"]) || leadResultField(row, ["Owner name"]) ? "Regenerate" : "Check evidence"}</button></td></tr>)}</tbody></table></div> : <div className="lead-inline-empty"><b>This list has no rows</b></div>}</> : <div className="lead-inline-empty"><b>No enriched results yet</b><span>Import a list or run enrichment to see results here.</span><button className="secondary-button" onClick={() => setActiveSection("import")}>Import leads</button></div>}
    </section>}
    {activeSection === "history" && <section className="studio-panel lead-studio-panel"><div className="lead-section-heading"><div><h2>📁 Export history</h2><p>Files downloaded from Enrichment are recorded here.</p></div></div>{lists.some((list) => list.exports?.length) ? <div className="lead-export-history">{lists.flatMap((list) => (list.exports || []).map((entry, index) => ({ ...entry, list, id: `${list.id}-${entry.createdAt}-${index}` }))).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((entry) => <article key={entry.id}><span className="lead-export-format">{entry.format === "xlsx" ? "XLSX" : "CSV"}</span><div><b>{entry.list.name}</b><small>{new Date(entry.createdAt).toLocaleString()}</small></div><button className="secondary-button" onClick={() => void exportList(entry.list, entry.format)}>Download again</button></article>)}</div> : <div className="lead-inline-empty"><b>No exports yet</b><span>Download a CSV or Excel file from Enriched Results. It will appear here.</span><button className="secondary-button" disabled={!lists.length} onClick={() => setActiveSection("results")}>View results</button></div>}</section>}
    {error && <p className="studio-error">{error}</p>}{savedMessage && <p className="lead-enrichment-success">✅ {savedMessage}</p>}
  </>;
}

function LeadFactoryWorkspace({ profiles, lists, onSave }: { profiles: LeadProfile[]; lists: LeadList[]; onSave: (profiles: LeadProfile[], lists: LeadList[]) => Promise<boolean> }) {
  const [section, setSection] = useState<"factory" | "enrichment">("factory");
  const [focusedListId, setFocusedListId] = useState("");
  const tabs: LeadStudioTab[] = [
    { id: "factory", label: "Lead Factory", icon: "🎯" },
    { id: "enrichment", label: "Enrichment", icon: "✨" },
  ];
  return <>
    <LeadStudioTabs label="Lead Factory workspace" tabs={tabs} active={section} onChange={(next) => setSection(next as "factory" | "enrichment")} />
    <div hidden={section !== "factory"}>
      <LeadFactory profiles={profiles} lists={lists} onSave={onSave} onOpenEnrichment={(listId) => { setFocusedListId(listId || ""); setSection("enrichment"); }} />
    </div>
    <div hidden={section !== "enrichment"}>
      <EnrichmentCenter lists={lists} initialListId={focusedListId} onSave={(nextLists) => onSave(profiles, nextLists)} />
    </div>
  </>;
}

function LeadFactoryAnimatedIcon() {
  return <span className="lead-factory-animated-icon" role="img" aria-label="Lead Factory running">
    <img src="/lead-factory-icon.png" alt="" />
    <span className="lead-factory-smoke lead-factory-smoke-one" />
    <span className="lead-factory-smoke lead-factory-smoke-two" />
    <span className="lead-factory-belt-motion" />
    <span className="lead-factory-token-cover lead-factory-token-cover-one" aria-hidden="true" />
    <span className="lead-factory-token-cover lead-factory-token-cover-two" aria-hidden="true" />
    <span className="lead-factory-token-cover lead-factory-token-cover-three" aria-hidden="true" />
    <span className="lead-factory-token lead-factory-token-one" aria-hidden="true" />
    <span className="lead-factory-token lead-factory-token-two" aria-hidden="true" />
    <span className="lead-factory-token lead-factory-token-three" aria-hidden="true" />
  </span>;
}

function LeadFactory({ profiles, lists, onSave, onOpenEnrichment }: { profiles: LeadProfile[]; lists: LeadList[]; onSave: (profiles: LeadProfile[], lists: LeadList[]) => Promise<boolean>; onOpenEnrichment: (listId?: string) => void }) {
  const [localProfiles, setLocalProfiles] = useState(profiles); const [localLists, setLocalLists] = useState(lists);
  const visibleProfiles = localProfiles.filter((item) => !(item.name.trim().toLowerCase() === "new icp" && !item.niche.trim() && !item.icp.trim() && !item.exclude.trim() && !leadProfileSearchAreas(item).length));
  const usableProfiles = localProfiles.filter((item) => item.niche.trim() && item.icp.trim());
  const [activeSection, setActiveSection] = useState("find");
  const [profileId, setProfileId] = useState(""); const [profile, setProfile] = useState<LeadProfile>({ id: "", name: "New ICP", niche: "", icp: "", exclude: "", areas: "", icon: "🎯", iconColor: "#328de0" });
  const [iconSearch, setIconSearch] = useState(""); const [icpAiPrompt, setIcpAiPrompt] = useState(""); const [icpAiBusy, setIcpAiBusy] = useState(false);
  const [queue, setQueue] = useState<LeadQueueItem[]>([]); const [busy, setBusy] = useState(false); const [savingLists, setSavingLists] = useState(false); const [error, setError] = useAppErrorState("Lead Factory");
  const [outscraperConfigured, setOutscraperConfigured] = useState(false); const [mapsBusy, setMapsBusy] = useState(false); const [mapsProgress, setMapsProgress] = useState(""); const [mapsLimit, setMapsLimit] = useState<number | "all">("all"); const mapsLimitValue = mapsLimit === "all" ? 500 : mapsLimit; const [mapsOnlyWebsite, setMapsOnlyWebsite] = useState(false); const [recheckingListId, setRecheckingListId] = useState(""); const [savedListStatus, setSavedListStatus] = useState("");
  const [mapsReview, setMapsReview] = useState<OutscraperSearchReview | null>(null);
  useEffect(() => { void fetch("/api/outscraper", { cache: "no-store" }).then(async (response) => { if (!response.ok) throw new Error("Could not check the Outscraper connection."); return response.json() as Promise<{ configured?: boolean }>; }).then((status) => setOutscraperConfigured(Boolean(status.configured))).catch((reason) => publishAppError(reason instanceof Error ? reason.message : "Could not check the Outscraper connection.", "Lead Factory")); }, []);
  useEffect(() => { setLocalProfiles(profiles); setLocalLists(lists); }, [profiles, lists]);
  useEffect(() => { const found = localProfiles.find((item) => item.id === profileId); if (found) setProfile(found); }, [profileId, localProfiles]);
  useEffect(() => { if (!mapsReview) return; const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape" && !mapsBusy) setMapsReview(null); }; window.addEventListener("keydown", onKeyDown); return () => window.removeEventListener("keydown", onKeyDown); }, [mapsReview, mapsBusy]);
  useEffect(() => {
    if (profileId || usableProfiles.length !== 1) return;
    setProfileId(usableProfiles[0].id); setProfile(usableProfiles[0]);
  }, [profileId, usableProfiles]);
  const saveProfile = async () => { const saved = { ...profile, id: profile.id || uid() }; const next = [...localProfiles.filter((item) => item.id !== saved.id), saved]; setLocalProfiles(next); setProfileId(saved.id); setProfile(saved); if (!(await onSave(next, localLists))) { setError("Could not save this ICP. Fix the workspace save error and try again."); return null; } setError(""); return saved; };
  const reverifySavedList = async (list: LeadList) => {
    if (recheckingListId) return;
    const savedProfile = localProfiles.find((item) => item.id === list.profileId);
    if (!savedProfile) { setError("The ICP for this saved list is missing. Restore the ICP before re-verifying it."); return; }
    setRecheckingListId(list.id); setSavedListStatus(""); setError("");
    try {
      const verified: LeadRow[] = [];
      for (let offset = 0; offset < list.rows.length; offset += 100) {
        const batch = list.rows.slice(offset, offset + 100);
        const response = await fetch("/api/studio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "lead-clean", profileId: savedProfile.id, rows: batch }) });
        const result = await response.json() as { error?: string; rows?: LeadRow[] };
        if (!response.ok || !result.rows || result.rows.length !== batch.length) throw new Error(result.error || "The saved list could not be fully re-verified.");
        verified.push(...result.rows.filter((row) => row.keep === true));
      }
      if (!verified.length) throw new Error("No businesses in this list meet the current verified trade, area and exclusion rules. The saved list was left unchanged.");
      const verifiedCopy: LeadList = { ...list, id: uid(), name: `${list.name} · Verified`, createdAt: new Date().toISOString(), rows: verified };
      const next = [verifiedCopy, ...localLists];
      const correctedProfile = { ...savedProfile, niche: savedProfile.niche.replace(/\brooers\b/gi, "roofers") };
      const nextProfiles = localProfiles.map((item) => item.id === correctedProfile.id ? correctedProfile : item);
      if (!(await onSave(nextProfiles, next))) throw new Error("The verified list could not be saved to the workspace.");
      setLocalProfiles(nextProfiles); setLocalLists(next);
      if (profileId === correctedProfile.id) setProfile(correctedProfile);
      setSavedListStatus(`Saved “${verifiedCopy.name}” with ${verified.length.toLocaleString()} verified businesses. The original list is kept for reference${correctedProfile.niche !== savedProfile.niche ? "; the ICP spelling was corrected to “roofers”" : ""}.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not re-verify this saved list."); }
    finally { setRecheckingListId(""); }
  };
  const generateIcpDraft = async () => {
    if (!icpAiPrompt.trim() || icpAiBusy) return;
    setIcpAiBusy(true); setError("");
    try {
      const response = await fetch("/api/studio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "lead-icp-draft", prompt: icpAiPrompt, icons: leadIndustryIcons.map((item) => ({ icon: item.icon, label: item.label })) }) });
      const result = await response.json() as { error?: string; profile?: Partial<LeadProfile> };
      if (!response.ok || !result.profile) throw new Error(result.error || "AI could not draft this ICP.");
      setProfile((current) => ({ ...current, ...result.profile, id: current.id }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "AI could not draft this ICP."); }
    finally { setIcpAiBusy(false); }
  };
  const addFiles = async (files: File[]) => {
    if (!files.length) return;
    setError("");
    const additions: LeadQueueItem[] = [];
    for (const file of files) {
      try {
        const parsed = /\.xlsx$/i.test(file.name) ? (await import("@/lib/lead-export.mjs")).parseLeadXlsx(await file.arrayBuffer()) : parseLeadCsv(await file.text());
        if (!parsed.length) { setError(`${file.name} needs a header row and at least one lead.`); continue; }
        const batches = Math.ceil(parsed.length / 100);
        additions.push({ id: uid(), name: file.name.replace(/\.(csv|xlsx)$/i, ""), profileId, rows: parsed, status: "ready", completedBatches: 0, totalBatches: batches });
      } catch { setError(`Could not read ${file.name}. Use a UTF-8 CSV or an Excel workbook with a header row on its first sheet.`); }
    }
    if (additions.length) setQueue((current) => [...current, ...additions]);
  };
  const searchOutscraper = async () => {
    if (!outscraperConfigured) { setError("Outscraper is not connected yet. Add the OUTSCRAPER_API_KEY Worker secret and redeploy."); return; }
    const areas = leadProfileSearchAreas(profile);
    if (!profile.niche.trim() || !profile.icp.trim()) { setError("Add the niche and ideal customer profile first."); return; }
    if (!areas.length) { setError("Add at least one town, county, or area to this ICP."); return; }
    if (mapsBusy || busy) return;
    setMapsBusy(true); setMapsProgress("Saving this ICP…"); setError("");
    try {
      const savedProfile = await saveProfile();
      if (!savedProfile) throw new Error("The ICP could not be saved. Fix the workspace save error and try again.");
      setMapsProgress("Preparing focused Maps searches from your saved niche…");
      const termResponse = await fetch("/api/studio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "lead-search-terms", profileId: savedProfile.id }) });
      const termsResult = await termResponse.json() as { error?: string; queries?: string[] };
      if (!termResponse.ok) throw new Error(termsResult.error || "AI could not prepare search phrases for this ICP.");
      const terms = [...new Set((termsResult.queries || []).map((term) => term.trim()).filter(Boolean))].slice(0, 6);
      if (!terms.length) throw new Error("AI could not create search phrases from this ICP. Add more detail and try again.");
      const allAvailable = mapsLimit === "all";
      const queries = areas.flatMap((area) => terms.map((term) => `${term}, ${area}`));
      const hardNegatives = String(savedProfile.exclude || "").split(/[\r\n,;|]+/).map((term) => term.trim()).filter(Boolean);
      setMapsReview({ savedProfile, areas, terms, queries, allAvailable, onlyWithWebsite: mapsOnlyWebsite, resultLimit: mapsLimitValue, negatives: hardNegatives });
      setMapsProgress("Search ready to review. Nothing has been sent to Outscraper yet.");
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Outscraper search could not be prepared.";
      setError(message); setMapsProgress(""); publishAppError(message, "Lead Factory · Outscraper search");
    } finally { setMapsBusy(false); }
  };
  const runReviewedOutscraperSearch = async () => {
    const review = mapsReview;
    if (!review || mapsBusy || busy) return;
    setMapsReview(null);
    setMapsBusy(true); setMapsProgress("Starting the reviewed search…"); setError("");
    const { savedProfile, areas, terms, queries, allAvailable, onlyWithWebsite, resultLimit } = review;
    try {
      let places: Record<string, unknown>[] = [];
      let checkedCount = 0;
      const classifyRows = async (rows: LeadRow[]) => {
        const classified: LeadRow[] = [];
        for (let offset = 0; offset < rows.length; offset += 100) {
          const batch = rows.slice(offset, offset + 100);
          const response = await fetch("/api/studio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "lead-clean", profileId: savedProfile.id, rows: batch }) });
          const result = await response.json() as { error?: string; rows?: LeadRow[] };
          if (!response.ok || !result.rows) throw new Error(result.error || "Could not verify this batch of businesses.");
          classified.push(...result.rows);
        }
        checkedCount += rows.length;
        return classified;
      };
      if (allAvailable) {
        setMapsProgress("Starting the full-region search…");
        const submittedResponse = await fetch("/api/outscraper", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "maps-all-search", queries: terms, locations: areas, onlyWithWebsite }) });
        const submitted = await submittedResponse.json() as { error?: string; taskId?: string };
        if (!submittedResponse.ok || !submitted.taskId) throw new Error(submitted.error || "Outscraper could not start the full-region search.");
        let complete = false;
        for (let attempt = 0; attempt < 120; attempt++) {
          setMapsProgress(`Full-region search is running · check ${attempt + 1}/120`);
          await new Promise((resolve) => window.setTimeout(resolve, 10_000));
          const response = await fetch(`/api/outscraper?taskId=${encodeURIComponent(submitted.taskId)}`, { cache: "no-store" });
          const contentType = response.headers.get("Content-Type") || "";
          if (!response.ok) {
            const failure = contentType.includes("json") ? await response.json() as { error?: string } : null;
            throw new Error(failure?.error || "Could not retrieve the full-region Outscraper results.");
          }
          if (contentType.includes("text/csv") || contentType.includes("application/octet-stream")) {
            const csv = await response.text();
            places = flattenOutscraperPlaces(parseLeadCsv(csv).map((row) => row.values));
            complete = true;
            break;
          }
          const result = await response.json() as { status?: string; error?: string; data?: unknown };
          if (result.status === "Failure") throw new Error(result.error || "Outscraper reported that the full-region search failed.");
          if (["SUCCESS", "COMPLETED", "FINISHED"].includes(String(result.status || "").toUpperCase())) {
            places = flattenOutscraperPlaces(result.data);
            complete = true;
            break;
          }
        }
        if (!complete) throw new Error("The full-region search is still processing. Its task remains in Outscraper; try again later.");
        places = flattenOutscraperPlaces(places);
      } else {
        const seen = new Set<string>();
        const verified: LeadRow[] = [];
        const exactQueries = [...new Set(queries.map((query) => query.trim()).filter(Boolean))];
        for (let queryIndex = 0; queryIndex < exactQueries.length && verified.length < resultLimit; queryIndex++) {
          const query = exactQueries[queryIndex];
          let skipPlaces = 0;
          let queryExhausted = false;
          while (!queryExhausted && verified.length < resultLimit && skipPlaces < 500) {
            const requestLimit = 20;
            setMapsProgress(`Finding verified matches · search ${queryIndex + 1}/${exactQueries.length} · ${verified.length}/${resultLimit} ready · page ${skipPlaces / 20 + 1}`);
            const submittedResponse = await fetch("/api/outscraper", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "maps-search", queries: [query], limit: requestLimit, skipPlaces, onlyWithWebsite }) });
            const submitted = await submittedResponse.json() as { error?: string; requestId?: string; status?: string; data?: unknown };
            if (!submittedResponse.ok) throw new Error(submitted.error || `Outscraper could not start search ${queryIndex + 1}.`);
            let data = submitted.data;
            if (submitted.requestId) {
              let complete = false;
              for (let attempt = 0; attempt < 120; attempt++) {
                setMapsProgress(`Checking search ${queryIndex + 1}/${exactQueries.length} · page ${skipPlaces / 20 + 1} · ${attempt + 1}/120`);
                await new Promise((resolve) => window.setTimeout(resolve, 2000));
                const response = await fetch(`/api/outscraper?requestId=${encodeURIComponent(submitted.requestId)}`, { cache: "no-store" });
                const result = await response.json() as { error?: string; status?: string; data?: unknown };
                if (!response.ok) throw new Error(result.error || `Could not retrieve Outscraper search ${queryIndex + 1}.`);
                if (result.status === "Failure") throw new Error(`Outscraper reported that search ${queryIndex + 1} failed.`);
                if (["Success", "Completed", "Finished"].includes(result.status || "")) { data = result.data; complete = true; break; }
              }
              if (!complete) throw new Error(`Outscraper search ${queryIndex + 1} is still processing. Try again later.`);
            }
            const page = flattenOutscraperPlaces(data);
            const fresh = page.filter((place) => {
              const website = String(place.site || place.website || place.domain || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0];
              const phone = String(place.phone || place.phone_number || "").replace(/\D/g, "");
              const name = String(place.name || place.business_name || "").trim().toLowerCase();
              const address = String(place.full_address || place.address || "").trim().toLowerCase();
              const key = String(place.place_id || place.google_id || place.feature_id || "").trim() || website || phone || `${name}|${address}`;
              if (!key || seen.has(key)) return false;
              seen.add(key); return true;
            });
            if (fresh.length) {
              const candidates = fresh.map((place, index) => ({ sourceRow: checkedCount + index + 2, values: outscraperPlaceValues(place) }));
              places.push(...fresh);
              verified.push(...(await classifyRows(candidates)).filter((row) => row.keep === true));
            }
            skipPlaces += requestLimit;
            queryExhausted = page.length < requestLimit || skipPlaces >= 500;
          }
        }
        const selected = verified.slice(0, resultLimit);
        if (!selected.length) {
          setMapsProgress(`Checked ${checkedCount.toLocaleString()} unique listings across ${exactQueries.length} searches; none met the saved ICP and hard exclusions.`);
          return;
        }
        const shortfall = selected.length < resultLimit;
        const item: LeadQueueItem = { id: uid(), name: `${savedProfile.name} · ${areas.join(", ")}`, profileId: savedProfile.id, rows: selected, status: "done", completedBatches: Math.ceil(selected.length / 100), totalBatches: Math.ceil(selected.length / 100), saved: true };
        const savedList: LeadList = { id: uid(), name: item.name, profileId: item.profileId, createdAt: new Date().toISOString(), rows: selected };
        const nextLists = [savedList, ...localLists];
        if (!(await onSave([...localProfiles.filter((saved) => saved.id !== savedProfile.id), savedProfile], nextLists))) throw new Error("Verified leads were found, but the list could not be saved to the workspace.");
        setLocalLists(nextLists); setQueue((current) => [item, ...current]);
        if (shortfall) setError(`Found and saved ${selected.length} verified businesses. Outscraper returned no more verified matches across the selected searches, so the requested ${resultLimit} could not be reached. No unverified businesses were added.`);
        setMapsProgress(`Saved ${selected.length.toLocaleString()} verified businesses${shortfall ? ` of ${resultLimit} requested` : ""} from ${checkedCount.toLocaleString()} unique listings checked.`);
        return;
      }
      if (!places.length) throw new Error("Outscraper finished but returned no business records. Try broader search terms or another area.");
      const rows = places.map((place, index) => ({ sourceRow: index + 2, values: outscraperPlaceValues(place) }));
      setMapsProgress(`${rows.length.toLocaleString()} unique listings found. Verifying trade, area and exclusions…`);
      const verified = (await classifyRows(rows)).filter((row) => row.keep === true);
      if (!verified.length) {
        setMapsProgress(`Checked ${rows.length.toLocaleString()} unique listings; none met the saved ICP and hard exclusions. No unverified businesses were saved.`);
        return;
      }
      const item: LeadQueueItem = { id: uid(), name: `${savedProfile.name} · ${areas.join(", ")}`, profileId: savedProfile.id, rows: verified, status: "done", completedBatches: Math.ceil(verified.length / 100), totalBatches: Math.ceil(verified.length / 100), saved: true };
      const savedList: LeadList = { id: uid(), name: item.name, profileId: item.profileId, createdAt: new Date().toISOString(), rows: verified };
      const nextLists = [savedList, ...localLists];
      if (!(await onSave([...localProfiles.filter((saved) => saved.id !== savedProfile.id), savedProfile], nextLists))) throw new Error("Verified leads were found, but the list could not be saved to the workspace.");
      setLocalLists(nextLists); setQueue((current) => [item, ...current]);
      setMapsProgress(`Saved ${verified.length.toLocaleString()} verified businesses from ${rows.length.toLocaleString()} unique listings checked.`);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Outscraper search failed.";
      setError(message); setMapsProgress(""); publishAppError(message, "Lead Factory · Outscraper search");
    } finally { setMapsBusy(false); }
  };
  const updateQueueItem = (id: string, update: (item: LeadQueueItem) => LeadQueueItem) => setQueue((current) => current.map((item) => item.id === id ? update(item) : item));
  const qualify = async (requestedIds?: string[], additionalTargets: LeadQueueItem[] = [], autoSave = false, profilesToSave: LeadProfile[] = localProfiles): Promise<boolean> => {
    const targets = [...queue.filter((item) => (!requestedIds || requestedIds.includes(item.id)) && ["ready", "error"].includes(item.status)), ...additionalTargets];
    if (!targets.length || busy) return false;
    const missing = targets.find((item) => !profilesToSave.some((saved) => saved.id === item.profileId && saved.icp.trim()));
    if (missing) { setError(`Choose a saved ICP for “${missing.name}” before qualifying it.`); return false; }
    setBusy(true); setError("");
    const batches = targets.flatMap((item) => {
      const rows: LeadRow[][] = [];
      for (let index = 0; index < item.rows.length; index += 100) rows.push(item.rows.slice(index, index + 100));
      return rows.map((batchRows, index) => ({ listId: item.id, profileId: item.profileId, rows: batchRows, index }));
    });
    const nextCounts = new Map(targets.map((item) => [item.id, 0]));
    const qualifiedRows = new Map(targets.map((item) => [item.id, [...item.rows]]));
    const failures = new Map<string, string>();
    targets.forEach((item) => updateQueueItem(item.id, (current) => ({ ...current, status: "running", completedBatches: 0, totalBatches: Math.ceil(current.rows.length / 100), error: undefined })));
    let cursor = 0;
    const worker = async () => {
      while (cursor < batches.length) {
        const batch = batches[cursor++];
        try {
          const response = await fetch("/api/studio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "lead-clean", profileId: batch.profileId, rows: batch.rows }) });
          const result = await response.json() as { error?: string; rows?: LeadRow[] };
          if (!response.ok) throw new Error(result.error || "Could not classify this batch.");
          const qualified = new Map<number, LeadRow>((result.rows || []).map((row: LeadRow) => [row.sourceRow, row]));
          const rowsWithResults = (qualifiedRows.get(batch.listId) || []).map((row) => qualified.get(row.sourceRow) || row);
          qualifiedRows.set(batch.listId, rowsWithResults);
          updateQueueItem(batch.listId, (current) => ({ ...current, rows: current.rows.map((row) => qualified.get(row.sourceRow) || row) }));
          const completedBatches = (nextCounts.get(batch.listId) || 0) + 1;
          nextCounts.set(batch.listId, completedBatches);
          updateQueueItem(batch.listId, (current) => ({ ...current, completedBatches }));
        } catch (reason) {
          failures.set(batch.listId, reason instanceof Error ? reason.message : "A batch failed.");
        }
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.min(3, batches.length) }, () => worker()));
      const completedTargets = targets.map((item) => {
        const failure = failures.get(item.id);
        const completed = { ...item, rows: qualifiedRows.get(item.id) || item.rows, status: failure ? "error" as const : "done" as const, error: failure, completedBatches: nextCounts.get(item.id) || 0 };
        updateQueueItem(item.id, (current) => ({ ...current, ...completed }));
        return completed;
      });
      const failedListCount = new Set(failures.keys()).size;
      if (failedListCount) setError(`${failedListCount} list${failedListCount === 1 ? "" : "s"} had a batch that could not be qualified. Retry the affected list; completed batches are kept.`);
      if (autoSave) {
        const successful = completedTargets.filter((item) => item.status === "done");
        if (successful.length) {
          const savedItems: LeadList[] = successful.map((item) => ({ id: uid(), name: item.name, profileId: item.profileId, createdAt: new Date().toISOString(), rows: item.rows }));
          const next = [...savedItems, ...localLists];
          if (!(await onSave(profilesToSave, next))) throw new Error("AI finished, but the matched lead list could not be saved to the workspace.");
          setLocalLists(next);
          setQueue((current) => current.map((item) => successful.some((saved) => saved.id === item.id) ? { ...item, status: "done", saved: true } : item));
        }
      }
      return failedListCount === 0;
    } finally { setBusy(false); }
  };
  const saveQualified = async (ids?: string[]) => {
    const readyToSave = queue.filter((item) => item.status === "done" && !item.saved && (!ids || ids.includes(item.id)));
    if (!readyToSave.length || savingLists) return;
    setSavingLists(true); setError("");
    try {
      const savedItems: LeadList[] = readyToSave.map((item) => ({ id: uid(), name: item.name, profileId: item.profileId, createdAt: new Date().toISOString(), rows: item.rows }));
      const next = [...savedItems, ...localLists];
      if (!(await onSave(localProfiles, next))) throw new Error("The qualified lists could not be saved to the workspace.");
      setLocalLists(next); setQueue((current) => current.map((item) => readyToSave.some((saved) => saved.id === item.id) ? { ...item, saved: true } : item));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save the qualified lists."); }
    finally { setSavingLists(false); }
  };
  const queuedRows = queue.reduce((total, item) => total + item.rows.length, 0);
  const completedLists = queue.filter((item) => item.status === "done").length;
  const unsavedCompletedLists = queue.filter((item) => item.status === "done" && !item.saved).length;
  const pendingLists = queue.filter((item) => item.status === "ready" || item.status === "error").length;
  const exportList = async (item: LeadList, format: "csv" | "xlsx") => {
    if (format === "csv") await downloadLeadList(item); else await downloadLeadListExcel(item);
    const createdAt = new Date().toISOString();
    const next = localLists.map((list) => list.id === item.id ? { ...list, exports: [...(list.exports || []), { format, createdAt }] } : list);
    setLocalLists(next);
    if (!(await onSave(localProfiles, next))) setError("The file downloaded, but its export history could not be saved.");
  };
  const createProfile = () => { const next: LeadProfile = { id: "", name: "New ICP", niche: "", icp: "", exclude: "", areas: "", icon: "🎯", iconColor: "#328de0" }; setProfile(next); setProfileId(""); setActiveSection("profiles"); };
  const duplicateProfile = async (item: LeadProfile) => {
    const duplicate = { ...item, id: uid(), name: `${item.name || item.niche || "ICP"} copy` };
    const next = [...localProfiles, duplicate]; setLocalProfiles(next); setProfileId(duplicate.id); setProfile(duplicate); setActiveSection("profiles");
    if (!(await onSave(next, localLists))) setError("The copied ICP is open, but it could not be saved to the workspace.");
  };
  const removeProfile = async (item: LeadProfile) => {
    if (localLists.some((list) => list.profileId === item.id)) { setError("This ICP is linked to a saved lead list, so it cannot be removed yet."); return; }
    if (!window.confirm(`Remove the ICP “${item.name || item.niche}”?`)) return;
    const next = localProfiles.filter((saved) => saved.id !== item.id); setLocalProfiles(next);
     if (profileId === item.id) { setProfileId(""); setProfile({ id: "", name: "New ICP", niche: "", icp: "", exclude: "", areas: "", icon: "🎯", iconColor: "#328de0" }); }
    if (!(await onSave(next, localLists))) setError("The ICP could not be removed because the workspace did not save.");
  };
  const factoryTabs: LeadStudioTab[] = [
    { id: "profiles", label: "ICP profiles", icon: "🎯" },
    { id: "find", label: "Find leads", icon: "🔎" },
    { id: "lists", label: "Lists & results", icon: "📁" },
  ];
  return <>
    <div className="page-heading lead-module-heading"><div><p className="eyebrow">🏭 YOUR AGENCY PIPELINE</p><h1><LeadFactoryAnimatedIcon /> Lead Factory</h1><p className="muted">Find the right businesses, review the matches, and send a clean list to enrichment.</p></div><button className="primary-button" onClick={createProfile}>＋ New ICP</button></div>
    <LeadStudioTabs label="Lead Factory" tabs={factoryTabs} active={activeSection} onChange={setActiveSection} />
    {activeSection === "profiles" && <section className="studio-panel lead-studio-panel"><div className="lead-section-heading"><div><h2>🎯 ICP profiles</h2><p>Save who you want to reach and what to leave out.</p></div><button className="secondary-button" onClick={createProfile}>＋ Create profile</button></div>
      {visibleProfiles.length > 0 && <div className="lead-profile-grid">{visibleProfiles.map((item) => { const incomplete = !item.niche.trim() || !item.icp.trim() || !leadProfileSearchAreas(item).length; const linkedLists = localLists.filter((list) => list.profileId === item.id).length; const profileName = item.name || item.niche || "Untitled ICP"; return <article key={item.id} className={`lead-profile-card ${profileId === item.id ? "selected" : ""}`}><button type="button" className="lead-profile-select" onClick={() => { setProfileId(item.id); setProfile(item); }}><span style={{ backgroundColor: `${item.iconColor || "#328de0"}22` }}>{item.icon || "🎯"}</span><b>{profileName}</b><small>{item.niche || "Add an industry"}</small><em>{incomplete ? "Needs details" : "Ready to search"} · {linkedLists} saved {linkedLists === 1 ? "list" : "lists"}</em></button><div className="lead-profile-card-actions task-card-actions"><button type="button" className="task-edit" onClick={() => { setProfileId(item.id); setProfile(item); }} aria-label={`Edit ICP ${profileName}`} title="Edit ICP">✎</button><button type="button" className="task-duplicate" onClick={() => void duplicateProfile(item)} aria-label={`Duplicate ICP ${profileName}`} title="Duplicate ICP">⧉</button><button type="button" className="task-delete" disabled={linkedLists > 0} title={linkedLists ? "This ICP is linked to saved lists." : "Delete ICP"} aria-label={`Delete ICP ${profileName}`} onClick={() => void removeProfile(item)}>🗑 Delete</button></div></article>; })}</div>}
      <div className="lead-profile-editor"><div className="lead-section-heading"><div><h3>{profileId ? `Edit ${profile.name || "ICP profile"}` : "Create an ICP profile"}</h3><p>Keep the target and exclusions specific so qualification stays explainable.</p></div>{profileId && <button className="text-button" onClick={() => void duplicateProfile(profile)}>Duplicate this profile</button>}</div>
        <div className="lead-icp-ai-draft"><label className="field"><span>✨ Ask AI to draft a profile</span><textarea rows={2} value={icpAiPrompt} onChange={(event) => setIcpAiPrompt(event.target.value)} placeholder="e.g. Independent electricians in Dublin; exclude suppliers and training centres" /></label><button type="button" className="secondary-button" disabled={!icpAiPrompt.trim() || icpAiBusy} onClick={() => void generateIcpDraft()}>{icpAiBusy ? "Drafting…" : "✨ Draft fields for review"}</button><small>AI fills editable fields only. Nothing is saved until you review and save the profile.</small></div>
        <div className="lead-icon-picker"><div className="lead-section-heading"><div><h3>Profile icon</h3><p>Choose any icon; it doesn’t have to match the industry.</p></div><label className="lead-icon-color"><span>Icon colour</span><input type="color" value={profile.iconColor || "#328de0"} onChange={(event) => setProfile({ ...profile, iconColor: event.target.value })} /></label></div><label className="field"><span>Search icons</span><input value={iconSearch} onChange={(event) => setIconSearch(event.target.value)} placeholder="Try HVAC, tools, money, home…" /></label><div className="lead-icon-options" role="listbox" aria-label="Profile icons">{leadIndustryIcons.filter((item) => `${item.label} ${item.words}`.toLowerCase().includes(iconSearch.trim().toLowerCase())).map((item) => <button type="button" role="option" aria-label={`Choose ${item.label} icon`} aria-selected={(profile.icon || "🎯") === item.icon} className={(profile.icon || "🎯") === item.icon ? "selected" : ""} key={item.label} onClick={() => setProfile({ ...profile, icon: item.icon })}><span style={{ backgroundColor: `${profile.iconColor || "#328de0"}22` }}>{item.icon}</span></button>)}</div>{!leadIndustryIcons.some((item) => `${item.label} ${item.words}`.toLowerCase().includes(iconSearch.trim().toLowerCase())) && <small className="lead-icon-empty">No matching icons. Try another word.</small>}</div>
        <div className="form-grid">
        <label className="field"><span>Profile name</span><input value={profile.name} onChange={(event) => setProfile({ ...profile, name: event.target.value })} placeholder="e.g. Galway roofers" /></label>
        <label className="field"><span>Industry or niche</span><input value={profile.niche} onChange={(event) => setProfile({ ...profile, niche: event.target.value })} placeholder="e.g. roofing contractors" /></label>
        <label className="field full-field"><span>Ideal customer</span><textarea rows={3} value={profile.icp} onChange={(event) => setProfile({ ...profile, icp: event.target.value })} placeholder="Business type, size, decision-maker and qualifying signals" /></label>
        <label className="field full-field"><span>Exclude · hard negatives</span><textarea rows={2} value={profile.exclude} onChange={(event) => setProfile({ ...profile, exclude: event.target.value })} placeholder="e.g. suppliers, franchises, training providers" /><small>Separate unwanted business types with commas. These are rejected before AI qualification.</small></label>
        <label className="field"><span>Country</span><select value={profile.country ? (leadLocationOptions[profile.country] ? profile.country : "Other") : ""} onChange={(event) => setProfile({ ...profile, country: event.target.value, regions: [], cities: [] })}><option value="">Choose a country</option>{Object.keys(leadLocationOptions).map((country) => <option key={country}>{country}</option>)}<option value="Other">Other country</option></select></label>
        {(profile.country === "Other" || Boolean(profile.country && !leadLocationOptions[profile.country])) && <label className="field"><span>Enter country</span><input value={profile.country === "Other" ? "" : profile.country || ""} onChange={(event) => setProfile({ ...profile, country: event.target.value })} placeholder="Country name" /></label>}
        {profile.country && <div className="field full-field"><span>{profile.country === "Ireland" ? "Counties · select one or more" : "Regions · select one or more"}</span><small>{profile.country === "Ireland" ? "Choose the counties to search. Select more than one if needed." : "Choose the regions to search. Select more than one if needed."}</small>{leadLocationOptions[profile.country] ? <div className="lead-location-chips" aria-label={profile.country === "Ireland" ? "County selector" : "Region selector"}>{leadLocationOptions[profile.country].regions.map((region) => <button key={region} type="button" className={(profile.regions || []).includes(region) ? "selected" : ""} aria-pressed={(profile.regions || []).includes(region)} onClick={() => setProfile({ ...profile, regions: (profile.regions || []).includes(region) ? (profile.regions || []).filter((item) => item !== region) : [...(profile.regions || []), region] })}>{region}</button>)}</div> : <textarea rows={2} value={(profile.regions || []).join(", ")} onChange={(event) => setProfile({ ...profile, regions: event.target.value.split(/[,;\n]+/).map((item) => item.trim()).filter(Boolean) })} placeholder="Type regions, counties, or states separated by commas" />}</div>}
        {profile.country && <div className="field full-field"><span>Suggested cities · choose any to include</span>{leadLocationOptions[profile.country] ? <div className="lead-location-chips">{leadLocationOptions[profile.country].cities.map((city) => <button key={city} type="button" className={(profile.cities || []).includes(city) ? "selected" : ""} aria-pressed={(profile.cities || []).includes(city)} onClick={() => setProfile({ ...profile, cities: (profile.cities || []).includes(city) ? (profile.cities || []).filter((item) => item !== city) : [...(profile.cities || []), city] })}>{city}</button>)}</div> : <textarea rows={2} value={(profile.cities || []).join(", ")} onChange={(event) => setProfile({ ...profile, cities: event.target.value.split(/[,;\n]+/).map((item) => item.trim()).filter(Boolean) })} placeholder="Type cities separated by commas" />}<small>Suggestions are optional. Outscraper searches only the regions and cities you select.</small></div>}
        <label className="field full-field"><span>Extra locations (optional)</span><textarea rows={2} value={profile.areas || ""} onChange={(event) => setProfile({ ...profile, areas: event.target.value })} placeholder="Add towns, postcodes, or areas not listed above" /></label>
      </div><div className="lead-profile-actions"><button className="primary-button" onClick={saveProfile}>Save ICP profile</button>{profileId && <button className="secondary-button" onClick={() => { setProfileId(""); setProfile({ id: "", name: "New ICP", niche: "", icp: "", exclude: "", areas: "", icon: "🎯", iconColor: "#328de0" }); }}>New blank profile</button>}</div></div>
    </section>}
    {activeSection === "find" && <section className="studio-panel lead-studio-panel"><div className="lead-section-heading"><div><h2>🔎 Find leads</h2><p>Choose how many verified businesses you need. The primary business category and location confirm a match; missing service details alone won’t reject a clear match.</p></div><span className={`lead-maps-connection ${outscraperConfigured ? "connected" : ""}`}>{outscraperConfigured ? "Outscraper connected" : "Connection needed"}</span></div>
      <label className="field"><span>ICP profile</span><select value={profileId} onChange={(event) => setProfileId(event.target.value)}><option value="">Choose an ICP profile</option>{usableProfiles.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.niche}</option>)}</select></label>
      {profileId ? <div className="lead-selected-profile"><span style={{ backgroundColor: `${profile.iconColor || "#328de0"}22` }}>{profile.icon || "🎯"}</span><div><b>{profile.name || profile.niche}</b><small>{profile.niche || "Industry not set"} · {leadProfileSearchAreas(profile).join(" · ") || "No target locations"}</small><small>Exclude: {profile.exclude || "No exclusions set"}</small></div><button className="text-button" onClick={() => setActiveSection("profiles")}>Edit ICP</button></div> : <div className="lead-inline-empty"><b>No ICP selected</b><span>Create a profile with an industry, ideal customer and target location to start a search.</span><button className="secondary-button" onClick={createProfile}>＋ Create ICP profile</button></div>}
      <section className="lead-maps-search" aria-labelledby="lead-maps-title"><div className="lead-maps-search-heading"><div><h3 id="lead-maps-title">🗺️ Search Google Maps</h3><p>We verify each result against its listed business category, target location and hard exclusions, then keep searching other ICP phrases until your requested total is reached or available searches are exhausted.</p></div></div>
        <div className="lead-search-controls"><label className="field"><span>Total verified businesses</span><select value={mapsLimit} onChange={(event) => setMapsLimit(event.target.value === "all" ? "all" : Number(event.target.value))}><option value="all">All available verified matches</option><option value={10}>10 verified businesses</option><option value={25}>25 verified businesses</option><option value={50}>50 verified businesses</option><option value={100}>100 verified businesses</option><option value={250}>250 verified businesses</option><option value={500}>500 verified businesses</option></select><small>A selected number is the total saved leads, across all search phrases. Unverified matches are never added.</small></label><label className="lead-maps-checkbox"><input type="checkbox" checked={mapsOnlyWebsite} onChange={(event) => setMapsOnlyWebsite(event.target.checked)} /><span>Website required</span></label></div>
        <div className="lead-search-footer"><p>Searches stay within the saved niche and target areas. Add unwanted business types under “Exclude”; they remain hard exclusions. “All available verified matches” searches the selected areas and provider-supported location expansions, removes duplicates, then saves only verified matches. Outscraper coverage and per-query result limits determine what is available; larger searches can use more credits.</p><button type="button" className="primary-button" disabled={!outscraperConfigured || mapsBusy || busy} onClick={() => void searchOutscraper()}>{mapsBusy ? `⏳ ${mapsProgress || "Searching…"}` : "Search and qualify"}</button></div>
        {!outscraperConfigured ? <p className="form-hint" role="status">Outscraper is not connected. Add the OUTSCRAPER_API_KEY Worker secret to enable real searches.</p> : !profileId ? <p className="form-hint" role="status">Choose an ICP profile before searching.</p> : !leadProfileSearchAreas(profile).length ? <p className="form-hint" role="status">Choose at least one region or city in this ICP before searching. Locations are never guessed.</p> : !profile.niche.trim() || !profile.icp.trim() ? <p className="form-hint" role="status">Add the niche and ideal customer profile to this ICP before searching.</p> : null}{mapsProgress && <p className="lead-enrichment-progress" role="status">{mapsProgress}</p>}
      </section>
      <details className="lead-import-details"><summary>📥 Import a CSV or Excel list to qualify</summary><label className="lead-upload-zone"><input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" multiple onChange={(event) => { const files = Array.from(event.currentTarget.files || []); event.currentTarget.value = ""; void addFiles(files); }} /><span className="lead-upload-icon">＋</span><b>Choose CSV or Excel files</b><small>Each imported row stays in its original order and keeps its source fields.</small><span className="lead-upload-action">Browse files</span></label></details>
      {error && <p className="studio-error">{error}</p>}
    </section>}
    {queue.length > 0 && activeSection === "lists" && <section className="studio-panel lead-studio-panel"><div className="lead-section-heading"><div><h2>📊 Qualification results</h2><p>Review imported or searched businesses, retry incomplete batches and save qualified lists.</p></div><div className="lead-results-stats"><span><b>{queuedRows}</b> businesses</span><span><b>{completedLists}</b> complete</span><span><b>{pendingLists}</b> to review</span></div></div>
      {queue.length > 0 && <div className="lead-queue-toolbar"><div><b>{queue.length} batch{queue.length === 1 ? "" : "es"}</b><small>{busy ? "Qualification is running. Results update as batches finish." : `${pendingLists} waiting · ${completedLists} qualified`}</small></div><div>{queue.length > 1 && profileId && <button className="secondary-button" disabled={busy} onClick={() => setQueue((current) => current.map((item) => ["ready", "error"].includes(item.status) ? { ...item, profileId } : item))}>Use selected ICP for waiting</button>}{unsavedCompletedLists > 0 && <button className="secondary-button" disabled={savingLists} onClick={() => void saveQualified()}>{savingLists ? "Saving…" : "💾 Save qualified"}</button>}<button className="primary-button" disabled={busy || pendingLists === 0} onClick={() => void qualify()}>{busy ? "⏳ Qualifying…" : `Qualify ${pendingLists || "waiting"}`}</button></div></div>}
        {queue.length > 0 && <div className="lead-queue-list">{queue.map((item, index) => {
        const matchCount = item.rows.filter((row) => row.keep === true).length; const excludedCount = item.rows.filter((row) => row.keep === false).length; const percent = item.totalBatches ? Math.round(item.completedBatches / item.totalBatches * 100) : 0; const savedProfile = localProfiles.find((saved) => saved.id === item.profileId);
        return <article className={`lead-queue-card ${item.status}`} key={item.id} style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}>
          <div className="lead-queue-card-head"><span className={`lead-queue-file ${item.status}`}>{item.status === "done" ? "✓" : item.status === "running" ? <i /> : item.status === "error" ? "!" : "📄"}</span><div className="lead-queue-file-info"><b>{item.name}</b><small>{item.rows.length.toLocaleString()} rows · {savedProfile?.name || "Choose an ICP"} · {item.totalBatches} AI batch{item.totalBatches === 1 ? "" : "es"}</small></div><span className={`lead-queue-status ${item.status}`}>{item.status === "done" ? "Qualified" : item.status === "running" ? "Working" : item.status === "error" ? "Retry needed" : "Waiting"}</span><button type="button" className="lead-queue-remove" aria-label={`Remove ${item.name} from queue`} disabled={item.status === "running"} onClick={() => setQueue((current) => current.filter((entry) => entry.id !== item.id))}>×</button></div>
          <label className="lead-queue-profile"><span>ICP for this list</span><select value={item.profileId} disabled={item.status === "running"} onChange={(event) => updateQueueItem(item.id, (current) => ({ ...current, profileId: event.target.value }))}><option value="">Choose an ICP</option>{localProfiles.filter((saved) => saved.icp.trim()).map((saved) => <option value={saved.id} key={saved.id}>{saved.name} · {saved.niche}</option>)}</select></label>
          {(item.status === "running" || item.status === "done" || item.status === "error") && <div className="lead-queue-progress" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${percent}%` }} /></div>}
          <div className="lead-queue-card-footer">{item.status === "running" ? <small>{item.completedBatches} of {item.totalBatches} batches complete · {percent}%</small> : item.status === "done" ? <small>✅ {matchCount} matches · 🚫 {excludedCount} excluded{item.saved ? " · Saved to workspace" : ""}</small> : item.status === "error" ? <small className="lead-queue-error">{item.error || "One or more batches failed."} · {matchCount} matches retained</small> : <small>Ready to qualify · source data preserved</small>}<div>{["ready", "error"].includes(item.status) && <button type="button" className="primary-button" disabled={busy || !localProfiles.some((saved) => saved.id === item.profileId && saved.icp.trim())} onClick={() => void qualify([item.id])}>{item.status === "error" ? "↻ Retry this list" : "✨ Qualify this list"}</button>}{item.status === "done" && !item.saved && <button type="button" className="secondary-button" onClick={() => void saveQualified([item.id])}>💾 Save list</button>}{item.status !== "running" && <button type="button" className="text-button" onClick={() => updateQueueItem(item.id, (current) => ({ ...current, previewOpen: !current.previewOpen }))}>{item.previewOpen ? "Hide preview" : "Preview rows"}</button>}</div></div>
          {item.previewOpen && <div className="lead-results"><table><thead><tr><th>Decision</th>{Object.keys(item.rows[0]?.values || {}).slice(0, 5).map((key) => <th key={key}>{key}</th>)}<th>Reason</th></tr></thead><tbody>{item.rows.slice(0, 12).map((row) => <tr key={row.sourceRow}><td>{row.keep === undefined ? "Not reviewed" : row.keep ? "Keep" : "Exclude"}</td>{Object.values(row.values).slice(0, 5).map((value, valueIndex) => <td key={valueIndex}>{value}</td>)}<td>{row.reason || ""}</td></tr>)}</tbody></table>{item.rows.length > 12 && <small className="lead-preview-note">Previewing the first 12 of {item.rows.length.toLocaleString()} rows.</small>}</div>}
        </article>;
      })}</div>}
     </section>}
    {activeSection === "lists" && <section className="studio-panel lead-studio-panel"><div className="lead-section-heading"><div><h2>📁 Saved lists</h2><p>Review saved businesses, download a list or send it to Enrichment.</p></div></div>{localLists.length > 0 ? <div className="lead-saved-list-grid">{[...localLists].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).map((item) => { const qualified = item.rows.filter((row) => row.keep === true).length; const needsReview = item.rows.filter((row) => row.keep === undefined || row.reason === "No classification returned").length; const excluded = item.rows.length - qualified - needsReview; const savedProfile = localProfiles.find((saved) => saved.id === item.profileId); const reasonCounts = new Map<string, number>(); for (const row of item.rows) if (row.keep === false && row.reason && row.reason !== "No classification returned") reasonCounts.set(row.reason, (reasonCounts.get(row.reason) || 0) + 1); const topReason = [...reasonCounts.entries()].sort((a, b) => b[1] - a[1])[0]; const created = new Date(item.createdAt); return <article className="lead-saved-list-card" key={item.id}><b>{item.name}</b><span>{savedProfile?.niche || "Niche"} · {created.toLocaleDateString()} at {created.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {item.rows.length.toLocaleString()} businesses</span><div className="lead-saved-list-counts"><span className="qualified">✓ {qualified.toLocaleString()} qualified</span><span className="excluded">✕ {excluded.toLocaleString()} excluded</span>{needsReview > 0 && <span className="review">! {needsReview.toLocaleString()} need review</span>}</div>{qualified === 0 && (topReason ? <small className="lead-saved-list-reason">Top exclusion reason: {topReason[0]} ({topReason[1].toLocaleString()})</small> : <small className="lead-saved-list-reason">No leads passed this ICP check. Open results to see individual reasons and refine your profile before searching again.</small>)}<div className="lead-saved-list-actions">{qualified === 0 && <button type="button" className="secondary-button" disabled={Boolean(recheckingListId)} onClick={() => void reverifySavedList(item)}>{recheckingListId === item.id ? "⏳ Verifying…" : "↻ Save verified copy"}</button>}<button type="button" className="secondary-button" onClick={() => onOpenEnrichment(item.id)}>✨ Enrich this list</button><button type="button" className="lead-list-action-button" onClick={() => void exportList(item, "csv")} aria-label={`Download ${item.name} as CSV`}>⬇ CSV</button><button type="button" className="lead-list-action-button" onClick={() => void exportList(item, "xlsx")} aria-label={`Download ${item.name} as Excel`}>⬇ Excel</button><button type="button" className="lead-list-action-button" onClick={() => { const queueItem: LeadQueueItem = { id: uid(), name: item.name, profileId: item.profileId, rows: item.rows, status: "done", completedBatches: Math.ceil(item.rows.length / 100), totalBatches: Math.ceil(item.rows.length / 100), saved: true }; setQueue((current) => [...current, queueItem]); setActiveSection("lists"); }}>📋 Review results</button><button type="button" className="lead-list-delete-button" onClick={() => { if (!window.confirm(`Delete “${item.name}”?`)) return; const next = localLists.filter((list) => list.id !== item.id); setLocalLists(next); void onSave(localProfiles, next); }}>🗑 Delete</button></div></article>; })}</div> : <div className="lead-inline-empty"><b>No saved lists yet</b><span>Qualified lists you save will appear here.</span><button className="secondary-button" onClick={() => setActiveSection("find")}>Find leads</button></div>}{savedListStatus && <p className="form-hint" role="status">{savedListStatus}</p>}{error && <p className="studio-error" role="alert">{error}</p>}</section>}
    {mapsReview && <div className="modal-backdrop lead-search-review-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !mapsBusy) setMapsReview(null); }}><section className="modal lead-search-review-modal" role="dialog" aria-modal="true" aria-labelledby="lead-search-review-title" aria-describedby="lead-search-review-description"><div className="modal-head"><div><p className="eyebrow">LEAD FACTORY · SEARCH REVIEW</p><h2 id="lead-search-review-title">Review before searching</h2></div><button type="button" className="icon-button" aria-label="Close search review" onClick={() => setMapsReview(null)} autoFocus>×</button></div><p id="lead-search-review-description" className="lead-search-review-intro">Check what will be sent to Outscraper. Nothing has been searched yet.</p><div className="lead-search-review-meta"><span><b>ICP</b>{mapsReview.savedProfile.name}</span><span><b>Areas</b>{mapsReview.areas.join(", ")}</span><span><b>Verified lead target</b>{mapsReview.allAvailable ? "All available verified matches" : `${mapsReview.resultLimit} total verified businesses`}</span></div><div className="lead-search-review-section"><h3>Search phrases <span>{mapsReview.queries.length}</span></h3><ul className="lead-search-review-queries">{mapsReview.queries.map((query, index) => <li key={`${query}-${index}`}>{query}</li>)}</ul></div><div className="lead-search-review-section"><h3>Hard exclusions</h3><p>{mapsReview.negatives.length ? mapsReview.negatives.join(", ") : "No exclusions saved in this ICP."}</p></div><div className="lead-search-review-note"><b>What happens next</b><p>Search phrases run in order until the requested number of verified matches is found. Each kept business must match the saved niche and selected area. {mapsReview.onlyWithWebsite ? "Only listings with a website are requested." : "Listings without a website can be included."}</p>{mapsReview.allAvailable && <p className="lead-search-credit-warning">⚠️ The all-available search uses Outscraper's location expansion and may take longer or use more credits. Final coverage depends on results Outscraper can return for the selected searches.</p>}</div><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setMapsReview(null)}>Cancel</button><button type="button" className="primary-button" disabled={mapsBusy} onClick={() => void runReviewedOutscraperSearch()}>{mapsBusy ? "Preparing…" : "🔎 Run search and qualify"}</button></div></section></div>}
  </>;
}

function AssistantScopedTaskCard({ task }: { task: Task }) {
  const mode = task.aiMode || task.service;
  const report = (task.aiFeedback || task.notes || "").trim();
  const completed = task.aiRunState === "completed" || task.status === "Done";
  const state = completed ? { label: "Completed", icon: "✅", className: "done" }
    : task.aiRunState === "needs_review" ? { label: "Review needed", icon: "🟡", className: "review" }
    : task.aiRunState === "needs_connection" ? { label: "Needs setup", icon: "🔌", className: "warning" }
    : task.aiRunState === "failed" ? { label: "Run failed", icon: "⚠️", className: "warning" }
    : task.aiRunState === "running" ? { label: "In progress", icon: "⚙️", className: "working" }
    : task.aiRunState === "scheduled" ? { label: "Scheduled", icon: "🕒", className: "scheduled" }
    : { label: task.status, icon: task.status === "In progress" ? "🔵" : "📋", className: "" };
  const dateValue = task.aiRunAt || task.dueAt || (task.due ? `${task.due}T00:00:00` : "");
  const dateLabel = dateValue ? new Date(dateValue).toLocaleString("en-IE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "No date set";
  return <article className="assistant-scoped-task">
    <span className="assistant-task-service-icon" title={mode}><AiIcon v={aiModes.find((item) => item.name === mode)?.icon || serviceIcons[mode] || "☷"} /></span>
    <div className="assistant-scoped-task-main">
      <div className="assistant-scoped-task-title-row"><b>{task.title}</b><span className={`assistant-task-status ${state.className}`}>{state.icon} {state.label}</span></div>
      <div className="assistant-scoped-task-meta"><span>📅 {dateLabel}</span>{task.repeat && task.repeat !== "None" && <span>🔁 {task.repeat}</span>}</div>
      {task.wordpressDraftUrl && <a className="secondary-button assistant-site-draft-link" href={task.wordpressDraftUrl} target="_blank" rel="noreferrer">🌐 Open WordPress draft ↗</a>}
      {task.aiReferenceFileName && <small className="assistant-site-reference-label">🖼️ Design reference: {task.aiReferenceFileName}</small>}
      {report && <details className="assistant-scoped-task-report"><summary>{task.aiFeedback ? "📄 View task update" : "📝 View instructions"}</summary><p>{formatAiRunForDisplay(report)}</p></details>}
    </div>
  </article>;
}

function AssistantView({ workspace, allowedAiModes, onSavePrompt, onScheduleTask, onUploadReference, onOpenTasks, isAdmin, onRecordAdsChange }: { workspace: Workspace; allowedAiModes: AiMode[]; onSavePrompt: (mode: AiMode, prompt: string) => Promise<boolean>; onScheduleTask: (draft: AssistantTaskDraft) => Promise<boolean>; onUploadReference: (clientId: string, file: File) => Promise<ClientFile>; onOpenTasks: () => void; isAdmin: boolean; onRecordAdsChange: (event: { clientId: string; clientName: string; note: string; changedAt: string }) => Promise<boolean> }) {
  const [clientId, setClientId] = useState("");
  const [service, setService] = useState<AiMode>("Google Ads");
  const [promptEditorOpen, setPromptEditorOpen] = useState(false);
  const [promptDraft, setPromptDraft] = useState("");
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [promptSaved, setPromptSaved] = useState(false);
  const [messages, setMessages] = useState<{ role: "user" | "assistant"; content: string; created_by?: string | null; created_at?: string }[]>([]);
  const [draft, setDraft] = useState("");
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceInterim, setVoiceInterim] = useState("");
  const [speakingMessageId, setSpeakingMessageId] = useState("");
  const speechRecognition = useRef<SpeechRecognitionLike | null>(null);
  const [loading, setLoading] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [aiProvider, setAiProvider] = useState<string | null>(null);
  const [adsStatus, setAdsStatus] = useState("checking");
  const [adsActionCount, setAdsActionCount] = useState(0);
  const [adsSummary, setAdsSummary] = useState<{ range: string; rowCount: number; updatedAt: string; totals: { spend: number; impressions: number; clicks: number; conversions: number; conversionValue: number; ctrPercent: number; averageCpc: number | null; costPerConversion: number | null }; campaigns: { id: string; name: string; status: string; spend: number; impressions: number; clicks: number; conversions: number; conversionValue: number; ctrPercent: number; averageCpc: number | null; costPerConversion: number | null }[] } | null>(null);
  const [ga4Overview, setGa4Overview] = useState<any>(null);
  const [ga4DateRange, setGa4DateRange] = useState("last_30d");
  const [selectedAdsCampaign, setSelectedAdsCampaign] = useState("");
  const [adsDateRange, setAdsDateRange] = useState("last_30d");
  const [adsCustomStart, setAdsCustomStart] = useState("");
  const [adsCustomEnd, setAdsCustomEnd] = useState("");
  const [adsSummaryLoading, setAdsSummaryLoading] = useState(false);
  const [seoStatus, setSeoStatus] = useState("checking");
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const [adsWrite, setAdsWrite] = useState<{ configured: boolean; connected: boolean; apiReady?: boolean; accountEmail?: string; connectedAt?: string } | null>(null);
  const [pendingAdsChange, setPendingAdsChange] = useState<{ pendingChangeId: string; provider?: string; clientName: string; campaignName: string; campaignId: string; changeType: string; oldValue: string; newValue: string; currencyCode?: string; summary?: string } | null>(null);
  useEffect(() => { setPromptDraft(workspace.aiPrompts?.[service] || ""); setPromptSaved(false); }, [service, workspace.aiPrompts]);
  const [applyingAdsChange, setApplyingAdsChange] = useState(false);
  const [error, setError] = useAppErrorState("AI Assistant");
  useEffect(() => () => { speechRecognition.current?.stop(); speechRecognition.current = null; }, []);
  const [plannerOpen, setPlannerOpen] = useState(false);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDue, setTaskDue] = useState(() => { const now = new Date(); now.setMinutes(now.getMinutes() - now.getTimezoneOffset()); return now.toISOString().slice(0, 10); });
  const [taskRunTime, setTaskRunTime] = useState("09:00");
  const [taskRepeat, setTaskRepeat] = useState<Task["repeat"]>("None");
  const [taskAssignee, setTaskAssignee] = useState("");
  const [taskNotes, setTaskNotes] = useState("");
  const [taskReference, setTaskReference] = useState<Pick<ClientFile, "id" | "name"> | null>(null);
  const [taskReferenceUploading, setTaskReferenceUploading] = useState(false);
  const client = workspace.clients.find((item) => item.id === clientId);
  const aiAgentName = workspace.staff.find((member) => member.id === aiTeammate.id)?.name || aiTeammate.name;
  const availableModes = isAdmin ? aiModes : aiModes.filter((item) => allowedAiModes.includes(item.name));
  const aiEmployees = workspace.staff.filter((member) => member.isBot);
  const [agentId, setAgentId] = useState("");
  useEffect(() => { if (aiEmployees.length && !aiEmployees.some((member) => member.id === agentId)) setAgentId((aiEmployees.find((member) => !member.aiModel?.startsWith("anthropic/")) || aiEmployees[0]).id); }, [aiEmployees.map((member) => member.id).join(","), agentId]);
  const scopedTasks = workspace.tasks.filter((task) => task.clientId === clientId && (task.aiMode === service || task.service === service)).sort((a, b) => (a.dueAt || a.due || "9999").localeCompare(b.dueAt || b.due || "9999"));
  const selectedCampaignData = adsSummary?.campaigns.find((campaign) => campaign.id === selectedAdsCampaign);
  const directAdsReady = Boolean(adsWrite?.connected && adsWrite.apiReady);
  const adsOverviewTotals = selectedCampaignData || (!selectedAdsCampaign ? adsSummary?.totals : null);
  useEffect(() => { setSelectedAdsCampaign(""); }, [clientId]);
  useEffect(() => { if (!clientId || service !== "SEO" || !client?.googleAnalyticsAccountId) { setGa4Overview(null); return; } let cancelled = false; setGa4Overview({ status: "checking" }); fetch("/api/analytics?clientId=" + encodeURIComponent(clientId) + "&range=" + encodeURIComponent(ga4DateRange)).then(async (response) => { const result = await readApiJson<Record<string, any>>(response, "Google Analytics"); if (!response.ok) throw new Error(result.error || "Could not load Google Analytics."); return result; }).then((result) => { if (!cancelled) setGa4Overview(result); }).catch((reason) => { if (!cancelled) { setGa4Overview({ status: "unavailable", message: "Google Analytics data unavailable." }); setError(reason instanceof Error ? reason.message : "Google Analytics data is unavailable."); } }); return () => { cancelled = true; }; }, [clientId, client?.googleAnalyticsAccountId, service, ga4DateRange]);
  useEffect(() => { if (!clientId && workspace.clients[0]) setClientId(workspace.clients[0].id); }, [clientId, workspace.clients]);
  useEffect(() => { if (availableModes.length && !availableModes.some((item) => item.name === service)) setService(availableModes[0].name); }, [availableModes, service]);
  useEffect(() => { if (!taskAssignee) setTaskAssignee(workspace.staff.find((member) => member.id === aiTeammate.id)?.id || workspace.staff.find((member) => !member.isBot)?.id || workspace.staff[0]?.id || ""); }, [taskAssignee, workspace.staff]);
  useEffect(() => {
    if (!isAdmin) { setAdsWrite(null); return; }
    let cancelled = false;
    fetchReadWithRetry("/api/google-ads").then(async (response) => { const result = await readApiJson<{ configured: boolean; connected: boolean; apiReady?: boolean; accountEmail?: string; connectedAt?: string; error?: string }>(response, "Google Ads connection"); if (!response.ok) throw new Error(result.error || "Could not read Google Ads connection status."); if (!cancelled) setAdsWrite(result); }).catch((reason) => { if (!cancelled) { setAdsWrite(null); setError(reason instanceof Error ? reason.message : "Could not read Google Ads connection status."); } });
    return () => { cancelled = true; };
  }, [isAdmin]);
  useEffect(() => {
    if (!clientId) { setMessages([]); return; }
    const controller = new AbortController();
    setConfigured(null); setAiProvider(null); setAdsStatus("checking"); setAdsActionCount(0); setSeoStatus("checking");
    setLoadingHistory(true); setError("");
    const query = new URLSearchParams({ clientId, service });
    if (service === "Google Ads" && selectedAdsCampaign) query.set("campaignId", selectedAdsCampaign);
    fetchReadWithRetry(`/api/assistant?${query.toString()}`, { signal: controller.signal })
      .then(async (response) => { const result = await readApiJson<Record<string, any>>(response, "AI Assistant"); if (!response.ok) throw new Error(result.error || "Could not load this chat."); return result; })
      .then((result) => { setConfigured(Boolean(result.configured)); setAiProvider(typeof result.aiProvider === "string" ? result.aiProvider : null); setAdsStatus(result.adsStatus || "not_applicable"); setAdsActionCount(Number(result.adsActionCount || 0)); setSeoStatus(result.seoStatus || "not_applicable"); setMessages(result.messages || []); })
      .catch((reason) => { if (reason.name !== "AbortError") { setConfigured(null); setAdsStatus("checking"); setSeoStatus("checking"); setError(reason instanceof Error ? reason.message : "Couldn’t reach the assistant service. Your saved conversation remains in the workspace."); } })
      .finally(() => { if (!controller.signal.aborted) setLoadingHistory(false); });
    return () => controller.abort();
  }, [clientId, service, connectionAttempt, selectedAdsCampaign]);
  useEffect(() => { setAdsSummary(null); }, [clientId, service]);
  useEffect(() => {
    if (!clientId || service !== "Google Ads") { setAdsSummary(null); return; }
    if (adsDateRange === "custom" && (!adsCustomStart || !adsCustomEnd)) { setAdsSummary(null); setAdsStatus("checking"); setAdsSummaryLoading(false); return; }
    let cancelled = false;
    const controller = new AbortController();
    let inFlight = false;
    let retryTimer = 0;
    let nextDelay = 60_000;
    const refreshSummary = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      setAdsSummaryLoading(true);
      try {
        const query = new URLSearchParams({ clientId, service, summary: "1", range: adsDateRange });
        if (adsDateRange === "custom") { query.set("from", adsCustomStart); query.set("to", adsCustomEnd); }
        const response = await fetchReadWithRetry(`/api/assistant?${query.toString()}`, { signal: controller.signal });
        const result = await readApiJson<Record<string, any>>(response, "Google Ads report");
        if (!response.ok) throw new Error(result.error || "Could not refresh Ads overview.");
        if (!cancelled) { setAdsStatus(result.adsStatus || "unavailable"); setAdsSummary(result.adsSummary || null); }
        nextDelay = 60_000;
      } catch (reason) {
        if (!cancelled && !(reason instanceof Error && reason.name === "AbortError")) {
          setAdsStatus("unavailable");
          nextDelay = Math.min(Math.max(nextDelay, 60_000) * 2, 5 * 60_000);
        }
      } finally {
        inFlight = false;
        if (!cancelled) {
          setAdsSummaryLoading(false);
          retryTimer = window.setTimeout(() => void refreshSummary(), nextDelay);
        }
      }
    };
    void refreshSummary();
    const onVisibility = () => { if (!document.hidden) { window.clearTimeout(retryTimer); void refreshSummary(); } };
    document.addEventListener("visibilitychange", onVisibility);
    return () => { cancelled = true; controller.abort(); window.clearTimeout(retryTimer); document.removeEventListener("visibilitychange", onVisibility); };
  }, [clientId, service, adsDateRange, adsCustomStart, adsCustomEnd]);
  const send = async () => {
    const text = draft.trim();
    if (!clientId || !text || loading) return;
    const requestedAdsDates = service === "Google Ads" ? googleAdsDateSelectionFromMessage(text) : null;
    const requestDateRange = requestedAdsDates?.range || adsDateRange;
    const requestDateStart = requestedAdsDates?.from || (requestedAdsDates ? "" : adsCustomStart);
    const requestDateEnd = requestedAdsDates?.to || (requestedAdsDates ? "" : adsCustomEnd);
    if (service === "Google Ads" && requestDateRange === "custom" && (!requestDateStart || !requestDateEnd)) { setError("Choose both dates, or ask me for a named date range such as ‘August 2026’."); return; }
    if (requestedAdsDates) {
      setAdsDateRange(requestDateRange);
      setAdsCustomStart(requestDateStart);
      setAdsCustomEnd(requestDateEnd);
    }
    const optimistic = { role: "user" as const, content: text, created_at: new Date().toISOString() };
    speechRecognition.current?.stop(); setVoiceListening(false); setVoiceInterim("");
    setDraft(""); setError(""); setLoading(true); setMessages((current) => [...current, optimistic]);
    try {
      const response = await fetch("/api/assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId, service, agentId, message: text, campaignId: service === "Google Ads" ? selectedAdsCampaign : "", adsDateRange: requestDateRange, adsFrom: requestDateStart, adsTo: requestDateEnd }) });
      const result = await readApiJson<Record<string, any>>(response, "AI Assistant");
      if (!response.ok) throw new Error(result.error || "Could not send this message.");
      if (service === "Google Ads" && result.adsReviewPeriod) {
        const period = result.adsReviewPeriod;
        const resolvedRange = period.selection || (period.allTime ? "all_time" : period.label?.startsWith("Today") ? "today" : "custom");
        setAdsDateRange(resolvedRange);
        setAdsCustomStart(resolvedRange === "custom" ? period.startDate || "" : "");
        setAdsCustomEnd(resolvedRange === "custom" ? period.endDate || "" : "");
      }
      for (const action of result.actions || []) {
        if (action.type !== "schedule_task") continue;
        const success = await onScheduleTask({ clientId, service, title: action.title, due: action.due || "", dueAt: action.dueAt || "", repeat: action.repeat || "None", assigneeId: action.assigneeId || "", notes: action.notes || "", campaignId: action.campaignId || "", campaignName: action.campaignName || "" });
        if (!success) throw new Error("The assistant prepared the task, but the workspace could not save it. Please try again.");
      }
      const adsProposal = (result.actions || []).find((action: any) => action.type === "google_ads_change");
      if (adsProposal) setPendingAdsChange(adsProposal);
      setConfigured(true); setAdsStatus(result.adsStatus || "not_applicable"); setSeoStatus(result.seoStatus || "not_applicable"); setMessages((current) => [...current, result.message]);
    } catch (reason) {
      setMessages((current) => current.filter((item) => item !== optimistic));
      setDraft(text); setError(reason instanceof TypeError ? "Couldn’t reach the assistant service. Reload this page and sign in if prompted, then retry. Check the conversation before resending in case the reply was saved." : reason instanceof Error ? reason.message : "Could not send this message.");
    } finally { setLoading(false); }
  };
  const toggleVoiceInput = () => {
    if (voiceListening) { speechRecognition.current?.stop(); setVoiceListening(false); setVoiceInterim(""); return; }
    const speechApi = window as SpeechWindow;
    const SpeechRecognitionCtor = speechApi.SpeechRecognition || speechApi.webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) { setError("Voice input is not supported in this browser. Try Chrome or Edge, or type your message instead."); return; }
    setError("");
    const recognition = new SpeechRecognitionCtor();
    recognition.lang = navigator.language || "en-IE";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      let finalText = "";
      let interimText = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result.isFinal) finalText += result[0].transcript;
        else interimText += result[0].transcript;
      }
      if (finalText.trim()) setDraft((current) => `${current}${current && current.trimEnd() === current ? " " : ""}${finalText.trim()}`);
      setVoiceInterim(interimText.trim());
    };
    recognition.onerror = (event) => {
      setVoiceListening(false); setVoiceInterim(""); speechRecognition.current = null;
      setError(event.error === "not-allowed" || event.error === "service-not-allowed" ? "Allow microphone access in your browser to use voice input." : event.error === "no-speech" ? "I didn’t hear anything. Tap the microphone and try again." : "Voice input stopped. You can retry or type your message.");
    };
    recognition.onend = () => { setVoiceListening(false); setVoiceInterim(""); speechRecognition.current = null; };
    try { speechRecognition.current = recognition; recognition.start(); setVoiceListening(true); }
    catch { speechRecognition.current = null; setVoiceListening(false); setError("Could not start voice input. Check microphone permission and try again."); }
  };
  const speakReply = (text: string, messageId: string) => {
    if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) { setError("Spoken replies are not supported in this browser."); return; }
    if (speakingMessageId === messageId) { window.speechSynthesis.cancel(); setSpeakingMessageId(""); return; }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text.replaceAll("**", ""));
    utterance.lang = navigator.language || "en-IE";
    utterance.onend = () => setSpeakingMessageId("");
    utterance.onerror = () => setSpeakingMessageId("");
    setSpeakingMessageId(messageId);
    window.speechSynthesis.speak(utterance);
  };
  const applyAdsChange = async () => {
    if (!pendingAdsChange || !client || applyingAdsChange) return;
    setApplyingAdsChange(true); setError("");
    try {
      const response = await fetch("/api/google-ads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmed: true, pendingChangeId: pendingAdsChange.pendingChangeId }) });
      const result = await readApiJson<Record<string, any>>(response, "Google Ads change");
      if (!response.ok) throw new Error(result.error || "Google Ads did not apply the change.");
      const label = result.detail || (result.action === "PAUSED" ? "paused" : result.action === "ENABLED" ? "enabled" : "daily budget changed");
      const note = result.provider === "windsor"
        ? `${result.client}: Windsor accepted ${result.campaign} for Google Ads account ${result.campaignId}. ${label}. Applied by ${result.actor || "Sean"}. The app has not independently read back the changed Ads object.`
        : `${result.client}: ${result.campaign} (${result.campaignId}) ${label}. ${result.oldValue} → ${result.newValue}${result.action === "SET_DAILY_BUDGET" ? ` ${pendingAdsChange.currencyCode}/day` : ""}. Applied by ${result.actor || "Sean"} via Google Ads API. ${result.verified ? "Google Ads API read-back confirmed the change." : "Google Ads accepted the request, but read-back could not verify the final state."}`;
      const persisted = await onRecordAdsChange({ clientId, clientName: client.name, note, changedAt: result.changedAt });
      setMessages((current) => [...current, { role: "assistant", content: `✅ ${note}`, created_at: result.changedAt }]);
      setPendingAdsChange(null);
      if (!persisted) setError("Google Ads confirmed the change, but the workspace activity note did not save. The change remains in the Google Ads change log.");
      else setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not apply that Google Ads change."); }
    finally { setApplyingAdsChange(false); }
  };
  const createScheduledTask = async () => {
    if (!client || !taskTitle.trim()) return;
    const dueAt = taskDue ? new Date(`${taskDue}T${taskRunTime}:00`).toISOString() : "";
    const scheduled = await onScheduleTask({ clientId: client.id, service, title: taskTitle, due: taskDue, dueAt, repeat: service === "Sites" ? "None" : taskRepeat, assigneeId: taskAssignee, notes: taskNotes, ...(service === "Sites" && taskReference ? { aiReferenceFileId: taskReference.id, aiReferenceFileName: taskReference.name } : {}) });
    if (!scheduled) return;
    setTaskTitle(""); setTaskNotes(""); setTaskRepeat("None"); setTaskReference(null); setPlannerOpen(false);
  };
  return <>
    <div className="page-heading assistant-page-heading"><div><p className="eyebrow"><AiEyesIcon /> {aiAgentName} · CLIENT WORK</p><h1>AI Assistant</h1><p className="muted">Choose a client and agent at the top of the conversation.</p></div>{client && service === "Google Ads" && (adsWrite || adsStatus !== "checking") && <div className="assistant-connection-summary">{adsWrite && <span className={`assistant-connection-chip ${adsWrite.apiReady ? "connected" : (adsWrite.connected || adsWrite.configured) ? "warning" : "error"}`} title={adsWrite.apiReady ? "Direct Google Ads API access is ready. Every edit still needs your confirmation." : adsWrite.configured ? "Connect the Google login to enable direct account access." : "Direct Google Ads API settings are not configured."}>Direct Ads · {adsWrite.apiReady ? "Ready" : adsWrite.configured ? "Not connected" : "Setup needed"}</span>}{adsStatus !== "checking" && <span className={`assistant-connection-chip ${adsStatus === "connected" || adsStatus === "no_data" ? "connected" : adsStatus === "unavailable" || adsStatus === "missing_key" ? "warning" : "error"}`} title={adsStatus === "connected" ? adsActionCount ? `Live reporting and ${adsActionCount} confirmed-on-submit edit actions are available. The assistant stages edits for your approval.` : "Live Google Ads reporting is connected." : adsStatus === "no_data" ? "The reporting connection is active, but no rows were returned for this date range." : adsStatus === "missing_account" ? "Add this client's Google Ads account ID." : adsStatus === "source_not_connected" ? "Select this Google Ads account in Windsor.ai." : adsStatus === "missing_key" ? "The Windsor API key is missing from the production app." : "The Google Ads reporting connection could not be reached."}>Windsor · {adsStatus === "connected" ? adsActionCount ? `Connected · ${adsActionCount} actions` : "Connected" : adsStatus === "no_data" ? "Connected · no rows" : adsStatus === "missing_account" ? "Account not mapped" : adsStatus === "source_not_connected" ? "Account not selected" : adsStatus === "missing_key" ? "Setup needed" : "Connection issue"}</span>}</div>}</div>
    <div className="assistant-workspace">
      {!workspace.clients.length && <div className="assistant-empty-state">Add a client to start a client-specific conversation.</div>}
      {client && availableModes.length === 0 && <div className="assistant-empty-state">No AI agents are assigned to your account. Ask an administrator to grant access.</div>}
      {client && availableModes.length > 0 && <>
        <section className="assistant-task-planner">
          <div className="assistant-planner-heading"><div><p className="eyebrow">{aiModes.find((item) => item.name === service)?.icon} {client.name} · {service}</p><h2>AI task schedule</h2><p>🧠 Runs with this assistant <span aria-hidden="true">·</span> 🗂️ Updates in Activity</p></div><button type="button" className="primary-button" onClick={() => setPlannerOpen((open) => !open)}>{plannerOpen ? "Close planner" : "＋ Schedule AI task"}</button></div>
          {plannerOpen && <div className="assistant-planner-form">
            <label className="field"><span>Task name</span><input value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} placeholder={`What needs doing for ${service}?`} /></label>
            <div className="assistant-planner-fields"><label className="field"><span>Run date</span><input type="date" value={taskDue} onChange={(event) => setTaskDue(event.target.value)} /></label><label className="field"><span>Run time (your local time)</span><input type="time" value={taskRunTime} onChange={(event) => setTaskRunTime(event.target.value)} /></label>{service === "Sites" ? <div className="field"><span>Repeat</span><p className="form-hint">Runs once to avoid creating duplicate pages.</p></div> : <label className="field"><span>Repeat</span><select value={taskRepeat || "None"} onChange={(event) => setTaskRepeat(event.target.value as Task["repeat"])}><option value="None">Does not repeat</option><option value="Weekly">Weekly</option><option value="Fortnightly">Fortnightly</option><option value="Monthly">Monthly</option><option value="Daily">Daily</option></select></label>}<TeamMemberSelect label="Assign to" value={taskAssignee} members={workspace.staff} onChange={setTaskAssignee} /></div>
            <label className="field"><span>Task instructions</span><textarea rows={2} value={taskNotes} onChange={(event) => setTaskNotes(event.target.value)} placeholder="What should the AI review or do for this client? Include any limits or approvals…" /></label>
            {service === "Sites" && <section className="task-campaign-fields ai-site-reference"><label className="field"><span>🖼️ Page design reference (optional)</span><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={taskReferenceUploading} onChange={async (event) => { const original = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (!original || !client) return; setError(""); setTaskReferenceUploading(true); try { const prepared = await prepareAiTaskReference(original); const uploaded = await onUploadReference(client.id, prepared); setTaskReference({ id: uploaded.id, name: uploaded.name }); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not upload the design reference."); } finally { setTaskReferenceUploading(false); } }} /></label>{taskReferenceUploading ? <p className="form-hint">Preparing and uploading the image…</p> : taskReference ? <p className="form-hint">✅ {taskReference.name} <button type="button" className="text-button" onClick={() => setTaskReference(null)}>Remove</button></p> : <p className="form-hint">The AI will use the image as a visual reference when creating a WordPress draft for {client.name}.</p>}</section>}
            {workspace.staff.find((member) => member.id === taskAssignee)?.isBot ? <p className="assistant-bot-queue-note">The AI will run this task at the selected date and time. It will add its findings and feedback to the task and Activity. Live account or website changes only run when that mode has a working write integration; otherwise the note will say what needs connecting or approval.</p> : <p className="assistant-bot-queue-note">This will be a regular team task assigned to {workspace.staff.find((member) => member.id === taskAssignee)?.name || "a team member"}, not an automatic AI run.</p>}
            <div className="assistant-planner-actions"><small>Scheduled runs are checked every 5 minutes. Recurring tasks schedule their next run after the current run completes.</small><button type="button" className="primary-button" disabled={!taskTitle.trim() || (workspace.staff.find((member) => member.id === taskAssignee)?.isBot && !taskDue)} onClick={createScheduledTask}>Schedule on task board ↗</button></div>
          </div>}
          {scopedTasks.length ? <div className="assistant-scoped-tasks"><div className="assistant-scoped-tasks-heading"><b>🧾 Recent tasks</b><span>{scopedTasks.length}</span></div>{scopedTasks.slice(0, 5).map((task) => <AssistantScopedTaskCard key={task.id} task={task} />)}</div> : <p className="assistant-no-tasks">No tasks for this client and assistant yet.</p>}
          <button type="button" className="text-button assistant-board-link" onClick={onOpenTasks}>Open full task board ↗</button>
        </section>
        <section className="assistant-chat-panel"><div className="assistant-chat-head"><span className="assistant-large-icon"><AiEyesIcon /></span><div className="assistant-chat-title"><h2>{client.name} · {service}</h2><p>Client and agent chat</p></div><div className="assistant-header-contexts">{workspace.clients.length > 1 && <label className="assistant-context-select assistant-client-context"><span>Client</span><Select value={clientId} onValueChange={setClientId}><SelectTrigger aria-label="Choose client" className="assistant-client-select-trigger"><SelectValue /></SelectTrigger><SelectContent className="assistant-client-select-content" position="popper" align="start">{workspace.clients.map((item) => <SelectItem key={item.id} value={item.id} className="assistant-client-select-item"><span className="assistant-client-option-mark" style={{ backgroundColor: item.color }}>{item.logo ? <img src={item.logo} alt="" /> : <span aria-hidden="true">{initials(item.name).slice(0, 1)}</span>}</span><span className="assistant-client-option-name">{item.name}</span></SelectItem>)}</SelectContent></Select></label>}<label className="assistant-context-select assistant-agent-context"><span>Agent</span><select aria-label="Choose AI agent" value={service} onChange={(event) => setService(event.target.value as AiMode)}>{availableModes.map((item) => <option key={item.name} value={item.name}>{item.icon} {item.name}</option>)}</select></label>{aiEmployees.length > 0 && <div className="assistant-context-select assistant-agent-pick"><TeamMemberSelect label="AI employee" value={agentId} members={aiEmployees} onChange={(next) => setAgentId(next || agentId)} /></div>}</div><span className={`assistant-connection-state ${configured === true ? "connected" : configured === false ? "status-error" : "status-warning"}`}>{configured === null ? (loadingHistory ? "Connecting…" : "Connection unavailable") : configured ? `AI connected${aiProvider ? " · " + aiProvider : ""}` : "Setup needed"}</span>{isAdmin && service === "Google Ads" && adsWrite?.configured && !adsWrite.connected && <a className="assistant-header-action" href="/api/google-ads/connect">Connect Ads</a>}{isAdmin && <button type="button" className="assistant-header-action" onClick={() => setPromptEditorOpen((open) => !open)}>{promptEditorOpen ? "Close instructions" : "Agent instructions"}</button>}</div>
          {isAdmin && promptEditorOpen && <section className="assistant-prompt-editor"><div className="assistant-prompt-heading"><div><b>Instructions for {service}</b><small>Extra guidance for this agent.</small></div></div><textarea maxLength={4000} rows={3} value={promptDraft} onChange={(event) => { setPromptDraft(event.target.value); setPromptSaved(false); }} placeholder={`Add guidance for ${service}…`} /><div className="assistant-prompt-actions"><small>{promptDraft.length}/4000{promptSaved ? " · Saved" : ""}</small><button type="button" className="primary-button" disabled={savingPrompt} onClick={async () => { setSavingPrompt(true); const saved = await onSavePrompt(service, promptDraft); setSavingPrompt(false); setPromptSaved(saved); }}>{savingPrompt ? "Saving…" : "Save instructions"}</button></div></section>}
          {configured === false && <div className="report-connection-note status-error"><b>🔌 OpenRouter API key missing</b><span>Add OPENROUTER_API_KEY as an encrypted Worker secret. Model usage is billed through OpenRouter.</span></div>}
          {(service === "SEO" || service === "Audit") && seoStatus !== "checking" && <div className={`report-connection-note assistant-ads-status ${seoStatus === "connected" || seoStatus === "no_data" ? "is-connected" : seoStatus === "unavailable" || seoStatus === "missing_key" ? "status-warning" : "status-error"}`}><b>{seoStatus === "connected" ? "🟢 Search Console data connected" : seoStatus === "missing_account" ? "🔌 This client’s Search Console site isn’t mapped" : seoStatus === "source_not_connected" ? "🔌 Windsor Search Console connection needed" : seoStatus === "missing_key" ? "🔌 Windsor API key missing" : seoStatus === "no_data" ? "⚠️ Search Console connected · no rows returned" : "🔌 Search Console data unavailable"}</b><span>{seoStatus === "connected" ? `Read-only Search Console data from ${client.googleSearchConsoleAccountId} is included (last 30 days; the newest few days can be incomplete).` : seoStatus === "missing_account" ? "Connect Search Console in Windsor.ai, select the property, then add its exact property ID to this client’s record." : seoStatus === "source_not_connected" ? "The app key works, but no Search Console property is selected in Windsor.ai. Connect Google Search Console, grant access, select the site and finish the Windsor setup." : seoStatus === "missing_key" ? "Add the Windsor API key as the Cloudflare Production secret WINDSOR_API_KEY." : seoStatus === "unavailable" ? "Windsor could not read the mapped property. Check its authorization and exact property ID in the client record." : seoStatus === "no_data" ? "The connector responded but returned no data for the selected property and date range." : ""}</span></div>}
          {service === "Audit" && adsStatus !== "checking" && <div className={`report-connection-note assistant-ads-status ${adsStatus === "connected" || adsStatus === "no_data" ? "is-connected" : adsStatus === "unavailable" || adsStatus === "missing_key" ? "status-warning" : "status-error"}`}><b>{adsStatus === "connected" ? "🟢 Google Ads data connected" : adsStatus === "missing_account" ? "Google Ads account not mapped" : adsStatus === "source_not_connected" ? "Windsor Google Ads connection needed" : adsStatus === "missing_key" ? "Windsor API key missing" : adsStatus === "no_data" ? "Google Ads connected · no rows returned" : "Google Ads data unavailable"}</b><span>{adsStatus === "connected" ? `Read-only account ${client.googleAdsAccountId} is included in this audit.` : adsStatus === "missing_account" ? "Add this client’s exact Windsor Ads account ID in its client record." : adsStatus === "source_not_connected" ? "No Google Ads account is selected in Windsor.ai for this connection." : adsStatus === "unavailable" ? "Windsor could not read this mapped account; check access and the saved account ID." : ""}</span></div>}
          {service === "SEO" && client.googleAnalyticsAccountId && <section className={"assistant-ads-overview " + (ga4Overview?.status === "connected" ? "connected" : ga4Overview?.status === "checking" ? "loading" : "unavailable")} aria-label="Google Analytics 4 overview">
            <div className="assistant-ads-overview-heading"><div><b><span className="ads-google-word">Google</span> Analytics overview</b><span>{ga4Overview?.accountName || "Selected client property"} · {ga4Overview?.range || (ga4DateRange === "all_time" ? "All time" : "Last 30 days")} · {ga4Overview?.status === "connected" ? "Updated " + new Intl.DateTimeFormat("en-IE", { hour: "2-digit", minute: "2-digit" }).format(new Date(ga4Overview.updatedAt)) : ga4Overview?.status === "checking" ? "Loading live data…" : ga4Overview?.message || "Analytics unavailable"}</span></div><div className="assistant-ads-overview-controls"><label className="assistant-ads-date-picker"><span>Date range</span><select aria-label="Choose Google Analytics date range" value={ga4DateRange} onChange={(event) => setGa4DateRange(event.target.value)}><option value="last_30d">Last 30 days</option><option value="all_time">All time</option></select></label><span className="assistant-ads-live-indicator"><i /> {ga4Overview?.status === "connected" ? "Live" : ga4Overview?.status === "checking" ? "Loading" : "Status"}</span></div></div>
            {ga4Overview?.status === "connected" && <div className="assistant-ads-metrics">{[
              { label: "Sessions", value: Number(ga4Overview.totals.sessions || 0).toLocaleString("en-IE") },
              { label: "Active users", value: Number(ga4Overview.totals.active_users || 0).toLocaleString("en-IE") },
              { label: "Engaged sessions", value: Number(ga4Overview.totals.engaged_sessions || 0).toLocaleString("en-IE") },
              { label: "Engagement rate", value: ga4Overview.totals.engagement_rate == null ? "—" : (Number(ga4Overview.totals.engagement_rate) * 100).toFixed(1) + "%" },
              { label: "Key events", value: Number(ga4Overview.totals.conversions || 0).toLocaleString("en-IE") },
            ].map((metric) => <div className="assistant-ads-metric" key={metric.label}><span>{metric.label}</span><b>{metric.value}</b></div>)}</div>}
            {ga4Overview?.status === "not_mapped" && <p className="assistant-ads-empty">{ga4Overview.message}</p>}
            {ga4Overview?.status === "unavailable" && <p className="assistant-ads-empty">{ga4Overview.message}</p>}
          </section>}          {service === "Google Ads" && <section className={"assistant-ads-overview " + (adsStatus === "connected" ? "connected" : adsStatus === "no_data" ? "no-data" : adsStatus === "checking" ? "loading" : "unavailable")} aria-label="Live Google Ads overview">
            <div className="assistant-ads-overview-heading">
              <div>
                <b><span className="ads-google-word">Google</span> <span className="ads-brand-word">Ads</span> overview</b>
                <span>{selectedCampaignData?.name || (selectedAdsCampaign ? "Selected campaign" : "All campaigns")} · {adsSummary?.range || "Last 30 days"} · {adsSummaryLoading ? "Updating…" : adsSummary?.updatedAt ? "Updated " + new Intl.DateTimeFormat("en-IE", { hour: "2-digit", minute: "2-digit" }).format(new Date(adsSummary.updatedAt)) : adsStatus === "checking" ? "Loading live data…" : adsStatus === "no_data" ? "No report rows in this period" : adsStatus === "missing_account" ? "Connect an Ads account to this client" : adsStatus === "source_not_connected" ? "Select this account in Windsor" : adsStatus === "missing_key" ? "Windsor API key missing" : "Live report unavailable"}</span>
              </div>
              <div className="assistant-ads-overview-controls">
                <label className="assistant-ads-campaign-picker"><span>Campaign</span><select aria-label="Choose Google Ads campaign" value={selectedAdsCampaign} onChange={(event) => setSelectedAdsCampaign(event.target.value)}><option value="">All campaigns</option>{selectedAdsCampaign && !selectedCampaignData && <option value={selectedAdsCampaign}>Selected campaign · no report rows</option>}{(adsSummary?.campaigns || []).map((campaign) => <option key={campaign.id + "-" + campaign.name} value={campaign.id}>{campaign.name} · {campaign.status}</option>)}</select></label>
                <label className="assistant-ads-date-picker"><span>Date range</span><select aria-label="Choose Google Ads date range" value={adsDateRange} onChange={(event) => setAdsDateRange(event.target.value)}><option value="today">Today</option><option value="last_3d">Last 3 days</option><option value="last_7d">Last 7 days</option><option value="last_30d">Last 30 days</option><option value="last_90d">Last 90 days</option><option value="all_time">All time</option><option value="custom">Custom dates</option></select></label>
                {adsDateRange === "custom" && <div className="assistant-ads-custom-dates"><label><span>From</span><input type="date" aria-label="Start date" value={adsCustomStart} max={adsCustomEnd || undefined} onChange={(event) => setAdsCustomStart(event.target.value)} /></label><label><span>To</span><input type="date" aria-label="End date" value={adsCustomEnd} min={adsCustomStart || undefined} max={new Date(Date.now() - 86400000).toISOString().slice(0, 10)} onChange={(event) => setAdsCustomEnd(event.target.value)} /></label></div>}
                <span className="assistant-ads-live-indicator"><i /> {adsStatus === "connected" ? "Live" : adsStatus === "no_data" ? "No data" : "Status"}</span>
              </div>
            </div>
            {(adsSummary?.rowCount || selectedAdsCampaign && selectedCampaignData) && adsOverviewTotals ? <div className="assistant-ads-metrics">{[
              { label: "Clicks", value: adsOverviewTotals.clicks.toLocaleString("en-IE") },
              { label: "CTR", value: adsOverviewTotals.ctrPercent.toFixed(2) + "%" },
              { label: "Conversions", value: adsOverviewTotals.conversions.toLocaleString("en-IE", { maximumFractionDigits: 2 }) },
              { label: "Cost per conversion", value: adsOverviewTotals.costPerConversion === null ? "—" : adsOverviewTotals.costPerConversion.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) },
              { label: selectedAdsCampaign ? "Campaign spend · account currency" : "Overall spend · account currency", value: adsOverviewTotals.spend.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) },
            ].map((metric) => <div className="assistant-ads-metric" key={metric.label}><span>{metric.label}</span><b>{metric.value}</b></div>)}</div> : <p className="assistant-ads-overview-empty">{adsDateRange === "custom" && (!adsCustomStart || !adsCustomEnd) ? "Choose both dates to load this report." : selectedAdsCampaign && adsStatus === "connected" ? "No report rows for the selected campaign and date range." : adsStatus === "no_data" ? "The account connected successfully, but returned no campaign data for this period." : adsStatus === "checking" ? "Fetching the latest account totals." : adsStatus === "missing_account" ? "Add this client’s Google Ads account ID to show live totals." : adsStatus === "source_not_connected" ? "Connect and select the client’s Google Ads account in Windsor.ai." : adsStatus === "missing_key" ? "Add the Windsor API key to the production app." : "Could not retrieve this account’s live totals. Check the connection and try again."}</p>}
          </section>}
          <div className="assistant-messages" aria-live="polite">{loadingHistory ? <div className="empty-note">Loading this conversation…</div> : messages.length ? messages.map((message, index) => { const timestamp = message.created_at && Number.isFinite(Date.parse(message.created_at)) ? new Intl.DateTimeFormat("en-IE", { hour: "2-digit", minute: "2-digit" }).format(new Date(message.created_at)) : ""; const scheduledByAi = message.created_by?.startsWith("scheduled-task:"); const sender = message.role === "assistant" || scheduledByAi ? `${aiAgentName}${scheduledByAi && message.role === "user" ? " · scheduled task" : " · " + service}` : "You"; return <article className={`assistant-message ${message.role}`} key={`${message.created_at || index}-${index}`}><b>{sender}</b><p>{renderAssistantText(message.content)}</p>{message.role === "assistant" && <div className="assistant-message-actions"><button type="button" className="assistant-speak-button" onClick={() => speakReply(message.content, message.created_at || String(index))} aria-label={speakingMessageId === (message.created_at || String(index)) ? "Stop spoken reply" : "Play spoken reply"} title={speakingMessageId === (message.created_at || String(index)) ? "Stop" : "Listen to this reply"}>{speakingMessageId === (message.created_at || String(index)) ? "■" : "🔊"}</button>{timestamp && <time className="assistant-message-time" dateTime={message.created_at}>{timestamp}</time>}</div>}{message.role === "user" && timestamp && <time className="assistant-message-time" dateTime={message.created_at}>{timestamp}</time>}</article>; }) : <div className="empty-note">Ask a question about {client.name}’s {service} work. This conversation is saved separately from every other client and service.</div>}{loading && <article className="assistant-message assistant"><b>{aiAgentName} · {service}</b><p>Thinking…</p><time className="assistant-message-time">Now</time></article>}</div>
          {pendingAdsChange && pendingAdsChange.clientName === client.name && service === "Google Ads" && <div className="assistant-ads-proposal"><b>Google Ads change needs your approval</b><span>{pendingAdsChange.clientName} · {pendingAdsChange.campaignName} · {pendingAdsChange.campaignId}</span><span>{pendingAdsChange.summary || (pendingAdsChange.changeType === "SET_DAILY_BUDGET" ? `Daily budget: ${pendingAdsChange.currencyCode} ${pendingAdsChange.oldValue} → ${pendingAdsChange.currencyCode} ${pendingAdsChange.newValue}` : `Campaign status: ${pendingAdsChange.oldValue} → ${pendingAdsChange.newValue}`)}</span><small>This approval stays available until you decide. Nothing changes until you confirm.</small><div><button type="button" className="secondary-button" disabled={applyingAdsChange} onClick={() => setPendingAdsChange(null)}>Cancel</button><button type="button" className="primary-button" disabled={applyingAdsChange} onClick={() => void applyAdsChange()}>{applyingAdsChange ? "Applying…" : "Confirm and apply"}</button></div></div>}
          {error && <p className="form-error">{error}</p>}{configured === null && !loadingHistory && error && <button type="button" className="secondary-button" onClick={() => setConnectionAttempt((attempt) => attempt + 1)}>Retry connection ↻</button>}
          <div className="assistant-composer"><div className="assistant-input-wrap"><textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder={"Ask about " + client.name + " · " + service + "…"} rows={2} disabled={configured !== true || loading} /><button type="button" className={"assistant-voice-button " + (voiceListening ? "listening" : "")} onClick={toggleVoiceInput} disabled={loading} aria-label={voiceListening ? "Stop voice input" : "Start voice input"} title={voiceListening ? "Stop listening" : "Dictate a message"}>{voiceListening ? "■" : "🎙"}</button>{voiceListening && <small className="assistant-voice-status" role="status">{voiceInterim || "Listening…"}</small>}</div><button className="primary-button" onClick={() => void send()} disabled={configured !== true || loading || !draft.trim()}>{loading ? "Working…" : "Send ↗"}</button></div>
          <small className="assistant-privacy-note">Client Vault logins are never sent to the assistant.</small>
        </section>
      </>}
    </div>
  </>;
}


const TAX_EXPENSE_CATEGORIES = ["Software & subscriptions", "Advertising & marketing", "Travel & vehicle", "Equipment", "Office & utilities", "Professional fees", "Wages & subcontractors", "Insurance", "Stock & materials", "Business entertainment (not deductible)", "Other"];
const AD_SPEND_CATEGORY = "Advertising & marketing";
const isNonDeductible = (category: string) => /not deductible/i.test(category);
const AD_SPEND_AUTO_PREFIX = "auto-ads-";
const AD_SPEND_SOURCES = [
  { key: "google", label: "Google Ads", endpoint: "/api/google-ads/workspace", account: (client: Client) => String(client.googleAdsAccountId || "").replace(/\D/g, ""), daily: (json: any) => (json?.current?.daily || []).map((day: any) => ({ date: String(day.date || ""), spend: Number(day.spend) || 0 })) },
  { key: "meta", label: "Meta Ads", endpoint: "/api/meta-ads/workspace", account: (client: Client) => String(client.metaAdsAccountId || "").replace(/^act_/i, "").replace(/\D/g, ""), daily: (json: any) => (json?.current?.dailySpend || []).map((day: any) => ({ date: String(day.date || ""), spend: Number(day.spend) || 0 })) },
] as const;
// The agency's service fees are a business expense for the client. They come straight from the
// client's services (or monthly fee) and are added as one virtual expense per month — never saved,
// so a fee change is reflected everywhere at once.
const AGENCY_FEE_PREFIX = "auto-fee-";
function clientMonthlyFee(client: Client) { return Number(client.monthlyBudget) || (client.services || []).reduce((sum, service) => sum + (Number((service as { fee?: number }).fee) || 0), 0); }
function clientBookEntries(client: Client, agencyName = "F2B Media"): TaxBookEntry[] {
  const saved = client.taxBooks?.entries || [];
  const fee = clientMonthlyFee(client);
  if (!(fee > 0)) return saved;
  const now = new Date(); const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const earliest = saved.map((entry) => entry.date.slice(0, 7)).filter((month) => /^\d{4}-\d{2}$/.test(month)).sort()[0];
  let month = /^\d{4}-\d{2}$/.test(client.taxBooks?.feesFrom || "") ? client.taxBooks!.feesFrom! : earliest && earliest <= current ? earliest : current;
  const fees: TaxBookEntry[] = [];
  for (let guard = 0; month <= current && guard < 120; guard += 1) {
    const [y, m] = month.split("-").map(Number);
    fees.push({ id: `${AGENCY_FEE_PREFIX}${month}`, kind: "Expense", date: `${month}-01`, description: `${agencyName} service fees · ${new Date(y, m - 1, 1).toLocaleDateString("en-IE", { month: "long", year: "numeric" })}`, category: "Professional fees", amount: fee });
    const next = new Date(y, m, 1); month = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
  }
  return [...fees, ...saved];
}
// Pulls this year's ad spend from the client's connected Google / Meta Ads accounts and writes one expense per platform per month.
async function fetchAutoAdSpendEntries(client: Client, year: number): Promise<{ entries: TaxBookEntry[]; synced: string[]; errors: string[] }> {
  const today = new Date(); const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  const to = localDateKey(yesterday); const from = `${year}-01-01`;
  const entries: TaxBookEntry[] = []; const synced: string[] = []; const errors: string[] = [];
  if (to < from) return { entries, synced, errors };
  for (const source of AD_SPEND_SOURCES) {
    if (!source.account(client)) continue;
    try {
      const response = await fetch(`${source.endpoint}?clientId=${encodeURIComponent(client.id)}&range=custom&from=${from}&to=${to}`, { cache: "no-store" });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json || !["connected", "no_data"].includes(json.status)) { errors.push(`${source.label}: ${json?.message || json?.error || `couldn’t load (HTTP ${response.status})`}`); continue; }
      const months = new Map<string, number>();
      for (const day of source.daily(json)) { if (!day.date.startsWith(String(year)) || !(day.spend > 0)) continue; const month = day.date.slice(0, 7); months.set(month, (months.get(month) || 0) + day.spend); }
      for (const [month, spend] of months) {
        const [y, m] = month.split("-").map(Number); const monthEnd = localDateKey(new Date(y, m, 0));
        const label = new Date(y, m - 1, 1).toLocaleDateString("en-IE", { month: "long", year: "numeric" });
        entries.push({ id: `${AD_SPEND_AUTO_PREFIX}${source.key}-${month}`, kind: "Expense", date: monthEnd > to ? to : monthEnd, description: `${source.label} spend · ${label}`, category: AD_SPEND_CATEGORY, amount: Math.round(spend * 100) / 100 });
      }
      synced.push(source.label);
    } catch { errors.push(`${source.label}: couldn’t reach the ads connection`); }
  }
  return { entries, synced, errors };
}
// Irish 2026 rates (Budget 2026): income tax 20%/40% (single cut-off €44,000, joint one-earner €53,000), USC, self-employed PRSI, 12.5% corporation tax on trading profits.
function ClientTaxTracker({ client, onSave, taxSettings, range, rangeLabel = "Year to date" }: { client: Client; onSave?: (client: Client) => void; taxSettings?: TaxSettings; range?: { start: string; end: string }; rangeLabel?: string }) {
  const country = taxCountry(taxSettings); const countryLabel = TAX_COUNTRIES.find((item) => item.code === country)?.label || "Ireland";
  const books: ClientTaxBooks = { ...(client.taxBooks || { entries: [] }), businessType: client.taxBooks?.businessType || taxSettings?.defaultBusinessType, entries: client.taxBooks?.entries || [] };
  const year = new Date().getFullYear();
  const [draft, setDraft] = useState({ kind: "Expense" as "Income" | "Expense", date: localDateKey(), description: "", category: TAX_EXPENSE_CATEGORIES[0], amount: "" });
  const [showAll, setShowAll] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [adSync, setAdSync] = useState<{ busy: boolean; note: string }>({ busy: false, note: "" });
  const adSyncStarted = useRef(false);
  const hasAdAccounts = AD_SPEND_SOURCES.some((source) => source.account(client));
  const save = (next: ClientTaxBooks) => onSave?.({ ...client, taxBooks: next });
  const allEntries = clientBookEntries(client);
  const feeFrom = allEntries.find((entry) => entry.id.startsWith(AGENCY_FEE_PREFIX))?.date.slice(0, 7) || "";
  const entries = allEntries.filter((entry) => entry.date.startsWith(String(year)));
  const income = entries.filter((e) => e.kind === "Income").reduce((sum, e) => sum + e.amount, 0);
  const expenses = entries.filter((e) => e.kind === "Expense").reduce((sum, e) => sum + e.amount, 0);
  const inPeriod = (date: string) => range ? (!range.start || date >= range.start) && (!range.end || date <= range.end) : date.startsWith(String(year));
  const periodEntries = allEntries.filter((entry) => inPeriod(entry.date));
  const periodIncome = periodEntries.filter((e) => e.kind === "Income").reduce((sum, e) => sum + e.amount, 0);
  const periodExpenses = periodEntries.filter((e) => e.kind === "Expense").reduce((sum, e) => sum + e.amount, 0);
  const adSpend = periodEntries.filter((e) => e.kind === "Expense" && e.category === AD_SPEND_CATEGORY).reduce((sum, e) => sum + e.amount, 0);
  const periodProfit = periodIncome - periodEntries.filter((e) => e.kind === "Expense" && !isNonDeductible(e.category)).reduce((sum, e) => sum + e.amount, 0);
  const periodName = rangeLabel.toLowerCase();
  const deductible = entries.filter((e) => e.kind === "Expense" && !isNonDeductible(e.category)).reduce((sum, e) => sum + e.amount, 0);
  const profit = income - deductible;
  const monthsElapsed = Math.max(1, new Date().getMonth() + 1 - 1 + new Date().getDate() / 30);
  const projectedProfit = Math.max(0, profit) / Math.min(12, monthsElapsed) * 12;
  const byCategory = Object.entries(entries.filter((e) => e.kind === "Expense").reduce<Record<string, number>>((acc, e) => { acc[e.category] = (acc[e.category] || 0) + e.amount; return acc; }, {})).sort((a, b) => b[1] - a[1]);
  const household = books.household || "single", other = books.otherIncome || 0;
  const personalNow = estimatePersonalTax(country, Math.max(0, profit), other, household, taxSettings), personalYear = estimatePersonalTax(country, projectedProfit, other, household, taxSettings);
  const company = estimateCompanyTax(country, profit, taxSettings), companyYear = estimateCompanyTax(country, projectedProfit, taxSettings);
  const band = personalYear.bandLimit;
  const higherRateAmount = personalYear.higherRateAmount;
  const eur = (n: number) => money(n);
  const add = () => {
    const amount = Number(String(draft.amount).replace(/,/g, ""));
    if (!draft.description.trim() || !(amount > 0)) return;
    save({ ...books, entries: [{ id: crypto.randomUUID(), kind: draft.kind, date: draft.date, description: draft.description.trim(), category: draft.kind === "Income" ? "Income" : (draft.category || "Other"), amount }, ...books.entries] });
    setDraft({ ...draft, description: "", amount: "" });
  };
  const syncAdSpend = async (manual = false) => {
    if (!hasAdAccounts || !onSave) return;
    setAdSync({ busy: true, note: "Syncing ad spend…" });
    const result = await fetchAutoAdSpendEntries(client, year);
    const syncedKeys = AD_SPEND_SOURCES.filter((source) => result.synced.includes(source.label)).map((source) => `${AD_SPEND_AUTO_PREFIX}${source.key}-${year}-`);
    const kept = books.entries.filter((entry) => !syncedKeys.some((prefix) => entry.id.startsWith(prefix)));
    const next = [...result.entries, ...kept];
    const signature = (list: TaxBookEntry[]) => list.filter((entry) => entry.id.startsWith(AD_SPEND_AUTO_PREFIX)).map((entry) => `${entry.id}:${entry.amount}:${entry.date}`).sort().join("|");
    if (signature(next) !== signature(books.entries)) save({ ...books, entries: next });
    try { localStorage.setItem(`f2b-adspend-sync-${client.id}`, localDateKey()); } catch { /* storage unavailable */ }
    const time = new Date().toLocaleTimeString("en-IE", { hour: "2-digit", minute: "2-digit" });
    setAdSync({ busy: false, note: result.synced.length ? `${result.synced.join(" + ")} spend synced automatically · ${time}${result.errors.length ? ` · ${result.errors.join("; ")}` : ""}` : result.errors.join("; ") || (manual ? "No ad spend found yet this year." : "") });
  };
  useEffect(() => {
    if (adSyncStarted.current || !hasAdAccounts || !onSave || !books.businessType) return;
    adSyncStarted.current = true;
    let last = ""; try { last = localStorage.getItem(`f2b-adspend-sync-${client.id}`) || ""; } catch { /* storage unavailable */ }
    if (last !== localDateKey()) void syncAdSpend();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client.id, hasAdAccounts, books.businessType]);
  const sorted = [...periodEntries].sort((a, b) => b.date.localeCompare(a.date));
  const visible = showAll ? sorted : sorted.slice(0, 8);
  if (!books.businessType) return <section className="panel client-tax" aria-label="Business type"><div className="client-tax-head"><div><p className="eyebrow">💶 EXPENSES & TAX · {countryLabel.toUpperCase()}</p><h2>Is {client.name} a sole trader or a company?</h2><p>This decides how tax is estimated: personal income tax and social charges for a sole trader, or company tax for a limited company. (Change the country in Settings → Tax.)</p></div></div><div className="client-tax-choice"><button type="button" disabled={!onSave} onClick={() => save({ ...books, businessType: "sole_trader", household: "single" })}><b>👤 Sole trader</b><small>Personal income tax + social charges</small></button><button type="button" disabled={!onSave} onClick={() => save({ ...books, businessType: "company" })}><b>🏢 Company</b><small>Company / corporation tax on profit</small></button></div></section>;
  return <section className="panel client-tax" aria-label="Expenses and tax tracker">
    <div className="client-tax-head"><div><p className="eyebrow">💶 EXPENSES & TAX · {countryLabel.toUpperCase()} · {year}</p><h2>{client.name} · {books.businessType === "company" ? "Company" : "Sole trader"}</h2><p>Log income and expenses; the tax estimate updates as you go.</p></div>{onSave && <div className="client-tax-type"><button type="button" className={books.businessType === "sole_trader" ? "selected" : ""} onClick={() => save({ ...books, businessType: "sole_trader" })}>👤 Sole trader</button><button type="button" className={books.businessType === "company" ? "selected" : ""} onClick={() => save({ ...books, businessType: "company" })}>🏢 Company</button></div>}</div>
    <div className="client-tax-stats"><div><small>Income · {periodName}</small><b>{eur(periodIncome)}</b></div><div><small>Expenses · {periodName}</small><b>{eur(periodExpenses)}</b></div><div><small>Ad spend · {periodName}</small><b>{eur(adSpend)}</b></div><div><small>Taxable profit · {periodName}</small><b>{eur(periodProfit)}</b></div><div className="accent"><small>{books.businessType === "company" ? "Corporation tax so far" : "Tax so far"} · {year}</small><b>{eur(books.businessType === "company" ? company.tax : personalNow.total)}</b></div></div>
    <div className="finance-actions client-tax-actions"><button type="button" className="secondary-button income-button" onClick={() => { setDraft({ ...draft, kind: "Income" }); setFormOpen(true); }}>＋ Add income</button><button type="button" className="secondary-button expense-button" onClick={() => { setDraft({ ...draft, kind: "Expense", category: draft.category === AD_SPEND_CATEGORY ? TAX_EXPENSE_CATEGORIES[0] : draft.category }); setFormOpen(true); }}>＋ Add expense</button><button type="button" className="secondary-button expense-button" onClick={() => { setDraft({ ...draft, kind: "Expense", category: AD_SPEND_CATEGORY, description: draft.description || "Ad spend" }); setFormOpen(true); }}>＋ Add ad spend</button></div>
    {feeFrom && <div className="client-tax-adsync"><small>Service fees of {eur(clientMonthlyFee(client))}/month are added as an expense automatically from the client’s services.</small>{onSave && <label className="client-tax-fees-from">Tracked from <input type="month" value={feeFrom} max={localDateKey().slice(0, 7)} onChange={(event) => { if (/^\d{4}-\d{2}$/.test(event.target.value)) save({ ...books, feesFrom: event.target.value }); }} /></label>}</div>}
    {hasAdAccounts && <div className="client-tax-adsync"><small>{adSync.note || "Ad spend from the connected Google / Meta Ads account is added here automatically each day."}</small>{onSave && <button type="button" className="text-button" disabled={adSync.busy} onClick={() => void syncAdSpend(true)}>{adSync.busy ? "Syncing…" : "⟳ Sync ad spend now"}</button>}</div>}
    {formOpen && <div className="client-tax-add"><h3>Add {draft.kind === "Expense" && draft.category === AD_SPEND_CATEGORY ? "ad spend" : draft.kind.toLowerCase()}</h3><div className="client-tax-form"><select aria-label="Type" value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value as "Income" | "Expense" })}><option>Expense</option><option>Income</option></select>{draft.kind === "Expense" && <select aria-label="Category" value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })}>{TAX_EXPENSE_CATEGORIES.map((category) => <option key={category} value={category}>{category === AD_SPEND_CATEGORY ? "Ad spend (advertising & marketing)" : category}</option>)}</select>}<input type="date" aria-label="Date" value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} /><input aria-label="Description" placeholder="What was it?" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /><input aria-label="Amount" inputMode="decimal" placeholder="Amount" value={draft.amount} onChange={(event) => setDraft({ ...draft, amount: event.target.value.replace(/[^0-9.,]/g, "") })} onKeyDown={(event) => { if (event.key === "Enter") add(); }} /><button type="button" disabled={!onSave} onClick={() => { add(); }}>＋ Add</button><button type="button" onClick={() => setFormOpen(false)}>Cancel</button></div></div>}
    <div className="client-tax-list"><h3>Records · {periodName}</h3>{visible.length ? visible.map((entry) => <div key={entry.id} className={entry.kind === "Income" ? "income" : "expense"}><span>{entry.date}</span><b>{entry.description}</b><strong>{entry.kind === "Income" ? "+" : "−"}{eur(entry.amount)}</strong>{entry.id.startsWith(AGENCY_FEE_PREFIX) ? <small className="client-tax-auto" title="Added automatically from this client's services">Auto</small> : onSave && <button type="button" className="file-icon-btn file-icon-danger" title="Delete" aria-label={`Delete ${entry.description}`} onClick={() => save({ ...books, entries: books.entries.filter((item) => item.id !== entry.id) })}>🗑</button>}</div>) : <p className="muted">Nothing logged yet. Add your first expense or payment above.</p>}{sorted.length > 8 && <button type="button" className="secondary-button" onClick={() => setShowAll((v) => !v)}>{showAll ? "Show fewer" : `Show all ${sorted.length}`}</button>}</div>
    <div className="client-tax-section"><h3>🧾 Tax estimate · full year {year}</h3>
    {books.businessType === "sole_trader" ? <div className="client-tax-calc">
      <div className="client-tax-inputs">{country === "IE" && <label>Household<select value={household} onChange={(event) => save({ ...books, household: event.target.value as "single" | "joint" })}><option value="single">Single (standard band €44,000)</option><option value="joint">Married, one income (€53,000)</option></select></label>}<label>Other yearly income (e.g. a wage)<input inputMode="decimal" value={other ? other.toLocaleString("en-IE") : ""} placeholder="0" onChange={(event) => save({ ...books, otherIncome: Number(event.target.value.replace(/[^0-9.]/g, "")) || 0 })} /></label></div>
      <div className="client-tax-rows">{personalYear.lines.map((line) => <div key={line.label}><span>{line.label}</span><b>{eur(line.amount)}</b></div>)}<div className="total"><span>Projected tax for {year}</span><b>{eur(personalYear.total)}</b></div><div><span>Set aside each month</span><b>{eur(personalYear.monthly)}</b></div></div>
      {personalYear.bandLabel && (higherRateAmount > 0 ? <p className="client-tax-warn">⚠️ Projected income is over the {personalYear.bandLabel}. {eur(higherRateAmount)} of it is taxed at the higher {personalYear.higherRate} rate.</p> : <p className="client-tax-ok">✅ Projected income is under the {personalYear.bandLabel} ({eur(Math.max(0, band - other - projectedProfit))} left before the higher {personalYear.higherRate} rate applies).</p>)}
      <small className="client-tax-note">Based on projected full-year profit of {eur(projectedProfit)}. {personalYear.deadline}</small>
    </div> : <div className="client-tax-calc">
      <div className="client-tax-rows"><div><span>{company.rateLabel}</span><b>{eur(company.tax)}</b></div><div className="total"><span>Projected company tax for {year}</span><b>{eur(companyYear.tax)}</b></div><div><span>Profit left in the company after tax</span><b>{eur(companyYear.afterTax)}</b></div></div>
      <small className="client-tax-note">{company.note}</small>
    </div>}
    </div>
    <small className="client-tax-note">Estimates only, not tax advice. Check figures with your accountant before filing.</small>
  </section>;
}
// Live ad spend for the Overview: reads Google / Meta Ads directly for the selected
// finance period (cached for 30 minutes per browser), so it shows even before the
// Expenses & Tax tracker has synced its monthly expense entries.
function useLiveAdSpend(clients: Client[], start: string, end: string) {
  const [state, setState] = useState<{ total: number; clients: number; loading: boolean; errors: string[] }>({ total: 0, clients: 0, loading: false, errors: [] });
  const withAds = clients.filter((client) => AD_SPEND_SOURCES.some((source) => source.account(client)));
  const key = withAds.map((client) => `${client.id}:${client.googleAdsAccountId || ""}:${client.metaAdsAccountId || ""}`).join("|");
  useEffect(() => {
    if (!withAds.length) { setState({ total: 0, clients: 0, loading: false, errors: [] }); return; }
    const yesterday = localDateKey(new Date(Date.now() - 86_400_000));
    const to = end && end < yesterday ? end : yesterday;
    const from = start || `${new Date().getFullYear() - 2}-01-01`;
    if (from > to) { setState({ total: 0, clients: withAds.length, loading: false, errors: [] }); return; }
    const cacheKey = `f2b-live-adspend:${from}:${to}:${key}`;
    try { const cached = JSON.parse(sessionStorage.getItem(cacheKey) || "null"); if (cached && Date.now() - cached.at < 30 * 60_000) { setState({ ...cached.value, loading: false }); return; } } catch { /* storage unavailable */ }
    let cancelled = false;
    setState((current) => ({ ...current, loading: true }));
    void (async () => {
      let total = 0; const errors: string[] = []; const jobs: Array<() => Promise<void>> = [];
      for (const client of withAds) for (const source of AD_SPEND_SOURCES) {
        if (!source.account(client)) continue;
        jobs.push(async () => {
          try {
            const response = await fetch(`${source.endpoint}?clientId=${encodeURIComponent(client.id)}&range=custom&from=${from}&to=${to}`, { cache: "no-store" });
            const json = await response.json().catch(() => null);
            if (!response.ok || !json || !["connected", "no_data"].includes(json.status)) { errors.push(`${client.name} · ${source.label}: ${json?.message || json?.error || `HTTP ${response.status}`}`); return; }
            total += source.daily(json).filter((day: { date: string; spend: number }) => day.date >= from && day.date <= to).reduce((sum: number, day: { spend: number }) => sum + (day.spend > 0 ? day.spend : 0), 0);
          } catch { errors.push(`${client.name} · ${source.label}: couldn’t reach the ads connection`); }
        });
      }
      for (let i = 0; i < jobs.length; i += 4) await Promise.all(jobs.slice(i, i + 4).map((job) => job()));
      const value = { total: Math.round(total * 100) / 100, clients: withAds.length, errors };
      if (cancelled) return;
      setState({ ...value, loading: false });
      if (!errors.length) { try { sessionStorage.setItem(cacheKey, JSON.stringify({ at: Date.now(), value })); } catch { /* storage unavailable */ } }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, start, end]);
  return state;
}

function Overview({ scopeClientId = "", workspace, counts, onAddClient, onAddTask, onNavigate, onSelectClient, onAddFinance, onEditClientFee, onEditFinance, onEditRecurring, onDeleteFinance, onStopRecurring, showCrmSummary, onSaveClient }: { workspace: Workspace; counts: { activeTasks: number; tracked: number; retainer: number; labor: number; expenses: number; profit: number; teamMembers: number }; onAddClient: () => void; onAddTask: () => void; onNavigate: (x: string) => void; onSelectClient: (id: string) => void; onAddFinance: (kind: "Income" | "Expense") => void; onEditClientFee?: (client: Client) => void; onEditFinance: (record: FinanceRecord) => void; onEditRecurring: (schedule: FinanceRecurring) => void; onDeleteFinance: (id: string) => void; onStopRecurring: (id: string) => void; showCrmSummary: boolean; onSaveClient?: (client: Client) => void }) {
  type OpportunitySummary = { open: Array<{ currency: string; count: number; value: number }>; won: Array<{ currency: string; count: number; value: number }>; stages?: Array<{ name: string; category: string; currency: string; count: number; value: number }> };
  const [opportunitySummary, setOpportunitySummary] = useState<OpportunitySummary | null>(null);
  const [opportunitySummaryError, setOpportunitySummaryError] = useState(false);
  const [financePeriod, setFinancePeriod] = useState("this-month");
  const [taxHousehold, setTaxHousehold] = useState<"single" | "joint">("single");
  const [otherAnnualIncome, setOtherAnnualIncome] = useState(0);
  const [customStart, setCustomStart] = useState(() => localDateKey(new Date(new Date().getFullYear(), new Date().getMonth(), 1)));
  const [customEnd, setCustomEnd] = useState(() => localDateKey());
  const fmt = (n: number) => `${Math.floor(n / 3600)}h ${Math.floor((n % 3600) / 60)}m`;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const today = new Date().toLocaleDateString("en-IE", { weekday: "long", day: "numeric", month: "long" }).toUpperCase();
  const todayDate = new Date();
  const todayKey = localDateKey(todayDate);
  const monthStart = new Date(todayDate.getFullYear(), todayDate.getMonth(), 1);
  const financeRange = (() => {
    if (financePeriod === "all-time") return { start: "", end: todayKey };
    if (financePeriod === "custom") return { start: customStart, end: customEnd || todayKey };
    if (financePeriod === "year-to-date") return { start: `${todayDate.getFullYear()}-01-01`, end: todayKey };
    if (financePeriod === "last-12-months") { const start = new Date(todayDate); start.setFullYear(start.getFullYear() - 1); return { start: localDateKey(start), end: todayKey }; }
    if (financePeriod === "last-month") return { start: localDateKey(new Date(todayDate.getFullYear(), todayDate.getMonth() - 1, 1)), end: localDateKey(new Date(todayDate.getFullYear(), todayDate.getMonth(), 0)) };
    if (financePeriod === "last-3-months") return { start: localDateKey(new Date(todayDate.getFullYear(), todayDate.getMonth() - 3, todayDate.getDate())), end: todayKey };
    return { start: localDateKey(monthStart), end: todayKey };
  })();
  const inFinanceRange = (date: string) => (!financeRange.start || date >= financeRange.start) && (!financeRange.end || date <= financeRange.end);
  useEffect(() => {
    if (!showCrmSummary) return;
    let cancelled = false;
    setOpportunitySummary(null);
    fetch(`/api/crm?summary=1${scopeClientId ? `&clientId=${encodeURIComponent(scopeClientId)}` : ""}&from=${encodeURIComponent(financeRange.start)}&to=${encodeURIComponent(financeRange.end)}`).then(async (response) => {
      if (!response.ok) throw new Error("Could not load pipeline totals.");
      return await response.json() as OpportunitySummary;
    }).then((summary) => { if (!cancelled) { setOpportunitySummary(summary); setOpportunitySummaryError(false); } }).catch(() => { if (!cancelled) setOpportunitySummaryError(true); });
    return () => { cancelled = true; };
  }, [showCrmSummary, scopeClientId, financeRange.start, financeRange.end]);
  const selectedEntries = workspace.entries.filter((entry) => inFinanceRange(localDateKey(new Date(entry.startAt))));
  const recordedIncome = (workspace.financeRecords || []).filter((record) => record.kind === "Income" && inFinanceRange(record.date)).reduce((sum, record) => sum + record.amount, 0);
  const recordedExpenses = (workspace.financeRecords || []).filter((record) => record.kind === "Expense" && inFinanceRange(record.date)).reduce((sum, record) => sum + record.amount, 0);
  const selectedLabour = selectedEntries.reduce((sum, entry) => sum + entry.seconds / 3600 * (workspace.staff.find((member) => member.id === entry.staffId)?.costRate || 0), 0);
  const monthSummary = financePeriod === "this-month" ? currentMonthFinanceSummary(workspace, todayDate) : null;
  const selectedTurnover = monthSummary ? monthSummary.income : recordedIncome;
  const selectedExpenses = monthSummary ? monthSummary.businessExpenses : recordedExpenses;
  const selectedProfit = monthSummary ? monthSummary.profit : selectedTurnover - selectedExpenses - selectedLabour;
  // Sub-account view: turnover/expenses/profit are the CLIENT'S OWN business figures (Expenses & Tax tracker), never the agency fee they pay.
  const scopedBooks = scopeClientId && workspace.clients[0] ? clientBookEntries(workspace.clients[0]).filter((entry) => inFinanceRange(entry.date)) : null;
  const clientTurnover = scopedBooks ? scopedBooks.filter((entry) => entry.kind === "Income").reduce((sum, entry) => sum + entry.amount, 0) : selectedTurnover;
  const clientExpenses = scopedBooks ? scopedBooks.filter((entry) => entry.kind === "Expense").reduce((sum, entry) => sum + entry.amount, 0) : selectedExpenses;
  const clientProfit = scopedBooks ? clientTurnover - clientExpenses : selectedProfit;
  const bookedAdSpend = scopedBooks ? scopedBooks.filter((entry) => entry.kind === "Expense" && entry.category === AD_SPEND_CATEGORY).reduce((sum, entry) => sum + entry.amount, 0) : 0;
  const liveAdSpend = useLiveAdSpend(scopeClientId ? workspace.clients.slice(0, 1) : [], financeRange.start, financeRange.end);
  const clientAdSpend = liveAdSpend.clients && !liveAdSpend.errors.length ? liveAdSpend.total : Math.max(bookedAdSpend, liveAdSpend.total);
  const adSpendDetail = liveAdSpend.loading ? "Loading from Google / Meta Ads…" : !liveAdSpend.clients ? (scopedBooks ? "Connect Google or Meta Ads in the client profile" : "No clients have Google or Meta Ads connected") : liveAdSpend.errors.length ? `Some accounts didn’t load: ${liveAdSpend.errors[0]}` : scopedBooks ? "Live from Google / Meta Ads" : `Across ${liveAdSpend.clients} client${liveAdSpend.clients === 1 ? "" : "s"} · Google / Meta Ads`;
  const projectedAnnualTurnover = (monthSummary?.income ?? counts.retainer) * 12;
  const projectedAnnualExpenses = (monthSummary?.businessExpenses ?? counts.expenses) * 12;
  const projectedAnnualLabour = (monthSummary?.labor ?? counts.labor) * 12;
  const projectedAnnualProfit = projectedAnnualTurnover - projectedAnnualExpenses - projectedAnnualLabour;
  const projectedTax = estimateIrishSoleTraderTax(projectedAnnualProfit, otherAnnualIncome, taxHousehold);
  const activeTimerSeconds = workspace.activeTimer && inFinanceRange(localDateKey(new Date(workspace.activeTimer.startedAt))) ? Math.max(0, Math.floor((Date.now() - new Date(workspace.activeTimer.startedAt).getTime()) / 1000)) : 0;
  const selectedTrackedSeconds = selectedEntries.reduce((sum, entry) => sum + entry.seconds, 0) + activeTimerSeconds;
  const rangeLabel = financePeriod === "this-month" ? "This month" : financePeriod === "last-month" ? "Last month" : financePeriod === "last-3-months" ? "Last 3 months" : financePeriod === "year-to-date" ? "Year to date" : financePeriod === "last-12-months" ? "Last 12 months" : financePeriod === "all-time" ? "All time" : "Selected dates";
  const active = workspace.tasks.filter((t) => t.status !== "Done").slice(0, 5);
  const dashboardClients = workspace.clients.slice(0, 5);
  const dashboardTeam = workspace.staff.filter((member) => !member.isBot).slice(0, 6);
  const clientStatus = (client: Client) => {
    const hasOverdueTask = workspace.tasks.some((task) => task.clientId === client.id && task.status !== "Done" && task.due && task.due < localDateKey());
    if (hasOverdueTask && client.status === "Active") return "Needs attention";
    return client.status || "Active";
  };
  const aiTasks = workspace.tasks.filter((task) => Boolean(task.aiMode)).sort((a, b) => (a.dueAt || a.due || "9999").localeCompare(b.dueAt || b.due || "9999"));
  const upcomingAiTasks = aiTasks.filter((task) => task.aiRunState === "scheduled" || task.aiRunState === "running").slice(0, 4);
  const recentAiRuns = aiTasks.filter((task) => task.aiRunAt).sort((a, b) => (b.aiRunAt || "").localeCompare(a.aiRunAt || "")).slice(0, 4);
  const clientLabel = (id: string) => workspace.clients.find((item) => item.id === id)?.name || "Internal";
  const modeIcon = (mode?: AiMode) => aiModes.find((item) => item.name === mode)?.icon || "🤖";
  const aiTaskClient = (task: Task) => workspace.clients.find((item) => item.id === task.clientId);
  const aiRunSummary = (task: Task) => {
    const parts = String(task.aiFeedback || task.notes || "The AI run did not leave a task note.").split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
    const summary = parts.find((part) => !/^(AI task |Client:|Account:|Task card instructions:)/i.test(part)) || "The AI run did not leave a task note.";
    return summary.split(/\n\s*(?:Step results:|Checklist result:|Google Ads changes awaiting separate approval:)/i)[0].slice(0, 420);
  };
  const runDate = (task: Task) => task.dueAt ? new Date(task.dueAt).toLocaleString("en-IE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : task.due || "Not scheduled";
  return <><div className="welcome-row"><div><p className="eyebrow">{today}</p><h1>{greeting}, {scopeClientId ? (workspace.clients.find((item) => item.id === scopeClientId)?.name || "Sean") : "Sean"} <span>✦</span></h1><p className="muted">{scopeClientId ? "Here’s the pulse of this business today." : "Here’s the pulse of your agency today."}</p></div><button className="primary-button" onClick={onAddTask}>＋ New task</button></div>
    <div className="overview-finance-toolbar"><label><span>📅 Finance period</span><select aria-label="Dashboard finance period" value={financePeriod} onChange={(event) => setFinancePeriod(event.target.value)}><option value="this-month">This month</option><option value="last-month">Last month</option><option value="last-3-months">Last 3 months</option><option value="year-to-date">Year to date</option><option value="last-12-months">Last 12 months</option><option value="all-time">All time</option><option value="custom">Custom dates</option></select></label>{financePeriod === "custom" && <div className="overview-finance-custom"><label><span>From</span><input aria-label="Dashboard finance from date" type="date" value={customStart} max={customEnd || todayKey} onChange={(event) => setCustomStart(event.target.value)} /></label><label><span>To</span><input aria-label="Dashboard finance to date" type="date" value={customEnd} min={customStart || undefined} max={todayKey} onChange={(event) => setCustomEnd(event.target.value)} /></label></div>}<small>{scopeClientId ? "This client's own income and expenses from the Expenses & Tax tracker below." : financePeriod === "this-month" ? "Includes current monthly fees and expected recurring expenses." : "Turnover and expenses use dated records; past service fees are not stored by date."}</small></div>
    <div className="metric-grid overview-metrics"><Metric title={`Turnover · ${rangeLabel.toLowerCase()}`} value={money(clientTurnover)} detail={scopedBooks ? "Income logged in Expenses & Tax" : monthSummary ? `${money(monthSummary.retainer)} monthly fees + recorded income` : "Recorded income in this period"} icon="€" tint="mint" /><Metric title="Open tasks" value={String(counts.activeTasks)} detail={`${workspace.tasks.filter((t) => t.status === "In progress").length} in progress`} icon="☷" tint="blue" /><Metric title={`Time · ${rangeLabel.toLowerCase()}`} value={fmt(selectedTrackedSeconds)} detail={`${selectedEntries.length} saved time entries`} icon="◷" tint="peach" />{scopedBooks ? <Metric title="Your monthly fee" value={money(workspace.clients[0] ? clientMonthlyFee(workspace.clients[0]) : 0)} detail="What this client pays you" icon="€" tint="lilac" /> : <Metric title="Tracked labour cost" value={money(monthSummary ? monthSummary.labor : selectedLabour)} detail={`Saved time · ${rangeLabel.toLowerCase()}`} icon="↗" tint="lilac" />}<Metric title={`Expenses · ${rangeLabel.toLowerCase()}`} value={money(clientExpenses)} detail={scopedBooks ? "Expenses logged in Expenses & Tax" : monthSummary ? "Recorded + expected recurring" : "Recorded expenses in this period"} icon="−" tint="peach" />{scopedBooks && <Metric title={`Ad spend · ${rangeLabel.toLowerCase()}`} value={liveAdSpend.loading && !clientAdSpend ? "…" : money(clientAdSpend)} detail={adSpendDetail} icon="📣" tint="lilac" />}<Metric title={`${monthSummary ? "Estimated profit" : "Net profit"} · ${rangeLabel.toLowerCase()}`} value={money(clientProfit)} detail={scopedBooks ? "Their income − expenses" : monthSummary ? "Fees + income − expenses − labour" : "Recorded income − expenses − labour"} icon="↗" tint={clientProfit < 0 ? "peach" : "blue"} />{showCrmSummary && <Metric title="Pipeline value" value={opportunitySummary ? money(opportunitySummary.open.reduce((sum, group) => sum + group.value, 0)) : "…"} detail={opportunitySummary ? `${opportunitySummary.open.reduce((sum, group) => sum + group.count, 0)} open deals · ${money(opportunitySummary.won.reduce((sum, group) => sum + group.value, 0))} won` : "Loading pipeline"} icon="🗂" tint="mint" />}{!scopeClientId && <Metric title="Team members" value={String(counts.teamMembers)} detail="People with workspace access" icon="♙" tint="blue" />}</div>
    {showCrmSummary && <section className="panel overview-pipeline-summary" aria-label="Sales pipeline value"><div className="overview-pipeline-heading"><div><p className="eyebrow">🗂️ SALES PIPELINE</p><h2>Opportunity value</h2><p>Potential sales are shown separately from recorded income and profit.</p></div><button type="button" className="text-button" onClick={() => onNavigate("CRM")}>Open pipeline ↗</button></div>{opportunitySummary ? <><div className="overview-pipeline-values">{[{ key: "open", label: "Open opportunities", note: "Potential value · not booked income" }, { key: "won", label: "Won opportunities", note: "Won deal value · track separately from collected income" }].map((item) => { const groups = opportunitySummary[item.key as "open" | "won"]; return <div key={item.key}><small>{item.label}</small>{groups.length ? groups.map((group) => <strong key={group.currency}>{money(group.value)} <em>{group.count} {group.count === 1 ? "deal" : "deals"}</em></strong>) : <strong>€0 <em>0 deals</em></strong>}<span>{item.note}</span></div>; })}</div>{opportunitySummary.stages && opportunitySummary.stages.some((stage) => stage.count > 0) && <div className="overview-pipeline-stages" aria-label="Value by stage">{(() => { const rows = opportunitySummary.stages.filter((stage) => stage.count > 0); const max = Math.max(...rows.map((stage) => stage.value), 1); return rows.map((stage, index) => <div className={`overview-stage-row ${stage.category}`} key={`${stage.name}-${stage.currency}-${index}`}><span>{stage.name}</span><div className="bar-track"><div className="bar-fill" style={{ width: `${Math.max(stage.value ? 6 : 0, stage.value / max * 100)}%` }} /></div><b>{money(stage.value)} <em>{stage.count}</em></b></div>); })()}</div>}</> : opportunitySummaryError ? <p className="overview-pipeline-status" role="status">Pipeline totals are temporarily unavailable.</p> : <p className="overview-pipeline-status" role="status">Loading pipeline totals…</p>}</section>}

    {aiTasks.length > 0 && <div className="ai-dashboard-grid"><section className="panel ai-dashboard-panel"><div className="panel-heading"><div><h2>Upcoming AI tasks</h2><p>Scheduled runs across client accounts</p></div><button className="text-button" onClick={() => onNavigate("AI Assistant")}>Open AI Assistant ↗</button></div>{upcomingAiTasks.length ? <div className="ai-dashboard-list">{upcomingAiTasks.map((task) => { const client = aiTaskClient(task); return <article className="ai-dashboard-row" key={task.id}><span className={`ai-dashboard-icon ${client?.logo ? "has-client-logo" : ""}`}>{client?.logo ? <img src={client.logo} alt={`${client.name} logo`} /> : <AiIcon v={modeIcon(task.aiMode)} />}</span><div><b>{task.title}</b><small>{clientLabel(task.clientId)} · {task.aiMode} · {runDate(task)}{task.repeat && task.repeat !== "None" ? ` · ${task.repeat}` : ""}</small></div><span className="assistant-task-status">{task.aiRunState === "running" ? "Running" : "Scheduled"}</span></article>; })}</div> : <div className="ai-dashboard-empty">No upcoming AI runs. Schedule one from the AI Assistant.</div>}</section><section className="panel ai-dashboard-panel"><div className="panel-heading"><div><h2>AI task updates</h2><p>Latest AI results and grouped approval email status</p></div><button className="text-button" onClick={() => onNavigate("Activity")}>View activity ↗</button></div>{recentAiRuns.length ? <div className="ai-dashboard-list">{recentAiRuns.map((task) => { const client = aiTaskClient(task); return <article className="ai-dashboard-row ai-dashboard-result" key={task.id}><span className={`ai-dashboard-icon ${client?.logo ? "has-client-logo" : ""}`}>{client?.logo ? <img src={client.logo} alt={`${client.name} logo`} /> : <AiIcon v={modeIcon(task.aiMode)} />}</span><div><b>{task.title}</b><small>{clientLabel(task.clientId)} · {task.aiMode} · {task.aiRunState === "completed" ? "Completed" : task.aiRunState === "needs_review" ? "Needs your review" : task.aiRunState === "needs_connection" ? "Needs setup" : task.aiRunState === "failed" ? "Run failed" : task.aiRunState}{task.aiNotificationStatus === "sent" ? " · Email sent" : task.aiNotificationStatus === "blocked" ? " · Email blocked" : task.aiNotificationStatus === "failed" ? " · Email failed" : task.aiNotificationStatus === "pending" || task.aiNotificationStatus === "sending" ? " · Approval email pending" : ""}</small><p>{aiRunSummary(task)}</p><small>{task.checklist?.filter((step) => step.done).length || 0}/{task.checklist?.length || 0} steps verified · {(task.aiApprovals || []).filter((item) => item.status === "pending").length} changes to decide</small><details><summary>Run breakdown</summary><pre>{formatAiRunForDisplay(task.aiFeedback || task.notes || "No detailed result is saved.")}</pre></details></div></article>; })}</div> : <div className="ai-dashboard-empty">Completed AI task notes will appear here.</div>}</section></div>}
    {workspace.clients.length === 0 ? <div className="welcome-card"><div className="welcome-visual"><span className="orbit orbit-one"/><span className="orbit orbit-two"/><div className="welcome-logo">F2B<span>✦</span></div><div className="floating-tag tag-top">Client work <b>·</b> in focus</div><div className="floating-tag tag-bottom">Time tracked <b>✓</b></div></div><div className="welcome-copy"><p className="eyebrow">YOUR WORKSPACE IS READY</p><h2>Build a calmer way<br />to run the agency.</h2><p>Add your first client, assign delivery work, and start tracking time. Your revenue and labour view will fill in as the team works.</p><button className="primary-button" onClick={onAddClient}>Add your first client <span>↗</span></button><small>Supports AI automation, web, Google Ads, Meta Ads, SEO and Debug.</small></div></div> : <div className="dashboard-grid overview-panels"><section className="panel task-panel"><div className="panel-heading"><div><h2>Tasks in motion</h2><p>Next up across your client work</p></div><button className="text-button" onClick={() => onNavigate("Tasks")}>View all ↗</button></div>{active.length ? active.map((t) => <TaskRow key={t.id} task={t} workspace={workspace} />) : <EmptyLine title="No open tasks" action="Create a task to get delivery moving." />}</section><section className="panel distribution-panel"><div className="panel-heading"><div><h2>Client portfolio</h2><p>Revenue by service line</p></div><button className="text-button" onClick={() => onNavigate("Clients")}>Clients ↗</button></div>{serviceTypes.map((s, i) => { const total = workspace.clients.reduce((a, c) => a + (c.services.filter((x) => x.name === s).reduce((sum, x) => sum + x.fee, 0)), 0); const colors = ["#3f8179", "#8a75bb", "#d99a69", "#5984b3", "#bd7181", "#628d73"]; return <div className="service-bar-row" key={s}><span className="service-dot" style={{ background: colors[i] }} /> <span className="service-label"><AiIcon v={serviceIcons[s]} /> {s}</span><div className="bar-track"><div className="bar-fill" style={{ width: `${Math.max(total ? 8 : 0, counts.retainer ? total / counts.retainer * 100 : 0)}%`, background: colors[i] }} /></div><b>{money(total)}</b></div>; })}</section><ActivityPanel activity={workspace.activity || []} workspace={workspace} onViewAll={() => onNavigate("Activity")} /></div>}
    {workspace.clients.length === 0 && <ActivityPanel activity={workspace.activity || []} workspace={workspace} onViewAll={() => onNavigate("Activity")} />}
    {workspace.clients.length > 0 && <section className="panel agency-directory-panel"><div className="directory-clients-section"><div className="panel-heading"><div><h2>Client Overview</h2><p>{workspace.clients.length} client{workspace.clients.length === 1 ? "" : "s"} · services, status and monthly fees</p></div><button className="text-button" onClick={() => onNavigate("Clients")}>View all clients ↗</button></div><div className="directory-table-wrap"><table className="directory-client-table"><thead><tr><th>Client</th><th>Services</th><th>Status</th><th>Monthly value</th></tr></thead><tbody>{dashboardClients.map((client) => { const status = clientStatus(client); const tone = status.toLowerCase().includes("hold") ? "hold" : status.toLowerCase().includes("attention") ? "attention" : status.toLowerCase() === "active" ? "active" : "other"; const monthlyFee = client.services.reduce((sum, service) => sum + service.fee, 0); return <tr key={client.id}><td><button className="directory-client-button" onClick={() => onSelectClient(client.id)}><span className={`client-avatar directory-client-avatar ${client.logo ? "has-logo" : ""}`} style={{ background: client.color }}>{client.logo ? <img src={client.logo} alt="" /> : initials(client.name)}</span><span>{client.name}</span></button></td><td>{client.services.length ? client.services.map((service, index) => <span className="directory-service" key={`${client.id}-${index}`} title={service.campaignName || service.name}><AiIcon v={serviceIcons[service.name] || "✦"} /> {service.name}{service.campaignName ? ` · ${service.campaignName}` : ""}</span>) : <span className="directory-muted">No services</span>}</td><td><span className={`directory-status ${tone}`}>{status}</span></td><td className="directory-monthly-value">{money(monthlyFee)}</td></tr>; })}</tbody></table></div></div><div className="directory-team-section"><div className="panel-heading"><div><h2>Team Members</h2><p>People with workspace access</p></div><button className="text-button" onClick={() => onNavigate("Team")}>View all team ↗</button></div>{dashboardTeam.length ? <div className="directory-team-list">{dashboardTeam.map((member) => <button className="directory-team-member" key={member.id} onClick={() => onNavigate("Team")}><StaffProfileAvatar member={member} className="directory-team-avatar" /><b>{member.name}</b><small>{member.role}</small></button>)}</div> : <div className="directory-team-empty">No staff profiles yet.</div>}</div></section>}
     <WeeklyHoursChart entries={workspace.entries} range={financeRange} rangeLabel={rangeLabel} />
     <div className="quick-row"><div className="quick-title"><span className="spark">✦</span><div><b>Quick start</b><small>Keep the basics moving</small></div></div><button onClick={onAddClient}><span className="quick-icon mint">＋</span><span><b>Add a client</b><small>Set services & monthly fees</small></span><span className="quick-arrow">↗</span></button><button onClick={onAddTask}><span className="quick-icon blue">☷</span><span><b>Assign a task</b><small>Get work into the queue</small></span><span className="quick-arrow">↗</span></button><button onClick={() => onNavigate("Team")}><span className="quick-icon lilac">♙</span><span><b>Set up your team</b><small>Roles, rates and profiles</small></span><span className="quick-arrow">↗</span></button></div>
    {!scopeClientId && <section className="panel overview-projection-panel" aria-label="Annual earnings projection"><div className="overview-projection-head"><div><p className="eyebrow">📈 YEARLY INCOME · PROFIT · TAX ESTIMATE</p><h2>Yearly income, profit & tax estimate</h2><p>What a full year could look like if this month’s income and costs continued.</p></div><span className="overview-projection-badge">Estimate · 2026 tax rules</span></div><div className="overview-projection-metrics"><div><small>Estimated annual income</small><strong>{money(projectedAnnualTurnover)}</strong><span>Current monthly fees and income × 12</span></div><div><small>Estimated business profit</small><strong>{money(projectedAnnualProfit)}</strong><span>After estimated business costs and tracked labour</span></div><div className="overview-tax-reserve"><small>Rough tax set-aside</small><strong>{money(projectedTax.monthly)}<em>/ month</em></strong><span>{money(projectedTax.total)} estimated for the year · Income Tax, USC and PRSI</span></div></div><details className="overview-tax-settings"><summary>Adjust tax assumptions</summary><div className="overview-tax-fields"><label><span>Tax status</span><select aria-label="Tax projection status" value={taxHousehold} onChange={(event) => setTaxHousehold(event.target.value as "single" | "joint")}><option value="single">Single</option><option value="joint">Married / civil partnership · one income</option></select></label><label><span>Other annual taxable income (€)</span><input aria-label="Other annual taxable income" type="number" min="0" step="500" value={otherAnnualIncome || ""} placeholder="0" onChange={(event) => setOtherAnnualIncome(Number(event.target.value) || 0)} /></label></div><p className="overview-tax-note">Rough 2026 estimate using standard tax bands, basic personal and earned-income credits, standard USC and Class S PRSI. Other income can increase the estimate. Excludes VAT, pension relief, special credits and other adjustments; not a tax return calculation.</p></details></section>}
     {!scopeClientId && <FinancePanel workspace={workspace} period={financePeriod} periodRange={financeRange} periodLabel={rangeLabel} onAdd={onAddFinance} onEditClientFee={onEditClientFee} onEditFinance={onEditFinance} onEditRecurring={onEditRecurring} onDelete={onDeleteFinance} onStopRecurring={onStopRecurring} />}
    {scopeClientId && workspace.clients[0] && <ClientTaxTracker key={workspace.clients[0].id} client={workspace.clients[0]} onSave={onSaveClient} taxSettings={workspace.clients[0].tax || workspace.settings?.tax} range={financeRange} rangeLabel={rangeLabel} />}
  </>;
}
function relativeTime(value: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  const days = Math.floor(seconds / 86400);
  return days < 7 ? `${days}d ago` : new Date(value).toLocaleDateString("en-IE", { day: "numeric", month: "short" });
}
function workedDuration(seconds: number) {
  const hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds % 3600 / 60);
  return hours ? `${hours}h ${String(minutes).padStart(2, "0")}m` : minutes ? `${minutes}m` : `${seconds}s`;
}
function ActivityPanel({ activity, workspace, onViewAll }: { activity: Activity[]; workspace: Workspace; onViewAll: () => void }) {
  const [showAll, setShowAll] = useState(false);
  const items = showAll ? activity : activity.slice(0, 4);
  return <section className="panel recent-activity-panel"><div className="panel-heading"><div><h2>Recent Activity</h2><p>Latest workspace updates</p></div><button className="text-button" onClick={onViewAll}>View all</button></div>{items.length ? <><div className="recent-activity-list">{items.map((item) => <ActivityEntry item={item} workspace={workspace} key={item.id} />)}</div>{activity.length > 4 && <button className="activity-view-all" onClick={onViewAll}>View all activity</button>}</> : <div className="activity-empty"><span>✨</span><b>Your workspace activity will show here</b><small>Changes to tasks, clients and time entries appear as they happen.</small></div>}</section>;
}
function activityNotePreview(note: string) {
  const text = formatAiRunForDisplay(note).replace(/^📝\s*/, "").trim();
  const lower = text.toLowerCase();
  const noChanges = /no (?:external )?(?:account )?changes? (?:were )?(?:made|applied)|no account changes were applied/.test(lower);
  const needsFollowUp = /needs? follow[- ]?up|needs? your review|review queue|cannot be verified|not supplied|unavailable|needs data|incomplete/.test(lower);
  if (noChanges && needsFollowUp) return "Checked it. No changes made; needs your review.";
  if (noChanges) return "Checked it. No changes needed.";
  if (needsFollowUp) return "Checked it. Needs your review.";
  if (/changes? (?:were )?(?:made|applied).{0,50}(?:verified|checked)|(?:verified|checked).{0,50}changes? (?:were )?(?:made|applied)/.test(lower)) return "Checked it. Updates made and verified.";
  const firstLine = text.split(/\r?\n/).map((line) => line.trim()).find((line) => line && !/^(?:client|account|campaign|selected campaign|task card instructions|step results|evidence|verification|risk|date)\s*:/i.test(line)) || "Note saved.";
  const firstSentence = firstLine.split(/(?<=[.!?])\s+/)[0] || firstLine;
  return firstSentence.length > 84 ? `${firstSentence.slice(0, 81).trimEnd()}…` : firstSentence;
}
function ActivityEntry({ item, workspace, detailed = false }: { item: Activity; workspace: Workspace; detailed?: boolean }) {
  const linkedEntry = workspace.entries.find((entry) => item.taskId && entry.taskId === item.taskId && Math.abs(new Date(entry.endAt || entry.startAt).getTime() - new Date(item.at).getTime()) < 5 * 60_000);
  const loggedStaff = workspace.staff.find((member) => member.id === (item.staffId || linkedEntry?.staffId));
  const client = workspace.clients.find((entry) => entry.id === item.clientId), actor = loggedStaff || workspace.staff.find((member) => member.name === item.actor), actorName = loggedStaff?.name || item.actor, avatar = loggedStaff?.avatar || item.actorAvatar || actor?.avatar;
  const photo = Boolean(avatar?.startsWith("data:image/") || avatar?.startsWith("https://"));
  const action = item.title === "Task moved to Done" ? "Task completed" : item.title;
  const rawDetail = String(item.detail || "").trim();
  const firstDetail = rawDetail.split(/\s[·•]\s/, 1)[0]?.trim() || "";
  const shortDetail = firstDetail.length > 42 ? `${firstDetail.slice(0, 39).trimEnd()}…` : firstDetail;
  const activityTitle = shortDetail || action;
  const hasMore = Boolean((rawDetail && rawDetail !== activityTitle) || item.note);
  const duration = item.durationSeconds ?? linkedEntry?.seconds;
  return <article className={`recent-activity-row ${detailed ? "activity-event-card" : ""}`}><span className="activity-avatars" aria-label={`${actorName}${client ? ` · ${client.name}` : ""}`}><span className="activity-user-avatar">{photo ? <img src={avatar} alt="" /> : avatar || initials(actorName)}</span>{client?.logo ? <span className="activity-client-logo"><img src={client.logo} alt={`${client.name} logo`} /></span> : null}</span><div className="activity-copy"><b>{activityTitle}</b><small>{client?.name || "Agency"} · {actorName} · {relativeTime(item.at)}</small>{item.note && <span className="activity-note-preview">📝 {activityNotePreview(item.note)}</span>}{detailed && <span className="activity-context">{action}{item.service ? <> · <AiIcon v={serviceIcons[item.service] || "🧩"} /> {item.service}</> : ""}</span>}{hasMore && <details className="activity-entry-more"><summary>View more</summary><div className="activity-entry-full">{rawDetail && rawDetail !== activityTitle && <p>{rawDetail}</p>}{item.note && <p className="activity-note">📝 {formatAiRunForDisplay(item.note)}</p>}</div></details>}</div>{item.kind === "time" && duration != null && <span className="activity-worked-time">⏱️ {workedDuration(duration)}</span>}{item.service && <span className="activity-service" title={item.service}><AiIcon v={serviceIcons[item.service] || "🧩"} /> {item.service}</span>}</article>;
}
function ActivityView({ workspace }: { workspace: Workspace }) {
  const [clientId, setClientId] = useState("");
  const [staffId, setStaffId] = useState("");
  const items = workspace.activity || [];
  const filtered = items.filter((item) => {
    const entry = workspace.entries.find((timeEntry) => item.taskId && timeEntry.taskId === item.taskId && Math.abs(new Date(timeEntry.endAt || timeEntry.startAt).getTime() - new Date(item.at).getTime()) < 5 * 60_000);
    return (!clientId || item.clientId === clientId) &&
      (!staffId || item.staffId === staffId || item.actor === workspace.staff.find((member) => member.id === staffId)?.name || entry?.staffId === staffId);
  });
  const groups = filtered.reduce<Record<string, Activity[]>>((acc, item) => { const date = new Date(item.at); const key = date.toLocaleDateString("en-IE", { weekday: "long", day: "numeric", month: "short" }).toUpperCase(); (acc[key] ||= []).push(item); return acc; }, {});
  const hasFilter = Boolean(clientId || staffId);
  return <><div className="activity-page-heading"><p className="eyebrow">🕘 WORKSPACE TIMELINE</p><h1>Latest Activity</h1><p>Everything happening across your agency.</p><div className="activity-filters"><label className="activity-project-filter client-filter"><span>👥 Client</span><select aria-label="Filter activity by client" value={clientId} onChange={(event) => setClientId(event.target.value)}><option value="">All clients</option>{workspace.clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label><label className="activity-project-filter"><span>♙ Staff member</span><select aria-label="Filter activity by staff member" value={staffId} onChange={(event) => setStaffId(event.target.value)}><option value="">Everyone</option>{workspace.staff.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label></div></div>{filtered.length ? <div className="activity-timeline">{Object.entries(groups).map(([date, events]) => <section className="activity-day" key={date}><div className="activity-date-label">{date}</div><div className="activity-day-events">{events.map((item) => <ActivityEntry key={item.id} item={item} workspace={workspace} detailed />)}</div></section>)}</div> : <section className="panel activity-full-empty"><span>✨</span><h2>{hasFilter ? "No activity matches these filters" : "No activity to show yet"}</h2><p>New tasks, status changes, time entries and client updates will appear here.</p></section>}</>;
}
function clientBillingDate(day: number, date: Date) { const year = date.getFullYear(), month = date.getMonth(); const lastDay = new Date(year, month + 1, 0).getDate(); return new Intl.DateTimeFormat("en-IE", { day: "numeric", month: "short", year: "numeric" }).format(new Date(year, month, Math.min(Math.max(1, day), lastDay))); }
function FinancePanel({ workspace, period: controlledPeriod, periodRange, periodLabel, onAdd, onEditClientFee, onEditFinance, onEditRecurring, onDelete, onStopRecurring }: { workspace: Workspace; period?: string; periodRange?: { start: string; end: string }; periodLabel?: string; onAdd: (kind: "Income" | "Expense") => void; onEditClientFee?: (client: Client) => void; onEditFinance: (record: FinanceRecord) => void; onEditRecurring: (schedule: FinanceRecurring) => void; onDelete: (id: string) => void; onStopRecurring: (id: string) => void }) {
  const [ownPeriod, setPeriod] = useState("this-month");
  const period = controlledPeriod || ownPeriod;
  const today = new Date();
  const toDateInput = localDateKey;
  const todayKey = toDateInput(today);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const [customStart, setCustomStart] = useState(toDateInput(monthStart));
  const [customEnd, setCustomEnd] = useState(todayKey);
  const localRange = (() => {
    if (period === "all-time") return { start: "", end: "" };
    if (period === "custom") return { start: customStart, end: customEnd || todayKey };
    if (period === "last-month") {
      const previousMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      return { start: toDateInput(previousMonth), end: toDateInput(new Date(today.getFullYear(), today.getMonth(), 0)) };
    }
    if (period === "last-3-months") return { start: toDateInput(new Date(today.getFullYear(), today.getMonth() - 3, today.getDate())), end: todayKey };
    if (period === "year-to-date") return { start: `${today.getFullYear()}-01-01`, end: todayKey };
    return { start: toDateInput(monthStart), end: toDateInput(new Date(today.getFullYear(), today.getMonth() + 1, 0)) };
  })();
  const range = periodRange && controlledPeriod && controlledPeriod !== "this-month" ? periodRange : localRange;
  const showCurrentFees = period === "this-month";
  const inRange = (date: string) => (!range.start || date >= range.start) && (!range.end || date <= range.end);
  const rows = (workspace.financeRecords || []).filter((record) => inRange(record.date)).sort((a, b) => b.date.localeCompare(a.date));
  const income = rows.filter((record) => record.kind === "Income").reduce((sum, record) => sum + record.amount, 0);
  const expense = rows.filter((record) => record.kind === "Expense").reduce((sum, record) => sum + record.amount, 0);
  const currentMonthFinance = showCurrentFees ? currentMonthFinanceSummary(workspace, today) : undefined;
  const currentMonthRecurringExpenses = currentMonthFinance?.recurring || [];
  const incomeTotal = showCurrentFees ? currentMonthFinance!.income : income;
  const businessExpenseTotal = showCurrentFees ? currentMonthFinance!.businessExpenses : expense;
  const labour = showCurrentFees ? currentMonthFinance!.labor : workspace.entries.filter((entry) => inRange(toDateInput(new Date(entry.startAt)))).reduce((sum, entry) => sum + entry.seconds / 3600 * (workspace.staff.find((member) => member.id === entry.staffId)?.costRate || 0), 0);
  const totalCosts = businessExpenseTotal + labour;
  const clientsWithFees = workspace.clients.filter((client) => client.services.reduce((sum, service) => sum + service.fee, 0) > 0);
  const hasRows = rows.length > 0 || (showCurrentFees && clientsWithFees.length > 0) || currentMonthRecurringExpenses.length > 0;
  const recurring = (workspace.financeRecurring || []).slice().sort((a, b) => a.nextDate.localeCompare(b.nextDate));
  return <section className="panel finance-panel"><div className="panel-heading"><div><h2>💶 Income & expenses</h2><p>{controlledPeriod ? `${periodLabel || "Selected period"} · follows the finance period above.` : "Review recorded income, expenses and tracked labour by date."}</p></div><div className="finance-actions"><button className="secondary-button income-button" onClick={() => onAdd("Income")}>＋ Add income</button><button className="secondary-button expense-button" onClick={() => onAdd("Expense")}>＋ Add expense</button></div></div>{!controlledPeriod && <div className="finance-range-controls"><label className="finance-period"><span>Time period</span><select aria-label="Income and expenses time period" value={period} onChange={(event) => setPeriod(event.target.value)}><option value="this-month">This month</option><option value="last-month">Last month</option><option value="last-3-months">Last 3 months</option><option value="year-to-date">Year to date</option><option value="all-time">All time</option><option value="custom">Custom dates</option></select></label>{period === "custom" && <div className="finance-custom-dates"><label><span>From</span><input aria-label="Income and expenses from date" type="date" value={customStart} max={customEnd || undefined} onChange={(event) => setCustomStart(event.target.value)} /></label><label><span>To</span><input aria-label="Income and expenses to date" type="date" value={customEnd} min={customStart || undefined} max={todayKey} onChange={(event) => setCustomEnd(event.target.value)} /></label></div>}</div>}<div className="finance-summary"><div><small>{showCurrentFees ? "Monthly fees + recorded income" : "Recorded income in period"}</small><b>{money(incomeTotal)}</b></div><div><small>{showCurrentFees ? "Expenses + expected recurring costs" : "Recorded expenses in period"}</small><b>{money(businessExpenseTotal)}</b></div><div><small>Tracked labour</small><b>{money(labour)}</b></div><div><small>{showCurrentFees ? "Estimated net this month" : "Net from recorded income"}</small><b className={incomeTotal - totalCosts < 0 ? "negative-value" : "positive-value"}>{money(incomeTotal - totalCosts)}</b></div></div><p className="finance-period-note">One-off entries and tracked labour use their saved dates. This month also estimates recurring expenses due in the month when no dated entry has been recorded yet. Monthly client fees remain estimates, not confirmed payments.</p>{hasRows ? <div className="finance-list">{showCurrentFees && clientsWithFees.map((client) => { const fee = client.services.reduce((sum, service) => sum + service.fee, 0); return <div className="finance-row finance-client-income" key={`client-fee-${client.id}`}><span className="finance-kind income">↗</span><div className="finance-description"><b>{client.name}</b><small>Monthly client fees · {client.services.filter((service) => service.fee > 0).map((service) => service.campaignName ? `${service.name}: ${service.campaignName}` : service.name).join(", ")} · Due {client.billingDay ? clientBillingDate(client.billingDay, today) : "date not set"}</small></div><strong className="positive-value">＋{money(fee)}</strong>{onEditClientFee && <button className="finance-edit" title={`Edit ${client.name} monthly fees`} aria-label={`Edit ${client.name} monthly fees`} onClick={() => onEditClientFee(client)}>Edit</button>}</div>; })}{currentMonthRecurringExpenses.map((item) => <div className="finance-row finance-recurring-estimate" key={`expected-${item.schedule.id}-${item.date}`}><span className="finance-kind expense">↘</span><div className="finance-description"><b>{item.schedule.description}</b><small>Expected recurring expense · {item.schedule.frequency} · {item.date} · estimate</small></div><strong className="negative-value">−{money(item.schedule.amount)}</strong><button className="finance-edit" title={`Edit ${item.schedule.description}`} aria-label={`Edit ${item.schedule.description}`} onClick={() => onEditRecurring(item.schedule)}>Edit</button></div>)}{rows.slice(0, 12).map((record) => <div className="finance-row" key={record.id}><span className={`finance-kind ${record.kind === "Income" ? "income" : "expense"}`}>{record.kind === "Income" ? "↗" : "↘"}</span><div className="finance-description"><b>{record.description}</b><small>{record.category} · {record.date}{record.clientId ? ` · ${workspace.clients.find((client) => client.id === record.clientId)?.name || "Client"}` : ""}</small></div><strong className={record.kind === "Income" ? "positive-value" : "negative-value"}>{record.kind === "Expense" ? "−" : "＋"}{money(record.amount)}</strong><button className="finance-edit" title={`Edit ${record.description}`} aria-label={`Edit ${record.description}`} onClick={() => onEditFinance(record)}>Edit</button><button className="finance-delete" title="Remove entry" aria-label={`Remove ${record.description}`} onClick={() => onDelete(record.id)}>×</button></div>)}</div> : <div className="finance-empty">No entries for this period. Add a dated income or expense to include it in these totals.</div>}{recurring.length > 0 && <div className="finance-recurring"><h3>Recurring items</h3>{recurring.map((item) => <div className="finance-row" key={item.id}><span className={`finance-kind ${item.kind === "Income" ? "income" : "expense"}`}>{item.kind === "Income" ? "↗" : "↘"}</span><div className="finance-description"><b>{item.description}</b><small>{item.frequency} · next on {item.nextDate}{item.endDate ? ` · until ${item.endDate}` : ""}</small></div><strong className={item.kind === "Income" ? "positive-value" : "negative-value"}>{item.kind === "Expense" ? "−" : "＋"}{money(item.amount)}</strong><button className="finance-edit" title={`Edit recurring ${item.description}`} aria-label={`Edit recurring ${item.description}`} onClick={() => onEditRecurring(item)}>Edit</button><button className="finance-delete" title="Stop recurring entries" aria-label={`Stop recurring ${item.description}`} onClick={() => onStopRecurring(item.id)}>×</button></div>)}</div>}</section>;
}
function Metric({ title, value, detail, icon, tint }: { title: string; value: string; detail: string; icon: string; tint: string }) { return <div className="metric-card"><div className="metric-top"><span>{title}</span><span className={`metric-icon ${tint}`}>{icon}</span></div><b className="metric-value">{value}</b><small>{detail}</small></div>; }
function TaskRow({ task, workspace }: { task: Task; workspace: Workspace }) { const c = workspace.clients.find((x) => x.id === task.clientId); const s = workspace.staff.find((x) => x.id === task.assigneeId); const hasPhoto = Boolean(s?.avatar.startsWith("data:image/") || s?.avatar.startsWith("https://")); return <div className="task-row"><span className={`task-check ${task.status === "In progress" ? "working" : ""}`}>{task.status === "In progress" ? "◷" : ""}</span><div className="task-info"><b>{task.title}</b><small>{c?.name || "Internal"} <span>·</span> {task.service}</small></div><span className={`priority ${task.priority.toLowerCase()}`}>{task.priority}</span><div className="mini-person">{s ? hasPhoto ? <img src={s.avatar} alt="" /> : <AiIcon v={s.isBot ? "🤖" : s.avatar || initials(s.name)} /> : "—"}</div></div>; }
function WeeklyHoursChart({ entries, range, rangeLabel }: { entries: Entry[]; range?: { start: string; end: string }; rangeLabel?: string }) {
  const parse = (key: string) => { const [y, m, d] = key.split("-").map(Number); return new Date(y, m - 1, d); };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let start: Date, end: Date, title = "Team time this week", subtitle = "Hours logged each day, Monday to Sunday";
  if (range) {
    end = range.end ? parse(range.end) : today;
    const earliest = entries.reduce((min, entry) => Math.min(min, new Date(entry.startAt).getTime()), end.getTime());
    start = range.start ? parse(range.start) : new Date(earliest); start.setHours(0, 0, 0, 0);
    title = `Team time · ${(rangeLabel || "selected period").toLowerCase()}`;
  } else { start = new Date(today); start.setDate(today.getDate() - (today.getDay() + 6) % 7); end = new Date(start); end.setDate(start.getDate() + 6); }
  const spanDays = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  const unit: "day" | "week" | "month" = !range || spanDays <= 10 ? "day" : spanDays <= 62 ? "week" : "month";
  if (range) subtitle = unit === "day" ? "Hours logged each day" : unit === "week" ? "Hours logged each week" : "Hours logged each month";
  const buckets: Array<{ from: Date; to: Date; label: string }> = [];
  const cursor = new Date(start);
  if (unit === "month") cursor.setDate(1);
  while (cursor <= end && buckets.length < 400) {
    const from = new Date(cursor); const to = new Date(cursor);
    if (unit === "day") to.setDate(to.getDate() + 1); else if (unit === "week") to.setDate(to.getDate() + 7); else to.setMonth(to.getMonth() + 1);
    const label = unit === "day" ? (spanDays <= 7 ? from.toLocaleDateString("en-IE", { weekday: "short" }) : from.toLocaleDateString("en-IE", { day: "numeric", month: "short" })) : unit === "week" ? from.toLocaleDateString("en-IE", { day: "numeric", month: "short" }) : from.toLocaleDateString("en-IE", { month: "short", year: spanDays > 370 ? "2-digit" : undefined });
    buckets.push({ from, to, label });
    cursor.setTime(to.getTime());
  }
  const shown = buckets.slice(-18);
  const days = shown.map((bucket, index) => { const seconds = entries.filter((entry) => { const at = new Date(entry.startAt); return at >= bucket.from && at < bucket.to && at <= new Date(end.getTime() + 86400000); }).reduce((total, entry) => total + entry.seconds, 0); return { key: `${bucket.label}-${index}`, label: bucket.label, hours: seconds / 3600 }; });
  const max = Math.max(4, ...days.map((day) => day.hours));
  return <section className="panel weekly-chart"><div className="panel-heading"><div><h2>📊 {title}</h2><p>{subtitle}</p></div><span className="chart-total">{days.reduce((sum, day) => sum + day.hours, 0).toFixed(1)} hrs total</span></div><div className="chart-bars" role="img" aria-label={`Hours chart: ${days.map((d) => `${d.label} ${d.hours.toFixed(1)} hours`).join(", ")}`}>{days.map((day) => <div className="chart-day" key={day.key}><span className="chart-hour">{day.hours ? `${day.hours.toFixed(1)}h` : "0h"}</span><div className="chart-column"><div className="chart-bar" style={{ height: `${day.hours ? Math.max(8, day.hours / max * 100) : 3}%` }} /></div><b>{day.label}</b></div>)}</div><div className="chart-caption">💡 Start a task timer to see your team’s activity here.</div></section>;
}
function EmptyLine({ title, action }: { title: string; action: string }) { return <div className="empty-line"><b>{title}</b><span>{action}</span></div>; }

function NotesCenter({ notes, tasks, clients, taskId, clientId, body, onBodyChange, onSave, onCancel }: { notes: Note[]; tasks: Task[]; clients: Client[]; taskId?: string; clientId?: string; body: string; onBodyChange: (value: string) => void; onSave: () => void; onCancel: () => void }) {
  const visibleNotes = notes.filter((note) => taskId ? note.taskId === taskId : clientId ? note.clientId === clientId && !note.taskId : true).slice().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const task = tasks.find((item) => item.id === taskId);
  const client = clients.find((item) => item.id === (clientId || task?.clientId));
  return <div className="notes-center">
    <p className="notes-center-help">Work notes are saved separately from client details and task instructions.</p>
    {(taskId || clientId) ? <><label className="field"><span>{taskId ? "Add a note to this task card" : "Add a note to this client"}</span><textarea rows={3} value={body} onChange={(event) => onBodyChange(event.target.value)} placeholder="Record a decision, update or next step…" /></label><ModalActions onCancel={onCancel} onSave={onSave} label="Save work note" /></> : <p className="notes-center-help">Open a client or task card to add a note. This view shows every saved work note.</p>}
    <div className="notes-center-heading"><b>{taskId ? `Task notes · ${task?.title || "Task"}` : clientId ? `Client notes · ${client?.name || "Client"}` : "All work notes"}</b><span>{visibleNotes.length}</span></div>
    <div className="notes-center-list">{visibleNotes.length ? visibleNotes.map((note) => <article className="note-card" key={note.id}><div className="note-meta"><span className="avatar owner small-avatar">{initials(note.authorName || "Team member")}</span><b>{note.authorName || "Team member"}</b><time>{new Date(note.createdAt).toLocaleString("en-IE", { dateStyle: "medium", timeStyle: "short" })}</time></div><small className="notes-center-context">{note.taskId ? tasks.find((item) => item.id === note.taskId)?.title || "Task" : clients.find((item) => item.id === note.clientId)?.name || "Client"}</small><p>{note.body}</p></article>) : <div className="empty-note">No work notes here yet.</div>}</div>
  </div>;
}

type FilePreviewDetails = { name: string; type: string; url: string; taskId?: string };


function FileThumb({ url, name, type }: { url: string; name: string; type?: string }) {
  const [failed, setFailed] = useState(false);
  const lower = name.toLowerCase();
  const isImage = (type || "").startsWith("image/") || /\.(png|jpe?g|webp|gif)$/.test(lower);
  const isPdf = type === "application/pdf" || lower.endsWith(".pdf");
  if (!failed && isImage) return <span className="file-thumb"><img src={url} alt="" loading="lazy" onError={() => setFailed(true)} /></span>;
  if (!failed && isPdf) return <span className="file-thumb"><iframe src={`${url}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`} title="" tabIndex={-1} loading="lazy" /></span>;
  return <span className="file-thumb file-thumb-icon">{isPdf ? "PDF" : (lower.split(".").pop() || "FILE").slice(0, 4).toUpperCase()}</span>;
}
function FilePreviewModal({ file, onClose }: { file: FilePreviewDetails; onClose: () => void }) {
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewError, setPreviewError] = useState("");
  const isImage = file.type.startsWith("image/");
  const canPreview = file.type === "application/pdf" || isImage || file.type.startsWith("text/") || file.type === "application/json";
  const downloadUrl = file.url.replace("&preview=1", "").replace("?preview=1", "");
  useEffect(() => {
    if (!canPreview) return;
    let active = true;
    let objectUrl = "";
    setPreviewUrl("");
    setPreviewError("");
    fetch(file.url, { credentials: "same-origin" }).then(async (response) => {
      if (!response.ok) throw new Error(`The file could not be loaded (HTTP ${response.status}).`);
      const blob = await response.blob();
      if (!blob.size) throw new Error("This file is empty.");
      objectUrl = URL.createObjectURL(blob);
      if (active) setPreviewUrl(objectUrl);
    }).catch((error) => { if (active) setPreviewError(error instanceof Error ? error.message : "The file could not be loaded."); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [canPreview, file.url]);
  return <div className="file-preview-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="file-preview-modal" role="dialog" aria-modal="true" aria-label={`Preview ${file.name}`}><header><div><b>📄 {file.name}</b><small>{canPreview ? "Document preview" : "Preview is not available for this file type"}</small></div><div><a className="secondary-button" href={downloadUrl} download>Download</a><button type="button" className="icon-button" aria-label="Close preview" onClick={onClose}>✕</button></div></header>{!canPreview ? <div className="file-preview-unavailable"><span>📥</span><b>This file type can’t be previewed here yet.</b><p>Download it to open it in the right app.</p><a className="primary-button" href={downloadUrl} download>Download {file.name}</a></div> : previewError ? <div className="file-preview-unavailable"><b>Couldn’t preview this document</b><p>{previewError}</p><a className="primary-button" href={downloadUrl} download>Download {file.name}</a></div> : !previewUrl ? <div className="file-preview-unavailable"><span>⏳</span><b>Loading preview…</b></div> : isImage ? <img className="file-preview-image" src={previewUrl} alt={file.name} onError={() => setPreviewError("The image format could not be displayed.")} /> : <iframe src={previewUrl} title={`Preview of ${file.name}`} referrerPolicy="no-referrer" sandbox="" />}</section></div>;
}
function ClientsView({ workspace, selectedClient, onPick, onAdd, onViewNotes, onOpenReports, onOpenMarketing, canViewReports, canOpenAds, canOpenSeo, canOpenSites, canRunMarketingAudit, auditRuns, onSaveMarketingAudit, onCreateMarketingAuditTask, onEdit, onDelete, onUpload, onDeleteFile, canManage, canAddNotes, canAccessVault, canManageVaultEntries, vaultUnlocked, vaultRows, onUnlockVault, onLockVault, onAddVaultEntry }: { workspace: Workspace; selectedClient?: Client; onPick: (id: string) => void; onAdd: () => void; onViewNotes: (clientId: string) => void; onOpenReports: (reportId?: string) => void; onOpenMarketing: (clientId: string, targetPage: string) => void; canViewReports: boolean; canOpenAds: boolean; canOpenSeo: boolean; canOpenSites: boolean; canRunMarketingAudit: boolean; auditRuns: MarketingAuditRun[]; onSaveMarketingAudit: (run: MarketingAuditRun) => Promise<boolean>; onCreateMarketingAuditTask: (clientId: string, service: MarketingService, title: string, notes: string) => void; onEdit: (client: Client) => void; onDelete: (client: Client) => void; onUpload: (clientId: string, file: File) => Promise<void>; onDeleteFile: (fileId: string, taskId?: string) => Promise<void>; canManage: boolean; canAddNotes: boolean; canAccessVault: boolean; canManageVaultEntries: boolean; vaultUnlocked: boolean; vaultRows: DecryptedVaultEntry[]; onUnlockVault: () => void; onLockVault: () => void; onAddVaultEntry: (clientId: string) => void }) {
  const [fileError, setFileError] = useAppErrorState("Client files");
  const [uploading, setUploading] = useState(false);
  const [filePreview, setFilePreview] = useState<FilePreviewDetails | null>(null);
  const taskFiles: ClientFile[] = selectedClient ? workspace.tasks.filter((task) => task.clientId === selectedClient.id).flatMap((task) => (task.attachments || []).map((attachment) => ({ id: attachment.id, clientId: task.clientId, name: attachment.name, type: attachment.type, size: attachment.size, uploadedAt: attachment.uploadedAt, uploadedBy: attachment.uploadedBy, taskId: task.id, taskTitle: task.title }))) : [];
  const taskFileIds = new Set(taskFiles.map((file) => file.id));
  const files = selectedClient ? [...taskFiles, ...workspace.files.filter((file) => file.clientId === selectedClient.id && !taskFileIds.has(file.id)).map((file) => ({ ...file }))].sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt)) : [];
  const clientReports = selectedClient ? (workspace.generatedReports || []).filter((report) => report.clientId === selectedClient.id).sort((a, b) => b.generatedAt.localeCompare(a.generatedAt)).slice(0, 3) : [];
  const clientMarketingLinks = selectedClient ? [
    ...(canOpenAds && selectedClient.services.some((service) => service.name === "Google Ads") ? [{ page: "Google Ads", label: "Google Ads", icon: "📣" }] : []),
    ...(canOpenAds && selectedClient.services.some((service) => service.name === "Meta Ads") ? [{ page: "Meta Ads", label: "Meta Ads", icon: "📱" }] : []),
    ...(canOpenSeo && selectedClient.services.some((service) => service.name === "SEO") ? [{ page: "SEO", label: "SEO", icon: "🔎" }] : []),
    ...(canOpenSites && selectedClient.wordpressSiteUrl ? [{ page: "Sites", label: "Website", icon: "🌐" }] : []),
    ...(canViewReports ? [{ page: "Report Studio", label: "Reports", icon: "📑" }] : []),
  ] : [];
  const upload = async (file?: File) => {
    if (!file || !selectedClient) return;
    setUploading(true); setFileError("");
    try { await onUpload(selectedClient.id, file); }
    catch (e) { setFileError(e instanceof Error ? e.message : "Could not upload the file."); }
    finally { setUploading(false); }
  };
  return <><div className="page-heading"><div><p className="eyebrow">CLIENTS · WORK · RESULTS</p><h1>Clients & workrooms</h1><p className="muted">🧭 One clear home for each client’s services, tasks, files and notes.</p></div>{canManage && <button className="primary-button" onClick={onAdd}>＋ Add client</button>}</div>{workspace.clients.length === 0 ? <div className="empty-state"><div className="empty-icon">👥</div><h2>Your client list starts here.</h2><p>Add a client to set their services, projects, fees and a dedicated workroom.</p>{canManage && <button className="primary-button" onClick={onAdd}>Add your first client <span>↗</span></button>}</div> : <div className="clients-layout"><div className="client-list">{workspace.clients.map((c) => <button className={`client-list-card ${selectedClient?.id === c.id ? "selected" : ""}`} key={c.id} onClick={() => onPick(c.id)}><span className={`client-avatar ${c.logo ? "has-logo" : ""}`} style={{ background: c.color }}>{c.logo ? <img src={c.logo} alt="" /> : initials(c.name)}</span><span className="client-card-name"><b>{c.name}</b><small>{c.company || "Client"}</small></span><span className="chevron">›</span></button>)}</div>{selectedClient ? <div className="client-detail"><div className="client-detail-head"><div className="client-title"><span className={`client-avatar large ${selectedClient.logo ? "has-logo" : ""}`} style={{ background: selectedClient.color }}>{selectedClient.logo ? <img src={selectedClient.logo} alt="" /> : initials(selectedClient.name)}</span><div><p className="eyebrow">CLIENT WORKROOM</p><h2>{selectedClient.name}</h2><p>{selectedClient.company || selectedClient.contact || "Client overview"}</p></div></div><div className="client-head-actions">{canViewReports && <button className="secondary-button" onClick={() => onOpenReports()}>📑 Reports</button>}{selectedClient.email && <a className="secondary-button contact-action" href={`mailto:${selectedClient.email}`} title={`Email ${selectedClient.name}`}>✉️ Email</a>}{selectedClient.phone && <><a className="secondary-button contact-action" href={toPhoneHref(selectedClient.phone)} title={`Call ${selectedClient.name}`}><PhoneActionIcon className="crm-contact-action-icon" /> Call</a><a className="secondary-button contact-action whatsapp-action" href={`https://wa.me/${toWhatsAppNumber(selectedClient.phone)}`} target="_blank" rel="noreferrer" title={`WhatsApp ${selectedClient.name}`}><WhatsAppActionIcon className="crm-contact-action-icon" /> WhatsApp</a></>}{canManage && <button className="secondary-button" onClick={() => onEdit(selectedClient)}>✏️ Edit client</button>}{canManage && <button className="secondary-button client-delete-button" onClick={() => onDelete(selectedClient)}>🗑 Remove client</button>}<span className="status-pill active">● Active</span></div></div><div className="client-stats"><div><small>💶 Monthly fee</small><b>{money(selectedClient.services.reduce((a, s) => a + s.fee, 0))}</b></div><div><small>📣 Monthly ad budget</small><b>{money(selectedClient.monthlyBudget || 0)}</b></div><div><small>☑️ Open tasks</small><b>{workspace.tasks.filter((t) => t.clientId === selectedClient.id && t.status !== "Done").length}</b></div></div>{canViewReports && <section className="client-report-shortcuts" aria-label={`${selectedClient.name} saved reports`}><div className="client-report-shortcuts-head"><div><h3>📑 Recent reports</h3><p>Latest saved reports for this client.</p></div><button type="button" className="text-button" onClick={() => onOpenReports()}>View all client reports ↗</button></div>{clientReports.length ? <div className="client-report-shortcuts-list">{clientReports.map((report) => <button type="button" key={report.id} onClick={() => onOpenReports(report.id)}><span><b>{report.templateName}</b><small>{report.period} · {new Date(report.generatedAt).toLocaleDateString("en-IE")}</small></span><span>Open ↗</span></button>)}</div> : <p className="client-report-shortcuts-empty">No saved reports for this client yet.</p>}</section>}{clientMarketingLinks.length > 0 && <nav className="client-marketing-links" aria-label={`${selectedClient.name} marketing sections`}><span>Open this client</span>{clientMarketingLinks.map((item) => <button key={item.page} type="button" className="secondary-button" onClick={() => onOpenMarketing(selectedClient.id, item.page)}>{item.icon} {item.label} ↗</button>)}</nav>}<div className="section-title"><h3>🧰 Services</h3></div>{selectedClient.services.length ? <div className="service-chips">{selectedClient.services.map((s) => <div key={s.name} className="service-chip"><span><AiIcon v={serviceIcons[s.name] || "✦"} /> {s.name}{s.campaignName ? ` · ${s.campaignName}` : ""}</span><b>{money(s.fee)}<small> / mo</small></b>{s.mediaSpend > 0 && <small className="spend-note">Ad spend {money(s.mediaSpend)}</small>}</div>)}</div> : <EmptyLine title="No services added yet" action="Edit client details to add service lines." />}{canAccessVault && <ClientVaultSection client={selectedClient} unlocked={vaultUnlocked} rows={vaultRows.filter((entry) => entry.clientId === selectedClient.id)} onUnlock={onUnlockVault} onLock={onLockVault} canManageEntries={canManageVaultEntries} onAdd={() => onAddVaultEntry(selectedClient.id)} />}<div className="workroom-head file-head"><div><h3>📂 Client files & data</h3><p>Store briefs, reports, keyword files, access notes and other reference files · up to 20 MB each.</p></div>{canManage && <label className="secondary-button upload-button">{uploading ? "Uploading…" : "＋ Add a file"}<input type="file" hidden disabled={uploading} onChange={(e) => { void upload(e.target.files?.[0]); e.currentTarget.value = ""; }} /></label>}</div>{fileError && <div className="form-error">{fileError}</div>}{files.length ? <div className="file-list">{files.map((file) => { const fileUrl = file.taskId ? `/api/tasks/files?taskId=${encodeURIComponent(file.taskId)}&id=${encodeURIComponent(file.id)}` : `/api/client-files?id=${encodeURIComponent(file.id)}`; return <div className="file-row" key={file.id}><FileThumb url={`${fileUrl}&preview=1`} name={file.name} type={file.type} /><div><b>{file.name}</b><small>{file.taskTitle ? `Task: ${file.taskTitle} · ` : ""}{(file.size / 1024).toFixed(0)} KB · {new Date(file.uploadedAt).toLocaleDateString("en-IE")}{file.uploadedBy ? ` · ${file.uploadedBy}` : ""}</small></div><div className="file-row-actions"><button type="button" className="file-icon-btn" title="View" aria-label={`View ${file.name}`} onClick={() => setFilePreview({ name: file.name, type: file.type, taskId: file.taskId, url: `${fileUrl}&preview=1` })}>👁</button><a href={fileUrl} className="file-icon-btn" title="Download" aria-label={`Download ${file.name}`}>⬇</a>{canManage && <button type="button" className="file-icon-btn file-icon-danger" title="Delete" aria-label={`Delete ${file.name}`} onClick={() => { if (window.confirm(`Remove “${file.name}”${file.taskTitle ? ` from ${file.taskTitle}` : ""}?`)) void onDeleteFile(file.id, file.taskId).catch((error) => setFileError(error instanceof Error ? error.message : "Could not remove the file.")); }}>🗑</button>}</div></div>; })}</div> : <div className="empty-note">No files yet. Add a client brief, monthly report or reference document.</div>}{filePreview && <FilePreviewModal file={filePreview} onClose={() => setFilePreview(null)} />}<div className="workroom-head"><div><h3>📝 Client work notes</h3><p>Notes for this client, separate from task instructions.</p></div>{canAddNotes && <button type="button" className="secondary-button" onClick={() => onViewNotes(selectedClient.id)}>🗒️ View / add notes · {workspace.notes.filter((note) => note.clientId === selectedClient.id && !note.taskId).length}</button>}</div><div className="notes-list">{workspace.notes.filter((n) => n.clientId === selectedClient.id && !n.taskId).map((n) => <article className="note-card" key={n.id}><div className="note-meta"><span className="avatar owner small-avatar">{initials(n.authorName || "Team member")}</span><b>{n.authorName || "Team member"}</b><time>{new Date(n.createdAt).toLocaleString("en-IE", { dateStyle: "medium", timeStyle: "short" })}</time></div><p>{n.body}</p></article>)}{!workspace.notes.some((n) => n.clientId === selectedClient.id && !n.taskId) && <div className="empty-note">No client notes yet. Add decisions, context or follow-up here.</div>}</div></div> : null}</div>}</>;
}

type GoogleAdsAccountChange = { id: string; campaign_id: string; campaign_name: string; change_type: string; old_value: string; new_value: string; actor: string; created_at: string; reversible?: boolean };

function GoogleAdsAccountActivity({ client }: { client: Client }) {
  const [activity, setActivity] = useState<GoogleAdsAccountChange[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [revertingId, setRevertingId] = useState("");
  const [activityOpen, setActivityOpen] = useState(false);
  const [showAllActivity, setShowAllActivity] = useState(false);
  const [revertError, setRevertError] = useAppErrorState("Google Ads activity");
  useEffect(() => {
    if (!activityOpen) return;
    const controller = new AbortController();
    setStatus("loading");
    fetchReadWithRetry(`/api/google-ads?activityClientId=${encodeURIComponent(client.id)}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => { const result = await readApiJson<{ activity?: GoogleAdsAccountChange[]; error?: string }>(response, "Google Ads activity"); if (!response.ok) throw new Error(result.error || "Could not load activity"); setActivity(result.activity || []); setStatus("ready"); })
      .catch((error) => { if (error instanceof DOMException && error.name === "AbortError") return; setStatus("error"); });
    return () => controller.abort();
  }, [client.id, activityOpen]);
  const labelFor = (change: GoogleAdsAccountChange) => {
    if (change.change_type.startsWith("REVERT:")) return "Change reversed";
    if (change.change_type === "RECONCILED_KEYWORD_STATE") return "Keyword state reconciled";
    const labels: Record<string, string> = { PAUSED: "Campaign paused", ENABLED: "Campaign enabled", SET_DAILY_BUDGET: "Daily budget updated", ADD_KEYWORD: "Keyword added", REMOVE_KEYWORD: "Keyword removed", ADD_NEGATIVE_KEYWORD: "Negative keyword added", REMOVE_NEGATIVE_KEYWORD: "Negative keyword removed", UPDATE_RESPONSIVE_SEARCH_AD: "Ad headlines and descriptions updated" };
    const label = labels[change.change_type] || change.change_type.replaceAll("_", " ").toLowerCase().replace(/^\w/, (letter) => letter.toUpperCase());
    return label;
  };
  const revert = async (change: GoogleAdsAccountChange) => {
    const keywordChange = ["ADD_KEYWORD", "REMOVE_KEYWORD", "ADD_NEGATIVE_KEYWORD", "REMOVE_NEGATIVE_KEYWORD"].includes(change.change_type);
    const keyword = keywordChange ? change.campaign_name.match(/(?:Added|Removed) (?:(negative) )?keyword “(.+?)” \((EXACT|PHRASE|BROAD)\) in (?:ad group )?(.+)$/i) : null;
    const restore = change.change_type === "SET_DAILY_BUDGET" ? `restore daily budget from €${change.new_value} to €${change.old_value}` : change.change_type === "UPDATE_RESPONSIVE_SEARCH_AD" ? "restore the ad's previous headlines and descriptions" : keyword ? `restore ${keyword[1] ? "negative " : ""}keyword “${keyword[2]}” (${keyword[3]}) in ${keyword[4]}` : keywordChange ? `restore the keyword state from ${change.new_value} to ${change.old_value}` : `restore campaign status from ${change.new_value} to ${change.old_value}`;
    if (!window.confirm(`Revert this Google Ads change for ${change.campaign_name}? This will ${restore}. The app will verify the live account first.`)) return;
    setRevertingId(change.id); setRevertError("");
    try {
      const response = await fetch("/api/google-ads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmed: true, revertActivityId: change.id }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "The change could not be reversed.");
      const refreshed = await fetch(`/api/google-ads?activityClientId=${encodeURIComponent(client.id)}`, { cache: "no-store" });
      const data = await refreshed.json() as { activity?: GoogleAdsAccountChange[] };
      if (refreshed.ok) setActivity(data.activity || []);
    } catch (reason) { setRevertError(reason instanceof Error ? reason.message : "The change could not be reversed."); }
    finally { setRevertingId(""); }
  };
  const visibleActivity = showAllActivity ? activity : activity.slice(0, 3);
  return <section className={`client-account-activity${activityOpen ? " is-open" : ""}`} aria-label={`${client.name} Google Ads account activity`}>
    <div className="client-account-activity-head"><div><h3>📊 Google Ads account activity</h3><p>Account {client.googleAdsAccountId} · actions made through this workspace.</p></div><button type="button" className="client-account-activity-toggle" aria-expanded={activityOpen} onClick={() => setActivityOpen((open) => !open)}>{activityOpen ? "Hide activity" : `View activity${activity.length ? ` · ${activity.length}` : ""}`}<span aria-hidden="true">{activityOpen ? "⌃" : "⌄"}</span></button></div>
    {activityOpen && <div className="client-account-activity-content">{revertError && <p className="form-error">{revertError}</p>}{status === "loading" ? <p className="client-account-activity-empty">Loading account activity…</p> : status === "error" ? <p className="client-account-activity-empty">Activity is unavailable right now.</p> : activity.length ? <><div className="client-account-activity-list">{visibleActivity.map((change) => <article className="client-account-activity-row" key={change.id}><b>{labelFor(change)}</b><time>{new Date(change.created_at).toLocaleString("en-IE", { dateStyle: "medium", timeStyle: "short" })}</time><span>{change.campaign_name} · campaign ID {change.campaign_id} · {change.actor}</span><details><summary>See exact change</summary><pre>Before: {change.old_value}{"\n"}After: {change.new_value}{"\n"}Recorded: {new Date(change.created_at).toLocaleString("en-IE", { dateStyle: "full", timeStyle: "long" })}</pre></details>{change.reversible && <button type="button" className="secondary-button" disabled={Boolean(revertingId)} onClick={() => void revert(change)}>{revertingId === change.id ? "Checking live state…" : "Revert"}</button>}</article>)}</div>{activity.length > 3 && <button type="button" className="client-account-activity-more" onClick={() => setShowAllActivity((show) => !show)}>{showAllActivity ? "Show fewer changes" : `View all ${activity.length} changes`}</button>}</> : <p className="client-account-activity-empty">No Google Ads changes have been recorded for this client yet. Changes made outside this workspace are not included.</p>}</div>}
  </section>;
}

function GoHighLevelConnection({ client }: { client: Client }) {
  const [locationId, setLocationId] = useState("");
  const [connection, setConnection] = useState<{ connected: boolean; locationId?: string; locationName?: string; lastVerifiedAt?: string }>({ connected: false });
  const [locations, setLocations] = useState<Array<{ id: string; name: string }>>([]);
  const [agencyConnected, setAgencyConnected] = useState(false);
  const [agencyConfigured, setAgencyConfigured] = useState(false);
  const [callbackUrl, setCallbackUrl] = useState("");
  const [requestedScopes, setRequestedScopes] = useState<string[]>([]);
  const [mappings, setMappings] = useState<Array<{ campaign: string; url: string; matchedBy: string; funnel: { name: string; path: string } | null; pages: Array<{ name: string }> ; note: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/gohighlevel?clientId=${encodeURIComponent(client.id)}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => { const body = await response.json() as any; if (!response.ok) throw new Error(body.error || "Could not check the GHL connection."); setConnection(body.connection || { connected: false }); })
      .catch((reason) => { if (!(reason instanceof DOMException && reason.name === "AbortError")) setError(reason instanceof Error ? reason.message : "Could not check the GHL connection."); });
    fetch("/api/gohighlevel/locations", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => { const body = await response.json() as any; setAgencyConfigured(Boolean(body.configured)); setAgencyConnected(Boolean(body.connected)); setLocations(body.locations || []); setCallbackUrl(String(body.callbackUrl || "")); setRequestedScopes(body.requestedScopes || []); if (!response.ok && response.status !== 503 && body.error) setError(body.error); })
      .catch((reason) => { if (!(reason instanceof DOMException && reason.name === "AbortError")) setError(reason instanceof Error ? reason.message : "Could not load GHL sub-accounts."); });
    return () => controller.abort();
  }, [client.id]);
  const loadMappings = async () => {
    const response = await fetch(`/api/gohighlevel?clientId=${encodeURIComponent(client.id)}&pages=1`, { cache: "no-store" });
    const body = await response.json() as any;
    if (!response.ok) throw new Error(body.error || "Could not read GHL funnels and pages.");
    setMappings(body.pageMap?.campaignMappings || []);
    if (body.connection) setConnection(body.connection);
  };
  const linkLocation = async () => {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/gohighlevel/locations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId: client.id, locationId }) });
      const body = await response.json() as any;
      if (!response.ok) throw new Error(body.error || "Could not link GHL sub-account.");
      setConnection({ connected: true, locationId: body.locationId, locationName: body.locationName });
      setNotice("Sub-account linked to this client and verified.");
      await loadMappings();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not link GHL sub-account."); }
    finally { setBusy(false); }
  };
  const refresh = async () => { setBusy(true); setError(""); setNotice(""); try { await loadMappings(); setNotice("GHL funnel and page list refreshed."); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not refresh GHL."); } finally { setBusy(false); } };
  const disconnect = async () => { setBusy(true); setError(""); try { const response = await fetch(`/api/gohighlevel?clientId=${encodeURIComponent(client.id)}`, { method: "DELETE" }); const body = await response.json() as any; if (!response.ok) throw new Error(body.error || "Could not disconnect GHL."); setConnection({ connected: false }); setMappings([]); setLocationId(""); setNotice("GHL disconnected from this client."); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not disconnect GHL."); } finally { setBusy(false); } };
  return <section className="client-ghl-connection"><div className="client-ghl-heading"><div><h3>🔗 GoHighLevel sub-account</h3><p>Link this client to its GHL location. Every assistant mode can use the connected sub-account through the HighLevel API scopes granted to this app.</p></div><span className={`ghl-connection-state ${connection.connected ? "connected" : ""}`}>{connection.connected ? "● Linked" : "Not linked"}</span></div>{connection.connected ? <><p className="client-ghl-connected">{connection.locationName || "GHL sub-account"} · Location ID <code>{connection.locationId}</code></p><div className="client-ghl-actions"><button className="secondary-button" type="button" disabled={busy} onClick={() => void refresh()}>{busy ? "Loading…" : "↻ Refresh funnels & pages"}</button><button className="text-button" type="button" disabled={busy} onClick={() => void disconnect()}>Unlink client</button></div>{mappings.length > 0 && <div className="client-ghl-mappings"><b>Saved campaign URL matches</b>{mappings.map((mapping, index) => <div key={`${mapping.campaign}-${index}`}><span>{mapping.campaign}</span><small>{mapping.funnel ? `${mapping.funnel.name}${mapping.pages.length ? ` · ${mapping.pages.map((page) => page.name).join(", ")}` : ""}` : mapping.note}</small></div>)}</div>}</> : agencyConnected ? <><p className="client-ghl-help">Choose the matching installed GHL sub-account for this client. Each location is linked once and shared with the AI agents.</p><div className="client-ghl-fields"><label className="field"><span>GoHighLevel sub-account</span><select value={locationId} onChange={(event) => setLocationId(event.target.value)}><option value="">Choose an installed sub-account…</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label></div><button className="primary-button" type="button" disabled={busy || !locationId} onClick={() => void linkLocation()}>{busy ? "Verifying location…" : "Link sub-account to this client"}</button></> : !agencyConfigured ? <div className="client-ghl-setup"><p className="client-ghl-help">One agency-level HighLevel app connection is required. Create a private Marketplace app, then add its credentials as Cloudflare Worker secrets; this removes the per-client API-key step.</p><ol><li><a href="https://marketplace.gohighlevel.com/" target="_blank" rel="noreferrer">Open HighLevel Marketplace → My Apps</a> and create a private app.</li><li>Choose target user <b>Sub-account</b>, allow agency install, and enable bulk installation across locations.</li><li>Add this callback URL in the app’s Auth settings: <code>{callbackUrl || "https://f2b-media-agency-os.f2b-media.workers.dev/api/oauth/callback"}</code></li><li>Grant the following scopes: <code>{requestedScopes.join(" ") || "workflows.readonly workflows.write workflows.publish adPublishing.readonly adPublishing.write funnels/funnel.readonly funnels/page.readonly"}</code></li><li>Save the Client ID, Client Secret, App ID and generated install link in Cloudflare Worker settings as <code>GHL_CLIENT_ID</code>, <code>GHL_CLIENT_SECRET</code>, <code>GHL_APP_ID</code> and <code>GHL_INSTALL_URL</code>. Also set <code>GHL_REDIRECT_URI</code> to the callback URL above.</li></ol><p className="form-hint">Keep the Client Secret private. Don’t paste it into chat. The app will show “Connect GoHighLevel agency” after those settings are saved.</p><a href="https://marketplace.gohighlevel.com/docs/Authorization/OAuth2.0/" target="_blank" rel="noreferrer">HighLevel’s official private-app setup guide ↗</a></div> : <><p className="client-ghl-help">The app settings are ready. Install it once at agency level, approve the sub-accounts, then link this client.</p><button className="primary-button" type="button" onClick={() => { window.location.href = "/api/gohighlevel/connect"; }}>🔌 Connect GoHighLevel agency</button></>}{notice && <p className="form-success" role="status">{notice}</p>}{error && <p className="form-error" role="alert">{error}</p>}<small className="client-ghl-capability-note">Every client-linked assistant mode can call documented GHL endpoints permitted by the app’s granted scopes. Actual writes depend on those scopes and HighLevel’s endpoint availability. Funnel/page metadata can be read and mapped; HighLevel does not currently publish an API to edit page-builder content.</small></section>;
}

function ClientVaultSection({ client, unlocked, rows, onUnlock, onLock, onAdd, canManageEntries }: { client: Client; unlocked: boolean; rows: DecryptedVaultEntry[]; onUnlock: () => void; onLock: () => void; onAdd: () => void; canManageEntries: boolean }) {
  return <section className="client-vault-section"><div className="workroom-head"><div><h3>🔐 Client login vault</h3><p>Credentials for {client.name} are encrypted before they are saved.</p></div>{unlocked ? <div className="vault-actions"><button className="secondary-button" onClick={onLock}>🔒 Lock vault</button>{canManageEntries && <button className="primary-button" onClick={onAdd}>＋ Add login</button>}</div> : <button className="primary-button" onClick={onUnlock}>🔓 Unlock vault</button>}</div>{!unlocked ? <div className="empty-note">Unlock the private vault to view this client’s logins. Only entries assigned to your profile are sent to this device.</div> : rows.length ? <div className="vault-grid client-vault-grid">{rows.map((entry) => <article className="vault-card" key={entry.id}><div className="vault-card-top"><span className="vault-icon">{entry.kind === "FTP / SFTP" ? "📂" : entry.kind === "Google Ads" ? "📣" : entry.kind === "Meta Ads" ? "📱" : entry.kind === "SEO" ? "🔎" : entry.kind === "Domain" ? "🌐" : "🔑"}</span><span className="role-pill">{entry.kind}</span></div><h2>{entry.title}</h2>{entry.kind === "FTP / SFTP" && <div className="vault-secret ftp-details"><small>CONNECTION</small><b>{(entry.protocol || "SFTP") + "://" + (entry.host || "Host not added") + (entry.port ? ":" + entry.port : "")}</b>{entry.path && <><small>REMOTE FOLDER</small><b>{entry.path}</b></>}</div>}{entry.url && <a href={entry.url} target="_blank" rel="noreferrer" className="vault-url">Open login page ↗</a>}<div className="vault-secret"><small>USERNAME</small><b>{entry.username || "Not added"}</b><small>PRIVATE PASSWORD / KEY</small><b>{entry.secret || "Not added"}</b></div>{entry.notes && <p className="vault-notes">{entry.notes}</p>}</article>)}</div> : <div className="empty-note">No login entries have been granted for {client.name}.</div>}</section>;
}

function ProjectsView({ workspace, onAdd }: { workspace: Workspace; onAdd: () => void }) { return <><div className="page-heading"><div><p className="eyebrow">PLANNING · DELIVERY</p><h1>Projects</h1><p className="muted">Track client engagements and delivery milestones.</p></div><button className="primary-button" onClick={onAdd}>＋ New project</button></div>{workspace.projects.length ? <div className="panel table-panel"><table><thead><tr><th>Project</th><th>Client</th><th>Status</th><th>Due date</th><th>Tasks</th></tr></thead><tbody>{workspace.projects.map((p) => <tr key={p.id}><td><b>{p.name}</b></td><td>{workspace.clients.find((c) => c.id === p.clientId)?.name || "Internal"}</td><td><span className="status-pill active">● {p.status}</span></td><td>{p.due || "—"}</td><td>{workspace.tasks.filter((t) => t.projectId === p.id).length}</td></tr>)}</tbody></table></div> : <div className="empty-state"><div className="empty-icon">▧</div><h2>No projects yet.</h2><p>Create a project to group tasks and timelines for a client.</p><button className="primary-button" onClick={onAdd}>Create a project <span>↗</span></button></div>}</>; }

function TaskChecklistEditor({ task, onSave, disabled = false, allowRemove = true, allowManualComplete = true }: { task: Task; onSave: (checklist: TaskChecklistItem[]) => void; disabled?: boolean; allowRemove?: boolean; allowManualComplete?: boolean }) {
  const [adding, setAdding] = useState(false); const [draft, setDraft] = useState(""); const [pasteNotice, setPasteNotice] = useState(""); const [editingId, setEditingId] = useState(""); const [editingText, setEditingText] = useState("");
  const checklist = task.checklist || [];
  const commitEdit = () => { const text = cleanChecklistStep(editingText); if (!text) return; onSave(checklist.map((item) => item.id === editingId ? { ...item, text, done: item.text === text ? item.done : false, evidence: item.text === text ? item.evidence : undefined } : item)); setEditingId(""); setEditingText(""); };
  const addStep = () => { const text = cleanChecklistStep(draft); if (!text) return; onSave([...checklist, { id: uid(), text, done: false }]); setDraft(""); setAdding(false); };
  const pasteSteps = (event: ClipboardEvent<HTMLInputElement>) => {
    if (disabled) return;
    const pastedText = event.clipboardData.getData("text/plain");
    const pastedSteps = pastedText.split(/\r\n|\n|\r/).map((line) => cleanChecklistStep(line.replace(/^\s*(?:[-*•▪◦]\s+|\d+[.)]\s+)/, ""))).filter(Boolean);
    if (!pastedSteps.length) return;
    event.preventDefault();
    onSave([...checklist, ...pastedSteps.map((text) => ({ id: uid(), text: text.slice(0, 240), done: false }))]);
    setDraft(""); setAdding(false);
    setPasteNotice(`Added ${pastedSteps.length} pasted checklist step${pastedSteps.length === 1 ? "" : "s"}.`);
  };
  return <section className="task-checklist-editor" aria-label={`Checklist for ${task.title}`} onClick={(event) => event.stopPropagation()}>
    <header><b>☷ Checklist {checklist.length > 0 && <small>{checklist.filter((item) => item.done).length}/{checklist.length}</small>}</b></header>
    {checklist.map((item, index) => <div className={`task-checklist-edit-row ${item.done ? "done" : ""}`} key={item.id}>
      <input type="checkbox" aria-label={`Mark checklist item ${index + 1} complete`} checked={item.done} disabled={disabled || !allowManualComplete} onChange={() => onSave(checklist.map((step) => step.id === item.id ? { ...step, done: !step.done, evidence: undefined } : step))} />
      {editingId === item.id ? <input className="task-checklist-text-input" autoFocus value={editingText} maxLength={240} onChange={(event) => setEditingText(event.target.value)} onBlur={commitEdit} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commitEdit(); } if (event.key === "Escape") setEditingId(""); }} /> : <span className="task-checklist-edit-text">{item.text}{item.evidence && <small>{item.evidence}</small>}</span>}
      <button type="button" className="task-checklist-icon-button" aria-label={`Edit checklist step ${index + 1}`} disabled={disabled} onClick={() => { setEditingId(item.id); setEditingText(item.text); }}>✎</button>
      {allowRemove && <button type="button" className="task-checklist-icon-button remove" aria-label={`Remove checklist step ${index + 1}`} disabled={disabled} onClick={() => onSave(checklist.filter((step) => step.id !== item.id))}>×</button>}
    </div>)}
    {!adding && <button type="button" className="primary-button task-checklist-add-trigger" disabled={disabled || checklist.length >= 20} onClick={() => setAdding(true)}>＋ Add checklist step</button>}
    {adding && <div className="task-checklist-add-row"><input autoFocus disabled={disabled} value={draft} maxLength={240} placeholder="Add a checklist step or paste a list…" onChange={(event) => { setDraft(event.target.value); setPasteNotice(""); }} onPaste={pasteSteps} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addStep(); } }} /><button type="button" className="primary-button" disabled={disabled || !draft.trim()} onClick={addStep}>Add</button></div>}
    {pasteNotice && <small className="task-checklist-paste-notice" role="status">{pasteNotice}</small>}
    {!checklist.length && !adding && <p className="task-checklist-empty">No checklist steps yet.</p>}
    {!allowManualComplete && checklist.length > 0 && <small className="task-checklist-locked">The AI marks AI steps verified when it records supporting evidence.</small>}
    {disabled && <small className="task-checklist-locked">Checklist is read-only while the AI run or account change is in progress.</small>}
  </section>;
}

function AiTaskScheduleControls({ task, onSchedule }: { task: Task; onSchedule: (taskId: string, due: string, time: string) => void }) {
  const [date, setDate] = useState(task.due || localDateKey()); const [time, setTime] = useState(task.repeatTime || localTimeFromIso(task.dueAt) || "09:00");
  useEffect(() => { setDate(task.due || localDateKey()); setTime(task.repeatTime || localTimeFromIso(task.dueAt) || "09:00"); }, [task.id, task.due, task.dueAt, task.repeatTime]);
  const blocked = task.aiRunState === "running" || (task.aiApprovals || []).some((item) => item.status === "pending" || item.status === "applying");
  return <div className="ai-task-scheduler" onClick={(event) => event.stopPropagation()}><b>🕒 Schedule this AI task</b><label><span>Date</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} disabled={blocked} /></label><label><span>Time</span><input type="time" value={time} onChange={(event) => setTime(event.target.value)} disabled={blocked} /></label><button type="button" className="primary-button" disabled={blocked || !date || !time} onClick={() => onSchedule(task.id, date, time)}>{task.aiRunState === "scheduled" ? "Save schedule" : "Schedule task"}</button>{blocked && <small>Finish the running AI task or resolve its pending changes first.</small>}</div>;
}

function TaskChecklistForm({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [steps, setSteps] = useState(() => value.trim() ? value.split(/\r?\n/) : []);
  useEffect(() => setSteps(value.trim() ? value.split(/\r?\n/) : []), [value]);
  const updateStep = (index: number, text: string) => { const updated = steps.map((step, stepIndex) => stepIndex === index ? text : step); setSteps(updated); onChange(updated.join("\n")); };
  const addStep = () => { if (steps.length < 20) { const updated = [...steps, ""]; setSteps(updated); onChange(updated.join("\n")); } };
  const removeStep = (index: number) => { const updated = steps.filter((_, stepIndex) => stepIndex !== index); setSteps(updated); onChange(updated.join("\n")); };
  return <section className="task-checklist-form" aria-label="Task checklist">
    <header><span>Checklist</span></header>
    {steps.map((step, index) => <div className="task-checklist-form-row" key={index}>
      <span aria-hidden="true">{index + 1}.</span>
      <input aria-label={`Checklist step ${index + 1}`} value={step} maxLength={240} placeholder="What needs to be checked or done?" onChange={(event) => updateStep(index, event.target.value)} />
      <button type="button" className="task-checklist-icon-button remove" aria-label={`Remove checklist step ${index + 1}`} onClick={() => removeStep(index)}>×</button>
    </div>)}
    <button type="button" className="primary-button task-checklist-add-trigger" disabled={steps.length >= 20} onClick={addStep}>＋ Add checklist step</button>


  </section>;
}

function ApprovalCategoryControls({ taskId, groupLabel, approvals, selectedIds, onSelectGroup, onDecide, disabled, canManage, notice }: { taskId: string; groupLabel: string; approvals: AiApprovalItem[]; selectedIds: string[]; onSelectGroup: (ids: string[], checked: boolean) => void; onDecide: (taskId: string, groupLabel: string, approvals: AiApprovalItem[], decision: "apply" | "reject") => void; disabled: boolean; canManage: boolean; notice?: string }) {
  const pending = approvals.filter((approval) => approval.status === "pending");
  if (!canManage || !pending.length) return null;
  const selected = pending.filter((approval) => selectedIds.includes(approval.id));
  const allSelected = selected.length === pending.length;
  return <div className="ai-approval-bulk-controls">
    <div className="ai-approval-bulk-select"><label><input type="checkbox" checked={allSelected} disabled={disabled} onChange={(event) => onSelectGroup(pending.map((approval) => approval.id), event.target.checked)} /> Select all {pending.length}</label><span>{selected.length} selected</span></div>
    {selected.length > 0 && <div className="ai-approval-bulk-actions"><button type="button" className="primary-button" disabled={disabled} onClick={() => onDecide(taskId, groupLabel, pending, "apply")}>✓ Approve selected ({selected.length})</button><button type="button" className="secondary-button" disabled={disabled} onClick={() => onDecide(taskId, groupLabel, pending, "reject")}>✕ Reject selected ({selected.length})</button><button type="button" className="text-button" disabled={disabled} onClick={() => onSelectGroup(pending.map((approval) => approval.id), false)}>Deselect</button></div>}
    <small>Review each recommendation’s evidence below, then select only the changes you want.</small>
    {notice && <p className="ai-approval-bulk-notice" role="status">{notice}</p>}
  </div>;
}

class TasksViewErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: { componentStack?: string }) { console.error("Tasks view failed to render", error, info.componentStack); }
  render() { return this.state.error ? <section className="panel" role="alert"><h2>Tasks couldn’t load</h2><p>Your saved tasks are still here. Try loading this page again.</p><button type="button" className="secondary-button" onClick={() => this.setState({ error: null })}>Try again</button></section> : this.props.children; }
}

function TasksView({ scopeClientId = "", workspace, activeTimer, timerNow, currentStaffId, liveTaskUpdatesUnavailable, onReviewStaffTask, onAdd, onEdit, onStatus, onReorderTasks, onSavePendingReason, onChangeTaskDate, onDelete, onChecklistToggle, onUpdateChecklist, onScheduleAiTask, onStartAiTaskNow, onCancelAiTask, onReviewAiTask, onResolveAiApproval, onApprovalFeedback, onDuplicate, onViewNotes, onUploadTaskFile, onDeleteTaskFile, onReviewAllStaffTasks, onOpenClient, onDismissAiTaskEmailNotice, onDismissAiTask, onRestoreAiTask, canApproveAiChanges, canReverseAdsChanges, canSeePipeline, canSeeAiTasks, canSeeAiCompletedTasks, canSubmitStaffReviews, canManageStaffReviews, canManageCalendar, googleCalendarStatus, onOpenCalendarSettings, onSaveGoogleAdsTaskSettings, onSetupGoogleAdsTasks, onRunGoogleAdsTest, canManageGoogleAdsTasks, recommendationFeedbackDrafts, setRecommendationFeedbackDrafts, startingRecommendationId, isAdmin, previewMemberId, saveRecommendationFeedback, refineRecommendation, rejectRecommendations, startRecommendationFollowUp }: { scopeClientId?: string; workspace: Workspace; activeTimer: Workspace["activeTimer"]; timerNow: number; currentStaffId: string; liveTaskUpdatesUnavailable: boolean; onReviewStaffTask: (taskId: string, action: "submit" | "approve" | "request_changes", note?: string, approverId?: string) => Promise<boolean>; onAdd: () => void; onEdit: (task: Task) => void; onStatus: (id: string, status: string, pendingReason?: string) => void; onReorderTasks: (orderedIds: string[], status: string) => void; onSavePendingReason: (taskId: string, reason: string) => void; onChangeTaskDate: (id: string, due: string) => void; onDelete: (id: string) => void; onChecklistToggle: (taskId: string, itemId: string) => void; onUpdateChecklist: (taskId: string, checklist: TaskChecklistItem[]) => void; onScheduleAiTask: (taskId: string, due: string, time: string) => void; onStartAiTaskNow: (taskId: string) => Promise<boolean>; onCancelAiTask: (taskId: string) => Promise<boolean>; onReviewAiTask: (taskId: string) => void; onResolveAiApproval: (taskId: string, approvalId: string, decision: "apply" | "reject" | "reconcile") => Promise<boolean>; onApprovalFeedback: (taskId: string, approvalId: string, feedback: string) => void; onDuplicate: (task: Task) => void; onViewNotes: (taskId: string, clientId: string) => void; onUploadTaskFile: (taskId: string, file: File) => Promise<TaskAttachment>; onDeleteTaskFile: (taskId: string, fileId: string) => Promise<void>; onReviewAllStaffTasks: (taskIds: string[]) => Promise<boolean>; onOpenClient: (clientId: string) => void; onDismissAiTaskEmailNotice: (taskId: string) => void; onDismissAiTask: (taskId: string) => void; onRestoreAiTask: (taskId: string) => void; canApproveAiChanges: boolean; canReverseAdsChanges: boolean; canSeePipeline: boolean; canSeeAiTasks: boolean; canSeeAiCompletedTasks: boolean; canSubmitStaffReviews: boolean; canManageStaffReviews: boolean; canManageCalendar: boolean; googleCalendarStatus: { connected: boolean; accountEmail?: string; available?: boolean; syncedCount?: number } | null; onOpenCalendarSettings: () => void; onSaveGoogleAdsTaskSettings: (clientId: string, settings: GoogleAdsTaskSettings) => Promise<boolean>; onSetupGoogleAdsTasks: (clientId?: string, settings?: GoogleAdsTaskSettings, campaignScopes?: GoogleAdsTaskScope[], persistSettingsOverride?: boolean) => Promise<{ created: number; skipped: number; message: string }>; onRunGoogleAdsTest: (clientId: string) => Promise<boolean>; canManageGoogleAdsTasks: boolean; recommendationFeedbackDrafts: Record<string, string>; setRecommendationFeedbackDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>>; startingRecommendationId: string; isAdmin: boolean; previewMemberId: string; saveRecommendationFeedback: (taskId: string, recommendationId: string, feedback: string, choices?: string[]) => Promise<{ ok: boolean; message?: string }>; refineRecommendation: (taskId: string, recommendationId: string, instruction: string) => Promise<boolean>; rejectRecommendations: (recommendations: Array<{ taskId: string; recommendationId: string }>) => Promise<boolean>; startRecommendationFollowUp: (sourceTaskId: string, recommendationId: string, title: string, detail: string, rationale: string, evidence: string, category: string, feedback: string, feedbackChoices?: string[]) => Promise<string | false> }) {
  const elapsed = activeTimer ? Math.max(0, Math.floor((timerNow - new Date(activeTimer.startedAt).getTime()) / 1000)) : 0;
  const initialAdsTaskClient = workspace.clients.find((client) => client.status.toLowerCase() === "active" && /^[0-9-]{6,24}$/.test(String(client.googleAdsAccountId || ""))) || workspace.clients[0];
  const [taskView, setTaskView] = useState<"pipeline" | "ai">(canSeePipeline ? "pipeline" : "ai");
  const [quickTaskSetupOpen, setQuickTaskSetupOpen] = useState(false);
  const [googleAdsSetupOpen, setGoogleAdsSetupOpen] = useState(false);
  const [googleAdsSetupClientId, setGoogleAdsSetupClientId] = useState(initialAdsTaskClient?.id || "");
  const [googleAdsSetupNotice, setGoogleAdsSetupNotice] = useState("");
  const [googleAdsSetupSaving, setGoogleAdsSetupSaving] = useState(false);
  const googleAdsSetupClient = workspace.clients.find((client) => client.id === googleAdsSetupClientId);
  const googleAdsSetupAgent = workspace.staff.find((member) => member.isBot && /\bconor\b/i.test(member.name) && (!Array.isArray(member.aiModeAccess) || member.aiModeAccess.includes("Google Ads")))
    || workspace.staff.find((member) => member.id === aiTeammate.id && member.isBot && (!Array.isArray(member.aiModeAccess) || member.aiModeAccess.includes("Google Ads")));
  const googleAdsSetupReady = Boolean(googleAdsSetupClient && googleAdsSetupClient.status.toLowerCase() === "active" && /^[0-9-]{6,24}$/.test(String(googleAdsSetupClient.googleAdsAccountId || "")) && googleAdsSetupAgent);
  const existingWeeklyGoogleAdsReview = workspace.tasks.find((task) => task.clientId === googleAdsSetupClientId && task.googleAdsTemplateId === "weekly-account-review-v2" && !task.campaignId && task.aiRunState !== "cancelled");
  const [taskHistoryOpenId, setTaskHistoryOpenId] = useState("");
  const [pendingReasonTask, setPendingReasonTask] = useState<Task | null>(null);
  const [pendingReasonDraft, setPendingReasonDraft] = useState("");
  const [pendingReasonTargetStatus, setPendingReasonTargetStatus] = useState("");
  const pendingReasonFor = (task: Task) => {
    if (task.pendingReason?.trim()) return friendlyAiTaskReason(task.pendingReason);
    const pendingApprovals = (task.aiApprovals || []).filter((approval) => approval.status === "pending");
    if (pendingApprovals.length) return `Waiting for approval on ${pendingApprovals.length} proposed change${pendingApprovals.length === 1 ? "" : "s"}.`;
    const aiNextStep = task.aiFeedback?.match(/(?:next step|follow-up):\s*([^\r\n]+)/i)?.[1]?.trim();
    if (aiNextStep) return aiNextStep.slice(0, 150);
    if (task.aiRunState === "scheduled") return `Waiting for its ${task.repeat && task.repeat !== "None" ? `${task.repeat.toLowerCase()} ` : ""}scheduled run${task.dueAt || task.due ? ` on ${new Date(task.dueAt || `${task.due}T09:00:00`).toLocaleString("en-IE", { dateStyle: "medium", timeStyle: "short" })}` : ""}.`;
    if (task.aiRunState === "running") return "The AI is still running the task checks.";
    if (task.aiRunState === "needs_connection") return "The required account connection or data access is unavailable; restore access so the AI can continue.";
    if (task.aiRunState === "failed") return task.aiFeedback?.trim().split(/\r?\n/)[0]?.slice(0, 150) || "The AI run failed. Open the task report to see the error and retry after fixing it.";
    if (task.aiRunState === "needs_review") {
      const openSteps = (task.checklist || []).filter((item) => !item.done).length;
      return openSteps ? `The AI finished the run, but ${openSteps} checklist step${openSteps === 1 ? "" : "s"} still need evidence or review.` : "The AI finished the run and is waiting for your review.";
    }
    if (task.reviewStatus === "submitted") return `Waiting for ${workspace.staff.find((member) => member.id === task.reviewApproverId)?.name || "the selected approver"} to review this task.`;
    return "No reason was recorded when this task entered Pending. Its original blocker is unknown; add a reason when you update it.";
  };
  const openPendingReason = (task: Task) => { setPendingReasonTargetStatus(""); setPendingReasonTask(task); setPendingReasonDraft(task.pendingReason || (isAiAssignedTask(task) ? pendingReasonFor(task) : "")); };
  const closePendingReason = () => { setPendingReasonTask(null); setPendingReasonTargetStatus(""); };
  const changeTaskStatus = (id: string, status: string) => {
    const task = workspace.tasks.find((item) => item.id === id);
    if (status === "Blocked" && task && task.status !== "Blocked" && task.status !== "Pending") { setPendingReasonTask(task); setPendingReasonDraft(task.pendingReason || ""); setPendingReasonTargetStatus(status); return; }
    onStatus(id, status);
  };
  const [workflowTab, setWorkflowTab] = useState<"board" | "approvals" | "history">("board");
  const [approvalSubTab, setApprovalSubTab] = useState<"recommendations" | "ads">("recommendations");
  const [selectedRecommendationIds, setSelectedRecommendationIds] = useState<string[]>([]);
  const [refiningRecommendationId, setRefiningRecommendationId] = useState("");
  const [recommendationFeedbackChoices, setRecommendationFeedbackChoices] = useState<Record<string, string[]>>({});
  const [recommendationFeedbackSaveState, setRecommendationFeedbackSaveState] = useState<Record<string, "saving" | "saved" | "error" | "">>({});
  const [recommendationFeedbackSaveMessage, setRecommendationFeedbackSaveMessage] = useState<Record<string, string>>({});
  const [workflowReviewApproverFilter, setWorkflowReviewApproverFilter] = useState("all");
  const [workflowReviewNotes, setWorkflowReviewNotes] = useState<Record<string, string>>({});
  const [taskFileUploads, setTaskFileUploads] = useState<Record<string, boolean>>({});
  const [taskFileErrors, setTaskFileErrors] = useState<Record<string, string>>({});
  const [reviewAllBusy, setReviewAllBusy] = useState(false);
  const [taskFilePreview, setTaskFilePreview] = useState<FilePreviewDetails | null>(null);
  const [workflowReviewApprovers, setWorkflowReviewApprovers] = useState<Record<string, string>>({});
  const [aiTaskTab, setAiTaskTab] = useState<"board" | "approvals" | "pending" | "scheduled" | "doing" | "completed" | "history">("board");
  const [aiClientFilter, setAiClientFilter] = useState(scopeClientId || "all");
  useEffect(() => { setWorkflowClientFilter(scopeClientId || "all"); setAiClientFilter(scopeClientId || "all"); }, [scopeClientId]);
  const [aiServiceFilter, setAiServiceFilter] = useState("all");
  const [aiStaffFilter, setAiStaffFilter] = useState("all");
  const [completedChangeSearch, setCompletedChangeSearch] = useState("");
  const [completedChangeCategory, setCompletedChangeCategory] = useState("all");
  const [completedChangeCampaign, setCompletedChangeCampaign] = useState("all");
  const [selectedAuditCampaignByTask, setSelectedAuditCampaignByTask] = useState<Record<string, string>>({});
  const [completedAdsActivity, setCompletedAdsActivity] = useState<Record<string, Array<{ id: string; campaign_id: string; change_type: string; old_value: string; new_value: string; created_at: string; reversible: boolean; reverted: boolean }>>>({});
  const [completedAdsActivityLoaded, setCompletedAdsActivityLoaded] = useState(false);
  const [revertingActivityId, setRevertingActivityId] = useState("");
  const [completedRevertNotice, setCompletedRevertNotice] = useState<{ id: string; message: string; ok: boolean } | null>(null);
  useEffect(() => { if (!canSeePipeline) setTaskView("ai"); else if (!canSeeAiTasks) setTaskView("pipeline"); }, [canSeePipeline, canSeeAiTasks]);
  const [priorityOnly, setPriorityOnly] = useState(false);
  const [showAiTasks, setShowAiTasksState] = useState(true);
  useEffect(() => { try { if (window.localStorage.getItem("f2b-tasks-show-ai") === "false") setShowAiTasksState(false); } catch { /* storage unavailable */ } }, []);
  const setShowAiTasks = (value: boolean) => { setShowAiTasksState(value); try { window.localStorage.setItem("f2b-tasks-show-ai", String(value)); } catch { /* storage unavailable */ } };
  const [showStaffTasks, setShowStaffTasksState] = useState(true);
  useEffect(() => { try { if (window.localStorage.getItem("f2b-tasks-show-staff") === "false") setShowStaffTasksState(false); } catch { /* storage unavailable */ } }, []);
  const setShowStaffTasks = (value: boolean) => { setShowStaffTasksState(value); try { window.localStorage.setItem("f2b-tasks-show-staff", String(value)); } catch { /* storage unavailable */ } };
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const taskId = params.get("taskId");
    if (!taskId) return;
    const task = workspace.tasks.find((item) => item.id === taskId);
    if (!task) return;
    params.delete("taskId");
    window.history.replaceState({}, "", `${window.location.pathname}${params.toString() ? `?${params}` : ""}${window.location.hash}`);
    if (!isAiAssignedTask(task)) setShowStaffTasks(true);
    if (isAiAssignedTask(task) && canSeePipeline) {
      setTaskView("pipeline");
      setShowAiTasks(true);
      const stage = getAiTaskStage(task);
      setWorkflowTab(stage === "approvals" ? "approvals" : stage === "completed" || stage === "dismissed" || stage === "cancelled" ? "history" : "board");
    } else if (isAiAssignedTask(task)) {
      setTaskView("ai");
      const stage = getAiTaskStage(task);
      setAiTaskTab(stage === "approvals" ? "approvals" : stage === "completed" || stage === "dismissed" || stage === "cancelled" ? "completed" : stage === "scheduled" || stage === "doing" || stage === "pending" ? stage : "board");
    } else {
      setTaskView("pipeline");
      setWorkflowTab(task.reviewStatus === "submitted" ? "approvals" : task.reviewHistory?.length ? "history" : "board");
    }
    const timer = window.setTimeout(() => {
      const card = document.getElementById(`task-${taskId}`);
      card?.querySelector<HTMLDetailsElement>(".pipeline-card-details")?.setAttribute("open", "");
      card?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [workspace.tasks]);
  const [workflowAssigneeFilter, setWorkflowAssigneeFilter] = useState("all");
  const [workflowClientFilter, setWorkflowClientFilter] = useState(scopeClientId || "all");
  const [workflowServiceFilter, setWorkflowServiceFilter] = useState("all");
  const [taskSoundsEnabled, setTaskSoundsEnabled] = useState(true);
  const [draggingId, setDraggingId] = useState("");
  const pointerTaskDragRef = useRef<{
    taskId: string;
    pointerId: number;
    startX: number;
    startY: number;
    offsetX: number;
    offsetY: number;
    width: number;
    source: HTMLElement;
    preview?: HTMLElement;
    overColumn?: HTMLElement;
    fx?: CardDragFx;
    removeListeners?: () => void;
    moved: boolean;
  } | null>(null);
  const suppressTaskCardClickRef = useRef("");
  const [droppedId, setDroppedId] = useState("");
  const [donePrompt, setDonePrompt] = useState<{ taskId: string; step: "ask" | "upload" } | null>(null);
  const [celebrating, setCelebrating] = useState(false);
  useEffect(() => {
    const clearFloatingTaskCards = () => {
      pointerTaskDragRef.current?.removeListeners?.();
      document.querySelectorAll<HTMLElement>(".pipeline-card-drag-preview").forEach((card) => card.remove());
      document.querySelectorAll<HTMLElement>(".pipeline-card.is-dragging").forEach((card) => card.classList.remove("is-dragging"));
      document.querySelectorAll<HTMLElement>(".pipeline-column.is-drop-target").forEach((column) => column.classList.remove("is-drop-target"));
      document.body.classList.remove("task-card-drag-active");
      document.body.classList.remove("agency-card-drag-active");
      pointerTaskDragRef.current = null;
      setDraggingId("");
    };
    clearFloatingTaskCards();
    if (taskView !== "pipeline" || !canSeePipeline) clearFloatingTaskCards();
    document.addEventListener("pointercancel", clearFloatingTaskCards, true);
    document.addEventListener("visibilitychange", clearFloatingTaskCards);
    window.addEventListener("blur", clearFloatingTaskCards);
    return () => {
      document.removeEventListener("pointercancel", clearFloatingTaskCards, true);
      document.removeEventListener("visibilitychange", clearFloatingTaskCards);
      window.removeEventListener("blur", clearFloatingTaskCards);
    };
  }, [taskView, aiTaskTab, canSeePipeline]);
  useEffect(() => { if (window.localStorage.getItem("f2b-task-sounds") === "off") setTaskSoundsEnabled(false); }, []);
  const toggleTaskSounds = () => setTaskSoundsEnabled((enabled) => {
    const next = !enabled;
    window.localStorage.setItem("f2b-task-sounds", next ? "on" : "off");
    return next;
  });
  const changeAiTaskTab = (tab: typeof aiTaskTab) => {
    if (tab === aiTaskTab) return;
    if (taskSoundsEnabled) playTaskUiSound("open");
    setAiTaskTab(tab);
  };
  const [resolvingApprovalId, setResolvingApprovalId] = useState("");
  const [startingAiTaskId, setStartingAiTaskId] = useState("");
  const [cancellingAiTaskId, setCancellingAiTaskId] = useState("");
  const [recentApprovalId, setRecentApprovalId] = useState("");
  const [selectedApprovalIds, setSelectedApprovalIds] = useState<string[]>([]);
  const [bulkApprovalGroup, setBulkApprovalGroup] = useState("");
  const [bulkApprovalNotice, setBulkApprovalNotice] = useState<{ key: string; message: string } | null>(null);
  const bulkApprovalLock = useRef(false);
  const resolveApproval = async (taskId: string, approvalId: string, decision: "apply" | "reject" | "reconcile") => {
    setResolvingApprovalId(approvalId);
    setRecentApprovalId(approvalId);
    window.setTimeout(() => setRecentApprovalId((current) => current === approvalId ? "" : current), 3500);
    try { return await onResolveAiApproval(taskId, approvalId, decision); }
    finally { setResolvingApprovalId(""); }
  };
    const startScheduledAiTaskNow = async (taskId: string) => {
    if (!canApproveAiChanges || startingAiTaskId) return;
    setStartingAiTaskId(taskId);
    try { await onStartAiTaskNow(taskId); }
    finally { setStartingAiTaskId(""); }
  };
  const toggleApprovalSelection = (approvalId: string, checked: boolean) => setSelectedApprovalIds((current) => checked ? current.includes(approvalId) ? current : [...current, approvalId] : current.filter((id) => id !== approvalId));
  const selectApprovalGroup = (approvalIds: string[], checked: boolean) => setSelectedApprovalIds((current) => checked ? [...new Set([...current, ...approvalIds])] : current.filter((id) => !approvalIds.includes(id)));
  const runBulkApproval = async (taskId: string, groupLabel: string, approvals: AiApprovalItem[], decision: "apply" | "reject") => {
    const key = `${taskId}:${groupLabel}`;
    const selected = approvals.filter((approval) => approval.status === "pending" && selectedApprovalIds.includes(approval.id));
    if (!selected.length || !canApproveAiChanges || bulkApprovalLock.current) return;
    const verb = decision === "apply" ? "approve and apply" : "reject";
    if (!window.confirm(`${verb[0].toUpperCase()}${verb.slice(1)} ${selected.length} selected ${groupLabel.toLowerCase()} recommendation${selected.length === 1 ? "" : "s"}? Each selected change will be handled and logged separately.`)) return;
    bulkApprovalLock.current = true; setBulkApprovalGroup(key); setBulkApprovalNotice(null);
    let completed = 0; let stopped = false;
    try {
      for (const approval of selected) {
        const ok = await resolveApproval(taskId, approval.id, decision);
        if (!ok) { stopped = true; break; }
        completed += 1;
        setSelectedApprovalIds((current) => current.filter((id) => id !== approval.id));
      }
      const message = stopped
        ? `${completed} resolved. Stopped because the next Ads change could not be confirmed; review it before continuing.`
        : `${completed} ${decision === "apply" ? "approved" : "rejected"} and recorded individually.`;
      setBulkApprovalNotice({ key, message });
    } finally { bulkApprovalLock.current = false; setBulkApprovalGroup(""); }
  };
  const runBulkApprovalAcrossTasks = async (groupLabel: string, items: { task: Task; approval: AiApprovalItem }[], decision: "apply" | "reject") => {
    const key = `inbox:${groupLabel}`;
    const selected = items.filter(({ approval }) => approval.status === "pending" && selectedApprovalIds.includes(approval.id));
    if (!selected.length || !canApproveAiChanges || bulkApprovalLock.current) return;
    const blocked = decision === "apply" ? selected.filter(({ task, approval }) => Boolean(approvalEvidenceBlockReason(approval, task.checklist || []))) : [];
    if (blocked.length) {
      setBulkApprovalNotice({ key, message: `${blocked.length} selected change${blocked.length === 1 ? " is" : "s are"} locked: ${approvalEvidenceBlockReason(blocked[0].approval, blocked[0].task.checklist || [])}` });
      return;
    }
    const verb = decision === "apply" ? "approve and apply" : "reject";
    if (!window.confirm(`${verb[0].toUpperCase()}${verb.slice(1)} ${selected.length} selected ${groupLabel.toLowerCase()} recommendation${selected.length === 1 ? "" : "s"} across ${new Set(selected.map(({ task }) => task.id)).size} task${new Set(selected.map(({ task }) => task.id)).size === 1 ? "" : "s"}? Each change will be processed and logged separately.`)) return;
    bulkApprovalLock.current = true; setBulkApprovalGroup(key); setBulkApprovalNotice(null);
    let completed = 0; let stopped = false;
    try {
      for (const { task, approval } of selected) {
        const ok = await resolveApproval(task.id, approval.id, decision);
        if (!ok) { stopped = true; break; }
        completed += 1;
        setSelectedApprovalIds((current) => current.filter((id) => id !== approval.id));
      }
      const message = stopped
        ? `${completed} resolved. Stopped because the next Ads change could not be confirmed; review it before continuing.`
        : `${completed} ${decision === "apply" ? "approved" : "rejected"} and recorded individually across ${new Set(selected.slice(0, completed).map(({ task }) => task.id)).size} task${new Set(selected.slice(0, completed).map(({ task }) => task.id)).size === 1 ? "" : "s"}.`;
      setBulkApprovalNotice({ key, message });
    } finally { bulkApprovalLock.current = false; setBulkApprovalGroup(""); }
  };
  const [, setDateRefresh] = useState(0);
  useEffect(() => { const timer = window.setInterval(() => setDateRefresh((value) => value + 1), 60_000); return () => window.clearInterval(timer); }, []);
  const aiTaskComplete = (task: Task) => isCompletedAiTask(task);
  const allAiAssignedTasks = workspace.tasks.filter(isAiAssignedTask);
  const aiAssignedTasks = allAiAssignedTasks.filter((task) => canSeeAiCompletedTasks || !aiTaskComplete(task));
  const aiTasksForService = aiAssignedTasks.filter((task) => aiServiceFilter === "all" || (aiServiceFilter === "none" ? !(task.aiMode || task.service)?.trim() : (task.aiMode || task.service) === aiServiceFilter));
  const aiTasksForClient = aiTasksForService.filter((task) => aiClientFilter === "all" || (aiClientFilter === "internal" ? !task.clientId : task.clientId === aiClientFilter));
  const aiTasksForStaff = aiTasksForClient.filter((task) => aiStaffFilter === "all" || (aiStaffFilter === "unassigned" ? !task.assigneeId?.trim() : task.assigneeId === aiStaffFilter));
  const clientsWithAiTasks = workspace.clients.filter((client) => allAiAssignedTasks.some((task) => task.clientId === client.id)).sort((a, b) => a.name.localeCompare(b.name));
  const staffWithAiTasks = workspace.staff.filter((member) => allAiAssignedTasks.some((task) => task.assigneeId === member.id)).sort((a, b) => a.name.localeCompare(b.name));
  const hasInternalAiTasks = allAiAssignedTasks.some((task) => !task.clientId);
  const hasUnassignedAiTasks = allAiAssignedTasks.some((task) => !task.assigneeId?.trim());
  const aiServices = Array.from(new Set(allAiAssignedTasks.map((task) => (task.aiMode || task.service)?.trim()).filter((service): service is string => Boolean(service)))).sort((a, b) => a.localeCompare(b));
  const aiBoardCandidates = aiTasksForStaff
    .filter((task) => ["scheduled", "doing", "pending", "approvals", "completed"].includes(getAiTaskStage(task)) && (getAiTaskStage(task) !== "completed" || canSeeAiCompletedTasks))
    .map((task) => {
      // AI stage is authoritative: a stale "Done" status must not make an
      // incomplete or failed run look finished on the board.
      const stage = getAiTaskStage(task);
      const status = stage === "scheduled" ? "To do" : stage === "doing" ? "In progress" : stage === "completed" ? "Done" : "Blocked";
      return task.status === status ? task : { ...task, status };
    });
  const aiPriorityFilteredBoardTasks = aiBoardCandidates.filter((task) => !priorityOnly || task.priority === "High" || task.priority === "Urgent");
  const filteredAiBoardTasks = aiPriorityFilteredBoardTasks;
  const aiPriorityFilteredTasks = aiTasksForStaff.filter((task) => !priorityOnly || task.priority === "High" || task.priority === "Urgent");
  const filteredAiTasks = aiPriorityFilteredTasks;
  const hasAiFilters = aiServiceFilter !== "all" || aiClientFilter !== "all" || aiStaffFilter !== "all";
  const hasAnyAiFilters = hasAiFilters || priorityOnly;
  const selectedTaskView = canSeePipeline ? taskView : "ai";
  const selectedTasks = selectedTaskView === "ai" ? aiAssignedTasks : workspace.tasks.filter((task) => {
    if (!isAiAssignedTask(task)) return showStaffTasks;
    if (!showAiTasks || !canSeeAiTasks) return false;
    const stage = getAiTaskStage(task);
    return !["cancelled", "dismissed"].includes(stage) && (canSeeAiCompletedTasks || stage !== "completed");
  });
  const aiHistoryTasks = filteredAiTasks.filter((task) => { const stage = getAiTaskStage(task); return stage === "cancelled" || (canApproveAiChanges && stage === "dismissed"); });
  const aiBoardTasks = selectedTaskView !== "ai" ? [] : filteredAiBoardTasks;
  const aiTasksForTab = selectedTaskView !== "ai" ? [] : aiTaskTab === "history" ? aiHistoryTasks : aiTaskTab === "board" ? [] : filteredAiTasks.filter((task) => getAiTaskStage(task) === aiTaskTab);
  const aiReviewTasks = aiTasksForTab;
  const showAiReviewCards = aiTaskTab !== "approvals" && aiTaskTab !== "board";
  const approvalTasksForClient = filteredAiTasks;
  // The approval inbox is for decisions the owner can actually make now.
  // Proposals still missing their linked checklist evidence remain with the
  // task in Pending, where the AI’s next step is shown.
  const pendingApprovalItems: { task: Task; approval: AiApprovalItem }[] = approvalTasksForClient.flatMap((task) => getAiTaskStage(task) === "approvals" ? (task.aiApprovals || []).filter((approval) => approval.status === "pending").map((approval) => ({ task, approval })) : []);
  const readyPendingApprovalItems = pendingApprovalItems.filter(({ task, approval }) => isApprovalReady(approval, task.checklist || []));
  const blockedPendingApprovalItems = pendingApprovalItems.filter(({ task, approval }) => !isApprovalReady(approval, task.checklist || []));
  // Bulk selection only includes changes that can actually be decided now.
  const selectedPendingApprovalItems = readyPendingApprovalItems.filter(({ approval }) => selectedApprovalIds.includes(approval.id));
  const applyingApprovals = approvalTasksForClient.flatMap((task) => (task.aiApprovals || []).filter((approval) => approval.status === "applying").map((approval) => ({ task, approval })));
  const verifiedApprovalItems = approvalTasksForClient.flatMap((task) => (task.aiApprovals || []).filter((approval) => approval.status === "applied" && approvalIsLiveVerified(approval)).map((approval) => ({ task, approval })));
  const completedActivityClientIds = Array.from(new Set(verifiedApprovalItems.map(({ task }) => task.clientId).filter(Boolean))).sort().join(",");
  useEffect(() => {
    if (aiTaskTab !== "completed") return;
    if (!completedActivityClientIds || !canApproveAiChanges) { setCompletedAdsActivityLoaded(true); return; }
    let cancelled = false;
    setCompletedAdsActivityLoaded(false);
    const clientIds = completedActivityClientIds.split(",");
    void Promise.all(clientIds.map(async (clientId) => {
      try {
        const response = await fetch(`/api/google-ads?activityClientId=${encodeURIComponent(clientId)}`, { cache: "no-store" });
        if (!response.ok) return [clientId, []] as const;
        const result = await response.json() as { activity?: Array<{ id: string; campaign_id: string; change_type: string; old_value: string; new_value: string; created_at: string; reversible: boolean; reverted: boolean }> };
        return [clientId, result.activity || []] as const;
      } catch { return [clientId, []] as const; }
    })).then((entries) => {
      if (!cancelled) { setCompletedAdsActivity((current) => ({ ...current, ...Object.fromEntries(entries) })); setCompletedAdsActivityLoaded(true); }
    });
    return () => { cancelled = true; };
  }, [aiTaskTab, completedActivityClientIds, canApproveAiChanges]);
  // Tab badges count task cards only. Approved Ads changes remain individual rows within their parent task.
  const aiPendingTasks = filteredAiTasks.filter((task) => getAiTaskStage(task) === "pending");
  const aiPendingCount = aiPendingTasks.length;
  const aiCompletedTasksForHistory = filteredAiTasks.filter((task) => getAiTaskStage(task) === "completed");
  const aiScheduledCount = filteredAiTasks.filter((task) => getAiTaskStage(task) === "scheduled").length;
  const aiDoingCount = filteredAiTasks.filter((task) => getAiTaskStage(task) === "doing").length;
  const aiCompletedCount = filteredAiTasks.filter((task) => getAiTaskStage(task) === "completed").length;
  const aiCancelledCount = filteredAiTasks.filter((task) => getAiTaskStage(task) === "cancelled").length;
  const aiDismissedCount = canApproveAiChanges ? filteredAiTasks.filter((task) => getAiTaskStage(task) === "dismissed").length : 0;
  const aiHistoryCount = aiCompletedCount + verifiedApprovalItems.length;
  const applyingChangeCount = applyingApprovals.length;
  const googleAdsUrlForApproval = (task: Task, approval: AiApprovalItem) => {
    const customerId = workspace.clients.find((client) => client.id === task.clientId)?.googleAdsAccountId?.replace(/\D/g, "") || "";
    const ocid = googleAdsUiAccountIds[customerId];
    if (!ocid) return "";
    const actionType = approval.actionType.toUpperCase();
    const keywordChange = actionType.includes("KEYWORD") && Boolean(approval.adGroupId);
    const path = keywordChange ? "keywords" : actionType.includes("RESPONSIVE_SEARCH_AD") ? "ads" : "campaigns";
    return `https://ads.google.com/aw/${path}?ocid=${encodeURIComponent(ocid)}&campaignId=${encodeURIComponent(approval.campaignId)}${approval.adGroupId ? `&adGroupId=${encodeURIComponent(approval.adGroupId)}` : ""}`;
  };
  const pendingAiDecisionCount = readyPendingApprovalItems.length;
  const actionableApprovalTaskCount = new Set(pendingApprovalItems.map(({ task }) => task.id)).size;
  const evidenceBlockedApprovalCount = blockedPendingApprovalItems.length;
  const aiRecommendationTasks = approvalTasksForClient.filter((task) => (task.aiRecommendations || []).some((item) => !item.followUpTaskId && !item.rejectedAt && !item.supersededAt) || (task.aiLandingPageRecommendations || []).some((item) => !item.followUpTaskId && !item.rejectedAt && !item.supersededAt));
  const allAiRecommendationItems: Array<{ key: string; task: Task; recommendationId: string; title: string; detail: string; rationale: string; evidence: string; category: string; summary: string; meta: string; campaignName?: string; savedFeedback?: string; savedChoices?: string[]; expectedImpact?: string; confidence?: "high" | "medium" | "low"; refinementAlternatives?: string[]; landingPage?: AiLandingPageRecommendation }> = aiRecommendationTasks.flatMap((task) => {
    const clientName = workspace.clients.find((client) => client.id === task.clientId)?.name || "Internal";
    const standard = (task.aiRecommendations || []).filter((item) => !item.followUpTaskId && !item.rejectedAt && !item.supersededAt).map((item) => ({ key: `${task.id}:${item.id}`, task, recommendationId: item.id, title: item.title, detail: item.detail, rationale: item.rationale, evidence: item.evidence, category: item.category, summary: item.detail, meta: clientName, campaignName: task.campaignName, savedFeedback: item.ownerFeedback, savedChoices: item.ownerFeedbackChoices, expectedImpact: item.expectedImpact, confidence: item.confidence, refinementAlternatives: item.refinementAlternatives }));
    const landing = (task.aiLandingPageRecommendations || []).filter((item) => !item.followUpTaskId && !item.rejectedAt && !item.supersededAt).map((item) => ({ key: `${task.id}:${item.id}`, task, recommendationId: item.id, title: item.section, detail: `Review and improve the landing-page section using the supplied current and suggested copy. Page URL: ${item.url}. Current copy: ${item.currentCopy}. Suggested copy: ${item.suggestedCopy}.`, rationale: item.rationale, evidence: item.evidence, category: "Landing page copy", summary: item.rationale, meta: `${clientName} · Landing page`, campaignName: task.campaignName, savedFeedback: item.ownerFeedback, savedChoices: item.ownerFeedbackChoices, expectedImpact: item.expectedImpact, confidence: item.confidence, refinementAlternatives: item.refinementAlternatives, landingPage: item }));
    return [...standard, ...landing];
  });
  const aiRecommendationItems = allAiRecommendationItems.sort((a, b) => Date.parse(b.task.aiRunAt || b.task.createdAt || "") - Date.parse(a.task.aiRunAt || a.task.createdAt || "")).filter((item, _index, all) => {
    const scope = `${item.task.clientId}:${item.task.campaignId || String(item.campaignName || item.task.service).trim().toLowerCase()}`;
    const issue = item.landingPage ? aiRecommendationIssueKey(item.title, item.category, item.rationale, item.landingPage.url, item.landingPage.section) : aiRecommendationIssueKey(item.title, item.category, item.detail);
    const key = `${scope}:${issue}`;
    const firstIndex = all.findIndex((candidate) => {
      const candidateScope = `${candidate.task.clientId}:${candidate.task.campaignId || String(candidate.campaignName || candidate.task.service).trim().toLowerCase()}`;
      const candidateIssue = candidate.landingPage ? aiRecommendationIssueKey(candidate.title, candidate.category, candidate.rationale, candidate.landingPage.url, candidate.landingPage.section) : aiRecommendationIssueKey(candidate.title, candidate.category, candidate.detail);
      return `${candidateScope}:${candidateIssue}` === key;
    });
    return firstIndex === _index;
  });
  const aiRecommendationCount = aiRecommendationItems.length;
  const quickAiSummary = (task: Task) => {
    const sections = String(task.aiFeedback || "").split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
    const body = sections.find((part) => !/^(AI task |Client:|Account:|Task card instructions:)/i.test(part)) || "The AI needs your review before this task can be closed.";
    const concise = body.split(/\n\s*(?:Checklist result:|Google Ads changes awaiting separate approval:|AI feedback:)/i)[0].replace(/\s+/g, " ").trim()
    return concise.length > 125 ? `${concise.slice(0, 122).trimEnd()}…` : concise;
  };
  const legacyAiProposal = (task: Task) => {
    const text = String(task.aiFeedback || "").match(/Proposed for approval only:\s*([\s\S]*?)(?=\n\s*\n|$)/i)?.[1]?.trim() || "";
    return text.match(/^[\s\S]*?(?=\.\s|$)/)?.[0]?.trim() || "";
  };
  const approvalActionText = (approval: AiApprovalItem) => {
    if (approval.actionType === "META_PAUSED") return `Pause Meta campaign ${approval.campaignName}`;
    if (approval.actionType === "META_ACTIVE") return `Resume Meta campaign ${approval.campaignName}`;
    if (approval.actionType === "META_SET_DAILY_BUDGET") return approval.title || `Change Meta campaign daily budget · ${approval.campaignName}`;
    if (approval.actionType.includes("KEYWORD")) return `${approval.actionType.startsWith("REMOVE") ? "Remove" : "Add"} ${approval.actionType.includes("NEGATIVE") ? "negative " : ""}keyword “${approval.keyword || "(missing keyword)"}” (${approval.matchType || "match type missing"}) in ${approval.campaignName} · ${approval.adGroupName || approval.adGroupId || "ad group missing"}`;
    if (approval.actionType === "PAUSED" || approval.actionType === "ENABLED") return `${approval.actionType === "PAUSED" ? "Pause" : "Enable"} campaign ${approval.campaignName}`;
    if (approval.actionType === "SET_DAILY_BUDGET") return `Set ${approval.campaignName} daily budget to ${money(approval.dailyBudget || 0)}`;
    return approval.title;
  };
  const activityForCompletedApproval = (task: Task, approval: AiApprovalItem) => {
    const decidedAt = approval.decidedAt ? new Date(approval.decidedAt).getTime() : NaN;
    if (!Number.isFinite(decidedAt)) return undefined;
    return (completedAdsActivity[task.clientId] || [])
      .filter((item) => item.campaign_id === approval.campaignId && item.change_type === approval.actionType && Math.abs(new Date(item.created_at).getTime() - decidedAt) <= 2 * 60 * 1000)
      .sort((a, b) => Math.abs(new Date(a.created_at).getTime() - decidedAt) - Math.abs(new Date(b.created_at).getTime() - decidedAt))[0];
  };
  const revertCompletedApproval = async (task: Task, approval: AiApprovalItem, activity: NonNullable<ReturnType<typeof activityForCompletedApproval>>) => {
    if (!canReverseAdsChanges || activity.reverted || !activity.reversible || revertingActivityId) return;
    const description = `${approvalActionText(approval)} for ${approval.campaignName}`;
    if (!window.confirm(`Revert this verified Google Ads change?

${description}

The app will check the live account first and only restore the previous value if the change is still current.`)) return;
    setRevertingActivityId(activity.id);
    setCompletedRevertNotice(null);
    try {
      const response = await fetch("/api/google-ads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmed: true, revertActivityId: activity.id }) });
      const result = await response.json() as { error?: string; detail?: string; verified?: boolean };
      if (!response.ok) throw new Error(result.error || "Google Ads did not confirm the reversal.");
      if (result.verified !== true) throw new Error("The provider accepted the reversal, but live verification did not pass. Check Google Ads before retrying.");
      const refreshed = await fetch(`/api/google-ads?activityClientId=${encodeURIComponent(task.clientId)}`, { cache: "no-store" });
      if (refreshed.ok) {
        const data = await refreshed.json() as { activity?: Array<{ id: string; campaign_id: string; change_type: string; old_value: string; new_value: string; created_at: string; reversible: boolean; reverted: boolean }> };
        setCompletedAdsActivity((current) => ({ ...current, [task.clientId]: data.activity || [] }));
      }
      setCompletedRevertNotice({ id: approval.id, message: result.detail || "Reversed and verified in Google Ads.", ok: true });
    } catch (reason) {
      setCompletedRevertNotice({ id: approval.id, message: reason instanceof Error ? reason.message : "Could not reverse this Google Ads change.", ok: false });
    } finally { setRevertingActivityId(""); }
  };
  const isNegativeKeywordApproval = (approval: AiApprovalItem) => approval.actionType.toUpperCase().includes("NEGATIVE_KEYWORD");
  const approvalGroupLabel = (actionType: string) => { const type = actionType.toUpperCase(); if (type.startsWith("META_")) return type.includes("BUDGET") ? "Meta Ads · budget" : "Meta Ads · campaign status"; if (type.startsWith("WINDSOR:")) { const action = type.slice("WINDSOR:".length); if (action.includes("NEGATIVE_KEYWORD")) return action.startsWith("REMOVE") ? "Negative keywords · remove" : "Negative keywords · add"; if (action.includes("KEYWORD")) return action.startsWith("REMOVE") ? "Additional keywords · remove" : "Additional keywords · add"; if (action.includes("RESPONSIVE_SEARCH_AD")) return "Headlines & descriptions"; if (action.includes("BUDGET")) return "Budget changes"; if (action.includes("BIDDING") || action.includes("CPC") || action.includes("TARGET_CPA") || action.includes("TARGET_ROAS")) return "Bidding changes"; if (action.includes("TARGETING") || action.includes("LANGUAGE")) return "Campaign targeting"; if (action.includes("SCHEDULE")) return "Ad schedules"; if (action.includes("AD_GROUP")) return "Ad groups"; if (action.includes("CAMPAIGN")) return "Campaign changes"; if (action.includes("ASSET") || action.includes("_AD")) return "Ads & assets"; } if (type.includes("NEGATIVE_KEYWORD")) return type.startsWith("REMOVE") ? "Negative keywords · remove" : "Negative keywords · add"; if (type.includes("KEYWORD")) return type.startsWith("REMOVE") ? "Additional keywords · remove" : "Additional keywords · add"; if (type.includes("SITELINK")) return "Sitelinks"; if (type.includes("CALLOUT")) return "Callouts"; if (type.includes("STRUCTURED_SNIPPET")) return "Structured snippets"; if (type.includes("RESPONSIVE_SEARCH_AD")) return "Headlines & descriptions"; if (type.includes("HEADLINE")) return "Headlines"; if (type.includes("DESCRIPTION")) return "Descriptions"; if (type === "SET_DAILY_BUDGET") return "Budget changes"; if (["PAUSED", "ENABLED"].includes(type)) return "Campaign status"; return "Other changes"; };
  const pendingApprovalGroups = readyPendingApprovalItems.reduce((groups, item) => {
    const label = approvalGroupLabel(item.approval.actionType);
    const group = groups.find((current) => current.label === label);
    if (group) group.items.push(item); else groups.push({ label, items: [item] });
    return groups;
  }, [] as { label: string; items: { task: Task; approval: AiApprovalItem }[] }[]);
  const completedApprovalItems = aiTaskTab === "completed" ? verifiedApprovalItems.filter(({ task, approval }) => {
    const category = approvalGroupLabel(approval.actionType);
    const campaignName = approval.campaignName || task.campaignName || "";
    const search = completedChangeSearch.trim().toLowerCase();
    const haystack = [approvalActionText(approval), task.title, campaignName, approval.adGroupName || "", workspace.clients.find((client) => client.id === task.clientId)?.name || ""].join(" ").toLowerCase();
    return (completedChangeCategory === "all" || category === completedChangeCategory) && (completedChangeCampaign === "all" || (completedChangeCampaign === "none" ? !campaignName : campaignName === completedChangeCampaign)) && (!search || haystack.includes(search));
  }) : [];
  const visibleApprovalItems = aiTaskTab === "completed" ? completedApprovalItems : [];
  const approvalVerificationState = (approval: AiApprovalItem) => {
    const detail = approval.resultDetail || "";
    const saysVerified = /(?:Google|Meta) Ads (?:read[- ]back|readback) confirmed the (?:change|new copy|campaign status)/i.test(detail);
    const saysUnverified = /could not verify the final live state|not verified/i.test(detail);
    if ((approval.verification === "verified" && saysUnverified) || (approval.verification === "unverified" && saysVerified)) return "conflict" as const;
    if (approval.verification === "verified" || (!approval.verification && saysVerified)) return "verified" as const;
    return "unverified" as const;
  };
  const statuses = [
    { label: "To do", value: "To do" },
    { label: "In progress", value: "In progress" },
    { label: "Pending", value: "Blocked" },
    { label: "Done", value: "Done" },
  ];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const taskRecency = (task: Task) => (workspace.activity || []).reduce((latest, event) => {
    if (event.taskId !== task.id) return latest;
    const timestamp = Date.parse(event.at);
    return Number.isFinite(timestamp) ? Math.max(latest, timestamp) : latest;
  }, Math.max(Date.parse(task.aiReviewedAt || "") || 0, Date.parse(task.aiRunAt || "") || 0));
  const workflowClientIds = new Set(selectedTasks.map((task) => task.clientId).filter(Boolean));
  const workflowClients = workspace.clients.filter((client) => workflowClientIds.has(client.id)).sort((a, b) => a.name.localeCompare(b.name));
  const hasInternalWorkflowTasks = selectedTasks.some((task) => !task.clientId);
  const workflowServices = Array.from(new Set(selectedTasks.map((task) => task.service?.trim()).filter((service): service is string => Boolean(service)))).sort((a, b) => a.localeCompare(b));
  const hasUncategorizedWorkflowTasks = selectedTasks.some((task) => !task.service?.trim());
  const workflowAssignees = workspace.staff.filter((member) => selectedTasks.some((task) => task.assigneeId === member.id)).sort((a, b) => a.name.localeCompare(b.name));
  const hasUnassignedWorkflowTasks = selectedTasks.some((task) => !task.assigneeId?.trim());
  const clientServiceFilteredTasks = selectedTasks.filter((task) =>
    (workflowClientFilter === "all" || (workflowClientFilter === "internal" ? !task.clientId : task.clientId === workflowClientFilter)) &&
    (workflowServiceFilter === "all" || (workflowServiceFilter === "none" ? !task.service?.trim() : task.service?.trim() === workflowServiceFilter)) &&
    (workflowAssigneeFilter === "all" || (workflowAssigneeFilter === "unassigned" ? !task.assigneeId?.trim() : task.assigneeId === workflowAssigneeFilter))
  );
  const hasWorkflowFilters = workflowClientFilter !== "all" || workflowServiceFilter !== "all" || workflowAssigneeFilter !== "all";
  const hasAnyWorkflowFilters = hasWorkflowFilters || priorityOnly;
  const priorityFilteredTasks = clientServiceFilteredTasks.filter((task) => !priorityOnly || task.priority === "High" || task.priority === "Urgent");
  const tasks = priorityFilteredTasks
    .sort((a, b) => {
      // Urgent and High priority tasks sit at the top of each column.
      const order: Record<string, number> = { Urgent: 0, High: 1, Normal: 2, Low: 3 };
      const priorityDiff = (order[a.priority] ?? 4) - (order[b.priority] ?? 4);
      if (priorityDiff) return priorityDiff;
      const recencyDiff = taskRecency(b) - taskRecency(a);
      if (recencyDiff) return recencyDiff;
      if (!a.due) return b.due ? 1 : 0;
      if (!b.due) return -1;
      return a.due.localeCompare(b.due);
    });
  const overdueTasks = tasks.filter((task) => task.status !== "Done" && Boolean(task.due) && new Date(`${task.due}T00:00:00`) < today);
  const overdueIds = new Set(overdueTasks.map((task) => task.id));
  const upcomingRecurringTasks = tasks.filter((task) => task.status !== "Done" && Boolean(task.repeat && task.repeat !== "None") && (task.occurrence || 1) > 1 && Boolean(task.due) && new Date(`${task.due}T00:00:00`) > today);
  const upcomingRecurringIds = new Set(upcomingRecurringTasks.map((task) => task.id));
  const boardTasks = tasks.filter((task) => !overdueIds.has(task.id) && !upcomingRecurringIds.has(task.id));
  const workflowStaffTasks = tasks.filter((task) => !isAiAssignedTask(task));
  const workflowReviewQueue = workflowStaffTasks.filter((task) => task.reviewStatus === "submitted" && (canManageStaffReviews || task.assigneeId === currentStaffId || task.reviewApproverId === currentStaffId));
  const workflowApprovers = workspace.staff.filter((member) => !member.isBot && getTeamPermissions(member.role, member.permissions).tasks);
  const workflowReviewCountsByApprover = workflowReviewQueue.reduce<Record<string, number>>((counts, task) => {
    const approverId = task.reviewApproverId || "unassigned";
    counts[approverId] = (counts[approverId] || 0) + 1;
    return counts;
  }, {});
  const workflowReviewTasks = workflowReviewQueue.filter((task) => workflowReviewApproverFilter === "all" || (task.reviewApproverId || "unassigned") === workflowReviewApproverFilter);
  const removeTaskFile = async (taskId: string, fileId: string, fileName: string) => {
    if (!window.confirm(`Remove “${fileName}” from this task? This also removes it from the client file list.`)) return;
    try { await onDeleteTaskFile(taskId, fileId); }
    catch (error) { setTaskFileErrors((current) => ({ ...current, [taskId]: error instanceof Error ? error.message : "Could not remove the document." })); }
  };
  const approveAllVisibleStaffTasks = async () => {
    if (!canManageStaffReviews || reviewAllBusy || !workflowReviewTasks.length) return;
    if (!window.confirm(`Approve and complete all ${workflowReviewTasks.length} staff task${workflowReviewTasks.length === 1 ? "" : "s"} currently shown?`)) return;
    setReviewAllBusy(true);
    try { await onReviewAllStaffTasks(workflowReviewTasks.map((task) => task.id)); }
    finally { setReviewAllBusy(false); }
  };
  const attachTaskFiles = async (taskId: string, files: File[]) => {
    setTaskFileErrors((current) => ({ ...current, [taskId]: "" }));
    setTaskFileUploads((current) => ({ ...current, [taskId]: true }));
    try {
      for (const file of files) await onUploadTaskFile(taskId, file);
    } catch (error) {
      setTaskFileErrors((current) => ({ ...current, [taskId]: error instanceof Error ? error.message : "Could not attach the document." }));
    } finally {
      setTaskFileUploads((current) => ({ ...current, [taskId]: false }));
    }
  };
  const workflowHistoryTasks = workflowStaffTasks.filter((task) => (canManageStaffReviews || task.assigneeId === currentStaffId) && (task.status === "Done" || task.reviewHistory?.some((entry) => entry.action === "approved" || entry.action === "changes_requested")));
  const moveTask = (id: string, status: string, soundKind: "move" | "drop" = "move") => {
    const task = workspace.tasks.find((item) => item.id === id);
    if (!task || task.status === status) return;
    if (taskSoundsEnabled) playTaskUiSound(soundKind);
    changeTaskStatus(id, status);
    if (status === "Done") {
      setDonePrompt({ taskId: id, step: "ask" });
      setCelebrating(true);
      window.setTimeout(() => setCelebrating(false), 2400);
    }
  };
  const hideCardClientLogo = Boolean(scopeClientId) && !/^agency$/i.test((workspace.clients.find((item) => item.id === scopeClientId)?.name || "").trim());
  const renderCard = (task: Task) => {
    const client = workspace.clients.find((item) => item.id === task.clientId);
    const assignee = workspace.staff.find((item) => item.id === task.assigneeId);
    const dueDate = task.due ? new Date(`${task.due}T00:00:00`) : null;
    const overdue = dueDate ? dueDate < today && task.status !== "Done" : false;
    const isActive = activeTimer?.taskId === task.id;
    const taskChecklistReady = (task.checklist || []).every((item) => item.done);
    const recentTaskNotes = workspace.notes.filter((note) => note.taskId === task.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 2);
    const taskHistoryEvents = (workspace.activity || []).filter((event) => event.taskId === task.id && (event.kind === "task" || event.kind === "time" || event.kind === "note")).sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 12);
    const taskInstructions = task.aiInstructions || task.notes || "";
    const lastAiDecision = (task.aiApprovals || []).filter((approval) => approval.decidedBy).sort((a, b) => Date.parse(b.decidedAt || "") - Date.parse(a.decidedAt || ""))[0];
    const taskApprovedBy = task.reviewStatus === "approved"
      ? task.reviewDecidedBy || task.reviewHistory?.filter((entry) => entry.action === "approved").slice(-1)[0]?.by
      : isAiAssignedTask(task) ? task.aiReviewedBy || taskHistoryEvents.find((event) => event.title === "AI task reviewed and closed")?.actor || lastAiDecision?.decidedBy : undefined;
    const taskAttachments = task.attachments || [];
    const canAttachTaskFiles = canManageStaffReviews || (canSubmitStaffReviews && task.assigneeId === currentStaffId);
    const aiStage = isAiAssignedTask(task) ? getAiTaskStage(task) : null;
    const copyCardStyles = (source: HTMLElement, target: HTMLElement) => {
      const sourceNodes = [source, ...Array.from(source.querySelectorAll<HTMLElement>("*"))];
      const targetNodes = [target, ...Array.from(target.querySelectorAll<HTMLElement>("*"))];
      sourceNodes.forEach((node, index) => {
        const rendered = window.getComputedStyle(node);
        const clone = targetNodes[index];
        if (!clone) return;
        for (const property of DRAG_COPY_PROPS) clone.style.setProperty(property, rendered.getPropertyValue(property));
      });

    };
    type TaskDragPointerEvent = Pick<PointerEvent, "pointerId" | "clientX" | "clientY" | "preventDefault" | "stopPropagation">;
    const initializeTaskDrag = (card: HTMLElement, pointerId: number, clientX: number, clientY: number) => {
      const box = card.getBoundingClientRect();
      pointerTaskDragRef.current = {
        taskId: task.id,
        pointerId,
        startX: clientX,
        startY: clientY,
        offsetX: clientX - box.left,
        offsetY: clientY - box.top,
        width: box.width,
        source: card,
        moved: false,
      };
    };
    const isTaskCardControl = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest("button,select,a,input,textarea,label"));
    const beginPointerTaskDrag = (event: ReactPointerEvent<HTMLElement>) => {
      suppressTaskCardClickRef.current = "";
      if (event.button !== 0 || isTaskCardControl(event.target)) return;
      const card = event.currentTarget;
      initializeTaskDrag(card, event.pointerId, event.clientX, event.clientY);
      const onWindowMove = (pointerEvent: PointerEvent) => movePointerTaskDrag(pointerEvent);
      const onWindowUp = (pointerEvent: PointerEvent) => finishPointerTaskDrag(pointerEvent);
      const onWindowCancel = (pointerEvent: PointerEvent) => cancelPointerTaskDrag(pointerEvent);
      window.addEventListener("pointermove", onWindowMove, { capture: true, passive: false });
      window.addEventListener("pointerup", onWindowUp, true);
      window.addEventListener("pointercancel", onWindowCancel, true);
      pointerTaskDragRef.current!.removeListeners = () => {
        window.removeEventListener("pointermove", onWindowMove, true);
        window.removeEventListener("pointerup", onWindowUp, true);
        window.removeEventListener("pointercancel", onWindowCancel, true);
      };
    };
    const movePointerTaskDrag = (event: TaskDragPointerEvent) => {
      const drag = pointerTaskDragRef.current;
      if (!drag || drag.taskId !== task.id || drag.pointerId !== event.pointerId) return;
      if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 7) return;
      event.preventDefault();
      if (!drag.moved) {
        drag.moved = true;
        // Browsers begin selecting card text before the custom drag threshold
        // is reached. Clear that range before cloning the card so the blue
        // selection cannot remain visible on the source or drag preview.
        window.getSelection()?.removeAllRanges();
        document.body.classList.add("task-card-drag-active");
        document.body.classList.add("agency-card-drag-active");
        const preview = drag.source.cloneNode(true) as HTMLElement;
        preview.classList.remove("is-dragging", "is-just-dropped");
        preview.classList.add("pipeline-card-drag-preview");
        preview.removeAttribute("draggable");
        preview.removeAttribute("tabindex");
        preview.setAttribute("aria-hidden", "true");
        preview.querySelectorAll<HTMLElement>("[id]").forEach((node) => node.removeAttribute("id"));
        // Copy styles while the source is still visible. Copying after adding
        // is-dragging copies visibility:hidden to every descendant and creates
        // an empty drag ghost.
        copyCardStyles(drag.source, preview);
        drag.source.classList.add("is-dragging");
        setDraggingId(task.id);
        preview.style.position = "fixed";
        preview.style.left = `${event.clientX - drag.offsetX}px`;
        preview.style.top = `${event.clientY - drag.offsetY}px`;
        preview.style.width = `${drag.width}px`;
        preview.style.margin = "0";
        preview.style.zIndex = "2147483000";
        preview.style.pointerEvents = "none";
        preview.style.opacity = "1";
        // Lifted card: tilts the way it is moved and leaves a shadow slot in
        // the column where it will land (see lib/card-drag-fx.ts).
        document.body.appendChild(preview);
        drag.preview = preview;
        try { drag.fx = createCardDragFx(preview, drag.source, { x: drag.offsetX, y: drag.offsetY }, { cardSelector: ".pipeline-card" }); } catch (error) { showFxError(error); }
      }
      if (drag.preview) {
        drag.preview.style.left = `${event.clientX - drag.offsetX}px`;
        drag.preview.style.top = `${event.clientY - drag.offsetY}px`;
      }
      const overColumn = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>(".pipeline-column") || undefined;
      if (drag.overColumn !== overColumn) {
        drag.overColumn?.classList.remove("is-drop-target");
        overColumn?.classList.add("is-drop-target");
        drag.overColumn = overColumn;
      }
      drag.fx?.move(event.clientX, event.clientY, overColumn || null);
    };
    const finishPointerTaskDrag = (event: TaskDragPointerEvent) => {
      const drag = pointerTaskDragRef.current;
      if (!drag || drag.taskId !== task.id || drag.pointerId !== event.pointerId) return;
      pointerTaskDragRef.current = null;
      const placement = drag.fx?.dropPlacement();
      drag.fx?.end();
      if (drag.moved) {
        event.preventDefault();
        event.stopPropagation();
        suppressTaskCardClickRef.current = task.id;
        // Some browsers report the dragged card/overlay as the hit target on
        // pointerup even when the pointer is over a column. Prefer the live hit
        // test, then the last highlighted column, then a rectangle check so a
        // drop near the column heading or its empty area is still accepted.
        const targetColumn = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>(".pipeline-column")
          || drag.overColumn
          || Array.from(document.querySelectorAll<HTMLElement>(".pipeline-column")).find((column) => {
            const rect = column.getBoundingClientRect();
            return event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
          });
        const nextStage = targetColumn?.dataset.taskDropStage;
        if (nextStage) {
          setDroppedId(task.id);
          window.setTimeout(() => setDroppedId((current) => current === task.id ? "" : current), 650);
          moveTask(task.id, nextStage, "drop");
          if (placement && targetColumn && placement.column === targetColumn) {
            const ids = Array.from(targetColumn.querySelectorAll<HTMLElement>(".pipeline-card")).map((card) => card.id.replace(/^task-/, "")).filter((id) => id && id !== task.id);
            const beforeIndex = placement.beforeId ? ids.indexOf(placement.beforeId) : -1;
            ids.splice(beforeIndex >= 0 ? beforeIndex : ids.length, 0, task.id);
            onReorderTasks(ids, nextStage);
          }
        }
      }
      drag.removeListeners?.();
      drag.preview?.remove();
      drag.source.classList.remove("is-dragging");
      drag.overColumn?.classList.remove("is-drop-target");
      document.body.classList.remove("task-card-drag-active");
      document.body.classList.remove("agency-card-drag-active");
      setDraggingId("");
    };
    const cancelPointerTaskDrag = (event: TaskDragPointerEvent) => {
      const drag = pointerTaskDragRef.current;
      if (!drag || drag.taskId !== task.id || drag.pointerId !== event.pointerId) return;
      pointerTaskDragRef.current = null;
      drag.fx?.end();
      drag.removeListeners?.();
      drag.preview?.remove();
      drag.source.classList.remove("is-dragging");
      drag.overColumn?.classList.remove("is-drop-target");
      document.body.classList.remove("task-card-drag-active");
      document.body.classList.remove("agency-card-drag-active");
      setDraggingId("");
    };
    return <article id={`task-${task.id}`} className={`pipeline-card ${draggingId === task.id ? "is-dragging" : ""} ${droppedId === task.id ? "is-just-dropped" : ""}`} key={task.id} draggable={false} role="button" tabIndex={0} aria-label={`Expand checklist and details for ${task.title}`} onPointerDown={beginPointerTaskDrag} onClick={(event) => { if (suppressTaskCardClickRef.current === task.id) { suppressTaskCardClickRef.current = ""; event.preventDefault(); event.stopPropagation(); return; } if ((event.target as HTMLElement).closest("button,select,a,input,label,details,summary")) return; if (task.status === "Pending" || task.status === "Blocked") { openPendingReason(task); return; } const details = event.currentTarget.querySelector<HTMLDetailsElement>(".pipeline-card-details"); if (details) details.open = !details.open; }} onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); if (task.status === "Pending" || task.status === "Blocked") { openPendingReason(task); return; } const details = event.currentTarget.querySelector<HTMLDetailsElement>(".pipeline-card-details"); if (details) details.open = !details.open; } }}>
      <div className="pipeline-card-top">
        <div className="task-card-priority-stack"><span className={`priority ${task.priority.toLowerCase()}`}>{task.priority === "Urgent" && <span className="task-emoji">🚨</span>}{task.priority === "High" && <span className="task-emoji">🔥</span>}{task.priority}</span></div>
        <div className="task-card-top-right">
          <span className={`service-chip service-${serviceCardClasses[task.service] || "other"}`}><span className="task-emoji"><AiIcon v={serviceIcons[task.service] || "✦"} /></span><span>{task.service}</span></span>
          <div className="task-card-actions">
            <button type="button" className="task-note-book" title="View or add work notes" aria-label="View or add task work notes" onClick={(event) => { event.stopPropagation(); onViewNotes(task.id, task.clientId); }}>📝{workspace.notes.filter((note) => note.taskId === task.id).length > 0 && <span>{workspace.notes.filter((note) => note.taskId === task.id).length}</span>}</button>
            <button type="button" className="task-edit" onClick={(event) => { event.stopPropagation(); onEdit(task); }} aria-label={`Edit ${task.title}`} title="Edit task and card note">✎</button>
            <button type="button" className="task-duplicate" onClick={(event) => { event.stopPropagation(); onDuplicate(task); }} aria-label={`Duplicate ${task.title}`} title="Duplicate card">⧉</button>
            <button type="button" className="task-delete" onClick={(event) => { event.stopPropagation(); onDelete(task.id); }} aria-label={`Delete ${task.title}`} title="Delete task">🗑 Delete</button>
          </div>
        </div>
      </div>
       {(task.status === "Blocked" || task.status === "Pending") && <div className="task-pending-reason">⏳ Pending reason: {pendingReasonFor(task)}<small>{task.pendingReason ? `Set by ${task.pendingReasonBy || "team member"}${task.pendingReasonAt ? " · " + new Date(task.pendingReasonAt).toLocaleString() : ""}` : "Reason inferred from the task status because no saved reason is available."}</small><button type="button" onClick={(event) => { event.stopPropagation(); openPendingReason(task); }}>Why is this pending?</button></div>}<details className="pipeline-card-details" onClick={(event) => event.stopPropagation()} onToggle={(event) => { const current = event.currentTarget; if (current.open) { if (taskSoundsEnabled) playTaskUiSound("open"); current.closest(".pipeline-cards")?.querySelectorAll<HTMLDetailsElement>(".pipeline-card-details[open]").forEach((other) => { if (other !== current) other.open = false; }); } }}><summary><span className="pipeline-card-summary-main">{!hideCardClientLogo && <span className={`task-client-mark ${client?.logo ? "has-logo" : ""}`} role={client ? "link" : undefined} tabIndex={client ? 0 : -1} aria-label={client ? `Open ${client.name} client page` : "Internal client"} title={client ? `Open ${client.name} client page` : "Internal client"} onClick={(event) => { if (!client) return; event.preventDefault(); event.stopPropagation(); onOpenClient(client.id); }} onKeyDown={(event) => { if (!client || (event.key !== "Enter" && event.key !== " ")) return; event.preventDefault(); event.stopPropagation(); onOpenClient(client.id); }} style={{ background: client?.color || "#3a393d", cursor: client ? "pointer" : undefined }}>{client?.logo ? <img src={client.logo} alt="" /> : initials(client?.name || "Internal")}</span>}<span className="pipeline-card-summary-copy"><b>{task.title}</b>{taskInstructions && <small className="task-card-instructions-preview" title={taskInstructions}><span>Instructions: </span>{taskInstructions}</small>}{task.status === "Done" && taskApprovedBy && <small className="task-approved-tag" title={`Approved by ${taskApprovedBy}`}>✓ Approved by {taskApprovedBy}</small>}</span></span><span className="pipeline-card-summary-footer"><span className="pipeline-card-summary-meta">{!hideCardClientLogo && <small className="pipeline-card-expand-company" role={client ? "link" : undefined} tabIndex={client ? 0 : -1} title={client ? `Open ${client.name} client page` : undefined} onClick={(event) => { if (!client) return; event.preventDefault(); event.stopPropagation(); onOpenClient(client.id); }} onKeyDown={(event) => { if (!client || (event.key !== "Enter" && event.key !== " ")) return; event.preventDefault(); event.stopPropagation(); onOpenClient(client.id); }} style={{ cursor: client ? "pointer" : undefined }}>{client?.company?.trim() || client?.name || "Internal"}</small>}</span><span className="pipeline-card-expand-label">View more details ⌄</span></span></summary><div className="pipeline-card-expanded">{task.reviewStatus === "submitted" && <p className="workflow-card-review-state">📨 Sent by {task.reviewSubmittedBy || "teammate"} to {workspace.staff.find((member) => member.id === task.reviewApproverId)?.name || "the approver"} · awaiting decision</p>}{task.reviewStatus === "changes_requested" && <p className="workflow-card-review-state is-returned">↩ Changes requested{task.reviewNote ? ` · ${task.reviewNote}` : ""}</p>}{task.campaignName && <p className="task-card-campaign">📣 {task.campaignName}</p>}{task.aiRunState && <p className={`task-ai-status ${task.aiRunState}`}>{task.aiRunState === "scheduled" ? <><AiEyesIcon /> {`Scheduled · ${task.dueAt ? new Date(task.dueAt).toLocaleString("en-IE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : task.due || "waiting for due time"}`}</> : task.aiRunState === "running" ? <><AiEyesIcon /> AI is working</> : task.aiRunState === "completed" ? <><AiEyesIcon /> {`AI completed${task.aiNotificationStatus === "sent" ? " · email sent" : task.aiNotificationStatus === "pending" || task.aiNotificationStatus === "sending" ? " · waiting for grouped approval email" : ""}`}</> : task.aiRunState === "needs_review" ? `🧭 Finished · review needed${task.aiNotificationStatus === "sent" ? " · email sent" : task.aiNotificationStatus === "pending" || task.aiNotificationStatus === "sending" ? " · waiting for grouped approval email" : ""}` : task.aiRunState === "needs_connection" ? "🔌 Needs AI connection or setup" : `⚠️ AI run failed${task.aiNotificationStatus === "sent" ? " · email sent" : task.aiNotificationStatus === "failed" ? " · email failed" : task.aiNotificationStatus === "pending" || task.aiNotificationStatus === "sending" ? " · waiting for grouped approval email" : ""}`}</p>}{task.aiRunAt && task.aiFeedback && <section className="task-ai-result" onClick={(event) => event.stopPropagation()}><b>AI update</b><p>{quickAiSummary(task)}</p>{task.wordpressDraftUrl && <a className="secondary-button task-wordpress-draft-link" href={task.wordpressDraftUrl} target="_blank" rel="noreferrer">Open WordPress draft</a>}{task.aiReferenceFileName && <small className="task-ai-reference-label">Design reference: {task.aiReferenceFileName}</small>}{task.checklist?.length ? <details><summary>Step results · {task.checklist.filter((item) => item.done).length}/{task.checklist.length} verified</summary><div className="task-ai-step-list">{task.checklist.map((item, index) => <article className={item.done ? "verified" : "unverified"} key={item.id}><span>{item.done ? "✓ Verified" : "Needs data"}</span><b>{index + 1}. {cleanChecklistStep(item.text)}</b><small>{item.evidence || (item.done ? "Evidence recorded." : "No supporting evidence returned.")}</small></article>)}</div></details> : null}{task.aiApprovals?.length ? <div className="task-ai-approval-list" aria-label="AI proposed changes">{task.aiApprovals.map((approval) => <article className={`task-ai-change ${isNegativeKeywordApproval(approval) ? "is-negative-keyword" : ""} ${approval.status} ${resolvingApprovalId === approval.id ? "is-applying" : ""} ${recentApprovalId === approval.id ? "is-just-resolved" : ""}`} key={approval.id}><div className="task-ai-change-heading"><b>{approvalActionText(approval)}</b><span className={`task-ai-change-status ${approval.status} ${approval.verification || ""}`}>{resolvingApprovalId === approval.id ? "Applying…" : approval.status === "pending" ? "Needs approval" : approval.status === "rejected" ? "Rejected · no change" : approvalVerificationState(approval) === "verified" ? "Applied · verified" : approvalVerificationState(approval) === "conflict" ? "Result conflict · check Ads" : "Sent · not verified"}</span></div>{approval.status === "pending" && <details className="task-ai-change-evidence"><summary>Why this change? · see evidence</summary><p><b>Reason:</b> {approval.rationale}</p><p><b>Evidence:</b> {approval.evidence}</p></details>}{approval.resultDetail && <div className={`task-ai-change-result ${approval.status === "rejected" ? "rejected" : approvalVerificationState(approval)}`} role="status"><b>{approval.status === "rejected" ? "✕ No account change" : approvalVerificationState(approval) === "verified" ? "✓ Confirmed live" : approvalVerificationState(approval) === "conflict" ? "⚠ Saved result conflicts with verification status" : "! Sent, not verified"}</b><details><summary>Exact result</summary><p>{approval.resultDetail}</p></details></div>}{approval.status === "pending" && (canApproveAiChanges ? <div className="task-ai-approval-actions"><button type="button" className="primary-button" aria-label={taskChecklistReady ? "Approve change: " + approvalActionText(approval) : "Finish the task checklist before approving: " + approvalActionText(approval)} title={!taskChecklistReady ? "Finish every checklist step before approving an Ads change." : "Approve this individual Google Ads change."} disabled={resolvingApprovalId === approval.id || !taskChecklistReady} onClick={() => { void resolveApproval(task.id, approval.id, "apply"); }}>{resolvingApprovalId === approval.id ? <><span className="approval-spinner" aria-hidden="true">◌</span> Applying…</> : taskChecklistReady ? "✓ Approve" : "🔒 Finish checklist first"}</button><button type="button" className="secondary-button" disabled={Boolean(bulkApprovalGroup) || resolvingApprovalId === approval.id} onClick={() => { void resolveApproval(task.id, approval.id, "reject"); }}>✕ Reject</button>{!taskChecklistReady && <small className="ai-approval-blocked-note">Complete the remaining {task.checklist?.filter((item) => !item.done).length || 0} checklist step{task.checklist?.filter((item) => !item.done).length === 1 ? "" : "s"} before you can approve it.</small>}</div> : <small>Owner/admin approval required.</small>)}</article>)}</div> : null}<details><summary>Full account breakdown</summary><pre>{formatAiRunForDisplay(task.aiFeedback)}</pre></details></section>}{taskInstructions && <p className="task-card-note"><b>Instructions:</b> {taskInstructions}</p>}<section className="task-card-attachments" aria-label={`Documents for ${task.title}`}><header><div><b>📎 Task documents</b><small>{taskAttachments.length ? `${taskAttachments.length} attached` : "Attach documents for the approver to review"}</small></div>{canAttachTaskFiles && <label className="secondary-button task-attachment-upload">{taskFileUploads[task.id] ? "Uploading…" : "＋ Attach documents"}<input type="file" multiple hidden disabled={Boolean(taskFileUploads[task.id])} accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.webp,.txt,.csv,.json,.zip" onChange={(event) => { const files = Array.from(event.currentTarget.files || []); event.currentTarget.value = ""; if (files.length) void attachTaskFiles(task.id, files); }} /></label>}</header>{canAttachTaskFiles && <small className="task-attachment-hint">PDF, Office files, images, text or ZIP · up to 20 MB each.</small>}{taskAttachments.length ? <ul>{taskAttachments.map((attachment) => { const fileUrl = `/api/tasks/files?taskId=${encodeURIComponent(task.id)}&id=${encodeURIComponent(attachment.id)}`; return <li className="task-attachment-row" key={attachment.id}><FileThumb url={`${fileUrl}&preview=1`} name={attachment.name} type={attachment.type} /><a href={fileUrl}><span>{attachment.name}</span><small>{Math.max(1, Math.ceil(attachment.size / 1024))} KB · {attachment.uploadedBy}</small></a><button type="button" className="file-icon-btn" title="View" aria-label={`View ${attachment.name}`} onClick={() => setTaskFilePreview({ name: attachment.name, type: attachment.type, taskId: task.id, url: `${fileUrl}&preview=1` })}>👁</button>{canManageStaffReviews && <button type="button" className="file-icon-btn file-icon-danger" title="Delete" aria-label={`Delete ${attachment.name}`} onClick={() => void removeTaskFile(task.id, attachment.id, attachment.name)}>🗑</button>}</li>; })}</ul> : <small>No documents attached yet.</small>}{taskFileErrors[task.id] && <p className="form-error" role="alert">{taskFileErrors[task.id]}</p>}{taskFilePreview?.taskId === task.id && <FilePreviewModal file={taskFilePreview} onClose={() => setTaskFilePreview(null)} />}</section><section className={`task-card-recent-notes ${recentTaskNotes.length ? "" : "is-empty"}`} aria-label={`Recent notes for ${task.title}`}><header><b>Recent notes</b><button type="button" onClick={(event) => { event.stopPropagation(); onViewNotes(task.id, task.clientId); }}>{recentTaskNotes.length ? "View / add notes" : "＋ Add note"}</button></header>{recentTaskNotes.length ? recentTaskNotes.map((note) => <article key={note.id}><small>{note.authorName || "Team member"} · {new Date(note.createdAt).toLocaleString("en-IE", { dateStyle: "medium", timeStyle: "short" })}</small><p>{note.body}</p></article>) : <small>No recent notes yet.</small>}</section>{task.recurrenceEmailStatus === "blocked" && <p className="task-email-status blocked">📧 Email not sent · sender setup needed</p>}{task.recurrenceEmailStatus === "failed" && <p className="task-email-status failed">📧 Email failed · check Activity for details</p>}
      <p className={`pipeline-client ${hideCardClientLogo ? "no-client-mark" : ""}`}><span className={`task-client-mark ${client?.logo ? "has-logo" : ""}`} role={client ? "link" : undefined} tabIndex={client ? 0 : -1} aria-label={client ? `Open ${client.name} client page` : "No client assigned"} title={client ? `Open ${client.name} client page` : "No client assigned"} onClick={(event) => { if (!client) return; event.preventDefault(); event.stopPropagation(); onOpenClient(client.id); }} onKeyDown={(event) => { if (!client || (event.key !== "Enter" && event.key !== " ")) return; event.preventDefault(); event.stopPropagation(); onOpenClient(client.id); }} style={{ background: client?.color || "#3a393d", cursor: client ? "pointer" : undefined }}>{client?.logo ? <img src={client.logo} alt={`${client.name} logo`} /> : initials(client?.name || "Internal")}</span><span className="pipeline-client-copy" role={client ? "link" : undefined} tabIndex={client ? 0 : -1} onClick={(event) => { if (!client) return; event.preventDefault(); event.stopPropagation(); onOpenClient(client.id); }} onKeyDown={(event) => { if (!client || (event.key !== "Enter" && event.key !== " ")) return; event.preventDefault(); event.stopPropagation(); onOpenClient(client.id); }} style={{ cursor: client ? "pointer" : undefined }}>{client?.name || "Internal · no client"}{!client && <button type="button" className="assign-client-link" onClick={() => onEdit(task)}>＋ Assign client</button>}</span></p>

      <TaskChecklistEditor task={task} onSave={(checklist) => onUpdateChecklist(task.id, checklist)} disabled={task.aiRunState === "running" || (task.aiApprovals || []).some((approval) => approval.status === "applying")} allowRemove={!task.aiApprovals?.length} allowManualComplete={!task.aiMode} /></div></details>

      <div className="pipeline-card-footer"><div className="pipeline-card-footer-identity"><div className="assignee-chip">{assignee?.isBot ? <AnimatedBot status={task.status} member={assignee} /> : assignee ? <StaffProfileAvatar member={assignee} className="task-avatar" /> : <span className="avatar task-avatar unassigned-avatar">＋</span>}<span>{assignee?.name || "Unassigned"}</span></div>{task.repeat && task.repeat !== "None" && <span className={`repeat-chip ${task.occurrence && task.occurrence > 1 && task.status !== "Done" ? "repeat-next" : ""}`}><span className="task-emoji">🔁</span>{task.occurrence && task.occurrence > 1 && task.status !== "Done" ? `NEXT RUN · ${task.repeat}` : task.repeat}</span>}</div><span className="task-footer-date-estimate"><label className={`due-chip due-chip-button task-footer-due ${overdue ? "overdue" : ""} ${!dueDate ? "no-due" : ""}`} title={dueDate ? "Change task due date" : "Choose a due date"} aria-label={dueDate ? `Change due date, currently ${dueDate.toLocaleDateString("en-IE")}` : `Set a due date for ${task.title}`}><span className="task-emoji">{overdue ? "⚠️" : "📅"}</span>{overdue ? "Overdue · " : ""}{dueDate ? dueDate.toLocaleDateString("en-IE", { day: "numeric", month: "short" }) : "Set date"}<input className="task-date-picker-input task-date-card-input" type="date" value={task.due || ""} aria-label={`Choose due date for ${task.title}`} onClick={(event) => { event.stopPropagation(); try { event.currentTarget.showPicker(); } catch { /* The native control may already have opened its picker. */ } }} onChange={(event) => onChangeTaskDate(task.id, event.target.value)} /></label>{task.estimate > 0 && <span className="estimate-chip task-card-estimate-chip task-footer-estimate" title="Estimated task time"><span className="task-emoji">⏱</span>{formatTaskEstimate(task.estimate)}</span>}</span>{!assignee?.isBot && (isActive || task.status === "In progress") ? <div className="pipeline-card-timer-actions"><span className="pipeline-card-timer-readout">⏱ {isActive ? timerClock(elapsed) : "Timer not running"}</span><button type="button" className="timer-pause" onClick={(event) => { event.stopPropagation(); moveTask(task.id, "Blocked"); }}>⏸ Pause</button><button type="button" className="timer-complete" onClick={(event) => { event.stopPropagation(); moveTask(task.id, "Done"); }}>✓ Complete</button></div> : assignee?.isBot ? aiStage === "scheduled" && canApproveAiChanges ? <button type="button" className="timer-start ai-board-card-action" disabled={Boolean(startingAiTaskId) || Boolean(task.aiStartNowRequestedAt)} onClick={(event) => { event.stopPropagation(); void startScheduledAiTaskNow(task.id); }}>{task.aiStartNowRequestedAt ? "Queued to start" : "▶ Start now"}</button> : aiStage === "doing" && task.aiRunState === "running" && canApproveAiChanges ? <button type="button" className="ai-cancel-run-button ai-board-card-action" disabled={Boolean(task.aiCancelRequestedAt) || cancellingAiTaskId === task.id} onClick={(event) => { event.stopPropagation(); setCancellingAiTaskId(task.id); void onCancelAiTask(task.id).finally(() => setCancellingAiTaskId((current) => current === task.id ? "" : current)); }}>{task.aiCancelRequestedAt || cancellingAiTaskId === task.id ? "⏳ Stopping…" : "⏹ Cancel run"}</button> : aiStage === "doing" && task.aiStartNowRequestedAt && canApproveAiChanges ? <button type="button" className="timer-start ai-board-card-action" disabled aria-label="Task is starting">⏳ Starting…</button> : aiStage === "pending" && canResumeAiTaskRun(task.aiRunState, task.aiApprovals || [], task.checklist || []) && canApproveAiChanges ? <button type="button" className="primary-button ai-board-card-action" disabled={Boolean(startingAiTaskId) || Boolean(task.aiStartNowRequestedAt)} onClick={(event) => { event.stopPropagation(); void startScheduledAiTaskNow(task.id); }} aria-label={`Retry ${task.title} with the AI`} title="Retry this AI task">{task.aiStartNowRequestedAt ? "↻ Retry queued" : "↻ Retry"}</button> : aiStage === "approvals" ? <button type="button" className="primary-button ai-board-card-action" onClick={(event) => { event.stopPropagation(); changeAiTaskTab("approvals"); }}>Review approvals</button> : aiStage === "completed" ? <button type="button" className="timer-start ai-board-card-action" onClick={(event) => { event.stopPropagation(); changeAiTaskTab("completed"); }}>View history</button> : ["needs_connection", "failed", "needs_review"].includes(task.aiRunState || "") ? <span className="ai-task-connection" title="AI task status">{task.aiRunState === "needs_connection" ? "🔌 Needs setup" : task.aiRunState === "failed" ? "⚠️ Run failed" : "🧭 Needs your review"}</span> : null : task.reviewStatus === "submitted" ? <button type="button" className="workflow-review-awaiting-button" disabled aria-label={`Awaiting approval from ${workspace.staff.find((member) => member.id === task.reviewApproverId)?.name || "the selected approver"}`} title={`Awaiting approval from ${workspace.staff.find((member) => member.id === task.reviewApproverId)?.name || "the selected approver"}`}>📨 Sent to {workspace.staff.find((member) => member.id === task.reviewApproverId)?.name.split(" ")[0] || "approver"}</button> : task.status === "Done" ? <button type="button" className="timer-start task-history-trigger" onClick={(event) => { event.stopPropagation(); setTaskHistoryOpenId((current) => current === task.id ? "" : task.id); }} aria-expanded={taskHistoryOpenId === task.id}>🗂 {taskHistoryOpenId === task.id ? "Hide history" : "View history"}</button> : <button type="button" className="timer-start" onClick={(event) => { event.stopPropagation(); moveTask(task.id, "In progress"); }} disabled={Boolean(activeTimer && activeTimer.taskId !== task.id)} aria-label={`${task.status === "Blocked" || task.status === "Pending" ? "Retry" : "Start"} ${task.title}`}>{task.status === "Blocked" || task.status === "Pending" ? "↻ Retry" : "▶ Start"}</button>}</div>
      {task.status === "Done" && taskHistoryOpenId === task.id && <section className="pipeline-card-history" aria-label={`History for ${task.title}`}><header><b>🗂 Task history</b><button type="button" onClick={(event) => { event.stopPropagation(); setTaskHistoryOpenId(""); }}>Close</button></header>{taskHistoryEvents.length ? taskHistoryEvents.map((event) => <article key={event.id}><span aria-hidden="true">{event.icon}</span><div><b>{event.title}</b><small>{new Date(event.at).toLocaleString("en-IE", { dateStyle: "medium", timeStyle: "short" })} · {event.actor}</small>{event.detail && <p>{event.detail}</p>}</div></article>) : <p>No task activity has been recorded yet.</p>}</section>}
      {canSubmitStaffReviews && !isAiAssignedTask(task) && (task.status === "Blocked" || task.status === "Pending") && task.reviewStatus !== "submitted" && <div className="workflow-submit-review-controls" onClick={(event) => event.stopPropagation()}>{workflowApprovers.length ? <><label htmlFor={`review-approver-${task.id}`}>Send to</label><select id={`review-approver-${task.id}`} value={workflowReviewApprovers[task.id] || workflowApprovers[0].id} onChange={(event) => setWorkflowReviewApprovers((current) => ({ ...current, [task.id]: event.target.value }))} aria-label={`Choose who approves ${task.title}`}>{workflowApprovers.map((member) => <option value={member.id} key={member.id}>{member.name} · {member.role}{member.id === currentStaffId ? " (you)" : ""}</option>)}</select><button type="button" className="workflow-submit-review-button" disabled={Boolean(taskFileUploads[task.id])} title={taskFileUploads[task.id] ? "Wait for document uploads to finish" : undefined} onClick={() => { void onReviewStaffTask(task.id, "submit", "", workflowReviewApprovers[task.id] || workflowApprovers[0].id); }}>{taskFileUploads[task.id] ? "Uploading documents…" : task.reviewStatus === "changes_requested" ? "📨 Resubmit for approval" : "📨 Send for approval"}</button></> : <p className="workflow-review-no-approver">Add another teammate with task access in Team to review this task.</p>}</div>}
      <label className="move-task-label"><span>📍 Move to</span><select className="inline-select" aria-label={`Move ${task.title} to a stage`} value={task.status} onChange={(event) => moveTask(task.id, event.target.value)}>{statuses.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}</select></label>
    </article>;
  };
  const aiQueueEyebrow = aiTaskTab === "board" ? "AI WORKFLOW" : aiTaskTab === "doing" ? "LIVE WORK" : aiTaskTab === "scheduled" ? "UPCOMING RUNS" : aiTaskTab === "completed" ? "AI HISTORY" : aiTaskTab === "pending" ? "PENDING WORK" : aiTaskTab === "history" ? "TASK HISTORY" : aiTaskTab === "approvals" ? "APPROVALS" : "TASK REPORTS";
  const aiQueueTitle = aiTaskTab === "board" ? "AI task board" : aiTaskTab === "doing" ? "Doing now" : aiTaskTab === "scheduled" ? "Scheduled AI tasks" : aiTaskTab === "completed" ? "History" : aiTaskTab === "pending" ? "Pending tasks" : aiTaskTab === "history" ? "Task history" : aiTaskTab === "approvals" ? "Approvals" : "Task reports";
  const aiQueueDescription = aiTaskTab === "board" ? "See every AI task by stage, just like your workflow board. Open a card for its next step." : aiTaskTab === "doing" ? "Live AI runs and approved account changes. This view refreshes automatically." : aiTaskTab === "scheduled" ? "These runs are waiting for their scheduled date and time. Open a card to review its checklist and instructions." : aiTaskTab === "completed" ? "Completed AI runs and confirmed Google Ads changes." : aiTaskTab === "pending" ? "The AI is waiting for specific evidence or a connection. Open a card to see the blocker and next step; continue the run after fixing it." : aiTaskTab === "history" ? "Cancelled runs can be retried; dismissed tasks can be restored." : aiTaskTab === "approvals" ? "Review the AI’s recommendations, then approve or reject any exact Ads changes separately." : "Task reports and recommendations.";
  const aiQueueCount = aiTaskTab === "board" ? `${aiBoardTasks.length} tasks · 4 stages` : aiTaskTab === "approvals" ? `${aiRecommendationCount} recommendation${aiRecommendationCount === 1 ? "" : "s"} · ${pendingAiDecisionCount} Ads change${pendingAiDecisionCount === 1 ? "" : "s"} ready` : aiTaskTab === "pending" ? `${aiReviewTasks.length} pending tasks` : aiTaskTab === "scheduled" ? `${aiReviewTasks.length} scheduled runs` : aiTaskTab === "doing" ? `${aiReviewTasks.length} tasks · ${applyingChangeCount} changes applying` : aiTaskTab === "completed" ? `${aiReviewTasks.length} completed tasks · ${verifiedApprovalItems.length} verified Ads changes` : aiTaskTab === "history" ? `${aiReviewTasks.length} history items` : `${aiReviewTasks.length} tasks`;
  const recommendationIcon = (category: string, title: string) => { const text = `${category} ${title}`.toLowerCase(); return /mobile|phone|form|contact/.test(text) ? "📱" : /copy|headline|word|content|hero/.test(text) ? "✍️" : /conversion|lead/.test(text) ? "🎯" : /performance|spend|budget|cost/.test(text) ? "📊" : /access|connection|history/.test(text) ? "🔌" : /asset|sitelink/.test(text) ? "🧩" : "🔎"; };
  const campaignIcon = (campaignName: string, client?: Client) => { const text = `${campaignName} ${client?.name || ""} ${client?.company || ""} ${(client?.services || []).map((service) => service.name).join(" ")}`.toLowerCase(); return /roof|gutter|fascia|soffit|roofer/.test(text) ? "🏠" : /electric|ev charger|solar|battery|wiring/.test(text) ? "⚡" : /plumb|heating|boiler|pipe|drain/.test(text) ? "🔧" : /builder|construction|renovation|extension/.test(text) ? "🧱" : /beauty|salon|hair|spa/.test(text) ? "💇" : /legal|solicitor|law firm/.test(text) ? "⚖️" : /property|letting|estate agent/.test(text) ? "🏢" : /clean|cleaning/.test(text) ? "🧹" : /paint|decorat/.test(text) ? "🖌️" : /landscap|garden|tree/.test(text) ? "🌿" : /pest|wildlife/.test(text) ? "🐝" : /security|alarm|cctv/.test(text) ? "🔒" : /car|auto|mechanic|vehicle/.test(text) ? "🚗" : /dent|clinic|medical|health/.test(text) ? "🩺" : /restaurant|cafe|food|catering/.test(text) ? "🍽️" : "📣"; };
  const recommendationSummary = (value: string, maxWords = 18) => { const words = String(value || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean); return words.length > maxWords ? `${words.slice(0, maxWords).join(" ").replace(/[,:;–-]+$/, "")}…` : words.join(" "); };
  const recommendationFeedbackOptions = ["Keep it simple", "Focus on more leads", "Draft only", "Check with me before changes"];
  const selectedVisibleRecommendationIds = aiRecommendationItems.filter((item) => selectedRecommendationIds.includes(item.key)).map((item) => item.key);
  const setRecommendationSelected = (key: string, checked: boolean) => setSelectedRecommendationIds((current) => checked ? current.includes(key) ? current : [...current, key] : current.filter((id) => id !== key));
  const toggleRecommendationFeedbackChoice = (key: string, choice: string, savedChoices: string[] = []) => setRecommendationFeedbackChoices((current) => {
    const choices = current[key] ?? savedChoices;
    return { ...current, [key]: choices.includes(choice) ? choices.filter((item) => item !== choice) : [...choices, choice] };
  });
  const startRecommendationFromFeedbackCard = async (item: (typeof aiRecommendationItems)[number], feedback: string, choices: string[]) => {
    const key = item.key;
    setRecommendationFeedbackSaveState((current) => ({ ...current, [key]: "saving" }));
    setRecommendationFeedbackSaveMessage((current) => ({ ...current, [key]: "Saving your feedback and starting the task…" }));
    const started = await startRecommendationFollowUp(item.task.id, item.recommendationId, item.title, item.detail, item.rationale, item.evidence, item.category, feedback, choices);
    setRecommendationFeedbackSaveState((current) => ({ ...current, [key]: started ? "saved" : "error" }));
    setRecommendationFeedbackSaveMessage((current) => ({ ...current, [key]: started ? "Feedback saved · AI task started on the Board" : "Couldn’t start. Your feedback is still here; try again." }));
    if (started) {
      window.setTimeout(() => setRecommendationFeedbackSaveState((current) => current[key] === "saved" ? { ...current, [key]: "" } : current), 3200);
    }
  };
  const startSelectedRecommendations = async () => {
    const selected = aiRecommendationItems.filter((item) => selectedRecommendationIds.includes(item.key));
    if (!selected.length || startingRecommendationId) return;
    let startedAny = false;
    for (const item of selected) {
      const feedback = recommendationFeedbackDrafts[item.key] ?? item.savedFeedback ?? "";
      const choices = recommendationFeedbackChoices[item.key] ?? item.savedChoices ?? [];
      const started = await startRecommendationFollowUp(item.task.id, item.recommendationId, item.title, item.detail, item.rationale, item.evidence, item.category, feedback, choices);
      if (started) {
        startedAny = true;
        setSelectedRecommendationIds((current) => current.filter((key) => key !== item.key));
      }
    }
    if (startedAny) setToast("Selected recommendation tasks started on the Board");
  };
  const rejectSelectedRecommendations = async () => {
    const selected = aiRecommendationItems.filter((item) => selectedRecommendationIds.includes(item.key));
    if (!selected.length) return;
    const saved = await rejectRecommendations(selected.map((item) => ({ taskId: item.task.id, recommendationId: item.recommendationId })));
    if (saved) setSelectedRecommendationIds((current) => current.filter((key) => !selected.some((item) => item.key === key)));
  };
  const approvalInbox = <section className="ai-approval-inbox" aria-label="Approval inbox">
    <div className="approval-inbox-subtabs" role="tablist" aria-label="Approval types"><button type="button" role="tab" aria-selected={approvalSubTab === "recommendations"} className={approvalSubTab === "recommendations" ? "selected" : ""} onClick={() => setApprovalSubTab("recommendations")}>💡 Recommendations <span>{aiRecommendationCount}</span></button><button type="button" role="tab" aria-selected={approvalSubTab === "ads"} className={approvalSubTab === "ads" ? "selected" : ""} onClick={() => setApprovalSubTab("ads")}>✅ To approve <span>{pendingAiDecisionCount}</span></button></div>
    {approvalSubTab === "recommendations" && <section className="ai-approval-recommendations" aria-label="AI recommendations"><header className="ai-approval-inbox-header"><div><h3>Recommendations</h3></div><span className="workflow-review-count">{aiRecommendationCount} suggestion{aiRecommendationCount === 1 ? "" : "s"}</span></header>{aiRecommendationItems.length > 0 && <div className="recommendation-bulk-toolbar"><label><input type="checkbox" aria-label="Select all recommendations" checked={selectedVisibleRecommendationIds.length === aiRecommendationItems.length && aiRecommendationItems.length > 0} onChange={(event) => setSelectedRecommendationIds(event.target.checked ? aiRecommendationItems.map((item) => item.key) : [])} /> Select recommendations</label><span>{selectedVisibleRecommendationIds.length} selected</span><div className="recommendation-bulk-actions"><button type="button" className="primary-button" disabled={!selectedVisibleRecommendationIds.length || Boolean(startingRecommendationId) || !isAdmin || Boolean(previewMemberId)} onClick={() => { void startSelectedRecommendations(); }}>{startingRecommendationId ? "⏳ Starting…" : `▶ Do selected with AI (${selectedVisibleRecommendationIds.length})`}</button><button type="button" className="secondary-button recommendation-reject" disabled={!selectedVisibleRecommendationIds.length || Boolean(startingRecommendationId) || !isAdmin || Boolean(previewMemberId)} onClick={() => { void rejectSelectedRecommendations(); }}>✕ Reject selected ({selectedVisibleRecommendationIds.length})</button></div></div>}{aiRecommendationItems.length > 0 ? <div className="ai-approval-inbox-rows">{aiRecommendationItems.map((item) => {
      const task = item.task;
      const client = workspace.clients.find((client) => client.id === task.clientId);
      const recommendation = item;
      const feedbackKey = item.key;
      const feedback = recommendationFeedbackDrafts[feedbackKey] ?? item.savedFeedback ?? "";
      const choices = recommendationFeedbackChoices[feedbackKey] ?? item.savedChoices ?? [];
      const availableAgent = workspace.staff.find((member) => member.id === task.assigneeId && member.isBot && (!member.aiModeAccess?.length || member.aiModeAccess.includes(task.aiMode || task.service as AiMode)));
      return <article className="ai-approval-inbox-row ai-recommendation-item task-review-shared-card" data-recommendation-key={feedbackKey} key={feedbackKey}>
        <div className="ai-recommendation-main"><label className="ai-recommendation-select"><input type="checkbox" aria-label={`Select ${item.title}`} checked={selectedRecommendationIds.includes(feedbackKey)} onChange={(event) => setRecommendationSelected(feedbackKey, event.target.checked)} /></label><span className={`ai-recommendation-brand${client?.logo ? " has-client-logo" : ""}`}>{client?.logo && <span className="ai-recommendation-icon has-client-logo" title={`${client.name} logo`}><img src={client.logo} alt={`${client.name} logo`} /></span>}<span className="ai-recommendation-type-icon" aria-label={`${item.category} recommendation`} title={item.category}>{recommendationIcon(item.category, item.title)}</span></span><div><b title={item.title}>{item.title}</b><small>{item.meta}</small>{item.campaignName && <span className="ai-recommendation-campaign" title={`Campaign: ${item.campaignName}`}><span aria-hidden="true">{campaignIcon(item.campaignName, client)}</span><b>{item.campaignName}</b></span>}<p>{recommendationSummary(item.summary)}</p></div></div>
        <div className="ai-recommendation-controls"><button type="button" className="primary-button" disabled={!isAdmin || Boolean(previewMemberId) || !availableAgent || Boolean(startingRecommendationId)} onClick={async () => { await startRecommendationFollowUp(task.id, item.recommendationId, item.title, item.detail, item.rationale, item.evidence, item.category, feedback, choices); }}>{startingRecommendationId === item.recommendationId ? <><span className="ai-moving-cog" aria-hidden="true">⚙</span> Starting…</> : "▶ Do this with AI"}</button><details className="ai-recommendation-more"><summary aria-label={item.landingPage ? "Show suggested copy" : "Show recommendation details"} title={item.landingPage ? "Suggested copy" : "Details"}><span aria-hidden="true">ⓘ</span></summary>{item.landingPage ? <><p><b>Why:</b> {recommendationSummary(item.rationale, 16)}</p><p><b>Evidence:</b> {recommendationSummary(item.evidence, 18)}</p><p><b>Page:</b> {item.landingPage.url}</p><details className="recommendation-copy-details"><summary>View page copy</summary><p><b>Current:</b> {item.landingPage.currentCopy}</p><p><b>Suggested:</b> {item.landingPage.suggestedCopy}</p></details><small>Draft only · page unchanged.</small></> : <><p><b>Why:</b> {recommendationSummary(item.rationale, 16)}</p><p><b>Evidence:</b> {recommendationSummary(item.evidence, 18)}</p></>}<small className="recommendation-quality-note">{item.confidence ? `${item.confidence[0].toUpperCase() + item.confidence.slice(1)} confidence` : "Confidence not rated"}{item.expectedImpact ? ` · ${recommendationSummary(item.expectedImpact, 10)}` : ""}</small>{Boolean(item.refinementAlternatives?.length) && <details><summary>Other ideas</summary><ul>{item.refinementAlternatives!.map((alternative, index) => <li key={index}>{recommendationSummary(alternative, 18)}</li>)}</ul></details>}</details><details className="ai-recommendation-feedback"><summary aria-label="Give feedback on this suggestion" title="Give feedback"><span aria-hidden="true">💬</span><span>Feedback</span></summary><div><p className="recommendation-feedback-scope"><span aria-hidden="true">🔁</span> Saved for this client and campaign</p><fieldset className="recommendation-feedback-choices"><legend>Quick choices</legend>{recommendationFeedbackOptions.map((choice) => <label key={choice}><input type="checkbox" checked={choices.includes(choice)} onChange={() => toggleRecommendationFeedbackChoice(feedbackKey, choice, item.savedChoices)} disabled={!isAdmin || Boolean(previewMemberId)} />{choice}</label>)}</fieldset><textarea aria-label={`Feedback for ${item.title}`} value={feedback} maxLength={500} rows={2} placeholder="What should change?" disabled={!isAdmin || Boolean(previewMemberId)} onChange={(event) => setRecommendationFeedbackDrafts((current) => ({ ...current, [feedbackKey]: event.target.value }))} /><div className="recommendation-feedback-actions"><button type="button" className={`primary-button recommendation-feedback-save ${recommendationFeedbackSaveState[feedbackKey] === "saved" ? "is-saved" : ""}`} aria-live="polite" disabled={!isAdmin || Boolean(previewMemberId) || !availableAgent || recommendationFeedbackSaveState[feedbackKey] === "saving" || Boolean(startingRecommendationId) || !(feedback.trim() || choices.length || item.savedFeedback || item.savedChoices?.length)} onClick={(event) => { event.preventDefault(); event.stopPropagation(); void startRecommendationFromFeedbackCard(item, feedback, choices); }}>{recommendationFeedbackSaveState[feedbackKey] === "saving" ? <><span className="ai-moving-cog" aria-hidden="true">⚙</span> Starting AI…</> : recommendationFeedbackSaveState[feedbackKey] === "saved" ? "✓ Started · feedback saved" : recommendationFeedbackSaveState[feedbackKey] === "error" ? "↻ Try again" : <><span aria-hidden="true">⚙</span> Save & start with AI</>}</button><button type="button" className="secondary-button" disabled={!isAdmin || Boolean(previewMemberId) || Boolean(refiningRecommendationId) || !(feedback.trim() || choices.length)} onClick={async () => { const instruction = [...choices, feedback.trim()].filter(Boolean).join(". "); setRefiningRecommendationId(item.key); await refineRecommendation(task.id, item.recommendationId, instruction); setRefiningRecommendationId(""); }}>{refiningRecommendationId === item.key ? "⏳ Updating…" : "✨ Rewrite this idea"}</button></div><small className={`recommendation-feedback-save-message ${recommendationFeedbackSaveState[feedbackKey] || ""}`} role="status" aria-live="polite">{recommendationFeedbackSaveMessage[feedbackKey]}</small></div></details><button type="button" className="secondary-button recommendation-reject" disabled={!isAdmin || Boolean(previewMemberId) || Boolean(startingRecommendationId)} aria-label={`Reject ${item.title}`} title="Reject recommendation" onClick={() => { void rejectRecommendations([{ taskId: task.id, recommendationId: item.recommendationId }]).then((saved) => { if (saved) setSelectedRecommendationIds((current) => current.filter((key) => key !== feedbackKey)); }); }}>✕</button></div>
      </article>;
    })}</div> : <div className="workflow-review-empty"><span>✅</span><b>All caught up.</b><p>New recommendations will appear here after an AI task finishes.</p></div>}</section>}
    {approvalSubTab === "ads" && <>
    <header className="ai-approval-inbox-header"><div><h3>Google Ads changes</h3><p>Approve or reject exact account changes supported by evidence.</p></div><span className="workflow-review-count">{pendingAiDecisionCount} ready{evidenceBlockedApprovalCount ? ` · ${evidenceBlockedApprovalCount} waiting` : ""}</span></header>

    {pendingApprovalItems.length ? <>
      <div className="ai-approval-inbox-toolbar"><label><input type="checkbox" checked={readyPendingApprovalItems.length > 0 && selectedPendingApprovalItems.length === readyPendingApprovalItems.length} disabled={Boolean(bulkApprovalGroup) || !canApproveAiChanges || !readyPendingApprovalItems.length} onChange={(event) => selectApprovalGroup(readyPendingApprovalItems.map(({ approval }) => approval.id), event.target.checked)} />Select ready changes</label><span>{selectedPendingApprovalItems.length} ready selected</span><div><button type="button" className="primary-button" disabled={!canApproveAiChanges || !selectedPendingApprovalItems.length || Boolean(bulkApprovalGroup)} onClick={() => { void runBulkApprovalAcrossTasks("selected changes", selectedPendingApprovalItems, "apply"); }}>✓ Approve selected</button><button type="button" className="secondary-button" disabled={!canApproveAiChanges || !selectedPendingApprovalItems.length || Boolean(bulkApprovalGroup)} onClick={() => { void runBulkApprovalAcrossTasks("selected changes", selectedPendingApprovalItems, "reject"); }}>✕ Reject selected</button><button type="button" className="text-button" disabled={!selectedPendingApprovalItems.length || Boolean(bulkApprovalGroup)} onClick={() => selectApprovalGroup(selectedPendingApprovalItems.map(({ approval }) => approval.id), false)}>Deselect</button></div></div>
      <div className="ai-approval-inbox-groups">{pendingApprovalGroups.map((group, groupIndex) => { const groupReady = group.items.filter(({ task, approval }) => isApprovalReady(approval, task.checklist || [])); const groupSelected = groupReady.filter(({ approval }) => selectedApprovalIds.includes(approval.id)); const taskCount = new Set(group.items.map(({ task }) => task.id)).size; return <details className="ai-approval-inbox-group" key={group.label} open={groupIndex === 0}><summary><b>{group.label}</b><span>{group.items.length} change{group.items.length === 1 ? "" : "s"}</span><small>{taskCount} task{taskCount === 1 ? "" : "s"}</small></summary><div className="ai-approval-inbox-group-tools"><label><input type="checkbox" checked={groupReady.length > 0 && groupSelected.length === groupReady.length} disabled={Boolean(bulkApprovalGroup) || !canApproveAiChanges} onChange={(event) => selectApprovalGroup(groupReady.map(({ approval }) => approval.id), event.target.checked)} />Select category <b>({groupSelected.length}/{group.items.length})</b></label><button type="button" className="primary-button" disabled={!canApproveAiChanges || !groupSelected.length || Boolean(bulkApprovalGroup)} onClick={() => { void runBulkApprovalAcrossTasks(group.label, groupSelected, "apply"); }}>✓ Approve selected</button><button type="button" className="secondary-button" disabled={!canApproveAiChanges || !groupSelected.length || Boolean(bulkApprovalGroup)} onClick={() => { void runBulkApprovalAcrossTasks(group.label, groupSelected, "reject"); }}>✕ Reject selected</button></div><div className="ai-approval-inbox-rows">{group.items.map(({ task, approval }) => { const client = workspace.clients.find((item) => item.id === task.clientId); const lockReason = approvalEvidenceBlockReason(approval, task.checklist || []); const locked = Boolean(lockReason); const pendingForTask = (task.aiApprovals || []).filter((item) => item.status === "pending"); const canContinueForEvidence = pendingForTask.length > 0 && pendingForTask.every((item) => Boolean(approvalEvidenceBlockReason(item, task.checklist || []))) && canResumeAiTaskRun(task.aiRunState, task.aiApprovals || [], task.checklist || []); return <article className={`ai-approval-inbox-row task-review-shared-card ${isNegativeKeywordApproval(approval) ? "is-negative-keyword" : ""}`} key={approval.id}><label className="ai-approval-inbox-select"><input type="checkbox" aria-label={`Select ${approvalActionText(approval)}`} checked={selectedApprovalIds.includes(approval.id)} disabled={Boolean(bulkApprovalGroup) || !canApproveAiChanges || locked} onChange={(event) => toggleApprovalSelection(approval.id, event.target.checked)} />{client?.logo ? <span className="ai-approval-inbox-logo"><img src={client.logo} alt="" /></span> : <span className="ai-approval-inbox-logo" aria-hidden="true">{client?.name?.slice(0, 1) || <AiEyesIcon />}</span>}<span className="ai-approval-inbox-copy">{approvalActionText(approval)}<small>{client?.name || "Internal"} · {task.title}{approval.campaignName ? ` · ${approval.campaignName}` : ""}</small></span></label>{locked && <span className="ai-approval-inbox-locked" title={lockReason}>🔒 Evidence needed</span>}{canContinueForEvidence && <button type="button" className="secondary-button" disabled={Boolean(task.aiStartNowRequestedAt) || Boolean(startingAiTaskId)} onClick={() => { void startScheduledAiTaskNow(task.id); }}>{task.aiStartNowRequestedAt ? "↻ Retry queued" : "↻ Retry evidence check"}</button>}<details><summary>Why & evidence</summary><p><b>Reason:</b> {approval.rationale || "No recommendation reason was saved."}</p><p><b>Evidence:</b> {approval.evidence || "No evidence was saved."}</p></details></article>; })}</div>{bulkApprovalNotice?.key === `inbox:${group.label}` && <p className="ai-approval-inbox-note" role="status">{bulkApprovalNotice.message}</p>}</details>; })}</div>
      {blockedPendingApprovalItems.length > 0 && <section className="ai-approval-waiting" aria-label="Changes waiting for the AI"><h4>Waiting for the AI to finish evidence <span>{blockedPendingApprovalItems.length}</span></h4><p>These are not approval requests yet. The AI must verify the linked checklist step first; then each change moves into the ready list above.</p><div>{blockedPendingApprovalItems.map(({ task, approval }) => { const checklistIndex = Number.isInteger(approval.checklistIndex) ? Number(approval.checklistIndex) : -1; const linkedStep = checklistIndex >= 0 ? task.checklist?.[checklistIndex] : undefined; const reason = approvalEvidenceBlockReason(approval, task.checklist || []); const pendingForTask = (task.aiApprovals || []).filter((item) => item.status === "pending"); const canContinue = pendingForTask.length > 0 && pendingForTask.every((item) => !isApprovalReady(item, task.checklist || [])) && canResumeAiTaskRun(task.aiRunState, task.aiApprovals || [], task.checklist || []); return <article className="ai-approval-waiting-row" key={approval.id}><div><b>{approvalActionText(approval)}</b><small>{workspace.clients.find((client) => client.id === task.clientId)?.name || "Internal"} · {task.title}</small><p>{reason}</p>{linkedStep && <small>Linked step: {cleanChecklistStep(linkedStep.text)}</small>}</div>{canContinue && <button type="button" className="secondary-button" disabled={Boolean(task.aiStartNowRequestedAt) || Boolean(startingAiTaskId)} onClick={() => { void startScheduledAiTaskNow(task.id); }}>{task.aiStartNowRequestedAt ? "↻ Retry queued" : "↻ Retry evidence check"}</button>}</article>; })}</div></section>}
      {bulkApprovalNotice?.key === "inbox:selected changes" && <p className="ai-approval-inbox-note" role="status">{bulkApprovalNotice.message}</p>}
    </> : <div className="workflow-review-empty"><span>✅</span><b>No approval request is waiting for your decision.</b><p>Evidence-backed changes will appear here when they are ready to approve.</p></div>}
    {aiPendingTasks.length > 0 && <details className="ai-approval-waiting ai-approval-waiting-collapsible" aria-label="AI tasks waiting on blockers"><summary><span className="ai-approval-waiting-title"><b><AiEyesIcon /> AI tasks needing attention</b><span>{aiPendingTasks.length}</span></span><span className="ai-approval-waiting-summary-copy">Stopped before the AI finished. These are not waiting for your approval.</span><span className="ai-approval-waiting-toggle">Show tasks</span></summary><div>{aiPendingTasks.map((task) => <article className="ai-approval-waiting-row" key={`pending-task-${task.id}`}><div><b>{task.title}</b><small>{workspace.clients.find((client) => client.id === task.clientId)?.name || "Internal"} · {task.aiMode || task.service}</small><p>{pendingReasonFor(task)}</p></div><button type="button" className="secondary-button" onClick={() => openPendingReason(task)}>View reason</button></article>)}</div></details>}
    </>}
  </section>;
  const completedInbox = <section className="ai-completed-inbox ai-history-toolbar" aria-label="History filters">
    <header><div><h3>🔎 Filter history</h3></div></header>
    <div className="ai-completed-inbox-filters"><label>🔎 Search<input type="search" value={completedChangeSearch} onChange={(event) => setCompletedChangeSearch(event.target.value)} placeholder="Search client, task or change" /></label><label>Campaign<select aria-label="Filter history by campaign" value={completedChangeCampaign} onChange={(event) => setCompletedChangeCampaign(event.target.value)}><option value="all">All campaigns</option>{Array.from(new Set(verifiedApprovalItems.map(({ task, approval }) => approval.campaignName || task.campaignName || "").filter(Boolean))).sort().map((campaign) => <option key={campaign} value={campaign}>{campaign}</option>)}{verifiedApprovalItems.some(({ task, approval }) => !(approval.campaignName || task.campaignName)) && <option value="none">No campaign</option>}</select></label><label>Type<select aria-label="Filter history by change type" value={completedChangeCategory} onChange={(event) => setCompletedChangeCategory(event.target.value)}><option value="all">All changes</option>{Array.from(new Set(verifiedApprovalItems.map(({ approval }) => approvalGroupLabel(approval.actionType)))).sort().map((category) => <option key={category} value={category}>{category}</option>)}</select></label><span>{completedApprovalItems.length} shown</span></div>
    {!completedApprovalItems.length && <p className="ai-completed-inbox-empty">No changes match these filters.</p>}
  </section>;  return <>
    <div className="page-heading task-page-heading"><div><p className="eyebrow">{selectedTaskView === "ai" ? <><AiEyesIcon /> AI · AI DELIVERY</> : "🧲 YOUR AGENCY TASKS"}</p><h1>Tasks</h1><p className="muted">{selectedTaskView === "ai" ? "Follow AI work, handle approvals and review task history." : "Tap a task to open its checklist. Drag it to move it between stages."}</p>{selectedTaskView === "ai" && liveTaskUpdatesUnavailable && <p className="ai-task-live-status" role="status"><span aria-hidden="true">↻</span> Live updates are reconnecting. Your saved tasks are still available.</p>}</div><div className="task-heading-actions">{selectedTaskView === "pipeline" && activeTimer && selectedTasks.some((task) => task.id === activeTimer.taskId) && <div className="active-timer-banner task-timer-inline"><span className="pulse"/><div><b>Timer running</b><small>{workspace.tasks.find((t) => t.id === activeTimer.taskId)?.title}</small></div><strong>{timerClock(elapsed)}</strong><button className="pause-button" onClick={() => changeTaskStatus(activeTimer.taskId, "Blocked")}><span aria-hidden="true">⏸</span> Pause · Pending</button></div>}{canManageGoogleAdsTasks && <button type="button" className="task-sound-toggle" aria-expanded={quickTaskSetupOpen} onClick={() => setQuickTaskSetupOpen((open) => !open)}>⚡ Quick task setup</button>}<button type="button" className="task-sound-toggle" aria-pressed={taskSoundsEnabled} onClick={toggleTaskSounds} title={taskSoundsEnabled ? "Turn task sounds off" : "Turn task sounds on"}>{taskSoundsEnabled ? "🔊 Sounds on" : "🔇 Sounds off"}</button><button className="primary-button" onClick={onAdd}>＋ New task</button></div></div>
    {canManageGoogleAdsTasks && quickTaskSetupOpen && <section className="quick-task-setup-menu" aria-label="Quick task setup"><b>What would you like to set up?</b><button type="button" className="secondary-button" onClick={() => { setQuickTaskSetupOpen(false); onAdd(); }}>＋ Create a task</button><button type="button" className="secondary-button" onClick={() => { setQuickTaskSetupOpen(false); setGoogleAdsSetupOpen(true); setGoogleAdsSetupNotice(""); }}>📣 Weekly Google Ads review</button></section>}
    {canManageGoogleAdsTasks && googleAdsSetupOpen && <section className="google-ads-task-setup" aria-label="Google Ads task setup"><header><div><p className="eyebrow">ONE REVIEW · PER CLIENT</p><h2>Google Ads review</h2><p>One weekly review checks performance and sends only the strongest findings to Recommendations. Exact Ads changes wait in To approve.</p></div><button type="button" className="text-button" onClick={() => setGoogleAdsSetupOpen(false)}>Close</button></header><div className="google-ads-task-setup-toolbar"><label className="field"><span>Client</span><select value={googleAdsSetupClientId} onChange={(event) => { setGoogleAdsSetupClientId(event.target.value); setGoogleAdsSetupNotice(""); }}><option value="">Choose a client</option>{workspace.clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label><div className="google-ads-task-setup-status" role="status">{googleAdsSetupClient ? <><b>{googleAdsSetupReady ? "✅ Ready" : "⚠️ Needs a connection"}</b><span>{googleAdsSetupClient.googleAdsAccountId ? `Google Ads · ${googleAdsSetupClient.googleAdsAccountId}` : "Link a Google Ads account in the client profile"}{googleAdsSetupAgent ? " · the AI ready" : " · Google Ads agent unavailable"}{existingWeeklyGoogleAdsReview ? " · Weekly review set up" : ""}</span></> : <span>Choose a client to check setup.</span>}</div></div><footer><button type="button" className="primary-button" disabled={!googleAdsSetupReady || googleAdsSetupSaving} onClick={async () => { setGoogleAdsSetupSaving(true); const result = await onSetupGoogleAdsTasks(googleAdsSetupClientId, defaultGoogleAdsTaskSettings()); setGoogleAdsSetupNotice(result.message); setGoogleAdsSetupSaving(false); }}>{googleAdsSetupSaving ? "Setting up…" : existingWeeklyGoogleAdsReview ? "Check weekly setup" : "Set up weekly review"}</button><button type="button" className="secondary-button" disabled={!googleAdsSetupReady || googleAdsSetupSaving} onClick={async () => { setGoogleAdsSetupSaving(true); const result = await onRunGoogleAdsTest(googleAdsSetupClientId); setGoogleAdsSetupNotice(result ? "Test audit started. It is on the Tasks board with AI tasks switched on." : "The test could not start. Check the connection notice and try again."); if (result) { setShowAiTasks(true); setPriorityOnly(false); if (canSeePipeline) { setTaskView("pipeline"); setWorkflowTab("board"); } else { setTaskView("ai"); setAiClientFilter(googleAdsSetupClientId); setAiServiceFilter("all"); setAiStaffFilter("all"); changeAiTaskTab("board"); } setGoogleAdsSetupOpen(false); } setGoogleAdsSetupSaving(false); }}>{googleAdsSetupSaving ? "Starting…" : "▶ Run test audit now"}</button></footer>{googleAdsSetupNotice && <p className="google-ads-task-setup-notice" role="status">{googleAdsSetupNotice}</p>}<small className="google-ads-task-setup-note">The test reads Google Ads data only. The AI will save a full report, up to three quality recommendations, and any exact edits in To approve. Nothing is changed automatically.</small></section>}    {canSeePipeline && <div className="task-view-switch-row"><label className={`task-ai-toggle task-staff-toggle ${showStaffTasks ? "is-on" : ""}`}><input type="checkbox" role="switch" checked={showStaffTasks} onChange={(event) => { setTaskView("pipeline"); setShowStaffTasks(event.target.checked); setPriorityOnly(false); }} /><span className="task-ai-toggle-track" aria-hidden="true"><span className="task-ai-toggle-thumb" /></span><span aria-hidden="true">👥</span> <b>Staff tasks</b> <span className="task-ai-toggle-count" title="Staff tasks in To do">{workspace.tasks.filter((task) => !isAiAssignedTask(task) && task.status === "To do").length}</span><small>{showStaffTasks ? (showAiTasks && canSeeAiTasks ? "Showing with AI tasks" : "Showing") : "Hidden"}</small></label>{canSeeAiTasks && <label className={`task-ai-toggle ${showAiTasks ? "is-on" : ""}`}><input type="checkbox" role="switch" checked={showAiTasks} onChange={(event) => { setTaskView("pipeline"); setShowAiTasks(event.target.checked); setPriorityOnly(false); }} /><span className="task-ai-toggle-track" aria-hidden="true"><span className="task-ai-toggle-thumb" /></span><AiEyesIcon /> <b>AI tasks</b> <span className="task-ai-toggle-count" title="AI tasks in To do">{aiAssignedTasks.filter((task) => task.status === "To do").length}</span><small>{showAiTasks ? (showStaffTasks ? "Showing with staff tasks" : "Showing") : "Hidden"}</small></label>}</div>}
    {(selectedTaskView === "pipeline" || canSeeAiTasks) && <div className="ai-task-tabs workflow-review-tabs" role="tablist" aria-label="Task sections">
      <button type="button" role="tab" aria-selected={selectedTaskView === "pipeline" ? workflowTab === "board" : aiTaskTab === "board"} className={(selectedTaskView === "pipeline" ? workflowTab === "board" : aiTaskTab === "board") ? "selected" : ""} onClick={() => selectedTaskView === "pipeline" ? setWorkflowTab("board") : changeAiTaskTab("board")}>📋 Board <span title="Tasks in To do">{selectedTaskView === "pipeline" ? tasks.filter((task) => task.status === "To do").length : aiBoardTasks.filter((task) => task.status === "To do").length}</span></button>
      <button type="button" role="tab" aria-selected={selectedTaskView === "pipeline" ? workflowTab === "approvals" : aiTaskTab === "approvals"} className={`ai-approval-tab ${(selectedTaskView === "pipeline" ? workflowTab === "approvals" : aiTaskTab === "approvals") ? "selected" : ""} ${(selectedTaskView === "pipeline" ? workflowReviewQueue.length + (showAiTasks ? pendingApprovalItems.length : 0) : pendingAiDecisionCount + aiRecommendationCount) ? "has-pending" : "is-clear"}`} onClick={() => { if (selectedTaskView === "pipeline") setWorkflowTab("approvals"); else { setApprovalSubTab("recommendations"); changeAiTaskTab("approvals"); } }}>{(selectedTaskView === "pipeline" ? workflowReviewQueue.length + (showAiTasks ? pendingApprovalItems.length : 0) : pendingAiDecisionCount + aiRecommendationCount) ? "🟡 Approvals" : "✅ Approvals"} <span>{selectedTaskView === "pipeline" ? workflowReviewQueue.length + (showAiTasks ? pendingApprovalItems.length : 0) : pendingAiDecisionCount + aiRecommendationCount}</span></button>
      <button type="button" role="tab" aria-selected={selectedTaskView === "pipeline" ? workflowTab === "history" : aiTaskTab === "completed"} className={(selectedTaskView === "pipeline" ? workflowTab === "history" : aiTaskTab === "completed") ? "selected" : ""} onClick={() => selectedTaskView === "pipeline" ? setWorkflowTab("history") : changeAiTaskTab("completed")}>🕒 History <span>{selectedTaskView === "pipeline" ? workflowHistoryTasks.length + (showAiTasks ? aiHistoryCount : 0) : aiHistoryCount}</span></button>
      <details className="ai-task-count-note"><summary>ℹ️ How it works</summary><p>Team and AI tasks share one board. Switch Staff tasks or AI tasks off to see only the other. Board, Approvals and History follow the switches.</p></details>
    </div>}
    {selectedTaskView === "ai" && <div className="pipeline-toolbar ai-task-filter-toolbar"><div><b>📋 Agency delivery</b><span>{filteredAiBoardTasks.length} shown · {aiPriorityFilteredBoardTasks.length} matching · {aiBoardCandidates.filter((task) => task.priority === "High" || task.priority === "Urgent").length} high priority</span></div><div className="pipeline-toolbar-filters" role="group" aria-label="AI task filters"><label className="pipeline-select-filter client-filter"><span>👥 Client</span><select id="ai-task-client-filter" aria-label="Filter AI tasks by client" value={aiClientFilter} onChange={(event) => setAiClientFilter(event.target.value)}><option value="all">All clients</option>{clientsWithAiTasks.map((client) => <option value={client.id} key={client.id}>{client.name}</option>)}{hasInternalAiTasks && <option value="internal">Internal · no client</option>}</select></label><label className="pipeline-select-filter"><span>🧰 Service</span><select id="ai-task-service-filter" aria-label="Filter AI tasks by service type" value={aiServiceFilter} onChange={(event) => setAiServiceFilter(event.target.value)}><option value="all">All services</option>{aiServices.map((service) => <option key={service} value={service}>{service}</option>)}{allAiAssignedTasks.some((task) => !(task.aiMode || task.service)?.trim()) && <option value="none">No service</option>}</select></label><label className="pipeline-select-filter"><span>👤 Staff</span><select id="ai-task-staff-filter" aria-label="Filter AI tasks by staff member" value={aiStaffFilter} onChange={(event) => setAiStaffFilter(event.target.value)}><option value="all">All staff</option>{staffWithAiTasks.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}{hasUnassignedAiTasks && <option value="unassigned">Unassigned</option>}</select></label><button type="button" className={`priority-filter ${priorityOnly ? "selected" : ""}`} onClick={() => setPriorityOnly(!priorityOnly)} aria-pressed={priorityOnly}>🔥 {priorityOnly ? "Showing priority" : "Show priority only"}</button>{hasAnyAiFilters && <button type="button" className="clear-task-filters" onClick={() => { setAiServiceFilter("all"); setAiClientFilter("all"); setAiStaffFilter("all"); setPriorityOnly(false); }}>✕ Clear filters</button>}</div></div>}
    {selectedTaskView === "ai" && <section className={`ai-review-queue ai-tab-${aiTaskTab} ${aiTaskTab === "approvals" && pendingAiDecisionCount + aiRecommendationCount === 0 ? "is-clear" : ""}`} aria-labelledby="ai-review-heading">
      {aiTaskTab !== "approvals" && aiTaskTab !== "completed" && <div className="ai-review-queue-heading"><div><p className="eyebrow"><AiEyesIcon /> AI · {aiQueueEyebrow}</p><h2 id="ai-review-heading">{aiQueueTitle}</h2><p>{aiQueueDescription}</p></div><span className="ai-review-count" aria-live="polite">{aiQueueCount}</span></div>}
      {aiTaskTab === "board" && (aiBoardTasks.length ? <div className="pipeline-board ai-task-board" aria-label="AI tasks by workflow stage">{statuses.map(({ label, value }) => { const columnTasks = byBoardOrder(aiBoardTasks.filter((task) => task.status === value)); return <section className={`pipeline-column stage-${label.toLowerCase().replaceAll(" ", "-")}`} key={value} data-task-drop-stage={value} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }} onDrop={(event) => { event.preventDefault(); const id = event.dataTransfer.getData("text/plain") || draggingId; if (id) { setDroppedId(id); window.setTimeout(() => setDroppedId((current) => current === id ? "" : current), 650); moveTask(id, value, "drop"); } setDraggingId(""); }}><div className="pipeline-column-head"><span className="stage-dot"/><h2>{label}</h2><span className="column-count">{columnTasks.length}</span></div><div className="pipeline-cards">{columnTasks.length ? columnTasks.map(renderCard) : <div className="column-empty">{hasAiFilters ? "No matching tasks here" : priorityOnly ? "No priority tasks here" : "Drop tasks here"}</div>}</div></section>; })}</div> : hasAnyAiFilters ? <div className="empty-state"><div className="empty-icon">⌕</div><h2>No AI tasks match these filters.</h2><p>Clear one or more filters to see the rest of your AI work.</p><button className="primary-button" onClick={() => { setAiServiceFilter("all"); setAiClientFilter("all"); setAiStaffFilter("all"); setPriorityOnly(false); }}>Clear filters</button></div> : <div className="empty-state"><div className="empty-icon"><AiEyesIcon /></div><h2>No active AI tasks.</h2><p>Assign the AI to a task to see it here. Open a card to check its work, evidence and next step.</p><button className="primary-button" onClick={onAdd}>＋ New AI task</button></div>)}      {aiTaskTab === "approvals" && approvalInbox}
      {showAiReviewCards ? (aiReviewTasks.length || visibleApprovalItems.length) ? <div className={`ai-review-grid ${aiTaskTab === "scheduled" ? "is-scheduled" : ""} ${aiTaskTab === "pending" ? "is-pending" : ""} ${aiTaskTab === "completed" ? "is-history" : ""}`}>
      {aiTaskTab === "completed" && aiReviewTasks.length > 0 && <div className="ai-history-section-title"><span>✅ Completed task runs</span><small>{aiReviewTasks.length}</small></div>}
      {aiReviewTasks.map((task) => {
        const pendingApprovals = (task.aiApprovals || []).filter((item) => item.status === "pending");
        const verifiedCount = (task.aiApprovals || []).filter((item) => item.status === "applied" && approvalVerificationState(item) === "verified").length;
        const unverifiedCount = (task.aiApprovals || []).filter((item) => item.status === "applied" && approvalVerificationState(item) === "unverified").length;
        const conflictCount = (task.aiApprovals || []).filter((item) => item.status === "applied" && approvalVerificationState(item) === "conflict").length;
        const rejectedCount = (task.aiApprovals || []).filter((item) => item.status === "rejected").length;
        const checklistDone = (task.checklist || []).filter((item) => item.done && Boolean(item.evidence?.trim())).length;
        const checklistTotal = task.checklist?.length || 0;
        const legacyProposal = legacyAiProposal(task);
        const client = workspace.clients.find((item) => item.id === task.clientId);
        const clientName = client?.name || "Client";
        const incompleteChecklistSteps = (task.checklist || []).filter((item) => !item.done || !item.evidence?.trim());
        const visibleIncompleteChecklistSteps = incompleteChecklistSteps.slice(0, 2);
        const checklistReady = canCloseAiTask(task.checklist || [], []);
        const decisionsVerified = (task.aiApprovals || []).every((item) => item.status === "rejected" || (item.status === "applied" && approvalIsLiveVerified(item)));
        const pendingEvidenceBlocked = pendingApprovals.length > 0 && pendingApprovals.every((approval) => Boolean(approvalEvidenceBlockReason(approval, task.checklist || [])));
        const linkedEvidenceApproval = pendingApprovals.find((approval) => !isApprovalReady(approval, task.checklist || []));
        const linkedEvidenceStep = linkedEvidenceApproval && Number.isInteger(linkedEvidenceApproval.checklistIndex) ? task.checklist?.[Number(linkedEvidenceApproval.checklistIndex)] : undefined;
        const canContinueAiTask = canResumeAiTaskRun(task.aiRunState, task.aiApprovals || [], task.checklist || []);
        const canCloseReview = task.aiRunState === "needs_review" && checklistReady && decisionsVerified;
        const resultNeedsVerification = (task.aiApprovals || []).some((item) => item.status === "applied" && !approvalIsLiveVerified(item));
        const applyingCount = (task.aiApprovals || []).filter((item) => item.status === "applying").length;
        const retryQueued = Boolean(task.aiStartNowRequestedAt);
        const taskStage = getAiTaskStage(task);
        const isDismissed = taskStage === "dismissed";
        const isCancelled = taskStage === "cancelled";
        const campaignNotes = (task.aiMode === "Google Ads" || task.aiMode === "Audit" || task.service === "Google Ads" || task.service === "Audit") ? auditCampaignNotes(task) : [];
        const selectedCampaignId = campaignNotes.some((item) => item.campaignId === selectedAuditCampaignByTask[task.id]) ? selectedAuditCampaignByTask[task.id] : campaignNotes.find((item) => item.campaignId === task.campaignId)?.campaignId || campaignNotes[0]?.campaignId || "";
        const selectedCampaignNote = campaignNotes.find((item) => item.campaignId === selectedCampaignId);
        const stateLabel = task.aiRunState === "running" ? <><span className="ai-moving-cog" aria-hidden="true">⚙</span> Doing · AI timer running</> : applyingCount ? <><span className="ai-moving-cog" aria-hidden="true">⚙</span> Doing · applying {applyingCount} change{applyingCount === 1 ? "" : "s"}</> : task.aiRunState === "cancelled" ? "⏹ Cancelled · saved to retry" : retryQueued ? "▶ Retry queued · waiting for the AI to start" : task.aiRunState === "scheduled" ? "🕒 Scheduled · waiting to start" : task.aiRunState === "failed" ? "⚠ Blocked · run failed" : task.aiRunState === "needs_connection" ? "🔌 Blocked · connection needed" : pendingEvidenceBlocked ? `🧭 Needs evidence · ${pendingApprovals.length} change${pendingApprovals.length === 1 ? "" : "s"} locked` : pendingApprovals.length ? `🟡 Needs your approval · ${pendingApprovals.length}` : resultNeedsVerification ? "🟡 Needs Ads verification" : checklistReady ? "🟡 Ready to close after review" : `🧭 Needs evidence · ${checklistTotal - checklistDone} checklist step${checklistTotal - checklistDone === 1 ? "" : "s"}`;
        const outcome = task.aiRunState === "running" ? "The AI is working" : task.aiRunState === "cancelled" ? "Run cancelled · saved work kept" : applyingCount ? `Applying ${applyingCount} approved change${applyingCount === 1 ? "" : "s"} in ${task.aiMode === "Meta Ads" ? "Meta Ads" : "Google Ads"}` : task.aiRunState === "scheduled" ? "Waiting for scheduled start" : [verifiedCount ? `${verifiedCount} verified in Ads` : "", unverifiedCount ? `${unverifiedCount} sent · not verified` : "", conflictCount ? `${conflictCount} record conflict` : "", pendingApprovals.length ? `${pendingApprovals.length} need approval` : "", rejectedCount ? `${rejectedCount} rejected` : ""].filter(Boolean).join(" · ") || (task.aiApprovals?.length ? "Decisions complete" : "No changes suggested");
        return <article className={`ai-review-card ${isDismissed ? "is-dismissed" : ""}`} key={task.id}>
          <header className="ai-review-card-head"><div className="ai-review-report-name">{!hideCardClientLogo && <span className={`task-client-mark ${client?.logo ? "has-logo" : ""}`} title={`${clientName} logo`} style={{ background: client?.color || "#3a393d" }}>{client?.logo ? <img src={client.logo} alt={`${clientName} logo`} /> : initials(clientName)}</span>}<div><span><AiIcon v={serviceIcons[task.aiMode || task.service] || "🤖"} /> {hideCardClientLogo ? "" : `${clientName} · `}{task.aiMode || task.service}</span><h3>{task.title}</h3>{task.campaignName && <p className="ai-review-campaign">📣 Campaign · {task.campaignName}</p>}</div></div><div className="ai-review-report-meta"><span className={retryQueued ? "ai-review-status is-queued" : applyingCount ? "ai-review-status is-doing" : task.aiRunState === "running" ? "ai-review-status is-doing" : "ai-review-status needs-decision"}>{taskStage === "completed" ? "✅ Completed" : isDismissed ? "🗃 Dismissed · history saved" : isCancelled ? "⏹ Cancelled · saved work kept" : applyingCount ? <><span className="ai-moving-cog" aria-hidden="true">⚙</span> Doing · applying changes</> : task.aiStartNowRequestedAt && task.aiRunState === "scheduled" ? "▶️ Queued · starting soon" : stateLabel}</span>{task.aiRunState === "running" && task.aiRunStartedAt ? <time className="ai-task-live-timer">⏱ {timerClock(Math.max(0, Math.floor((timerNow - new Date(task.aiRunStartedAt).getTime()) / 1000)))}</time> : applyingCount && task.aiApprovals?.find((item) => item.status === "applying")?.startedAt ? <time className="ai-task-live-timer">⏱ {timerClock(Math.max(0, Math.floor((timerNow - new Date(task.aiApprovals.find((item) => item.status === "applying")!.startedAt!).getTime()) / 1000)))}</time> : <time>{task.aiRunAt ? new Date(task.aiRunAt).toLocaleString("en-IE", { dateStyle: "medium", timeStyle: "short" }) : task.dueAt ? `Due ${new Date(task.dueAt).toLocaleString("en-IE", { dateStyle: "medium", timeStyle: "short" })}` : "Waiting to start"}</time>}{aiTaskTab === "scheduled" && canApproveAiChanges && <button type="button" className="ai-start-now-button" disabled={Boolean(startingAiTaskId) || Boolean(task.aiStartNowRequestedAt) || (task.aiApprovals || []).some((item) => item.status === "pending" || item.status === "applying")} title="Queue this task for the next AI run check, which happens within five minutes." onClick={(event) => { event.stopPropagation(); void startScheduledAiTaskNow(task.id); }}>{startingAiTaskId === task.id ? "Queuing…" : task.aiStartNowRequestedAt ? "Queued to start" : "▶ Start now"}</button>}</div></header>
          {aiTaskTab === "completed" && taskStage === "completed" && (() => {
            const screenshots = (task.attachments || []).filter((attachment) => attachment.type.startsWith("image/"));
            return <section className="ai-completed-screenshots" aria-label={`Screenshots for ${task.title}`}>
              <header><b>📸 Work screenshots</b><span>{screenshots.length ? `${screenshots.length} saved` : "None saved"}</span></header>
              {screenshots.length ? <div className="ai-completed-screenshot-grid">{screenshots.map((attachment) => {
                const fileUrl = `/api/tasks/files?taskId=${encodeURIComponent(task.id)}&id=${encodeURIComponent(attachment.id)}`;
                return <button type="button" className="ai-completed-screenshot" key={attachment.id} onClick={() => setTaskFilePreview({ name: attachment.name, type: attachment.type, taskId: task.id, url: `${fileUrl}&preview=1` })} aria-label={`View screenshot ${attachment.name}`}><img src={`${fileUrl}&preview=1`} alt="" loading="lazy" onError={(event) => { event.currentTarget.closest(".ai-completed-screenshot")?.classList.add("is-broken"); }} /><span>{attachment.name}</span></button>;
              })}</div> : <div className="ai-completed-screenshot-empty"><span aria-hidden="true">🖼️</span><small>No screenshot saved</small></div>}
              {canManageStaffReviews && <label className="secondary-button ai-add-screenshot">{taskFileUploads[task.id] ? "Uploading…" : "＋ Add screenshot"}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden disabled={Boolean(taskFileUploads[task.id])} onChange={(event) => { const files = Array.from(event.currentTarget.files || []); event.currentTarget.value = ""; if (files.length) void attachTaskFiles(task.id, files); }} /></label>}
              {taskFileErrors[task.id] && <small className="form-error" role="alert">{taskFileErrors[task.id]}</small>}
            </section>;
          })()}
          {aiTaskTab === "pending" && <div className="ai-review-quick-actions"><span>🧭 {task.aiRunState === "needs_connection" ? "Connection needed" : task.aiRunState === "failed" ? "Last run failed" : `${checklistTotal - checklistDone} evidence item${checklistTotal - checklistDone === 1 ? "" : "s"} remaining`}</span>{canContinueAiTask && !["running", "scheduled"].includes(task.aiRunState || "") && <button type="button" className="primary-button" disabled={retryQueued || Boolean(startingAiTaskId)} onClick={() => { void startScheduledAiTaskNow(task.id); }}>{retryQueued ? "↻ Retry queued" : startingAiTaskId === task.id ? "Queuing retry…" : "↻ Retry with AI"}</button>}{canApproveAiChanges && <button type="button" className="secondary-button ai-dismiss-task-button" disabled={Boolean(startingAiTaskId)} onClick={() => onDismissAiTask(task.id)} title="Remove from active work without marking complete; restore later from Dismissed">🗃 Dismiss task</button>}</div>}
          {aiTaskTab === "doing" && task.aiRunState === "running" && canApproveAiChanges && <div className="ai-review-quick-actions ai-doing-controls"><span>The AI will stop at the next safe checkpoint. A request already sent to an external account cannot be recalled.</span><button type="button" className="ai-cancel-run-button" disabled={Boolean(task.aiCancelRequestedAt) || cancellingAiTaskId === task.id} onClick={() => { setCancellingAiTaskId(task.id); void onCancelAiTask(task.id).finally(() => setCancellingAiTaskId((current) => current === task.id ? "" : current)); }}>{task.aiCancelRequestedAt || cancellingAiTaskId === task.id ? "⏳ Stopping safely…" : "⏹ Cancel run"}</button></div>}
          {isCancelled && <div className="ai-review-quick-actions ai-cancelled-controls"><span>⏹ Stopped by {task.aiCancelledBy || "a workspace admin"}{task.aiCancelledAt ? ` · ${new Date(task.aiCancelledAt).toLocaleString("en-IE", { dateStyle: "medium", timeStyle: "short" })}` : ""}. The task and saved work are still here.</span>{canApproveAiChanges && canContinueAiTask && <button type="button" className="primary-button" disabled={Boolean(startingAiTaskId)} onClick={() => { void startScheduledAiTaskNow(task.id); }}>{startingAiTaskId === task.id ? "Queuing retry…" : "↻ Retry with AI"}</button>}</div>}
          {isDismissed && canApproveAiChanges && <div className="ai-review-quick-actions"><span>🗃 Saved from active tasks · {task.aiDismissedBy || "Workspace owner"}</span><button type="button" className="secondary-button" onClick={() => onRestoreAiTask(task.id)}>↩ Restore to active tasks</button></div>}
          <details className={`ai-review-card-details ${aiTaskTab === "pending" ? "is-pending" : ""}`} onToggle={(event) => { const current = event.currentTarget; if (current.open) { if (taskSoundsEnabled) playTaskUiSound("open"); current.closest(".ai-review-grid")?.querySelectorAll<HTMLDetailsElement>(".ai-review-card-details[open]").forEach((other) => { if (other !== current) other.open = false; }); } }}>
          <summary><span>📋 {checklistTotal ? `${checklistDone}/${checklistTotal} checklist steps verified` : "Task details"}</span><span>{aiTaskTab === "doing" && task.aiRunState === "running" ? <>The AI is working<small className="ai-live-stage" key={task.aiProgressAt || task.aiProgressText}>{task.aiProgressText || "Starting the task"}</small></> : isDismissed ? "🗃 Saved for later" : isCancelled ? "⏹ Run stopped · saved work kept" : aiTaskTab === "pending" ? `🧭 ${checklistTotal - checklistDone} need evidence` : pendingApprovals.length ? `🟡 ${pendingApprovals.length} awaiting approval` : outcome}</span><span className="ai-review-expand-label">View details ⌄</span></summary>

          <div className="ai-review-result-strip" aria-label="Task outcome">
            <span><b>{task.aiRunState === "running" ? "Live progress" : "Checklist"}</b> {task.aiRunState === "scheduled" ? checklistTotal ? `${checklistTotal} steps queued` : "Waiting to start" : task.aiRunState === "running" ? checklistTotal ? `${checklistDone} / ${checklistTotal} steps verified` : "Run timer is active" : checklistTotal ? checklistDone + " verified · " + (checklistTotal - checklistDone) + " need data" : "AI task report"}</span>
            <span><b>Outcome</b> {outcome}</span>
          </div>
          {selectedCampaignNote && <section className="ai-campaign-note" aria-label="Campaign audit note"><label><span aria-hidden="true">📣</span> Campaign<select aria-label={`Choose campaign note for ${clientName}`} value={selectedCampaignId} onChange={(event) => setSelectedAuditCampaignByTask((current) => ({ ...current, [task.id]: event.target.value }))}>{campaignNotes.map((item) => <option key={item.campaignId} value={item.campaignId}>{item.campaignName}</option>)}</select></label><p>{selectedCampaignNote.note}</p></section>}
          {aiTaskTab === "scheduled" ? <details className="ai-scheduled-details"><summary>▸ Checklist & schedule · {checklistTotal} steps</summary><TaskChecklistEditor task={task} onSave={(checklist) => onUpdateChecklist(task.id, checklist)} disabled={task.aiRunState === "running" || applyingCount > 0} allowRemove={!task.aiApprovals?.length} allowManualComplete={false} /><AiTaskScheduleControls task={task} onSchedule={onScheduleAiTask} /></details> : aiTaskTab === "pending" ? <details className="ai-pending-details"><summary>☷ Checklist & task controls · {checklistDone}/{checklistTotal} verified · {checklistTotal - checklistDone} need evidence</summary><TaskChecklistEditor task={task} onSave={(checklist) => onUpdateChecklist(task.id, checklist)} disabled={task.aiRunState === "running" || applyingCount > 0} allowRemove={!task.aiApprovals?.length} allowManualComplete={false} /><AiTaskScheduleControls task={task} onSchedule={onScheduleAiTask} /></details> : <><TaskChecklistEditor task={task} onSave={(checklist) => onUpdateChecklist(task.id, checklist)} disabled={task.aiRunState === "running" || applyingCount > 0} allowRemove={!task.aiApprovals?.length} allowManualComplete={false} />{taskStage !== "completed" && <AiTaskScheduleControls task={task} onSchedule={onScheduleAiTask} />}</>}
          {aiTaskTab === "pending" && <div className="ai-review-next-step ai-pending-explainer" role="status"><span aria-hidden="true">{retryQueued ? "▶️" : task.aiRunState === "needs_connection" ? "🔌" : task.aiRunState === "failed" ? "⚠️" : "🧭"}</span><div className="ai-pending-explainer-copy"><b>{retryQueued ? "Retry queued · waiting for the AI to start" : pendingEvidenceBlocked ? "Waiting for the AI to verify evidence for a proposed change" : pendingApprovals.length ? `${pendingApprovals.length} account change${pendingApprovals.length === 1 ? "" : "s"} ready for your decision` : task.aiRunState === "needs_connection" ? "Blocked · an account connection or setup is missing" : task.aiRunState === "failed" ? "Blocked · the AI’s last run failed" : checklistTotal > checklistDone ? `${checklistTotal - checklistDone} checklist step${checklistTotal - checklistDone === 1 ? "" : "s"} still need evidence` : resultNeedsVerification ? "An Ads change still needs live verification" : "Review is not complete"}</b><small>{retryQueued ? "You asked the AI to retry. The task stays here until the next check starts the run, then moves to Doing. This usually takes up to five minutes." : pendingEvidenceBlocked ? linkedEvidenceStep ? `The AI could not verify “${cleanChecklistStep(linkedEvidenceStep.text)}”. This proposed change is locked until that evidence is saved.` : "The AI could not verify the checklist evidence linked to this proposed change, so it is locked." : pendingApprovals.length ? "These changes are ready in Approvals. Decide them there; the task stays open until the checklist and changes are resolved." : task.aiRunState === "needs_connection" ? quickAiSummary(task) : task.aiRunState === "failed" ? quickAiSummary(task) : checklistTotal > checklistDone ? `${checklistDone} of ${checklistTotal} steps are verified. The AI could not confirm ${incompleteChecklistSteps.length} remaining checks from the available information.` : resultNeedsVerification ? "The saved change result has not been confirmed against the live Google Ads account yet." : quickAiSummary(task)}</small>{!retryQueued && !pendingEvidenceBlocked && !pendingApprovals.length && task.aiRunState !== "needs_connection" && task.aiRunState !== "failed" && checklistTotal > checklistDone && <div className="ai-pending-blockers" aria-label="Checklist steps still needing evidence">{visibleIncompleteChecklistSteps.map((step) => <p key={step.id}><b>{cleanChecklistStep(step.text)}</b><small>{step.evidence?.trim() || "The AI did not find enough evidence to verify this step."}</small></p>)}{incompleteChecklistSteps.length > visibleIncompleteChecklistSteps.length && <small>And {incompleteChecklistSteps.length - visibleIncompleteChecklistSteps.length} more step{incompleteChecklistSteps.length - visibleIncompleteChecklistSteps.length === 1 ? "" : "s"} in the checklist below.</small>}</div>}<b className="ai-pending-next-label">Next step</b><small>{retryQueued ? "No action needed. The AI will update this card to Doing when the retry starts." : pendingEvidenceBlocked ? "Select Retry with AI to recheck the missing evidence. Once verified, the change becomes available in Approvals." : pendingApprovals.length ? "Open Approvals to review the changes, then return here for any remaining checklist work." : task.aiRunState === "needs_connection" ? "Reconnect the client’s account or data source, then select Retry with AI." : task.aiRunState === "failed" ? "Open the task report, resolve the reported error, then select Retry with AI." : checklistTotal > checklistDone ? "Open the checklist to see the missing evidence above. Add or connect it, then select Retry with AI." : "Open the task report and resolve the remaining review or verification item."}</small>{task.aiNotificationStatus && <small className="ai-pending-email-note">📧 Email notice: {task.aiNotificationDismissedAt ? "cleared · only the email notice was dismissed" : task.aiNotificationStatus === "sent" ? "email sent · the task remains open" : task.aiNotificationStatus === "failed" ? "failed to send" : task.aiNotificationStatus === "blocked" ? "blocked by sender setup" : task.aiNotificationStatus === "sending" ? "sending the grouped approval email" : "waiting for grouped client approval email"}</small>}</div><div className="ai-pending-actions">{canContinueAiTask && !["running", "scheduled"].includes(task.aiRunState || "") && <button type="button" className="primary-button" disabled={retryQueued || Boolean(startingAiTaskId)} onClick={() => { void startScheduledAiTaskNow(task.id); }}>{retryQueued ? "↻ Retry queued" : startingAiTaskId === task.id ? "Queuing retry…" : "↻ Retry with AI"}</button>}{task.aiNotificationStatus && !task.aiNotificationDismissedAt && ["sent", "failed", "blocked"].includes(task.aiNotificationStatus) && canApproveAiChanges && <button type="button" className="secondary-button ai-clear-email-notice" onClick={() => onDismissAiTaskEmailNotice(task.id)} title="Clear only this email notice. The pending task will remain open.">✕ Clear email notice</button>}</div></div>}
          {!checklistReady && aiTaskTab !== "completed" && aiTaskTab !== "scheduled" && aiTaskTab !== "pending" && aiTaskTab !== "history" && <div className="ai-review-next-step" role="status"><span aria-hidden="true">{task.aiRunState === "running" ? <span className="ai-moving-cog" aria-hidden="true">⚙</span> : "🧭"}</span><div><b>{task.aiRunState === "running" ? "The AI is working on the remaining steps" : pendingApprovals.length ? `${pendingApprovals.length} change${pendingApprovals.length === 1 ? "" : "s"} need your decision` : "Next: continue the checklist with the AI"}</b><small>{checklistDone} of {checklistTotal} steps verified · {checklistTotal - checklistDone} still need evidence. This task stays pending until the whole checklist is complete.</small></div>{canContinueAiTask && !["running", "scheduled"].includes(task.aiRunState || "") && <button type="button" className="primary-button" onClick={() => { void startScheduledAiTaskNow(task.id); }}>↻ Retry with AI</button>}</div>}
         {task.aiApprovals?.length ? <section className="ai-approval-list" aria-label="Account changes"><h4>Account changes</h4>{Array.from(new Set(task.aiApprovals.filter((approval) => !(approval.status === "applied" && approvalIsLiveVerified(approval))).map((approval) => approvalGroupLabel(approval.actionType)))).map((groupLabel) => <section className="ai-approval-group" key={groupLabel}><h5>{groupLabel}</h5><ApprovalCategoryControls taskId={task.id} groupLabel={groupLabel} approvals={task.aiApprovals!.filter((approval) => approval.status === "pending" && approvalGroupLabel(approval.actionType) === groupLabel)} selectedIds={selectedApprovalIds} onSelectGroup={selectApprovalGroup} onDecide={runBulkApproval} disabled={Boolean(bulkApprovalGroup) || Boolean(resolvingApprovalId)} canManage={canApproveAiChanges} notice={bulkApprovalNotice?.key === task.id + ":" + groupLabel ? bulkApprovalNotice.message : undefined} />{task.aiApprovals!.filter((approval) => approvalGroupLabel(approval.actionType) === groupLabel && !(approval.status === "applied" && approvalIsLiveVerified(approval))).map((approval) => {
             const isMetaApproval = approval.actionType.startsWith("META_");
             const approvalClient = workspace.clients.find((client) => client.id === task.clientId);
             const accountId = (isMetaApproval ? approvalClient?.metaAdsAccountId : approvalClient?.googleAdsAccountId) || "Not linked";
            return <article className={`ai-approval-item ${approval.status} ${approval.verification || ""} ${approval.status === "applying" || resolvingApprovalId === approval.id ? "is-applying" : ""} ${recentApprovalId === approval.id ? "is-just-resolved" : ""}`} key={approval.id}>
              <div className="ai-approval-copy">{approval.status === "pending" && canApproveAiChanges && <label className="ai-approval-select"><input type="checkbox" aria-label={`Select ${approvalActionText(approval)} for batch review`} checked={selectedApprovalIds.includes(approval.id)} disabled={Boolean(bulkApprovalGroup) || Boolean(resolvingApprovalId)} onChange={(event) => toggleApprovalSelection(approval.id, event.target.checked)} />Select for batch decision</label>}<span className={"ai-approval-label " + approval.status}>{approval.status === "applying" || resolvingApprovalId === approval.id ? <><span className="ai-moving-cog" aria-hidden="true">⚙</span> Doing · applying and verifying</> : approval.status === "pending" ? "⏳ WAITING FOR YOU" : approval.status === "rejected" ? "✕ REJECTED · NO CHANGE" : approvalVerificationState(approval) === "verified" ? "✓ APPLIED · VERIFIED IN ADS" : approvalVerificationState(approval) === "conflict" ? "⚠ RESULT CONFLICT · CHECK ADS" : "↗ SENT · NOT VERIFIED"}</span><h5>{approvalActionText(approval)}</h5><p className="ai-approval-meta"><span>📍 {isMetaApproval ? "Meta Ads" : "Google Ads"} account <b>{accountId}</b></span></p>
                 <details className="ai-approval-evidence"><summary>Why this is suggested · see evidence</summary><p><b>Why:</b> {approval.rationale}</p><p><b>Evidence:</b> {approval.evidence}</p></details>{approval.resultDetail && <div className={`ai-approval-result ${approval.status === "rejected" ? "rejected" : approvalVerificationState(approval)}`} role="status"><b>{approval.status === "rejected" ? "✕ No account change" : approvalVerificationState(approval) === "verified" ? "✓ Confirmed live" : approvalVerificationState(approval) === "conflict" ? "⚠ Saved result conflicts with verification status" : "! Sent, not verified"}</b><p>{approval.resultDetail}</p></div>}
                 {canApproveAiChanges && <label className="ai-approval-feedback"><span>💬 Feedback note <small>{approval.feedbackUpdatedAt ? "Saved for this client & campaign" : "Auto-saves for future work"}</small></span><textarea value={approval.feedback || ""} maxLength={1200} placeholder="What should the AI remember for future work on this client and campaign?" onChange={(event) => onApprovalFeedback(task.id, approval.id, event.target.value)} /></label>}
              </div>
                  {approval.status === "pending" && <div className="ai-approval-buttons">{canApproveAiChanges ? <><button type="button" className="primary-button" aria-label={"Approve change: " + approvalActionText(approval)} disabled={Boolean(bulkApprovalGroup) || resolvingApprovalId === approval.id || Boolean(approvalEvidenceBlockReason(approval, task.checklist || []))} title={approvalEvidenceBlockReason(approval, task.checklist || []) || `Apply and verify only this ${approval.actionType.startsWith("META_") ? "Meta Ads" : "Google Ads"} change. The task stays open until every checklist step is complete.`} onClick={() => { void resolveApproval(task.id, approval.id, "apply"); }}>{resolvingApprovalId === approval.id ? <><span className="approval-spinner" aria-hidden="true">◌</span> Applying…</> : approvalEvidenceBlockReason(approval, task.checklist || []) ? "🔒 Evidence needed" : approval.actionType.toUpperCase().includes("RESPONSIVE_SEARCH_AD") ? <><span aria-hidden="true">✓</span> Approve all headlines & descriptions</> : <><span aria-hidden="true">✓</span> Approve this change</>}</button><button type="button" className="secondary-button" aria-label={"Reject change: " + approvalActionText(approval)} disabled={Boolean(bulkApprovalGroup) || resolvingApprovalId === approval.id} onClick={() => { void resolveApproval(task.id, approval.id, "reject"); }}><span aria-hidden="true">✕</span> Reject</button></> : <small>An owner or admin must decide this Ads change.</small>}</div>}{approval.status === "applying" && canApproveAiChanges && approval.startedAt && timerNow - Date.parse(approval.startedAt) > 120000 && <div className="ai-approval-buttons"><button type="button" className="secondary-button" title="Check the current live Ads value and clear this interrupted approval without sending the change again." disabled={resolvingApprovalId === approval.id} onClick={() => { void resolveApproval(task.id, approval.id, "reconcile"); }}>↻ Check live status</button></div>}
            </article>;
          })}</section>)}</section> : <p className="ai-approval-none">{legacyProposal ? <>Old report contains a text-only suggestion (<b>{legacyProposal}</b>); no separate approval was saved.</> : "No account changes were suggested in this report."}</p>}
          {task.checklist?.length ? <details className="ai-review-checklist"><summary>☷ See all {checklistTotal} checklist steps</summary><div>{task.checklist.map((item, index) => <article className={item.done ? "verified" : "unverified"} key={item.id}><b>{index + 1}. {cleanChecklistStep(item.text)}</b><small>{item.done ? "Verified" : "Needs more data"}</small><p>{item.evidence || (item.done ? "Evidence recorded by the AI." : "No supporting evidence was returned.")}</p></article>)}</div></details> : null}
          <details className="ai-review-details"><summary>📄 Full {task.aiMode === "Google Ads" || task.aiMode === "Audit" ? "audit" : "task"} report</summary><pre>{formatAiRunForDisplay(task.aiFeedback || "No detailed result was saved.")}</pre>{task.aiFeedback && <button type="button" className="secondary-button" onClick={() => downloadAiTaskReport(task)}>⬇ Download full report</button>}</details>
          {aiTaskTab === "scheduled" ? <div className="ai-review-actions scheduled"><button type="button" className="secondary-button" onClick={() => onDuplicate(task)}>⧉ Duplicate task</button><button type="button" className="secondary-button" onClick={() => onEdit(task)}>✎ Edit task</button>{canApproveAiChanges && <button type="button" className="task-delete ai-scheduled-delete" onClick={() => onDelete(task.id)} aria-label={`Delete scheduled AI task ${task.title}`} title="Delete this scheduled task and stop future repeats">🗑 Delete task</button>}</div> : aiTaskTab === "pending" ? <div className="ai-review-actions pending"><small>This task stays open until the reason above is resolved.</small><div><button type="button" className="secondary-button" onClick={() => onEdit(task)}>✎ Edit task</button></div></div> : isCancelled ? <div className="ai-review-actions pending"><small>This run was stopped before it could finish. The checklist and task are still saved; retry it whenever you’re ready.</small></div> : isDismissed ? <div className="ai-review-actions pending"><small>Dismissed by {task.aiDismissedBy || "workspace owner"} · {task.aiDismissedAt ? new Date(task.aiDismissedAt).toLocaleString("en-IE", { dateStyle: "medium", timeStyle: "short" }) : "Saved"}. Work history and account changes are preserved.</small><div><button type="button" className="secondary-button" onClick={() => onRestoreAiTask(task.id)}>↩ Restore to active tasks</button></div></div> : aiTaskTab !== "completed" && aiTaskTab !== "history" && <div className="ai-review-actions"><small>{task.aiRunState === "running" ? "The AI is working. This card updates every few seconds." : "Each approval applies only that change. The task stays open until all steps and changes are complete."}</small><div><button type="button" className="secondary-button" onClick={() => onEdit(task)}>✎ Edit task</button><button type="button" className="primary-button" disabled={!canCloseReview} title={!canCloseReview ? "Finish every checklist step, resolve each decision, and verify Ads changes first." : "Close this review without changing the account."} onClick={() => onReviewAiTask(task.id)}>{!checklistReady ? `🔒 ${checklistTotal - checklistDone} steps still need evidence` : pendingApprovals.length > 0 ? `🔒 ${pendingApprovals.length} decisions left` : conflictCount + unverifiedCount > 0 ? "⚠ Verify Ads result first" : "✓ Approve & move to Done"}</button></div></div>}
          </details>
        </article>;
      })}{visibleApprovalItems.length > 0 && <div className="ai-history-section-title ai-history-changes-title"><span>📣 Confirmed advertising changes</span><small>{visibleApprovalItems.length}</small></div>}{visibleApprovalItems.map(({ task, approval }) => {
        const client = workspace.clients.find((item) => item.id === task.clientId);
        const clientName = client?.name || "Client";
        const isMetaApproval = approval.actionType.startsWith("META_"); const accountId = isMetaApproval ? client?.metaAdsAccountId || "Meta Ads account not linked" : client?.googleAdsAccountId || "Google Ads account not linked";
        const adsUrl = approval.actionType.startsWith("META_") ? "" : googleAdsUrlForApproval(task, approval);
        const activity = activityForCompletedApproval(task, approval);
        const reversing = activity?.id === revertingActivityId;
        return <article className="ai-history-change-card" key={`approval-${approval.id}`}>
          <header className="ai-history-change-head">{!hideCardClientLogo && <span className={`task-client-mark ${client?.logo ? "has-logo" : ""}`} title={`${clientName} logo`} style={{ background: client?.color || "#3a393d" }}>{client?.logo ? <img src={client.logo} alt={`${clientName} logo`} /> : initials(clientName)}</span>}<div className="ai-history-change-copy"><span className="ai-history-client">{hideCardClientLogo ? "" : `${clientName} · `}{approval.actionType.startsWith("META_") ? "Meta Ads" : "Google Ads"}</span><h3 title={approvalActionText(approval)}>{approvalActionText(approval)}</h3><p>{task.title} · {approval.campaignName || task.campaignName || "Campaign not recorded"}</p></div><div className="ai-history-change-status"><b>✓ Verified</b><time dateTime={approval.decidedAt || task.aiRunAt || undefined}>{approval.decidedAt ? new Date(approval.decidedAt).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric" }) : "Date not recorded"}</time></div></header>
          <details className="ai-history-change-details"><summary>Change details</summary><div><span><b>Account</b>{accountId}</span><p>{approval.resultDetail || "Google Ads confirmed this change."}</p>{adsUrl && <a className="ai-approval-account-link" href={adsUrl} target="_blank" rel="noopener noreferrer">↗ Open in Google Ads</a>}{activity?.reverted ? <p className="ai-change-revert-status is-done" role="status">↩ Reverted · previous value verified in Google Ads.</p> : activity?.reversible && canReverseAdsChanges ? <button type="button" className="ai-change-revert-button" disabled={Boolean(revertingActivityId)} onClick={() => void revertCompletedApproval(task, approval, activity)}>{reversing ? "Reverting and verifying…" : "↩ Revert this change"}</button> : !canReverseAdsChanges ? <p className="ai-change-revert-status">Only an owner or admin can reverse a Google Ads change.</p> : !completedAdsActivityLoaded ? <p className="ai-change-revert-status">Checking the Google Ads change record…</p> : !activity ? <p className="ai-change-revert-status" role="status">Automatic reversal details aren’t available for this record.</p> : <p className="ai-change-revert-status">This change can’t be reversed automatically because its original details are incomplete or it was already reversed.</p>}{completedRevertNotice?.id === approval.id && <p className={`ai-change-revert-status ${completedRevertNotice.ok ? "is-done" : "is-error"}`} role="status">{completedRevertNotice.message}</p>}</div></details>
        </article>;
      })}</div> : <div className="ai-task-empty">{aiTaskTab === "scheduled" ? "No AI tasks are scheduled right now." : aiTaskTab === "doing" ? "No AI task or Ads change is running right now." : aiTaskTab === "completed" || aiTaskTab === "history" ? "No completed, cancelled or dismissed AI tasks yet." : aiTaskTab === "pending" ? "No tasks are waiting on evidence." : "No tasks are waiting here."}</div> : null}
    </section>}
    {selectedTaskView === "pipeline" && <>
    <div className="pipeline-toolbar"><div><b>📋 Agency delivery</b><span>{workflowTab === "approvals" ? `${workflowReviewTasks.length} shown · ${workflowReviewQueue.length} awaiting approval · ${workflowReviewTasks.filter((task) => task.priority === "High" || task.priority === "Urgent").length} high priority` : workflowTab === "history" ? `${workflowHistoryTasks.length} shown · ${workflowStaffTasks.length} staff tasks matching · ${workflowHistoryTasks.filter((task) => task.priority === "High" || task.priority === "Urgent").length} high priority` : `${tasks.length} shown · ${priorityFilteredTasks.length} matching · ${priorityFilteredTasks.filter((task) => task.priority === "High" || task.priority === "Urgent").length} high priority`}</span></div><div className="pipeline-toolbar-filters" role="group" aria-label="Workflow task filters"><label className="pipeline-select-filter client-filter"><span>👥 Client</span><select aria-label="Filter tasks by client" value={workflowClientFilter} onChange={(event) => setWorkflowClientFilter(event.target.value)}><option value="all">All clients</option>{workflowClients.map((client) => <option value={client.id} key={client.id}>{client.name}</option>)}{hasInternalWorkflowTasks && <option value="internal">Internal · no client</option>}</select></label><label className="pipeline-select-filter"><span>🧰 Service</span><select aria-label="Filter tasks by service type" value={workflowServiceFilter} onChange={(event) => setWorkflowServiceFilter(event.target.value)}><option value="all">All services</option>{workflowServices.map((service) => <option value={service} key={service}>{service}</option>)}{hasUncategorizedWorkflowTasks && <option value="none">No service</option>}</select></label><label className="pipeline-select-filter"><span>👤 Staff</span><select aria-label="Filter tasks by staff member" value={workflowAssigneeFilter} onChange={(event) => setWorkflowAssigneeFilter(event.target.value)}><option value="all">All staff</option>{workflowAssignees.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}{hasUnassignedWorkflowTasks && <option value="unassigned">Unassigned</option>}</select></label><button type="button" className={`priority-filter ${priorityOnly ? "selected" : ""}`} onClick={() => setPriorityOnly(!priorityOnly)} aria-pressed={priorityOnly}>🔥 {priorityOnly ? "Showing priority" : "Show priority only"}</button>{hasAnyWorkflowFilters && <button type="button" className="clear-task-filters" onClick={() => { setWorkflowClientFilter("all"); setWorkflowServiceFilter("all"); setWorkflowAssigneeFilter("all"); setPriorityOnly(false); }}>✕ Clear filters</button>}</div></div>
    {selectedTaskView === "pipeline" && workflowTab === "approvals" && <section className="workflow-review-inbox" aria-label="Staff task approvals"><header><div><h2>Approval queue</h2><p>See submitted work and filter by the person selected to approve it.</p></div><div className="workflow-review-toolbar"><label className="workflow-approval-filter"><span>Show approvals for</span><select aria-label="Filter approvals by approver" value={workflowReviewApproverFilter} onChange={(event) => setWorkflowReviewApproverFilter(event.target.value)}><option value="all">All users · {workflowReviewQueue.length}</option>{workflowApprovers.map((member) => <option key={member.id} value={member.id}>{member.name}{member.id === currentStaffId ? " (you)" : ""} · {workflowReviewCountsByApprover[member.id] || 0}</option>)}{workflowReviewCountsByApprover.unassigned ? <option value="unassigned">Unassigned · {workflowReviewCountsByApprover.unassigned}</option> : null}</select></label><span className="workflow-review-count">{workflowReviewQueue.length} need approval</span>{canManageStaffReviews && workflowReviewTasks.length > 0 && <button type="button" className="primary-button" disabled={reviewAllBusy} onClick={() => void approveAllVisibleStaffTasks()}>{reviewAllBusy ? "Approving…" : `✓ Approve all · ${workflowReviewTasks.length}`}</button>}</div></header>{workflowReviewTasks.length ? <div className="workflow-review-list task-review-grid">{workflowReviewTasks.map((task) => { const client = workspace.clients.find((item) => item.id === task.clientId); const assignee = workspace.staff.find((item) => item.id === task.assigneeId); return <article className="workflow-review-card task-review-shared-card" key={task.id}><div className="workflow-review-card-head"><span className={"task-client-mark " + (client?.logo ? "has-logo" : "")}>{client?.logo ? <img src={client.logo} alt="" /> : initials(client?.name || "Internal")}</span><div><small><AiIcon v={serviceIcons[task.service] || "✦"} /> {client?.name || "Internal"} · {task.service} · {assignee?.name || task.reviewSubmittedBy || "Team member"}</small><h3>{task.title}</h3></div><span className="workflow-review-status">📨 Awaiting approval</span></div>{task.reviewSubmissionNote && <p className="workflow-review-note"><b>Worker note</b>{task.reviewSubmissionNote}</p>}{canManageStaffReviews && <label className="secondary-button task-attachment-upload">{taskFileUploads[task.id] ? "Uploading…" : "＋ Add file"}<input type="file" multiple hidden disabled={Boolean(taskFileUploads[task.id])} accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.webp,.txt,.csv,.json,.zip" onChange={(event) => { const files = Array.from(event.currentTarget.files || []); event.currentTarget.value = ""; if (files.length) void attachTaskFiles(task.id, files); }} /></label>}{task.attachments?.length ? <section className="workflow-review-attachments" aria-label="Documents attached for approval"><b>📎 Submitted documents · {task.attachments.length}</b><ul>{task.attachments.map((attachment) => { const fileUrl = `/api/tasks/files?taskId=${encodeURIComponent(task.id)}&id=${encodeURIComponent(attachment.id)}`; return <li className="task-attachment-row" key={attachment.id}><FileThumb url={`${fileUrl}&preview=1`} name={attachment.name} type={attachment.type} /><a href={fileUrl}>{attachment.name}</a><small>{Math.max(1, Math.ceil(attachment.size / 1024))} KB · {attachment.uploadedBy}</small><button type="button" className="file-icon-btn" title="View" aria-label={`View ${attachment.name}`} onClick={() => setTaskFilePreview({ name: attachment.name, type: attachment.type, taskId: task.id, url: `${fileUrl}&preview=1` })}>👁</button>{canManageStaffReviews && <button type="button" className="file-icon-btn file-icon-danger" title="Delete" aria-label={`Delete ${attachment.name}`} onClick={() => void removeTaskFile(task.id, attachment.id, attachment.name)}>🗑</button>}</li>; })}</ul>{taskFileErrors[task.id] && <p className="form-error" role="alert">{taskFileErrors[task.id]}</p>}{taskFilePreview?.taskId === task.id && <FilePreviewModal file={taskFilePreview} onClose={() => setTaskFilePreview(null)} />}</section> : taskFileErrors[task.id] ? <p className="form-error" role="alert">{taskFileErrors[task.id]}</p> : null}{task.checklist?.length ? <details><summary>Checklist · {task.checklist.filter((item) => item.done).length}/{task.checklist.length} complete</summary><ul>{task.checklist.map((item) => <li key={item.id}>{item.done ? "✓" : "○"} {item.text}</li>)}</ul></details> : null}{task.reviewApproverId === currentStaffId || (canManageStaffReviews && !task.reviewApproverId) ? <div className="workflow-review-actions"><label><span>What should change? (only needed if returning)</span><textarea rows={2} value={workflowReviewNotes[task.id] || ""} onChange={(event) => setWorkflowReviewNotes((current) => ({ ...current, [task.id]: event.target.value }))} placeholder="A short, specific next step for the worker" /></label><div><button type="button" className="primary-button" onClick={() => { void onReviewStaffTask(task.id, "approve").then((ok) => { if (ok) setWorkflowReviewNotes((current) => { const next = { ...current }; delete next[task.id]; return next; }); }); }}>✓ Approve & complete</button><button type="button" className="secondary-button" disabled={(workflowReviewNotes[task.id] || "").trim().length < 3} onClick={() => { void onReviewStaffTask(task.id, "request_changes", workflowReviewNotes[task.id]).then((ok) => { if (ok) setWorkflowReviewNotes((current) => { const next = { ...current }; delete next[task.id]; return next; }); }); }}>↩ Request changes</button></div></div> : <p className="workflow-review-waiting">Waiting for {workspace.staff.find((member) => member.id === task.reviewApproverId)?.name || "the selected approver"} to review this task.</p>}</article>; })}</div> : <div className="workflow-review-empty"><span>✅</span><b>{workflowReviewQueue.length ? "No approvals for this user." : canManageStaffReviews ? "No tasks need approval." : "Nothing submitted for approval yet."}</b><p>{workflowReviewQueue.length ? "Choose another approver or All users to see other waiting tasks." : canManageStaffReviews ? "New staff submissions will appear here." : "Submit an assigned task for approval when your work is ready."}</p></div>}</section>}{showAiTasks && workflowTab === "approvals" && approvalInbox}
    {selectedTaskView === "pipeline" && workflowTab === "history" && <section className="workflow-review-inbox ai-unified-task-history" aria-label="Staff task history"><header><div><h2>Staff task history</h2><p>Completed staff work and approval decisions.</p></div><span className="workflow-review-count">{workflowHistoryTasks.length} tasks</span></header>{workflowHistoryTasks.length ? <div className="ai-review-grid is-history">{workflowHistoryTasks.map((task) => {
      const client = workspace.clients.find((item) => item.id === task.clientId);
      const assignee = workspace.staff.find((item) => item.id === task.assigneeId);
      const reviewEntries = (task.reviewHistory || []).slice().reverse();
      const latestReview = reviewEntries[0];
      const screenshots = (task.attachments || []).filter((attachment) => attachment.type.startsWith("image/"));
      const status = latestReview?.action === "approved" ? "✅ Approved" : latestReview?.action === "changes_requested" ? "↩️ Changes requested" : task.status === "Done" ? "✅ Completed" : "📨 Sent for approval";
      const historyDate = latestReview?.at || task.completedAt;
      return <TaskHistoryCard key={"staff-history-" + task.id} hideClient={hideCardClientLogo} clientName={client?.name || "Internal"} clientLogo={client?.logo} fallbackIcon="👤" service={task.service} assigneeName={assignee?.name || "Team member"} title={task.title} status={status} date={historyDate}>
        <div className="ai-review-result-strip"><span><b>Outcome</b> {status}</span><span><b>Review updates</b> {reviewEntries.length}</span></div>
        <section className="ai-completed-screenshots" aria-label={"Screenshots for " + task.title}><header><b>📸 Work screenshots</b><span>{screenshots.length ? screenshots.length + " saved" : "None saved"}</span></header>{screenshots.length ? <div className="ai-completed-screenshot-grid">{screenshots.map((attachment) => { const fileUrl = "/api/tasks/files?taskId=" + encodeURIComponent(task.id) + "&id=" + encodeURIComponent(attachment.id); return <button type="button" className="ai-completed-screenshot" key={attachment.id} onClick={() => setTaskFilePreview({ name: attachment.name, type: attachment.type, taskId: task.id, url: fileUrl + "&preview=1" })} aria-label={"View screenshot " + attachment.name}><img src={fileUrl + "&preview=1"} alt={attachment.name} loading="lazy"/><span>{attachment.name}</span></button>; })}</div> : <p>No screenshot was saved for this task.</p>}{canManageStaffReviews && <label className="secondary-button ai-add-screenshot">{taskFileUploads[task.id] ? "Uploading…" : "＋ Add screenshot"}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden disabled={Boolean(taskFileUploads[task.id])} onChange={(event) => { const files = Array.from(event.currentTarget.files || []); event.currentTarget.value = ""; if (files.length) void attachTaskFiles(task.id, files); }} /></label>}{taskFileErrors[task.id] && <small className="form-error" role="alert">{taskFileErrors[task.id]}</small>}</section>
        <details className="ai-review-card-details"><summary><span>🗂 Review history · {reviewEntries.length} updates</span><span className="ai-review-expand-label">View details ⌄</span></summary>{reviewEntries.length ? <ol>{reviewEntries.map((entry) => <li key={entry.id}><b>{entry.action === "submitted" ? "📨 Submitted" : entry.action === "approved" ? "✅ Approved" : "↩️ Changes requested"}</b><span>{entry.by} · {new Date(entry.at).toLocaleString("en-IE", { dateStyle: "medium", timeStyle: "short" })}</span>{entry.note && <p>{entry.note}</p>}</li>)}</ol> : <p>No approval decisions were needed for this task.</p>}</details>
        {taskFilePreview?.taskId === task.id && <FilePreviewModal file={taskFilePreview} onClose={() => setTaskFilePreview(null)} />}
      </TaskHistoryCard>;
    })}</div> : <div className="workflow-review-empty"><b>No completed staff tasks yet.</b><p>Completed tasks and approval decisions will appear here.</p></div>}</section>}
    {showAiTasks && workflowTab === "history" && <section className="workflow-review-inbox ai-unified-task-history" aria-label="AI task history"><header><div><h2>Completed AI tasks</h2><p>AI runs are recorded here alongside human task decisions.</p></div><span className="workflow-review-count">{aiCompletedTasksForHistory.length} runs</span></header>{aiCompletedTasksForHistory.length ? <div className="ai-review-grid is-history">{aiCompletedTasksForHistory.map((task) => { const client = workspace.clients.find((item) => item.id === task.clientId); const assignee = workspace.staff.find((member) => member.id === task.assigneeId); const historyScreenshots = (task.attachments || []).filter((attachment) => attachment.type.startsWith("image/")); return <TaskHistoryCard key={`ai-history-${task.id}`} hideClient={hideCardClientLogo} clientName={client?.name || "Internal"} clientLogo={client?.logo} fallbackIcon="🤖" service={task.aiMode || task.service} assigneeName={assignee?.name || "AI teammate"} title={task.title} status={task.aiCompletedWithGaps ? "⚠️ Completed with gaps" : "✅ Completed"} date={task.aiRunAt || task.completedAt}><p>{quickAiSummary(task)}</p>{historyScreenshots.length ? <div className="ai-history-screenshots" aria-label="Task screenshots">{historyScreenshots.map((attachment) => { const fileUrl = `/api/tasks/files?taskId=${encodeURIComponent(task.id)}&id=${encodeURIComponent(attachment.id)}`; return <button type="button" className="ai-history-screenshot" key={attachment.id} onClick={() => setTaskFilePreview({ name: attachment.name, type: attachment.type, taskId: task.id, url: `${fileUrl}&preview=1` })} aria-label={`View screenshot ${attachment.name}`}><img src={`${fileUrl}&preview=1`} alt={attachment.name} loading="lazy"/><span>{attachment.name}</span></button>; })}</div> : <small className="ai-history-no-screenshot">📷 No screenshot saved for this task</small>}{(task.attachments || []).filter((attachment) => attachment.type === "text/html" && /audit report/i.test(attachment.name)).map((attachment) => { const fileUrl = `/api/tasks/files?taskId=${encodeURIComponent(task.id)}&id=${encodeURIComponent(attachment.id)}`; return <button type="button" className="secondary-button ai-history-report-link" key={attachment.id} onClick={() => setTaskFilePreview({ name: attachment.name, type: attachment.type, taskId: task.id, url: `${fileUrl}&preview=1` })}>📊 Open audit report</button>; })}{canManageStaffReviews && <label className="secondary-button ai-add-screenshot ai-history-add-screenshot">{taskFileUploads[task.id] ? "Uploading…" : "＋ Add screenshot"}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden disabled={Boolean(taskFileUploads[task.id])} onChange={(event) => { const files = Array.from(event.currentTarget.files || []); event.currentTarget.value = ""; if (files.length) void attachTaskFiles(task.id, files); }} /></label>}{taskFileErrors[task.id] && <small className="form-error" role="alert">{taskFileErrors[task.id]}</small>}<small>{task.aiReviewedBy ? `Reviewed by ${task.aiReviewedBy}` : "Completed"}{task.aiRunAt ? ` · ${new Date(task.aiRunAt).toLocaleString("en-IE", { dateStyle: "medium", timeStyle: "short" })}` : task.completedAt ? ` · ${new Date(task.completedAt).toLocaleString("en-IE", { dateStyle: "medium", timeStyle: "short" })}` : ""}</small>{taskFilePreview?.taskId === task.id && <FilePreviewModal file={taskFilePreview} onClose={() => setTaskFilePreview(null)} />}</TaskHistoryCard>; })}</div> : <div className="workflow-review-empty"><b>No completed AI runs yet.</b><p>Completed AI task reports will appear here.</p></div>}</section>}
{workflowTab === "board" && <>
    {tasks.length ? <div className="pipeline-board">{statuses.map(({ label, value }) => { const columnTasks = byBoardOrder(boardTasks.filter((task) => task.status === value)); return <section className={`pipeline-column stage-${label.toLowerCase().replaceAll(" ", "-")}`} key={value} data-task-drop-stage={value} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }} onDrop={(event) => { event.preventDefault(); const id = event.dataTransfer.getData("text/plain") || draggingId; if (id) { setDroppedId(id); window.setTimeout(() => setDroppedId((current) => current === id ? "" : current), 650); moveTask(id, value, "drop"); } setDraggingId(""); }}><div className="pipeline-column-head"><span className="stage-dot"/><h2>{label}</h2><span className="column-count">{columnTasks.length}</span></div><div className="pipeline-cards">{columnTasks.length ? columnTasks.map(renderCard) : <div className="column-empty">{hasWorkflowFilters ? "No matching tasks here" : priorityOnly ? "No priority tasks here" : "Drop tasks here"}</div>}</div></section>; })}</div> : hasAnyWorkflowFilters ? <div className="empty-state"><div className="empty-icon">⌕</div><h2>No tasks match these filters.</h2><p>Clear one or more filters to see the rest of your workflow.</p><button className="primary-button" onClick={() => { setWorkflowClientFilter("all"); setWorkflowServiceFilter("all"); setWorkflowAssigneeFilter("all"); setPriorityOnly(false); }}>Clear filters</button></div> : <div className="empty-state"><div className="empty-icon">☷</div><h2>Give good work a clear next step.</h2><p>Create a task, assign it to someone and track time as the team works.</p><button className="primary-button" onClick={onAdd}>Create your first task <span>↗</span></button></div>}</>}</>}
    {pendingReasonTask && <div className="modal-backdrop task-pending-reason-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closePendingReason(); }}><section className="modal task-pending-reason-modal" role="dialog" aria-modal="true" aria-labelledby="pending-reason-title"><header className="modal-head"><div><p className="eyebrow">TASK STATUS · PENDING</p><h2 id="pending-reason-title">Why is this task pending?</h2></div><button type="button" className="icon-button" aria-label="Close pending reason" onClick={closePendingReason}>×</button></header><h3>{pendingReasonTask.title}</h3><p className="task-pending-reason-dialog-copy">{pendingReasonFor(pendingReasonTask)}</p><label className="task-pending-reason-editor"><span>Reason saved on this task · 150 characters max</span><textarea rows={3} maxLength={150} value={pendingReasonDraft} onChange={(event) => setPendingReasonDraft(event.target.value)} placeholder="State the specific blocker or next step…"/><small>{pendingReasonDraft.trim().length}/150 characters</small></label><p className="task-pending-reason-dialog-meta">{workspace.clients.find((client) => client.id === pendingReasonTask.clientId)?.name || "Internal"} · {workspace.staff.find((member) => member.id === pendingReasonTask.assigneeId)?.name || "Unassigned"}</p>{pendingReasonTask.pendingReason && <p className="task-pending-reason-dialog-meta">Reason recorded by {pendingReasonTask.pendingReasonBy || "team member"}{pendingReasonTask.pendingReasonAt ? ` · ${new Date(pendingReasonTask.pendingReasonAt).toLocaleString("en-IE", { dateStyle: "medium", timeStyle: "short" })}` : ""}</p>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={closePendingReason}>Close</button><button type="button" className="secondary-button" onClick={() => { const id = pendingReasonTask.id; closePendingReason(); window.setTimeout(() => { const card = document.getElementById(`task-${id}`); const details = card?.querySelector<HTMLDetailsElement>(".pipeline-card-details"); if (details) details.open = true; card?.scrollIntoView({ behavior: "smooth", block: "center" }); }, 80); }}>View task details</button><button type="button" className="primary-button" disabled={!pendingReasonDraft.trim()} onClick={() => { if (pendingReasonTargetStatus) onStatus(pendingReasonTask.id, pendingReasonTargetStatus, pendingReasonDraft); else onSavePendingReason(pendingReasonTask.id, pendingReasonDraft); closePendingReason(); }}>Save reason</button></div></section></div>}
    {donePrompt && (() => { const doneTask = workspace.tasks.find((item) => item.id === donePrompt.taskId); const uploading = Boolean(taskFileUploads[donePrompt.taskId]); const uploadError = taskFileErrors[donePrompt.taskId]; const attached = (doneTask?.attachments || []).length; return <div className="modal-backdrop done-upload-backdrop" role="dialog" aria-modal="true" aria-label="Attach documents to the completed task" onClick={(event) => { if (event.target === event.currentTarget && !uploading) setDonePrompt(null); }}><div className="modal done-upload-modal"><div className="done-upload-emoji" aria-hidden="true">✅</div><h2>Nice work — task done</h2><p className="muted">{doneTask?.title}</p>{donePrompt.step === "ask" ? <><p>Would you like to upload a PDF, doc or proof?</p><div className="done-upload-actions"><button type="button" className="secondary-button" onClick={() => setDonePrompt(null)}>No, finish</button><button type="button" className="primary-button" onClick={() => setDonePrompt({ taskId: donePrompt.taskId, step: "upload" })}>Yes, upload</button></div></> : <><label className="done-upload-drop"><input type="file" multiple accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp,.gif,.xls,.xlsx,.csv,.txt,application/pdf,image/*" disabled={uploading} onChange={(event) => { const picked = Array.from(event.target.files || []); event.target.value = ""; if (picked.length) void attachTaskFiles(donePrompt.taskId, picked); }} /><b>{uploading ? "Uploading…" : "Choose PDF, doc or proof"}</b><small>You can select several files at once.</small></label>{attached > 0 && <p className="done-upload-count">{attached} document{attached === 1 ? "" : "s"} attached to this task</p>}{uploadError && <p className="form-error" role="alert">{uploadError}</p>}<div className="done-upload-actions"><button type="button" className="primary-button" disabled={uploading} onClick={() => setDonePrompt(null)}>Done</button></div></>}</div></div>; })()}
    {celebrating && <div className="confetti-celebration" role="status" aria-live="polite"><div className="confetti-message">🎉 Task complete! 🎉</div>{Array.from({ length: 36 }, (_, index) => <span className="confetti-piece" key={index} style={{ left: `${(index * 37 + 9) % 100}%`, animationDelay: `${(index % 9) * 0.045}s`, backgroundColor: ["#397f73", "#e3a06e", "#8976b5", "#e8c868", "#d57878", "#6c9fc0"][index % 6] }} />)}</div>}
  </>;
}
function timerClock(seconds: number) { return `${String(Math.floor(seconds / 3600)).padStart(2, "0")}:${String(Math.floor(seconds % 3600 / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`; }

function TimesheetView({ workspace, onAdd }: { workspace: Workspace; onAdd: () => void }) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [staffFilter, setStaffFilter] = useState("all");
  const now = new Date(); now.setDate(now.getDate() + weekOffset * 7);
  const weekStart = new Date(now); weekStart.setDate(now.getDate() - (now.getDay() + 6) % 7); weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 7);
  const selectedEntries = workspace.entries.filter((entry) => staffFilter === "all" || entry.staffId === staffFilter);
  const week = selectedEntries.filter((entry) => new Date(entry.startAt) >= weekStart && new Date(entry.startAt) < weekEnd);
  const total = selectedEntries.reduce((sum, entry) => sum + entry.seconds, 0);
  const weekSeconds = week.reduce((sum, entry) => sum + entry.seconds, 0);
  const billableSeconds = selectedEntries.filter((entry) => entry.billable).reduce((sum, entry) => sum + entry.seconds, 0);
  const peopleTracked = new Set(week.map((entry) => entry.staffId)).size;
  const taskTotals = Array.from(week.reduce((groups, entry) => {
    const task = workspace.tasks.find((item) => item.id === entry.taskId);
    const client = workspace.clients.find((item) => item.id === entry.clientId);
    const title = task?.title || "Manual entry";
    const clientName = client?.name || "Internal";
    const key = `${entry.taskId || "manual"}:${entry.clientId || "internal"}:${title}`;
    const current = groups.get(key) || { key, title, clientName, seconds: 0, entries: 0 };
    current.seconds += entry.seconds;
    current.entries += 1;
    groups.set(key, current);
    return groups;
  }, new Map<string, { key: string; title: string; clientName: string; seconds: number; entries: number }>() ).values()).sort((a, b) => b.seconds - a.seconds);
  const hoursLabel = (seconds: number) => `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m`;
  return <><div className="page-heading"><div><p className="eyebrow">CLOCKIFY-STYLE TIME TRACKING</p><h1>Time & timesheets</h1><p className="muted">Review tracked hours by teammate and task.</p></div><button className="primary-button" onClick={onAdd}>＋ Log time</button></div><div className="timesheet-toolbar"><div className="week-switch"><button onClick={() => setWeekOffset(weekOffset - 1)} aria-label="Previous week">‹</button><b>{weekStart.toLocaleDateString("en-IE", { day: "numeric", month: "short" })} – {new Date(weekEnd.getTime() - 1).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric" })}</b><button onClick={() => setWeekOffset(weekOffset + 1)} aria-label="Next week">›</button></div><label className="timesheet-person-filter"><span>👤 Teammate</span><select aria-label="Filter timesheets by teammate" value={staffFilter} onChange={(event) => setStaffFilter(event.target.value)}><option value="all">Everyone</option>{workspace.staff.filter((member) => !member.isBot).map((member) => <option value={member.id} key={member.id}>{member.name}</option>)}</select></label><span className="status-pill">{week.length} {week.length === 1 ? "entry" : "entries"} this week</span></div><div className="metric-grid compact"><Metric title="All time tracked" value={hoursLabel(total)} detail={staffFilter === "all" ? "Across the agency" : `For ${workspace.staff.find((member) => member.id === staffFilter)?.name || "selected teammate"}`} icon="◷" tint="peach" /><Metric title="This week" value={hoursLabel(weekSeconds)} detail={`${week.length} entries`} icon="▦" tint="mint" /><Metric title="Billable hours" value={hoursLabel(billableSeconds)} detail="All time · selected view" icon="€" tint="lilac" /><Metric title="People tracked" value={String(peopleTracked)} detail="In this week’s entries" icon="♙" tint="blue" /></div><section className="panel timesheet-task-summary"><div className="panel-heading"><div><h2>🗂️ Time by task</h2><p>{staffFilter === "all" ? "Hours grouped across the selected week" : `Hours for ${workspace.staff.find((member) => member.id === staffFilter)?.name || "selected teammate"} · selected week`}</p></div><span className="status-pill">{hoursLabel(weekSeconds)}</span></div>{taskTotals.length ? <div className="timesheet-task-list">{taskTotals.map((item) => <article className="timesheet-task-row" key={item.key}><span className="timesheet-task-icon">☷</span><div className="timesheet-task-info"><b>{item.title}</b><small>{item.clientName} · {item.entries} {item.entries === 1 ? "entry" : "entries"}</small></div><strong>{hoursLabel(item.seconds)}</strong></article>)}</div> : <p className="timesheet-task-empty">No task time recorded for this week and teammate.</p>}</section>{week.length ? <div className="panel table-panel"><table><thead><tr><th>Date</th><th>Team member</th><th>Task</th><th>Client</th><th>Duration</th><th>Note</th></tr></thead><tbody>{week.map((entry) => <tr key={entry.id}><td>{new Date(entry.startAt).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short" })}</td><td>{workspace.staff.find((member) => member.id === entry.staffId)?.name || "—"}</td><td>{workspace.tasks.find((task) => task.id === entry.taskId)?.title || "Manual entry"}</td><td>{workspace.clients.find((client) => client.id === entry.clientId)?.name || "Internal"}</td><td><b>{hoursLabel(entry.seconds)}</b></td><td>{entry.note}</td></tr>)}</tbody></table></div> : <div className="empty-state slim"><div className="empty-icon">◷</div><h2>No hours logged for this week.</h2><p>Choose another teammate or week, or start a task timer.</p><button className="primary-button" onClick={onAdd}>Log time <span>↗</span></button></div>}</>;
}

function ProfitabilityView({ workspace }: { workspace: Workspace }) {
  const rows = workspace.clients.flatMap((c) => c.services.map((s) => {
    const taskIds = new Set(workspace.tasks.filter((t) => t.clientId === c.id && t.service === s.name).map((t) => t.id));
    const hours = workspace.entries.filter((e) => taskIds.has(e.taskId)).reduce((a, e) => a + e.seconds / 3600, 0);
    const cost = workspace.entries.filter((e) => taskIds.has(e.taskId)).reduce((a, e) => a + e.seconds / 3600 * (workspace.staff.find((m) => m.id === e.staffId)?.costRate || 0), 0);
    return { client: c.name, service: s.name, fee: s.fee, spend: s.mediaSpend, hours, cost, margin: s.fee - cost };
  }));
  const fee = rows.reduce((a, r) => a + r.fee, 0), cost = rows.reduce((a, r) => a + r.cost, 0), spend = rows.reduce((a, r) => a + r.spend, 0);
  return <><div className="page-heading"><div><p className="eyebrow">AGENCY REVENUE · DELIVERY COST</p><h1>Profitability</h1><p className="muted">Revenue by client and service, compared with tracked internal labour.</p></div></div><div className="profit-note"><span>i</span><p>Media spend is shown separately and is not counted as agency revenue. Labour cost is estimated from tracked time × each team member’s hourly cost.</p></div><div className="metric-grid compact"><Metric title="Monthly service fees" value={money(fee)} detail="Agency fee revenue" icon="€" tint="mint" /><Metric title="Tracked labour cost" value={money(cost)} detail="Based on saved time entries" icon="◷" tint="peach" /><Metric title="Estimated gross margin" value={money(fee - cost)} detail={fee ? `${Math.round((fee - cost) / fee * 100)}% of fees` : "No revenue recorded yet"} icon="↗" tint="lilac" /><Metric title="Client media spend" value={money(spend)} detail="Separate from agency revenue" icon="◎" tint="blue" /></div>{rows.length ? <div className="panel table-panel"><table><thead><tr><th>Client / service</th><th>Monthly fee</th><th>Media spend</th><th>Tracked hours</th><th>Labour cost</th><th>Est. margin</th></tr></thead><tbody>{rows.map((r, i) => <tr key={`${r.client}-${r.service}-${i}`}><td><b>{r.client}</b><small className="table-sub"><AiIcon v={serviceIcons[r.service] || "✦"} /> {r.service}</small></td><td>{money(r.fee)}</td><td>{money(r.spend)}</td><td>{r.hours.toFixed(1)} h</td><td>{money(r.cost)}</td><td className={r.margin < 0 ? "negative-value" : "positive-value"}>{money(r.margin)}</td></tr>)}</tbody></table></div> : <div className="empty-state slim"><div className="empty-icon">↗</div><h2>Your margin view will appear here.</h2><p>Add monthly service fees to clients, hourly cost to team profiles, and track time against tasks.</p></div>}</>;
}

function TeamView({ workspace, onAdd, onAddAi, onEdit, onRemoveAi, onRemoveStaff, currentUserId, onRestoreAi }: { onRemoveStaff: (member: Staff) => void; currentUserId: string; workspace: Workspace; onAdd: () => void; onAddAi: () => void; onEdit: (member: Staff) => void; onRemoveAi: (member: Staff) => void; onRestoreAi: () => void }) {
  return <>
    <div className="page-heading"><div><p className="eyebrow">PEOPLE · ACCESS · CAPACITY</p><h1>Team</h1><p className="muted">Manage staff and create AI agents with their own instructions and access to all task modes and clients.</p></div><div className="team-heading-actions"><button className="primary-button" onClick={onAdd}>＋ Add teammate</button><button className="secondary-button" onClick={onAddAi}><AiEyesIcon /> Create AI agent</button>{(workspace.hiddenAiAgentIds || []).includes(aiTeammate.id) && <button className="secondary-button" onClick={onRestoreAi}><AiEyesIcon /> Add AI teammate</button>}</div></div>
    <div className="team-grid">{workspace.staff.map((member) => <article className={`team-card ${member.isBot ? "ai-team-card" : ""}`} key={member.id}>
      <div className="team-card-top"><StaffProfileAvatar member={member} className="team-avatar" /><span className="role-pill">{member.role}</span></div>
      <h3>{member.name}</h3><p>{member.isBot ? "Scheduled AI task runner" : member.email}</p>
      {member.isBot && <div className="ai-team-status">{"All task modes · all clients"}<br />{member.agentPrompt ? "Custom instructions saved" : "Using the mode’s default instructions"}</div>}
      <div className="team-card-bottom"><span>Internal cost rate</span><b>{money(member.costRate)} <small>/ hr</small></b></div>
      <div className="team-card-footer"><span>{member.id === workspace.ownerId ? "Workspace owner" : member.isBot ? "AI profile" : member.role}</span><span className="green-dot" /><button type="button" className="team-edit-icon" aria-label={`Edit ${member.name} profile and permissions`} title="Edit profile and permissions" onClick={() => onEdit(member)}>✎</button>{member.id === workspace.ownerId && <b className="owner-tag">WORKSPACE OWNER</b>}</div>
      {!member.isBot && member.id !== workspace.ownerId && member.id !== currentUserId && <button type="button" className="team-remove-ai task-delete" title="Delete staff member" aria-label={`Delete ${member.name}`} onClick={(event) => { event.stopPropagation(); onRemoveStaff(member); }}><span aria-hidden="true">🗑</span> Delete</button>}
      {member.isBot && <button type="button" className="team-remove-ai task-delete" title="Remove AI teammate" aria-label={`Remove AI teammate ${member.name}`} onClick={(event) => { event.stopPropagation(); onRemoveAi(member); }}><span aria-hidden="true">🗑</span> Delete</button>}
    </article>)}</div>
  </>;
}
