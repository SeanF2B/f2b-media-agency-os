import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeBusinessProfileRows, summarizeBusinessProfileReviews } from '../lib/local-seo.ts';
import { buildBusinessProfileAiContext } from '../lib/local-seo-ai-context.ts';

test('Local SEO totals only the selected Google Business Profile location', () => {
  const result = summarizeBusinessProfileRows([
    { location_id: 'locations/1', location_title: 'Heatwise', impressions: '20', call_clicks: '2', direction_requests: 1, website_clicks: 3 },
    { location_id: 'locations/1', impressions: 10, call_clicks: null, direction_requests: 0, website_clicks: 2 },
    { location_id: 'locations/2', location_title: 'Other client', impressions: 900, call_clicks: 8 },
  ], 'locations/1');
  assert.deepEqual(result, { rows: 2, locationName: 'Heatwise', impressions: 30, calls: 2, directions: 1, websiteClicks: 5 });
});

test('Local SEO leaves missing metrics unavailable instead of inventing zero', () => {
  assert.deepEqual(summarizeBusinessProfileRows([{ location_id: 'locations/1', clicks: 4 }], 'locations/1'), {
    rows: 1, locationName: '', impressions: null, calls: null, directions: null, websiteClicks: null,
  });
});

test('Local SEO review summaries stay scoped to the selected location', () => {
  const result = summarizeBusinessProfileReviews([
    { location_id: 'locations/1', review_total_count: '12', review_average_rating_total: '4.8', review_reviewer: 'Alex', review_star_rating: 'FIVE', review_comment: 'Great work' },
    { location_id: 'locations/2', review_total_count: '99', review_average_rating_total: '3.2', review_reviewer: 'Other', review_comment: 'Other client' },
  ], 'locations/1');
  assert.equal(result.total, 12);
  assert.equal(result.averageRating, 4.8);
  assert.equal(result.recent.length, 1);
  assert.equal(result.recent[0].reviewer, 'Alex');
});

test('scheduled SEO context includes mapped Business Profile evidence without reviewer identities or cross-location reviews', () => {
  const result = buildBusinessProfileAiContext({
    accountId: 'account-1',
    locationId: 'locations/1',
    currentRows: [{ location_id: 'locations/1', location_title: 'Heatwise', impressions: '20', call_clicks: '2', direction_requests: 1, website_clicks: 3 }],
    previousRows: [{ location_id: 'locations/1', impressions: '10', call_clicks: '1', direction_requests: 0, website_clicks: 2 }],
    reviewRows: [
      { location_id: 'locations/1', review_total_count: '12', review_average_rating_total: '4.8', review_reviewer: 'Private reviewer name', review_star_rating: 'FIVE', review_comment: '  Friendly   service  ', review_reply_comment: 'Thanks for your feedback' },
      { location_id: 'locations/2', review_total_count: '99', review_average_rating_total: '3.2', review_reviewer: 'Other client', review_comment: 'Do not include this' },
      { review_total_count: '400', review_comment: 'Account level; location is unknown' },
    ],
    dateRange: { start: '2026-09-26', end: '2026-10-25' },
  });
  assert.equal(result.status, 'connected');
  assert.equal(result.current.calls, 2);
  assert.equal(result.previousPeriod.calls, 1);
  assert.equal(result.reviews.total, 12);
  assert.equal(result.reviews.averageRating, 4.8);
  assert.deepEqual(result.reviews.recent, [{ rating: 'FIVE', createdAt: null, comment: 'Friendly service', ownerReply: 'Thanks for your feedback' }]);
  assert.equal(JSON.stringify(result).includes('Private reviewer name'), false);
  assert.equal(JSON.stringify(result).includes('Do not include this'), false);
  assert.equal(JSON.stringify(result).includes('location is unknown'), false);
});
