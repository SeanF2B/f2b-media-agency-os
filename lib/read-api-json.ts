export class ApiResponseError extends Error {
  constructor(message: string, readonly requiresSignIn = false) {
    super(message);
    this.name = "ApiResponseError";
  }
}

export function isSignInRequired(error: unknown): boolean {
  return error instanceof ApiResponseError && error.requiresSignIn;
}

/** Retry only read requests that can safely be repeated after brief outages. */
export async function fetchReadWithRetry(input: RequestInfo | URL, init: RequestInit = {}, retries = 2): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(input, init);
      if (![429, 502, 503, 504].includes(response.status) || attempt === retries) return response;
      lastError = new ApiResponseError(`Temporary service response: HTTP ${response.status}`);
    } catch (error) {
      if (init.signal?.aborted) throw error;
      lastError = error;
      if (attempt === retries) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1) ** 2));
  }
  throw lastError instanceof Error ? lastError : new ApiResponseError("The service is temporarily unavailable.");
}

/** Parse API responses without exposing opaque HTML or JSON parser errors to users. */
export async function readApiJson<T>(response: Response, source: string): Promise<T> {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    const finalUrl = response.url.toLowerCase();
    const redirectedToAccess = response.redirected && (finalUrl.includes("cloudflareaccess.com/cdn-cgi/access/login") || finalUrl.includes("/cdn-cgi/access/login"));
    if (redirectedToAccess) {
      throw new ApiResponseError(`${source} needs a fresh secure sign-in. Select “Sign in again” to reconnect; your saved workspace data is unchanged.`, true);
    }
    if (response.redirected || contentType.toLowerCase().includes("text/html")) {
      if ([429, 502, 503, 504].includes(response.status)) {
        throw new ApiResponseError(`${source} is temporarily unavailable. Your saved data is safe; the app will retry shortly.`);
      }
      throw new ApiResponseError(`${source} could not load its latest update. Your saved data is safe; please retry in a moment.`);
    }
    throw new ApiResponseError(`${source} could not load its latest update. Your saved data is safe; please retry in a moment.`);
  }
  try {
    return await response.json() as T;
  } catch {
    throw new ApiResponseError(`${source} could not load its latest update. Your saved data is safe; the app will retry shortly.`);
  }
}
