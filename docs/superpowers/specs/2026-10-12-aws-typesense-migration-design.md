# Shopora: Vercel → AWS migration + Typesense search

Date: 2026-10-12
Source: Satish Narayan, "Moving Shopora to AWS and adding Typesense search" (Oct 10, 2026), `Shopora Composed Guide 1.pdf`

## Intent

Move the Shopora demo site off Vercel onto a single self-managed AWS EC2
server, and replace the category page's in-browser product search with a
real search engine (Typesense) running on that same server. Vercel stays
live and unmodified until the AWS copy passes every check in "Done when"
below — nothing is cut over early.

A deliberate design goal, stated explicitly by Satish: the search index and
the real product catalog (`data/products.js`) are allowed to go out of sync,
because the re-indexing step is manual, never automatic. That gap is a
feature — it creates a realistic "two systems disagree" scenario for AIORA
to detect, the same category of problem the tag/policy-engine work already
targets (identity contradictions, stale claims, etc.).

## Decisions resolved (2026-10-12, in chat)

- **Beacon endpoint**: the new AWS collector **replaces**
  `https://api.aiora.systems/v1/signal` (the AWS Alpha pipeline endpoint)
  entirely on all 7 pages. Not dual-send, not left alone.
- **Host names**: keep `shopora.aiora.systems` (site + collector) and
  `search.aiora.systems` (Typesense) exactly as in the guide.
- **AWS/DNS/Supabase access**: unconfirmed in detail, but proceed — Step 2
  will surface exactly what access is missing, if anything, and that gets
  handed off then.

## Discrepancy from the source guide (confirmed against the real repo)

The guide assumes the tag's `data-endpoint` still points at a Vercel-relative
`/api/collect`. In the real repo, all 7 pages already point at
`https://api.aiora.systems/v1/signal` (a separate, currently-blocked
AWS Alpha pipeline). The guide's Step 1a (load stylesheet locally) is
**already done** — all 7 pages already use `./styles.css?v=21`.

## Architecture

One EC2 `t3.small` (2GB, ~$15/mo on-demand), Ubuntu LTS, 20GB disk, Docker
Compose running three containers behind Caddy (reverse proxy + automatic
HTTPS):

| Piece | Runs as | Address |
|---|---|---|
| Site files | Caddy serving a folder | `https://shopora.aiora.systems` |
| Tag receiver | Node container behind Caddy | `https://shopora.aiora.systems/api/collect` |
| Typesense | Docker container behind Caddy | `https://search.aiora.systems` |

Only Caddy faces the internet; Typesense and the collector publish no ports
of their own. Security group: port 22 from the operator's IP only, 80/443
open to everyone, nothing else. An Elastic IP keeps the address stable
across reboots.

## Data flow

**Beacon**: `tag.js` on every page → `POST /api/collect` on
`shopora.aiora.systems` → Caddy reverse-proxies to the collector container →
collector calls the existing `api/collect.js` handler, unmodified → Supabase.

**Search**: category page search box → `app.js`'s new `searchTypesense()` →
`search.aiora.systems` (called directly from the browser with a public,
search-only API key) → results rendered as tiles, each tagged
`data-source="search"`. Product pages, cart, and checkout keep reading
`data/products.js` directly (implicitly `catalog`-sourced, code path
unchanged). The index only updates when `scripts/index-products.mjs` is run
by hand — never automatically on deploy.

## Error handling

If Typesense is unreachable, the category page shows "Search unavailable" —
no silent fallback to local filtering, so an outage is visible rather than
masked. `?search=local` stays available as an escape hatch to force the old
in-browser search for side-by-side comparison. The collector has no special
error handling beyond what `api/collect.js` already does.

## Testing / rollback

Satish's own "Done when" checklist (below) is the acceptance bar for
cutover. Vercel stays live and completely untouched for at least a week
after cutover as a rollback path. `api/collect.js` is never modified, so
reverting is just pointing DNS/`data-endpoint` back.

## File-level changes

### 1. All 7 HTML pages (`index.html`, `category.html`, `cart.html`, `checkout.html`, `pdp.html`, `search.html`, `orders.html`)

Stylesheet: already local, no change.

