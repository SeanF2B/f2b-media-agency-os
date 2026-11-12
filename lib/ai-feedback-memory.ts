type FeedbackApproval = {
  title?: string;
  campaignId?: string;
  campaignName?: string;
  feedback?: string;
  feedbackUpdatedAt?: string;
  status?: string;
};

type FeedbackTask = {
  id?: string;
  clientId?: string;
  title?: string;
  campaignId?: string;
  campaignName?: string;
  aiRunAt?: string;
  dueAt?: string;
  aiApprovals?: FeedbackApproval[];
  aiRecommendations?: Array<{ id?: string; title?: string; ownerFeedback?: string; ownerFeedbackChoices?: string[]; ownerFeedbackUpdatedAt?: string; rejectedAt?: string }>;
  aiLandingPageRecommendations?: Array<{ id?: string; section?: string; ownerFeedback?: string; ownerFeedbackChoices?: string[]; ownerFeedbackUpdatedAt?: string; rejectedAt?: string }>;
};

/** Return recent owner feedback for this client, scoped to the selected campaign when provided. */
export function getAiCampaignFeedbackMemory(
  tasks: FeedbackTask[],
  clientId: string,
  campaignId = "",
  campaignName = "",
) {
  const wantedName = campaignName.trim().toLocaleLowerCase();
  return tasks.flatMap((task) => {
    if (task.clientId !== clientId) return [];
    const approvalFeedback = (task.aiApprovals || []).flatMap((approval) => {
      const feedback = String(approval.feedback || "").trim().slice(0, 1200);
      if (!feedback) return [];
      const savedCampaignId = String(approval.campaignId || task.campaignId || "");
      const savedCampaignName = String(approval.campaignName || task.campaignName || "").trim();
      if (campaignId) {
        if (savedCampaignId ? savedCampaignId !== campaignId : !wantedName || savedCampaignName.toLocaleLowerCase() !== wantedName) return [];
      } else if (savedCampaignId || savedCampaignName) {
        // "All campaigns" is not a campaign identity. Never leak a campaign-specific preference into it.
        return [];
      }
      return [{
        clientId,
        campaignId: savedCampaignId,
        campaignName: savedCampaignName || (savedCampaignId ? `Campaign ${savedCampaignId}` : "All campaigns"),
        taskTitle: String(task.title || "Previous AI task").slice(0, 180),
        recommendation: String(approval.title || "Previous recommendation").slice(0, 240),
        feedback,
        outcome: String(approval.status || "pending"),
        savedAt: approval.feedbackUpdatedAt || task.aiRunAt || task.dueAt || "",
      }];
    });
    const recommendationFeedback = [
      ...(task.aiRecommendations || []).map((recommendation) => ({ title: recommendation.title, feedback: recommendation.ownerFeedback, choices: recommendation.ownerFeedbackChoices, feedbackUpdatedAt: recommendation.ownerFeedbackUpdatedAt, rejected: Boolean(recommendation.rejectedAt) })),
      ...(task.aiLandingPageRecommendations || []).map((recommendation) => ({ title: recommendation.section, feedback: recommendation.ownerFeedback, choices: recommendation.ownerFeedbackChoices, feedbackUpdatedAt: recommendation.ownerFeedbackUpdatedAt, rejected: Boolean(recommendation.rejectedAt) })),
    ].flatMap((recommendation) => {
      const feedback = [String(recommendation.feedback || "").trim(), ...(recommendation.choices || [])].filter(Boolean).join("; ").slice(0, 1200);
      if (!feedback) return [];
      const savedCampaignId = String(task.campaignId || "");
      const savedCampaignName = String(task.campaignName || "").trim();
      if (campaignId) {
        if (savedCampaignId ? savedCampaignId !== campaignId : !wantedName || savedCampaignName.toLocaleLowerCase() !== wantedName) return [];
      } else if (savedCampaignId || savedCampaignName) {
        // Feedback attached to a campaign must never become an account-wide preference.
        return [];
      }
      return [{
        clientId,
        campaignId: savedCampaignId,
        campaignName: savedCampaignName || (savedCampaignId ? `Campaign ${savedCampaignId}` : "All campaigns"),
        taskTitle: String(task.title || "Previous AI task").slice(0, 180),
        recommendation: String(recommendation.title || "Previous recommendation").slice(0, 240),
        feedback,
        outcome: recommendation.rejected ? "rejected" : "refined",
        savedAt: recommendation.feedbackUpdatedAt || task.aiRunAt || task.dueAt || "",
      }];
    });
    return [...approvalFeedback, ...recommendationFeedback];
  })
    .sort((a, b) => Date.parse(a.savedAt || "") - Date.parse(b.savedAt || ""))
    .slice(-12);
}
