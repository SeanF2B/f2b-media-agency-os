// How Outreach writes into the existing CRM without duplicating anything.
// Pure decisions; the route layer runs the SQL these describe.
//   contacts      → crm_contacts (matched on owner + lower(email) + client scope)
//   conversations → conv_threads (channel 'email', our_number = mailbox, contact = prospect)
//   opportunities → crm_opportunities with source_submission_id = 'outreach:<contact_id>'
//                   (uniquely indexed, so a second positive reply can never create a second deal)

export const OPPORTUNITY_SOURCE = "Outreach";
export const opportunityKey = (contactId) => `outreach:${contactId}`;
export const emailThreadKey = ({ mailbox, prospect }) => ({ channel: "email", ourNumber: String(mailbox).toLowerCase(), contact: String(prospect).toLowerCase() });

/** Pick the CRM contact to use: same client scope first, then an unscoped one. */
export function matchContact(candidates, { email, clientId = null }) {
  const target = String(email || "").toLowerCase();
  const sameEmail = (candidates || []).filter((contact) => String(contact.email || "").toLowerCase() === target);
  return sameEmail.find((contact) => (contact.client_id || null) === (clientId || null)) || sameEmail.find((contact) => !contact.client_id) || null;
}

/** Fill blanks on an existing contact; never overwrite data someone typed in. */
export function contactPatch(existing, incoming) {
  const patch = {};
  for (const field of ["first_name", "last_name", "company", "phone"]) if (!String(existing[field] || "").trim() && String(incoming[field] || "").trim()) patch[field] = String(incoming[field]).trim();
  return patch;
}

/**
 * What to do with the pipeline when a reply is classified as positive.
 * @param {object} p
 * @param {{id:string, stage_id:string, stage_category:"open"|"won"|"lost", stage_position:number}|null} p.existing
 * @param {{pipelineId:string, stageId:string, stagePosition:number}} p.target   the campaign's chosen stage
 */
export function planPositiveReplyOpportunity({ existing, target, contactId, contactName, company, campaignName }) {
  if (!existing) {
    return { op: "create", values: { pipeline_id: target.pipelineId, stage_id: target.stageId, contact_id: contactId, title: `${company || contactName || "Prospect"} · Outreach reply`, source: OPPORTUNITY_SOURCE, source_submission_id: opportunityKey(contactId), notes: `Positive reply to "${campaignName}".` } };
  }
  if (existing.stage_category !== "open") return { op: "none", reason: `Deal is already ${existing.stage_category}; left unchanged.` };
  if (existing.stage_position >= target.stagePosition) return { op: "touch", reason: "Deal is already at or past the reply stage." };
  return { op: "move", values: { stage_id: target.stageId }, reason: "Moved forward to the reply stage." };
}