Tag endpoint — final (no longer conditional, per the resolved decision above):
```diff
- data-endpoint="https://api.aiora.systems/v1/signal"
+ data-endpoint="/api/collect"
```

### 2. New file: `server/collect-server.mjs`

Wraps the existing `api/collect.js` (confirmed present, exports a
Vercel-style `handler`) as a plain Node HTTP server, so it can run as an
ordinary always-on process instead of a Vercel function:

```js
// server/collect-server.mjs
import http from 'node:http';
import handler from '../api/collect.js';
const PORT = process.env.PORT || 4001;
http.createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => {
    raw += chunk;
    if (raw.length > 1_000_000) req.destroy();
  });
  req.on('end', async () => {
    req.body = raw;
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (data) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)); };
    try {
      await handler(req, res);
    } catch (err) {
      console.error(err);
      if (!res.writableEnded) { res.statusCode = 500; res.end(); }
    }
  });
}).listen(PORT, () => console.log(`Tag receiver listening on port ${PORT}`));
```

`api/collect.js` itself is **not modified** — it already reads
`process.env.SUPABASE_URL`/`SUPABASE_ANON_KEY`, which works identically
under this wrapper.

### 3. AWS server setup (infra only, nothing in git)

- EC2 `t3.small`, Ubuntu LTS, 20GB disk.
- Security group: port 22 from operator IP only; 80/443 open.
- Elastic IP attached.
- Two DNS A records (`shopora.aiora.systems`, `search.aiora.systems`) →
  the Elastic IP.
- Docker via `curl -fsSL https://get.docker.com | sudo sh`.
- Repo cloned to `~/shopora/repo`.
- New files created directly on the server (never committed):
  `.env` (secrets — Typesense admin key, Supabase URL/key),
  `docker-compose.yml`, `Caddyfile`, `deploy.sh`.

### 4. New file: `scripts/index-products.mjs`

Reads `data/products.js`, computes two fields not present in the catalog
(`discountPct`, `inStock`), pushes into Typesense via its HTTP API. Needs
`TYPESENSE_URL` and `TYPESENSE_ADMIN_KEY` as environment variables. Run by
hand only — `node scripts/index-products.mjs` (update in place) or
`--rebuild` (drop and recreate). Full script content is in Satish's guide
(pages 7-10); depends only on `data/products.js`'s existing
`export const products` shape, nothing in it needs adapting to this repo.

### 5. New file: `search-config.js` (site root)

```js
export const SEARCH = {
  url: 'https://search.aiora.systems',
  key: 'YOUR-SEARCH-ONLY-KEY',
  collection: 'products',
};
```

### 6. `app.js` — adapted to the real current code, not the guide's simplified version

The guide assumes a simpler `applyFilters` than what actually exists in this
repo (`app.js:434-513`), which also does relevance scoring, a sale-banner
block, and dynamic heading/subheading text. The Typesense branch has to fit
around that, not replace it wholesale.

