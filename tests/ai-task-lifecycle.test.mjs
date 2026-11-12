import test from "node:test";
import assert from "node:assert/strict";
import { build } from "../node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild/lib/main.js";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { approvalEvidenceBlockReason, canCloseAiTask, canResumeAiTaskRun, hasRunnablePendingApproval } from "../lib/ai-task-lifecycle.ts";

const completeStep = { text: "Review keyword evidence", done: true, evidence: "Search term report confirms the target and query." };
const approval = { status: "pending", checklistIndex: 0, evidence: "The live report supports this recommendation." };

test("Ads approval follows its linked evidence while task completion still requires every step", () => {
  const checklist = [completeStep, { text: "Check conversion setup", done: false, evidence: "No access to verify." }];
  assert.equal(approvalEvidenceBlockReason(approval, checklist), "");
  assert.equal(hasRunnablePendingApproval([approval], checklist), true);
  assert.equal(canCloseAiTask(checklist, [approval]), false);
  assert.match(approvalEvidenceBlockReason({ ...approval, checklistIndex: 1 }, checklist), /Check conversion setup.*still needs evidence/);
  assert.equal(hasRunnablePendingApproval([{ ...approval, checklistIndex: 1 }], checklist), false);
  assert.equal(canResumeAiTaskRun("needs_review", [{ ...approval, checklistIndex: 1 }], checklist), true, "a pending approval blocked on its linked evidence must allow Connors to resume");
  assert.equal(canResumeAiTaskRun("cancelled", [], checklist), true, "a safely cancelled run can be retried with its saved checklist");
  assert.equal(canResumeAiTaskRun("needs_review", [approval], checklist), false, "a ready approval must be decided before rerunning the task");
  assert.equal(canResumeAiTaskRun("needs_review", [{ ...approval, status: "applying", checklistIndex: 1 }], checklist), false, "an in-flight Ads change must never be retried concurrently");
  assert.equal(canCloseAiTask([completeStep, { ...checklist[1], done: true, evidence: "Conversion setup verified." }], [{ ...approval, status: "applied", verification: "verified" }]), true);
});

function makeOpenAiResult({ allStepsDone, withApproval }) {
  const checklistResults = allStepsDone
    ? [{ index: 0, completed: true, evidence: "Search term report confirms the target and query." }, { index: 1, completed: true, evidence: "Conversion tracking is active and recorded." }]
    : [{ index: 0, completed: true, evidence: "Search term report confirms the target and query." }, { index: 1, completed: false, evidence: "Conversion tracking could not be confirmed from the supplied data." }];
  return {
    summary: allStepsDone ? "Reviewed the task and verified both checklist items." : "Reviewed the supported evidence; one check still needs follow-up.",
    feedback: allStepsDone ? "The complete task was followed." : "One checklist step needs additional evidence.",
    needs_review: !allStepsDone,
    suggested_next_step: allStepsDone ? "Review the completed result." : "Confirm conversion setup, then continue.",
    checklist_results: checklistResults,
    approval_items: withApproval ? [{ checklist_index: 0, action_type: "ADD_KEYWORD", campaign_id: "camp-1", campaign_name: "Test campaign", ad_group_id: "group-1", keyword: "painting in dublin", match_type: "EXACT", daily_budget: 0, title: "Add exact keyword painting in dublin", rationale: "The report supports testing the specific phrase.", evidence: "Live search term evidence supports the exact keyword test." }] : [],
    action_campaign_id: "", action_type: "none", action_daily_budget: 0, action_ad_group_id: "", action_keyword: "", action_match_type: "EXACT",
  };
}

class FakeD1 {
  constructor(workspace) { this.workspace = workspace; this.revision = "r1"; this.runs = new Map(); this.pendingChanges = []; this.metaChanges = []; }
  prepare(sql) { return new FakeStatement(this, sql); }
  async batch(statements) { return Promise.all(statements.map((statement) => statement.run())); }
}

class FakeStatement {
  constructor(db, sql) { this.db = db; this.sql = sql; this.args = []; }
  bind(...args) { this.args = args; return this; }
  async first() {
    if (this.sql.includes("FROM workspace_documents")) return { data: JSON.stringify(this.db.workspace), updated_at: this.db.revision };
    if (this.sql.includes("FROM google_ads_connections")) return { account_email: "mock-connected@example.test" };
    if (this.sql.includes("FROM wordpress_connections")) return this.db.wordpressConnection || null;
    if (this.sql.includes("FROM ai_task_runs")) return this.db.runs.get(`${this.args[0]}:${this.args[1]}`) || null;
    return null;
  }
  async run() {
    if (this.sql.startsWith("UPDATE workspace_documents")) {
      this.db.workspace = JSON.parse(this.args[0]); this.db.revision = this.args[1];
      return { meta: { changes: 1 } };
    }
    if (this.sql.includes("INSERT OR IGNORE INTO ai_task_runs")) {
      const key = `${this.args[0]}:${this.args[1]}`;
      if (this.db.runs.has(key)) return { meta: { changes: 0 } };
      this.db.runs.set(key, { status: "running", started_at: this.args[2] });
      return { meta: { changes: 1 } };
    }
    if (this.sql.startsWith("UPDATE ai_task_runs")) {
      const key = `${this.args[0]}:${this.args[1]}`;
      this.db.runs.set(key, { ...(this.db.runs.get(key) || {}), status: this.args[2], started_at: this.args[3] || new Date().toISOString() });
      return { meta: { changes: 1 } };
    }
    if (this.sql.startsWith("INSERT INTO google_ads_pending_changes")) {
      this.db.pendingChanges.push(this.args);
      return { meta: { changes: 1 } };
    }
    if (this.sql.startsWith("INSERT INTO meta_ads_change_proposals")) {
      this.db.metaChanges.push(this.args);
      return { meta: { changes: 1 } };
    }
    return { meta: { changes: 1 } };
  }
}

