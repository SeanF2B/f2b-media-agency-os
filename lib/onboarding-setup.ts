// Onboarding setup checklists (Operations → Onboarding). Pure functions so they can be tested without the UI.
// Each checklist step says what it needs (connection/access), what proves it is done (evidence),
// and whether it must wait for approval before anything goes live.

export type SetupStep = { text: string; needs?: string; evidence: string; approval?: boolean };
export type ServiceSetup = { service: string; aiMode?: string; agent: RegExp; title: string; steps: SetupStep[] };

export const ONBOARDING_SETUPS: Record<string, ServiceSetup> = {
  "Google Ads": { service: "Google Ads", aiMode: "Google Ads", agent: /google[\s-]*ads|ppc/i, title: "Google Ads setup", steps: [
    { text: "Confirm Google Ads account access and billing", needs: "Google Ads customer ID linked to the agency manager account", evidence: "Account ID and access level" },
    { text: "Research keywords and competitors for each service and area", needs: "Google Ads access", evidence: "Keyword list with volumes, CPCs and match types" },
    { text: "Plan campaigns: budget, locations, bidding and conversion goals", evidence: "Campaign plan", approval: true },
    { text: "Build campaigns and ad groups, kept paused", needs: "Google Ads access", evidence: "Campaign and ad group IDs (paused)" },
    { text: "Write ads and assets; check keyword → ad → landing page relevance", evidence: "Ad copy and relevance check", approval: true },
    { text: "Set up and verify conversion tracking", needs: "GA4 or Google tag on the website", evidence: "Conversion action name and a recorded test conversion" },
    { text: "Launch campaigns", evidence: "Launch date and live campaign status", approval: true },
  ] },
  SEO: { service: "SEO", aiMode: "SEO", agent: /\bseo\b/i, title: "SEO setup", steps: [
    { text: "Confirm Search Console and GA4 access", needs: "Search Console property and GA4 property", evidence: "Property IDs" },
    { text: "Run a technical SEO audit and list fixes", needs: "Website URL", evidence: "Audit report link and fix list" },
    { text: "Keyword research per service and service area", evidence: "Keyword map" },
    { text: "Map keywords to pages and plan new pages", evidence: "Page plan", approval: true },
    { text: "Optimise titles, descriptions, canonicals and on-page content", needs: "Website builder or CMS access", evidence: "Pages updated (list)", approval: true },
    { text: "Set up local citations and internal links", evidence: "Citation list and links added" },
    { text: "Send the baseline report to the client", evidence: "Report link", approval: true },
  ] },
  Website: { service: "Sites", aiMode: "Sites", agent: /developer/i, title: "Website build", steps: [
    { text: "Review the website brief, branding and reference sites", evidence: "Brief summary and questions for the client" },
    { text: "Plan the sitemap and page structure", evidence: "Sitemap", approval: true },
    { text: "Write copy for each service and area page", evidence: "Page copy drafts", approval: true },
    { text: "Build pages in the website builder with the client branding", needs: "Website builder site for this client", evidence: "Preview link" },
    { text: "Set SEO titles, descriptions, canonical URLs and social images", evidence: "SEO fields complete on every page" },
    { text: "Set up forms, call tracking and analytics", needs: "GA4 property", evidence: "Test form submission received" },
    { text: "Client review and sign-off", evidence: "Client approval recorded", approval: true },
    { text: "Connect the domain and go live", needs: "Domain/DNS access", evidence: "Live URL loads over HTTPS", approval: true },
  ] },
  "Google Business Profile": { service: "SEO", aiMode: "SEO", agent: /\bseo\b/i, title: "Google Business Profile setup", steps: [
    { text: "Confirm Business Profile access", needs: "Business Profile location linked", evidence: "Location ID" },
    { text: "Complete categories, services, areas and opening hours", evidence: "Profile checklist complete", approval: true },
    { text: "Add photos and logo", evidence: "Photos uploaded (count)" },
    { text: "Draft the first posts", evidence: "Post drafts", approval: true },
    { text: "Set up review requests and draft review replies", evidence: "Review request link and reply drafts", approval: true },
  ] },
  "Meta Ads": { service: "Meta Ads", aiMode: "Meta Ads", agent: /meta|facebook|creative/i, title: "Meta Ads setup", steps: [
    { text: "Confirm ad account and Facebook Page access", needs: "Meta ad account ID", evidence: "Account ID and Page name" },
    { text: "Install and verify the Meta pixel or Conversions API", needs: "Website access", evidence: "Test event received" },
    { text: "Define audiences for each service area", evidence: "Audience list" },
    { text: "Prepare creatives and copy", evidence: "Creative drafts", approval: true },
    { text: "Launch campaigns", evidence: "Live campaign IDs", approval: true },
  ] },
  "Email Marketing": { service: "Email Marketing", agent: /email/i, title: "Email marketing setup", steps: [
    { text: "Confirm the sending domain and contact list", needs: "Sending domain DNS verified", evidence: "Domain status and list size" },
    { text: "Plan the nurture sequence", evidence: "Sequence outline", approval: true },
    { text: "Draft the emails", evidence: "Email drafts", approval: true },
    { text: "Set up the automation and send a test", evidence: "Test email received" },
    { text: "Plan the monthly newsletter", evidence: "Newsletter plan", approval: true },
  ] },
};

