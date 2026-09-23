// demo_router.js — AIORA / Shopora demo scenario engine
// Built for Pattern 1 (1.1–1.5). Verified against the REAL tag.js parsing
// This file deliberately does NOT render identity or the loyalty chip — app.js's initIdentity() and initLoyaltyChip() already do this correctly, driven by the same ?identity=/&member_tier= URL params, using the exact attributes tag.js reads. The one exception is Scenario 1.4, whose trigger URL has no ?identity= param at all, yet still needs a recognized Plus member — forceIdentity() covers that case only.

import { products } from './data/products.js';
import { demoCustomerHash } from './data/customer.js';
// versioned separately from this file's own <script> tag ?v= — bump this
// whenever demo_scenarios.js content changes, so edits can't get stuck
// behind a stale cached copy.
import { demoScenarios } from './data/demo_scenarios.js?v=36';

function money(n) {
    return '$' + Number(n).toFixed(2);
}

document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    const demoSlug = params.get('demo');
    if (!demoSlug) return; // No demo param — real Shopora runs untouched.

    console.warn(`[AIORA DEMO] Applying scenario: ${demoSlug}`);

    // demoScenarios is a static import (resolved at script-load time, no
    // network round trip) rather than a fetch() of the JSON file — that
    // round trip used to be exactly the kind of delay that let tag.js's
    // DOM-settle extraction fire before our override had landed.
    const scenario = demoScenarios[demoSlug];

    if (!scenario) {
        console.warn(`[AIORA DEMO] Unknown scenario slug: "${demoSlug}"`);
        window.__AIORA_DEMO_READY__ = true;
        return;
    }

    const currentPageType = document.body.dataset.pageType;
    if (scenario.target_page && scenario.target_page !== currentPageType) {
        window.__AIORA_DEMO_READY__ = true;
        return;
    }

    if (scenario.forceIdentity && params.get('identity') !== 'logged-in') {
        forceIdentity(scenario.forceIdentity);
    }

    // tag.js (see its waitForHydration) holds off extracting the page,
    // whenever a ?demo= param is present, until this flag is true — so it
    // never captures mid-override regardless of which scenario/page is
    // active. Most overrides below are synchronous, but scenario.pdp isn't
    // (waitForRealPdpHero can take up to its own maxWaitMs), so the flag is
    // only set once every synchronous AND async override has actually
    // landed in the DOM.
    let pendingAsync = 0;
    function markAsyncDone() {
        pendingAsync--;
        if (pendingAsync <= 0) window.__AIORA_DEMO_READY__ = true;
    }

    if (scenario.hideSections) hideSections(scenario.hideSections);      // Pattern 2 (2.1)
    if (scenario.cart) {
        renderCart(scenario.cart);
        // app.js's own 'storage' listener re-renders the REAL (persisted,
        // still empty in demo mode) cart whenever localStorage changes in
        // another same-site tab — which silently wipes this override. Redraw
        // it if that happens, so switching tabs mid-demo doesn't blank the cart.
        window.addEventListener('storage', () => renderCart(scenario.cart));
    }
    if (scenario.cartRecommendations) renderCartRecommendations(scenario.cartRecommendations);  // Pattern 3 (3.4)
    if (scenario.checkout) renderCheckoutOverride(scenario.checkout);  // Pattern 4 (4.3)
    if (scenario.promo) applyPromoOverride(scenario.promo);  // Pattern 4 (4.4/4.5)
    if (scenario.claims) renderClaims(scenario.claims);       // Pattern 2+
    if (scenario.hero) renderHeroOverride(scenario.hero);
    if (scenario.featuredTiles) renderFeaturedTiles(scenario.featuredTiles);
    if (scenario.categoryTiles) renderCategoryTiles(scenario.categoryTiles);  // Pattern 3 (3.2)
    if (scenario.searchResults) renderSearchResults(scenario.searchResults);  // Pattern 3 (3.3)
    if (scenario.featuredSectionHeading) renderFeaturedSectionHeading(scenario.featuredSectionHeading);   // Pattern 2 (2.1)
    if (scenario.promoModule) renderPromoModule(scenario.promoModule);   // Pattern 4 (4.4/4.5)
    if (scenario.disableAddToCart) disableAddToCart();   // Pattern 4 (4.5)
    if (scenario.loyaltyPrompt) renderLoyaltyPromptOverride(scenario.loyaltyPrompt);  // Pattern 5 (5.2)
    if (scenario.cartBadgeCount !== undefined) {
        overrideCartBadge(scenario.cartBadgeCount);  // Pattern 5 (5.3)
        // app.js's own 'storage' listener calls updateHeaderCounts() on any
        // same-site localStorage change (e.g. another tab refreshing) and
        // resets this badge back to the real (untouched) cart size — redraw
        // the override if that happens.
        window.addEventListener('storage', () => overrideCartBadge(scenario.cartBadgeCount));
    }
    if (scenario.wishlistBadgeCount !== undefined) {
        overrideWishlistBadge(scenario.wishlistBadgeCount);  // Pattern 5 (5.4)
        // Same storage-event reset risk as cartBadgeCount above —
        // updateHeaderCounts() resets both badges together.
        window.addEventListener('storage', () => overrideWishlistBadge(scenario.wishlistBadgeCount));
    }
    if (scenario.dealOfDayOverride) renderDealOfDayOverride(scenario.dealOfDayOverride);   // Pattern 2 (2.4)
    if (scenario.newsletterOverride) renderNewsletterOverride(scenario.newsletterOverride);   // Pattern 2 (2.5)
    if (scenario.banner) renderCategoryBanner(scenario.banner);       // Pattern 4 (4.1)
    if (scenario.pdp) {
        pendingAsync++;
        waitForRealPdpHero(() => { renderPdpOverride(scenario.pdp); markAsyncDone(); });  // Pattern 4 (4.1)
    }
    // tiles overrides must run AFTER featuredTiles/real grid are in the DOM
    // — it targets tiles by [data-product-id], which must already exist.
    if (scenario.tiles) applyTileOverrides(scenario.tiles);  // Pattern 3+, 4.1
    if (scenario.clickThrough) attachClickThrough(scenario.clickThrough);  // Pattern 4 (4.1)
    if (scenario.carryDemoForward || scenario.navOverrides) {
        attachDemoNavRouting(demoSlug, scenario.navOverrides, scenario.carryDemoForward);  // Pattern 5 (5.1)
    }

    if (pendingAsync === 0) window.__AIORA_DEMO_READY__ = true;
});

// Pattern 5 (5.1): app.js's own global click handler already carries
// ?identity=/&member_tier= forward on internal links (see initGlobalInteractions
// in app.js), but never ?demo= — so navigating off this page via a plain
// link (Orders, Wishlist, ...) silently drops back into real-site mode,
// which breaks the "recognized everywhere except cart" story this scenario
// needs. This carries the CURRENT demo slug forward on every internal link
// click (in addition to identity/member_tier, replicating app.js's own
// behavior since stopImmediatePropagation prevents its handler from also
// firing), except for links matching `overrides` — those jump to an
// explicit, different destination instead (Pattern 5.1's Cart link, which
// must lose identity entirely, not carry it forward).
function attachDemoNavRouting(demoSlug, overrides, carryForward) {
    console.warn('[AIORA DEMO] attachDemoNavRouting armed. overrides =', overrides, 'carryForward =', carryForward);
    document.addEventListener('click', (e) => {
        const link = e.target.closest('a');
        if (!link || !link.href) return;
        console.warn('[AIORA DEMO] nav-routing saw click on link:', link.href, 'classList =', link.className);
        const override = (overrides || []).find(o => link.closest(o.selector));
        if (override) {
            console.warn('[AIORA DEMO] nav-routing: override matched ->', override.destination);
            e.preventDefault();
            e.stopImmediatePropagation();
            window.location.href = override.destination;
            return;
        }
        if (!carryForward) { console.warn('[AIORA DEMO] nav-routing: no override, carryForward is off, letting it pass through.'); return; }
        let url;
        try { url = new URL(link.href, window.location.origin); } catch (err) { console.warn('[AIORA DEMO] nav-routing: URL parse failed', err); return; }
        if (url.origin !== window.location.origin) { console.warn('[AIORA DEMO] nav-routing: external origin, ignoring.'); return; }
        const current = new URLSearchParams(window.location.search);
        if (current.has('identity')) url.searchParams.set('identity', current.get('identity'));
        if (current.has('member_tier')) url.searchParams.set('member_tier', current.get('member_tier'));
        url.searchParams.set('demo', demoSlug);
        console.warn('[AIORA DEMO] nav-routing: carrying forward ->', url.toString());
        e.preventDefault();
        e.stopImmediatePropagation();
        window.location.href = url.toString();
    }, true);
}