async function loadIsolatedWorker({ landingPageUnavailable = false, wordpressReadbackFails = false, metaAdsWritable = false, seoFieldExposed = true, sourcePageReadbackFails = false } = {}) {
  const temp = await mkdtemp(path.join(os.tmpdir(), "f2b-ai-lifecycle-"));
  const mocks = {
    "../lib/google-ads-direct": `export const generateGoogleAdsKeywordIdeas=async()=>({status:"unavailable"}); export const getGoogleAdsAdPerformance=async()=>({}); export const getGoogleAdsKeywordCriterion=async()=>null; export const getGoogleAdsKeywordPerformance=async()=>({}); export const getGoogleAdsNegativeKeywords=async()=>({negatives:[]}); export const getGoogleAdsSearchTerms=async()=>({terms:[]}); export const listGoogleAdsAdGroups=async()=>[{campaignId:"camp-1",campaign:"Test campaign",id:"group-1",name:"Ad group 1",status:"ENABLED"}]; export const listGoogleAdsCampaigns=async()=>[{id:"camp-1",name:"Test campaign",status:"ENABLED",budgetResourceName:"budgets/1",budgetMicros:5000000}]; export const listGoogleAdsResponsiveSearchAds=async()=>[{campaignId:"camp-1",campaignName:"Test campaign",adGroupId:"group-1",adGroupName:"Ad group 1",adId:"ad-1",status:"ENABLED",finalUrls:["https://example.com/landing"],headlines:[{text:"Painting in Dublin"},{text:"Request a free quote"},{text:"Local painting team"}],descriptions:[{text:"Book a trusted painter in Dublin."},{text:"Get a clear quote for your project."}]}]; export const mutateGoogleAdsKeyword=async()=>{}; export const readGoogleAdsCampaign=async()=>({}); export const updateGoogleAdsCampaign=async()=>{}; export const updateGoogleAdsCampaignBudget=async()=>{};`,
    "../lib/meta-ads-direct": `export const metaAdsConnectionExists=async()=>${metaAdsWritable}; export const directMetaAdsManagementPermission=async()=>${metaAdsWritable}; export const readDirectMetaAdsInsights=async()=>[{campaign_id:"meta-camp-1",campaign_name:"Local leads",spend:"27.50",clicks:"12"}]; export const readDirectMetaCampaign=async(_owner,accountId,id)=>({id,name:"Local leads",accountId,currency:"EUR",status:"ACTIVE",dailyBudgetMinor:10000});`,
    "../lib/landing-page-reader": `export const readLandingPage=async(url)=>({url,status:${JSON.stringify(landingPageUnavailable ? "unavailable" : "connected")},title:"Painting in Dublin",description:"Request a free quote from our local team.",text:"Painting services in Dublin. Request a free quote today from our experienced local painting team."});`,
    "../lib/ai-feedback-memory": `export const getAiCampaignFeedbackMemory=()=>[];`,
    "../lib/gohighlevel": `export const mapGhlPagesToCampaignUrls=()=>({status:"not_connected"}); export const readGhlLandingPageMap=async()=>({status:"not_connected"});`,
    "../lib/gohighlevel-oauth": `export const getGhlLocationAccessToken=()=>null; export const ghlLocationRequest=async()=>({});`,
    "../lib/wordpress-pages": `let savedPage=null; let sourceReads=0; const sourcePage={id:7,status:"publish",slug:"roof-repairs",title:{raw:"Roof Repairs"},content:{raw:"<!-- wp:paragraph --><p>Current published roof repair page.</p><!-- /wp:paragraph -->"},link:"https://example.test/roof-repairs/"}; export const decryptWordPressPassword=async()=>"test-password"; export const validateWordPressSiteUrl=(value)=>new URL(value); export const wordpressRequest=async(siteUrl,username,password,path,init={})=>{ if(path.startsWith("pages/7?context=edit")){sourceReads++; ${sourcePageReadbackFails ? `if(sourceReads>1)throw new Error("mock source read-back unavailable");` : ``} return sourcePage;} if(path==="pages"&&init.method==="POST"){const input=JSON.parse(init.body); savedPage={id:42,status:"draft",slug:input.slug,title:{raw:input.title},content:{raw:input.content},link:siteUrl+"/"+input.slug+"/",meta:${seoFieldExposed ? `{rank_math_description:""}` : `{}`}}; return savedPage;} if(path==="pages/42"&&init.method==="POST"){const input=JSON.parse(init.body); savedPage={...savedPage,meta:{...savedPage.meta,...input.meta}}; return savedPage;} if(path.startsWith("pages/42?context=edit")){${wordpressReadbackFails ? `throw new Error("mock WordPress read-back unavailable");` : `return savedPage;`}} return {}; };`,
    "../lib/wordpress-mcp": `export const extractPages=()=>[]; export const extractSites=()=>[]; export const siteDomain=(value)=>new URL(value).hostname; export const unwrapWordPressMcpResult=(value)=>value; export const wordpressMcpCall=async()=>({});`,
  };
  const outfile = path.join(temp, "scheduled-ai.mjs");
  await build({
    entryPoints: [path.resolve("worker/scheduled-ai.ts")], outfile, bundle: true, platform: "node", format: "esm", target: "node24",
    plugins: [{ name: "isolated-integration-mocks", setup(buildApi) {
      buildApi.onResolve({ filter: /^\.\.\/lib\// }, (args) => args.path in mocks ? ({ path: args.path, namespace: "ai-test-mock" }) : null);
      buildApi.onLoad({ filter: /.*/, namespace: "ai-test-mock" }, (args) => ({ contents: mocks[args.path], loader: "js" }));
    } }],
  });
  const worker = await import(`${pathToFileURL(outfile).href}?test=${Date.now()}`);
  return { worker, dispose: () => rm(temp, { recursive: true, force: true }) };
}

test("dismissed scheduled AI tasks are not claimed by Connors", async () => {
  const dismissedAt = new Date(Date.now() - 60_000).toISOString();
  const task = { id: "dismissed-ai-task", clientId: "client-1", title: "Dismissed review", service: "Google Ads", aiMode: "Google Ads", status: "Cancelled", assigneeId: "f2b-ai-agent", aiRunState: "scheduled", aiRunAttempt: 1, aiStartNowRequestedAt: dismissedAt, aiDismissedAt: dismissedAt, dueAt: dismissedAt, due: dismissedAt.slice(0, 10) };
  const db = new FakeD1({ ownerId: "owner-1", staff: [{ id: "f2b-ai-agent", name: "Connors", isBot: true }], clients: [], tasks: [task], entries: [], activity: [] });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("A dismissed task must not trigger an AI request."); };
  const isolated = await loadIsolatedWorker();
  try {
    await isolated.worker.processDueAiTasks({ DB: db, OPENAI_API_KEY: "test-key" }, new Date());
    assert.equal(db.runs.size, 0, "dismissed work should never be claimed by the scheduler");
    assert.equal(db.workspace.tasks[0].status, "Cancelled");
    assert.equal(db.workspace.tasks[0].aiDismissedAt, dismissedAt);
  } finally {
    globalThis.fetch = originalFetch;
    isolated.dispose();
  }
});

test("scheduled AI task moves through approvals, completion, recurrence and email without live writes", async () => {
  const taskId = "task-lifecycle-test";
  const taskInstructions = "Review painting in dublin in the selected campaign. Propose the exact keyword only if live evidence supports it. Complete both checklist items and report missing evidence honestly.";
  const dueAt = new Date(Date.now() - 60_000).toISOString();
  const original = {
    id: taskId, clientId: "client-1", title: "Scheduled Google Ads evidence review", service: "Google Ads", aiMode: "Google Ads", status: "To do", assigneeId: "f2b-ai-agent", createdById: "owner-1", aiRunState: "scheduled", aiRunAttempt: 1, dueAt, due: dueAt.slice(0, 10), repeatTime: "09:30", repeat: "Weekly", occurrence: 1, campaignId: "camp-1", campaignName: "Test campaign", aiInstructions: taskInstructions,
    checklist: [{ id: "step-1", text: "Review the keyword evidence and prepare a recommendation", done: false }, { id: "step-2", text: "Confirm conversion tracking and record its status", done: false }],
  };
  const db = new FakeD1({ ownerId: "owner-1", staff: [{ id: "owner-1", name: "Owner", role: "Owner", email: "owner@example.test" }, { id: "f2b-ai-agent", name: "Connors", isBot: true }], clients: [{ id: "client-1", name: "Test Client", googleAdsAccountId: "1234567890", services: [] }], tasks: [original], notes: [{ id: "prior-note", taskId: "prior-task", clientId: "client-1", body: "Prior review: keep the selected campaign scope and verify conversions before recommendations.", createdAt: "2026-10-20T09:00:00.000Z", authorName: "Owner" }], entries: [], activity: [] });
  const outputs = [makeOpenAiResult({ allStepsDone: false, withApproval: true }), makeOpenAiResult({ allStepsDone: true, withApproval: false })];
  const aiRequests = [];
  const emails = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).includes("api.openai.com/v1/responses")) {
      const body = JSON.parse(init.body); aiRequests.push(body);
      const result = outputs.shift();
      return Response.json({ output_text: JSON.stringify(result) });
    }
    if (String(url).includes("api.resend.com/emails")) {
      emails.push(JSON.parse(init.body));
      return Response.json({ id: `mock-email-${emails.length}` });
    }
    throw new Error(`Unexpected network request in isolated test: ${url}`);
  };
  const isolated = await loadIsolatedWorker();
  const env = { DB: db, OPENAI_API_KEY: "mock-key", RESEND_API_KEY: "mock-resend-key", TASK_NOTIFICATION_FROM: "F2B Test <test@example.test>", TASK_APP_URL: "https://example.test", GOOGLE_ADS_CLIENT_ID: "mock", GOOGLE_ADS_CLIENT_SECRET: "mock", GOOGLE_ADS_TOKEN_ENCRYPTION_KEY: "mock" };
  try {
    await isolated.worker.processDueAiTasks(env, new Date());
    let task = db.workspace.tasks.find((item) => item.id === taskId);
    assert.equal(task.aiRunState, "needs_review", "the first scheduled run should land in Pending");
    assert.equal(task.status, "Blocked");
    assert.ok(task.pendingReason, "an AI task in Pending must explain why");
    assert.ok(task.pendingReason.length <= 150, "the AI pending reason must stay short");
    assert.equal(task.pendingReasonBy, "Connors");
    assert.equal((db.workspace.notes || []).filter((note) => note.taskId === taskId).length, 1, "pending runs must still save their findings and next steps");
    assert.equal(task.aiApprovals.length, 1, "an evidence-backed proposal should enter the approval queue");
    assert.equal(task.aiApprovals[0].checklistIndex, 0);
    assert.equal(approvalEvidenceBlockReason(task.aiApprovals[0], task.checklist), "", "unrelated incomplete checklist work must not lock this approval");
    assert.equal(db.pendingChanges.length, 1, "the proposal should create one pending change record");
    assert.equal(canCloseAiTask(task.checklist, task.aiApprovals), false, "the whole task must remain open while another checklist step is incomplete");
    assert.equal(task.aiFeedback.includes(taskInstructions), true, "the full task card instructions should be recorded in the task report");
    const firstContext = JSON.parse(aiRequests[0].input);
    assert.ok(firstContext.recentWorkroomNotes.some((note) => note.body.includes("Prior review")), "Connors should receive relevant previous workroom notes");
    assert.equal(firstContext.scheduledTask.instructions, taskInstructions);
    assert.equal(firstContext.scheduledTask.checklist.length, 2);
    assert.equal(firstContext.googleAdsReviewPrerequisite.status, "ready", "scheduled Google Ads reviews must pass the landing-page and headline gate before recommendations");
    assert.deepEqual(firstContext.directGoogleAds.responsiveSearchAds.activeAds[0].headlines.map((item) => item.text), ["Painting in Dublin", "Request a free quote", "Local painting team"]);
    assert.equal(firstContext.landingPages[0].associatedHeadlines.includes("Painting in Dublin"), true, "the matching ad headlines should accompany the destination page snapshot");
    const firstAlert = emails.find((email) => email.subject.includes(original.title));
    assert.ok(firstAlert, "a run that needs review should send one notification");
    assert.match(firstAlert.text, /Reason:/);
    assert.match(firstAlert.text, /taskId=task-lifecycle-test/);
    assert.doesNotMatch(firstAlert.text, /Exact card instructions|AI result:/, "email should link to the saved report instead of duplicating it");
    assert.doesNotMatch(firstAlert.text, new RegExp(taskInstructions.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "email should not include the full task instructions");

    // Model the approved-and-verified state returned by the app's approval handler; the fake Ads provider performs no write.
    task.aiApprovals = task.aiApprovals.map((item) => ({ ...item, status: "applied", verification: "verified", resultDetail: "Mock Ads read-back verified." }));
    task.status = "To do"; task.aiRunState = "scheduled"; task.aiRunAttempt += 1; task.dueAt = new Date(Date.now() - 30_000).toISOString();
    db.workspace.tasks = db.workspace.tasks.map((item) => item.id === taskId ? task : item);
    await isolated.worker.processDueAiTasks(env, new Date());
    task = db.workspace.tasks.find((item) => item.id === taskId);
    assert.equal(task.aiRunState, "completed", "the follow-up scheduled run should complete after every checklist step is evidenced");
    assert.equal(task.status, "Done");
    assert.equal(task.aiApprovals[0].status, "applied", "the approval must remain attached to the task");
    assert.equal(db.pendingChanges.length, 1, "retry must not duplicate the same pending Google Ads change");
    const next = db.workspace.tasks.find((item) => item.seriesId === taskId && item.id !== taskId);
    assert.ok(next, "a completed weekly task should create the next occurrence");
    assert.equal(next.aiInstructions, taskInstructions);
    assert.equal(next.aiRunState, "scheduled");
    const accountNotes = db.workspace.notes.filter((note) => note.taskId === taskId);
    assert.equal(accountNotes.length, 2, "each AI execution should leave a persistent client and task note");
    assert.match(accountNotes[0].body, /STATUS: Completed/);
    assert.match(accountNotes[1].body, /STATUS: Needs follow-up/);
    assert.equal(accountNotes[0].clientId, "client-1");
    assert.equal(accountNotes[0].authorName, "Connors");
    const secondContext = JSON.parse(aiRequests[1].input);
    assert.ok(secondContext.recentWorkroomNotes.some((note) => note.body.includes("STATUS: Needs follow-up")), "later runs should be able to read saved AI notes");
    assert.equal(emails.filter((email) => email.subject.includes(original.title)).length, 1, "a completed run without a blocker should not send another email");
    assert.equal(db.workspace.activity.some((event) => event.title === "AI task completed"), true);
    assert.equal(db.workspace.entries.some((entry) => entry.taskId === taskId && entry.note.includes("task run duration")), true);
    assert.equal(db.workspace.activity.some((event) => event.title === "Recurring task added to To do"), true);

    await isolated.worker.processDueAiTasks(env, new Date());
    const emailedNext = db.workspace.tasks.find((item) => item.id === next.id);
    assert.equal(emailedNext.recurrenceNoticePending, false);
    assert.equal(emailedNext.recurrenceEmailStatus, "sent");
    const recurringEmail = emails.find((email) => email.subject === `New recurring task assigned: ${original.title}`);
    assert.ok(recurringEmail, "the recurring occurrence should trigger its own email notification");
    assert.match(recurringEmail.text, /added to To do/);
    assert.match(recurringEmail.text, /Assigned to: F2B AI/);
  } finally {
    globalThis.fetch = originalFetch;
    await isolated.dispose();
  }
});

