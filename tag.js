/**
 * AIORA JS Tag — v0.2.0
 *
 * Tiered structured extraction. Replaces raw DOM capture with
 * signal-specific extractors organized in priority tiers.
 * Payload budget: 50 KB hard cap, stop at 90 % (45 KB).
 *
 * Installation:
 *   <script src="https://cdn.aiora.systems/v2/tag.js"
 *           data-client-id="retailer-prod-xxxx"
 *           data-sampling-rate="1.0"
 *           data-hydration-timeout="3000"
 *           data-dom-settle-ms="500"
 *           async>
 *   </script>
 *
 * Architecture:
 *   - All intelligence lives server-side. This tag is a dumb sensor.
 *   - Never modifies the retailer's DOM.
 *   - Never blocks page render.
 *   - Fails silently — any error must be invisible to the retailer's page.
 *   - One beacon per page load only.
 *   - No raw DOM in payload — structured tier fields only.
 */

(function () {
    try {

        // ================================================================
        // SECTION 1 — CONFIG
        // ================================================================

        const _script = document.currentScript;

        const config = {
            clientId: _script?.dataset?.clientId ?? null,
            samplingRate: parseFloat(_script?.dataset?.samplingRate ?? '1.0'),
            hydrationTimeout: parseInt(_script?.dataset?.hydrationTimeout ?? '3000'),
            domSettleMs: parseInt(_script?.dataset?.domSettleMs ?? '500'),
            endpoint: _script?.dataset?.endpoint ?? 'https://ingest.aiora.systems/v1/signal',


        };

        if (!config.clientId) {
            console.warn('[AIORA] No data-client-id found on script tag. Tag will not fire.');
            return;
        }


        // ================================================================
        // SECTION 2 — SAMPLING GATE
        // TODO: replace with session-coherent hash sampling (see DECISIONS.md)
        // ================================================================

        if (Math.random() > config.samplingRate) return;


        // ================================================================
        // SECTION 3 — SESSION TOKEN
        // In-memory only — never written to any persistent storage.
        // ================================================================
        // const sessionToken = crypto.randomUUID(); //when it is in live production
        /*const sessionToken = (typeof crypto !== 'undefined' && crypto.randomUUID)
            ? crypto.randomUUID()
            : Math.random().toString(36).substring(2) + Date.now().toString(36);*/

        // ================================================================
        // NEW: VISIT-STABLE SESSION ID RESOLVER
        // ================================================================
        function resolveSessionToken() {
            var generateUUID = function () {
                return (typeof crypto !== 'undefined' && crypto.randomUUID)
                    ? crypto.randomUUID()
                    : Math.random().toString(36).substring(2) + Date.now().toString(36);
            };

            try {
                // Mode A: Look for an enterprise dataLayer session ID
                if (window.dataLayer) {
                    for (var i = 0; i < window.dataLayer.length; i++) {
                        if (window.dataLayer[i].session_id) {
                            return window.dataLayer[i].session_id;
                        }
                    }
                }

                // Mode B: Use sessionStorage to keep the ID stable across page loads
                if (window.sessionStorage) {
                    var storedToken = window.sessionStorage.getItem('aiora_session_id');
                    if (storedToken) {
                        return storedToken;
                    } else {
                        var newToken = generateUUID();
                        window.sessionStorage.setItem('aiora_session_id', newToken);
                        return newToken;
                    }
                }
            } catch (e) {
                // Ignore Safari Private Browsing errors
            }

            // Degraded Fallback: Generate a fresh UUID if all else fails
            return generateUUID();
        }

        // Apply it GLOBALLY so both Tier 0 and Tier 10 (Interaction Events) use the exact same ID!
        const sessionToken = resolveSessionToken();


        // ================================================================
        // SECTION 4 — BEACON GUARD
        // ================================================================

        let beaconFired = false;


        // ================================================================
        // SECTION 5 — HYDRATION DETECTION (old)
        // ================================================================

        // old code - problem with subtotal (Home Depot cart subtotal and total are missing because HD renders them via React after page load. How general do you think this problem is? )
        /*function waitForHydration(onComplete) {
          let settleTimer = null;
    
          function onDomSettled() {
            observer.disconnect();
            clearTimeout(hardCap);
            onComplete();
          }
    
          function onDomMutation() {
            clearTimeout(settleTimer);
            settleTimer = setTimeout(onDomSettled, config.domSettleMs);
          }
    
          function onHardCapFired() {
            observer.disconnect();
            clearTimeout(settleTimer);
            onComplete();
          }
    
          const hardCap = setTimeout(onHardCapFired, config.hydrationTimeout);
          const observer = new MutationObserver(onDomMutation);
    
          settleTimer = setTimeout(onDomSettled, config.domSettleMs);
    
          if (document.body) {
            observer.observe(document.body, { childList: true, subtree: true });
          }
        }*/

        //New code -waitforHydration() Home Depot cart subtotal and total are missing because HD renders them via React after page load. How general do you think this problem is? )
        /*function waitForHydration(onComplete) {
          let settleTimer = null;
          let isCartPage = window.location.href.toLowerCase().includes('/cart');
    
          // NEW: Checks if React has finished injecting the cart totals
          function isCriticalDataPresent() {
            if (!isCartPage) return true; // Don't hold up normal pages
            return !!document.querySelector('#summarySubtotal, .summary-subtotal, #summaryTotal');
          }
    
          function onDomSettled() {
            if (!isCriticalDataPresent()) {
              // React hasn't rendered the totals yet! Wait another 500ms (unless hardCap forces us).
              settleTimer = setTimeout(onDomSettled, config.domSettleMs);
              return;
            }
            observer.disconnect();
            clearTimeout(hardCap);
            onComplete();
          }
    
          function onDomMutation() {
            clearTimeout(settleTimer);
            settleTimer = setTimeout(onDomSettled, config.domSettleMs);
          }
    
          function onHardCapFired() {
            observer.disconnect();
            clearTimeout(settleTimer);
            onComplete();
          }
    
          const hardCap = setTimeout(onHardCapFired, config.hydrationTimeout);
          const observer = new MutationObserver(onDomMutation);
    
          settleTimer = setTimeout(onDomSettled, config.domSettleMs);
    
          if (document.body) {
            observer.observe(document.body, { childList: true, subtree: true });
          }
        }*/

        // ------Micropolling logic to avoid the artificial 3s hard capped delay-------------------
        // ================================================================
        // SECTION 5 — HYDRATION DETECTION (DIRECTIVE 4: MICRO-POLLING)
        // ================================================================

        // We store the performance metric globally so Tier 4 can inject it into the payload
        /*window.__AIORA_HYDRATION_MS__ = 0;

        function waitForHydration(onComplete) {
            var startTime = performance.now();
            var isCartPage = window.location.href.toLowerCase().includes('/cart');

            // If it's not a cart/checkout page, there's no complex React hydration to wait for.
            if (!isCartPage) {
                setTimeout(onComplete, config.domSettleMs);
                return;
            }

            // DIRECTIVE 4: Aggressive Micro-Polling
            var pollTimer = setInterval(function () {
                // Did the React Cart finally render the subtotal?
                var found = !!firstMatch(document, FIELD_SEL.cartSubtotal) || !!firstMatch(document, FIELD_SEL.cartTotal);
                var elapsed = performance.now() - startTime;

                if (found || elapsed >= config.hydrationTimeout) {
                    clearInterval(pollTimer);
                    window.__AIORA_HYDRATION_MS__ = Math.round(elapsed); // Log the exact millisecond!
                    onComplete();
                }
            }, 50); // Polling every 50ms instead of waiting blindly!
        }*/


        // ================================================================
        // SECTION 5 — HYDRATION DETECTION (ELEMENT-LEVEL OBSERVER)
        // ================================================================

        window.__AIORA_HYDRATION_MS__ = 0;

        function waitForHydration(onComplete) {
            var startTime = performance.now();
            var path = window.location.pathname;

            // When a ?demo= param is present, the Shopora demo harness (demo_router.js)
            // sets window.__AIORA_DEMO_READY__ once its scenario override has fully
            // landed in the DOM (sync or async). Gate extraction on that flag too, on
            // top of the normal per-page checklist below, so the tag never captures a
            // page mid-override. hydrationTimeout still applies as a hard-cap safety
            // net if the flag is never set. No-op on real (non-demo) pages/sites.
            var isDemoMode = /[?&]demo=/.test(window.location.search);

            // COMPREHENSIVE FIX: Actually use the real classifier!
            var pageType = classifyPageType(path);

            // The Checklist Flags
            var hasFoundItems = false;
            var hasFoundTotal = false;
            var hasFoundEmptyState = false;

            // 1. The Safety Net (Hard Cap Timeout)
            var hardCapTimer = setTimeout(function () {
                if (observer) observer.disconnect();
                window.__AIORA_HYDRATION_MS__ = Math.round(performance.now() - startTime);
                onComplete(); // Fire anyway after timeout if the site is broken
            }, config.hydrationTimeout);

            // 2. The Smart Element-Level Observer
            var observer = new MutationObserver(function () {
                var isReadyToFire = false;

                // Cart & Checkout Page Checklist
                if (pageType === 'cart' || pageType === 'checkout') {
                    if (firstMatch(document, CARD_SELECTORS) || firstMatch(document, FIELD_SEL.cartItemName)) hasFoundItems = true;
                    if (firstMatch(document, FIELD_SEL.cartSubtotal) || firstMatch(document, FIELD_SEL.cartTotal)) hasFoundTotal = true;
                    if (document.querySelector('.empty-cart-message, .empty-cart, [data-testid="empty-cart"]')) hasFoundEmptyState = true;

                    isReadyToFire = (hasFoundItems && hasFoundTotal) || hasFoundEmptyState;
                }
                // PDP Page Checklist
                else if (pageType === 'pdp') {
                    if (firstMatch(document, FIELD_SEL.name)) hasFoundItems = true;
                    if (firstMatch(document, FIELD_SEL.price)) hasFoundTotal = true;

                    // pdp.html ships static placeholder content (#hero with
                    // data-sku="FAKE-123") until app.js's renderPDP() replaces
                    // it — name/price elements exist from first paint either
                    // way, so also require the placeholder SKU to be gone
                    // before treating the page as ready (same check
                    // demo_router.js's waitForRealPdpHero already uses).
                    var heroEl = document.querySelector('#hero');
                    var heroIsReal = !heroEl || heroEl.getAttribute('data-sku') !== 'FAKE-123';

                    isReadyToFire = hasFoundItems && hasFoundTotal && heroIsReal;
                }
                // Grid Pages (Search, Category, Homepage) Checklist
                else if (pageType === 'search' || pageType === 'category' || pageType === 'homepage') {
                    if (firstMatch(document, CARD_SELECTORS)) hasFoundItems = true;
                    if (document.querySelector('.no-results, .zero-results, .empty-search')) hasFoundEmptyState = true;

                    isReadyToFire = hasFoundItems || hasFoundEmptyState;
                }
                // Generic Pages (Fire instantly)
                else {
                    isReadyToFire = true;
                }

                // 3. Did we complete the checklist (and, in demo mode, has the
                // demo harness finished applying its override)? Stop the
                // observer and send payload!
                if (isReadyToFire && (!isDemoMode || window.__AIORA_DEMO_READY__)) {
                    observer.disconnect();
                    clearTimeout(hardCapTimer);
                    window.__AIORA_HYDRATION_MS__ = Math.round(performance.now() - startTime);
                    onComplete();
                }


            });

            // Start watching the DOM instantly!
            if (document.body) {
                observer.observe(document.body, { childList: true, subtree: true, characterData: true });

                // Trigger a fake mutation instantly, just in case the page loaded extremely fast!
                var textNode = document.createTextNode('');
                document.body.appendChild(textNode);
                document.body.removeChild(textNode);
            } else {
                // Failsafe if document.body is somehow missing
                setTimeout(onComplete, 100);
            }
        }



        // ================================================================
        // SECTION 6 — IDLE WAIT
        // ================================================================

        function waitForIdle(work) {
            if ('requestIdleCallback' in window) {
                requestIdleCallback(work, { timeout: config.hydrationTimeout });
            } else {
                setTimeout(work, 0);
            }
        }


        // ================================================================
        // SECTION 7 — PII SCRUBBING
        // Defense-in-depth: scrub the DOM clone before extractors run.
        // Returns a parsed document, not a string.
        // ================================================================

        function scrubPII(html) {
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');

            doc.querySelectorAll('input, textarea, select').forEach(function (el) {
                el.removeAttribute('value');
                if (el.tagName === 'TEXTAREA') el.textContent = '';
            });

            doc.querySelectorAll('input[type="password"]').forEach(function (el) {
                el.removeAttribute('value');
                el.setAttribute('data-aiora-scrubbed', 'true');
            });

            doc.querySelectorAll('script').forEach(function (el) { el.remove(); });
            doc.querySelectorAll('style').forEach(function (el) { el.remove(); });

            var PII_DATA_ATTRS = [
                'data-email', 'data-user-email', 'data-customer-email',
                'data-user-id', 'data-customer-id', 'data-account-id',
                'data-phone', 'data-mobile',
                'data-first-name', 'data-last-name', 'data-full-name',
                'data-address', 'data-postcode', 'data-zip',
            ];
            var piiSelector = PII_DATA_ATTRS.map(function (a) { return '[' + a + ']'; }).join(',');
            doc.querySelectorAll(piiSelector).forEach(function (el) {
                PII_DATA_ATTRS.forEach(function (attr) { el.removeAttribute(attr); });
            });

            return doc;
        }


        // ================================================================
        // SECTION 8 — SELECTOR UTILITIES
        // ================================================================

        // Returns the first element matched by any selector in the list.
        function firstMatch(root, selectors) {
            for (var i = 0; i < selectors.length; i++) {
                try {
                    var found = root.querySelector(selectors[i]);
                    if (found) return found;
                } catch (e) { /* malformed selector — skip */ }
            }
            return null;
        }

        // Safe text content, trimmed and truncated. Returns null if empty.
        function textOf(el, max) {
            if (!el) return null;
            // NEW: Use regex to crush all newlines/tabs/multi-spaces into a single space!
            var t = (el.textContent || '').replace(/\s+/g, ' ').trim();
            return t ? t.slice(0, max || 120) : null;
        }


        // ================================================================
        // SECTION 9 — BUDGET TRACKER
        // 50 KB hard cap. Soft cap at 90 % (45 KB) — stop adding tiers
        // when soft cap is reached. Tiers 0–4 must always fit.
        // ================================================================

        var BUDGET_HARD_CAP = 50 * 1024;
        var BUDGET_SOFT_CAP = Math.floor(BUDGET_HARD_CAP * 0.9);

        function makeBudget() {
            var used = 0;
            var dropped = [];
            return {
                add: function (tier, data) {
                    used += JSON.stringify(data).length;
                },
                drop: function (tier) {
                    dropped.push(tier);
                },
                isOver: function () {
                    return used >= BUDGET_SOFT_CAP;
                },
                summary: function () {
                    return { bytes_used: used, hard_cap: BUDGET_HARD_CAP, tiers_dropped: dropped };
                },
            };
        }


        // ================================================================
        // SECTION 10 — TIER EXTRACTORS
        // ================================================================


        // ── 10.0  TIER 0 — ENVELOPE ────────────────────────────────────
        // Always present. Target ~300 bytes.
        // Includes: client_id, session_token, page_type, page_url_path, 
        // timestamp, tag_version, sampled, sequence_no, page_heading, 
        // breadcrumb, viewport, surface_id, region, identity_summary, 
        // and program_match.


        function classifyPageType(path) {
            var p = (path || '').toLowerCase();
            if (p.includes('/cart')) return 'cart';
            if (p.includes('/checkout')) return 'checkout';
            if (p.includes('/search')) return 'search';
            if (p.includes('/product') || p.includes('/p/') || p.includes('/pdp')) return 'pdp';
            if (p === '/' || p.includes('/home')) return 'homepage';
            return 'category';
        }

        function classifyPageTypeFromTitle(title) {
            var t = (title || '').toLowerCase();
            if (t.includes('cart') || t.includes('bag')) return 'cart';
            if (t.includes('checkout')) return 'checkout';
            if (t.includes('search')) return 'search';
            if (t.includes('product')) return 'pdp';
            return null;
        }
        // (Changes) used params instead of .pathname to extract search query
        function extractTier0(sampledIn) {
            try {
                var urlStr = window.location.href;

                // Prefer canonical URL path — carries the real path even when the page is
                // loaded at a different URL (e.g. proxies, test harnesses).
                var canonical = document.querySelector('link[rel="canonical"]');
                if (canonical && canonical.href) {
                    urlStr = canonical.href;
                }

                var path = '';
                try {
                    var urlObj = new URL(urlStr);
                    var params = new URLSearchParams(urlObj.search);
                    var blacklist = ['email', 'token', 'auth', 'password', 'session', 'uid', 'key', 'mobile', 'phone', 'contact', 'number'];
                    var keysToDelete = [];

                    params.forEach(function (value, key) {
                        var lowerKey = key.toLowerCase();
                        for (var i = 0; i < blacklist.length; i++) {
                            if (lowerKey.includes(blacklist[i])) {
                                keysToDelete.push(key);
                                break;
                            }
                        }
                    });

                    keysToDelete.forEach(function (k) { params.delete(k); });

                    path = urlObj.pathname;
                    var safeQuery = params.toString();
                    if (safeQuery) {
                        path += '?' + safeQuery;
                    }
                } catch (e) {
                    path = window.location.pathname; // Fallback just in case
                }

                var pageType;
                if (document.body && document.body.dataset && document.body.dataset.pageType) {
                    pageType = document.body.dataset.pageType;
                } else {

                    //-----OLD CODE---(changes) if any retailer has a modern websites often open "Side Carts" on top of PDPs
                    /*pageType = classifyPageType(path);
                    // Title overrides a generic path classification (category or homepage at "/").
                    // e.g. HD cart has canonical="/" but title="The Home Depot - Cart".
                    if (pageType === 'category' || pageType === 'homepage') {
                      pageType = classifyPageTypeFromTitle(document.title) || pageType;
                    }*/
                    //-------NEW--------
                    pageType = classifyPageType(path);

                    // ALWAYS let the Title override the URL if the title explicitly says it's a Cart or Checkout.
                    // This fixes side-carts or popups that open on top of a PDP.
                    var titleType = classifyPageTypeFromTitle(document.title);
                    if (titleType === 'cart' || titleType === 'checkout') {
                        pageType = titleType;
                    } else if (pageType === 'category' || pageType === 'homepage') {
                        // For generic URLs, fall back to title classification
                        pageType = titleType || pageType;
                    }
                    // Final Fallback: DOM Inspection for Side-Carts (The Ultimate Escalation)
                    if (pageType !== 'cart' && pageType !== 'checkout') {
                        // Look for obvious cart identifiers or a "checkout" button anywhere on the screen
                        var cartEl = document.querySelector('[data-type="cart"], .cart-drawer, .minicart, [data-testid="cart-drawer"]');
                        var checkoutBtn = document.querySelector('button[aria-label*="checkout" i], a[href*="checkout" i], button[title*="checkout" i]');

                        // TEMP, NEW: Look for Flipkart's exact "Place Order" div, OR any button/link containing the text "Place order"
                        var placeOrderTextNode = Array.from(document.querySelectorAll('button, a, div[dir="auto"], div[role="button"]'))
                            .find(function (el) { return el.innerText && el.innerText.toLowerCase().trim() === 'place order'; });
                        // If there is a checkout/place-order element physically visible on the screen, a cart overlay is open!
                        if (cartEl || checkoutBtn || (placeOrderTextNode && placeOrderTextNode.getBoundingClientRect().width > 0)) {
                            pageType = 'cart';
                        }
                    }
                }

                // --- NEW TIER 0 EXTRACTION LOGIC w.r.t Canonical Signal Schema

                // 1. Sequence number (defaults to 1 for standard page loads)
                var sequenceNo = 1;

                // 2. Page heading text (Fallback to document.title if no H1 exists)
                var headingEl = document.querySelector('h1');
                var pageHeading = headingEl ? headingEl.innerText.trim() : document.title;

                // 3. Breadcrumb trail array
                var breadcrumbs = [];
                var bcNodes = document.querySelectorAll('nav[aria-label="breadcrumb"] li, .breadcrumbs li, .breadcrumb li');
                for (var i = 0; i < bcNodes.length; i++) {
                    var bcText = bcNodes[i].innerText.trim();
                    if (bcText) breadcrumbs.push(bcText);
                }

                // 4. Viewport dimensions
                var viewport = { width: window.innerWidth, height: window.innerHeight };

                // 5. Surface ID (Unique ID for this specific payload capture event)
                var surfaceId = crypto.randomUUID();

                // 6. Region
                var region = document.documentElement.lang || 'unknown';

                // 7. Identity summary (Basic stub until we build Tier 5)
                // --- NEW: IDENTITY EXTRACTION ---
                var identitySummary = { state: 'unknown' };
                var idEl = document.querySelector('[data-identity-state], [data-customer-hash]');
                if (idEl) {
                    // If the element exists, dynamically pull all the specs!
                    identitySummary.state = idEl.getAttribute('data-identity-state') || 'recognized';

                    var tierStr = idEl.getAttribute('data-member-tier');
                    if (tierStr) identitySummary.member_tier = tierStr;

                    var balStr = idEl.getAttribute('data-loyalty-balance');
                    if (balStr) identitySummary.loyalty_balance = parseInt(balStr, 10);

                    var hashStr = idEl.getAttribute('data-customer-hash');
                    if (hashStr) identitySummary.customer_hash = hashStr;
                }


                // 8. Third-party program match (Looking for common UTM/affiliate parameters)
                var programMatch = null;
                if (window.location.search.includes('utm_') || window.location.search.includes('affiliate')) {
                    programMatch = 'affiliate_or_campaign_detected';
                }

                // ---NEW---(add) w.r.t Canonical Signal Schema
                // 9. Visible Query
                var visibleQuery = null;
                var searchInput = firstMatch(document, FIELD_SEL.searchQueryInput);
                if (searchInput && searchInput.value) visibleQuery = searchInput.value.trim();


                return {
                    // Old Fields
                    client_id: config.clientId,
                    session_token: sessionToken,
                    tag_version: '0.2.0',
                    timestamp: new Date().toISOString(),
                    sampled: sampledIn,
                    page_type: pageType,
                    page_url_path: path.replace(/\/index\.html$/i, '') || '/',

                    // New Fields
                    sequence_no: sequenceNo,
                    page_heading: pageHeading,
                    breadcrumb: breadcrumbs,
                    viewport: viewport,
                    surface_id: surfaceId,
                    region: region,
                    identity_summary: identitySummary,
                    visible_query: visibleQuery,
                    program_match: programMatch
                };
            } catch (e) { return {}; }
        }



        // ── 10.1  TIER 1 — PRODUCT CARDS ──────────────────────────────
        // Primary/fallback selector lists per field.
        // Missing fields are omitted from the tile object (not nulled).
        // Positions capped at 40.

        var CARD_SELECTORS = [
            'article.product-card',
            '.product-card',
            '.product-tile',
            '[data-testid="product-pod"]',
            '[data-product-id]',
            '[data-product]',
        ];

        var FIELD_SEL = {

            // For Tier 0 (The Envelope)
            searchQueryInput: ['input[type="search"]', 'input[name="q"]', 'input[name="search"]', 'input[name="keyword"]'],

            // Existing Tier 1
            sku: ['[data-product-id]', '[data-sku]', '[data-product]', 'a[href*="/p/"]', '[class*="model"]', '.model-number'],
            name: ['[data-testid="attribute-product-label"]', '.product-title', 'h1', 'h3', '.product-name', '[class*="name"]'],
            brand: ['[data-testid="attribute-brandname-inline"]', '.product-brand', '[class*="brand"]'],
            price: ['[data-testid="price-simple"]', '[data-automation-id="itemPrice"]', '.price-stack strong', '.deal-price strong', '[class*="price"] strong', '.price-current', '.price'],
            oldPrice: ['.price-stack del', 'del', '[class*="old-price"]', '.price-was', '.sui-line-through'],
            badge: ['.discount-badge', '[class*="badge"]', '[class*="deal-chip"]'],
            addToCart: ['.add-to-cart', '.button-primary.add-to-cart', '[class*="add-to-cart"]'],
            deliveryNote: ['.delivery-note', '[class*="delivery-note"]', '.delivery-promise', '.shipping-msg', '[class*="delivery"]'],
            priceExclusionNote: ['.price-exclusion-note', '.promo-exclusion', '[data-exclusion-reason]'],

            // ---NEW: Tier 1 Additions --- w.r.t Canonical Signal Schema
            categoryWords: ['.category', '.department', '[data-category]', '.product-category'],
            mfrNumber: ['[data-mfr-no]', '[data-part-number]', '.mfr-number', '[class*="model"]', '.model-number'],
            dedupKey: ['[data-dedup-key]'],
            unitPrice: ['.unit-price', '.price-per-unit', '[data-unit-price]', '.price-measurement'],
            generalBadges: ['.badge', '.flag', '.product-label', '.scarcity-msg', '[data-automation-id="productBadge"]'],
            discountAmount: ['.discount-amount', '.savings-amount', '[class*="save"]', '.sui-text-success', '.price-stack span'],
            availability: ['.availability-msg', '.stock-msg', '.sold-out', '[data-availability]', '[data-availability-flag]'],




            //--------NEW-------(add) 
            // NEW: Tier 2 Cart Summary
            cartSubtotal: ['#summarySubtotal', '[data-automation-id="totalsSubTotal"]'],
            cartTotal: ['#summaryTotal', '[data-automation-id="totalsTotal"]'],
            cartSavings: ['#summarySavings'],
            cartDelivery: ['#summaryDelivery'],
            cartMarkdown: ['#markdownAmt'],
            cartTax: ['.summary-tax', '#summaryTax', '[data-automation-id="summaryTax"]'],
            cartPromotions: ['.cart-discount', '.promo-applied', '[data-automation-id="appliedPromotion"]', '#promoRow'],
            cartShippingThreshold: ['.shipping-threshold', '#shippingProgress', '.shipping-progress'],
            cartLoyalty: ['.loyalty-discount', '[data-automation-id="loyaltyDiscount"]', '#plusMemberRow'],
            // --- NEW TIER 2 ADDITIONS --- w.r.t Canonical Signal Schema
            appliedDiscountConstructs: ['.applied-discount-type', '[data-discount-type]', '.discount-construct'],
            promoInput: ['input[name*="discount"]', 'input[name*="coupon"]', '#promoCode', '.promo-input', '#promoInput'],
            altPaymentButtons: ['[data-testid*="apple"]', '.apple-pay', '#applePay', '.paypal-button', '[data-payment-method="google-pay"]', '.alt-payment'],
            promoInlineReason: ['.promo-error', '.discount-error', '.inline-error', '[data-automation-id="promoError"]'],
            loyaltyBalance: ['.loyalty-balance', '.points-balance', '[data-automation-id="loyaltyPointsBalance"]', '[data-loyalty-balance]'],

            // NEW: Tier 2 Cart Line Items
            cartItemName: ['[data-automation-id="productDescription"]', 'h3'],
            cartItemBrand: ['[data-automation-id="productBrand"]'],
            cartItemQuantity: ['[data-automation-id="itemQuantity"] input', 'input[type="number"]', 'input.qty', 'select.qty', '.quantity-control span', 'input[class*="quantity"]', '[class*="qty"]'],
            cartItemDiscount: ['.cart-item-price small'],
            cartItemLineTotal: ['.line-total', '[data-automation-id="itemLineTotal"]', '.cart-item-total'],

            // NEW: Tier 2 Checkout
            checkoutItemName: ['[class*="name"]', 'p', 'span', 'strong',],
            checkoutItemPrice: ['[class*="price"]', 'strong'],
            checkoutSubtotal: ['#checkoutSubtotal', '[data-automation-id="totalsSubTotal"]'],
            checkoutTotal: ['#checkoutTotal', '[data-automation-id="totalsTotal"]'],
            checkoutDelivery: ['#checkoutDelivery', '[data-automation-id="pickupTotal"]'],
            checkoutTax: ['#checkoutTax', '[data-automation-id="salesTaxTotal"]'],
            checkoutOrderButton: ['#placeOrderButton', '.place-order', '[data-automation-id="checkoutButton"]'],
            checkoutLoyalty: ['#coPlusMemberRow', '[data-automation-id="loyaltyDiscount"]'],
            checkoutItemQuantity: ['small', '[class*="qty"]'],  // <--- ADDED THIS LINE


            // NEW: Tier 4 Consistency
            heroElement: ['#heroDealName', '.hero', '#hero'],
            cartCount: ['[data-cart-count]'],
            resultCount: ['[class*="result-count"]', '.results-count', '#resultCount'],
            pageHeading: ['h1'],
            activeFilter: ['.filter.active', '[aria-current="page"]', '.active-filter'],
            cartItemLabel: ['#cartItemLabel'],


            // NEW: Tier 6 Promotional context
            announcementBar: ['.announcement span', '.announcement-bar span', '.top-bar span'],
            heroModule: ['.hero'],
            heroHeadline: ['.hero-copy h1', '.hero h1'],
            heroSubheading: ['.hero-copy p', '.hero p'],
            heroOfferText: ['.hero-offer'],
            heroCta: ['.hero-actions a', '.hero a.button'],
            promoBanner: ['.promo-banner', '[data-module-type="banner"]'],
            dealChip: ['.deal-chip'],
            scarcityMsg: ['.scarcity-msg', '.urgency-msg', '[class*="scarcity"]'],
            countdown: ['.countdown', '[data-deadline-timestamp]', '.countdown-timer'],
            countdownValue: ['.countdown-value', '#dealTimer'],


        };

        var EXCLUDE_SURFACES = [
            '#suggestedGrid',
        ];

        // Maps currency symbols to ISO 4217 codes for price parsing.
        var CURRENCY_MAP = { '$': 'USD', '£': 'GBP', '€': 'EUR', '₹': 'INR', '¥': 'JPY', '₩': 'KRW' };

        // Surface name — one of: deals-strip, featured, recommendations, category-grid,
        // hero, catalog-grid, search-results, also-bought, other.
        function getSurface(card) {
            if (card.closest('#dealStrip')) return 'deals-strip';
            if (card.closest('#featuredGrid')) return 'featured';
            if (card.closest('#recommendedGrid')) return 'recommendations';
            if (card.closest('#categoryGrid')) return 'category-grid';
            if (card.closest('.hero')) return 'hero';
            if (card.closest('.product-grid')) return 'catalog-grid';
            if (card.closest('#searchResults, .search-results')) return 'search-results';
            if (card.closest('.also-bought, #alsoBought')) return 'also-bought';
            return 'other';
        }

        function addCardsFromSelector(doc, sel, seen, cards) {
            var matches = doc.querySelectorAll(sel);
            for (var i = 0; i < matches.length; i++) {
                var el = matches[i];
                if (seen) {
                    if (!seen.has(el)) { seen.add(el); cards.push(el); }
                } else {
                    cards.push(el);
                }
            }
        }

        function collectAllCards(doc) {
            var seen = typeof Set !== 'undefined' ? new Set() : null;
            var cards = [];
            for (var i = 0; i < CARD_SELECTORS.length; i++) {
                addCardsFromSelector(doc, CARD_SELECTORS[i], seen, cards);
            }
            return cards;
        }

        function isExcluded(card) {
            for (var i = 0; i < EXCLUDE_SURFACES.length; i++) {
                if (card.closest(EXCLUDE_SURFACES[i])) return true;
            }
            return false;
        }

        // In this code, the id/sku isnt extracted in T1 signal
        /*function extractSku(card) {
            var el = firstMatch(card, FIELD_SEL.sku);
            if (!el) return null;
            var sku = el.getAttribute('data-product-id') || el.getAttribute('data-sku') || el.getAttribute('data-product');
            // --- NEW: SKU-in-href Fallback ---
            if (!sku && (el.tagName === 'A' || el.hasAttribute('href'))) {
                var href = el.getAttribute('href') || '';
                var match = href.match(/\/p\/(?:[^\/]+\/)*(\d+)/);
                if (match) sku = match[1];
            }
            return sku ? sku.slice(0, 60) : null;
        }*/

        function extractSku(card) {
            // Check the card's own attributes first — these selectors are usually
            // set directly on the SAME element the tile is built from, and
            // querySelector() never matches the calling element itself, only its
            // descendants. That mismatch was making every tile's sku come back null.
            // Priority: a real, dedicated SKU wins when present; otherwise fall
            // back to the generic product id (data-product-id / data-product) —
            // covers today's Shopora catalog, which only has `id`, no separate sku.
            var sku = card.getAttribute && (card.getAttribute('data-sku') || card.getAttribute('data-product-id') || card.getAttribute('data-product'));
            if (!sku) {
                var el = firstMatch(card, FIELD_SEL.sku);
                if (el) {
                    sku = el.getAttribute('data-sku') || el.getAttribute('data-product-id') || el.getAttribute('data-product');
                    if (!sku && (el.tagName === 'A' || el.hasAttribute('href'))) {
                        var href = el.getAttribute('href') || '';
                        var match = href.match(/\/p\/(?:[^\/]+\/)*(\d+)/);
                        if (match) sku = match[1];
                    }
                }
            }
            return sku ? sku.slice(0, 60) : null;
        }



        // Availability state — one of: in-stock, out-of-stock, low-stock, unknown.
        // out-of-stock: disabled add-to-cart button, or explicit .out-of-stock / .sold-out element.
        // low-stock: explicit class/attribute, or text pattern ("only N left", "low stock", "hurry").
        // unknown: no add-to-cart button found.
        /*function extractAvailability(card) {
            if (card.querySelector('[data-availability="out-of-stock"], .out-of-stock, .sold-out')) return 'out-of-stock';
            var btn = firstMatch(card, FIELD_SEL.addToCart);
            if (!btn) return 'unknown';
            if (btn.disabled) return 'out-of-stock';
            if (card.querySelector('[data-availability="low-stock"], .low-stock, [data-stock="low"]')) return 'low-stock';
            if (/only \d+ left|low stock|hurry/i.test(card.textContent)) return 'low-stock';
            return 'in-stock';
        }*/

        function extractAvailability(card) {
            if (card.querySelector('[data-availability="out-of-stock"], .out-of-stock, .sold-out')) return 'out-of-stock';
            if (card.querySelector('[data-availability="low-stock"], .low-stock, [data-stock="low"]')) return 'low-stock';
            var explicitAvail = card.querySelector('[data-availability]');
            if (explicitAvail) return explicitAvail.getAttribute('data-availability');
            if (/only \d+ left|low stock|hurry/i.test(card.textContent)) return 'low-stock';
            // Real cart-item markup shows "In stock" as plain visible text,
            // no data-availability attribute — check that before falling
            // back to an add-to-cart button, which cart items never have
            // (they show quantity/remove controls instead, not "Add to cart").
            if (/\bin stock\b/i.test(card.textContent)) return 'in-stock';
            var btn = firstMatch(card, FIELD_SEL.addToCart);
            if (!btn) return 'unknown';
            if (btn.disabled) return 'out-of-stock';
            return 'in-stock';
        }

        function extractBadgeInfo(card) {
            var text = textOf(firstMatch(card, FIELD_SEL.badge), 30);
            if (!text) return null;
            var result = { badge: text };
            var pct = text.match(/(\d+)\s*%/);
            if (pct) result.discount_pct = parseInt(pct[1]);
            return result;
        }

        // Splits a raw price string into numeric amount and ISO currency code.
        // Matches the FIRST price pattern found — ignores trailing was-price, per-unit, savings text.
        // "$99.00($49.50/unit)Save $129" → { amount: 99.00, currency: "USD" }
        function parsePrice(text) {
            if (!text) return null;
            var match = text.match(/([£$€₹¥₩])\s*([\d,]+(?:\.\d{1,2})?)/);
            if (!match) return null;
            var currency = CURRENCY_MAP[match[1]] || null;
            var num = parseFloat(match[2].replace(/,/g, ''));
            return isNaN(num) ? null : { amount: num, currency: currency };
        }

        // Builds a single product tile from a card DOM element.
        // All fields are spec-defined; missing fields are omitted (not set to null).
        function buildTile(card, position) {
            // Product name — required; tile is skipped if absent.
            var name = textOf(firstMatch(card, FIELD_SEL.name), 80);
            if (!name) return null;

            // Position in surface (integer, starting at 1) and surface name.
            var tile = { position: position, surface: getSurface(card), name: name };

            // SKU / data-product-id (or fallback selector).
            var sku = extractSku(card);
            if (sku) tile.sku = sku;

            // Brand text (if shown on card).
            var brand = textOf(firstMatch(card, FIELD_SEL.brand), 40);
            if (brand) tile.brand = brand;

            // Current price (numeric) and currency code separately.
            var parsed = parsePrice(textOf(firstMatch(card, FIELD_SEL.price), 20));
            if (parsed) { tile.price = parsed.amount; if (parsed.currency) tile.currency = parsed.currency; }

            // Original / strikethrough price (if visible).
            var parsedOld = parsePrice(textOf(firstMatch(card, FIELD_SEL.oldPrice), 20));
            if (parsedOld && parsedOld.amount !== (parsed && parsed.amount)) {
                tile.old_price = parsedOld.amount;
                tile.has_markdown = true;
            }

            // Discount badge text (e.g. "25% OFF") and parsed percentage as integer.
            var badgeInfo = extractBadgeInfo(card);
            if (badgeInfo) {
                tile.badge = badgeInfo.badge;
                if (badgeInfo.discount_pct) tile.discount_pct = badgeInfo.discount_pct;
            }

            // Availability state — one of: in-stock, out-of-stock, low-stock, unknown.
            tile.availability = extractAvailability(card);

            // Sponsored flag (boolean) — data-sponsored="true", .sponsored-label, .ad-label, or ad-slot class.
            tile.sponsored = !!card.querySelector('[data-sponsored="true"], .sponsored-label, .ad-label, [class*="ad-slot"]');

            // Per-card delivery promise text (if shown).
            var delivery = textOf(firstMatch(card, FIELD_SEL.deliveryNote), 60);
            if (delivery) tile.delivery_promise = delivery;

            // Price-adjacent disclosure/exclusion note (e.g. "Excluded from
            // category promo — new model") — the "why this price differs"
            // fine print, letting a scanner correlate it against a claim
            // made elsewhere (e.g. a category banner) using payload data
            // alone, without requiring a human to visually inspect the page.
            var disclosureNote = textOf(firstMatch(card, FIELD_SEL.priceExclusionNote), 120);
            if (disclosureNote) tile.disclosure_note = disclosureNote;



            // --- NEW TIER 1 EXTRACTION LOGIC --- w.r.t Canonical Signal Schema

            // 1. Visible category words (array of strings)
            var catWords = [];
            var catMatches = card.querySelectorAll(FIELD_SEL.categoryWords.join(', '));
            for (var j = 0; j < catMatches.length; j++) {
                var txt = catMatches[j].textContent.trim();
                if (txt) catWords.push(txt);
            }
            if (catWords.length > 0) tile.visible_category_words = catWords;

            // 2. Manufacturer number or deduplication keys
            var mfr = firstMatch(card, FIELD_SEL.mfrNumber);
            var dedup = firstMatch(card, FIELD_SEL.dedupKey);
            if (mfr || dedup) {
                tile.keys = {};
                if (mfr) tile.keys.mfr_number = mfr.getAttribute('data-mfr-no') || mfr.getAttribute('data-part-number') || textOf(mfr, 40);
                if (dedup) tile.keys.dedup_key = dedup.getAttribute('data-dedup-key') || textOf(dedup, 40);
            }

            // 3. Unit price
            var parsedUnit = parsePrice(textOf(firstMatch(card, FIELD_SEL.unitPrice), 30));
            if (parsedUnit) {
                tile.unit_price = parsedUnit.amount;
            }

            // 4. Badges array 
            var badges = [];
            var badgeEls = card.querySelectorAll(FIELD_SEL.generalBadges.join(', '));
            for (var b = 0; b < badgeEls.length; b++) {
                var bText = badgeEls[b].textContent.trim();
                if (bText && badges.indexOf(bText) === -1) badges.push(bText);
            }
            if (badges.length > 0) tile.badges = badges;

            // 5. Discount Amount — parse into numeric value + currency
            var amtEl = firstMatch(card, FIELD_SEL.discountAmount);
            if (amtEl) {
                var rawDiscount = textOf(amtEl, 20);
                if (rawDiscount) {
                    // Strip text like "Save", "Off", etc. and extract the number
                    var discountNum = parseFloat(rawDiscount.replace(/[^0-9.-]+/g, ''));
                    if (!isNaN(discountNum)) {
                        tile.discount_amount = discountNum.toFixed(2);
                        // Detect currency symbol
                        if (rawDiscount.indexOf('£') !== -1) tile.discount_currency = 'GBP';
                        else if (rawDiscount.indexOf('€') !== -1) tile.discount_currency = 'EUR';
                        else if (rawDiscount.indexOf('₹') !== -1) tile.discount_currency = 'INR';
                        else tile.discount_currency = 'USD'; // default
                    }
                }
            }


            // 6. Availability flag text 
            var availEl = firstMatch(card, FIELD_SEL.availability);
            if (availEl) tile.availability_flag_text = textOf(availEl, 40);


            return tile;
        }
        //-----OLD CODE--------
        // Enhancing the code to fit our Tier requirement
        /*function extractTier1(doc) {
          try {
            var cards = collectAllCards(doc);
            var tiles = [];
    
            // Phase 1: Extract up to 40 cards max for high performance speed
            for (var i = 0; i < cards.length; i++) {
              if (tiles.length >= 40) break;
              if (isExcluded(cards[i])) continue;
              var tile = buildTile(cards[i], tiles.length + 1);
              if (tile) tiles.push(tile);
            }
    
            // Phase 2: Dynamic Budget Enforcement (Target ~8KB / 8192 bytes) (add)
            var TIER1_BUDGET = 8192;
            var currentSize = JSON.stringify(tiles).length;
    
            // If those 40 products put us over budget AND we have more than 20,
            // dynamically drop from the back until we fit under 8KB.
            while (currentSize > TIER1_BUDGET && tiles.length > 20) {
              tiles.pop();
              currentSize = JSON.stringify(tiles).length;
            }
            return tiles;
          } catch (e) { return []; }
        }*/

        //--------- NEW CODE------
        // Enhancing the code to fit our Tier requirement
        function extractTier1(doc, pageType) {
            try {
                var tiles = [];
                var positionCounter = 1;

                // --- NEW:  - HERO PRODUCT EXTRACTION ---
                if (pageType === 'pdp') {
                    var heroEl = firstMatch(doc, FIELD_SEL.heroElement);

                    if (heroEl) {
                        // BUGFIX: If a hero wrapper is found, use the master full-extraction engine!
                        var heroTile = buildTile(heroEl, positionCounter);
                        if (heroTile) {
                            heroTile.surface = 'hero';
                            tiles.push(heroTile);
                            positionCounter++;
                        }
                    } else {
                        // Fallback: If we can't find a wrapper, we build the Hero manually using the h1 and main price
                        var h1 = textOf(doc.querySelector('h1, .product-title, [data-automation-id="productName"]'), 80);
                        if (h1) {
                            var heroTile = { position: positionCounter, surface: 'hero', name: h1 };
                            // 2-STEP SKU EXTRACTION FOR HERO BANNER
                            var heroSku = doc.getAttribute('data-product-id') || doc.getAttribute('data-sku');
                            if (!heroSku) {
                                var skuEl = firstMatch(doc, FIELD_SEL.sku);
                                if (skuEl) heroSku = skuEl.getAttribute('data-product-id') || skuEl.getAttribute('data-sku') || textOf(skuEl, 30);
                            }
                            heroTile.sku = heroSku || null;

                            var parsedPrice = parsePrice(textOf(firstMatch(doc, FIELD_SEL.price), 20));
                            if (parsedPrice) {
                                heroTile.price = parsedPrice.amount;
                                if (parsedPrice.currency) heroTile.currency = parsedPrice.currency;
                            }
                            tiles.push(heroTile);
                            positionCounter++;
                        }
                    }
                }



                // --- NEW: CART LINE ITEMS FIRST ---
                // Same idea as the PDP hero extraction above: the real cart
                // line item only matches a low-priority CARD_SELECTORS entry
                // ([data-product-id]), so collectAllCards() below would
                // otherwise append it AFTER recommendation/also-bought tiles
                // that match a higher-priority selector (.product-card).
                // Extract it first so position 1 is always what's actually
                // in the cart, matching the hero-first convention on PDP.
                if (pageType === 'cart') {
                    var cartItemEls = doc.querySelectorAll('#cartItems .cart-item, #cartItems article.cart-item');
                    for (var c = 0; c < cartItemEls.length; c++) {
                        var cartTile = buildTile(cartItemEls[c], positionCounter);
                        if (cartTile) {
                            cartTile.surface = 'cart';
                            // buildTile()'s price/old_price came from the same
                            // generic match that also feeds t2's line_total —
                            // cart markup has no separate per-unit price
                            // element, so for quantity > 1 this tile's price
                            // is actually the line total (same root cause as
                            // buildCartLineItem's fix). Divide back down using
                            // the same quantity-control element t2 reads, so
                            // t1 and t2 agree on the same line item.
                            var cartQtyEl = firstMatch(cartItemEls[c], FIELD_SEL.cartItemQuantity);
                            var cartQtyText = cartQtyEl ? (cartQtyEl.getAttribute('aria-valuenow') || cartQtyEl.getAttribute('value') || cartQtyEl.value || cartQtyEl.textContent).trim() : null;
                            var cartQtyNum = cartQtyText ? parseInt(cartQtyText, 10) : null;
                            if (cartQtyNum > 1) {
                                if (cartTile.price != null) cartTile.price = +(cartTile.price / cartQtyNum).toFixed(2);
                                if (cartTile.old_price != null) cartTile.old_price = +(cartTile.old_price / cartQtyNum).toFixed(2);
                            }
                            tiles.push(cartTile);
                            positionCounter++;

                        }
                    }
                }

                // Phase 1: Extract the regular grids (Customers Also Bought, etc.)
                var cards = collectAllCards(doc);
                for (var i = 0; i < cards.length; i++) {
                    if (tiles.length >= 40) break;
                    if (isExcluded(cards[i])) continue;

                    // Prevent accidentally extracting the Hero product twice if it looks like a card
                    var heroSelectors = FIELD_SEL.heroElement.join(',');
                    if (pageType === 'pdp' && cards[i].closest && cards[i].closest(heroSelectors)) continue;

                    // Prevent double-extracting cart line items already handled above.
                    if (pageType === 'cart' && cards[i].closest && cards[i].closest('.cart-item')) continue;

                    var tile = buildTile(cards[i], positionCounter);
                    if (tile) {
                        tiles.push(tile);
                        positionCounter++;
                    }
                }

                // Phase 2: Dynamic Budget Enforcement (Target ~8KB / 8192 bytes)
                var TIER1_BUDGET = 8192;
                var currentSize = JSON.stringify(tiles).length;

                while (currentSize > TIER1_BUDGET && tiles.length > 20) {
                    tiles.pop();
                    currentSize = JSON.stringify(tiles).length;
                }
                return tiles;
            } catch (e) { return []; }
        }


        // ── 10.2  TIER 2 — CART / CHECKOUT STATE ──────────────────────
        // Present when page_type is cart or checkout.
        // Each visible promo/discount line captured as a separate object.

        // old code for query selector 
        /*function buildCartLineItem(item) {
          var name = textOf(item.querySelector('[data-automation-id="productDescription"], h3'), 80);
          if (!name) return null;
          var li = { name: name };
          var brand = textOf(item.querySelector('[data-automation-id="productBrand"]'), 40);
          var priceEl = item.querySelector('[data-automation-id="itemPrice"]');
          var price = priceEl ? textOf(priceEl, 20) : textOf(item.querySelector('.cart-item-price strong'), 20);
          var oldPrice = textOf(item.querySelector('.cart-item-price del'), 20);
          var discount = textOf(item.querySelector('.cart-item-price small'), 20);
          var skuEl = item.querySelector('[data-item-id]');
          // --- [NEW] Extracting Quantity and Line Total --- (Changes)
          var qtyEl = item.querySelector('input[type="number"], input.qty, select.qty, [data-automation-id="itemQuantity"]');
          var qtyText = qtyEl ? (qtyEl.value || qtyEl.textContent).trim() : null;
          if (qtyText) li.quantity = parseInt(qtyText, 10);
          var lineTotalEl = item.querySelector('.line-total, [data-automation-id="itemLineTotal"], .cart-item-total');
          if (lineTotalEl) li.line_total = textOf(lineTotalEl, 20);*/

        //------------New-----------(Add)---code for first match
        function buildCartLineItem(item) {
            var name = textOf(firstMatch(item, FIELD_SEL.cartItemName), 80);
            if (!name) return null;
            var li = { name: name };
            var brand = textOf(firstMatch(item, FIELD_SEL.cartItemBrand), 40);
            if (brand) li.brand = brand;

            // FIX: Using parsePrice for Price & Currency
            var rawPrice = textOf(firstMatch(item, FIELD_SEL.price), 20);
            var parsed = parsePrice(rawPrice);
            if (parsed) {
                li.price = parsed.amount;
                if (parsed.currency) li.currency = parsed.currency;
            }

            // FIX: Using parsePrice for Old Price
            var rawOld = textOf(firstMatch(item, FIELD_SEL.oldPrice), 20);
            var parsedOld = parsePrice(rawOld);
            if (parsedOld) li.old_price = parsedOld.amount;

            var discount = textOf(firstMatch(item, FIELD_SEL.cartItemDiscount), 20);
            if (discount) li.discount = discount;

            // FIX: Check the root item element FIRST before searching children
            var rootSku = item.getAttribute('data-cart-id') || item.getAttribute('data-item-id') || item.getAttribute('data-product-id') || item.getAttribute('data-sku');

            if (rootSku) {
                li.sku = rootSku;
            } else {
                var skuEl = item.querySelector('[data-item-id]') || firstMatch(item, FIELD_SEL.sku);
                if (skuEl) {
                    li.sku = skuEl.getAttribute('data-item-id') || skuEl.getAttribute('data-product-id') || skuEl.getAttribute('data-sku') || textOf(skuEl, 30);
                    if (!li.sku && (skuEl.tagName === 'A' || skuEl.hasAttribute('href'))) {
                        var href = skuEl.getAttribute('href') || '';
                        var match = href.match(/\/p\/(?:[^\/]+\/)*(\d+)/);
                        if (match) li.sku = match[1];
                    }
                }
            }

            var qtyEl = firstMatch(item, FIELD_SEL.cartItemQuantity);
            var qtyText = qtyEl ? (qtyEl.getAttribute('aria-valuenow') || qtyEl.getAttribute('value') || qtyEl.value || qtyEl.textContent).trim() : null;
            if (qtyText) li.quantity = parseInt(qtyText, 10);

            // FIX: Using parsePrice for Line Total
            var rawTotal = textOf(firstMatch(item, FIELD_SEL.cartItemLineTotal), 20);
            var parsedTotal = parsePrice(rawTotal);
            if (parsedTotal) li.line_total = parsedTotal.amount;

            // Cart markup (real and demo) only ever renders ONE price element
            // per line — the already-quantity-multiplied total (class
            // .cart-item-total). There's no separate unit-price element at
            // all, so FIELD_SEL.price's generic fallback grabs that same
            // element above, making li.price actually the line total
            // whenever quantity > 1 (masked until now — every prior scenario
            // used quantity 1, where price === line_total anyway). Derive
            // the true per-unit figures from the reliable line_total/qty.
            if (li.line_total != null && li.quantity > 1) {
                li.price = +(li.line_total / li.quantity).toFixed(2);
                if (li.old_price != null) li.old_price = +(li.old_price / li.quantity).toFixed(2);
            }


            // Per-line-item inline reason — a retailer-shown explanation for
            // why an expected discount didn't apply (e.g. "BOGO not
            // applicable to sale items."), distinct from the cart-level
            // promo_field_inline_reason which only covers the promo code box.
            var reasonEl = item.querySelector('.cart-item-note');
            if (reasonEl) {
                var reasonText = textOf(reasonEl, 80);
                if (reasonText) li.inline_reason = reasonText;
            }

            return li;
        }

        function collectCartLineItems(doc) {
            var items = doc.querySelectorAll(
                '#cartItems article.cart-item, #cartItems .cart-item, [data-automation-id="cart-item"]'
            );
            var lineItems = [];
            for (var i = 0; i < items.length; i++) {
                var li = buildCartLineItem(items[i]);
                if (li) lineItems.push(li);
            }
            return lineItems;
        }

        // old code for query selector
        /*function buildCheckoutLineItem(item) {
          var nameEl = item.querySelector('[class*="name"], span, strong, p');
          var priceEl = item.querySelector('[class*="price"], strong');
          var name = textOf(nameEl, 80);
          if (!name) return null;
          var li = { name: name };
          var price = textOf(priceEl, 20);
          if (price) li.price = price;
          return li;
        }*/

        //---------------New------------(add) - code for first match
        function buildCheckoutLineItem(item) {
            var name = textOf(firstMatch(item, FIELD_SEL.checkoutItemName), 80);
            if (!name) return null;
            var li = { name: name };

            // SKU — data-mini-id is the real attribute app.js's own
            // renderCheckout() sets on every mini-item (mirrored by the demo
            // override too), same idea as buildCartLineItem's sku lookup.
            var sku = item.getAttribute('data-mini-id') || item.getAttribute('data-product-id') || item.getAttribute('data-sku');
            if (sku) li.sku = sku;

            // FIX: Using parsePrice for Checkout Price
            var rawPrice = textOf(firstMatch(item, FIELD_SEL.checkoutItemPrice), 20);
            var parsed = parsePrice(rawPrice);
            if (parsed) {
                li.price = parsed.amount;
                if (parsed.currency) li.currency = parsed.currency;
            }

            // FIX: Force Quantity to be an Integer instead of a String —
            // strip non-digits first, since real checkout copy reads
            // "Qty 1", not a bare number (plain parseInt returns NaN on that).
            var qty = textOf(firstMatch(item, FIELD_SEL.checkoutItemQuantity), 20);
            if (qty) {
                var qNum = parseInt(qty.replace(/[^0-9]/g, ''), 10);
                if (!isNaN(qNum)) li.quantity = qNum;
            }

            return li;
        }


        function collectCheckoutLineItems(doc) {
            var lineItems = [];
            var seen = {};

            function addIfUnseen(item) {
                var key = (item.name || '') + '|' + (item.price || '');
                if (!seen[key]) { seen[key] = true; lineItems.push(item); }
            }

            // Generic pattern
            var items = doc.querySelectorAll('#checkoutItems .mini-cart-item, #checkoutItems [class*="item"], #checkoutItems li');
            for (var i = 0; i < items.length; i++) {
                var li = buildCheckoutLineItem(items[i]);
                if (li) addIfUnseen(li);
            }

            // HD bopis pattern: itemTitle_bopis_N / itemDescription_bopis_N / itemPrice_bopis_N
            var titleEls = doc.querySelectorAll('[data-automation-id^="itemTitle_bopis_"]');
            for (var j = 0; j < titleEls.length; j++) {
                var titleEl = titleEls[j];
                var brand = textOf(titleEl.querySelector('p'), 40);
                var descEl = titleEl.querySelector('[data-automation-id^="itemDescription_bopis_"]');
                var name = textOf(descEl ? descEl.querySelector('p') : null, 80);
                if (!name) continue;
                var item = { name: name };
                if (brand) item.brand = brand;
                var parent = titleEl.parentElement;
                var priceEl = parent ? parent.querySelector('[data-automation-id^="itemPrice_bopis_"]') : null;
                var price = textOf(priceEl ? priceEl.querySelector('p') : null, 20);
                if (price) item.price = price;
                var qtyEl = titleEl.querySelector('[data-automation-id^="itemQuantity_bopis_"]');
                var qty = textOf(qtyEl ? qtyEl.querySelector('p') : null, 10);
                if (qty) item.quantity = qty;
                addIfUnseen(item);
            }

            return lineItems;
        }
        // old code for queryselector
        /*function extractCartState(doc) {
          var result = { page_context: 'cart', line_items: collectCartLineItems(doc) };
    
          var subtotal = textOf(doc.querySelector('#summarySubtotal'), 20);
          var total = textOf(doc.querySelector('#summaryTotal'), 20);
          var savings = textOf(doc.querySelector('#summarySavings'), 20);
          var delivery = textOf(doc.querySelector('#summaryDelivery'), 20);
    
    
          if (subtotal) result.subtotal = subtotal;
          if (total) result.total = total;
          if (savings) result.savings_shown = savings;
          if (delivery) result.delivery_cost = delivery;
    
          // --- [NEW] Extracting Numerics for Tier 4 Math --- (Changes)
          if (subtotal) {
            var num = parseFloat(subtotal.replace(/[^0-9.-]+/g, ''));
            if (!isNaN(num)) result.subtotal_numeric = num;
          }
          if (total) {
            var numTotal = parseFloat(total.replace(/[^0-9.-]+/g, ''));
            if (!isNaN(numTotal)) result.total_numeric = numTotal;
          }
          if (savings) {
            var numSavings = parseFloat(savings.replace(/[^0-9.-]+/g, ''));
            if (!isNaN(numSavings)) result.savings_numeric = numSavings;
          }
          if (delivery) {
            var numDelivery = parseFloat(delivery.replace(/[^0-9.-]+/g, ''));
            if (!isNaN(numDelivery)) result.delivery_numeric = numDelivery;
          }
          // ----------------------------------------------
    
          var itemLabelEl = doc.querySelector('#cartItemLabel');
          if (itemLabelEl) {
            var n = parseInt(itemLabelEl.textContent);
            if (!isNaN(n)) result.item_count = n;
          }
    
          var shippingBar = doc.querySelector('#shippingProgress, .shipping-progress');
          result.promo_field_present = !!doc.querySelector('input[name*="discount"], input[name*="coupon"]');
          result.checkout_reachable = !!doc.querySelector('#checkoutButton');
          result.shipping_bar_shown = !!(shippingBar && shippingBar.textContent.trim());
    
          // --- [NEW] Extracting Tier 2 Missing Requirements --- (Changes)
    
          // 3(as per doc). Promotion line items
          var promoEls = doc.querySelectorAll('.cart-discount, .promo-applied, [data-automation-id="appliedPromotion"]');
          if (promoEls.length > 0) {
            result.promotions = [];
            promoEls.forEach(function (el) {
              var promo = {};
              var nameEl = el.querySelector('.promo-name, strong, p');
              var amtEl = el.querySelector('.promo-amount, .discount-amount, span');
    
              if (nameEl) promo.name = nameEl.textContent.trim();
              if (amtEl) {
                promo.amount = textOf(amtEl, 20);
    
                // Check for percentage like "20%" or "15%"
                var pctMatch = promo.amount.match(/(\d+)%/);
                if (pctMatch) promo.percentage = parseInt(pctMatch[1], 10);
              }
              if (promo.name || promo.amount) result.promotions.push(promo);
            });
          }
          // 4(as per doc). Loyalty discount line
          var loyaltyEl = doc.querySelector('.loyalty-discount, [data-automation-id="loyaltyDiscount"]');
          if (loyaltyEl) result.loyalty_discount = textOf(loyaltyEl, 20);
    
          // 5(as per doc). Tax line
          var taxEl = doc.querySelector('.summary-tax, #summaryTax, [data-automation-id="summaryTax"]');
          if (taxEl) {
            result.tax = textOf(taxEl, 20);
            var numTax = parseFloat(result.tax.replace(/[^0-9.-]+/g, ''));
            if (!isNaN(numTax)) result.tax_numeric = numTax;
          }
    
          // 6 & 7(as per doc). Shipping Promise & Threshold Messaging
          var shippingPromiseEl = doc.querySelector('.shipping-promise, #shippingPromise');
          if (shippingPromiseEl) result.shipping_promise = shippingPromiseEl.textContent.trim();
    
          var shippingThresholdEl = doc.querySelector('.shipping-threshold, #shippingProgress, .shipping-progress');
          if (shippingThresholdEl) {
            var msg = shippingThresholdEl.textContent.trim();
            result.shipping_threshold_message = msg;
    
            // 8(as per doc). Parse Free Shipping Eligibility
            var lowerMsg = msg.toLowerCase();
            if (lowerMsg.includes('you have free') || lowerMsg.includes('eligible') || lowerMsg.includes('qualify')) {
              result.free_shipping_eligibility = 'eligible';
            } else if (lowerMsg.includes('away from free') || lowerMsg.includes('add') || lowerMsg.includes('spend')) {
              result.free_shipping_eligibility = 'not-eligible';
            } else {
              result.free_shipping_eligibility = 'unknown';
            }
    
            // Extract threshold dollar value (e.g. "Add $15 for free shipping" -> 15)
            var threshNum = parseFloat(msg.replace(/[^0-9.-]+/g, ''));
            if (!isNaN(threshNum)) result.free_shipping_threshold_value = threshNum;
          }
          // ----------------------------------------------------
    
          return result;
        }*/

        //-----------NEW------(add) code for first match
        function extractCartState(doc) {
            var result = { page_context: 'cart', line_items: collectCartLineItems(doc) };

            var subtotal = textOf(firstMatch(doc, FIELD_SEL.cartSubtotal), 20);
            var total = textOf(firstMatch(doc, FIELD_SEL.cartTotal), 20);
            var savings = textOf(firstMatch(doc, FIELD_SEL.cartSavings), 20);
            var delivery = textOf(firstMatch(doc, FIELD_SEL.cartDelivery), 20);

            if (subtotal) {
                result.subtotal = subtotal;
                var parsedSub = parsePrice(subtotal);
                if (parsedSub) {
                    result.subtotal_numeric = parsedSub.amount;
                    if (parsedSub.currency) result.currency = parsedSub.currency;
                }
            }
            if (total) {
                result.total = total;
                var parsedTot = parsePrice(total);
                if (parsedTot) {
                    result.total_numeric = parsedTot.amount;
                    if (parsedTot.currency && !result.currency) result.currency = parsedTot.currency;
                }
            }
            if (savings) {
                result.savings_shown = savings;
                var parsedSav = parsePrice(savings);
                if (parsedSav) result.savings_numeric = parsedSav.amount;
            }
            if (delivery) {
                result.delivery_cost = delivery;
                var parsedDel = parsePrice(delivery);
                if (parsedDel) result.delivery_numeric = parsedDel.amount;
            }

            var markdownEl = firstMatch(doc, FIELD_SEL.cartMarkdown);
            var markdownDiscountAmt = 0;
            if (markdownEl) {
                var parsedMarkdown = parsePrice(markdownEl.textContent);
                if (parsedMarkdown) markdownDiscountAmt = Math.abs(parsedMarkdown.amount);
            }

            var itemLabelEl = doc.querySelector('#cartItemLabel');

            if (itemLabelEl) {
                var n = parseInt(itemLabelEl.textContent);
                if (!isNaN(n)) result.item_count = n;
            }

            var shippingBar = doc.querySelector('#shippingProgress, .shipping-progress');
            // old code 
            /*result.promo_field_present = !!doc.querySelector('input[name*="discount"], input[name*="coupon"]');*/

            // --- NEW TIER 2 EXTRACTION LOGIC --- w.r.t Canonical Signal Schema

            // 1. Promo field state (active, disabled, hidden, not-present, or
            // accepted/rejected once a code has actually been applied) —
            // read [data-promo-state] off the input or its wrapper when
            // present, defaulting to the original 'active' assumption
            // otherwise (Shopora never hides/disables the field itself).
            var promoInput = firstMatch(doc, FIELD_SEL.promoInput);
            if (promoInput) {
                var promoStateEl = promoInput.closest('[data-promo-state]');
                result.promo_field_state = promoStateEl ? promoStateEl.getAttribute('data-promo-state') : 'active';
                var appliedCodeEl = promoInput.closest('[data-applied-code]');
                if (appliedCodeEl) result.promo_applied_code = appliedCodeEl.getAttribute('data-applied-code');
            } else {
                result.promo_field_state = 'not-present';
            }
            result.promo_field_present = (result.promo_field_state !== 'not-present');


            // 2. Checkout controls (Alternative payment buttons)
            var altPayments = doc.querySelectorAll(FIELD_SEL.altPaymentButtons.join(', '));
            if (altPayments.length > 0) {
                result.alt_payment_methods = [];
                for (var i = 0; i < altPayments.length; i++) {
                    var btnClass = (altPayments[i].className || '').toLowerCase();
                    var btnId = (altPayments[i].id || '').toLowerCase();
                    if (btnClass.includes('apple') || btnId.includes('apple')) result.alt_payment_methods.push('apple_pay');
                    else if (btnClass.includes('paypal') || btnId.includes('paypal')) result.alt_payment_methods.push('paypal');
                    else if (btnClass.includes('google') || btnId.includes('google')) result.alt_payment_methods.push('google_pay');
                }
            }

            // 3. Applied discount constructs
            var discountConstructEls = doc.querySelectorAll(FIELD_SEL.appliedDiscountConstructs.join(', '));
            if (discountConstructEls.length > 0) {
                result.applied_discount_constructs = [];
                for (var k = 0; k < discountConstructEls.length; k++) {
                    var constructText = discountConstructEls[k].innerText.trim();
                    if (constructText) result.applied_discount_constructs.push(constructText);
                }
            }

            result.checkout_reachable = !!doc.querySelector('#checkoutButton');
            result.shipping_bar_shown = !!(shippingBar && shippingBar.textContent.trim());

            // 4. Promo Inline Reason 
            var promoReasonEl = firstMatch(doc, FIELD_SEL.promoInlineReason);
            if (promoReasonEl) result.promo_field_inline_reason = textOf(promoReasonEl, 40);

            // 5. Loyalty Balance Rendered 
            var loyaltyBalanceEl = firstMatch(doc, FIELD_SEL.loyaltyBalance);
            result.loyalty_balance_rendered = !!loyaltyBalanceEl;


            // 3. Promotion line items
            var promoEls = doc.querySelectorAll(FIELD_SEL.cartPromotions.join(', '));
            if (promoEls.length > 0) {
                result.promotions = [];
                promoEls.forEach(function (el) {
                    // #promoRow is always in the DOM, even with no promo
                    // applied — real app.js sets style.display='none' on it
                    // in that case (still visible in markup either way), so
                    // without this check every cart visit with no active
                    // promo reports a bogus {name:"", amount:"-$0.00"} entry.
                    if (el.style && el.style.display === 'none') return;
                    var promo = {};
                    var nameEl = el.querySelector('.promo-name, strong, p');
                    var amtEl = el.querySelector('.promo-amount, .discount-amount') || el.querySelector('span:not(.promo-name)');

                    if (nameEl) promo.name = nameEl.textContent.trim();
                    if (amtEl) {
                        promo.amount = textOf(amtEl, 20);
                        var pctMatch = promo.amount.match(/(\d+)%/);
                        if (pctMatch) promo.percentage = parseInt(pctMatch[1], 10);
                    }
                    if (promo.name || promo.amount) result.promotions.push(promo);
                });
            }

            // 4. Loyalty discount line
            var loyaltyEl = firstMatch(doc, FIELD_SEL.cartLoyalty);
            if (loyaltyEl && !(loyaltyEl.style && loyaltyEl.style.display === 'none')) {
                result.loyalty_discount = textOf(loyaltyEl, 60);
            }

            // 5. Tax line
            var taxEl = firstMatch(doc, FIELD_SEL.cartTax);
            if (taxEl) {
                result.tax = textOf(taxEl, 20);
                var numTax = parseFloat(result.tax.replace(/[^0-9.-]+/g, ''));
                if (!isNaN(numTax)) result.tax_numeric = numTax;
            }

            // 6 & 7. Shipping Promise & Threshold Messaging
            var shippingPromiseEl = doc.querySelector('.shipping-promise, #shippingPromise, [data-automation-id="pickupETA"], [data-testid="pickupTimeline"]');
            if (shippingPromiseEl) result.shipping_promise = shippingPromiseEl.textContent.trim();

            var shippingThresholdEl = firstMatch(doc, FIELD_SEL.cartShippingThreshold);
            if (shippingThresholdEl) {
                var msg = shippingThresholdEl.textContent.trim();
                result.shipping_threshold_message = msg;

                // 8. Parse Free Shipping Eligibility
                var lowerMsg = msg.toLowerCase();
                if (lowerMsg.includes('you have free') || lowerMsg.includes('eligible') || lowerMsg.includes('qualify') || lowerMsg.includes('unlocked')) {
                    result.free_shipping_eligibility = 'eligible';
                } else if (lowerMsg.includes('away from free') || lowerMsg.includes('add') || lowerMsg.includes('spend')) {
                    result.free_shipping_eligibility = 'not-eligible';
                } else {
                    result.free_shipping_eligibility = 'unknown';
                }
                // FIX: was parseFloat(msg.replace(/[^0-9.-]+/g, '')) — stripped
                // ALL non-digit chars from the WHOLE message, so a message with
                // two dollar figures (e.g. "Spend $12.01 more... delivery is
                // $5.99...") concatenated into garbage ("12.015.99" ->
                // parseFloat stops at the 2nd '.' -> 12.015). Match only the
                // first dollar figure instead.
                var nudgeMatch = msg.match(/\$\s*(\d+(?:\.\d{1,2})?)/);
                if (nudgeMatch) {
                    var nudgeAmount = parseFloat(nudgeMatch[1]);
                    result.free_shipping_nudge_amount = nudgeAmount;
                    // free_shipping_threshold_value should be the IMPLIED
                    // total threshold (what the nudge math suggests the free-
                    // shipping cutoff actually is), not just the gap amount —
                    // that's what lets a scanner compare it against the
                    // header's real claimed threshold. Only meaningful while
                    // not yet eligible; once eligible there's no gap to imply
                    // a threshold from.
                    if (result.free_shipping_eligibility === 'not-eligible' && result.subtotal_numeric != null) {
                        result.free_shipping_threshold_value = +(result.subtotal_numeric - markdownDiscountAmt + nudgeAmount).toFixed(2);
                    }

                }
            }


            return result;
        }

        // old code for query selector
        /*function extractCheckoutState(doc) {
          var result = { page_context: 'checkout', line_items: collectCheckoutLineItems(doc) };
    
          var subtotal = textOf(doc.querySelector('#checkoutSubtotal, [data-automation-id="totalsSubTotal"]'), 20);
          var total = textOf(doc.querySelector('#checkoutTotal, [data-automation-id="totalsTotal"]'), 20);
          var delivery = textOf(doc.querySelector('#checkoutDelivery'), 20);
    
          if (subtotal) result.subtotal = subtotal;
          if (total) result.total = total;
          if (delivery) result.delivery_cost = delivery;
    
          result.order_button_shown = !!doc.querySelector('#placeOrderButton, .place-order, [data-automation-id="checkoutButton"]');
          return result;
        }*/

        //---------NEW-------------add -code for first match
        function extractCheckoutState(doc) {
            var result = { page_context: 'checkout', line_items: collectCheckoutLineItems(doc) };

            var subtotal = textOf(firstMatch(doc, FIELD_SEL.checkoutSubtotal), 20);
            var total = textOf(firstMatch(doc, FIELD_SEL.checkoutTotal), 20);
            var delivery = textOf(firstMatch(doc, FIELD_SEL.checkoutDelivery), 20);
            var tax = textOf(firstMatch(doc, FIELD_SEL.checkoutTax), 20);

            if (subtotal) {
                result.subtotal = subtotal;
                var parsedSub = parsePrice(subtotal);
                if (parsedSub) {
                    result.subtotal_numeric = parsedSub.amount;
                    if (parsedSub.currency) result.currency = parsedSub.currency;
                }
            }
            if (total) {
                result.total = total;
                var parsedTot = parsePrice(total);
                if (parsedTot) {
                    result.total_numeric = parsedTot.amount;
                    if (parsedTot.currency && !result.currency) result.currency = parsedTot.currency;
                }
            }
            if (delivery) {
                result.delivery_cost = delivery;
                var parsedDel = parsePrice(delivery);
                if (parsedDel) result.delivery_numeric = parsedDel.amount;

                // Visible label for the delivery/shipping line (e.g.
                // "Delivery", "Oversized shipping fee") — the retailer's own
                // wording for WHY this charge exists, distinct from the
                // dollar amount alone.
                var deliveryEl = firstMatch(doc, FIELD_SEL.checkoutDelivery);
                var deliveryRow = deliveryEl && deliveryEl.closest ? deliveryEl.closest('.summary-row') : null;
                var deliveryLabelEl = deliveryRow ? deliveryRow.querySelector('span') : null;
                if (deliveryLabelEl) {
                    var deliveryLabel = textOf(deliveryLabelEl, 40);
                    if (deliveryLabel) result.delivery_label = deliveryLabel;
                }
            }
            if (tax) {
                result.tax = tax;
                var parsedTax = parsePrice(tax);
                if (parsedTax) result.tax_numeric = parsedTax.amount;
            }
            // Loyalty/member discount line (e.g. real app.js's "Shopora Plus
            // member 5% off" row on checkout) — mirrors cart's existing
            // loyalty_discount field, which this page never had.
            var checkoutLoyaltyEl = firstMatch(doc, FIELD_SEL.checkoutLoyalty);
            if (checkoutLoyaltyEl) {
                result.loyalty_discount = textOf(checkoutLoyaltyEl, 60);
                // Feed its dollar amount into savings_numeric so
                // cart_math_match's reconciliation (subtotal - savings + tax
                // + delivery) accounts for it — otherwise a real, correct
                // Plus-member checkout total would always look like a false
                // "math doesn't add up" coordination failure.
                var discMatch = result.loyalty_discount && result.loyalty_discount.match(/\$([\d,]+\.?\d*)/);
                if (discMatch) result.savings_numeric = parseFloat(discMatch[1].replace(/,/g, ''));
            }

            result.order_button_shown = !!firstMatch(doc, FIELD_SEL.checkoutOrderButton);

            return result;
        }

        function extractTier2(doc) {
            try {
                var isCart = !!doc.querySelector('.cart-layout, .cart-items, #cartItems, [data-automation-id="cart-item"]');
                var isCheckout = !!doc.querySelector('.checkout-layout, .checkout-summary, #checkoutItems, [data-testid="checkout-sections"], [data-automation-id^="itemTitle_bopis_"]');
                if (!isCart && !isCheckout) return null;
                if (isCart) return extractCartState(doc);
                if (isCheckout) return extractCheckoutState(doc);
                return null;
            } catch (e) { return null; }
        }


        // ── 10.3  TIER 3 — SURFACE AGGREGATES ─────────────────────────
        // Cheap pass over Tier 1 output. ~200 bytes.

        function numericAsc(a, b) { return a - b; }

        function accumulateTile(tile, acc) {
            if (tile.sponsored) acc.sponsored++;
            if (tile.has_markdown || tile.discount_pct) acc.discounted++;
            if (tile.availability === 'out-of-stock') acc.outOfStock++;
            if (tile.availability === 'low-stock') acc.lowStock++;
            if (tile.discount_pct) acc.discountPcts.push(tile.discount_pct);
            if (tile.price !== undefined && tile.price !== null) {
                var n = typeof tile.price === 'number' ? tile.price : parseFloat(String(tile.price).replace(/[^0-9.]/g, ''));
                if (!isNaN(n)) acc.prices.push(n);
            }
            // --- [NEW] Grab the currency from the product card --- (changes)
            if (tile.currency && acc.currencies.indexOf(tile.currency) === -1) {
                acc.currencies.push(tile.currency);
            }
            // ----------------------------------------------------
        }

        function computeMedian(sorted) {
            var mid = Math.floor(sorted.length / 2);
            return sorted.length % 2
                ? sorted[mid]
                : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
        }

        function extractTier3(t1Tiles) {
            try {
                if (!t1Tiles || !t1Tiles.length) return null;

                var acc = { sponsored: 0, discounted: 0, outOfStock: 0, lowStock: 0, discountPcts: [], prices: [], currencies: [] }; // added curriences:[] (Changes)
                for (var i = 0; i < t1Tiles.length; i++) {
                    accumulateTile(t1Tiles[i], acc);
                }

                var result = {
                    total_products: t1Tiles.length,
                    sponsored_count: acc.sponsored,
                    organic_count: t1Tiles.length - acc.sponsored,
                    discounted_count: acc.discounted,
                    full_price_count: t1Tiles.length - acc.discounted,
                    out_of_stock_count: acc.outOfStock,
                    low_stock_count: acc.lowStock,
                };

                if (acc.discountPcts.length) {
                    acc.discountPcts.sort(numericAsc);
                    result.discount_pct_min = acc.discountPcts[0];
                    result.discount_pct_max = acc.discountPcts[acc.discountPcts.length - 1];
                    result.discount_pct_median = computeMedian(acc.discountPcts);
                }

                if (acc.prices.length) {
                    acc.prices.sort(numericAsc);
                    result.price_min = acc.prices[0];
                    result.price_max = acc.prices[acc.prices.length - 1];

                    // --- [NEW] Attach the currency to the output --- (changes)
                    if (acc.currencies.length > 0) result.price_currency = acc.currencies[0];
                    // -----------------------------------------------
                }

                return result;
            } catch (e) { return null; }
        }


        // ── 10.4  TIER 4 — DOM CONSISTENCY SIGNALS ────────────────────
        // Boolean flags + the values being compared.
        // Tag notes discrepancies; backend holds source-of-truth.

        // old code for query selector
        /*function extractTier4(doc, t1Tiles, t2)//added t2 - (changes)
        {
          try {
            var signals = {};
    
            // --- [NEW] Page heading vs filter state --- (add)
            var h1 = doc.querySelector('h1');
            var activeFilter = doc.querySelector('.filter.active, [aria-current="page"], .active-filter');
            if (h1 && activeFilter) {
              signals.heading_matches_filter = h1.textContent.trim().toLowerCase() === activeFilter.textContent.trim().toLowerCase();
            }
    
            // --- [NEW] Cart Math Reconciliation --- (Changes)
            if (t2 && t2.subtotal_numeric !== undefined && t2.total_numeric !== undefined) {
              var sub = t2.subtotal_numeric || 0;
              var sav = t2.savings_numeric || 0;
              var tax = t2.tax_numeric || 0;
              var del = t2.delivery_numeric || 0;
    
              // Using penny-math to avoid JS floating point bugs!
              var calculatedTotal = Math.round((sub - sav + tax + del) * 100) / 100;
              signals.cart_math_match = (calculatedTotal === t2.total_numeric);
            }
            // ------------------------------------------
    
    
            // Header cart count vs. page item count
            var headerCartEl = doc.querySelector('[data-cart-count]');
            var cartItemLabelEl = doc.querySelector('#cartItemLabel');
            if (headerCartEl && cartItemLabelEl) {
              var headerCount = parseInt(
                headerCartEl.getAttribute('data-cart-count') || headerCartEl.textContent
              );
              var pageCount = parseInt(cartItemLabelEl.textContent);
              if (!isNaN(headerCount) && !isNaN(pageCount)) {
                signals.cart_count_match = headerCount === pageCount;
                signals.cart_count_header = headerCount;
                signals.cart_count_page = pageCount;
              }
            }
    
            // Sponsored-same-as-organic: any SKU appears in both buckets
            if (t1Tiles && t1Tiles.length && typeof Set !== 'undefined') {
              var sponsoredSkus = new Set();
              var organicSkus = new Set();
              t1Tiles.forEach(function (tile) {
                if (!tile.sku) return;
                if (tile.sponsored) sponsoredSkus.add(tile.sku);
                else organicSkus.add(tile.sku);
              });
              var overlap = false;
              sponsoredSkus.forEach(function (sku) {
                if (organicSkus.has(sku)) overlap = true;
              });
              if (overlap) signals.sponsored_same_as_organic = true;
            }
    
            // --- [NEW] Hero Matcher by SKU --- (Changes)
            var heroDealName = doc.querySelector('#heroDealName, .hero, #hero');
            if (heroDealName && t1Tiles && t1Tiles.length) {
              // Look for the SKU on the hero element itself or inside it
              var heroSkuEl = heroDealName.querySelector('[data-product-id], [data-sku]');
              var heroSku = heroSkuEl ? (heroSkuEl.getAttribute('data-product-id') || heroSkuEl.getAttribute('data-sku')) :
                (heroDealName.getAttribute('data-product-id') || heroDealName.getAttribute('data-sku'));
    
              if (heroSku) {
                signals.hero_product_in_grid = t1Tiles.some(function (tile) {
                  return tile.sku === heroSku;
                });
              }
            }*/
        // ---------------------------------

        /* old code
        // Hero product same as a card in the primary grid
        var heroDealName = doc.querySelector('#heroDealName');
        if (heroDealName && t1Tiles && t1Tiles.length) {
          var heroName = textOf(heroDealName, 80);
          if (heroName) {
            signals.hero_product_in_grid = t1Tiles.some(function (tile) {
              return tile.name === heroName;
            });
          }
        }*/

        /* 
       // Result count label vs. actual rendered card count
       var resultCountEl = doc.querySelector('[class*="result-count"], .results-count, #resultCount');
       if (resultCountEl && t1Tiles) {
         var match = resultCountEl.textContent.match(/(\d+)/);
         if (match) {
           signals.result_count_stated = parseInt(match[1]);
           signals.result_count_rendered = t1Tiles.length;
           signals.result_count_match = parseInt(match[1]) === t1Tiles.length;
         }
       }
    
       return Object.keys(signals).length ? signals : null;
     } catch (e) { return null; }
    }*/

        //----------------------NEW-------------------------- code for first match
        function extractTier4(doc, t1Tiles, t2) {
            try {
                var signals = {};
                // --- NEW: TIER 4 WISHLIST EXTRACTION ---
                var wishlistEl = doc.querySelector('[data-wishlist-count]');
                if (wishlistEl) {
                    var wlCountStr = wishlistEl.getAttribute('data-wishlist-count') || wishlistEl.textContent.trim();
                    if (wlCountStr) {
                        signals.wishlist_count = parseInt(wlCountStr, 10) || 0;
                    }
                }
                // --- NEW: DIRECTIVE 4 HYDRATION METRICS ---
                signals.hydration_events = [];
                if (window.__AIORA_HYDRATION_MS__ >= 0) {
                    signals.hydration_events.push({
                        metric: "cart_hydration_time_ms",
                        value: window.__AIORA_HYDRATION_MS__
                    });
                }

                var h1 = firstMatch(doc, FIELD_SEL.pageHeading);
                var activeFilter = firstMatch(doc, FIELD_SEL.activeFilter);
                if (h1 && activeFilter) {
                    signals.heading_matches_filter = h1.textContent.trim().toLowerCase() === activeFilter.textContent.trim().toLowerCase();
                }

                // --- [NEW] Cart Math Reconciliation --- (Changes)
                if (t2 && t2.subtotal_numeric !== undefined && t2.total_numeric !== undefined) {
                    var sub = t2.subtotal_numeric || 0;
                    var sav = t2.savings_numeric || 0;
                    var tax = t2.tax_numeric || 0;
                    var del = t2.delivery_numeric || 0;
                    // THE FIX: Calculate both potential scenarios using penny-math
                    var totalWithSavingsDeducted = Math.round((sub - sav + tax + del) * 100) / 100;
                    var totalWithoutSavingsDeducted = Math.round((sub + tax + del) * 100) / 100;

                    signals.cart_math_match = (t2.total_numeric === totalWithSavingsDeducted) ||
                        (t2.total_numeric === totalWithoutSavingsDeducted);
                }

                var headerCartEl = firstMatch(doc, FIELD_SEL.cartCount);
                if (headerCartEl) {
                    var headerCount = parseInt(
                        headerCartEl.getAttribute('data-cart-count') || headerCartEl.textContent
                    );
                    // Reported on EVERY page type, not just when a page-level
                    // item-count label also exists (that only exists on
                    // cart.html) — otherwise the header badge count is never
                    // captured at all on homepage/category/PDP/search, and a
                    // cart count that silently changes across navigation with
                    // no add/remove event in between would be invisible.
                    if (!isNaN(headerCount)) signals.cart_badge_count = headerCount;
                }
                var cartItemLabelEl = firstMatch(doc, FIELD_SEL.cartItemLabel);
                if (headerCartEl && cartItemLabelEl && !isNaN(signals.cart_badge_count)) {
                    var pageCount = parseInt(cartItemLabelEl.textContent);
                    if (!isNaN(pageCount)) {
                        signals.cart_count_match = signals.cart_badge_count === pageCount;
                        signals.cart_count_header = signals.cart_badge_count;
                        signals.cart_count_page = pageCount;
                    }
                }

                if (t1Tiles && t1Tiles.length && typeof Set !== 'undefined') {
                    var sponsoredSkus = new Set();
                    var organicSkus = new Set();
                    t1Tiles.forEach(function (tile) {
                        if (!tile.sku) return;
                        if (tile.sponsored) sponsoredSkus.add(tile.sku);
                        else organicSkus.add(tile.sku);
                    });
                    var overlap = false;
                    sponsoredSkus.forEach(function (sku) {
                        if (organicSkus.has(sku)) overlap = true;
                    });
                    if (overlap) signals.sponsored_same_as_organic = true;


                }


                /*var heroDealName = firstMatch(doc, FIELD_SEL.heroElement);
                if (heroDealName && t1Tiles && t1Tiles.length) {
                  var heroSkuEl = heroDealName.querySelector('[data-product-id], [data-sku]');
                  var heroSku = heroSkuEl ? (heroSkuEl.getAttribute('data-product-id') || heroSkuEl.getAttribute('data-sku')) :
                    (heroDealName.getAttribute('data-product-id') || heroDealName.getAttribute('data-sku'));
        
                  if (heroSku) {
                    signals.hero_product_in_grid = t1Tiles.some(function (tile) {
                      return tile.sku === heroSku;
                    });
                  }
                }*/

                //----new----
                // --- NEW: Hero Product Same-SKU Flag (Coordination Check) ---
                // Does the Hero product accidentally appear again in the recommendation grid below?
                if (t1Tiles && t1Tiles.length > 1 && t1Tiles[0].surface === 'hero' && t1Tiles[0].sku) {
                    var heroSku = t1Tiles[0].sku;
                    var duplicated = false;
                    // Loop through the rest of the grid to check for duplicates
                    for (var i = 1; i < t1Tiles.length; i++) {
                        if (t1Tiles[i].sku === heroSku) {
                            duplicated = true;
                            break;
                        }
                    }
                    signals.hero_product_in_grid = duplicated;
                }


                var resultCountEl = firstMatch(doc, FIELD_SEL.resultCount);
                if (resultCountEl && t1Tiles) {
                    var match = resultCountEl.textContent.match(/(\d+)/);
                    if (match) {
                        signals.result_count_stated = parseInt(match[1]);
                        signals.result_count_rendered = t1Tiles.length;
                        signals.result_count_match = parseInt(match[1]) === t1Tiles.length;
                    }
                }

                // --- NEW ADDITIONS FOR TIER 4 --- w.r.t. Canonical Signal Schema

                // 1. CSS Hidden Blocks (Checking for common hidden patterns)
                /*var hiddenEls = doc.querySelectorAll('.hidden, .d-none, .sr-only, [hidden], [style*="display: none"], [style*="display:none"]');
                if (hiddenEls.length > 0) {
                    signals.css_hidden_blocks = [];
                    // Cap at 5 to protect the 1KB budget!
                    for (var i = 0; i < Math.min(hiddenEls.length, 5); i++) {
                        var copy = textOf(hiddenEls[i], 100);
                        if (copy) {
                            signals.css_hidden_blocks.push({
                                selector: hiddenEls[i].className || hiddenEls[i].tagName.toLowerCase(),
                                gated_copy: copy,
                                rendered: false
                            });
                        }
                    }
                }*/
                var hiddenEls = doc.querySelectorAll('.hidden, .d-none, .sr-only, [hidden], [style*="display: none"], [style*="display:none"]');
                if (hiddenEls.length > 0) {
                    signals.css_hidden_blocks = [];
                    // Cap at 5 to protect the 1KB budget!
                    for (var i = 0; i < Math.min(hiddenEls.length, 5); i++) {
                        // Skip the real cart/checkout "promo discount" row
                        // (cart's #promoRow, checkout's #checkoutPromoRow) —
                        // it's legitimately hidden by design until a promo
                        // is active, not gated content worth flagging, and
                        // its default empty state ("Promo () Remove-$0.00")
                        // would otherwise show up as noise on every single
                        // cart/checkout capture that has no promo applied.
                        if (hiddenEls[i].classList && hiddenEls[i].classList.contains('savings')) continue;
                        var copy = textOf(hiddenEls[i], 100);
                        if (copy) {
                            signals.css_hidden_blocks.push({
                                selector: hiddenEls[i].className || hiddenEls[i].tagName.toLowerCase(),
                                gated_copy: copy,
                                rendered: false
                            });
                        }
                    }
                }

                // 2. Metadata (OG, Description, Twitter)
                var metaDesc = doc.querySelector('meta[name="description"]');
                var ogTags = doc.querySelectorAll('meta[property^="og:"]');
                var twitterTags = doc.querySelectorAll('meta[name^="twitter:"]');

                if (metaDesc || ogTags.length > 0 || twitterTags.length > 0) {
                    signals.metadata = {};

                    if (metaDesc) signals.metadata.meta_description = metaDesc.getAttribute('content');

                    if (ogTags.length > 0) {
                        signals.metadata.og = {};
                        for (var j = 0; j < ogTags.length; j++) {
                            var prop = ogTags[j].getAttribute('property').replace('og:', '');
                            signals.metadata.og[prop] = ogTags[j].getAttribute('content');
                        }
                    }

                    if (twitterTags.length > 0) {
                        signals.metadata.twitter = {};
                        for (var k = 0; k < twitterTags.length; k++) {
                            var tName = twitterTags[k].getAttribute('name').replace('twitter:', '');
                            signals.metadata.twitter[tName] = twitterTags[k].getAttribute('content');
                        }
                    }
                }

                // 3. Hydration events log (Empty array stub since JS tags can't natively capture React/Vue hydration hooks)
                /*signals.hydration_events = [];*/

                // 4. Raw unparsed URL (For backend reconciliation)
                if (typeof window !== 'undefined' && window.location) {
                    signals.raw_url = window.location.href;
                }

                return signals;
            } catch (e) { return null; }
        }
        //  10.5  TIER 5 - CUSTOMER / LOYALTY STATE 
        function extractTier5(doc) {
            try {
                var t5 = {};

                // 1. Logged in flag & Component Type (No PII Captured)
                // We look for a greeting message or account link in the header/DOM
                var greetingEl = doc.querySelector('.account-greeting, #header-account, [data-identity-state], .user-greeting');
                if (greetingEl) {
                    t5.component_type = 'header_chip'; // Assuming it's in the header for Shopora
                    var greetingText = greetingEl.textContent.trim().toLowerCase();

                    // If the text contains "guest" or "sign in", they are anonymous
                    if (greetingText.includes('guest') || greetingText.includes('sign in') || greetingText.includes('log in')) {
                        t5.logged_in = false;
                    } else {
                        // If there's a greeting but it doesn't say "guest", assume logged in
                        t5.logged_in = true;
                    }

                    // If the frontend explicitly provided our data attribute, use it!
                    var dataState = greetingEl.getAttribute('data-identity-state');
                    if (dataState) {
                        t5.logged_in = (dataState !== 'guest' && dataState !== 'unknown');
                    }
                } else {
                    t5.logged_in = false;
                    t5.component_type = 'unknown';
                }

                // 1b. ALL identity-state-bearing elements on the page, in
                // case more than one component disagrees (e.g. header says
                // recognized, a loyalty prompt elsewhere says guest) — only
                // reported when there's more than one, so a normal page
                // (exactly one identity element) sees zero change in output.
                var identityEls = doc.querySelectorAll('[data-identity-state]');
                if (identityEls.length > 1) {
                    var identitySignals = [];
                    for (var ie = 0; ie < identityEls.length; ie++) {
                        var ieEl = identityEls[ie];
                        var sig = {
                            component_type: ieEl.getAttribute('data-component') || (ieEl === greetingEl ? 'header_chip' : 'unknown'),
                            state: ieEl.getAttribute('data-identity-state')
                        };
                        var ieTier = ieEl.getAttribute('data-member-tier');
                        if (ieTier) sig.member_tier = ieTier;
                        identitySignals.push(sig);
                    }
                    t5.identity_signals = identitySignals;
                }

                // 2. Loyalty tier label (string)
                var tierEl = doc.querySelector('.loyalty-tier, .member-tier, [data-member-tier]');
                if (tierEl) {
                    t5.loyalty_tier_label = tierEl.getAttribute('data-member-tier') || tierEl.textContent.trim();
                }

                // 3. Points balance (numeric)
                var pointsEl = doc.querySelector('.points-balance, [data-loyalty-balance]');
                if (pointsEl) {
                    var ptsStr = pointsEl.getAttribute('data-loyalty-balance') || pointsEl.textContent.replace(/[^0-9]/g, '');
                    if (ptsStr) t5.points_balance = parseInt(ptsStr, 10);
                }

                // 4. Tier threshold messaging (string)
                var thresholdEl = doc.querySelector('.tier-threshold, .points-away, [data-tier-messaging]');
                if (thresholdEl) {
                    t5.tier_threshold_messaging = thresholdEl.textContent.trim();
                }

                // 5. Welcome / new-customer banner presence (boolean)
                var welcomeBanner = doc.querySelector('.welcome-banner, .new-customer-promo');
                t5.welcome_banner = !!welcomeBanner; // Converts to boolean true/false

                // 6. Active loyalty discount in cart (boolean)
                var loyaltyDiscountEl = doc.querySelector('.summary-card .loyalty-discount, .checkout-summary .loyalty-discount, .cart-summary .loyalty-discount, .order-total .member-discount, #coPlusMemberRow, #plusMemberRow');
                t5.active_loyalty_discount = !!(loyaltyDiscountEl && !(loyaltyDiscountEl.style && loyaltyDiscountEl.style.display === 'none'));


                return t5;
            } catch (e) {
                return null;
            }
        }

        // ── 10.5  TIER 6 — Promotional context ───────────────────────
        function uniqueList(arr) {
            var seen = [];
            for (var i = 0; i < arr.length; i++) {
                if (arr[i] && seen.indexOf(arr[i]) === -1) seen.push(arr[i]);
            }
            return seen;
        }


        function extractClaim(el) {
            if (!el) return null;
            var textScope = el.querySelector('.hero-copy') || el;
            var text = textScope.textContent || '';
            var percentAttr = el.getAttribute('data-claim-percent');
            var amountAttr = el.getAttribute('data-claim-amount');
            var typeAttr = el.getAttribute('data-claim-type');
            var scopeAttr = el.getAttribute('data-claim-scope');
            var codeAttr = el.getAttribute('data-claim-code');
            var minSpendAttr = el.getAttribute('data-claim-min-spend');
            var percentMatch = text.match(/(\d{1,3})\s*%/);
            // Strip "over $X" / "above $X" / "spend $X" phrases first — those
            // describe a min-spend THRESHOLD (already captured separately via
            // data-claim-min-spend), not a dollar-off claim amount. Without
            // this, real leftover promo text like "orders over $50" gets
            // misread as a $50-off claim alongside a genuine 35%-off claim.
            var textForAmount = text.replace(/\b(?:over|above|spend)\s+\$\s*\d+(?:\.\d{1,2})?/gi, '');
            var amountMatch = textForAmount.match(/\$\s*(\d+(?:\.\d{1,2})?)/);


            var percent = percentAttr ? Number(percentAttr) : (percentMatch ? Number(percentMatch[1]) : null);
            var amount = amountAttr ? Number(amountAttr) : (amountMatch ? Number(amountMatch[1]) : null);
            var scope = scopeAttr || null;

            // Fallback scope inference: scan the module's own text for known
            // category words when no explicit data-claim-scope is present.
            if (!scope) {
                var categoryWords = ['electronics', 'fashion', 'home', 'books'];
                var lowerText = text.toLowerCase();
                for (var i = 0; i < categoryWords.length; i++) {
                    if (lowerText.indexOf(categoryWords[i]) !== -1) { scope = categoryWords[i]; break; }
                }
            }

            if (percent == null && amount == null && !scope) return null; // nothing claim-worthy here

            var inferredType = percent != null ? 'percentage' : (amount != null ? 'dollar_off' : null);
            var claim = { percent: percent, amount: amount, type: typeAttr || inferredType, scope: scope };
            if (codeAttr) claim.code = codeAttr;
            if (minSpendAttr) claim.min_spend = Number(minSpendAttr);
            return claim;
        }


        function extractDisclosure(el) {
            if (!el) return null;
            var text = el.textContent || '';
            var hasAsterisk = /\*/.test(text);
            var hasDagger = /†/.test(text);
            var hasTermsApply = /terms apply|t&c|conditions apply/i.test(text);
            if (!hasAsterisk && !hasDagger && !hasTermsApply) return null;
            return { asterisk: hasAsterisk, dagger: hasDagger, terms_apply_text: hasTermsApply };
        }

        function buildModule(el, type, position) {
            if (!el) return null;
            var mod = {
                module_id: el.id || el.getAttribute('data-module-id') || null,
                module_type: el.getAttribute('data-module-type') || type,
                position: position,
                in_grid: !!el.closest('.product-grid, .catalog-grid, #dealStrip')
            };

            var claim = extractClaim(el);
            if (claim) mod.claim = claim;

            var disclosure = extractDisclosure(el);
            if (disclosure) mod.disclosure = disclosure;

            // CTA: the module itself if it's a link, else the first CTA inside it.
            var ctaEl = (el.tagName === 'A') ? el : firstMatch(el, ['a.button', 'button', 'b', 'a']);
            if (ctaEl) {
                mod.cta_label = textOf(ctaEl, 80);
                if (ctaEl.getAttribute && ctaEl.getAttribute('href')) mod.cta_href = ctaEl.getAttribute('href');
            }

            var sponsoredLabel = el.querySelector('.sponsored-label, .ad-label, [data-sponsored="true"]');
            if (sponsoredLabel) mod.banner_label = 'sponsored';

            var campaignRef = el.getAttribute('data-campaign') || el.getAttribute('data-claim-code');
            if (campaignRef) mod.campaign_ref = campaignRef;

            return mod;
        }

        function extractTier6(doc) {
            try {
                var result = {};

                // 1. Header announcement bar items (each as its own string).
                var announcementEls = doc.querySelectorAll(FIELD_SEL.announcementBar.join(', '));
                if (announcementEls.length) {
                    var announcementItems = [];
                    for (var a = 0; a < announcementEls.length; a++) {
                        var itemText = textOf(announcementEls[a], 60);
                        if (itemText) announcementItems.push(itemText);
                    }
                    announcementItems = uniqueList(announcementItems);
                    if (announcementItems.length) result.announcement_bar = announcementItems;

                    // 1b. Free-shipping threshold CLAIM, parsed out of the
                    // announcement bar — e.g. "Free delivery above $35" -> 35.
                    // Kept as its own number (not just inside the plain-text
                    // announcement_bar array) so it's directly comparable
                    // against whatever the cart page's shipping nudge implies.
                    for (var ai = 0; ai < announcementItems.length; ai++) {
                        var aiLower = announcementItems[ai].toLowerCase();
                        if (aiLower.indexOf('free delivery') !== -1 || aiLower.indexOf('free shipping') !== -1) {
                            var claimMatch = announcementItems[ai].match(/\$\s*(\d+(?:\.\d{1,2})?)/);
                            if (claimMatch) result.free_shipping_claim_threshold = Number(claimMatch[1]);
                            break;
                        }
                    }
                }

                var modules = [];
                var position = 1;

                // 2. Hero module.
                var heroEl = firstMatch(doc, FIELD_SEL.heroModule);
                if (heroEl) {
                    var heroMod = buildModule(heroEl, 'hero', position++);
                    if (heroMod) {
                        var headline = textOf(firstMatch(doc, FIELD_SEL.heroHeadline), 80);
                        var subheading = textOf(firstMatch(doc, FIELD_SEL.heroSubheading), 120);
                        var offerText = textOf(firstMatch(doc, FIELD_SEL.heroOfferText), 60);
                        if (headline) heroMod.headline = headline;
                        if (subheading) heroMod.subheading = subheading;
                        if (offerText) heroMod.offer_text = offerText;
                        var heroCta = firstMatch(doc, FIELD_SEL.heroCta);
                        if (heroCta) {
                            heroMod.cta_label = textOf(heroCta, 80);
                            if (heroCta.getAttribute('href')) heroMod.cta_href = heroCta.getAttribute('href');
                        }
                        modules.push(heroMod);
                    }
                }

                // 3. Promo banner modules (full-width banners between sections).
                var promoBannerEls = doc.querySelectorAll(FIELD_SEL.promoBanner.join(', '));
                for (var p = 0; p < promoBannerEls.length; p++) {
                    var promoMod = buildModule(promoBannerEls[p], 'banner', position++);
                    if (promoMod) {
                        var promoHeading = textOf(promoBannerEls[p].querySelector('h2, h3'), 80);
                        if (promoHeading) promoMod.headline = promoHeading;
                        modules.push(promoMod);
                    }
                }

                // 3b. Newsletter signup module + loyalty-tier rail offer — both
                // are just claim-bearing text blocks elsewhere on the homepage,
                // reusing the same buildModule()/extractClaim() engine as the
                // hero and promo banners above (no new parsing logic needed).
                // Real site copy already contains a Shopora Plus loyalty claim
                // in the header rail; the newsletter's real copy has no percent
                // claim at all unless a demo scenario injects one.
                var newsletterEl = doc.querySelector('.newsletter');
                if (newsletterEl) {
                    var newsletterMod = buildModule(newsletterEl, 'newsletter', position);
                    if (newsletterMod && newsletterMod.claim) { modules.push(newsletterMod); position++; }
                }
                var loyaltyOfferEl = doc.querySelector('.rail-offer');
                if (loyaltyOfferEl) {
                    var loyaltyMod = buildModule(loyaltyOfferEl, 'loyalty', position);
                    if (loyaltyMod && loyaltyMod.claim) { modules.push(loyaltyMod); position++; }
                }
                // Cart-page "Customers also bought" recommendations — real,
                // always-on section, but only reported as a module when a demo
                // scenario explicitly tags it with data-parent-context (same
                // opt-in-via-signal-presence pattern as newsletter/loyalty above).
                var recsEl = doc.querySelector('.cart-recommendations');
                if (recsEl) {
                    var recsMod = {
                        module_id: recsEl.id || recsEl.getAttribute('data-module-id') || null,
                        module_type: recsEl.getAttribute('data-module-type') || 'recommendations',
                        position: position,
                        in_grid: false,
                        parent_context: recsEl.getAttribute('data-parent-context') || null
                    };
                    if (recsMod.parent_context) { modules.push(recsMod); position++; }
                }

                if (modules.length) result.modules = modules;


                // 4. Countdown timer.
                var countdownEl = firstMatch(doc, FIELD_SEL.countdown);
                if (countdownEl) {
                    result.countdown_present = true;
                    var countdownValueEl = firstMatch(countdownEl, FIELD_SEL.countdownValue) || firstMatch(doc, FIELD_SEL.countdownValue);
                    result.countdown_value = textOf(countdownValueEl, 20);
                    result.countdown_context = textOf(countdownEl, 60);
                    result.countdown_hard_deadline = countdownEl.hasAttribute('data-deadline-timestamp');
                } else {
                    result.countdown_present = false;
                }

                // 4b. Homepage "Deal of the day" spotlight product — a single featured
                // item distinct from the regular grid/carousel tiles, so it isn't picked
                // up by the generic card scanner (no .product-card class, custom IDs).
                // Captured here, right next to the countdown, so a countdown implying
                // urgency and a spotlight product with no actual discount are directly
                // comparable in the same payload.
                var dealNameEl = doc.querySelector('#heroDealName');
                if (dealNameEl) {
                    var dealName = textOf(dealNameEl, 80);
                    if (dealName) {
                        var deal = { name: dealName };
                        var dealCard = dealNameEl.closest('.hero-deal-card') || dealNameEl.parentElement;
                        var dealSku = dealCard && (dealCard.getAttribute('data-product-id') || dealCard.getAttribute('data-sku'));
                        if (dealSku) deal.sku = dealSku;
                        var dealPriceEl = doc.querySelector('#heroDealPrice');
                        var parsedDealPrice = parsePrice(textOf(dealPriceEl, 20));
                        if (parsedDealPrice) { deal.price = parsedDealPrice.amount; if (parsedDealPrice.currency) deal.currency = parsedDealPrice.currency; }
                        var dealOldEl = doc.querySelector('#heroDealOld');
                        var dealOldText = dealOldEl ? textOf(dealOldEl, 20) : null;
                        var parsedDealOld = dealOldText ? parsePrice(dealOldText) : null;
                        deal.has_discount = !!(parsedDealOld && parsedDealPrice && parsedDealOld.amount !== parsedDealPrice.amount);
                        if (deal.has_discount) deal.old_price = parsedDealOld.amount;
                        result.deal_of_day = deal;
                    }
                }

                // 5. Advertised discount constructs — codes attached to any claim found above.
                var advertisedCodes = [];
                for (var m = 0; m < modules.length; m++) {
                    if (modules[m].claim && modules[m].claim.code) advertisedCodes.push(modules[m].claim.code);
                }
                advertisedCodes = uniqueList(advertisedCodes);
                if (advertisedCodes.length) result.advertised_discount_constructs = advertisedCodes;

                // 6. Per-card urgency messaging + deal chips — progressive budget cutoff,
                // since this is the first thing the doc says to drop if Tier 6 runs long.
                var urgencyMsgs = [];
                var dealChips = [];
                var cards = doc.querySelectorAll('.product-card, .product-tile, article');
                for (var k = 0; k < cards.length; k++) {
                    if (JSON.stringify(result).length + JSON.stringify(urgencyMsgs).length + JSON.stringify(dealChips).length > 1800) break;

                    var urgencyEl = firstMatch(cards[k], FIELD_SEL.scarcityMsg);
                    var chipEl = firstMatch(cards[k], FIELD_SEL.dealChip);

                    if (urgencyEl) { var uText = textOf(urgencyEl, 40); if (uText) urgencyMsgs.push(uText); }
                    if (chipEl) { var cText = textOf(chipEl, 30); if (cText) dealChips.push(cText); }
                }
                urgencyMsgs = uniqueList(urgencyMsgs);
                dealChips = uniqueList(dealChips);
                if (urgencyMsgs.length) result.urgency_messages = urgencyMsgs;
                if (dealChips.length) result.deal_chips = dealChips;

                return Object.keys(result).length ? result : null;
            } catch (e) {
                return null;
            }
        }


        // ── 10.5  TIERS 7–9 — STUBS (Phase 2+) ───────────────────────

        function extractTier7() { return null; } // Search context
        function extractTier8() { return null; } // Trust / social proof
        function extractTier9() { return null; } // Recommendation set detail


        // ================================================================
        // SECTION 11 — PAGE-TYPE ROUTER
        // Each page type gets a specific subset of tiers.
        // ================================================================

        var TIER_ROUTES = {
            homepage: [0, 1, 3, 4, 5, 6, 8],
            category: [0, 1, 3, 4, 5, 6, 7, 8],
            cart: [0, 1, 2, 3, 4, 5, 6, 9],
            checkout: [0, 1, 2, 4, 5, 6],
            pdp: [0, 1, 2, 4, 5, 6, 8, 9],
            search: [0, 1, 3, 4, 5, 6, 7, 8],
            other: [0, 4, 5],
        };

        function getActiveTiers(pageType) {
            return TIER_ROUTES[pageType] || TIER_ROUTES.other;
        }


        // ================================================================
        // SECTION 12 — CONFIG FETCH STUB
        // Non-blocking per-retailer selector overrides.
        // 200 ms timeout, fails open with defaults.
        // Replace body when /v1/config/{clientId} is live.
        // ================================================================

        function fetchRetailerConfig() {
            return Promise.resolve({});
        }


        // ================================================================
        // SECTION 13 — PAYLOAD ASSEMBLY
        // Runs router → tiers in order → budget enforcement.
        // No raw DOM field.
        // ================================================================

        function assemblePayload(doc) {
            var budget = makeBudget();

            var t0 = extractTier0(true);
            budget.add(0, t0);

            var pageType = t0.page_type || 'other';
            var activeTiers = getActiveTiers(pageType);
            var has = function (n) { return activeTiers.indexOf(n) !== -1; };

            var t1 = null, t2 = null, t3 = null, t4 = null, t5 = null, t6 = null;

            if (has(1) && !budget.isOver()) {
                t1 = extractTier1(doc, pageType); //NEW pagetype
                budget.add(1, t1);
            } else if (!has(1)) {
                budget.drop(1);
            }

            if (has(2) && !budget.isOver()) {
                t2 = extractTier2(doc);
                if (t2) budget.add(2, t2);
            }

            if (has(3) && !budget.isOver() && t1) {
                t3 = extractTier3(t1);
                if (t3) budget.add(3, t3);
            }

            if (has(4) && !budget.isOver()) {
                t4 = extractTier4(doc, t1, t2);//added t2 (passes from the Tier 2 numbers down) --(Changes)
                if (t4) budget.add(4, t4);
            }

            if (has(5) && !budget.isOver()) {
                t5 = extractTier5(doc);
                if (t5) budget.add(5, t5);
            }

            if (has(6) && !budget.isOver()) {
                t6 = extractTier6(doc);
                if (t6) budget.add(6, t6);
            }
            var signals = {};
            if (t1 !== null) signals.t1 = t1;
            if (t2 !== null) signals.t2 = t2;
            if (t3 !== null) signals.t3 = t3;
            if (t4 !== null) signals.t4 = t4;
            if (t5 !== null) signals.t5 = t5;
            if (t6 !== null) signals.t6 = t6;



            var payload = Object.assign({
                schema_version: '0.2.0',
                beacon_id: crypto.randomUUID()
            }, t0, {
                page: {
                    page_type: pageType,
                    page_url: window.location.origin + (window.location.pathname.replace(/\/index\.html$/i, '') || '/') + window.location.search + window.location.hash,
                },
                signals: signals,
                budget: budget.summary(),
                privacy_metadata: {
                    pii_scrubbing_version: '0.2.0',
                    local_scrubbing_applied: true,
                    inputs_scrubbed: true,
                    scripts_removed: true,
                    styles_removed: true,
                    persistent_storage_used: false,
                },
            });
            return payload;
        }

        // -------OLD CODE (without dom mutation)-------------------
        // ================================================================
        // SECTION 14 — SEND
        // Fire and forget. Never blocks. Never retries.
        // ================================================================

        /*function sendPayload(payload) {
          if (beaconFired) return;
          beaconFired = true;
    
          const blob = new Blob(
            [JSON.stringify(payload)],
            { type: 'text/plain' }
          );
    
          const queued = navigator.sendBeacon(config.endpoint, blob);
    
          if (!queued) {
            console.warn('[AIORA] sendBeacon returned false. Beacon was not queued.');
          }
        }
    
    
        // ================================================================
        // SECTION 15 — MAIN EXECUTION
        // ================================================================
    
        function onIdleReady() {
          var rawHTML = document.documentElement.outerHTML;
          var scrubbedDoc = scrubPII(rawHTML);
          var payload = assemblePayload(scrubbedDoc);
          sendPayload(payload);
        }
    
        function onHydrationComplete() {
          fetchRetailerConfig().then(function () {
            waitForIdle(onIdleReady);
          });
        }
    
        waitForHydration(onHydrationComplete);*/

        //------NEW CODE ACCORDING TO DIRECTIVE 1 & 3-----------------
        //-------SECTION 14 and 15-------------------

        // ================================================================
        // SECTION 14 — SEND
        // Fire and forget. Never blocks. Never retries.
        // ================================================================

        // NEW: We track the sequence globally so Payload 2 gets sequence_no: 2
        var globalSequenceNo = 1;

        function sendPayload(payload) {
            // OVERRIDE the sequence number right before sending!
            payload.sequence_no = globalSequenceNo++;

            const blob = new Blob(
                [JSON.stringify(payload)],
                { type: 'text/plain' }
            );

            const queued = navigator.sendBeacon(config.endpoint, blob);

            if (!queued) {
                console.warn('[AIORA] sendBeacon returned false. Beacon was not queued.');
            }
        }

        // ================================================================
        // SECTION 15 — MAIN EXECUTION & MUTATION OBSERVER
        // ================================================================

        function onIdleReady() {
            var rawHTML = document.documentElement.outerHTML;
            var scrubbedDoc = scrubPII(rawHTML);
            var payload = assemblePayload(scrubbedDoc);
            sendPayload(payload);
        }

        // Handles the INITIAL page load payload
        function onHydrationComplete() {
            fetchRetailerConfig().then(function () {
                waitForIdle(onIdleReady);
                //startContinuousObserver(); // NEW: Start watching for future changes!

                initTier10(); // Live Interaction


            });
        }

        // NEW: DIRECTIVE 3 - The Continuous Mutation Observer
        function startContinuousObserver() {
            var mutationTimer = null;

            var observer = new MutationObserver(function () {
                clearTimeout(mutationTimer);
                // Debounce timer: wait 500ms after the DOM STOPS moving before firing
                mutationTimer = setTimeout(function () {
                    waitForIdle(onIdleReady);
                }, 500);
            });

            if (document.body) {
                // We watch the whole body for elements added/removed or text changed
                observer.observe(document.body, { childList: true, subtree: true, attributes: true });
            }
        }

        waitForHydration(onHydrationComplete);


        // --- NEW: Event-Driven Tracking ---
        // ================================================================
        // SECTION 16 — TIER 10 (INTERACTION EVENTS / INVISIBLE SPY)
        // ================================================================

        var interactionBuffer = [];
        var interactionTimer = null;
        var MAX_BUFFER_SIZE = 15;
        var MAX_BUFFER_BYTES = 8192;
        var FLUSH_INTERVAL_MS = 15000;

        function extractCurrency(text) {
            if (!text) return null;
            var match = text.match(/[\$£€₹¥]/);
            return match ? match[0] : null;
        }

        function flushInteractionEvents(reason) {
            if (interactionBuffer.length === 0) return;

            var payload = {
                envelope_type: "interaction_events",
                schema_version: "0.2.0",
                tag_version: "0.2.0",
                client_id: config.clientId,
                session_token: sessionToken,
                flush_id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).substring(2),
                flush_reason: reason,
                events: interactionBuffer
            };

            var payloadString = JSON.stringify(payload);
            interactionBuffer = []; // Clear immediately
            if (interactionTimer) { clearTimeout(interactionTimer); interactionTimer = null; }
            try {
                if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
                    var success = navigator.sendBeacon(config.endpoint, payloadString);
                    if (!success && typeof fetch !== 'undefined') {
                        fetch(config.endpoint, { method: "POST", body: payloadString, keepalive: true }).catch(function () { });
                    }
                } else if (typeof fetch !== 'undefined') {
                    fetch(config.endpoint, { method: "POST", body: payloadString, keepalive: true }).catch(function () { });
                }
            } catch (e) { }
        }

        function pushEvent(eventType, fields, flushImmediately) {
            var eventObj = {
                event_id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).substring(2),
                event_type: eventType,
                timestamp: new Date().toISOString(),
                page_type: document.body.dataset.pageType || 'unknown',
                // old (index.html) : page_url_path: window.location.pathname
                page_url_path: window.location.pathname.replace(/\/index\.html$/i, '') || '/'

            };

            for (var k in fields) { if (fields.hasOwnProperty(k)) eventObj[k] = fields[k]; }

            interactionBuffer.push(eventObj);

            var currentSizeBytes = JSON.stringify(interactionBuffer).length;
            if (flushImmediately || interactionBuffer.length >= 15 || currentSizeBytes >= 8192) {
                flushInteractionEvents(flushImmediately ? "immediate_navigation" : "size");
            } else if (!interactionTimer) {
                interactionTimer = setTimeout(function () { flushInteractionEvents("time"); }, 15000);
            }
        }

        // ================================================================
        // NEW : Priority 2 - handleDocumentSubmit
        // Tracks search_submitted events
        // ================================================================
        function handleDocumentSubmit(e) {
            try {
                var target = e.target;
                if (!target || target.tagName !== 'FORM') return;

                // MATCH: search_submitted
                var isSearchForm = target.matches('form[role="search"], form#searchForm, form.search-form') ||
                    !!target.querySelector('input[type="search"], input[name="q"], input[name="search"]');

                if (isSearchForm) {
                    var searchInput = target.querySelector('input[type="search"], input[name="q"], input[name="search"]');
                    var searchData = {
                        query: searchInput ? searchInput.value.trim() : null,
                        category_scope: null,
                        submission_surface: 'on-page-search-widget'
                    };

                    // Try to find a category scope dropdown (like Amazon's "All Departments")
                    var scopeDropdown = target.querySelector('select');
                    if (scopeDropdown && scopeDropdown.selectedOptions && scopeDropdown.selectedOptions.length) {
                        searchData.category_scope = scopeDropdown.selectedOptions[0].text;
                    }

                    if (target.closest('header')) searchData.submission_surface = 'header-search';
                    else if (target.closest('.mobile-menu, [role="navigation"]')) searchData.submission_surface = 'mobile-search';

                    pushEvent("search_submitted", searchData, true);
                }
                // MATCH: purchase_completed (SPA form submit on checkout page)
                var isCheckoutForm = target.matches('form#checkoutForm, form.checkout-form') || target.querySelector('[data-action="place-order"], .place-order, #placeOrderButton');
                if (isCheckoutForm) {
                    var orderData = { order_confirmed: true, order_total_displayed: null, order_currency: null, line_item_count: 0 };
                    var totalEl = firstMatch(document, FIELD_SEL.checkoutTotal) || document.querySelector('.order-total');
                    if (totalEl) {
                        orderData.order_total_displayed = totalEl.textContent.trim();
                        orderData.order_currency = extractCurrency(orderData.order_total_displayed);
                    }
                    var items = document.querySelectorAll('#checkoutItems .mini-item, #checkoutItems li, .order-item');
                    orderData.line_item_count = items.length;

                    pushEvent("purchase_completed", orderData, true); // Flush immediately!
                }


            } catch (err) { }
        }

        // ================================================================
        // NEW : Priority 2 - handleDocumentChange
        // Tracks sort_changed and checkbox-based filters
        // ================================================================
        function handleDocumentChange(e) {
            try {
                var target = e.target;
                if (!target) return;

                // MATCH: sort_changed
                if (target.tagName === 'SELECT' && (target.name.toLowerCase().includes('sort') || target.id.toLowerCase().includes('sort') || target.className.toLowerCase().includes('sort'))) {
                    var sortData = {
                        sort_value: target.value || target.options[target.selectedIndex].text,
                        page_type: document.body.dataset.pageType || 'unknown'
                    };
                    pushEvent("sort_changed", sortData);
                    return;
                }

                // MATCH: filter_applied / filter_removed (for checkboxes/radios)
                var isFilterInput = target.tagName === 'INPUT' && (target.type === 'checkbox' || target.type === 'radio') && (target.closest('.filters, .facets, aside, [role="complementary"]') || target.name.toLowerCase().includes('filter'));

                if (isFilterInput) {
                    var isApplied = target.checked;
                    var filterData = {
                        filter_type: target.getAttribute('aria-label') || target.name || target.closest('fieldset, .filter-group, .facet')?.querySelector('legend, h3, h4, span, strong')?.textContent.trim() || target.closest('[data-filter-group]')?.getAttribute('data-filter-group') || 'unknown',
                        filter_value: target.value || target.nextElementSibling?.textContent?.trim() || 'unknown',
                        active_filter_count_after: document.querySelectorAll('.filters input:checked, .facets input:checked').length
                    };
                    pushEvent(isApplied ? "filter_applied" : "filter_removed", filterData);
                }
            } catch (err) { }
        }

        function handleDocumentClick(e) {
            try {
                var target = e.target;
                if (!target) return;

                // ================================================================
                // NEW : Priority 3 - promo_code_applied / promo_removed
                // ================================================================
                // 1. Check for Promo Remove Click
                var isPromoRemove = target.closest('#removePromoBtn, button[id*="removePromo"]');
                if (isPromoRemove) {
                    var removedCode = document.querySelector('#promoCodeName') ? document.querySelector('#promoCodeName').textContent.trim() : 'unknown';
                    pushEvent("promo_removed", { code: removedCode });
                    return; // Stop here so remove_from_cart doesn't fire!
                }
                // 2. Check for Promo Apply Click
                var isPromoClick = target.closest('#applyPromoBtn, button[id*="promo"], button[id*="apply"]');
                if (isPromoClick) {
                    var promoInputEl = document.querySelector('#promoInput, input[name*="promo"], input[name*="discount"]');
                    if (promoInputEl) {
                        var codeStr = promoInputEl.value.trim();
                        // Wait 500ms to allow your app.js logic to run and update the UI
                        setTimeout(function () {
                            var promoData = {
                                code: codeStr,
                                result: 'unknown',
                                discount_amount_shown: null
                            };
                            // Check if an error message appeared
                            var errorEl = document.querySelector('.promo-error, .discount-error, #promoError, .toast.error');
                            if (errorEl && errorEl.offsetParent !== null) {
                                promoData.result = 'rejected';
                                pushEvent("promo_code_rejected", promoData);
                            } else {
                                // Check if the success row is visible
                                var successEl = document.querySelector('#promoRow, .promo-applied');
                                if (successEl && successEl.offsetParent !== null) {
                                    promoData.result = 'accepted';
                                    var amtEl = successEl.querySelector('#summaryPromo, .promo-amount');
                                    if (amtEl) promoData.discount_amount_shown = amtEl.textContent.trim();
                                }
                                pushEvent("promo_code_applied", promoData);
                            }
                            // Re-capture the full payload now that the cart reflects
                            // the promo — the initial page-load payload predates this.
                            waitForIdle(onIdleReady);
                        }, 500);

                    }
                    return; // Stop here so no other generic rules catch this click
                }

                // ================================================================
                // NEW : Priority 1: MATCH: checkout_initiated
                // ================================================================
                var isCheckoutBtn = target.closest('[data-action="checkout"], .checkout-button, #placeOrderButton, #checkoutButton, [href*="checkout"], [data-automation-id="checkoutButton"]') ||
                    ((target.tagName === 'BUTTON' || target.tagName === 'A') && /(proceed to checkout|checkout|continue to checkout)/i.test(target.textContent));
                if (isCheckoutBtn && (window.location.href.toLowerCase().includes('/cart') || window.location.href.toLowerCase().includes('cart.html') || !!document.querySelector('.cart-layout') || document.body.dataset.pageType === 'cart')) {
                    var cartTotals = { cart_line_count: 0, cart_displayed_total: null, cart_displayed_currency: null };
                    var items = document.querySelectorAll('#cartItems article.cart-item, #cartItems .cart-item, [data-automation-id="cart-item"]');
                    cartTotals.cart_line_count = items.length;

                    var totalEl = firstMatch(document, FIELD_SEL.cartTotal);
                    if (totalEl) {
                        cartTotals.cart_displayed_total = totalEl.textContent.trim();
                        cartTotals.cart_displayed_currency = extractCurrency(cartTotals.cart_displayed_total);
                    }
                    // just for local testing
                    // STOP THE BROWSER FROM NAVIGATING INSTANTLY
                    e.preventDefault();
                    e.stopImmediatePropagation();

                    pushEvent("checkout_initiated", cartTotals, true);

                    // just for local testing
                    // WAIT 100ms TO SEND PAYLOAD, THEN NAVIGATE MANUALLY
                    var href = isCheckoutBtn.href || './checkout.html';
                    setTimeout(function () { window.location.href = href; }, 100);

                    return;
                }

                // ================================================================
                // NEW : Priority 1: MATCH: add_to_cart
                // ================================================================
                var isAddBtn = target.closest('[data-action="add-to-cart"], .add-to-cart') ||
                    (target.tagName === 'BUTTON' && /^(add to cart|add to bag|add)$/i.test(target.textContent));

                if (isAddBtn) {
                    var productCard = target.closest('.product-card, .product-tile, [data-product-id], [data-sku], article, [data-automation-id="product-pod"], #hero');
                    var eventData = { sku: null, surface: "catalog-grid", position: 1, price: null, currency: null };

                    if (productCard) {
                        var siblings = productCard.parentElement ? productCard.parentElement.children : [];
                        for (var i = 0; i < siblings.length; i++) {
                            if (siblings[i] === productCard) { eventData.position = i + 1; break; }
                        }

                        // 2-STEP SKU EXTRACTION
                        var btnSku = target.getAttribute('data-product-id') || target.getAttribute('data-sku') || target.getAttribute('data-cart-id');
                        if (!btnSku) {
                            btnSku = productCard.getAttribute('data-product-id') || productCard.getAttribute('data-sku') || productCard.getAttribute('data-cart-id');
                            if (!btnSku) {
                                var skuEl = firstMatch(productCard, FIELD_SEL.sku);
                                if (skuEl) {
                                    btnSku = skuEl.getAttribute('data-product-id') || skuEl.getAttribute('data-sku') || textOf(skuEl, 30);
                                    // fallback (SKU-in-href parse)
                                    if (!btnSku && (skuEl.tagName === 'A' || skuEl.hasAttribute('href'))) {
                                        var match = (skuEl.getAttribute('href') || '').match(/\/p\/(?:[^\/]+\/)*(\d+)/);
                                        if (match) btnSku = match[1];
                                    }
                                }
                            }
                        }
                        eventData.sku = btnSku || null;

                        var priceEl = firstMatch(productCard, FIELD_SEL.price);
                        if (priceEl) {
                            // Only replace the code inside this block!
                            var parsed = parsePrice(priceEl.textContent.trim());
                            if (parsed) {
                                eventData.price = parsed.amount;
                                eventData.currency = parsed.currency;
                            }
                        }
                    }
                    pushEvent("add_to_cart", eventData);
                    return;
                }

                // ================================================================
                // NEW : Priority 1: MATCH: remove_from_cart
                // ================================================================
                var isRemoveBtn = target.closest('.remove-item, [data-action="remove"], [data-automation-id="removeItem"]') ||
                    (target.tagName === 'BUTTON' && /^(remove|delete)$/i.test(target.textContent));

                if (isRemoveBtn) {
                    var cartItem = target.closest('.cart-item, [data-automation-id="cart-item"], article');
                    var removeData = { sku: null, quantity_before_remove: null, line_total: null, currency: null };

                    if (cartItem) {
                        // 2-STEP SKU EXTRACTION
                        var btnSku = target.getAttribute('data-product-id') || target.getAttribute('data-sku') || target.getAttribute('data-item-id');
                        if (!btnSku) {
                            btnSku = cartItem.getAttribute('data-product-id') || cartItem.getAttribute('data-sku') || cartItem.getAttribute('data-item-id');
                            if (!btnSku) {
                                var rSkuEl = firstMatch(cartItem, FIELD_SEL.sku) || cartItem.querySelector('[data-item-id]');
                                if (rSkuEl) btnSku = rSkuEl.getAttribute('data-item-id') || rSkuEl.getAttribute('data-product-id') || rSkuEl.getAttribute('data-sku');
                            }
                        }
                        removeData.sku = btnSku || null;


                        var lineTotalEl = firstMatch(cartItem, FIELD_SEL.cartItemLineTotal);
                        if (lineTotalEl) {
                            var parsedTotal = parsePrice(lineTotalEl.textContent.trim());
                            if (parsedTotal) {
                                removeData.line_total = parsedTotal.amount;
                                removeData.currency = parsedTotal.currency;
                            }
                        }
                        var qtyEl = firstMatch(cartItem, FIELD_SEL.cartItemQuantity);
                        if (qtyEl) {
                            var qVal = qtyEl.getAttribute('aria-valuenow') || qtyEl.value || qtyEl.textContent;
                            removeData.quantity_before_remove = parseInt(qVal, 10);
                        }
                    }
                    pushEvent("remove_from_cart", removeData);
                    return;
                }

                // ================================================================
                // NEW : Priority 2 - filter_applied / filter_removed (Click based filters)
                // ================================================================
                var isFilterLink = target.closest('a.filter-link, button.filter-btn, [data-action="filter"], .category-filter-list button, .filters button');
                if (isFilterLink) {
                    var isRemoving = target.closest('.active-filter, .remove-filter') !== null;
                    var filterClickData = {
                        filter_type: isFilterLink.getAttribute('aria-label') || isFilterLink.closest('fieldset, .filter-group, .facet')?.querySelector('legend, h3, h4, span, strong')?.textContent.trim() || isFilterLink.closest('[data-filter-group]')?.getAttribute('data-filter-group') || 'unknown',
                        filter_value: isFilterLink.getAttribute('data-category') || isFilterLink.textContent.trim(),
                        active_filter_count_after: document.querySelectorAll('.active-filter, .filters input:checked').length + (isRemoving ? -1 : 1)
                    };
                    pushEvent(isRemoving ? "filter_removed" : "filter_applied", filterClickData);
                    return;
                }


                // ================================================================
                // NEW : Priority 2 - product_card_clicked
                // (Runs AFTER add_to_cart so we don't confuse a cart click with a browse click)
                // ================================================================
                var clickedCard = target.closest('.product-card, .product-tile, [data-product-id], article, [data-automation-id="product-pod"]');
                var isCardClick = clickedCard && (target.closest('a') || target.closest('.product-image') || target.tagName === 'H3' || target.tagName === 'IMG' || target.tagName === 'P');
                if (isCardClick && !target.closest('[data-action="add-to-cart"], .add-to-cart, button')) {
                    var cardData = { sku: null, surface: "catalog-grid", position: 1, price: null, currency: null };
                    var cardSiblings = clickedCard.parentElement ? clickedCard.parentElement.children : [];
                    for (var j = 0; j < cardSiblings.length; j++) {
                        if (cardSiblings[j] === clickedCard) { cardData.position = j + 1; break; }
                    }

                    // Check the clickedCard directly first, then look inside it
                    var cardSku = clickedCard.getAttribute('data-product-id') || clickedCard.getAttribute('data-sku') || clickedCard.getAttribute('data-cart-id');
                    if (!cardSku) {
                        var cardSkuEl = firstMatch(clickedCard, FIELD_SEL.sku);
                        if (cardSkuEl) cardSku = cardSkuEl.getAttribute('data-product-id') || cardSkuEl.getAttribute('data-sku');
                    }
                    cardData.sku = cardSku || null;
                    var cardPriceEl = firstMatch(clickedCard, FIELD_SEL.price);
                    if (cardPriceEl) {
                        var parsed = parsePrice(cardPriceEl.textContent.trim());
                        if (parsed) {
                            cardData.price = parsed.amount;
                            cardData.currency = parsed.currency;
                        }
                    }

                    // just for local testing
                    // STOP THE BROWSER FROM NAVIGATING INSTANTLY
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    pushEvent("product_card_clicked", cardData, true);

                    // just for local testing
                    // WAIT 100ms TO SEND PAYLOAD, THEN NAVIGATE MANUALLY
                    setTimeout(function () {
                        window.location.href = './pdp.html?id=' + cardData.sku;
                    }, 100);

                    return;
                }

                // ================================================================
                // NEW : Priority 3 - quick_view_opened
                // ================================================================
                // (Ignore buttons that have the word 'close' in their aria-label or class)
                var isQuickViewBtn = target.closest('.quick-view, [data-action="quick-view"], button[aria-label*="quick view" i]:not(.modal-close):not([aria-label*="close" i])');
                if (isQuickViewBtn) {
                    var qvCard = target.closest('.product-card, .product-tile, article, [data-automation-id="product-pod"]');
                    var qvData = { sku: null, surface: "catalog-grid", position: 1 };

                    if (qvCard) {
                        var qvCardSku = qvCard.getAttribute('data-product-id') || qvCard.getAttribute('data-sku');
                        if (!qvCardSku) {
                            var qvSkuEl = firstMatch(qvCard, FIELD_SEL.sku);
                            if (qvSkuEl) qvCardSku = qvSkuEl.getAttribute('data-product-id') || qvSkuEl.getAttribute('data-sku');
                        }
                        qvData.sku = qvCardSku || null;

                        var qvSiblings = qvCard.parentElement ? qvCard.parentElement.children : [];
                        for (var k = 0; k < qvSiblings.length; k++) {
                            if (qvSiblings[k] === qvCard) { qvData.position = k + 1; break; }
                        }
                    }
                    pushEvent("quick_view_opened", qvData);
                    return;
                }

                // ================================================================
                // NEW : Priority 3 - wishlist_added
                // ================================================================
                var isWishlistBtn = target.closest('.wishlist-button, [data-action="wishlist"], [data-save], button[aria-label*="wishlist" i]');
                if (isWishlistBtn) {
                    var wlCard = target.closest('.product-card, .product-tile, article, .cart-item');
                    var wlData = { sku: null, surface: wlCard && wlCard.classList.contains('cart-item') ? "cart" : "catalog-grid", position: 1, price: null, currency: null };
                    if (wlCard) {
                        var wlCardSku = wlCard.getAttribute('data-product-id') || wlCard.getAttribute('data-sku') || wlCard.getAttribute('data-cart-id');
                        if (!wlCardSku) {
                            var wlSkuEl = firstMatch(wlCard, FIELD_SEL.sku);
                            if (wlSkuEl) wlCardSku = wlSkuEl.getAttribute('data-product-id') || wlSkuEl.getAttribute('data-sku');
                        }
                        wlData.sku = wlCardSku || null;
                        var wlPriceEl = firstMatch(wlCard, FIELD_SEL.price) || wlCard.querySelector('.cart-item-price strong');
                        if (wlPriceEl) {
                            // FIX: Added the parsePrice logic!
                            var parsedWl = parsePrice(wlPriceEl.textContent.trim());
                            if (parsedWl) {
                                wlData.price = parsedWl.amount;
                                wlData.currency = parsedWl.currency;
                            }
                        }
                        var wlSiblings = wlCard.parentElement ? wlCard.parentElement.children : [];
                        for (var m = 0; m < wlSiblings.length; m++) {
                            if (wlSiblings[m] === wlCard) { wlData.position = m + 1; break; }
                        }
                    }

                    // If the button is already 'active', the user is clicking to remove it!
                    // (Note: 'data-save' is the Cart "Save for later" button, which always adds)
                    var isRemoving = isWishlistBtn.classList.contains('active') && !isWishlistBtn.hasAttribute('data-save');

                    pushEvent(isRemoving ? "wishlist_removed" : "wishlist_added", wlData);


                    return;
                }

                // ================================================================
                // NEW : Priority 3 - quantity_changed
                // ================================================================
                var isQtyBtn = target.closest('[data-dec], [data-inc], .qty-minus, .qty-plus');
                if (isQtyBtn) {
                    var qtyItem = target.closest('.cart-item, article');
                    if (qtyItem) {
                        var qtyData = { sku: null, quantity_before: null, quantity_after: null, line_total_before: null, line_total_after: null };

                        var qtySku = qtyItem.getAttribute('data-cart-id') || qtyItem.getAttribute('data-product-id');
                        qtyData.sku = qtySku || null;

                        var qtySpan = qtyItem.querySelector('.quantity-control span, input.qty');
                        if (qtySpan) {
                            var currentQty = parseInt(qtySpan.textContent || qtySpan.value, 10);
                            qtyData.quantity_before = currentQty;
                            qtyData.quantity_after = isQtyBtn.hasAttribute('data-inc') || isQtyBtn.classList.contains('qty-plus') ? currentQty + 1 : Math.max(0, currentQty - 1);
                        }

                        var lineTotalElQty = firstMatch(qtyItem, FIELD_SEL.cartItemLineTotal);
                        if (lineTotalElQty) {
                            qtyData.line_total_before = lineTotalElQty.textContent.trim();
                        }

                        // Wait 500ms for Shopora to recalculate and redraw the cart
                        setTimeout(function () {
                            // The cart completely redraws, so we must find the item again using its SKU
                            var freshItem = document.querySelector('[data-cart-id="' + qtySku + '"], [data-product-id="' + qtySku + '"]');
                            if (freshItem) {
                                var newTotalEl = firstMatch(freshItem, FIELD_SEL.cartItemLineTotal);
                                if (newTotalEl) {
                                    qtyData.line_total_after = newTotalEl.textContent.trim();
                                }
                            }
                            // If the user drops the quantity to 0, they effectively removed it!
                            if (qtyData.quantity_after === 0) {
                                pushEvent("remove_from_cart", qtyData, true); // Log it as a REMOVE event
                            } else {
                                pushEvent("quantity_changed", qtyData); // Log it as a QUANTITY event
                            }

                        }, 500);

                    }
                    return;
                }



            } catch (err) { }
        }

        // ================================================================
        // NEW : Priority 1: MATCH: purchase_completed
        // (Fired immediately on page load, not click)
        // ================================================================
        function checkPurchaseCompleted() {
            var url = window.location.href.toLowerCase();
            if (url.includes('/thank-you') || url.includes('/order-complete') || url.includes('/confirmation') || url.includes('/receipt') || document.body.innerHTML.toLowerCase().includes('thank you for your order')) {
                var orderData = { order_confirmed: true, order_total_displayed: null, order_currency: null, line_item_count: 0 };
                var totalEl = firstMatch(document, FIELD_SEL.checkoutTotal) || document.querySelector('.order-total');
                if (totalEl) {
                    orderData.order_total_displayed = totalEl.textContent.trim();
                    orderData.order_currency = extractCurrency(orderData.order_total_displayed);
                }
                var items = document.querySelectorAll('#checkoutItems li, .order-item');
                orderData.line_item_count = items.length;
                pushEvent("purchase_completed", orderData);
                flushInteractionEvents("page-load");
            }
        }

        // ================================================================
        // NEW : Update initTier10 to attach Priority 2 & 1 listeners
        // ================================================================
        function initTier10() {
            document.addEventListener('click', handleDocumentClick, { capture: true, passive: true });
            document.addEventListener('submit', handleDocumentSubmit, { capture: true, passive: true }); // (add) Priority 2
            document.addEventListener('change', handleDocumentChange, { capture: true, passive: true }); // (add) Priority 2
            setInterval(function () { flushInteractionEvents("time"); }, FLUSH_INTERVAL_MS);
            document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flushInteractionEvents("unload"); });
            window.addEventListener('pagehide', function () { flushInteractionEvents("unload"); });
            checkPurchaseCompleted();
        }



        // ================================================================
        // TEST HOOK
        // Exposes internals when window.__AIORA_TEST__ = true.
        // Never set in production — the IIFE hides everything otherwise.
        // ================================================================

        if (typeof window !== 'undefined' && window.__AIORA_TEST__) {
            window.__AIORA__ = {
                extractTier0: extractTier0,
                extractTier1: extractTier1,
                extractTier2: extractTier2,
                extractTier3: extractTier3,
                extractTier4: extractTier4,
                extractTier5: extractTier5,
                classifyPageType: classifyPageType,
                scrubPII: scrubPII,
                makeBudget: makeBudget,
                getActiveTiers: getActiveTiers,
                firstMatch: firstMatch,
                textOf: textOf,
                config: config,
                FIELD_SEL: FIELD_SEL,
                CARD_SELECTORS: CARD_SELECTORS,
                TIER_ROUTES: TIER_ROUTES,
            };
        }

    } catch (e) {
        // Fail silently — errors must be invisible to the retailer's page.
        console.error("🚨 AIORA FATAL ERROR:", e);
    }
}());