// Generic click-through override: while this scenario is active, clicking
// a product tile navigates to that tile's own SKU on the destination demo
// slug (./pdp.html?sku=<clicked-sku>&demo=<destinationSlug>) instead of
// app.js's default ?id=<sku> link with no demo param.
//
// config.skus (optional): if given, only tiles whose sku is in this list
// are click-through'd — every other tile falls through to app.js's real,
// un-overridden click handling. Used by category-promise-gap (4.1): the
// destination PDP override (renderPdpOverride) only swaps the new price,
// not the struck-through "was" price, so it was only ever tuned to read
// right against el-1's (VoltMax Laptop Pro) own real oldPrice. Routing
// every other tile through the same fixed override collided with THEIR
// unrelated real oldPrice (e.g. IronCore showing "$1619.99, was $119.99"),
// which read as a broken/nonsensical price rather than the intended
// "category promised X% off, this PDP doesn't honor it" gap. Omit
// config.skus to keep the old any-tile behavior.
//
// This listens on `window` (the earliest possible point in the capturing
// phase — even before `document`) with capture:true, so it always runs
// before app.js's own bubble-phase click handlers on the tile's image/title,
// and stopImmediatePropagation() stops the event before it can reach them.
// It's pure event delegation (e.target read fresh at click time, not a
// stored element reference), so it keeps working even if the grid re-renders
// after this listener is attached.
function attachClickThrough(config) {
    console.warn(`[AIORA DEMO] click-through armed -> ${config.skus ? config.skus.join(',') : 'any'} tile(s) redirect to ?sku=<sku>&demo=${config.destinationSlug}`);
    window.addEventListener('click', (e) => {
        const card = e.target.closest('[data-product-id]');
        if (!card) return;
        if (e.target.closest('.wishlist-button, .add-to-cart, .quick-view')) return;
        const sku = card.dataset.productId;
        if (!sku) return;
        if (config.skus && !config.skus.includes(sku)) return;
        const destination = `./pdp.html?sku=${encodeURIComponent(sku)}&demo=${encodeURIComponent(config.destinationSlug)}`;
        console.warn(`[AIORA DEMO] click-through firing for sku="${sku}" -> ${destination}`);
        e.preventDefault();
        e.stopImmediatePropagation();
        window.location.href = destination;
    }, true);
}


// =====================================================================
// IDENTITY FALLBACK — only for scenarios needing recognized/Plus state
// without a matching URL param (currently: 1.4 only).
// =====================================================================
function forceIdentity(identity) {
    const chip = document.querySelector('.account-chip');
    if (chip) {
        chip.dataset.identityState = identity.state;
        if (identity.tier) chip.dataset.memberTier = identity.tier;
        chip.dataset.customerHash = demoCustomerHash();
        chip.innerHTML = '<span class="greeting">Hello, Rahul</span><strong class="account-label">Shopora Plus</strong>';
    }
    if (identity.tier === 'plus') {
        // Mirrors initLoyaltyChip()'s own markup exactly.
        // NOTE: data-loyalty-tier is not read by tag.js (data-member-tier on
        // .account-chip already covers this) — kept for forward compatibility.
        const chipHtml = `
      <div class="loyalty-chip" data-loyalty-tier="plus" data-loyalty-balance="${identity.points || 450}" style="display:flex;width:fit-content;margin:0 auto 0.75rem;">
        <span class="tier-label">Shopora Plus</span>
        <span class="points">${identity.points || 450} points</span>
      </div>`;
        const summaryCard = document.querySelector('.summary-card');
        const checkoutSummary = document.querySelector('.checkout-summary');
        if (checkoutSummary) checkoutSummary.insertAdjacentHTML('afterbegin', chipHtml);
        else if (summaryCard) summaryCard.insertAdjacentHTML('afterbegin', chipHtml);
    }
}


// =====================================================================
// HIDE SECTIONS — removes real homepage sections that would otherwise
// distract from a scenario's specific claim (e.g. 2.1's hero-vs-category
// mismatch doesn't need the "popular categories" grid, today's deals
// strip, or the two bottom promo banners competing for attention — and
// removing them outright, rather than hiding with CSS, also keeps them
// out of tag.js's extraction entirely).
// =====================================================================
function hideSections(selectors) {
    selectors.forEach(sel => {
        document.querySelectorAll(sel).forEach(el => el.remove());
    });
}

// Retitles the real "Trending products" heading above #featuredGrid —
// used by 2.1 so the featured-tiles section reads as the thing the hero
// is claiming a discount on, instead of an unrelated "trending" framing.
function renderFeaturedSectionHeading(text) {
    const grid = document.querySelector('#featuredGrid');
    const heading = grid && grid.closest('.section')?.querySelector('.section-heading h2');
    if (heading) heading.textContent = text;
}

// =====================================================================
// PROMO MODULE — Pattern 4 (4.4/4.5). Injects a new, demo-only promo
// banner on the homepage right after the hero (no real element like this
// exists in Shopora's markup). Class "promo-banner" is exactly what
// tag.js's existing FIELD_SEL.promoBanner selector already scans, and
// buildModule()/extractClaim() already read data-module-type/data-claim-*
// off any element — data-module-type="promo" here just overrides
// buildModule's default "banner" type. No tag.js change needed.
// =====================================================================
function renderPromoModule(promo) {
    const hero = document.querySelector('.hero');
    if (!hero) {
        console.error('[AIORA DEMO] .hero not found on this page.');
        return;
    }
    // Wrapped in the same <section class="section"> every other homepage
    // block uses, so it gets the real page's width/margin instead of
    // guessing pixel values by hand.
    const section = document.createElement('section');
    section.className = 'section';
    const el = document.createElement('div');
    el.className = 'promo-banner';
    el.dataset.moduleType = 'promo';
    if (promo.claim_percent != null) el.dataset.claimPercent = promo.claim_percent;
    if (promo.claim_amount != null) el.dataset.claimAmount = promo.claim_amount;
    if (promo.claim_code) el.dataset.claimCode = promo.claim_code;
    if (promo.claim_min_spend != null) el.dataset.claimMinSpend = promo.claim_min_spend;
    // .promo-banner's real CSS (min-height:250px, inline-flex sized-to-
    // content) is built for the hero-sized promo-tech/promo-home banners —
    // override those for a slim single-line strip, but keep its white text
    // color (already correct against a dark background) and use the site's
    // real navy token instead of an off-theme color.
    el.style.cssText = 'display:flex;align-items:center;justify-content:center;width:100%;min-height:88px;box-sizing:border-box;padding:1.5rem;background:var(--navy,#10243e);border-radius:var(--radius,12px);text-align:center;';
    // <h2> — same element tag.js's existing promo-banner extraction already
    // reads into modules[].headline (promoBannerEls[p].querySelector('h2,
    // h3')), so the visible text lands in the payload with zero new
    // tag.js code. Inline-styled to override .promo-banner h2's real CSS
    // (font-size:2rem, meant for the hero-sized tech/home banners).
    const heading = document.createElement('h2');
    heading.style.cssText = 'font-size:1.15rem;font-weight:700;letter-spacing:normal;margin:0;';
    heading.textContent = promo.text;
    el.appendChild(heading);
    section.appendChild(el);
    hero.insertAdjacentElement('afterend', section);
}

// Pattern 4 (4.5): the cart on this scenario's next step is pre-staged with
// exact prices to hit a specific total ($214.99) — a real "Add to cart"
// click wouldn't change what the cart page shows (it's fully overridden
// regardless), but would be visually confusing/misleading during a live
// walkthrough. Intercepts the click instead of setting `disabled` — tag.js's
// own extractAvailability() treats a disabled add-to-cart button as an
// out-of-stock signal, which would falsely mark every real, in-stock tile
// on the page as out-of-stock in the payload. Blocking the click in the
// capturing phase (same pattern as attachClickThrough/attachDemoNavRouting)
// gets the same "nothing happens" result without corrupting that signal.
function disableAddToCart() {
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('.add-to-cart, #heroDealAdd');
        if (!btn) return;
        e.preventDefault();
        e.stopImmediatePropagation();
    }, true);
}