test("cancelling a live AI task stops before final results and preserves a retryable task", async () => {
  const taskId = "task-cancel-live-test";
  const dueAt = new Date(Date.now() - 60_000).toISOString();
  const task = { id: taskId, clientId: "client-1", title: "Cancel-safe Google Ads review", service: "Google Ads", aiMode: "Google Ads", status: "To do", assigneeId: "f2b-ai-agent", aiRunAttempt: 1, aiRunState: "scheduled", dueAt, due: dueAt.slice(0, 10), campaignId: "camp-1", campaignName: "Test campaign", aiInstructions: "Review the selected campaign and report only evidence-backed findings.", checklist: [{ id: "step-1", text: "Review the campaign and record evidence", done: false }] };
  const db = new FakeD1({ ownerId: "owner-1", staff: [{ id: "owner-1", name: "Owner", role: "Owner", email: "owner@example.test" }, { id: "f2b-ai-agent", name: "Connors", isBot: true }], clients: [{ id: "client-1", name: "Test Client", googleAdsAccountId: "1234567890", services: [] }], tasks: [task], entries: [], activity: [] });
  const originalFetch = globalThis.fetch;
  let progressAtAiRequest = "";
  globalThis.fetch = async (url) => {
    if (String(url).includes("api.openai.com/v1/responses")) {
      progressAtAiRequest = db.workspace.tasks[0].aiProgressText;
      db.workspace.tasks[0].aiCancelRequestedAt = new Date().toISOString();
      db.workspace.tasks[0].aiCancelRequestedBy = "Owner";
      return Response.json({ output_text: JSON.stringify(makeOpenAiResult({ allStepsDone: true, withApproval: false })) });
    }
    throw new Error(`Unexpected network request in isolated cancellation test: ${url}`);
  };
  const isolated = await loadIsolatedWorker();
  try {
    await isolated.worker.processDueAiTasks({ DB: db, OPENAI_API_KEY: "mock-key", GOOGLE_ADS_CLIENT_ID: "mock", GOOGLE_ADS_CLIENT_SECRET: "mock", GOOGLE_ADS_TOKEN_ENCRYPTION_KEY: "mock" }, new Date());
    const stopped = db.workspace.tasks.find((item) => item.id === taskId);
    assert.equal(progressAtAiRequest, "Preparing the checklist review and recommendations", "the live card stage should describe what Connors is doing");
    assert.equal(stopped.aiRunState, "cancelled", "a stop request must not be labelled completed or failed");
    assert.equal(stopped.status, "To do", "the task remains available for retry");
    assert.equal(stopped.aiRunStartedAt, undefined, "the Doing timer stops when cancellation is finalized");
    assert.equal(stopped.aiCancelledBy, "Owner");
    assert.equal(stopped.checklist[0].done, false, "cancelled results must not be written as completed");
    assert.equal(db.workspace.activity.some((event) => event.title === "AI task cancelled"), true, "the completed cancellation is recorded in Activity");
    assert.equal(db.workspace.entries.some((entry) => entry.note.includes("run cancelled")), true, "time spent before cancellation is saved");
    assert.equal(canResumeAiTaskRun(stopped.aiRunState, stopped.aiApprovals || [], stopped.checklist), true, "the saved task can be retried");
  } finally {
    globalThis.fetch = originalFetch;
    await isolated.dispose();
  }
});

