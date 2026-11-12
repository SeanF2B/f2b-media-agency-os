export function googleAdsAssetQueries(campaignId, dateWindow) {
  const suppliedCampaignId = campaignId == null ? "" : String(campaignId);
  const cleanCampaignId = suppliedCampaignId.replace(/-/g, "");
  if (campaignId != null && (!/^[\d-]+$/.test(suppliedCampaignId) || !/^\d{3,20}$/.test(cleanCampaignId))) throw new Error("The Google Ads campaign ID is not valid.");
  const campaignWhere = cleanCampaignId ? `campaign.id = ${cleanCampaignId}` : "campaign.status != 'REMOVED'";
  const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if (dateWindow && (!validDate(dateWindow.start) || !validDate(dateWindow.end) || dateWindow.start > dateWindow.end)) throw new Error("The selected Google Ads asset date range is invalid.");
  const metricFields = ", metrics.impressions, metrics.clicks, metrics.ctr, metrics.cost_micros, metrics.conversions, metrics.conversions_value";
  const dateClause = dateWindow ? ` AND segments.date BETWEEN '${dateWindow.start}' AND '${dateWindow.end}'` : "";
  return {
    campaign: `SELECT campaign.id, campaign.name, campaign_asset.asset, campaign_asset.field_type, campaign_asset.status, asset.id, asset.name, asset.type, asset.source, asset.final_urls, asset.text_asset.text, asset.sitelink_asset.link_text, asset.sitelink_asset.description1, asset.sitelink_asset.description2, asset.callout_asset.callout_text, asset.structured_snippet_asset.header, asset.structured_snippet_asset.values, asset.call_asset.phone_number, asset.call_asset.country_code, asset.image_asset.full_size.url, asset.business_name_asset.business_name, asset.call_to_action_asset.call_to_action, asset.promotion_asset.promotion_target, asset.price_asset.type, asset.price_asset.price_offerings, asset.lead_form_asset.business_name, asset.lead_form_asset.headline, asset.lead_form_asset.description, asset.lead_form_asset.privacy_policy_url, asset.mobile_app_asset.app_id, asset.mobile_app_asset.app_store, asset.mobile_app_asset.link_text, asset.app_deep_link_asset.app_deep_link_uri, asset.hotel_callout_asset.text, asset.hotel_property_asset.hotel_name, asset.youtube_video_asset.youtube_video_id${metricFields} FROM campaign_asset WHERE ${campaignWhere} AND campaign_asset.status != 'REMOVED'${dateClause} ORDER BY campaign.name, campaign_asset.field_type LIMIT 10000`,
    adGroup: `SELECT campaign.id, campaign.name, ad_group.id, ad_group.name, ad_group_asset.asset, ad_group_asset.field_type, ad_group_asset.status, asset.id, asset.name, asset.type, asset.source, asset.final_urls, asset.text_asset.text, asset.sitelink_asset.link_text, asset.sitelink_asset.description1, asset.sitelink_asset.description2, asset.callout_asset.callout_text, asset.structured_snippet_asset.header, asset.structured_snippet_asset.values, asset.call_asset.phone_number, asset.call_asset.country_code, asset.image_asset.full_size.url, asset.business_name_asset.business_name, asset.call_to_action_asset.call_to_action, asset.promotion_asset.promotion_target, asset.price_asset.type, asset.price_asset.price_offerings, asset.lead_form_asset.business_name, asset.lead_form_asset.headline, asset.lead_form_asset.description, asset.lead_form_asset.privacy_policy_url, asset.mobile_app_asset.app_id, asset.mobile_app_asset.app_store, asset.mobile_app_asset.link_text, asset.app_deep_link_asset.app_deep_link_uri, asset.hotel_callout_asset.text, asset.hotel_property_asset.hotel_name, asset.youtube_video_asset.youtube_video_id${metricFields} FROM ad_group_asset WHERE ${campaignWhere} AND ad_group_asset.status != 'REMOVED'${dateClause} ORDER BY campaign.name, ad_group.name, ad_group_asset.field_type LIMIT 10000`,
    customer: `SELECT customer_asset.asset, customer_asset.field_type, customer_asset.status, asset.id, asset.name, asset.type, asset.source, asset.final_urls, asset.text_asset.text, asset.sitelink_asset.link_text, asset.sitelink_asset.description1, asset.sitelink_asset.description2, asset.callout_asset.callout_text, asset.structured_snippet_asset.header, asset.structured_snippet_asset.values, asset.call_asset.phone_number, asset.call_asset.country_code, asset.image_asset.full_size.url, asset.business_name_asset.business_name, asset.call_to_action_asset.call_to_action, asset.promotion_asset.promotion_target, asset.price_asset.type, asset.price_asset.price_offerings, asset.lead_form_asset.business_name, asset.lead_form_asset.headline, asset.lead_form_asset.description, asset.lead_form_asset.privacy_policy_url, asset.mobile_app_asset.app_id, asset.mobile_app_asset.app_store, asset.mobile_app_asset.link_text, asset.app_deep_link_asset.app_deep_link_uri, asset.hotel_callout_asset.text, asset.hotel_property_asset.hotel_name, asset.youtube_video_asset.youtube_video_id${metricFields} FROM customer_asset WHERE customer_asset.status != 'REMOVED'${dateClause} ORDER BY customer_asset.field_type LIMIT 10000`,
    assetGroup: `SELECT campaign.id, campaign.name, asset_group.id, asset_group.name, asset_group_asset.asset, asset_group_asset.field_type, asset_group_asset.status, asset_group_asset.performance_label, asset.id, asset.name, asset.type, asset.source, asset.final_urls, asset.text_asset.text, asset.sitelink_asset.link_text, asset.sitelink_asset.description1, asset.sitelink_asset.description2, asset.callout_asset.callout_text, asset.structured_snippet_asset.header, asset.structured_snippet_asset.values, asset.call_asset.phone_number, asset.call_asset.country_code, asset.image_asset.full_size.url, asset.business_name_asset.business_name, asset.call_to_action_asset.call_to_action, asset.promotion_asset.promotion_target, asset.price_asset.type, asset.price_asset.price_offerings, asset.lead_form_asset.business_name, asset.lead_form_asset.headline, asset.lead_form_asset.description, asset.lead_form_asset.privacy_policy_url, asset.mobile_app_asset.app_id, asset.mobile_app_asset.app_store, asset.mobile_app_asset.link_text, asset.app_deep_link_asset.app_deep_link_uri, asset.hotel_callout_asset.text, asset.hotel_property_asset.hotel_name, asset.youtube_video_asset.youtube_video_id${metricFields} FROM asset_group_asset WHERE ${campaignWhere} AND asset_group_asset.status != 'REMOVED'${dateClause} ORDER BY campaign.name, asset_group.name, asset_group_asset.field_type LIMIT 10000`,
  };
}