// Pattern 5 (5.2): checkout.html's real .account-chip stays exactly as real
// app.js leaves it — wrapped in a `display:none` div by design, but still
// correctly carrying data-identity-state='recognized'/data-member-tier='plus'
// from the real ?identity=logged-in&member_tier=plus URL params. Left
// deliberately UNREVEALED: tag.js reads DOM attributes off a serialized
// HTML string (see scrubPII), not the live rendered page, so a hidden
// element's data-identity-state is captured exactly the same as a visible
// one — the conflict with the loyalty prompt below is invisible on-screen
// but still caught in the payload, which is the more interesting story.

// Pattern 5 (5.2): checkout.html has no real "join the loyalty program"
// prompt module anywhere — this injects a demo-only one into the order
// summary sidebar, deliberately carrying its OWN data-identity-state
// ('guest') independent of whatever the header chip says, so the two
// components can visibly disagree about the shopper's identity on the same
// page. data-component='prompt' matches the spec's DOM contract.
function renderLoyaltyPromptOverride(config) {
    const summary = document.querySelector('.checkout-summary');
    if (!summary) return;
    const el = document.createElement('div');
    el.className = 'loyalty-prompt';
    el.dataset.component = 'prompt';
    el.dataset.identityState = config.identityState || 'guest';
    el.style.cssText = 'margin-top:1rem;padding:0.85rem 1rem;background:#f4f6fa;border-radius:10px;font-size:0.85rem;text-align:center;color:var(--navy,#10243e);';
    el.textContent = config.text || 'Not a member? Join for 5% off.';
    summary.appendChild(el);
}

// Pattern 5 (5.3): sets the header cart badge to an explicit count on a
// non-cart page (homepage/category), independent of real cart storage —
// this scenario needs "2" on the homepage and "0" on the category page
// after a plain navigation, with no add/remove interaction in between, to
// show cart state silently vanishing across a page load.
function overrideCartBadge(count) {
    document.querySelectorAll('[data-cart-count]').forEach(node => {
        node.dataset.cartCount = count;
        node.textContent = String(count);
    });
}

// Pattern 5 (5.4): same idea as overrideCartBadge above, but for the header
// wishlist icon — homepage needs to show "3" (staged; real wishlist storage
// is empty in demo mode) so clicking through to the real, genuinely empty
// category.html?wishlist=true view is a visible contradiction.
function overrideWishlistBadge(count) {
    document.querySelectorAll('[data-wishlist-count]').forEach(node => {
        node.dataset.wishlistCount = count;
        node.textContent = String(count);
    });
}

// Pattern 2 (2.4): overrides the real "Deal of the day" spotlight card
// (#heroDealName/#heroDealPrice/#heroDealOld, populated by app.js on every
// homepage visit) to show a product at its full catalog price with the
// strikethrough/old-price cleared — i.e. no actual discount — while the
// real countdown timer elsewhere on the page keeps ticking down unchanged.
function renderDealOfDayOverride(sku) {
    const product = products.find(p => p.id === sku);
    if (!product) {
        console.error(`[AIORA DEMO] Unknown SKU "${sku}" for dealOfDayOverride — check products.js`);
        return;
    }
    const card = document.querySelector('.hero-deal-card');
    if (card) card.dataset.productId = product.id;
    const nameEl = document.querySelector('#heroDealName');
    if (nameEl) nameEl.textContent = product.name;
    const priceEl = document.querySelector('#heroDealPrice');
    // Full catalog (undiscounted) price — product.oldPrice — shown as the
    // CURRENT price, not product.price (which is the real, discounted one).
    if (priceEl) priceEl.textContent = money(product.oldPrice);
    const oldEl = document.querySelector('#heroDealOld');
    if (oldEl) oldEl.textContent = ''; // no strikethrough price shown = no discount
}

// Pattern 2 (2.5): overrides the real newsletter section's paragraph text
// and tags the section itself with explicit claim attributes, so its
// member-only percentage claim is directly comparable — via tag.js's
// buildModule()/extractClaim() reuse — against the real, always-on
// Shopora Plus loyalty claim in the header rail.
function renderNewsletterOverride(newsletter) {
    const section = document.querySelector('.newsletter');
    if (!section) {
        console.error('[AIORA DEMO] .newsletter section not found on this page.');
        return;
    }
    if (newsletter.claim_percent != null) section.dataset.claimPercent = newsletter.claim_percent;
    if (newsletter.claim_scope) section.dataset.claimScope = newsletter.claim_scope;
    if (newsletter.text) {
        const p = section.querySelector('p');
        if (p) p.textContent = newsletter.text;
    }
}