test("scheduled Google Ads review with an unreadable landing page withholds recommendations and approvals", async () => {
  const taskId = "landing-page-gate-test";
  const dueAt = new Date(Date.now() - 60_000).toISOString();
  const task = { id: taskId, clientId: "client-1", title: "Review the selected campaign page", service: "Google Ads", aiMode: "Google Ads", status: "To do", assigneeId: "f2b-ai-agent", aiRunState: "scheduled", dueAt, due: dueAt.slice(0, 10), campaignId: "camp-1", campaignName: "Test campaign", aiInstructions: "Review the landing page and headlines, then recommend an exact keyword only if supported.", checklist: [{ id: "step-1", text: "Review the landing page and recommend a keyword", done: false }] };
  const db = new FakeD1({ ownerId: "owner-1", staff: [{ id: "owner-1", name: "Owner", role: "Owner", email: "owner@example.test" }, { id: "f2b-ai-agent", name: "Connors", isBot: true }], clients: [{ id: "client-1", name: "Test Client", googleAdsAccountId: "1234567890", services: [] }], tasks: [task], entries: [], activity: [] });
  const result = makeOpenAiResult({ allStepsDone: true, withApproval: true });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("api.openai.com/v1/responses")) return Response.json({ output_text: JSON.stringify(result) });
    throw new Error(`Unexpected network request in isolated test: ${url}`);
  };
  const isolated = await loadIsolatedWorker({ landingPageUnavailable: true });
  try {
    await isolated.worker.processDueAiTasks({ DB: db, OPENAI_API_KEY: "mock-key", GOOGLE_ADS_CLIENT_ID: "mock", GOOGLE_ADS_CLIENT_SECRET: "mock", GOOGLE_ADS_TOKEN_ENCRYPTION_KEY: "mock" }, new Date());
    const updated = db.workspace.tasks.find((item) => item.id === taskId);
    assert.equal(updated.aiRunState, "needs_review");
    assert.equal(updated.aiApprovals.length, 0, "an unreadable destination must not create a decision item");
    assert.equal(db.pendingChanges.length, 0, "the blocked pre-review must not stage any Ads change");
    assert.equal(updated.checklist[0].done, false, "the recommendation step stays open until the page can be reviewed");
    assert.match(updated.aiFeedback, /landing-page review is incomplete/i);
    assert.match(updated.aiFeedback, /could not be read/i);
  } finally {
    globalThis.fetch = originalFetch;
    await isolated.dispose();
  }
});