export function normalizeGoogleAdsAssetRows(rows, scope) {
  return rows.flatMap((row) => {
    const asset = row.asset;
    const assetId = String(asset?.id || "");
    if (!assetId) return [];
    const parts = [
      asset?.textAsset?.text,
      asset?.sitelinkAsset?.linkText,
      asset?.sitelinkAsset?.description1,
      asset?.sitelinkAsset?.description2,
      asset?.calloutAsset?.calloutText,
      asset?.structuredSnippetAsset?.header,
      ...(asset?.structuredSnippetAsset?.values || []),
      asset?.callAsset?.phoneNumber,
      asset?.callAsset?.countryCode,
      asset?.businessNameAsset?.businessName,
      asset?.callToActionAsset?.callToAction,
      asset?.promotionAsset?.promotionTarget,
      asset?.priceAsset?.type,
      asset?.leadFormAsset?.businessName,
      asset?.mobileAppAsset?.appId,
      asset?.hotelCalloutAsset?.calloutText,
      asset?.hotelCalloutAsset?.text,
      asset?.hotelPropertyAsset?.hotelName,
      asset?.mobileAppAsset?.appStore,
      asset?.mobileAppAsset?.linkText,
      asset?.appDeepLinkAsset?.appDeepLinkUri,
      asset?.leadFormAsset?.headline,
      asset?.leadFormAsset?.description,
      asset?.leadFormAsset?.privacyPolicyUrl,
      asset?.youtubeVideoAsset?.youtubeVideoId,
      ...(asset?.priceAsset?.priceOfferings || []).map((item) => [item.header, item.description, item.price?.amountMicros ? Number(item.price.amountMicros) / 1_000_000 : "", item.price?.currencyCode, item.unit].filter(Boolean).join(" · ")),
    ].filter((value) => typeof value === "string" && value.trim());
    return [{
      scope,
      campaignId: String(row.campaign?.id || ""),
      campaignName: String(row.campaign?.name || ""),
      adGroupId: String(row.adGroup?.id || ""),
      adGroupName: String(row.adGroup?.name || ""),
      assetId,
      assetName: String(asset.name || ""),
      type: String(asset.type || "UNKNOWN"),
      source: String(asset.source || "UNKNOWN"),
      fieldType: String(row.customerAsset?.fieldType || row.campaignAsset?.fieldType || row.adGroupAsset?.fieldType || row.assetGroupAsset?.fieldType || "UNKNOWN"),
      status: String(row.customerAsset?.status || row.campaignAsset?.status || row.adGroupAsset?.status || row.assetGroupAsset?.status || "UNKNOWN"),
      performanceLabel: String(row.assetGroupAsset?.performanceLabel || ""),
      associationResourceName: String(row.customerAsset?.resourceName || row.campaignAsset?.resourceName || row.adGroupAsset?.resourceName || row.assetGroupAsset?.resourceName || ""),
      impressions: Number(row.metrics?.impressions || 0), clicks: Number(row.metrics?.clicks || 0), ctr: Number(row.metrics?.ctr || 0),
      spend: Number(row.metrics?.costMicros || 0) / 1_000_000, conversions: Number(row.metrics?.conversions || 0), conversionValue: Number(row.metrics?.conversionsValue || 0),
      text: [...new Set(parts.map(String))],
      finalUrls: Array.isArray(asset.finalUrls) ? asset.finalUrls.map(String) : [],
      imageUrl: String(asset.imageAsset?.fullSize?.url || ""),
    }];
  });
}