// =====================================================================
// CART & SAVINGS — covers all five Pattern 1 scenarios. Mirrors the REAL
// markup app.js's own renderCart() produces and the REAL element IDs
// verified in cart.html.
// =====================================================================
function renderCart(cart) {
    const itemsEl = document.querySelector('#cartItems');
    if (!itemsEl) {
        console.error('[AIORA DEMO] #cartItems not found on this page.');
        return;
    }

    // products.js uses `id`, not `sku`. An explicit `price` on an item
    // entry overrides the real catalog price (4.5: staged prices to hit an
    // exact cart total) — old price/discount are suppressed in that case
    // since they'd otherwise show a strikethrough/badge computed off the
    // real catalog price, which wouldn't mathematically match the override.
    const resolvedItems = cart.items.map(({ sku, qty, note, price: priceOverride }) => {
        const product = products.find(p => p.id === sku);
        if (!product) {
            console.error(`[AIORA DEMO] Unknown SKU "${sku}" — check products.js`);
            return { sku, qty, note, name: sku, price: 0, lineTotal: 0 };
        }
        const price = priceOverride != null ? priceOverride : product.price;
        return {
            sku, qty, note,
            name: product.name,
            price,
            category: product.category,
            description: product.description,
            oldPrice: priceOverride != null ? null : product.oldPrice,
            discount: priceOverride != null ? null : product.discount,
            lineTotal: +(price * qty).toFixed(2)
        };
    });

    const subtotal = +resolvedItems.reduce((sum, i) => sum + i.lineTotal, 0).toFixed(2);
    const totalSavings = +(cart.savings_breakdown || []).reduce((sum, s) => sum + s.amount, 0).toFixed(2);
    // shipping_label is a display string ("FREE delivery" or "$5.99") — parse
    // out the numeric delivery cost so it's actually reflected in the total.
    const deliveryMatch = (cart.shipping_label || '').match(/[\d.]+/);
    const deliveryCost = deliveryMatch ? Number(deliveryMatch[0]) : 0;
    const total = cart.override_total !== undefined ? cart.override_total : +(subtotal + deliveryCost - totalSavings).toFixed(2);
    const itemCount = resolvedItems.reduce((sum, i) => sum + i.qty, 0);

    itemsEl.innerHTML = resolvedItems.map(item => {
        // Mirrors app.js's own applyVisual() sprite-positioning logic, so
        // the demo cart shows the same product image as the real cart.
        const spriteIndex = Math.max(0, Number(item.sku.split('-')[1]) - 1);
        const spriteX = (spriteIndex % 5) * 25 + '%';
        const spriteY = Math.floor(spriteIndex / 5) * 50 + '%';
        const oldPriceTotal = item.oldPrice ? +(item.oldPrice * item.qty).toFixed(2) : null;
        return `
    <article class="cart-item" data-cart-id="${item.sku}" data-product-id="${item.sku}">
      <div class="product-image sprite-${item.category}" style="--sprite-x:${spriteX};--sprite-y:${spriteY}"></div>
      <div>
        <h3>${item.name}</h3>
        <p class="cart-item-meta">${item.description || ''}</p>
        <p class="cart-item-meta" data-availability="in-stock"><b>In stock</b> · FREE returns</p>
        ${item.note ? `<p class="cart-item-meta cart-item-note" style="color:#b45309;">${item.note}</p>` : ''}
        <div class="cart-item-actions">
          <div class="quantity-control"><button disabled>−</button><span>${item.qty}</span><button disabled>+</button></div>
        </div>
      </div>
      <div class="cart-item-price">
        <strong class="cart-item-total">${money(item.lineTotal)}</strong>
        ${oldPriceTotal ? `<del>${money(oldPriceTotal)}</del>` : ''}
        ${item.discount ? `<small>${item.discount} off</small>` : ''}
      </div>
    </article>
  `;
    }).join('');

    const set = (id, text) => { const el = document.querySelector(id); if (el) el.textContent = text; };
    set('#summaryItems', String(itemCount));
    set('#cartItemLabel', `${itemCount} ${itemCount === 1 ? 'item' : 'items'}`);
    set('#summarySubtotal', money(subtotal));

    // Per-unit price breakdown next to "Items (N)" — only shown when it's
    // unambiguous (a single SKU with qty > 1), e.g. "(2 × $18.99 = $37.98)".
    // This also gives a real per-unit price a place to exist in the DOM,
    // since cart rows themselves only ever show the line total.
    /* we need to add attr. here , app.js and tag.js as well
    const existingBreakdown = document.querySelector('[data-demo-qty-breakdown]');
    if (existingBreakdown) existingBreakdown.remove();
    if (resolvedItems.length === 1 && resolvedItems[0].qty > 1) {
        const only = resolvedItems[0];
        const itemsLabel = document.querySelector('#summaryItems')?.parentElement;
        if (itemsLabel) {
            itemsLabel.insertAdjacentHTML('beforeend', ` <small data-demo-qty-breakdown style="color:var(--muted);font-weight:500;">(${only.qty} × ${money(only.price)} = ${money(only.lineTotal)})</small>`);
        }
    }*/
    if (cart.shipping_label !== undefined) set('#summaryDelivery', cart.shipping_label);

    // app.js's #shippingProgress banner is computed off the real (leftover)
    // cart subtotal, not this demo's data — it can claim "FREE delivery
    // unlocked" while the summary panel charges for delivery. Override it so
    // the banner agrees with what the demo actually shows.
    const shippingProgress = document.querySelector('#shippingProgress');
    if (shippingProgress) {
        const FREE_DELIVERY_MIN = 35; // mirrors app.js's own threshold
        const remaining = Math.max(0, FREE_DELIVERY_MIN - subtotal);
        const pct = Math.min(100, (subtotal / FREE_DELIVERY_MIN) * 100);
        if (cart.shippingNudgeOverride) {
            // Pattern 2 (2.2): a deliberately WRONG nudge message — the
            // header elsewhere on the page still claims the real $35
            // threshold, so this creates a genuine claim-vs-nudge
            // disagreement instead of the accurate-by-construction nudge
            // every other cart scenario gets below.
            shippingProgress.innerHTML = `<p>${cart.shippingNudgeOverride}</p><div class="progress-track"><i style="width:${pct}%"></i></div>`;
        } else {
            shippingProgress.innerHTML = deliveryCost === 0
                ? '<p><strong>✓ You unlocked FREE delivery!</strong></p><div class="progress-track"><i style="width:100%"></i></div>'
                : `<p>Spend <strong>${money(remaining)}</strong> more to unlock free delivery — delivery is ${money(deliveryCost)} on this order</p><div class="progress-track"><i style="width:${pct}%"></i></div>`;
        }
    }
    set('#summarySavings', money(totalSavings)); // single aggregate value — see comment above on why it can't hold child rows
    set('#summaryTotal', money(total));

    // Header cart-count badge — kept in sync so Pattern 1 doesn't accidentally
    // create a Pattern-5-style cart-count mismatch by omission.
    const cartBadge = document.querySelector('[data-cart-count]');
    if (cartBadge) {
        cartBadge.dataset.cartCount = itemCount;
        cartBadge.textContent = itemCount;
    }

    renderSavingsBreakdown(cart.savings_breakdown || []);
}

// =====================================================================
// PROMO OVERRIDE — Pattern 4 (4.4/4.5). Applies a promo-code result
// (accepted/rejected) on top of whatever cart is REALLY there — doesn't
// touch cart items at all, so an "add any product, then click cart" flow
// (see welcome-code-promise's navOverrides) shows the actual product the
// user picked, not a hardcoded SKU. data-promo-state/applied-code are
// read by tag.js's extractCartState(); the reason message reuses tag.js's
// EXISTING .promo-error selector (FIELD_SEL.promoInlineReason) — no
// tag.js change needed for either.
// =====================================================================
function applyPromoOverride(promo) {
    const promoInput = document.querySelector('#promoInput, .promo-input');
    if (!promoInput) return;
    const promoField = promoInput.closest('.promo-field') || promoInput.parentElement;
    if (!promoField) return;

    promoField.dataset.promoState = promo.state;
    if (promo.code) { promoField.dataset.appliedCode = promo.code; promoInput.value = promo.code; }
    if (promo.reason) {
        promoField.dataset.inlineReason = promo.reason;
        // The real field is a plain flex row (input + Apply button, no
        // wrap) — force it to wrap so the message drops to its own line
        // below, instead of squeezing the input/button into slivers.
        promoField.style.flexWrap = 'wrap';
        let msgEl = promoField.querySelector('.promo-error');
        if (!msgEl) {
            msgEl = document.createElement('small');
            msgEl.className = 'promo-error';
            msgEl.style.cssText = 'flex-basis:100%;color:#b42318;margin-top:0.4rem;';
            promoField.appendChild(msgEl);
        }
        msgEl.textContent = promo.reason;
    }

    // The real #applyPromoBtn calls app.js's own applyPromo(), which checks
    // a REAL promo-code table — WELCOME10 is a genuinely valid code there
    // (used by Pattern 1's welcome-code-returning-member), so a live click
    // would silently accept it for real, contradicting this scenario's
    // whole "rejected" story. Disabling the button means the browser never
    // fires a click event on it at all, so app.js's real handler can't run.
    const applyBtn = document.querySelector('#applyPromoBtn');
    if (applyBtn) applyBtn.disabled = true;
}


// =====================================================================
// CHECKOUT OVERRIDE — Pattern 4 (4.3). checkout.html's real renderCheckout()
// (app.js) reads from the real, persisted cart, same problem renderCart()
// solves on cart.html — this replaces #checkoutItems/#checkoutSubtotal/
// #checkoutDelivery/#checkoutTotal directly with fixed scenario data,
// including an overridden delivery fee + its visible row label (real
// element/selector — tag.js's existing FIELD_SEL.checkoutDelivery already
// reads #checkoutDelivery into t2.delivery_cost, no tag.js change needed).
// =====================================================================
function renderCheckoutOverride(checkout) {
    const itemsEl = document.querySelector('#checkoutItems');
    if (!itemsEl) {
        console.error('[AIORA DEMO] #checkoutItems not found on this page.');
        return;
    }

    const resolvedItems = (checkout.items || []).map(({ sku, qty }) => {
        const product = products.find(p => p.id === sku);
        if (!product) {
            console.error(`[AIORA DEMO] Unknown SKU "${sku}" — check products.js`);
            return { sku, qty, name: sku, category: 'electronics', lineTotal: 0 };
        }
        return { sku, qty, name: product.name, category: product.category, lineTotal: +(product.price * qty).toFixed(2) };
    });

    // Mirrors app.js's own applyVisual()/renderCart()'s sprite-positioning
    // logic, so checkout items show the same product image as everywhere
    // else instead of a blank placeholder box.
    itemsEl.innerHTML = resolvedItems.length ? resolvedItems.map(item => {
        const spriteIndex = Math.max(0, Number(item.sku.split('-')[1]) - 1);
        const spriteX = (spriteIndex % 5) * 25 + '%';
        const spriteY = Math.floor(spriteIndex / 5) * 50 + '%';
        return `
    <div class="mini-item" data-mini-id="${item.sku}">
      <div class="product-image sprite-${item.category}" style="--sprite-x:${spriteX};--sprite-y:${spriteY}"></div>
      <div><p>${item.name}</p><small>Qty ${item.qty}</small></div>
      <strong>${money(item.lineTotal)}</strong>
    </div>
  `;
    }).join('') : '<div class="cart-empty"><p>Your cart is empty.</p><a class="button button-primary" href="./category.html">Shop products</a></div>';

    const subtotal = +resolvedItems.reduce((sum, i) => sum + i.lineTotal, 0).toFixed(2);
    const set = (id, text) => { const el = document.querySelector(id); if (el) el.textContent = text; };
    set('#checkoutSubtotal', money(subtotal));

    // app.js's restructured summary (Items / markdown / Total savings) is built
    // from the REAL cart, which this staged checkout replaces — the scenario
    // stages no savings, so hide those rows rather than let real-cart values
    // (or a real markdown construct) sit next to the staged items.
    ['#checkoutItemsRow', '#checkoutMarkdownRow', '#checkoutSavingsRow'].forEach((sel) => {
        const rowEl = document.querySelector(sel);
        if (rowEl) { rowEl.style.display = 'none'; delete rowEl.dataset.discountType; }
    });

    const shippingFee = checkout.shippingFee || 0;
    const deliveryEl = document.querySelector('#checkoutDelivery');
    if (deliveryEl) {
        deliveryEl.textContent = shippingFee ? money(shippingFee) : 'FREE';
        var row = deliveryEl.closest('.summary-row');
        var labelEl = row && row.querySelector('span');
        if (labelEl && checkout.shippingLabel) labelEl.textContent = checkout.shippingLabel;
    }

    set('#checkoutTotal', money(+(subtotal + shippingFee).toFixed(2)));

    const placeOrderBtn = document.querySelector('#placeOrderButton');
    if (placeOrderBtn) placeOrderBtn.disabled = !resolvedItems.length;
}