test("Meta Ads AI task receives selected-campaign data and cannot stage account changes", async () => {
  const taskId = "meta-ads-read-only-task";
  const dueAt = new Date(Date.now() - 60_000).toISOString();
  const task = { id: taskId, clientId: "client-1", title: "Review Meta campaign", service: "Meta Ads", aiMode: "Meta Ads", status: "To do", assigneeId: "f2b-ai-agent", aiRunState: "scheduled", dueAt, due: dueAt.slice(0, 10), campaignId: "meta-camp-1", campaignName: "Local leads", aiInstructions: "Review performance and report findings.", checklist: [{ id: "step-1", text: "Review spend and platform leads", done: false }] };
  const db = new FakeD1({ ownerId: "owner-1", staff: [{ id: "owner-1", name: "Owner", role: "Owner", email: "owner@example.test" }, { id: "f2b-ai-agent", name: "Connors", isBot: true }], clients: [{ id: "client-1", name: "Test Client", metaAdsAccountId: "act_1234567890", services: [] }], tasks: [task], entries: [], activity: [] });
  const result = makeOpenAiResult({ allStepsDone: true, withApproval: true });
  const originalFetch = globalThis.fetch;
  let taskContext;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).includes("connectors.windsor.ai/facebook")) return Response.json({ data: [{ campaign_id: "meta-camp-1", campaign: "Local leads", spend: "27.50", clicks: "12", actions_lead: "2" }] });
    if (String(url).includes("api.openai.com/v1/responses")) {
      taskContext = JSON.parse(JSON.parse(options.body).input);
      return Response.json({ output_text: JSON.stringify(result) });
    }
    throw new Error(`Unexpected network request in Meta Ads task test: ${url}`);
  };
  const isolated = await loadIsolatedWorker();
  try {
    await isolated.worker.processDueAiTasks({ DB: db, OPENAI_API_KEY: "mock-key", WINDSOR_API_KEY: "mock-windsor-key" }, new Date());
    const updated = db.workspace.tasks.find((item) => item.id === taskId);
    assert.equal(taskContext.selectedMode, "Meta Ads");
    assert.equal(taskContext.metaAds.status, "connected_read_only");
    assert.equal(taskContext.metaAds.data.length, 3, "campaign, ad set and ad evidence should be supplied");
    assert.equal(taskContext.metaAds.data.every((item) => item.campaign_id === "meta-camp-1"), true, "the selected campaign must scope every Meta Ads evidence row");
    assert.equal(updated.aiApprovals.length, 0, "Meta analysis must not enter the Google Ads approval pipeline");
    assert.equal(db.pendingChanges.length, 0, "Meta tasks must not stage account changes");
    assert.equal(updated.aiRunState, "completed");
  } finally {
    globalThis.fetch = originalFetch;
    await isolated.dispose();
  }
});

