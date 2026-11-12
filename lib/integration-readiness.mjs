export function integrationReadiness({ sourceConfigured, mappedCount = 0, directConfigured = false, readOnlyFallback = false }) {
  if (directConfigured) return "ready";
  if (readOnlyFallback && sourceConfigured) return "partial";
  if (sourceConfigured && mappedCount > 0) return "ready";
  return sourceConfigured ? "partial" : "needs_setup";
}

export function gohighlevelSetupConfigured({ clientId, clientSecret, appId, redirectUri, encryptionKey }) {
  return Boolean(clientId && clientSecret && appId && redirectUri && encryptionKey);
}
