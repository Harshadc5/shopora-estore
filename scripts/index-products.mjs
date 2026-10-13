// Copies data/products.js into Typesense.
// Run by hand:  node scripts/index-products.mjs            (update in place)
//               node scripts/index-products.mjs --rebuild  (drop and recreate)
import { readFile } from 'node:fs/promises';
const BASE = process.env.TYPESENSE_URL;            // e.g. https://xxxx.a1.typesense.net
const ADMIN_KEY = process.env.TYPESENSE_ADMIN_KEY; // never commit this
const COLLECTION = 'products';
if (!BASE || !ADMIN_KEY) {
  console.error('Set TYPESENSE_URL and TYPESENSE_ADMIN_KEY first.');
  process.exit(1);
}
const schema = {
  name: COLLECTION,
  fields: [
    { name: 'name', type: 'string' },
    { name: 'description', type: 'string' },
    { name: 'specs', type: 'string[]' },
    { name: 'category', type: 'string', facet: true },
    { name: 'badge', type: 'string', facet: true },
    { name: 'price', type: 'float' },
    { name: 'oldPrice', type: 'float' },
    { name: 'discountPct', type: 'int32' },
    { name: 'rating', type: 'float' },
    { name: 'deal', type: 'bool', facet: true },
    { name: 'stock', type: 'int32' },
    { name: 'inStock', type: 'bool', facet: true },
    { name: 'indexedAt', type: 'int64' },
  ],
  default_sorting_field: 'rating',
};
const source = await readFile(new URL('../data/products.js', import.meta.url), 'utf8');
const { products } = await import('data:text/javascript,' + encodeURIComponent(source));
const indexedAt = Math.floor(Date.now() / 1000);
const docs = products.map((p) => ({
  id: p.id,
  name: p.name,
  description: p.description,
  specs: p.specs,
  category: p.category,
  badge: p.badge,
  price: p.price,
  oldPrice: p.oldPrice,
  discountPct: Math.round(((p.oldPrice - p.price) / p.oldPrice) * 100),
  rating: p.rating,
  deal: p.deal,
  stock: p.stock,
  inStock: p.stock > 0,
  indexedAt,
}));
async function call(method, path, body, type = 'application/json') {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'X-TYPESENSE-API-KEY': ADMIN_KEY, 'Content-Type': type },
    body,
  });
  return { status: res.status, text: await res.text() };
}
if (process.argv.includes('--rebuild')) await call('DELETE', `/collections/${COLLECTION}`);
const existing = await call('GET', `/collections/${COLLECTION}`);
if (existing.status === 404) {
  const created = await call('POST', '/collections', JSON.stringify(schema));
  if (created.status !== 201) {
    console.error('Could not create the collection:', created.text);
    process.exit(1);
  }
} else if (existing.status !== 200) {
  console.error('Could not reach Typesense:', existing.status, existing.text);
  process.exit(1);
}
const imported = await call(
  'POST',
  `/collections/${COLLECTION}/documents/import?action=upsert`,
  docs.map((d) => JSON.stringify(d)).join('\n'),
  'text/plain',
);
const results = imported.text.trim().split('\n').map((line) => JSON.parse(line));
const failed = results.filter((r) => !r.success);
console.log(`Indexed ${results.length - failed.length} of ${docs.length} products at ${new Date(indexedAt * 1000).toISOString()}`);
if (failed.length) {
  console.error('First failures:', failed.slice(0, 5));
  process.exit(1);
}