function renderSavingsBreakdown(components) {
    document.querySelectorAll('[data-demo-savings-row]').forEach(el => el.remove());

    // Whenever a demo cart override is active, it's authoritative over the
    // cart summary — always strip the real Shopora Plus member-discount row
    // app.js may have auto-injected (#plusMemberRow/#coPlusMemberRow),
    // regardless of whether this override includes its own loyalty line.
    // Pattern 5.5 needs NO loyalty component at all (member identified, but
    // pricing not applied) yet still needs the real row gone — the old
    // `&& hasOwnLoyaltyLine` guard would have left it sitting there. Removed
    // outright rather than hidden — display:none left it in the DOM as a
    // genuinely-hidden discount, which tag.js's hidden-content detector
    // correctly flags as suspicious (a real discount hidden from the
    // customer).
    const autoPlusRow = document.querySelector('#plusMemberRow, #coPlusMemberRow');
    if (autoPlusRow) autoPlusRow.remove();

    const totalRow = document.querySelector('#summaryTotal')?.closest('.summary-row');
    if (!totalRow) {
        console.warn('[AIORA DEMO] Could not find the total row to insert savings breakdown before.');
        return;
    }

    // SPEC: Savings breakdown section (.savings-display) contains separate
    // .savings-component divs, each with data-component-type and data-amount.
    // display:contents keeps this wrapper from affecting the existing
    // .summary-card layout — each child .summary-row still lays out exactly
    // as if it were a direct sibling.
    let savingsDisplay = document.querySelector('.savings-display');
    if (!savingsDisplay) {
        savingsDisplay = document.createElement('div');
        savingsDisplay.className = 'savings-display';
        savingsDisplay.style.display = 'contents';
        savingsDisplay.dataset.demoSavingsRow = 'true';
        totalRow.before(savingsDisplay);
    } else {
        savingsDisplay.innerHTML = '';
    }

    // Only the FIRST code-type discount reuses the site's real #promoRow —
    // this keeps the DOM structure identical to before for every scenario
    // that has just one code (the common case). If a scenario stacks a
    // SECOND code discount on top (only 1.5 does this today), #promoRow is
    // already taken, so it falls through and gets its own fresh row instead
    // — the old approach silently overwrote #promoRow's content the second
    // time, making the first code discount disappear from the screen.
    let promoRowClaimed = false;
    components.forEach(c => {
        if (c.type === 'code' && c.code && !promoRowClaimed) {
            const promoRow = document.querySelector('#promoRow');
            if (promoRow) {
                promoRowClaimed = true;
                promoRow.hidden = false;
                // app.js's own renderCart() runs first (module top-level,
                // before this DOMContentLoaded handler) and sets
                // style.display='none' on this row when the real cart has
                // no active promo. Clearing the `hidden` attribute alone
                // isn't enough — the inline style still wins and keeps the
                // row invisible (which tag.js correctly detects and flags).
                promoRow.style.display = '';
                // Real classes tag.js actually reads, plus the spec's
                // literal .savings-component class.
                promoRow.classList.add('savings-component', 'cart-discount', 'promo-applied');
                promoRow.dataset.demoSavingsRow = 'true';
                promoRow.dataset.discountType = c.type;
                promoRow.dataset.componentType = c.type;
                promoRow.dataset.amount = c.amount.toFixed(2);

                // Replace the native "Promo (CODE) Remove" boilerplate
                // entirely — its wrapper text and original HTML whitespace
                // were leaking into tag.js's applied_discount_constructs
                // (e.g. "Promo\n    (WELCOME10) Remove-$6.00"). Same clean
                // two-part shape as the other savings rows instead.
                promoRow.innerHTML = `<span class="promo-name">${c.label}</span> <strong class="promo-amount">-${money(c.amount)}</strong>`;

                savingsDisplay.appendChild(promoRow);
            }
            return;
        }

        let cls;
        if (c.type === 'loyalty') cls = 'loyalty-discount';
        else if (c.type === 'code') cls = 'cart-discount promo-applied'; // 2nd+ code, no #promoRow left
        else cls = 'discount-line'; // markdown / sale — visible, but not a "promotion"
        const row = document.createElement('div');
        row.className = `summary-row savings savings-component ${cls}`;
        row.dataset.demoSavingsRow = 'true';
        row.dataset.discountType = c.type; // real: matches [data-discount-type]
        // data-component-type / data-amount: not read by tag.js today, kept for
        // forward compatibility with the intended future contract.
        row.dataset.componentType = c.type;
        row.dataset.amount = c.amount.toFixed(2);
        row.innerHTML = `<span class="promo-name">${c.label}</span> <strong class="promo-amount">-${money(c.amount)}</strong>`;
        savingsDisplay.appendChild(row);
    });

    // Move the "You save" aggregate row to right above the total, after all
    // the individual discount lines, so the overall savings figure is the
    // last thing seen before the final price.
    const savingsRow = document.querySelector('#summarySavings')?.closest('.summary-row');
    if (savingsRow) {
        totalRow.before(savingsRow);
        // Bold the whole row so "You save" reads as the aggregate figure,
        // visually distinct from the individual discount lines above it.
        savingsRow.style.fontWeight = '800';
    }
}


// =====================================================================
// HERO OVERRIDE — Pattern 2 (2.1). Overrides the real homepage hero's
// headline text and adds a category scope to its claim, so the claim
// tag.js's Tier 6 extractClaim() reads (data-claim-percent is already
// baked into the real .hero markup at 35 — this scenario just needs to
// scope that existing claim to "electronics" and match the spec's exact
// headline wording).
// =====================================================================
function renderHeroOverride(hero) {
    const heroSection = document.querySelector('.hero');
    if (!heroSection) {
        console.error('[AIORA DEMO] .hero section not found on this page.');
        return;
    }
    heroSection.dataset.moduleType = 'hero';
    if (hero.claim_scope) heroSection.dataset.claimScope = hero.claim_scope;
    if (hero.claim_amount != null) {
        heroSection.dataset.claimAmount = hero.claim_amount;
        heroSection.dataset.claimType = 'dollar_off';
        // The real hero section's own static markup carries its own
        // percent claim (data-claim-percent="35", code SUMMER35, min-spend
        // $50 — see index.html) — a dollar-off scenario needs to fully
        // REPLACE those, not just add its own claim_amount alongside them,
        // or extractClaim() picks up both the real percent AND the staged
        // dollar figure at once.
        heroSection.removeAttribute('data-claim-percent');
        if (hero.claim_code) heroSection.dataset.claimCode = hero.claim_code;
        if (hero.claim_min_spend != null) heroSection.dataset.claimMinSpend = hero.claim_min_spend;
        // The real visible promo-code line right under the headline also
        // still says "35% off orders over $50" regardless of scenario —
        // replace it so what's on screen matches the claim being tested.
        const promoCodeEl = heroSection.querySelector('.hero-promo-code');
        if (promoCodeEl && hero.claim_code) {
            promoCodeEl.innerHTML = `Use code <strong>${hero.claim_code}</strong> for $${hero.claim_amount} off orders over $${hero.claim_min_spend}`;
        }
    }
    if (hero.headline) {
        const h1 = heroSection.querySelector('.hero-copy h1, h1');
        if (h1) h1.textContent = hero.headline;
    }
}