test("Meta Ads AI task stages a supported exact campaign proposal only when direct management access and checklist evidence exist", async () => {
  const taskId = "meta-ads-approved-proposal-task";
  const dueAt = new Date(Date.now() - 60_000).toISOString();
  const task = { id: taskId, clientId: "client-1", title: "Review and pause campaign if spend is wasted", service: "Meta Ads", aiMode: "Meta Ads", status: "To do", assigneeId: "f2b-ai-agent", aiRunState: "scheduled", dueAt, due: dueAt.slice(0, 10), campaignId: "meta-camp-1", campaignName: "Local leads", aiInstructions: "Review performance and report findings.", checklist: [{ id: "step-1", text: "Review spend and platform leads", done: false }] };
  const db = new FakeD1({ ownerId: "owner-1", staff: [{ id: "owner-1", name: "Owner", role: "Owner", email: "owner@example.test" }, { id: "f2b-ai-agent", name: "Connors", isBot: true }], clients: [{ id: "client-1", name: "Test Client", metaAdsAccountId: "act_1234567890", services: [] }], tasks: [task], entries: [], activity: [] });
  const result = makeOpenAiResult({ allStepsDone: true, withApproval: false });
  result.approval_items = [{ checklist_index: 0, action_type: "META_PAUSED", campaign_id: "meta-camp-1", campaign_name: "Local leads", ad_group_id: "", keyword: "", match_type: "EXACT", daily_budget: 0, title: "Pause Local leads", rationale: "The supplied evidence shows the selected campaign is not producing leads.", evidence: "The selected campaign has spend and clicks but no platform-reported leads in the supplied range.", action_params: "", ad_id: "", headlines: [], descriptions: [] }];
  const originalFetch = globalThis.fetch;
  let taskContext;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).includes("api.openai.com/v1/responses")) {
      taskContext = JSON.parse(JSON.parse(options.body).input);
      return Response.json({ output_text: JSON.stringify(result) });
    }
    throw new Error(`Unexpected network request in Meta Ads proposal test: ${url}`);
  };
  const isolated = await loadIsolatedWorker({ metaAdsWritable: true });
  try {
    await isolated.worker.processDueAiTasks({ DB: db, OPENAI_API_KEY: "mock-key" }, new Date());
    const updated = db.workspace.tasks.find((item) => item.id === taskId);
    assert.equal(taskContext.metaAds.changePermission.startsWith("direct ads_management granted"), true);
    assert.equal(updated.aiApprovals.length, 1);
    assert.equal(updated.aiApprovals[0].actionType, "META_PAUSED");
    assert.equal(updated.aiApprovals[0].status, "pending");
    assert.equal(db.metaChanges.length, 1, "the exact proposal must be saved for the Meta approval endpoint");
    assert.equal(db.metaChanges[0][6], "status");
    assert.equal(db.metaChanges[0][8], "ACTIVE");
    assert.equal(db.metaChanges[0][9], "PAUSED");
    assert.equal(updated.aiRunState, "needs_review");
  } finally {
    globalThis.fetch = originalFetch;
    await isolated.dispose();
  }
});

test("SEO AI task receives the selected client's Search Console and GA4 evidence", async () => {
  const taskId = "seo-connected-evidence-task";
  const dueAt = new Date(Date.now() - 60_000).toISOString();
  const task = { id: taskId, clientId: "client-1", title: "Review organic visibility", service: "SEO", aiMode: "SEO", status: "To do", assigneeId: "f2b-ai-agent", aiRunState: "scheduled", dueAt, due: dueAt.slice(0, 10), aiInstructions: "Review current organic performance and report supported issues.", checklist: [{ id: "step-1", text: "Review clicks, impressions and GA4 events", done: false }] };
  const db = new FakeD1({ ownerId: "owner-1", staff: [{ id: "owner-1", name: "Owner", role: "Owner", email: "owner@example.test" }, { id: "f2b-ai-agent", name: "Connors", isBot: true }], clients: [{ id: "client-1", name: "Test Client", googleSearchConsoleAccountId: "sc-property-1", googleAnalyticsAccountId: "ga-property-1", services: [] }], tasks: [task], entries: [], activity: [] });
  const originalFetch = globalThis.fetch;
  let taskContext;
  let directSearchConsoleReads = 0;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).includes("connectors.windsor.ai/googleanalytics4")) return Response.json({ data: [{ sessions: "20", active_users: "18", engaged_sessions: "14", conversions: "2", totalrevenue: "0" }] });
    if (String(url).includes("api.openai.com/v1/responses")) {
      taskContext = JSON.parse(JSON.parse(options.body).input);
      return Response.json({ output_text: JSON.stringify(makeOpenAiResult({ allStepsDone: true, withApproval: false })) });
    }
    throw new Error(`Unexpected network request in SEO task test: ${url}`);
  };
  const isolated = await loadIsolatedWorker();
  try {
    await isolated.worker.processDueAiTasks({ DB: db, OPENAI_API_KEY: "mock-key", WINDSOR_API_KEY: "mock-windsor-key", hasDirectSearchConsole: async (ownerId) => ownerId === "owner-1", readDirectSearchConsole: async (ownerId, propertyId, startDate, endDate) => {
      directSearchConsoleReads += 1;
      assert.equal(ownerId, "owner-1");
      assert.equal(propertyId, "sc-property-1");
      assert.match(startDate, /^\d{4}-\d{2}-\d{2}$/);
      assert.match(endDate, /^\d{4}-\d{2}-\d{2}$/);
      return [{ query: "roof repair", clicks: "8", impressions: "120", ctr: "0.066", position: "4.2" }];
    } }, new Date());
    const updated = db.workspace.tasks.find((item) => item.id === taskId);
    assert.equal(taskContext.searchConsole.status, "connected");
    assert.equal(taskContext.searchConsole.source, "Google Search Console API · read-only");
    assert.equal(taskContext.searchConsole.topQueries[0].name, "roof repair");
    assert.equal(directSearchConsoleReads, 1, "scheduled SEO tasks use the direct Search Console connection when available");
    assert.equal(taskContext.googleAnalytics.status, "connected");
    assert.equal(taskContext.googleAnalytics.totals.conversions, 2);
    assert.match(taskContext.googleAnalytics.note, /not independently verified CRM leads/i);
    assert.equal(updated.aiRunState, "completed");
  } finally {
    globalThis.fetch = originalFetch;
    await isolated.dispose();
  }
});

