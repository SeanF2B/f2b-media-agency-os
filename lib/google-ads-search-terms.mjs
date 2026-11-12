export function googleAdsSearchTermsQuery(dateWindow, campaignId) {
  const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if (dateWindow && (!validDate(dateWindow.startDate) || !validDate(dateWindow.endDate) || dateWindow.startDate > dateWindow.endDate)) throw new Error("The requested Google Ads date range is invalid.");
  const cleanCampaignId = campaignId?.trim();
  if (cleanCampaignId && !/^\d{1,20}$/.test(cleanCampaignId)) throw new Error("The Google Ads campaign ID is not valid.");
  const dateFilter = dateWindow ? `segments.date BETWEEN '${dateWindow.startDate}' AND '${dateWindow.endDate}'` : "segments.date DURING LAST_30_DAYS";
  const campaignFilter = cleanCampaignId ? ` AND campaign.id = ${cleanCampaignId}` : "";
  // campaign_search_term_view includes search terms from Performance Max as well
  // as standard campaigns. Google can still omit low-volume/privacy-protected terms.
  return `SELECT campaign.id, campaign.name, ad_group.id, ad_group.name, campaign_search_term_view.search_term, segments.search_term_match_type, segments.search_term_match_source, segments.search_term_targeting_status, segments.keyword.info.text, segments.keyword.info.match_type, segments.device, segments.ad_network_type, metrics.impressions, metrics.clicks, metrics.ctr, metrics.average_cpc, metrics.cost_micros, metrics.conversions, metrics.conversions_value, metrics.cost_per_conversion FROM campaign_search_term_view WHERE ${dateFilter}${campaignFilter} AND metrics.impressions > 0 ORDER BY metrics.cost_micros DESC LIMIT 500`;
}
