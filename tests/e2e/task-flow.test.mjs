// End-to-end: the real scheduled AI worker (worker/scheduled-ai.ts) and the real task-flow
// rules, against a real SQLite database with every app migration applied. Only the outside
// world is simulated at the network edge: the AI provider (OpenRouter) and the email sender (Resend).
//
// It walks the exact flow Sean asked for:
//   To do (date + frequency) → In progress (only while the AI acts) → Pending (reason +
//   approval email to sean@f2bmedia.com) → Approve with edits → In progress → Done with no
//   further approvals → History.  Reject → Done.  Failures/cancels → Pending.  The next
//   recurring occurrence appears in To do only once the current one has left To do.
//
// Run: node --experimental-transform-types --import ./tests/e2e/register.mjs --test tests/e2e/task-flow.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createD1 } from "./d1-shim.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OWNER = "owner-sean";
const BOT = "f2b-ai-agent-claude";
const DB = createD1(root);
assert.deepEqual(DB.failures, [], "every migration applies");
const env = globalThis.__OUTREACH_TEST_ENV__ = {
  DB,
  OPENROUTER_API_KEY: "sk-or-test",
  RESEND_API_KEY: "re_test",
  TASK_NOTIFICATION_FROM: "F2B OS <tasks@f2bmedia.com>",
  TASK_APP_URL: "https://os.f2bmedia.test/",
};

const { processDueAiTasks } = await import("../../worker/scheduled-ai.ts");
const flow = await import("../../lib/task-flow.ts");
const botIds = new Set([BOT]);

// ---------------------------------------------------------------- workspace
const minutesAgo = (n) => new Date(Date.now() - n * 60_000).toISOString();
const dueDay = (iso) => iso.slice(0, 10);
const firstDue = minutesAgo(5);
const workspace = {
  ownerId: OWNER,
  settings: { currency: "EUR" },
  staff: [
    { id: OWNER, name: "Sean Farrelly", email: "sean@f2bmedia.com", role: "Owner" },
    { id: BOT, name: "Claude", email: "", role: "AI", isBot: true },
  ],
  clients: [{ id: "c-pro", name: "Pro Roofers Galway", status: "Active", services: [] }],
  tasks: [
    { id: "t-post", title: "Weekly Instagram post", clientId: "c-pro", assigneeId: BOT, aiMode: "Research", service: "Research", status: "To do", priority: "Normal", estimate: 1,
      aiRunState: "scheduled", due: dueDay(firstDue), dueAt: firstDue, repeat: "Weekly", repeatTime: "09:00", occurrence: 1, aiInstructions: "Draft this week's Instagram post for Pro Roofers and get it approved before publishing." },
  ],
  notes: [], activity: [], entries: [],
};
DB.sqlite.prepare("INSERT INTO workspace_documents (id, owner_id, data, updated_at) VALUES ('f2b-agency', ?, ?, ?)").run(OWNER, JSON.stringify(workspace), new Date().toISOString());

const readWorkspace = () => JSON.parse(DB.sqlite.prepare("SELECT data FROM workspace_documents WHERE id = 'f2b-agency'").get().data);
const readTask = (id) => readWorkspace().tasks.find((task) => task.id === id);
const writeTask = (task) => {
  const data = readWorkspace();
  data.tasks = data.tasks.map((item) => item.id === task.id ? task : item);
  DB.sqlite.prepare("UPDATE workspace_documents SET data = ?, updated_at = ? WHERE id = 'f2b-agency'").run(JSON.stringify(data), `ui-${Math.random()}`);
};
const addTask = (task) => {
  const data = readWorkspace();
  data.tasks = [...data.tasks, task];
  DB.sqlite.prepare("UPDATE workspace_documents SET data = ?, updated_at = ? WHERE id = 'f2b-agency'").run(JSON.stringify(data), `ui-${Math.random()}`);
};
const series = (seriesId) => readWorkspace().tasks.filter((task) => (task.seriesId || task.id) === seriesId);