function ratingCountFor(id) {
    return 120 + [...id].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) * 9;
}

// =====================================================================
// FEATURED TILES — Pattern 2 (2.1). Replaces the real #featuredGrid's
// default product mix with an explicit SKU list, using the site's own
// #productCardTemplate so the resulting cards are identical in shape to
// what app.js's buildProductCard() would produce.
// =====================================================================
function renderFeaturedTiles(skus) {
    const grid = document.querySelector('#featuredGrid');
    const template = document.querySelector('#productCardTemplate');
    if (!grid || !template) {
        console.error('[AIORA DEMO] #featuredGrid or #productCardTemplate not found.');
        return;
    }
    grid.innerHTML = '';
    skus.forEach(sku => {
        const product = products.find(p => p.id === sku);
        if (!product) {
            console.error(`[AIORA DEMO] Unknown SKU "${sku}" — check products.js`);
            return;
        }
        const card = template.content.firstElementChild.cloneNode(true);

        // Mirrors app.js's own applyVisual() sprite-positioning logic.
        const spriteIndex = Math.max(0, Number(product.id.split('-')[1]) - 1);
        const img = card.querySelector('.product-image');
        img.classList.add(`sprite-${product.category}`);
        img.style.setProperty('--sprite-x', (spriteIndex % 5) * 25 + '%');
        img.style.setProperty('--sprite-y', Math.floor(spriteIndex / 5) * 50 + '%');

        card.dataset.productId = product.id;
        card.dataset.brand = product.name.split(' ')[0];
        card.dataset.category = product.category;
        card.dataset.sponsored = 'false';
        card.dataset.availability = product.availability || 'in-stock';
        card.querySelector('.discount-badge').textContent = `${product.discount} OFF`;
        card.querySelector('.product-brand').textContent = product.brand;
        card.querySelector('h3').textContent = product.name;
        card.querySelector('.stars').textContent = `${product.rating.toFixed(1)} ★`;
        card.querySelector('.rating-count').textContent = ratingCountFor(product.id).toLocaleString('en-IN');
        card.querySelector('.product-meta').textContent = product.description;
        card.querySelector('.price-stack strong').textContent = money(product.price);
        card.querySelector('.price-stack del').textContent = money(product.oldPrice);
        card.querySelector('.price-stack span').textContent = `Save ${money(product.oldPrice - product.price)}`;

        grid.appendChild(card);
    });
}


// =====================================================================
// CATEGORY TILES — Pattern 3 (3.2+). The real category.html filters/sorts
// #catalogGrid dynamically (renderCatalog() in app.js) — this wipes and
// rebuilds it with a fixed SKU order, same sprite/card logic as
// renderFeaturedTiles(), so brand-concentration scenarios are deterministic
// regardless of the real catalog's natural sort.
// =====================================================================
function renderCategoryTiles(skus) {
    const grid = document.querySelector('#catalogGrid');
    const template = document.querySelector('#productCardTemplate');
    if (!grid || !template) {
        console.error('[AIORA DEMO] #catalogGrid or #productCardTemplate not found.');
        return;
    }
    grid.innerHTML = '';
    skus.forEach(sku => {
        const product = products.find(p => p.id === sku);
        if (!product) {
            console.error(`[AIORA DEMO] Unknown SKU "${sku}" — check products.js`);
            return;
        }
        const card = template.content.firstElementChild.cloneNode(true);

        const spriteIndex = Math.max(0, Number(product.id.split('-')[1]) - 1);
        const img = card.querySelector('.product-image');
        img.classList.add(`sprite-${product.category}`);
        img.style.setProperty('--sprite-x', (spriteIndex % 5) * 25 + '%');
        img.style.setProperty('--sprite-y', Math.floor(spriteIndex / 5) * 50 + '%');

        card.dataset.productId = product.id;
        card.dataset.brand = product.name.split(' ')[0];
        card.dataset.category = product.category;
        card.dataset.sponsored = 'false';
        card.dataset.availability = product.availability || 'in-stock';
        card.querySelector('.discount-badge').textContent = `${product.discount} OFF`;
        card.querySelector('.product-brand').textContent = product.brand;
        card.querySelector('h3').textContent = product.name;
        card.querySelector('.stars').textContent = `${product.rating.toFixed(1)} ★`;
        card.querySelector('.rating-count').textContent = ratingCountFor(product.id).toLocaleString('en-IN');
        card.querySelector('.product-meta').textContent = product.description;
        card.querySelector('.price-stack strong').textContent = money(product.price);
        card.querySelector('.price-stack del').textContent = money(product.oldPrice);
        card.querySelector('.price-stack span').textContent = `Save ${money(product.oldPrice - product.price)}`;

        // app.js's real addToCart() is private to its own module scope, and
        // the destination cart page (when a scenario chains into one, e.g.
        // 4.2's bogo-broken-cart) is fully scripted regardless of what's
        // "really" added — so this just bumps the header badge visually,
        // for a realistic click response, without touching real cart storage.
        const addBtn = card.querySelector('.add-to-cart');
        if (addBtn) {
            addBtn.addEventListener('click', () => {
                document.querySelectorAll('[data-cart-count]').forEach(node => {
                    node.textContent = String((parseInt(node.textContent, 10) || 0) + 1);
                });
            });
        }

        grid.appendChild(card);
    });
}


// =====================================================================
// SEARCH RESULTS — Pattern 3 (3.3). search.html doesn't exist as a real
// Shopora page (no real search backend) — it's a demo-only destination
// that only ever renders through this override. Each tile entry may be a
// real SKU (looked up in products.js for accurate name/price/rating) or a
// fully ad-hoc object for catalog-only demo variants (e.g. "PulseTune
// Sport Earbuds") that don't exist as real products.
// =====================================================================
function renderSearchResults(config) {
    const heading = document.querySelector('#searchHeading');
    if (heading && config.query) heading.textContent = `Showing results for "${config.query}"`;

    const grid = document.querySelector('#searchGrid');
    const template = document.querySelector('#productCardTemplate');
    if (!grid || !template) {
        console.error('[AIORA DEMO] #searchGrid or #productCardTemplate not found.');
        return;
    }
    grid.innerHTML = '';
    let adHocSpriteIndex = 0;
    (config.tiles || []).forEach(entry => {
        const real = products.find(p => p.id === entry.sku);
        const item = real || entry;
        const card = template.content.firstElementChild.cloneNode(true);

        const numericMatch = item.id ? item.id.match(/-(\d+)$/) : null;
        const spriteIndex = numericMatch ? Math.max(0, Number(numericMatch[1]) - 1) : (adHocSpriteIndex++ % 12);
        const img = card.querySelector('.product-image');
        img.classList.add(`sprite-${item.category || 'electronics'}`);
        img.style.setProperty('--sprite-x', (spriteIndex % 5) * 25 + '%');
        img.style.setProperty('--sprite-y', Math.floor(spriteIndex / 5) * 50 + '%');

        card.dataset.productId = item.id || entry.sku;
        card.dataset.brand = item.brand;
        card.dataset.category = item.category || 'electronics';
        card.dataset.sponsored = 'false';
        card.dataset.availability = item.availability || 'in-stock';
        card.querySelector('.discount-badge').textContent = `${item.discount} OFF`;
        card.querySelector('.product-brand').textContent = item.brand;
        card.querySelector('h3').textContent = item.name;
        card.querySelector('.stars').textContent = `${(item.rating || 4.5).toFixed(1)} ★`;
        card.querySelector('.rating-count').textContent = ratingCountFor(item.id || entry.sku).toLocaleString('en-IN');
        card.querySelector('.product-meta').textContent = item.description || '';
        card.querySelector('.price-stack strong').textContent = money(item.price);
        card.querySelector('.price-stack del').textContent = money(item.oldPrice);
        card.querySelector('.price-stack span').textContent = `Save ${money(item.oldPrice - item.price)}`;

        grid.appendChild(card);
    });
}


