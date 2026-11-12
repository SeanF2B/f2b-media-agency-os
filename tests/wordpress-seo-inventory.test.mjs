import test from 'node:test';
import assert from 'node:assert/strict';
import { mapWordPressSeoInventory } from '../lib/wordpress-seo-inventory.ts';

test('WordPress SEO inventory normalizes page and plugin metadata without including page body content', () => {
  const result = mapWordPressSeoInventory([{
    id: 17,
    slug: 'boiler-repair',
    status: 'publish',
    modified: '2026-10-25T10:00:00',
    link: 'https://example.ie/boiler-repair/',
    title: { rendered: '<span>Boiler &amp; heating repair</span>' },
    content: { raw: 'Private full page body should not enter the agent context.' },
    yoast_head_json: { title: 'Boiler repair | Example', description: 'Book a boiler repair.', canonical: 'https://example.ie/boiler-repair/', robots: ['index', 'follow'] },
  }]);
  assert.deepEqual(result, [{
    id: 17,
    title: 'Boiler & heating repair',
    slug: 'boiler-repair',
    status: 'publish',
    url: 'https://example.ie/boiler-repair/',
    modifiedAt: '2026-10-25T10:00:00',
    seoTitle: 'Boiler repair | Example',
    metaDescription: 'Book a boiler repair.',
    canonicalUrl: 'https://example.ie/boiler-repair/',
    robots: 'index, follow',
    checkedFields: { seoTitle: true, metaDescription: true, canonical: true, indexing: true },
  }]);
  assert.equal(JSON.stringify(result).includes('Private full page body'), false);
});

test('WordPress SEO inventory distinguishes unexposed fields from confirmed missing metadata', () => {
  const [unexposed, checkedMissing] = mapWordPressSeoInventory([
    { id: 1, slug: 'about', status: 'publish', title: 'About', link: 'https://example.ie/about/' },
    { id: 2, slug: 'services', status: 'publish', title: 'Services', meta: { rank_math_title: '', rank_math_description: '', rank_math_canonical_url: '', rank_math_robots: '' } },
  ]);
  assert.deepEqual(unexposed.checkedFields, { seoTitle: false, metaDescription: false, canonical: false, indexing: false });
  assert.deepEqual(checkedMissing.checkedFields, { seoTitle: true, metaDescription: true, canonical: true, indexing: true });
  assert.equal(checkedMissing.seoTitle, '');
  assert.equal(checkedMissing.metaDescription, '');
});

test('WordPress SEO inventory rejects invalid IDs and caps the context at 50 pages', () => {
  const result = mapWordPressSeoInventory([{ id: 0, slug: 'invalid' }, ...Array.from({ length: 60 }, (_, index) => ({ id: index + 1, slug: `page-${index + 1}` }))]);
  assert.equal(result.length, 49);
  assert.equal(result.at(-1)?.id, 49);
});
