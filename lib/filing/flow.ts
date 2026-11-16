// Step logic for the "Get ready for filing" pop-up, kept pure so every path can be tested without a browser.
import type { FilingReturn, ReceiptCheckResult } from "./model.ts";

export type FlowStep = "start" | "scanning" | "email_disconnected" | "scan_results" | "review";
export type FlowState = { step: FlowStep; confirmOpen: boolean; ret: FilingReturn | null; justOpened: boolean };
export type FlowEvent =
  | { type: "CHECK_RECEIPTS"; draft: FilingReturn }
  | { type: "SKIP_CHECK"; draft: FilingReturn }
  | { type: "SCAN_DISCONNECTED" }
  | { type: "SCAN_DONE"; result: ReceiptCheckResult }
  | { type: "SCAN_FAILED" }
  | { type: "CONTINUE_WITHOUT_SCAN" }
  | { type: "CONTINUE_TO_REVIEW" }
  | { type: "RESUME"; ret: FilingReturn }
  | { type: "SAVED"; ret: FilingReturn }
  | { type: "RESOLVE"; issueId: string; resolved: boolean }
  | { type: "OPEN_CONFIRM" }
  | { type: "BACK_TO_REVIEW" }
  | { type: "FILING_OPENED"; ret: FilingReturn }
  | { type: "ACKNOWLEDGED"; ret: FilingReturn }
  | { type: "RESTART" };

export const initialFlow: FlowState = { step: "start", confirmOpen: false, ret: null, justOpened: false };

export function flowReducer(state: FlowState, event: FlowEvent): FlowState {
  switch (event.type) {
    case "CHECK_RECEIPTS": return { ...state, step: "scanning", ret: event.draft, confirmOpen: false };
    case "SKIP_CHECK": return { ...state, step: "review", ret: { ...event.draft, receiptCheck: { state: "skipped", skippedReason: "You chose to continue without checking receipts." } }, confirmOpen: false };
    case "SCAN_DISCONNECTED": return state.step === "scanning" ? { ...state, step: "email_disconnected" } : state;
    case "SCAN_FAILED": return state.step === "scanning" ? { ...state, step: "start" } : state;
    case "SCAN_DONE": return state.step === "scanning" && state.ret ? { ...state, step: "scan_results", ret: { ...state.ret, receiptCheck: { state: "checked", result: event.result }, resolvedIssueIds: [] } } : state;
    case "CONTINUE_WITHOUT_SCAN": return state.ret ? { ...state, step: "review", ret: { ...state.ret, receiptCheck: { state: "skipped", skippedReason: "Email isn't connected, so receipts weren't checked." } } } : state;
    case "CONTINUE_TO_REVIEW": return state.ret ? { ...state, step: "review" } : state;
    case "RESUME": return { step: "review", confirmOpen: false, ret: event.ret, justOpened: false };
    case "SAVED": return state.ret && state.ret.id === event.ret.id ? { ...state, ret: { ...state.ret, status: event.ret.status, acknowledgement: event.ret.acknowledgement, openedFilingAt: event.ret.openedFilingAt, createdAt: event.ret.createdAt, updatedAt: event.ret.updatedAt } } : state;
    case "RESOLVE": { if (!state.ret) return state; const ids = new Set(state.ret.resolvedIssueIds); if (event.resolved) ids.add(event.issueId); else ids.delete(event.issueId); return { ...state, ret: { ...state.ret, resolvedIssueIds: [...ids] } }; }
    case "OPEN_CONFIRM": return state.step === "review" && state.ret && state.ret.status !== "filed" ? { ...state, confirmOpen: true } : state;
    case "BACK_TO_REVIEW": return { ...state, step: state.ret ? "review" : state.step, confirmOpen: false };
    // Opening the filing service never changes the return's status: keep everything except the open log.
    case "FILING_OPENED": return state.ret ? { ...state, confirmOpen: false, step: "review", justOpened: true, ret: { ...state.ret, openedFilingAt: event.ret.openedFilingAt, updatedAt: event.ret.updatedAt } } : state;
    case "ACKNOWLEDGED": return { ...state, ret: event.ret, justOpened: false, confirmOpen: false };
    case "RESTART": return initialFlow;
  }
}