test("a pending approval can retry for linked evidence without duplicating its saved Ads change", async () => {
  const taskId = "blocked-approval-retry-test";
  const taskInstructions = "Review the keyword evidence and finish the conversion check.";
  const dueAt = new Date(Date.now() - 60_000).toISOString();
  const existingApproval = { id: "approval-existing", checklistIndex: 1, title: "Add exact keyword painting in dublin", actionType: "ADD_KEYWORD", campaignId: "camp-1", campaignName: "Test campaign", adGroupId: "group-1", adGroupName: "Ad group 1", keyword: "painting in dublin", matchType: "EXACT", rationale: "Existing evidence-backed proposal.", evidence: "Original supporting evidence.", pendingChangeId: "pending-existing", status: "pending" };
  const task = { id: taskId, clientId: "client-1", title: "Retry blocked approval evidence", service: "Google Ads", aiMode: "Google Ads", status: "To do", assigneeId: "f2b-ai-agent", createdById: "owner-1", aiRunState: "scheduled", aiRunAttempt: 2, dueAt, due: dueAt.slice(0, 10), campaignId: "camp-1", campaignName: "Test campaign", aiInstructions: taskInstructions, aiApprovals: [existingApproval], checklist: [{ id: "step-1", text: "Review keyword evidence", done: true, evidence: "Previously checked." }, { id: "step-2", text: "Confirm conversion tracking", done: false }] };
  const db = new FakeD1({ ownerId: "owner-1", staff: [{ id: "owner-1", name: "Owner", role: "Owner", email: "owner@example.test" }, { id: "f2b-ai-agent", name: "Connors", isBot: true }], clients: [{ id: "client-1", name: "Test Client", googleAdsAccountId: "1234567890", services: [] }], tasks: [task], entries: [], activity: [] });
  db.pendingChanges.push(["pending-existing"]);
  const retry = makeOpenAiResult({ allStepsDone: false, withApproval: true });
  retry.checklist_results = [{ index: 0, completed: false, evidence: "No new keyword evidence needed on this step." }, { index: 1, completed: true, evidence: "Conversion tracking is active and recorded." }];
  retry.approval_items[0].checklist_index = 1;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("api.openai.com/v1/responses")) return Response.json({ output_text: JSON.stringify(retry) });
    throw new Error(`Unexpected network request in isolated test: ${url}`);
  };
  const isolated = await loadIsolatedWorker();
  try {
    await isolated.worker.processDueAiTasks({ DB: db, OPENAI_API_KEY: "mock-key", GOOGLE_ADS_CLIENT_ID: "mock", GOOGLE_ADS_CLIENT_SECRET: "mock", GOOGLE_ADS_TOKEN_ENCRYPTION_KEY: "mock" }, new Date());
    const updated = db.workspace.tasks.find((item) => item.id === taskId);
    assert.equal(updated.aiRunState, "needs_review");
    assert.equal(updated.aiApprovals.length, 1, "the existing approval remains a single queue item");
    assert.equal(updated.aiApprovals[0].id, "approval-existing");
    assert.equal(updated.aiApprovals[0].pendingChangeId, "pending-existing");
    assert.equal(updated.aiApprovals[0].checklistIndex, 1);
    assert.equal(approvalEvidenceBlockReason(updated.aiApprovals[0], updated.checklist), "", "the newly verified linked step unlocks that specific approval");
    assert.equal(db.pendingChanges.length, 1, "the retry must not create a second Ads pending-change record");
    assert.equal(canCloseAiTask(updated.checklist, updated.aiApprovals), false, "the other incomplete checklist step keeps the task Pending");
  } finally {
    globalThis.fetch = originalFetch;
    await isolated.dispose();
  }
});

test("a retry requested from Pending stays Pending until the worker claims it, then records Doing", async () => {
  const taskId = "pending-retry-queue-test";
  const requestedAt = new Date(Date.now() - 60_000).toISOString();
  const task = { id: taskId, clientId: "client-1", title: "Retry pending checklist work", service: "Google Ads", aiMode: "Google Ads", status: "Blocked", assigneeId: "f2b-ai-agent", createdById: "owner-1", aiRunState: "needs_review", aiRunAttempt: 3, aiStartNowRequestedAt: requestedAt, dueAt: requestedAt, due: requestedAt.slice(0, 10), campaignId: "camp-1", campaignName: "Test campaign", aiInstructions: "Recheck the keyword evidence and conversion setup.", checklist: [{ id: "step-1", text: "Review keyword evidence", done: false }, { id: "step-2", text: "Confirm conversion tracking", done: false }] };
  const db = new FakeD1({ ownerId: "owner-1", staff: [{ id: "owner-1", name: "Owner", role: "Owner", email: "owner@example.test" }, { id: "f2b-ai-agent", name: "Connors", isBot: true }], clients: [{ id: "client-1", name: "Test Client", googleAdsAccountId: "1234567890", services: [] }], tasks: [task], entries: [], activity: [] });
  const retryResult = makeOpenAiResult({ allStepsDone: false, withApproval: false });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("api.openai.com/v1/responses")) return Response.json({ output_text: JSON.stringify(retryResult) });
    throw new Error(`Unexpected network request in isolated test: ${url}`);
  };
  const isolated = await loadIsolatedWorker();
  try {
    await isolated.worker.processDueAiTasks({ DB: db, OPENAI_API_KEY: "mock-key", GOOGLE_ADS_CLIENT_ID: "mock", GOOGLE_ADS_CLIENT_SECRET: "mock", GOOGLE_ADS_TOKEN_ENCRYPTION_KEY: "mock" }, new Date());
    const updated = db.workspace.tasks.find((item) => item.id === taskId);
    assert.equal(updated.aiRunState, "needs_review", "the retry can return to Pending only after Connors actually runs and reports remaining evidence");
    assert.equal(updated.aiStartNowRequestedAt, undefined, "claiming the retry clears the queue marker");
    assert.equal(updated.aiRunAttempt, 3, "the queued retry uses the attempt number recorded on the card");
    assert.equal(db.workspace.activity.some((event) => event.title === "AI task started" && event.taskId === taskId), true, "the run must be claimed and recorded as Doing before its result returns");
    assert.equal(db.runs.size, 1, "the pending retry is claimed exactly once");
  } finally {
    globalThis.fetch = originalFetch;
    await isolated.dispose();
  }
});