// ---------------------------------------------------------------- the outside world
const emails = [];
const aiRequests = [];
let aiReply = null;          // what the AI returns next
let onAiCall = null;         // inspect the board while the AI is "working"
const aiResult = (overrides) => ({
  summary: "Drafted the post.", feedback: "Post drafted.", needs_review: false, suggested_next_step: "",
  checklist_results: [], recommendations: [], approval_items: [], landing_page_recommendations: [],
  action_campaign_id: "", action_type: "none", action_daily_budget: 0, action_ad_group_id: "", action_keyword: "", action_match_type: "EXACT",
  gohighlevel_request: { method: "", path: "", version: "v3", query_json: "", body_json: "" },
  ...overrides,
});
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url);
  if (url.host === "openrouter.ai") {
    const body = JSON.parse(String(init.body));
    aiRequests.push(body);
    if (onAiCall) await onAiCall(body);
    if (aiReply === "fail") return new Response(JSON.stringify({ error: { message: "upstream" } }), { status: 500 });
    return new Response(JSON.stringify({ output_text: JSON.stringify(aiReply) }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (url.host === "api.resend.com") {
    const body = JSON.parse(String(init.body));
    emails.push(body);
    return new Response(JSON.stringify({ id: `email-${emails.length}` }), { status: 200 });
  }
  return new Response("not found", { status: 404 });
};

// ---------------------------------------------------------------- the flow
test("To do shows the scheduled date and frequency", () => {
  const task = readTask("t-post");
  assert.equal(flow.boardColumn(task, botIds), "todo");
  assert.equal(flow.frequencyLabel(task), "Weekly");
  assert.match(flow.scheduleLabel(task), /^\w{3} \d{1,2} \w{3} · \d{2}:\d{2}$/);
  assert.equal(series("t-post").length, 1, "no next occurrence while the current one is still in To do");
});

test("AI run: In progress only while acting, next occurrence appears once it left To do, stops → Pending + approval email", async () => {
  let seenWhileWorking = null;
  onAiCall = () => {
    const task = readTask("t-post");
    seenWhileWorking = { column: flow.boardColumn(task, botIds), status: task.status, next: series("t-post").filter((item) => item.id !== "t-post") };
  };
  aiReply = aiResult({ needs_review: true, summary: "Instagram post drafted and ready to publish.", suggested_next_step: "Approve this caption for publishing: \"Storm season is here — book your free roof check with Pro Roofers Galway today.\"" });
  await processDueAiTasks(env, new Date());

  assert.equal(seenWhileWorking.column, "in_progress", "In progress while the AI is acting");
  assert.equal(seenWhileWorking.status, "In progress");
  assert.equal(seenWhileWorking.next.length, 1, "the next occurrence was added the moment the run started");
  const next = seenWhileWorking.next[0];
  assert.equal(next.status, "To do");
  assert.equal(next.aiRunState, "scheduled");
  assert.equal(next.occurrence, 2);
  assert.ok(Date.parse(next.dueAt) > Date.now(), "next occurrence is scheduled in the future");
  assert.equal(flow.boardColumn(next, botIds), "todo");

  const task = readTask("t-post");
  assert.equal(flow.boardColumn(task, botIds), "pending", "the AI stopped → Pending");
  assert.ok(task.pendingReason, "Pending always carries a reason");
  assert.equal(task.approvalRequest.status, "awaiting");
  assert.equal(task.approvalRequest.to, "sean@f2bmedia.com");
  assert.match(task.approvalRequest.request, /Storm season is here/);
  assert.equal(task.approvalRequest.emailStatus, "sent");
  assert.equal(flow.needsOwnerDecision(task), true, "shows in Approvals");

  assert.equal(emails.length, 1, "exactly one approval email");
  assert.deepEqual(emails[0].to, ["sean@f2bmedia.com"]);
  assert.match(emails[0].subject, /Approval needed · Pro Roofers Galway · Weekly Instagram post/);
  assert.match(emails[0].text, /Storm season is here/);

  // Running the scheduler again must not re-run a Pending task or re-send the email.
  aiRequests.length = 0;
  await processDueAiTasks(env, new Date());
  assert.equal(aiRequests.length, 0, "a Pending task is never re-run by the scheduler");
  assert.equal(readTask("t-post").status, "Blocked");
  assert.equal(emails.length, 1, "no duplicate approval email");
});

test("Owner approves with edits → back to In progress → AI does it → straight to Done, no more approvals", async () => {
  const pending = readTask("t-post");
  const edited = "Storm season is here — book your FREE roof check with Pro Roofers Galway. Call 091 000 000.";
  const { task: approved, error } = flow.approveTask(pending, { at: new Date().toISOString(), by: "Sean Farrelly", editedRequest: edited, note: "Use the photo from the Salthill job.", ai: true });
  assert.equal(error, "");
  writeTask(approved); // exactly what the Approvals screen saves
  assert.equal(flow.boardColumn(readTask("t-post"), botIds), "in_progress", "approved → In progress");
  assert.equal(flow.needsOwnerDecision(readTask("t-post")), false);

  aiRequests.length = 0;
  onAiCall = null;
  // Even if the AI tries to ask for approval again, an approved run must finish.
  aiReply = aiResult({ needs_review: true, summary: "Post published with the approved caption.", suggested_next_step: "Approve again?" });
  await processDueAiTasks(env, new Date());

  const resumed = aiRequests.find((request) => String(request.instructions).includes("OWNER APPROVAL GRANTED"));
  assert.ok(resumed, "the AI was told the owner approved");
  assert.match(resumed.instructions, /FREE roof check/, "the AI received Sean's edited version");
  assert.match(resumed.instructions, /Salthill/, "and Sean's extra instructions");

  const done = readTask("t-post");
  assert.equal(done.status, "Done");
  assert.equal(flow.boardColumn(done, botIds), "done");
  assert.equal(done.outcome, "completed");
  assert.equal(done.approvalRequest.status, "approved");
  assert.equal(done.approvalRequest.editedRequest, edited);
  assert.equal(emails.length, 1, "no second approval request");
  assert.equal(series("t-post").length, 2, "still exactly one upcoming occurrence (no duplicate on completion)");

  const history = flow.historyItems(readWorkspace().tasks);
  assert.equal(history[0].task.id, "t-post", "lands in History");
  assert.equal(history[0].outcome, "completed");
  const actions = done.flowHistory.map((event) => event.action);
  for (const step of ["started", "pending", "approval_requested", "approved", "completed"]) assert.ok(actions.includes(step), `history records ${step}`);
});

test("Owner rejects → Done", async () => {
  addTask({ id: "t-budget", title: "Raise Ads budget", clientId: "c-pro", assigneeId: BOT, aiMode: "Research", service: "Research", status: "To do", priority: "High", estimate: 1, aiRunState: "scheduled", due: dueDay(minutesAgo(2)), dueAt: minutesAgo(2), repeat: "None", occurrence: 1 });
  aiReply = aiResult({ needs_review: true, summary: "Budget is limiting impressions.", suggested_next_step: "Raise the daily budget from €20 to €30." });
  await processDueAiTasks(env, new Date());
  const pending = readTask("t-budget");
  assert.equal(flow.boardColumn(pending, botIds), "pending");
  assert.equal(emails.length, 2);
  assert.equal(series("t-budget").length, 1, "one-off tasks never repeat");

  const { task: rejected } = flow.rejectTask(pending, { at: new Date().toISOString(), by: "Sean Farrelly", note: "Not this month." });
  writeTask(rejected);
  const done = readTask("t-budget");
  assert.equal(flow.boardColumn(done, botIds), "done");
  assert.equal(done.outcome, "rejected");
  assert.equal(flow.historyItems(readWorkspace().tasks).find((item) => item.task.id === "t-budget").outcome, "rejected");
  await processDueAiTasks(env, new Date());
  assert.equal(readTask("t-budget").status, "Done", "a rejected task is never picked up again");
});

test("A failed AI run → Pending with the reason and an approval email", async () => {
  addTask({ id: "t-audit", title: "Monthly SEO check", clientId: "c-pro", assigneeId: BOT, aiMode: "Research", service: "Research", status: "To do", priority: "Normal", estimate: 1, aiRunState: "scheduled", due: dueDay(minutesAgo(1)), dueAt: minutesAgo(1), repeat: "Monthly", occurrence: 1 });
  aiReply = "fail";
  await processDueAiTasks(env, new Date());
  const task = readTask("t-audit");
  assert.equal(flow.boardColumn(task, botIds), "pending");
  assert.ok(task.pendingReason.length > 0);
  assert.equal(task.approvalRequest.status, "awaiting");
  assert.equal(emails.length, 3);
  assert.match(emails[2].text, /Monthly SEO check/);
  const next = series("t-audit").filter((item) => item.id !== "t-audit");
  assert.equal(next.length, 1, "the next monthly run is already waiting in To do");
  assert.equal(next[0].status, "To do");
});

test("A clean AI run goes straight to Done with no approval", async () => {
  addTask({ id: "t-report", title: "Weekly lead summary", clientId: "c-pro", assigneeId: BOT, aiMode: "Research", service: "Research", status: "To do", priority: "Normal", estimate: 1, aiRunState: "scheduled", due: dueDay(minutesAgo(1)), dueAt: minutesAgo(1), repeat: "None", occurrence: 1,
    attachments: [{ id: "f-1", name: "Lead summary.pdf", type: "application/pdf", size: 2048, uploadedAt: minutesAgo(1), uploadedBy: "Claude" }] });
  aiReply = aiResult({ needs_review: false, summary: "Summary sent." });
  await processDueAiTasks(env, new Date());
  const task = readTask("t-report");
  assert.equal(task.status, "Done");
  assert.equal(task.approvalRequest, undefined);
  assert.equal(emails.length, 3, "no approval email for a clean finish");
  const item = flow.historyItems(readWorkspace().tasks).find((entry) => entry.task.id === "t-report");
  assert.equal(item.files[0].name, "Lead summary.pdf", "files show in History");
});

test("History: edit and send back to the AI → In progress → Done", async () => {
  const done = readTask("t-report");
  const { task: sentBack } = flow.sendBackFromHistory(done, { at: new Date().toISOString(), by: "Sean Farrelly", editedRequest: "Add the call-tracking numbers too.", ai: true });
  writeTask(sentBack);
  assert.equal(flow.boardColumn(readTask("t-report"), botIds), "in_progress");
  aiRequests.length = 0;
  aiReply = aiResult({ needs_review: true, summary: "Updated with call tracking." });
  await processDueAiTasks(env, new Date());
  assert.match(aiRequests[0].instructions, /call-tracking numbers/);
  assert.equal(readTask("t-report").status, "Done");
  assert.equal(emails.length, 3);
});
