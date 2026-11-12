export const GOOGLE_ADS_APPROVAL_NEVER_EXPIRES_AT = "9999-12-31T23:59:59.999Z";

/** Approval validity is governed by its saved decision state, never by a time limit. */
export function canDecideGoogleAdsApproval(status: string): boolean {
  return status === "pending";
}