// =====================================================================
// CART RECOMMENDATIONS — Pattern 3 (3.4). The real #recommendedGrid always
// shows some mix of other products below the cart; this overrides it with
// a fixed SKU list (same real-SKU-or-ad-hoc pattern as renderSearchResults)
// and tags the always-real .cart-recommendations section with
// data-module-type/data-parent-context so tag.js's new recommendations
// module block can report which cart item the recs are supposedly for.
// =====================================================================
function renderCartRecommendations(config) {
    const section = document.querySelector('.cart-recommendations');
    if (section) {
        section.dataset.moduleType = 'recommendations';
        section.dataset.parentContext = config.parentContext;
    }

    const grid = document.querySelector('#recommendedGrid');
    const template = document.querySelector('#productCardTemplate');
    if (!grid || !template) {
        console.error('[AIORA DEMO] #recommendedGrid or #productCardTemplate not found.');
        return;
    }
    grid.innerHTML = '';
    let adHocSpriteIndex = 0;
    (config.tiles || []).forEach(entry => {
        const real = products.find(p => p.id === entry.sku);
        const item = real || entry;
        const card = template.content.firstElementChild.cloneNode(true);

        const numericMatch = item.id ? item.id.match(/-(\d+)$/) : null;
        const spriteIndex = numericMatch ? Math.max(0, Number(numericMatch[1]) - 1) : (adHocSpriteIndex++ % 12);
        const img = card.querySelector('.product-image');
        img.classList.add(`sprite-${item.category || 'electronics'}`);
        img.style.setProperty('--sprite-x', (spriteIndex % 5) * 25 + '%');
        img.style.setProperty('--sprite-y', Math.floor(spriteIndex / 5) * 50 + '%');

        card.dataset.productId = item.id || entry.sku;
        card.dataset.brand = item.brand;
        card.dataset.category = item.category || 'electronics';
        card.dataset.sponsored = 'false';
        card.dataset.availability = item.availability || 'in-stock';
        card.querySelector('.discount-badge').textContent = `${item.discount} OFF`;
        card.querySelector('.product-brand').textContent = item.brand;
        card.querySelector('h3').textContent = item.name;
        card.querySelector('.stars').textContent = `${(item.rating || 4.5).toFixed(1)} ★`;
        card.querySelector('.rating-count').textContent = ratingCountFor(item.id || entry.sku).toLocaleString('en-IN');
        card.querySelector('.product-meta').textContent = item.description || '';
        card.querySelector('.price-stack strong').textContent = money(item.price);
        card.querySelector('.price-stack del').textContent = money(item.oldPrice);
        card.querySelector('.price-stack span').textContent = `Save ${money(item.oldPrice - item.price)}`;

        grid.appendChild(card);
    });
}


// =====================================================================
// CLAIMS — generic claim-attribute setter for Pattern 2 scenarios that
// target an arbitrary existing module by ID (2.1 uses renderHeroOverride()
// above instead, since it also needs to swap headline text and tile SKUs).
// tag.js's Tier 6 extractClaim() now reads data-claim-percent/type/scope/
// code/min-spend off any element — this just sets those attributes.
// =====================================================================
function renderClaims(claims) {
    claims.forEach(claim => {
        const el = document.querySelector(`[data-module-id="${claim.moduleId}"]`);
        if (!el) return console.warn(`[AIORA DEMO] Claim target not found: ${claim.moduleId}`);
        if (claim.percent != null) el.dataset.claimPercent = claim.percent;
        if (claim.amount != null) el.dataset.claimAmount = claim.amount;
        if (claim.threshold != null) el.dataset.claimThreshold = claim.threshold;
        if (claim.type) el.dataset.claimType = claim.type;
        if (claim.scope) el.dataset.claimScope = claim.scope;
        if (claim.text) el.textContent = claim.text;
    });
}


// =====================================================================
// TILE OVERRIDES — Pattern 3+. No Pattern 1 scenario uses this either.
// =====================================================================
function applyTileOverrides(tiles) {
    (tiles.brandOverrides || []).forEach(({ sku, brand }) => {
        const card = document.querySelector(`[data-product-id="${sku}"]`);
        if (!card) return;
        card.dataset.brand = brand; // not read by tag.js, kept for forward compatibility
        // tag.js's real brand selector reads the VISIBLE .product-brand text,
        // never a data-brand attribute — that's the field that must change.
        const brandEl = card.querySelector('.product-brand');
        if (brandEl) brandEl.textContent = brand;
    });
    (tiles.sponsoredSkus || []).forEach(sku => {
        const card = document.querySelector(`[data-product-id="${sku}"]`);
        if (!card) return;
        card.dataset.sponsored = 'true';
        // Visible "Sponsored" badge — '.sponsored-label' is also one of the
        // classes tag.js's own sponsored selector checks (redundant with the
        // data attribute), and it's what lets this be verified visually.
        // Wrapped together with the discount badge in one flex item so the
        // row's justify-content:space-between doesn't push them apart.
        const badgeRow = card.querySelector('.product-badge-row');
        const discountBadge = badgeRow && badgeRow.querySelector('.discount-badge');
        if (badgeRow && discountBadge && !badgeRow.querySelector('.sponsored-label')) {
            const wrapper = document.createElement('span');
            wrapper.style.cssText = 'display:flex;align-items:center;gap:0.4rem;';
            const label = document.createElement('span');
            label.className = 'sponsored-label';
            label.textContent = 'Sponsored';
            label.style.cssText = 'background:#fff3cd;color:#856404;font-size:0.65rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;padding:2px 6px;border-radius:4px;';
            discountBadge.parentNode.insertBefore(wrapper, discountBadge);
            wrapper.appendChild(label);
            wrapper.appendChild(discountBadge);
        }
    });
    (tiles.bogoSkus || []).forEach(sku => {
        const card = document.querySelector(`[data-product-id="${sku}"]`);
        if (!card) return;
        card.dataset.bogo = 'true';
        // Visible "BOGO" badge — '.product-label' is one of the classes
        // tag.js's badges-array selector (FIELD_SEL.generalBadges) already
        // reads, grouped with the discount badge so the row's
        // justify-content:space-between doesn't push them apart (same fix
        // used for the Sponsored badge above).
        const badgeRow = card.querySelector('.product-badge-row');
        const discountBadge = badgeRow && badgeRow.querySelector('.discount-badge');
        if (badgeRow && discountBadge && !badgeRow.querySelector('.product-label')) {
            const wrapper = document.createElement('span');
            wrapper.style.cssText = 'display:flex;align-items:center;gap:0.4rem;';
            const label = document.createElement('span');
            label.className = 'product-label';
            label.textContent = 'BOGO: Buy One Get One Free';
            label.style.cssText = 'background:#e8f5e9;color:#1b5e20;font-size:0.6rem;font-weight:700;text-transform:uppercase;letter-spacing:0.02em;padding:2px 6px;border-radius:4px;';
            discountBadge.parentNode.insertBefore(wrapper, discountBadge);
            wrapper.appendChild(label);
            wrapper.appendChild(discountBadge);
        }
    });
    // 4.1: overrides a tile's visible discount badge text (e.g. "17% OFF" ->
    // "25% OFF") and, optionally, its displayed price — so the category tile
    // is internally consistent (badge % actually matches the price shown).
    // The coordination failure this demo captures isn't badge-vs-price on
    // the same tile; it's this genuinely-25%-off category price vs. the
    // worse price the PDP page (a different demo slug) actually charges.
    (tiles.discountOverrides || []).forEach(({ sku, badge, price }) => {
        const card = document.querySelector(`[data-product-id="${sku}"]`);
        if (!card) return;
        const badgeEl = card.querySelector('.discount-badge');
        if (badgeEl) badgeEl.textContent = badge;
        if (price != null) {
            const priceEl = card.querySelector('.price-stack strong');
            if (priceEl) priceEl.textContent = money(price);
            // Recompute "Save $X" from the tile's own old-price element
            // rather than hardcoding it, so it can't drift out of sync with
            // whatever price is actually shown.
            const oldPriceEl = card.querySelector('.price-stack del');
            const saveEl = card.querySelector('.price-stack span');
            if (oldPriceEl && saveEl) {
                const oldPrice = Number(oldPriceEl.textContent.replace(/[^0-9.]/g, ''));
                if (!isNaN(oldPrice)) saveEl.textContent = 'Save ' + money(oldPrice - price);
            }
        }
    });
}