async function runSitesDraftTask({ wordpressReadbackFails = false, seoFieldExposed = true, reviseExistingPage = false, sourcePageReadbackFails = false } = {}) {
  const taskId = "sites-draft-metadata-test";
  const dueAt = new Date(Date.now() - 60_000).toISOString();
  const sitePagePlan = { purpose: "Paid Ads", campaignPlatform: "Google Ads", campaignId: "campaign-1", campaignName: "Roof Repairs Search", service: "Roof repairs", targetLocation: "Galway", conversionGoal: "Quote request", templateStyle: "local-service" };
  const task = { id: taskId, clientId: "client-1", title: reviseExistingPage ? "Revise Roof Repairs as a draft" : "Roof repair landing page · Galway", service: "Sites", aiMode: "Sites", status: "To do", assigneeId: "f2b-ai-agent", createdById: "owner-1", aiRunState: "scheduled", aiRunAttempt: 1, dueAt, due: dueAt.slice(0, 10), notes: "Create a paid landing page for roof repairs in Galway.", sitePagePlan: reviseExistingPage ? { ...sitePagePlan, sourcePageId: 7 } : sitePagePlan, checklist: reviseExistingPage ? [{ id: "step-1", text: "Read the exact source page 7 on example.test", done: false }, { id: "step-2", text: "Prepare a revised page using the source page content and preserve supported facts", done: false }, { id: "step-3", text: "Save a separate WordPress draft; do not change or publish the source page", done: false }, { id: "step-4", text: "Verify the new draft by reading it back from WordPress and return its link", done: false }] : [{ id: "step-1", text: "Create a new WordPress draft and do not publish it", done: false }, { id: "step-2", text: "Return the draft URL and verify the saved draft details", done: false }, { id: "step-3", text: "Save the SEO meta description to WordPress", done: false }] };
  const db = new FakeD1({ ownerId: "owner-1", staff: [{ id: "owner-1", name: "Owner", role: "Owner", email: "owner@example.test" }, { id: "f2b-ai-agent", name: "Connors", isBot: true }], clients: [{ id: "client-1", name: "Test Client", wordpressSiteUrl: "https://example.test", services: [] }], tasks: [task], entries: [], activity: [] });
  db.wordpressConnection = { site_url: "https://example.test", username: "wpuser", encrypted_app_password: "encrypted", token_iv: "iv" };
  const page = { pageTitle: "Roof Repairs in Galway", suggestedSlug: "roof-repairs-galway", metaDescription: "Roof repair services in Galway. Request a quote from our team.", design: {}, hero: { heading: "Roof repairs in Galway", subheading: "Request a quote", buttonText: "Get a quote" }, sections: [{ heading: "Roof repair services", paragraphs: ["Contact our team about roof repairs."] }], cta: { heading: "Request a quote", body: "Tell us about your roof repair.", buttonText: "Contact our team" }, summary: "Created a focused roof repair page draft.", checklist_results: [{ index: 0, completed: true, evidence: "The page is saved as a new unpublished WordPress draft." }, { index: 1, completed: true, evidence: "The draft URL and page details are available." }, { index: 2, completed: true, evidence: "The search snippet description was saved and confirmed." }] };
  if (reviseExistingPage) page.checklist_results = task.checklist.map((step, index) => ({ index, completed: true, evidence: `Verified ${step.text}.` }));
  const originalFetch = globalThis.fetch;
  const sourceContent = "<!-- wp:paragraph --><p>Current published roof repair page.</p><!-- /wp:paragraph -->";
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).includes("api.openai.com/v1/responses")) return Response.json({ output_text: JSON.stringify(page) });
    throw new Error(`Unexpected network request in isolated Sites test: ${url}`);
  };
  const isolated = await loadIsolatedWorker({ wordpressReadbackFails, seoFieldExposed, sourcePageReadbackFails, reviseExistingPage, sourceContent });
  try {
    await isolated.worker.processDueAiTasks({ DB: db, OPENAI_API_KEY: "mock-key", GOOGLE_ADS_TOKEN_ENCRYPTION_KEY: "mock-encryption-key" }, new Date());
    return db.workspace;
  } finally {
    globalThis.fetch = originalFetch;
    await isolated.dispose();
  }
}

test("Sites AI drafts retain campaign classification in the client inventory and require WordPress read-back", async () => {
  const verifiedWorkspace = await runSitesDraftTask();
  const verifiedTask = verifiedWorkspace.tasks[0];
  assert.equal(verifiedTask.aiRunState, "completed");
  assert.equal(verifiedTask.status, "Done");
  assert.equal(verifiedTask.checklist[2].done, true, "SEO description work requires WordPress field write and read-back");
  assert.match(verifiedTask.aiFeedback, /SEO description: saved to WordPress and confirmed by read-back/i);
  assert.equal(verifiedTask.wordpressDraftUrl, "https://example.test/roof-repairs-galway/");
  assert.deepEqual(verifiedWorkspace.sitePageMetadata?.[0], { purpose: "Paid Ads", campaignPlatform: "Google Ads", campaignId: "campaign-1", campaignName: "Roof Repairs Search", service: "Roof repairs", targetLocation: "Galway", conversionGoal: "Quote request", templateStyle: "local-service", clientId: "client-1", pageId: 42, updatedAt: verifiedTask.aiRunAt });

  const unverifiedWorkspace = await runSitesDraftTask({ wordpressReadbackFails: true });
  const unverifiedTask = unverifiedWorkspace.tasks[0];
  assert.equal(unverifiedTask.aiRunState, "needs_review", "a saved but unreadable draft must not be marked complete");
  assert.equal(unverifiedTask.status, "Blocked");
  assert.equal(unverifiedTask.checklist[0].done, false, "WordPress draft checklist work requires successful read-back");
  assert.match(unverifiedTask.aiFeedback, /read-back verification failed/i);
  assert.equal(unverifiedWorkspace.sitePageMetadata?.[0].pageId, 42, "the draft still appears in Sites so the owner can inspect it");

  const noSeoFieldWorkspace = await runSitesDraftTask({ seoFieldExposed: false });
  const noSeoFieldTask = noSeoFieldWorkspace.tasks[0];
  assert.equal(noSeoFieldTask.aiRunState, "needs_review", "an SEO checklist item cannot complete without a writable WordPress field");
  assert.equal(noSeoFieldTask.checklist[2].done, false);
  assert.match(noSeoFieldTask.checklist[2].evidence, /did not expose a writable SEO description field/i);
  assert.match(noSeoFieldTask.aiFeedback, /suggestion is recorded in the task report, but was not saved/i);
});

test("Sites AI revises one selected published WordPress page into a separate verified draft without changing its source", async () => {
  const workspace = await runSitesDraftTask({ reviseExistingPage: true });
  const task = workspace.tasks[0];
  assert.equal(task.aiRunState, "completed");
  assert.equal(task.status, "Done");
  assert.match(task.wordpressDraftUrl, /roof-repairs-revision-sitesdra/);
  assert.match(task.aiFeedback, /Source page: Roof Repairs · https:\/\/example\.test\/roof-repairs\/ · original confirmed unchanged/);
  assert.equal(task.checklist.every((step) => step.done), true);
  assert.equal(workspace.sitePageMetadata[0].pageId, 42);
  assert.equal(Object.hasOwn(workspace.sitePageMetadata[0], "sourcePageId"), false);

  const workspaceWithUnreadableSource = await runSitesDraftTask({ reviseExistingPage: true, sourcePageReadbackFails: true });
  const blockedTask = workspaceWithUnreadableSource.tasks[0];
  assert.equal(blockedTask.aiRunState, "needs_review");
  assert.equal(blockedTask.status, "Blocked");
  assert.equal(blockedTask.checklist[2].done, false, "the task cannot claim the original remained unchanged when its read-back fails");
});
