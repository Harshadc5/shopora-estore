// demo_scenarios.js — same content as demo_scenarios.json, but as a static
// ES module import instead of a fetch(). Importing resolves synchronously
// at script-load time (no network round trip + JSON.parse), which matters
// because tag.js's DOM-settle extraction can fire in the gap between
// app.js's real render and demo_router.js's override landing — every bit of
// latency here widens that race window. See demo_router.js's boot logic.
export const demoScenarios = {
    "stacked-discounts": {
        "target_page": "cart",
        "cart": {
            "items": [
                {
                    "sku": "el-2",
                    "qty": 1
                }
            ],
            "savings_breakdown": [
                {
                    "type": "markdown",
                    "label": "Markdown (25% off original)",
                    "amount": 30.00
                },
                {
                    "type": "code",
                    "label": "WELCOME10 code (10% off)",
                    "amount": 6.00,
                    "code": "WELCOME10"
                },
                {
                    "type": "loyalty",
                    "label": "Shopora Plus member (5% off)",
                    "amount": 2.70
                }
            ],
            "shipping_label": "FREE delivery"
        },
        // Spec requires data-promo-state='accepted' data-applied-code='WELCOME10'
        // on the promo field — this scenario never set that before, so the
        // field sat at tag.js's unset-attribute default ('active') instead.
        "promo": {
            "state": "accepted",
            "code": "WELCOME10"
        }
    },
    "shipping-threshold-broken": {
        "target_page": "cart",
        "cart": {
            "items": [
                {
                    "sku": "fa-6",
                    "qty": 1
                },
                {
                    "sku": "el-9",
                    "qty": 1
                },
                {
                    "sku": "ho-4",
                    "qty": 1
                }
            ],
            "savings_breakdown": [
                {
                    "type": "code",
                    "label": "SAVE20 code (20% off)",
                    "amount": 13.59,
                    "code": "SAVE20"
                },
                {
                    "type": "markdown",
                    "label": "Markdown on all 3 items",
                    "amount": 9.00
                },
                {
                    "type": "loyalty",
                    "label": "Stacked loyalty credit",
                    "amount": 15.00
                }
            ],
            "shipping_label": "FREE delivery"
        }
    },
    "welcome-code-returning-member": {
        "target_page": "cart",
        "cart": {
            "items": [
                {
                    "sku": "bo-2",
                    "qty": 1
                }
            ],
            "savings_breakdown": [
                {
                    "type": "code",
                    "label": "WELCOME10 code (10% off)",
                    "amount": 2.30,
                    "code": "WELCOME10"
                },
                {
                    "type": "loyalty",
                    "label": "Shopora Plus member (5% off)",
                    "amount": 1.15
                }
            ],
            "shipping_label": "$5.99"
        }
    },
    "multi-mechanism-stack": {
        "target_page": "cart",
        "forceIdentity": {
            "state": "recognized",
            "tier": "plus"
        },
        "cart": {
            "items": [
                {
                    "sku": "fa-1",
                    "qty": 2
                }
            ],
            "savings_breakdown": [
                {
                    "type": "markdown",
                    "label": "Markdown (24% off)",
                    "amount": 12.00
                },
                {
                    "type": "sale",
                    "label": "BOGO 50% off 2nd unit",
                    "amount": 9.50
                },
                {
                    "type": "code",
                    "label": "SAVE20 code (20% off)",
                    "amount": 7.60,
                    "code": "SAVE20"
                },
                {
                    "type": "sale",
                    "label": "$5 category coupon",
                    "amount": 5.00
                },
                {
                    "type": "loyalty",
                    "label": "Shopora Plus (5%)",
                    "amount": 1.90
                }
            ],
            "shipping_label": "FREE delivery"
        }
    },
    "margin-floor-violation": {
        "target_page": "cart",
        "cart": {
            "items": [
                {
                    "sku": "fa-3",
                    "qty": 1
                }
            ],
            "savings_breakdown": [
                {
                    "type": "code",
                    "label": "SAVE20 code (20% off)",
                    "amount": 15.00,
                    "code": "SAVE20"
                },
                {
                    "type": "loyalty",
                    "label": "Shopora Plus (5%)",
                    "amount": 3.75
                },
                {
                    "type": "sale",
                    "label": "$10 sale credit",
                    "amount": 10.00
                },
                {
                    "type": "code",
                    "label": "Extra 15% stacked code",
                    "amount": 6.94,
                    "code": "EXTRA15"
                }
            ],
            "shipping_label": "FREE delivery"
        }
    },
    // 2.2: header claims "Free delivery above $35" (real, always-on site
    // copy) while the cart nudge says "Add $8 more" — real math is
    // $35 - $32.98 = $2.02, not $8. shippingNudgeOverride deliberately
    // overrides the otherwise-accurate nudge text; nothing else about this
    // cart is staged (items/subtotal are real numbers, just under $35).
    "threshold-disagreement": {
        "target_page": "cart",
        "cart": {
            "items": [
                { "sku": "bo-3", "qty": 1 },
                { "sku": "bo-4", "qty": 1 }
            ],
            "shipping_label": "$5.99",
            "shippingNudgeOverride": "Add <strong>$8</strong> more for free shipping"
        }
    },
    "hero-claim-mismatch": {
        "target_page": "homepage",
        "hero": {
            "headline": "UP TO 35% OFF ON ELECTRONICS",
            "claim_scope": "electronics"
        },
        "featuredTiles": ["el-1", "el-3", "el-4", "el-8", "el-2"],
        "featuredSectionHeading": "Big Savings Day - UP TO 35% OFF",
        "hideSections": [".category-section", "#best-deals", ".promo-banner.promo-tech", ".promo-banner.promo-home"]
    },
    // 2.1.b: same hero-vs-tiles claim-mismatch story as 2.1, but with a
    // flat dollar-off claim instead of a percentage claim. Only el-1
    // actually honors the $100 headline — every other featured tile shows
    // a smaller, inconsistent dollar-off amount.
    "hero-claim-mismatch-dollar": {
        "target_page": "homepage",
        "hero": {
            "headline": "UP TO $100 OFF ON ELECTRONICS",
            "claim_scope": "electronics",
            "claim_amount": 100,
            "claim_code": "SAVE100",
            "claim_min_spend": 500
        },
        "featuredTiles": ["el-3", "el-8", "el-1", "el-4", "el-7", "el-2"],
        "featuredSectionHeading": "Big Savings Day - UP TO $100 OFF",
        "hideSections": [".category-section", "#best-deals", ".promo-banner.promo-tech", ".promo-banner.promo-home"],
        "tiles": {
            "discountOverrides": [
                { "sku": "el-3", "badge": "$20 OFF", "price": 139.99 },
                { "sku": "el-8", "badge": "$23 OFF", "price": 206.99 },
                { "sku": "el-1", "badge": "$100 OFF", "price": 1699.99 },
                { "sku": "el-4", "badge": "$7 OFF", "price": 242.99 },
                { "sku": "el-7", "badge": "$13 OFF", "price": 416.99 },
                { "sku": "el-2", "badge": "$3 OFF", "price": 116.99 }
            ]
        }
    },
    // 2.4: the homepage's real "Deal of the day" spotlight (ho-5, Belfry
    // Bath Towel Set) shows its full undiscounted price with no
    // strikethrough — no deal at all — while the real countdown timer
    // elsewhere on the page keeps ticking down unchanged, implying urgency
    // around a deal that doesn't exist.
    "urgency-no-deal": {
        "target_page": "homepage",
        "dealOfDayOverride": "ho-5"
    },
    // 2.5: newsletter section claims "member-only 20% off" while the real,
    // always-on Shopora Plus loyalty rail offer elsewhere on the same page
    // says "extra 5% off" — two different, directly comparable promises
    // about what a member actually gets.
    "newsletter-loyalty-mismatch": {
        "target_page": "homepage",
        "newsletterOverride": {
            "text": "Get weekly price drops, new arrivals and member-only 20% off deals.",
            "claim_percent": 20,
            "claim_scope": "members"
        }
    },
    // 2.3: category-page banner claims "SAVE UP TO 50%" while the real
    // catalog's electronics discounts only range 17%-29% — no tile
    // override needed, the real category grid already tops out at 29%.
    // 2.3: forces the real 12-SKU electronics grid via categoryTiles
    // instead of relying on the trigger URL carrying ?category=electronics
    // — matches the project's own "every scenario renders the same way,
    // every time" philosophy (deterministic regardless of how someone
    // navigates in), and matches 3.2/3.5's existing pattern for this.
    "category-claim-mismatch": {
        "target_page": "category",
        "categoryTiles": ["el-1", "el-2", "el-3", "el-4", "el-5", "el-6", "el-7", "el-8", "el-9", "el-10", "el-11", "el-12"],
        "banner": {
            "headline": "SAVE UP TO 50% ON ELECTRONICS!",
            "claim_percent": 50,
            "claim_scope": "electronics"
        }
    },
    "trending-brand-dominance": {
        "target_page": "homepage",
        "featuredTiles": ["el-1", "el-4", "el-2", "el-7", "el-10", "fa-1", "el-11", "ho-1", "el-12", "bo-1"],
        "tiles": {
            "brandOverrides": [
                { "sku": "el-11", "brand": "VoltMax" },
                { "sku": "el-12", "brand": "VoltMax" }
            ]
        }
    },
    // 3.2: electronics category grid where the top 3 (sponsored) positions
    // AND 1 of the 8 organic positions are all PulseTune — 4 of 11 shown
    // (36% raw, ~43% when sponsored slots are weighted 2x). Real catalog
    // order is overridden via categoryTiles to force this exact layout.
    "pulsetune-dominance": {
        "target_page": "category",
        "categoryTiles": ["el-2", "el-3", "el-5", "el-8", "el-1", "el-6", "el-4", "el-7", "el-9", "el-11", "el-12"],
        "tiles": {
            "sponsoredSkus": ["el-2", "el-3", "el-5"]
        }
    },
    // 3.3: search results for "wireless headphones" collapse to 8 of 10
    // tiles being PulseTune (80%). Only 4 PulseTune SKUs exist in the real
    // catalog (el-2, el-3, el-5, el-8) — the spec calls for 5 real +
    // 3 fabricated, but the real catalog only has 4 PulseTune products, so
    // this uses 4 real + 4 fabricated demo-only variants to reach the same
    // 8-of-10 concentration the scenario is actually about. The other 2
    // tiles (VoltMax Gaming Headset, StreamHub Bluetooth Speaker) are also
    // fabricated — neither exists as a real SKU under that exact name.
    "brand-collapse": {
        "target_page": "search",
        "searchResults": {
            "query": "wireless headphones",
            "tiles": [
                { "sku": "el-2" },
                { "sku": "el-3" },
                { "sku": "el-5" },
                { "sku": "el-8" },
                { "sku": "demo-pt-sport", "name": "PulseTune Sport Earbuds", "brand": "PulseTune", "category": "electronics", "price": 69.99, "oldPrice": 89.99, "discount": "22%", "rating": 4.5, "description": "Sweat-resistant earbuds built for workouts." },
                { "sku": "demo-pt-studio", "name": "PulseTune Studio Headphones", "brand": "PulseTune", "category": "electronics", "price": 149.99, "oldPrice": 189.99, "discount": "21%", "rating": 4.7, "description": "Studio-grade over-ear headphones with rich bass." },
                { "sku": "demo-pt-kids", "name": "PulseTune Kids Headphones", "brand": "PulseTune", "category": "electronics", "price": 24.99, "oldPrice": 34.99, "discount": "29%", "rating": 4.6, "description": "Volume-limited headphones designed for kids." },
                { "sku": "demo-pt-travel", "name": "PulseTune Travel Earbuds", "brand": "PulseTune", "category": "electronics", "price": 39.99, "oldPrice": 54.99, "discount": "27%", "rating": 4.3, "description": "Compact earbuds with a pocket-sized charging case." },
                { "sku": "demo-vm-headset", "name": "VoltMax Gaming Headset", "brand": "VoltMax", "category": "electronics", "price": 79.99, "oldPrice": 99.99, "discount": "20%", "rating": 4.4, "description": "Surround-sound gaming headset with a noise-cancelling mic." },
                { "sku": "demo-sh-speaker", "name": "StreamHub Bluetooth Speaker", "brand": "StreamHub", "category": "electronics", "price": 44.99, "oldPrice": 59.99, "discount": "25%", "rating": 4.2, "description": "Compact Bluetooth speaker with 10-hour battery life." }
            ]
        }
    },
    // 3.4: cart has 1x VoltMax Laptop Pro (el-1); the "Customers also
    // bought" recommendations below it are 4-for-4 VoltMax too — zero
    // cross-brand diversification despite plenty of complementary products
    // from other brands in the catalog. Requires the tag.js EXCLUDE_SURFACES
    // fix (recommendation tiles were previously dropped from extraction
    // entirely) plus the new recommendations-module block for parent_context.
    "cart-recs-single-brand": {
        "target_page": "cart",
        "cart": {
            "items": [{ "sku": "el-1", "qty": 1 }]
        },
        "cartRecommendations": {
            "parentContext": "cart:el-1",
            "tiles": [
                { "sku": "el-4" },
                { "sku": "el-7" },
                { "sku": "el-10" },
                { "sku": "demo-vm-sleeve", "name": "VoltMax Laptop Sleeve", "brand": "VoltMax", "category": "electronics", "price": 24.99, "oldPrice": 34.99, "discount": "29%", "rating": 4.5, "description": "Padded protective sleeve sized for VoltMax laptops." }
            ]
        }
    },
    // 3.5: fashion category, top 6 positions are 5-of-6 Luna. Reuses
    // renderCategoryTiles() as-is (no new code) — all real fashion SKUs
    // already carry their real brands, no overrides needed.
    "luna-dominance": {
        "target_page": "category",
        "categoryTiles": ["fa-1", "fa-2", "fa-4", "fa-5", "fa-7", "fa-3", "fa-6", "fa-8", "fa-9", "fa-10"]
    },
    // 4.2 step 1: fashion category, real grid untouched except fa-1 (Luna
    // Tee) gets a visible "BOGO: Buy One Get One Free" badge + data-bogo.
    "bogo-promise": {
        "target_page": "category",
        "categoryTiles": ["fa-2", "fa-1", "fa-3", "fa-4", "fa-5", "fa-6", "fa-7", "fa-8", "fa-9", "fa-10"],
        "tiles": {
            "bogoSkus": ["fa-1"]
        },
        "navOverrides": [
            { "selector": ".cart-link", "destination": "./cart.html?demo=bogo-broken-cart" }
        ]
    },
    // 4.2 step 2: cart shows 2x fa-1 at real full price ($18.99 × 2 =
    // $37.98) — no BOGO discount applied at all, despite the category
    // page's badge promising one. The per-item note is visual-only (not a
    // tag.js-read field); the actual coordination-failure proof is purely
    // the badge-on-category vs full-price-in-cart mismatch.
    "bogo-broken-cart": {
        "target_page": "cart",
        "cart": {
            "items": [{ "sku": "fa-1", "qty": 2, "note": "BOGO not applicable to sale items." }],
            "shipping_label": "FREE delivery"
        }
    },
    // 4.3: checkout has 1x OakLine Coffee Table (ho-1, $199.99 — well
    // above the real, always-on "Free delivery above $35" header claim).
    // Yet checkout charges a $9.99 "Oversized shipping fee" anyway — the
    // header promise and the actual checkout charge directly contradict
    // each other. No tag.js changes needed: t6.free_shipping_claim_threshold
    // is already real/always-on, and t2.delivery_cost already reads the
    // real #checkoutDelivery element.
    "shipping-oversized": {
        "target_page": "checkout",
        "checkout": {
            "items": [{ "sku": "ho-1", "qty": 1 }],
            "shippingFee": 9.99,
            "shippingLabel": "Oversized shipping fee"
        }
    },
    // 4.4 step 1: homepage promo module (demo-only — no real element like
    // this exists) claiming WELCOME10 gets new customers 10% off.
    "welcome-code-promise": {
        "target_page": "homepage",
        "promoModule": {
            "text": "NEW HERE? Use code WELCOME10 for 10% off your first order.",
            "claim_percent": 10,
            "claim_code": "WELCOME10"
        },
        "navOverrides": [
            { "selector": ".cart-link", "destination": "./cart.html?demo=welcome-code-rejected" }
        ]
    },
    // 4.4 step 2: guest cart applies WELCOME10 — the exact code the
    // homepage just promised works for new customers — and it's rejected
    // anyway. cart_state.promo_field_state='rejected' vs the homepage's
    // ClaimSignal for the same code is the coordination failure. No `cart`
    // override here on purpose — this only applies the promo-rejected
    // state on top of the REAL cart (whatever the user actually added on
    // the homepage), so the click-through flow shows a real product.
    "welcome-code-rejected": {
        "target_page": "cart",
        "promo": {
            "state": "rejected",
            "code": "WELCOME10",
            "reason": "Invalid code. Please try again."
        }
    },
    // 4.5 step 1: homepage promo claims $50 off orders over $200 with
    // SAVE50. Add-to-cart is disabled everywhere on this page — the next
    // step's cart is fully pre-staged to hit an exact total regardless of
    // what's clicked, so a real add would only be visually misleading.
    // cartBadgeCount just shows "2" up front (matching save50-broken's
    // 2 staged items) so the header looks consistent across both steps of
    // the walkthrough, instead of sitting at 0 with nothing addable.
    "save50-promise": {
        "target_page": "homepage",
        "promoModule": {
            "text": "SAVE $50 ON ORDERS OVER $200 with code SAVE50",
            "claim_amount": 50,
            "claim_code": "SAVE50",
            "claim_min_spend": 200
        },
        "disableAddToCart": true,
        "cartBadgeCount": 2,
        "navOverrides": [
            { "selector": ".cart-link", "destination": "./cart.html?demo=save50-broken" }
        ]
    },
    // 4.5 step 2: cart totals $214.99 (staged prices, not real catalog
    // prices — el-1 is really $1,499.99, el-4 is really $199.99). SAVE50
    // is accepted but only knocks off $30, not the $50 the homepage just
    // promised for orders over $200 — this cart clears that threshold.
    "save50-broken": {
        "target_page": "cart",
        "cart": {
            "items": [
                { "sku": "el-1", "qty": 1, "price": 149.99 },
                { "sku": "el-4", "qty": 1, "price": 65.00 }
            ],
            "shipping_label": "FREE delivery",
            "savings_breakdown": [
                { "type": "code", "label": "SAVE50 code", "amount": 30.00, "code": "SAVE50" }
            ]
        },
        "promo": {
            "state": "accepted",
            "code": "SAVE50"
        }
    },
    "category-promise-gap": {
        "target_page": "category",
        "banner": {
            "headline": "UP TO 25% OFF ALL ELECTRONICS",
            "claim_percent": 25,
            "claim_scope": "electronics"
        },
        "tiles": {
            "discountOverrides": [
                { "sku": "el-1", "badge": "25% OFF", "price": 1349.99 }
            ]
        },
        "clickThrough": {
            "destinationSlug": "promise-gap-destination"
        }
    },
    "promise-gap-destination": {
        "target_page": "pdp",
        "pdp": {
            "price": 1619.99,
            "badge": "SAVE 10%",
            "exclusionNote": "Excluded from category promo — new model."
        }
    },
    // Pattern 5 (5.1): both entries are deliberately empty. The homepage's
    // "Hello, Rahul / Shopora Plus" comes entirely from app.js's real
    // initIdentity()/initLoyaltyChip(), driven by the real ?identity=logged-in
    // &member_tier=plus URL params — no override needed. The cart page's
    // "Hello, guest" is just its real default when no identity param is
    // present at all. These entries exist only so `?demo=` has a matching
    // slug (avoids the "Unknown scenario slug" console warning) — the
    // identity mismatch itself is 100% real site behavior, not staged.
    "identity-recognized": {
        "target_page": "homepage",
        "carryDemoForward": true,
        "navOverrides": [
            { "selector": ".cart-link", "destination": "./cart.html?demo=identity-lost" }
        ]
    },
    "identity-lost": {
        "target_page": "cart"
    },
    // Pattern 5 (5.2): checkout.html's real .account-chip (recognized/Plus,
    // driven by the genuine ?identity=logged-in&member_tier=plus URL params
    // via app.js) stays visually hidden — real site behavior, untouched.
    // loyaltyPrompt injects a second, independent identity-bearing component
    // (a "join the loyalty program" prompt) that always says 'guest',
    // regardless of the header's real state. tag.js reads DOM attributes off
    // a serialized HTML snapshot (not visibility), so it captures BOTH —
    // the conflict is invisible on-screen but caught in the payload.
    "loyalty-inconsistent": {
        "target_page": "checkout",
        "loyaltyPrompt": {
            "identityState": "guest",
            "text": "Not a member? Join for 5% off."
        }
    },
    // Pattern 5 (5.3): cart count silently changes across a plain page
    // navigation with no add/remove interaction in between. cartBadgeCount
    // just sets the header badge directly (independent of real cart
    // storage, which demo mode never touches anyway). navOverrides catches
    // BOTH real "Mobiles & Electronics" links (dept-rail + hero category
    // card) so clicking either one lands on cart-lost specifically, instead
    // of carrying cart-has-2-items forward (which would keep showing "2").
    "cart-has-2-items": {
        "target_page": "homepage",
        "cartBadgeCount": 2,
        "navOverrides": [
            { "selector": "a[href*='category.html?category=electronics']", "destination": "./category.html?category=electronics&demo=cart-lost" }
        ]
    },
    "cart-lost": {
        "target_page": "category",
        "cartBadgeCount": 0
    },
    // Pattern 5 (5.4): homepage's wishlist icon says "3" (staged; real
    // wishlist storage is empty in demo mode either way). navOverrides
    // sends the click to the REAL destination real app.js already uses for
    // the wishlist icon (category.html?wishlist=true, a filtered category
    // view) — it's genuinely empty, so it shows the real #emptyResults
    // "No products found" message, not anything wishlist- or identity-
    // aware. No override needed on that page at all — 100% real behavior,
    // same precedent as identity-lost (Pattern 5.1).
    "wishlist-count-3": {
        "target_page": "homepage",
        "wishlistBadgeCount": 3,
        "navOverrides": [
            { "selector": ".wishlist-link", "destination": "./category.html?wishlist=true&demo=wishlist-empty" }
        ]
    },
    "wishlist-empty": {
        "target_page": "category"
    },
    // Pattern 5.5: member identified (header chip + real Shopora Plus
    // loyalty rail, both 100% real app.js behavior from the real
    // ?identity=logged-in&member_tier=plus params — including the real
    // "450 points / 50 from Gold" loyalty chip), but member PRICING isn't
    // applied. Real app.js normally auto-applies a 5% Plus discount on
    // cart.html too (#plusMemberRow) — this override's renderCart() call
    // (via the renderSavingsBreakdown fix) strips that real row since no
    // savings_breakdown is given, leaving el-2 at its plain $89.99 catalog
    // price with no discount line at all.
    "member-pricing-missing": {
        "target_page": "cart",
        "cart": {
            "items": [
                { "sku": "el-2", "qty": 1 }
            ]
        }
    }
};