// =====================================================================
// CATEGORY BANNER — Pattern 4 (4.1). category.html has no banner element
// of its own, so this injects one, reusing the .promo-banner class (and
// its existing CSS) that already exists for the homepage's promo tiles.
// =====================================================================
function renderCategoryBanner(banner) {
    const heading = document.querySelector('.catalog-heading');
    if (!heading) {
        console.error('[AIORA DEMO] .catalog-heading not found on this page.');
        return;
    }
    let bannerEl = document.querySelector('[data-demo-banner]');
    if (!bannerEl) {
        bannerEl = document.createElement('div');
        // .promo-banner + .promo-tech reuse the homepage's own polished
        // gradient-banner styling (same classes as "Smart tech. Smarter
        // prices.") instead of an unstyled div — free, on-brand visuals.
        bannerEl.className = 'promo-banner promo-tech';
        bannerEl.dataset.demoBanner = 'true';
        // Inserted INSIDE .catalog-heading, between the text block and the
        // "Filters & sort" button — sits beside the heading on the same
        // row, not as a block below it. align-self overrides the parent's
        // align-items:flex-end so this item is vertically centered.
        // justify-content:space-between pins the text to the far left and
        // the thumbnails to the far right, instead of clustering both on
        // one side with the rest of the banner left empty.
        bannerEl.style.cssText = 'display:flex;flex-direction:row;align-items:center;justify-content:space-between;flex:0 0 auto;align-self:center;box-sizing:border-box;margin:0 1.5rem;min-height:110px;padding:1rem 1.5rem;overflow:hidden;';
        const filterToggle = heading.querySelector('#filterToggle, .filter-toggle');
        if (filterToggle) heading.insertBefore(bannerEl, filterToggle);
        else heading.appendChild(bannerEl);
    }
    // Width matches .results-toolbar's actual rendered width, so the
    // banner's right edge lines up with the "12 products / Sort by" row
    // below it exactly, regardless of screen size — .catalog-heading spans
    // the full page width while .results-toolbar only spans the grid
    // column (narrower, offset past the sidebar), so a flex-filled banner
    // inside .catalog-heading otherwise overshoots the toolbar's width.
    const toolbar = document.querySelector('.results-toolbar');
    if (toolbar) bannerEl.style.width = toolbar.getBoundingClientRect().width + 'px';
    bannerEl.dataset.moduleType = 'banner';
    if (banner.claim_percent != null) bannerEl.dataset.claimPercent = banner.claim_percent;
    if (banner.claim_scope) bannerEl.dataset.claimScope = banner.claim_scope;
    // Compact sizing to fit inline within the heading row — configurable
    // per-scenario via banner.eyebrowSize/headlineSize/ctaSize (rem).
    const eyebrowSize = banner.eyebrowSize || 0.65;
    const headlineSize = banner.headlineSize || 1.5;
    const ctaSize = banner.ctaSize || 0.8;

    // Overlapping product thumbnail cluster, scaled down to fit this
    // compact row — same sprite technique as renderFeaturedTiles().
    const thumbSkus = banner.thumbnails || ['el-1', 'el-2', 'el-8'];
    const thumbsHtml = thumbSkus.map((sku, i) => {
        const product = products.find(p => p.id === sku);
        if (!product) return '';
        const spriteIndex = Math.max(0, Number(product.id.split('-')[1]) - 1);
        const spriteX = (spriteIndex % 5) * 25 + '%';
        const spriteY = Math.floor(spriteIndex / 5) * 50 + '%';
        const size = i % 2 === 0 ? 72 : 58;
        return `<div class="product-image sprite-${product.category}" style="--sprite-x:${spriteX};--sprite-y:${spriteY};width:${size}px;height:${size}px;border-radius:50%;background-color:#fff;box-shadow:0 6px 14px rgba(0,0,0,0.35);flex-shrink:0;margin-left:${i === 0 ? 0 : -14}px;"></div>`;
    }).join('');

    bannerEl.innerHTML = `
        <div style="flex:0 1 auto;min-width:0;">
            <span style="font-size:${eyebrowSize}rem;">${banner.eyebrow || 'ELECTRONICS SALE'}</span>
            <h2 style="font-size:${headlineSize}rem;">${banner.headline}</h2>
            <b style="font-size:${ctaSize}rem;">${banner.ctaText || 'Limited time — shop now →'}</b>
        </div>
        <div style="flex:0 0 auto;display:flex;align-items:center;padding-left:1rem;">${thumbsHtml}</div>
    `;
}


// pdp.html ships with a static placeholder #hero (data-sku="FAKE-123")
// that app.js's renderPDP() replaces with the real product once it finishes
// (which may be async, e.g. a Supabase fetch). Now that demo_router.js no
// longer waits on its own network fetch, it can otherwise run its PDP
// override BEFORE that replacement happens — the override would land on
// the placeholder and then get wiped out when app.js's real markup swaps
// in. This waits until #hero's data-sku is no longer the placeholder value
// before calling back, so the override always lands on the real content.
function waitForRealPdpHero(callback, maxWaitMs = 3000) {
    const isReal = (hero) => hero && hero.dataset.sku && hero.dataset.sku !== 'FAKE-123';
    const hero = document.querySelector('#hero');
    if (isReal(hero)) { callback(); return; }
    const observer = new MutationObserver(() => {
        if (isReal(document.querySelector('#hero'))) {
            observer.disconnect();
            clearTimeout(fallback);
            callback();
        }
    });
    observer.observe(document.querySelector('main') || document.body, { childList: true, subtree: true, attributes: true });
    const fallback = setTimeout(() => {
        observer.disconnect();
        console.warn('[AIORA DEMO] waitForRealPdpHero: gave up waiting, applying override anyway.');
        callback();
    }, maxWaitMs);
}

// =====================================================================
// PDP OVERRIDE — Pattern 4 (4.1). Overrides the real, already-rendered
// PDP price/discount badge (app.js's renderPDP() runs first, same
// script-load-order pattern as everywhere else in this file) and adds
// the fine-print exclusion note below the price.
// =====================================================================
function renderPdpOverride(pdp) {
    const hero = document.querySelector('#hero');
    if (!hero) {
        console.error('[AIORA DEMO] #hero not found on this page.');
        return;
    }
    const priceEl = hero.querySelector('.price-stack .price, .price-stack strong, .price');
    if (priceEl && pdp.price != null) priceEl.textContent = money(pdp.price);
    const badgeEl = hero.querySelector('.discount-badge');
    if (badgeEl && pdp.badge) badgeEl.textContent = pdp.badge;
    // The "Add to Cart — $X" button has its own separate price span that
    // app.js renders from the real price — keep it in sync with the override
    // so it doesn't keep showing the pre-override amount.
    const addToCartPriceEl = document.querySelector('#add-to-cart-price');
    if (addToCartPriceEl && pdp.price != null) addToCartPriceEl.textContent = money(pdp.price);

    if (pdp.exclusionNote) {
        // Real-plausible class name (not a demo-only data attribute) so
        // tag.js's buildTile() can read this as a genuine price-adjacent
        // disclosure — the "why this price differs" text a scanner needs
        // to correlate against a claim made elsewhere (e.g. a category
        // banner promising a bigger discount).
        let noteEl = document.querySelector('.price-exclusion-note');
        if (!noteEl) {
            noteEl = document.createElement('p');
            noteEl.className = 'price-exclusion-note';
            noteEl.style.cssText = 'font-size:0.75rem;color:var(--muted);margin-top:0.5rem;';
            const priceStack = hero.querySelector('.price-stack');
            if (priceStack) priceStack.after(noteEl); else hero.appendChild(noteEl);
        }
        noteEl.textContent = pdp.exclusionNote;
    }
}