export function checklistText(step: SetupStep) {
  return [step.text, step.needs ? `Needs: ${step.needs}` : "", `Evidence: ${step.evidence}`, step.approval ? "⛔ Approval required" : ""].filter(Boolean).join(" · ");
}

type Bot = { id: string; name: string; role?: string };
export type SetupTaskDraft = { key: string; onboardingKey: string; title: string; service: string; aiMode?: string; assigneeId: string; checklist: string[] };

/** One setup task per newly selected service. Skips services that already have an onboarding task for this client. */
export function buildSetupTasks(clientId: string, clientName: string, services: string[], existingKeys: Set<string>, bots: Bot[]): SetupTaskDraft[] {
  return services.flatMap((key) => {
    const setup = ONBOARDING_SETUPS[key];
    const onboardingKey = `${clientId}:${key}`;
    if (!setup || existingKeys.has(onboardingKey)) return [];
    const agent = bots.find((bot) => setup.agent.test(`${bot.name} ${bot.role || ""} ${bot.id}`));
    return [{ key, onboardingKey, title: `${clientName} · ${setup.title}`, service: setup.service, aiMode: agent ? setup.aiMode : undefined, assigneeId: agent?.id || "", checklist: setup.steps.map(checklistText) }];
  });
}

/** Task services that should stop recurring when a client no longer has a service. */
export function servicesToPause(previous: string[], next: string[]) {
  const removed = previous.filter((key) => !next.includes(key));
  const stillUsed = new Set(next.map((key) => ONBOARDING_SETUPS[key]?.service).filter(Boolean));
  return [...new Set(removed.map((key) => ONBOARDING_SETUPS[key]?.service).filter((service): service is string => Boolean(service) && !stillUsed.has(service as string)))];
}

const LINE_TO_TASK_SERVICE: Record<string, string> = { "Google Ads": "Google Ads", SEO: "SEO", "Web Design & Development": "Sites", Sites: "Sites", "Meta Ads": "Meta Ads", "Email Marketing": "Email Marketing" };
/** Task services affected when service lines are removed from a client profile. */
export function taskServicesForRemovedLines(previous: string[], next: string[]) {
  const nextServices = new Set(next.map((name) => LINE_TO_TASK_SERVICE[name]).filter(Boolean));
  return [...new Set(previous.filter((name) => !next.includes(name)).map((name) => LINE_TO_TASK_SERVICE[name]).filter((service): service is string => Boolean(service) && !nextServices.has(service as string)))];
}

/** Open tasks that keep running on their own (recurring or scheduled AI) for these services — the ones to pause. */
export function recurringTaskIdsToPause<T extends { id: string; clientId: string; service: string; aiMode?: string; status: string; repeat?: string; aiRunState?: string; paused?: boolean }>(tasks: T[], clientId: string, services: string[]) {
  if (!services.length) return [];
  const set = new Set(services);
  return tasks.filter((task) => task.clientId === clientId && !task.paused && task.status !== "Done" && (set.has(task.service) || (task.aiMode ? set.has(task.aiMode) : false)) && ((task.repeat && task.repeat !== "None") || task.aiRunState === "scheduled")).map((task) => task.id);
}