**New, near the top of `app.js` (before `renderCatalog`):**
```js
import { SEARCH } from './search-config.js';
const USE_LOCAL_SEARCH = new URLSearchParams(location.search).get('search') === 'local';
let requestNo = 0;

async function searchTypesense({ term, category, dealOnly, wishlistOnly, maxPrice, minRating, sort }) {
  if (wishlistOnly && wishlist.size === 0) return { found: 0, products: [] };
  const filters = [`price:<=${maxPrice}`, `rating:>=${minRating}`];
  if (category !== 'all') filters.push(`category:=${category}`);
  if (dealOnly) filters.push('deal:=true');
  if (wishlistOnly) filters.push(`id:[${[...wishlist].join(',')}]`);
  const sorts = {
    'price-low': 'price:asc', 'price-high': 'price:desc', rating: 'rating:desc', discount: 'discountPct:desc',
    featured: term ? '_text_match:desc,deal:desc,rating:desc' : 'deal:desc,rating:desc',
  };
  const params = new URLSearchParams({
    q: term || '*', query_by: 'name,description,badge,specs',
    filter_by: filters.join(' && '), sort_by: sorts[sort] || sorts.featured, per_page: '250',
  });
  const res = await fetch(`${SEARCH.url}/collections/${SEARCH.collection}/documents/search?${params}`, {
    headers: { 'X-TYPESENSE-API-KEY': SEARCH.key },
  });
  if (!res.ok) throw new Error(`Typesense ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return { found: data.found, products: data.hits.map((hit) => hit.document) };
}
```

**Before (`applyFilters`, simplified to the split point):**
```js
function applyFilters() {
  const term = search.value.trim().toLowerCase();
  const minRating = Number(document.querySelector('input[name="rating"]:checked')?.value || 0);
  const maxPrice = Number(price.value);
  let filtered = products.filter((product) => {
    const searchable = [product.name, product.description, product.badge, ...product.specs].join(' ').toLowerCase();
    const searchMatch = !term || term.split(/\s+/).every(t => {
      const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`\\b${escaped}(s|es)?\\b`, 'i').test(searchable);
    });
    return (activeCategory === 'all' || product.category === activeCategory) && (!dealOnly || product.deal) && (!wishlistOnly || wishlist.has(product.id)) && searchMatch && retailPrice(product) <= maxPrice && product.rating >= minRating;
  });
  if (term) { /* relevance scoring */ }
  const sorters = { /* ... */ };
  filtered.sort(sorters[sort.value] || sorters.featured);
  // ... priceOutput, #resultCount, heading, sale banner, grid render, empty/hidden
}
```

**After** — `applyFilters` becomes `async`, branches on `USE_LOCAL_SEARCH`;
everything from relevance-scoring through sorting only runs for the local
path, since Typesense already returns sorted/relevant results:
```js
async function applyFilters() {
  const term = search.value.trim().toLowerCase();
  const minRating = Number(document.querySelector('input[name="rating"]:checked')?.value || 0);
  const maxPrice = Number(price.value);
  const mine = ++requestNo;
  let filtered, found;

  if (USE_LOCAL_SEARCH) {
    filtered = products.filter((product) => {
      const searchable = [product.name, product.description, product.badge, ...product.specs].join(' ').toLowerCase();
      const searchMatch = !term || term.split(/\s+/).every(t => {
        const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`\\b${escaped}(s|es)?\\b`, 'i').test(searchable);
      });
      return (activeCategory === 'all' || product.category === activeCategory) && (!dealOnly || product.deal) && (!wishlistOnly || wishlist.has(product.id)) && searchMatch && retailPrice(product) <= maxPrice && product.rating >= minRating;
    });
    if (term) {
      filtered.forEach(product => {
        product._relevance = 0;
        const nameLower = product.name.toLowerCase();
        term.split(/\s+/).forEach(t => {
          if (nameLower.includes(t)) product._relevance += 10;
          else if (product.description.toLowerCase().includes(t)) product._relevance += 1;
        });
      });
    }
    const sorters = {
      'price-low': (a, b) => retailPrice(a) - retailPrice(b),
      'price-high': (a, b) => retailPrice(b) - retailPrice(a),
      rating: (a, b) => b.rating - a.rating,
      discount: (a, b) => discount(b) - discount(a),
      featured: (a, b) => term ? ((b._relevance || 0) - (a._relevance || 0) || Number(b.deal) - Number(a.deal) || b.rating - a.rating) : (Number(b.deal) - Number(a.deal) || b.rating - a.rating)
    };
    filtered.sort(sorters[sort.value] || sorters.featured);
    found = filtered.length;
  } else {
    try {
      ({ found, products: filtered } = await searchTypesense({
        term, category: activeCategory, dealOnly, wishlistOnly, maxPrice, minRating, sort: sort.value,
      }));
    } catch (err) {
      console.error('[search]', err);
      filtered = []; found = null;
    }
    if (mine !== requestNo) return; // a newer search started; drop this stale reply
  }

  priceOutput.textContent = 'Up to ' + money(maxPrice);
  document.querySelector('#resultCount').textContent = found === null ? 'Search unavailable' : found + ' products';
  const categoryName = activeCategory === 'all' ? 'All products' : categories.find((c) => c.key === activeCategory).label;
  let headingText = dealOnly ? "Today's deals" : categoryName;
  if (term) headingText = `Search results for "${search.value.trim()}"`;
  document.querySelector('#resultsHeading').textContent = headingText;

  // sale banner block — unchanged, still only shown for category=electronics, no term, no deal, no ?demo=
  const saleBanner = document.querySelector('#categorySaleBanner');
  let showSaleBanner = false;
  if (saleBanner) { /* unchanged logic from the current file */ }

  const subheadingText = activeCategory === 'all' ? 'Quality picks across electronics, fashion, home and books.' : `Quality picks across ${categoryName.toLowerCase()}.`;
  document.querySelector('#resultsSubheading').textContent = subheadingText;
  grid.innerHTML = '';
  const voltmaxBadgeOverride = showSaleBanner ? { sku: 'el-1', percent: 40 } : null;
  filtered.forEach((product) => {
    const card = buildProductCard(product, template, voltmaxBadgeOverride);
    card.dataset.source = USE_LOCAL_SEARCH ? 'catalog' : 'search';
    grid.appendChild(card);
  });
  empty.hidden = filtered.length !== 0;
  grid.hidden = filtered.length === 0;
}
```

**Open wrinkle to verify deliberately during implementation, not assume:**
`applyFilters` is currently called synchronously from several places inside
`renderCatalog` — the `filterList` click handler, the `search`/`sort`/`price`/
rating `addEventListener` calls, `clearFilters`, and the initial call at
line 525. Making it `async` means these call it without `await`
(fire-and-forget), which is fine since the function updates the DOM itself
— but confirm this behaves correctly for each call site rather than assuming
it from the diff alone.

**Confirmed untouched**: `buildProductCard` and the product-card HTML
template — so every CSS selector `tag.js` currently reads
(`article.product-card[data-product-id]`, `h3`, `.product-brand`,
`.price-stack strong/del/span`, `.discount-badge`, `.delivery-note`,
`.add-to-cart`, `#resultCount`) keeps working with zero changes to
`tag.js`'s `FIELD_SEL`/`CARD_SELECTORS` config.

