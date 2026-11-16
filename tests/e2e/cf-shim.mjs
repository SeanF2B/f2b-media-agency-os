// Stand-in for the Workers runtime "cloudflare:workers" module: a mutable env the test fills in.
export const env = globalThis.__OUTREACH_TEST_ENV__ || (globalThis.__OUTREACH_TEST_ENV__ = {});
