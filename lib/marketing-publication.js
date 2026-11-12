/** @param {{status: string, nextData: string, existingPublishedData?: string | null, unpublish?: boolean}} input
 * @returns {{status: string, publishedData: string | null}}
 */
export function resolveMarketingPublication({ status, nextData, existingPublishedData = null, unpublish = false }) {
  if (unpublish) return { status: "draft", publishedData: null };
  return {
    status,
    publishedData: status === "published" ? nextData : existingPublishedData,
  };
}