## Sequencing

1. **Phase 1 — repo prep**: the 7-page endpoint edit + `server/collect-server.mjs`. Commit and push.
2. **Phase 2 — AWS server setup**: EC2, DNS, Docker, the 4 server-only config files, first boot, the Step 2g health checks.
3. **Phase 3 — indexer script**: add `scripts/index-products.mjs`, run it once by hand, confirm `Indexed 60 of 60 products`.
4. **Phase 4 — category page wiring**: `search-config.js` + `app.js` changes, deployed, verified against the real Typesense cluster.
5. **Phase 5 — cutover**: only once every item in "Done when" passes, with Vercel kept live as fallback for a week.

Vercel is never touched or disabled before Phase 5, and nothing in Phase 5
is reversible-risky — DNS and `data-endpoint` are the only things that move.

## Done when (acceptance checklist, from the source guide)

- Every page at `https://shopora.aiora.systems` loads fully styled; browser
  network tab shows no request to `vercel.app`.
- `/.git/config`, `/payloads.log`, `/README.md` on the site each return 404.
- Loading a page sends a `POST` to `/api/collect` that returns 202, and a
  new row appears in Supabase.
- `curl https://search.aiora.systems/health` prints `{"ok":true}` from a
  laptop; port 8108 on the server does not answer from the internet.
- After a server reboot, all three checks from the guide's Step 2g pass
  again without anyone logging in.
- `node scripts/index-products.mjs` prints `Indexed 60 of 60 products`.
- The category page shows "60 products" and 60 tiles, each with
  `data-source="search"`.
- The network tab shows search requests going to `search.aiora.systems`.
- Searching the whole repository for the admin key finds nothing.
- Stale-index test: edit the price of `el-1` in `data/products.js` to a new
  value, deploy **without** running the indexer → listing tile shows the
  old price, product page shows the new price. Run the indexer → both match.

## Explicitly out of scope

- Homepage product grids and the cart's recommendations — still read the
  catalog directly, untouched by this migration.
- Automatic deploys (GitHub Action) — publishing stays a manual script
  (`./deploy.sh`) for now.
- Whether the browser calls Typesense directly vs. through the site's own
  address (proxy hop) — guide calls it directly; revisit only if the
  search-vendor visibility in network requests becomes a concern.
- Which Typesense relevance defaults to keep (affects ambiguous-query
  result counts, e.g. "table" matching "tablets") — not decided, write down
  whatever is chosen once this is live.
