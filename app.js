import { products, categories } from './data/products.js';

const CART_KEY = 'shopora-cart-v2';
const WISHLIST_KEY = 'shopora-wishlist';
const PROMO_KEY = 'shopora-promo';
const USD_RATE = 1;
const FREE_DELIVERY_MIN = 35;
const DELIVERY_FEE = 5;

// Promo Codes Registry
// Sync'd with demo_config.json for AIORA Scenarios
const PROMO_CODES = {
  'WELCOME10': { type: 'percent', value: 10 },
  'SAVE20': { type: 'percent', value: 20 },
  'SAVE50': { type: 'flat', value: 50, min_order: 200 },
  'MEMBER5': { type: 'percent', value: 5 }
};

const cart = loadCart();
const wishlist = new Set(loadJSON(WISHLIST_KEY, []));
// Promo lives in sessionStorage, not localStorage — it should survive normal
// page navigation within a visit (cart -> checkout) but be wiped the moment
// the tab actually closes, unlike the cart/wishlist which persist for real.
function loadPromo() {
  try { return JSON.parse(sessionStorage.getItem(PROMO_KEY)) ?? null; } catch { return null; }
}
let activePromo = loadPromo();
const currentPage = location.pathname.split('/').pop() || 'index.html';

function applyPromo(code, page) {
  const normalized = code.trim().toUpperCase();
  if (!normalized) return;
  if (!PROMO_CODES[normalized]) {
    toast('Invalid promo code.', 'error');
    return;
  }
  activePromo = normalized;
  sessionStorage.setItem(PROMO_KEY, JSON.stringify(activePromo));
  toast('Promo code applied!', 'success');
  if (page === 'cart') renderCart();
  if (page === 'checkout') renderCheckout();
}

function removePromo(page) {
  activePromo = null;
  sessionStorage.removeItem(PROMO_KEY);
  toast('Promo code removed.', 'success');
  if (page === 'cart') renderCart();
  if (page === 'checkout') renderCheckout();
}

function calculatePromoDiscount(subtotal, delivery) {
  if (!activePromo || !PROMO_CODES[activePromo]) return 0;
  const promo = PROMO_CODES[activePromo];
  // Enforce minimum order threshold if one exists
  if (promo.min_order && subtotal < promo.min_order) return 0;
  // Calculate the discount based on the type
  if (promo.type === 'percent') return (subtotal * promo.value) / 100;
  if (promo.type === 'flat') return Math.min(promo.value, subtotal); // Don't discount below $0
  if (promo.type === 'freeship') return delivery;
  return 0;
}


function loadJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function loadCart() {
  const saved = loadJSON(CART_KEY, {});
  return Object.fromEntries(Object.entries(saved).filter(([id, quantity]) => products.some((p) => p.id === id) && Number.isFinite(quantity) && quantity > 0));
}
function retailPrice(product) { return product.price * USD_RATE; }
function retailOldPrice(product) { return product.oldPrice * USD_RATE; }
function money(value) { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value); }
function discount(product) { return Math.round(((product.oldPrice - product.price) / product.oldPrice) * 100); }
function ratingCount(product) { return 120 + [...product.id].reduce((sum, char) => sum + char.charCodeAt(0), 0) * 9; }
function cartCount() { return Object.values(cart).reduce((sum, quantity) => sum + quantity, 0); }
function cartItems() { return Object.entries(cart).map(([id, quantity]) => { const product = products.find((item) => item.id === id); return product ? { ...product, quantity } : null; }).filter(Boolean); }
function cartSubtotal() { return cartItems().reduce((sum, item) => sum + retailPrice(item) * item.quantity, 0); }
function cartSavings() { return cartItems().reduce((sum, item) => sum + (retailOldPrice(item) - retailPrice(item)) * item.quantity, 0); }
function deliveryFor(subtotal) { return subtotal > 0 && subtotal < FREE_DELIVERY_MIN ? DELIVERY_FEE : 0; }

function saveCart() {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  // An empty cart has nothing left for a promo to discount — carrying one
  // over into whatever gets added next is exactly the stale-state confusion
  // this is meant to prevent.
  if (Object.keys(cart).length === 0 && activePromo) {
    activePromo = null;
    sessionStorage.removeItem(PROMO_KEY);
  }
  updateHeaderCounts();
}
function saveWishlist() { localStorage.setItem(WISHLIST_KEY, JSON.stringify([...wishlist])); updateHeaderCounts(); }
function addToCart(id, quantity = 1) {
  const product = products.find((item) => item.id === id);
  if (!product) return;
  const next = Math.min(product.stock, (cart[id] || 0) + quantity);
  cart[id] = next;
  saveCart();
  refreshCartViews();
  toast(next >= product.stock ? 'Maximum available quantity is now in your cart.' : product.name + ' added to cart.', 'success');
}
function updateQuantity(id, quantity) {
  const product = products.find((item) => item.id === id);
  if (!product) return;
  const next = Math.max(0, Math.min(product.stock, quantity));
  if (!next) delete cart[id]; else cart[id] = next;
  saveCart(); refreshCartViews();
}
function removeFromCart(id) { delete cart[id]; saveCart(); refreshCartViews(); toast('Item removed from cart.'); }
function toggleWishlist(id, button) {
  if (wishlist.has(id)) wishlist.delete(id); else wishlist.add(id);
  button?.classList.toggle('active', wishlist.has(id));
  button && (button.textContent = wishlist.has(id) ? '♥' : '♡');
  saveWishlist();
  toast(wishlist.has(id) ? 'Saved to your wishlist.' : 'Removed from your wishlist.');
}
function updateHeaderCounts() {
  document.querySelectorAll('[data-cart-count]').forEach((node) => node.textContent = String(cartCount()));
  document.querySelectorAll('[data-wishlist-count]').forEach((node) => node.textContent = String(wishlist.size));
}
function toast(message, type = '') {
  const region = document.querySelector('#toastRegion');
  if (!region) return;
  const node = document.createElement('div');
  node.className = 'toast ' + type;
  node.textContent = message;
  region.appendChild(node);
  window.setTimeout(() => node.remove(), 3000);
}

const bookPalettes = [['#243b6b', '#d48352'], ['#285943', '#d8b04c'], ['#733b62', '#ef9d70'], ['#24395f', '#8ea7cc'], ['#8a352b', '#e7ba69']];
function applyVisual(node, product) {
  if (!node) return;
  node.classList.remove('sprite-electronics', 'sprite-fashion', 'sprite-home', 'sprite-books', 'custom-product-image');
  node.style.backgroundImage = '';
  node.style.backgroundSize = '';
  node.style.backgroundPosition = '';
  node.setAttribute('role', 'img');
  node.setAttribute('aria-label', product.name + ' product image');

  if (product.image) {
    node.classList.add('custom-product-image');
    node.style.backgroundImage = 'url("' + product.image + '")';
    node.style.backgroundSize = 'contain';
    node.style.backgroundPosition = 'center';
    return;
  }

  node.classList.add('sprite-' + product.category);
  const index = Math.max(0, Number(product.id.split('-')[1]) - 1);
  node.style.setProperty('--sprite-x', (index % 5) * 25 + '%');
  node.style.setProperty('--sprite-y', Math.floor(index / 5) * 50 + '%');
}
function buildProductCard(product, template) {
  const card = template.content.firstElementChild.cloneNode(true);
  applyVisual(card.querySelector('.product-image'), product);
  card.dataset.productId = product.id;
  card.dataset.brand = product.name.split(' ')[0];
  card.dataset.category = product.category;
  card.dataset.sponsored = 'false';
  card.dataset.availability = product.availability || 'in-stock';
  card.querySelector('.discount-badge').textContent = discount(product) + '% OFF';
  card.querySelector('.product-brand').textContent = product.name.split(' ')[0];
  card.querySelector('h3').textContent = product.name;
  card.querySelector('.stars').textContent = product.rating.toFixed(1) + ' ★';
  card.querySelector('.rating-count').textContent = ratingCount(product).toLocaleString('en-IN');
  card.querySelector('.product-meta').textContent = product.description;
  card.querySelector('.price-stack strong').textContent = money(retailPrice(product));
  card.querySelector('.price-stack del').textContent = money(retailOldPrice(product));
  card.querySelector('.price-stack span').textContent = 'Save ' + money(retailOldPrice(product) - retailPrice(product));
  const navigateToPDP = (e) => {
    if (e.target.closest('.wishlist-button, .add-to-cart, .quick-view')) return;
    e.preventDefault();
    if (card.dataset.destination) {
      window.location.href = card.dataset.destination;
      return;
    }
    navWithParams(`./pdp.html?id=${product.id}`);
  };
  const img = card.querySelector('.product-image');
  img.addEventListener('click', navigateToPDP);
  img.style.cursor = 'pointer';
  const title = card.querySelector('h3');
  title.addEventListener('click', navigateToPDP);
  title.style.cursor = 'pointer';

  const wishButton = card.querySelector('.wishlist-button');
  wishButton.classList.toggle('active', wishlist.has(product.id));
  wishButton.textContent = wishlist.has(product.id) ? '♥' : '♡';
  wishButton.addEventListener('click', () => toggleWishlist(product.id, wishButton));
  card.querySelector('.add-to-cart').addEventListener('click', () => addToCart(product.id));
  card.querySelector('.quick-view').addEventListener('click', () => showQuickView(product));
  return card;
}
function showQuickView(product) {
  const modal = document.querySelector('#quickViewModal');
  if (!modal) return;
  modal.innerHTML = `<article class="modal-card" role="dialog" aria-modal="true" aria-labelledby="modalTitle"><button class="modal-close" aria-label="Close quick view">×</button><div class="product-image"></div><div class="modal-copy"><span class="section-kicker">${product.badge}</span><h2 id="modalTitle">${product.name}</h2><div class="rating-line"><span class="stars">${product.rating.toFixed(1)} ★</span><span class="rating-count">${ratingCount(product).toLocaleString('en-IN')} ratings</span></div><p>${product.description}</p><div class="price-stack"><strong>${money(retailPrice(product))}</strong><del>${money(retailOldPrice(product))}</del><span>${discount(product)}% off</span></div><p class="delivery-note">FREE delivery <b>Tomorrow</b> · ${product.stock} in stock</p><h3>Highlights</h3><ul>${product.specs.map((spec) => '<li>' + spec + '</li>').join('')}</ul><button class="button button-primary full-width modal-add">Add to cart</button></div></article>`;
  applyVisual(modal.querySelector('.product-image'), product);
  modal.hidden = false; document.body.classList.add('modal-open');
  const close = () => { modal.hidden = true; document.body.classList.remove('modal-open'); };
  modal.querySelector('.modal-close').addEventListener('click', close);
  modal.querySelector('.modal-add').addEventListener('click', () => { addToCart(product.id); close(); });
  modal.addEventListener('click', (event) => { if (event.target === modal) close(); }, { once: true });
  modal.querySelector('.modal-close').focus();
}
function createDealCard(product) {
  const card = document.createElement('article');
  card.className = 'deal-card';
  card.setAttribute('data-sku', product.id);
  card.innerHTML = `<div class="product-image" style="cursor:pointer"><span class="discount-badge">${discount(product)}% OFF</span></div><div class="deal-info"><span class="deal-chip">${product.badge}</span><h3 style="cursor:pointer">${product.name}</h3><div class="deal-price"><strong>${money(retailPrice(product))}</strong><del>${money(retailOldPrice(product))}</del></div><button class="button button-primary">Add to cart</button></div>`;
  applyVisual(card.querySelector('.product-image'), product);
  card.querySelector('button').addEventListener('click', () => addToCart(product.id));
  const navigateToPDP = (e) => { e.preventDefault(); navWithParams(`./pdp.html?id=${product.id}`); };
  card.querySelector('.product-image').addEventListener('click', navigateToPDP);
  card.querySelector('h3').addEventListener('click', navigateToPDP);
  return card;
}

function renderHome() {
  const template = document.querySelector('#productCardTemplate');
  if (!template) return;
  const heroDeal = products.find((product) => product.deal) || products[0];
  document.querySelector('#heroDealName').textContent = heroDeal.name;
  document.querySelector('#heroDealPrice').textContent = money(retailPrice(heroDeal));
  document.querySelector('#heroDealOld').textContent = money(retailOldPrice(heroDeal));
  document.querySelector('#heroDealAdd').addEventListener('click', () => addToCart(heroDeal.id));
  const categoryGrid = document.querySelector('#categoryGrid');
  categoryGrid.innerHTML = categories.map((category) => `<a class="category-card ${category.key}" href="./category.html?category=${category.key}"><span>15 PRODUCTS</span><strong>${category.label}</strong><p>${category.description}</p></a>`).join('');
  const dealStrip = document.querySelector('#dealStrip');
  products.filter((product) => product.deal).slice(0, 4).forEach((product) => dealStrip.appendChild(createDealCard(product)));
  const featuredGrid = document.querySelector('#featuredGrid');
  [products[1], products[2], products[16], products[17], products[30], products[33], products[35], products[38]].forEach((product) => featuredGrid.appendChild(buildProductCard(product, template)));
  startDealTimer();
}
function startDealTimer() {
  const container = document.querySelector('.countdown');
  const node = document.querySelector('.countdown-value') || document.querySelector('#dealTimer');
  if (!node) return;
  let seconds = 9 * 3600 + 42 * 60 + 18;
  const match = node.textContent.trim().match(/^(\d+):(\d+):(\d+)$/);
  if (match) {
    seconds = parseInt(match[1], 10) * 3600 + parseInt(match[2], 10) * 60 + parseInt(match[3], 10);
  }
  if (container && container.dataset.deadlineTimestamp) {
    const deadline = new Date(container.dataset.deadlineTimestamp).getTime();
    if (!isNaN(deadline) && deadline > Date.now()) {
      seconds = Math.max(0, Math.floor((deadline - Date.now()) / 1000));
    }
  }
  const tick = () => {
    seconds = Math.max(0, seconds - 1);
    const h = String(Math.floor(seconds / 3600)).padStart(2, '0');
    const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
    const s = String(seconds % 60).padStart(2, '0');
    node.textContent = h + ':' + m + ':' + s;
  };
  window.setInterval(tick, 1000);
}
function renderCatalog() {
  const template = document.querySelector('#productCardTemplate');
  const grid = document.querySelector('#catalogGrid');
  if (!template || !grid) return;
  const params = new URLSearchParams(location.search);
  let activeCategory = categories.some((c) => c.key === params.get('category')) ? params.get('category') : 'all';
  const dealOnly = params.get('deal') === 'true';
  const wishlistOnly = params.get('wishlist') === 'true';
  const search = document.querySelector('#searchInput');
  const sort = document.querySelector('#sortSelect');
  const price = document.querySelector('#priceRange');
  const priceOutput = document.querySelector('#priceOutput');
  const filterList = document.querySelector('#categoryFilters');
  const empty = document.querySelector('#emptyResults');
  search.value = params.get('q') || '';
  filterList.innerHTML = [{ key: 'all', label: 'All departments' }, ...categories].map((category) => `<button data-category="${category.key}" class="${activeCategory === category.key ? 'active' : ''}">${category.label}</button>`).join('');
  function applyFilters() {
    const term = search.value.trim().toLowerCase();
    const minRating = Number(document.querySelector('input[name="rating"]:checked')?.value || 0);
    const maxPrice = Number(price.value);
    let filtered = products.filter((product) => {
      const searchable = [product.name, product.description, product.badge, ...product.specs].join(' ').toLowerCase();

      // Smart search: match whole words or basic plurals, preventing "table" from matching "adjustable" or "tablets"
      const searchMatch = !term || term.split(/\s+/).every(t => {
        const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`\\b${escaped}(s|es)?\\b`, 'i').test(searchable);
      });

      return (activeCategory === 'all' || product.category === activeCategory) && (!dealOnly || product.deal) && (!wishlistOnly || wishlist.has(product.id)) && searchMatch && retailPrice(product) <= maxPrice && product.rating >= minRating;
    });

    // Score relevance so exact name matches appear first
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
    priceOutput.textContent = 'Up to ' + money(maxPrice);
    document.querySelector('#resultCount').textContent = filtered.length + ' products';
    const categoryName = activeCategory === 'all' ? 'All products' : categories.find((c) => c.key === activeCategory).label;

    let headingText = dealOnly ? "Today's deals" : categoryName;
    if (term) {
      headingText = `Search results for "${search.value.trim()}"`;
    }
    document.querySelector('#resultsHeading').textContent = headingText;

    const subheadingText = activeCategory === 'all'
      ? 'Quality picks across electronics, fashion, home and books.'
      : `Quality picks across ${categoryName.toLowerCase()}.`;
    document.querySelector('#resultsSubheading').textContent = subheadingText;
    grid.innerHTML = '';
    filtered.forEach((product) => grid.appendChild(buildProductCard(product, template)));
    empty.hidden = filtered.length !== 0;
    grid.hidden = filtered.length === 0;
  }
  filterList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-category]'); if (!button) return;
    activeCategory = button.dataset.category;
    filterList.querySelectorAll('button').forEach((node) => node.classList.toggle('active', node === button));
    applyFilters();
  });
  [search, sort, price, ...document.querySelectorAll('input[name="rating"]')].forEach((control) => control.addEventListener(control === sort ? 'change' : 'input', applyFilters));
  function clearFilters() { activeCategory = 'all'; search.value = ''; sort.value = 'featured'; price.value = price.max; document.querySelector('input[name="rating"][value="0"]').checked = true; filterList.querySelectorAll('button').forEach((button) => button.classList.toggle('active', button.dataset.category === 'all')); applyFilters(); }
  document.querySelector('#clearFilters').addEventListener('click', clearFilters);
  document.querySelector('#emptyClear').addEventListener('click', clearFilters);
  document.querySelector('#filterToggle').addEventListener('click', () => document.querySelector('#filterPanel').classList.toggle('open'));
  applyFilters();
}
function renderCart() {
  const container = document.querySelector('#cartItems');
  if (!container) return;
  const items = cartItems(), subtotal = cartSubtotal(), delivery = deliveryFor(subtotal), savings = cartSavings();
  const listSubtotal = items.reduce((sum, item) => sum + retailOldPrice(item) * item.quantity, 0);
  const promoDiscount = calculatePromoDiscount(subtotal, delivery);
  const finalTotal = subtotal + delivery - promoDiscount;
  document.querySelector('#summaryItems').textContent = String(cartCount());
  document.querySelector('#summaryListTotal').textContent = money(listSubtotal);
  document.querySelector('#summarySubtotal').textContent = money(listSubtotal);
  document.querySelector('#summaryDelivery').textContent = delivery ? money(delivery) : 'FREE';

  // Markdown line — real per-item markdown, aggregated across the cart.
  const markdownRow = document.querySelector('#markdownRow');
  if (markdownRow) {
    markdownRow.dataset.discountType = 'markdown';
    if (savings > 0) {
      markdownRow.style.display = 'flex';
      const markedDownItems = items.filter((item) => item.oldPrice > item.price);
      const pcts = [...new Set(markedDownItems.map(discount))];
      document.querySelector('#markdownLabel').textContent = pcts.length === 1 ? `Markdown (${pcts[0]}% off original)` : 'Markdown';
      document.querySelector('#markdownAmt').textContent = '-' + money(savings);
    } else {
      markdownRow.style.display = 'none';
    }
  }

  const promoRow = document.querySelector('#promoRow');
  // data-applied-code lives on the promo field's own wrapper, not the row —
  // tag.js reads it via promoInput.closest('[data-applied-code]'), mirroring
  // the convention demo_router.js's applyPromoOverride already established.
  const promoFieldWrap = document.querySelector('#promoInput') && document.querySelector('#promoInput').parentElement;
  if (promoRow) {
    promoRow.dataset.discountType = 'code';
    if (activePromo && promoDiscount > 0) {
      promoRow.style.display = 'flex';
      document.querySelector('#promoCodeName').textContent = activePromo;
      const promo = PROMO_CODES[activePromo];
      const promoDescEl = document.querySelector('#promoDesc');
      if (promoDescEl) promoDescEl.textContent = promo ? (promo.type === 'percent' ? ` code (${promo.value}% off)` : ` code (${money(promo.value)} off)`) : ' code';
      document.querySelector('#summaryPromo').textContent = '-' + money(promoDiscount);
      if (promoFieldWrap) promoFieldWrap.setAttribute('data-applied-code', activePromo);
      const removeBtn = document.querySelector('#removePromoBtn');
      if (removeBtn && !removeBtn.hasAttribute('data-bound')) {
        removeBtn.setAttribute('data-bound', 'true');
        removeBtn.addEventListener('click', () => removePromo('cart'));
      }
    } else {
      promoRow.style.display = 'none';
      if (promoFieldWrap) promoFieldWrap.removeAttribute('data-applied-code');
    }
  }

  // Shopora Plus 5% member discount row in cart summary
  var _cartP = new URLSearchParams(window.location.search);
  var _cartPlus = _cartP.get('identity') === 'logged-in' && _cartP.get('member_tier') === 'plus';
  var _cartPlusRow = document.querySelector('#plusMemberRow');
  var actualTotal = finalTotal;
  if (_cartPlus) {
    var _cartPlusDisc = subtotal * 0.05;
    actualTotal = finalTotal - _cartPlusDisc;
    if (!_cartPlusRow) {
      _cartPlusRow = document.createElement('div');
      _cartPlusRow.id = 'plusMemberRow';
      _cartPlusRow.className = 'summary-row savings';
      _cartPlusRow.dataset.discountType = 'loyalty';
      _cartPlusRow.innerHTML = '<span>Shopora Plus member <strong style="font-size:0.72rem;background:#f5c518;color:#000;padding:1px 5px;border-radius:50px;">5% off</strong></span><strong id="plusMemberAmt"></strong>';
      var _breakdown = document.querySelector('.savings-breakdown');
      if (_breakdown) _breakdown.appendChild(_cartPlusRow);
    }
    var _pAmt = document.querySelector('#plusMemberAmt');
    if (_pAmt) _pAmt.textContent = '-' + money(_cartPlusDisc);
    _cartPlusRow.style.display = 'flex';
  } else {
    if (_cartPlusRow) _cartPlusRow.style.display = 'none';
  }

  document.querySelector('#summaryTotal').textContent = money(actualTotal);
  document.querySelector('#summarySavings').textContent = money(listSubtotal - actualTotal);
  document.querySelector('#cartItemLabel').textContent = cartCount() + (cartCount() === 1 ? ' item' : ' items');

  const btn = document.querySelector('#applyPromoBtn');
  if (btn && !btn.hasAttribute('data-bound')) {
    btn.setAttribute('data-bound', 'true');
    btn.addEventListener('click', () => {
      const input = document.querySelector('#promoInput');
      applyPromo(input.value, 'cart');
      input.value = '';
    });
  }
  const checkoutButton = document.querySelector('#checkoutButton');
  if (checkoutButton) {
    // Bake URL params directly into href at render time - most reliable approach
    var _cp = new URLSearchParams(window.location.search);
    var _cu = new URL('./checkout.html', window.location.origin);
    if (_cp.has('identity')) _cu.searchParams.set('identity', _cp.get('identity'));
    if (_cp.has('member_tier')) _cu.searchParams.set('member_tier', _cp.get('member_tier'));
    checkoutButton.href = _cu.toString();
  }
  checkoutButton.classList.toggle('disabled', !items.length);
  checkoutButton.setAttribute('aria-disabled', String(!items.length));
  const progress = document.querySelector('#shippingProgress');
  const remaining = Math.max(0, FREE_DELIVERY_MIN - subtotal);
  progress.innerHTML = subtotal >= FREE_DELIVERY_MIN ? '<p><strong>✓ You unlocked FREE delivery!</strong></p><div class="progress-track"><i style="width:100%"></i></div>' : `<p>Add <strong>${money(remaining)}</strong> more for FREE delivery</p><div class="progress-track"><i style="width:${Math.min(100, subtotal / FREE_DELIVERY_MIN * 100)}%"></i></div>`;
  if (!items.length) {
    container.innerHTML = '<div class="cart-empty"><span>🛒</span><h2>Your cart is empty</h2><p>Looks like you have not added anything yet.</p><a id="emptyCartShopBtn" class="button button-accent" href="./category.html">Start shopping</a></div>';
    setTimeout(() => {
      const btn = document.querySelector('#emptyCartShopBtn');
      if (btn) btn.addEventListener('click', (e) => { e.preventDefault(); navWithParams('./category.html'); });
    }, 0);
    return;
  }
  container.innerHTML = items.map((item) => `<article class="cart-item" data-cart-id="${item.id}" data-item-id="${item.id}" data-sku="${item.id}"><div class="product-image" style="cursor:pointer"></div><div><span class="section-kicker">${item.badge}</span><h3 style="cursor:pointer">${item.name}</h3><p class="cart-item-meta">${item.description}</p><p class="cart-item-meta" data-availability-flag><b>In stock</b> · FREE returns</p><div class="cart-item-actions"><div class="quantity-control"><button data-dec aria-label="Decrease quantity">−</button><span>${item.quantity}</span><button data-inc aria-label="Increase quantity">+</button></div><button class="text-button" data-save>Save for later</button><button class="text-button" data-remove>Remove</button></div></div><div class="cart-item-price"><strong class="cart-item-total">${money(retailPrice(item) * item.quantity)}</strong><del>${money(retailOldPrice(item) * item.quantity)}</del><small>${discount(item)}% off</small></div></article>`).join('');
  items.forEach((item) => {
    const row = container.querySelector('[data-cart-id="' + item.id + '"]');
    applyVisual(row.querySelector('.product-image'), item);
    const navPDP = (e) => { e.preventDefault(); navWithParams(`./pdp.html?id=${item.id}`); };
    row.querySelector('.product-image').addEventListener('click', navPDP);
    row.querySelector('h3').addEventListener('click', navPDP);
    row.querySelector('[data-dec]').addEventListener('click', () => updateQuantity(item.id, item.quantity - 1));
    row.querySelector('[data-inc]').addEventListener('click', () => updateQuantity(item.id, item.quantity + 1));
    row.querySelector('[data-remove]').addEventListener('click', () => removeFromCart(item.id));
    row.querySelector('[data-save]').addEventListener('click', () => { wishlist.add(item.id); saveWishlist(); removeFromCart(item.id); toast('Moved to your wishlist.'); });
  });
}
function renderRecommendations() {
  const grid = document.querySelector('#recommendedGrid'), template = document.querySelector('#productCardTemplate'); if (!grid || !template) return;
  products.filter((product) => !cart[product.id]).slice(5, 9).forEach((product) => grid.appendChild(buildProductCard(product, template)));
}
function renderCheckout() {
  const container = document.querySelector('#checkoutItems'), form = document.querySelector('#checkoutForm'); if (!container || !form) return;
  const update = () => {
    const items = cartItems(), subtotal = cartSubtotal(), delivery = deliveryFor(subtotal);
    const promoDiscount = calculatePromoDiscount(subtotal, delivery);
    const finalTotal = subtotal + delivery - promoDiscount;
    document.querySelector('#checkoutSubtotal').textContent = money(subtotal);
    document.querySelector('#checkoutDelivery').textContent = delivery ? money(delivery) : 'FREE';

    const promoRow = document.querySelector('#checkoutPromoRow');
    if (promoRow) {
      if (activePromo && promoDiscount > 0) {
        promoRow.style.display = 'flex';
        document.querySelector('#checkoutPromoName').textContent = activePromo;
        document.querySelector('#checkoutPromo').textContent = '-' + money(promoDiscount);
        const removeBtn = document.querySelector('#removeCheckoutPromoBtn');
        if (removeBtn && !removeBtn.hasAttribute('data-bound')) {
          removeBtn.setAttribute('data-bound', 'true');
          removeBtn.addEventListener('click', () => removePromo('checkout'));
        }
      } else {
        promoRow.style.display = 'none';
      }
    }

    // Shopora Plus 5% member discount row
    const _coParams = new URLSearchParams(window.location.search);
    const _coIsPlus = _coParams.get('identity') === 'logged-in' && _coParams.get('member_tier') === 'plus';
    let _coPlusRow = document.querySelector('#coPlusMemberRow');
    if (_coIsPlus) {
      const _coDiscount = subtotal * 0.05;
      const _coAdjustedTotal = finalTotal - _coDiscount;
      document.querySelector('#checkoutTotal').textContent = money(_coAdjustedTotal);
      if (!_coPlusRow) {
        _coPlusRow = document.createElement('div');
        _coPlusRow.id = 'coPlusMemberRow';
        _coPlusRow.className = 'summary-row savings';
        _coPlusRow.innerHTML = '<span>Shopora Plus member <strong style="font-size:0.72rem;background:#f5c518;color:#000;padding:1px 5px;border-radius:50px;">5% off</strong></span><strong id="coPlusMemberAmt"></strong>';
        const _coTotalRow = document.querySelector('#checkoutTotal')?.closest('.summary-row.total');
        if (_coTotalRow) _coTotalRow.before(_coPlusRow);
      }
      document.querySelector('#coPlusMemberAmt').textContent = '-' + money(subtotal * 0.05);
      _coPlusRow.style.display = 'flex';
    } else {
      if (_coPlusRow) _coPlusRow.style.display = 'none';
      document.querySelector('#checkoutTotal').textContent = money(finalTotal);
    }

    const btn = document.querySelector('#applyCheckoutPromoBtn');
    if (btn && !btn.hasAttribute('data-bound')) {
      btn.setAttribute('data-bound', 'true');
      btn.addEventListener('click', () => {
        const input = document.querySelector('#checkoutPromoInput');
        applyPromo(input.value, 'checkout');
        input.value = '';
      });
    }
    document.querySelector('#placeOrderButton').disabled = !items.length;
    container.innerHTML = items.length ? items.map((item) => `<div class="mini-item" data-mini-id="${item.id}"><div class="product-image" style="cursor:pointer"></div><div><p style="cursor:pointer">${item.name}</p><small>Qty ${item.quantity}</small></div><strong>${money(retailPrice(item) * item.quantity)}</strong></div>`).join('') : '<div class="cart-empty"><p>Your cart is empty.</p><a class="button button-primary" href="./category.html">Shop products</a></div>';
    items.forEach((item) => {
      const row = container.querySelector('[data-mini-id="' + item.id + '"]');
      applyVisual(row.querySelector('.product-image'), item);

      const navPDP = (e) => { e.preventDefault(); navWithParams(`./pdp.html?id=${item.id}`); };
      row.querySelector('.product-image').addEventListener('click', navPDP);
      row.querySelector('p').addEventListener('click', navPDP);
    });
  };
  update();
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const items = cartItems();
    if (!items.length) { toast('Your cart is empty.'); return; }
    const orderId = 'SP' + Date.now().toString().slice(-8);

    // Save order
    const pastOrders = JSON.parse(localStorage.getItem('shopora-orders') || '[]');
    let total = 0;
    const orderItems = items.map(item => {
      total += retailPrice(item) * item.quantity;
      return { id: item.id, name: item.name, qty: item.quantity, price: retailPrice(item), category: item.category };
    });

    let appliedPromo = JSON.parse(localStorage.getItem('shopora-promo'));
    if (appliedPromo && appliedPromo.discount > 0) {
      total = Math.max(0, total - appliedPromo.discount);
    }

    pastOrders.unshift({
      id: orderId,
      date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      total: total,
      status: 'Processing',
      items: orderItems
    });
    localStorage.setItem('shopora-orders', JSON.stringify(pastOrders));

    Object.keys(cart).forEach((key) => delete cart[key]);
    saveCart();
    localStorage.removeItem('shopora-promo');
    update();
    form.reset();
    const message = document.querySelector('#orderMessage');
    message.innerHTML = `<div class="success-card"><span>✓</span><h2>Order confirmed!</h2><p>Your demo order <strong>#${orderId}</strong> has been placed successfully.</p><p>No payment was processed.</p><a class="button button-accent full-width" href="./orders.html">View order tracking</a><a class="button button-ghost full-width" style="margin-top:0.5rem; color: var(--navy); border: 1px solid var(--line);" href="./index.html">Continue shopping</a></div>`;
    message.hidden = false;
  });
}
function renderPDP() {
  const params = new URLSearchParams(location.search);
  // Support both ?sku= (spec requirement) and ?id= (internal links)
  const productId = params.get('sku') || params.get('id') || 'el-1';
  const product = products.find(p => p.id === productId) || products[0];

  const main = document.querySelector('#mainContent');
  if (!main) return;

  // Set dynamic page title
  document.title = `${product.name} | SHOPORA`;

  // Reset inline styles on main to have full control of the layout
  main.style.cssText = 'display: block; padding: 40px; max-width: min(1400px, calc(100% - 2rem)); margin: 2rem auto 0; background: #fff; border-radius: 16px 16px 0 0;';

  let specLabels = ['Feature 1', 'Feature 2', 'Feature 3', 'Feature 4'];
  let variantLabel = 'Style';
  let variantOptions = ['Standard', 'Premium'];

  if (product.category === 'electronics') {
    specLabels = ['Brand', 'Operating System', 'RAM Memory', 'CPU Model'];
    variantLabel = 'Configuration';
    variantOptions = ['Base Edition', 'Pro Edition', 'Max Edition'];
  } else if (product.category === 'fashion') {
    specLabels = ['Material', 'Fit Type', 'Care Instructions', 'Pattern'];
    variantLabel = 'Size';
    variantOptions = ['S', 'M', 'L', 'XL'];
  } else if (product.category === 'home') {
    specLabels = ['Material', 'Color', 'Room Type', 'Style'];
    variantLabel = 'Finish';
    variantOptions = ['Default', 'Matte', 'Glossy'];
  } else if (product.category === 'books') {
    specLabels = ['Format', 'Pages', 'Language', 'Publisher'];
    variantLabel = 'Format';
    variantOptions = ['Paperback', 'Hardcover', 'Kindle Edition'];
  }

  const discountPercent = discount(product);
  const retailP = retailPrice(product);
  const oldP = retailOldPrice(product);
  const brandName = product.name.split(' ')[0];

  const html = `
    <style>
      @keyframes pdp-pulse {
        0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(18,128,92, 0.7); }
        70% { transform: scale(1); box-shadow: 0 0 0 10px rgba(18,128,92, 0); }
        100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(18,128,92, 0); }
      }
      .pdp-main-image { transition: all 0.2s ease; }
    </style>
    <div id="hero" data-product-id="${product.id}" data-sku="${product.id}" data-mfr-no="SHOP-${product.id}" data-availability="${product.availability || 'in-stock'}" data-brand="${brandName}" data-category="${product.category}" data-sponsored="false" style="max-width: 1400px; margin: 0 auto; display: grid; grid-template-columns: 1.3fr 1fr; gap: 80px; padding-bottom: 60px;">
      
      <!-- Left: Image Gallery (Sticky) -->
      <div style="position: sticky; top: 100px; height: max-content; display: flex; gap: 24px; align-items: flex-start;">
        <!-- Thumbnails (Vertical) -->
        <div style="display: flex; flex-direction: column; gap: 16px; width: 85px;">
          <div class="pdp-thumb" data-transform="scale(1.35)" style="width: 100%; aspect-ratio: 1; border: 2px solid var(--blue); border-radius: 12px; background: var(--soft); cursor: pointer; transition: 0.2s; overflow: hidden; display: flex; align-items: center; justify-content: center;">
            <div class="product-image" style="width: 100%; height: 100%; transform: scale(1.35);"></div>
          </div>
          <div class="pdp-thumb" data-transform="scale(2) translate(10%, 10%)" style="width: 100%; aspect-ratio: 1; border: 2px solid transparent; border-radius: 12px; background: var(--soft); cursor: pointer; opacity: 0.5; transition: 0.2s; overflow: hidden; display: flex; align-items: center; justify-content: center;">
            <div class="product-image" style="width: 100%; height: 100%; transform: scale(2) translate(10%, 10%);"></div>
          </div>
          <div class="pdp-thumb" data-transform="scale(1.5) scaleX(-1)" style="width: 100%; aspect-ratio: 1; border: 2px solid transparent; border-radius: 12px; background: var(--soft); cursor: pointer; opacity: 0.5; transition: 0.2s; overflow: hidden; display: flex; align-items: center; justify-content: center;">
            <div class="product-image" style="width: 100%; height: 100%; transform: scale(1.5) scaleX(-1);"></div>
          </div>
          <div class="pdp-thumb" data-transform="scale(2.5) translate(-10%, -10%)" style="width: 100%; aspect-ratio: 1; border: 2px solid transparent; border-radius: 12px; background: var(--soft); cursor: pointer; opacity: 0.5; transition: 0.2s; overflow: hidden; display: flex; align-items: center; justify-content: center;">
            <div class="product-image" style="width: 100%; height: 100%; transform: scale(2.5) translate(-10%, -10%);"></div>
          </div>
        </div>
        <!-- Main Image -->
        <div class="pdp-main-image" style="flex: 1; aspect-ratio: 1; background-color: var(--soft); border-radius: 24px; position: relative; box-shadow: 0 20px 40px rgba(16,36,62,0.04); overflow: hidden; display: flex; align-items: center; justify-content: center;">
          <div id="hero-main-image" class="product-image custom-product-image" style="width: 100%; height: 100%; transform: scale(1.35); transform-origin: center;"></div>
        </div>
      </div>

      <!-- Right: Product Info -->
      <div style="padding-top: 0;">
        <!-- Breadcrumb -->
        <nav aria-label="breadcrumb">
          <ul style="list-style: none; padding: 0; margin: 0 0 8px 0; display: flex; font-size: 0.7rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.12em; font-weight: 700; gap: 4px;">
            <li><a href="./index.html" style="color: var(--muted); transition: 0.2s;" onmouseover="this.style.color='var(--blue)'" onmouseout="this.style.color='var(--muted)'">Home</a> /</li>
            <li><a href="./category.html" class="product-category" style="color: var(--muted); transition: 0.2s;" onmouseover="this.style.color='var(--blue)'" onmouseout="this.style.color='var(--muted)'">${product.category}</a> /</li>
            <li><span style="color: var(--navy);">${brandName}</span></li>
          </ul>
        </nav>

        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
          <div class="scarcity-msg" style="display: flex; align-items: center; gap: 6px; background: #fff0f0; border: 1px solid #ffdcdc; color: #d02e2e; padding: 2px 8px; border-radius: 50px; font-size: 0.65rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">
            <span style="font-size: 0.9rem;">&bull;</span> High Demand
          </div>
          <a href="./category.html?brand=${encodeURIComponent(brandName.toLowerCase())}" class="product-brand" style="color: var(--blue); font-weight: 800; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.12em; text-decoration: none;">${brandName} Official</a>
        </div>
        
        <h1 class="product-title" style="font-size: clamp(1.4rem, 2.5vw, 2rem); font-weight: 800; color: var(--navy); line-height: 1.1; letter-spacing: -0.02em; margin: 0 0 6px;">${product.name}</h1>
        
        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 10px;">
          <div style="display: flex; align-items: center; gap: 4px; background: var(--navy); color: #fff; padding: 4px 8px; border-radius: 6px; font-size: 0.75rem; font-weight: 700;">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="var(--accent)" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:2px"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg> ${product.rating.toFixed(1)}
          </div>
          <span style="color: var(--muted); font-size: 0.8rem; font-weight: 500; cursor: pointer; border-bottom: 1px dashed var(--muted); padding-bottom: 2px;">${ratingCount(product).toLocaleString()} Reviews</span>
        </div>

        <p style="font-size: 0.9rem; color: var(--muted); line-height: 1.4; margin-bottom: 12px; max-width: 95%;">
          ${product.description} Built for premium quality and designed to elevate your everyday experience.
        </p>

        <!-- Price -->
        <div class="price-stack" style="position: relative; display: flex; align-items: center; gap: 12px; margin-bottom: 15px; padding-bottom: 15px; border-bottom: 1px solid var(--line);">
          <div class="price" style="font-size: 1.8rem; font-weight: 800; color: var(--navy); line-height: 1; letter-spacing: -0.02em;">
            ${money(retailP)}
          </div>
          ${product.deal ? `<div class="discount-badge" style="position: static; transform: none; background: #fee4e2; color: #b42318; padding: 4px 8px; border-radius: 50px; font-weight: 800; font-size: 0.7rem; letter-spacing: 0.05em;">SAVE ${discountPercent}%</div>` : ''}
          <del class="price-was" style="color: var(--muted); text-decoration: line-through; font-size: 1rem; font-weight: 500;">
            ${money(oldP)}
          </del>
        </div>

        <!-- Variants -->
        <div style="margin-bottom: 15px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <div style="font-size: 0.75rem; font-weight: 700; color: var(--navy); text-transform: uppercase; letter-spacing: 0.08em;">
              ${variantLabel}: <span id="variant-label" style="color: var(--muted); font-weight: 500;">${variantOptions[0]}</span>
            </div>
            ${product.category === 'fashion' ? '<a href="#" style="color: var(--blue); font-size: 0.75rem; font-weight: 600; text-decoration: underline;">Size Guide</a>' : ''}
          </div>
          <div style="display: flex; gap: 8px; flex-wrap: wrap;">
            ${variantOptions.map((opt, i) => `
              <button class="pdp-variant-btn" data-variant="${opt}" data-active="${i === 0 ? 'true' : 'false'}" style="padding: 6px 14px; border: 2px solid ${i === 0 ? 'var(--navy)' : 'var(--line)'}; background: transparent; border-radius: 50px; cursor: pointer; color: ${i === 0 ? 'var(--navy)' : 'var(--muted)'}; font-size: 0.75rem; font-weight: 700; transition: all 0.2s;" onmouseover="if(this.dataset.active !== 'true') { this.style.borderColor='var(--navy)'; this.style.color='var(--navy)'; }" onmouseout="if(this.dataset.active !== 'true') { this.style.borderColor='var(--line)'; this.style.color='var(--muted)'; }">
                ${opt}
              </button>
            `).join('')}
          </div>
        </div>

        <!-- Action Area -->
        <div style="background: var(--soft); padding: 15px 20px; border-radius: 16px; margin-bottom: 15px;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 15px;">
            <div style="display: flex; align-items: center; gap: 8px; color: var(--green); font-weight: 700; font-size: 0.95rem;">
              <div style="width: 10px; height: 10px; background: var(--green); border-radius: 50%; animation: pdp-pulse 2s infinite;"></div>
              In Stock & Ready to Ship
            </div>
            <div class="delivery-promise" style="font-size: 0.8rem; color: var(--muted); font-weight: 500;">Order within 5 hrs</div>
          </div>
          
          <div style="display: flex; gap: 8px; align-items: stretch; min-height: 50px; flex-wrap: wrap;">
            
            <!-- Quantity Selector -->
            <div style="display: flex; align-items: center; border: 2px solid var(--line); border-radius: 16px; background: #fff; overflow: hidden; min-width: 100px; max-width: 130px; flex: 0.5; box-shadow: inset 0 2px 4px rgba(0,0,0,0.02);">
              <button id="qty-minus" style="flex: 1; min-height: 46px; background: transparent; border: none; font-size: 1.3rem; color: var(--navy); cursor: pointer; transition: 0.2s;" onmouseover="this.style.background='var(--soft)'" onmouseout="this.style.background='transparent'">−</button>
              <div id="qty-value" style="flex: 1; text-align: center; font-size: 1.1rem; font-weight: 800; color: var(--navy);">1</div>
              <button id="qty-plus" style="flex: 1; min-height: 46px; background: transparent; border: none; font-size: 1.3rem; color: var(--navy); cursor: pointer; transition: 0.2s;" onmouseover="this.style.background='var(--soft)'" onmouseout="this.style.background='transparent'">+</button>
            </div>
            
            <button id="pdpAddToCart" class="add-to-cart" style="flex: 2; min-width: 180px; padding: 10px 8px; font-size: clamp(0.9rem, 2vw, 1.1rem); line-height: 1.3; border-radius: 16px; background: var(--blue); border: none; color: #fff; font-weight: 800; cursor: pointer; transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275); box-shadow: 0 8px 20px rgba(20,99,255,0.25);" onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 12px 25px rgba(20,99,255,0.35)'" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 8px 20px rgba(20,99,255,0.25)'">
              Add to Cart — <span id="add-to-cart-price">${money(retailP)}</span>
            </button>
            <button id="pdpWishlistBtn" data-active="false" style="width: 55px; min-height: 46px; border-radius: 16px; background: #fff; border: 2px solid var(--line); color: var(--navy); font-size: 1.4rem; font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: 0.2s;" onmouseover="if(this.dataset.active !== 'true') { this.style.borderColor='var(--blue)'; this.style.color='var(--blue)'; }" onmouseout="if(this.dataset.active !== 'true') { this.style.borderColor='var(--line)'; this.style.color='var(--navy)'; }">
              ♡
            </button>
          </div>
          
          <div style="display: flex; justify-content: space-around; font-size: 0.85rem; color: var(--muted); font-weight: 600; margin-top: 25px; border-top: 1px solid var(--line); padding-top: 20px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13"></rect><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"></polygon><circle cx="5.5" cy="18.5" r="2.5"></circle><circle cx="18.5" cy="18.5" r="2.5"></circle></svg> Free Shipping
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg> 30-Day Returns
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg> Secure Checkout
            </div>
          </div>
        </div>

        <!-- Specs Accordion -->
        <div style="border-top: 1px solid var(--line);">
          <div class="pdp-accordion" style="padding: 30px 0; border-bottom: 1px solid var(--line);">
            <div class="pdp-accordion-header" style="display: flex; justify-content: space-between; align-items: center; cursor: pointer;">
              <h3 style="font-size: 1.3rem; font-weight: 800; color: var(--navy); margin: 0;">Product Specifications</h3>
              <span class="pdp-accordion-icon" style="font-size: 1.5rem; color: var(--muted); font-weight: 300;">−</span>
            </div>
            <div class="pdp-accordion-content" style="margin-top: 25px; display: block;">
              <ul style="list-style: none; padding: 0; margin: 0; display: grid; gap: 16px;">
                ${product.specs.map((spec, i) => `
                  <li style="display: flex; font-size: 1.05rem; padding-bottom: 16px; border-bottom: 1px dashed var(--line);">
                    <span style="width: 40%; color: var(--muted); font-weight: 600;">${specLabels[i] || 'Detail'}</span>
                    <span style="width: 60%; color: var(--navy); font-weight: 600;">${spec}</span>
                  </li>
                `).join('')}
              </ul>
            </div>
          </div>
          
          <!-- Delivery Info Accordion -->
          <div class="pdp-accordion" style="padding: 30px 0; border-bottom: 1px solid var(--line);">
            <div class="pdp-accordion-header" style="display: flex; justify-content: space-between; align-items: center; cursor: pointer; transition: 0.2s;" onmouseover="this.style.opacity='0.7'" onmouseout="this.style.opacity='1'">
              <h3 style="font-size: 1.3rem; font-weight: 800; color: var(--navy); margin: 0;">Delivery & Returns</h3>
              <span class="pdp-accordion-icon" style="font-size: 1.5rem; color: var(--muted); font-weight: 300;">+</span>
            </div>
            <div class="pdp-accordion-content" style="margin-top: 25px; display: none;">
              <div style="font-size: 1.05rem; color: var(--muted); line-height: 1.6; display: flex; flex-direction: column; gap: 15px;">
                <div>
                  <strong style="color: var(--navy);">Standard Delivery:</strong> 3-5 business days. Free for orders over $50.
                </div>
                <div>
                  <strong style="color: var(--navy);">Express Delivery:</strong> 1-2 business days. Available at checkout for $12.99.
                </div>
                <div>
                  <strong style="color: var(--navy);">Returns Policy:</strong> We offer a 30-day return policy for unused items in original packaging. Refunds are processed within 5-7 business days after inspection.
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

    </div>
  `;

  main.innerHTML = html;

  applyVisual(main.querySelector('.custom-product-image'), product);
  main.querySelector('#pdpAddToCart').addEventListener('click', () => addToCart(product.id));

  // Wishlist Logic
  const wishlistBtn = main.querySelector('#pdpWishlistBtn');
  if (wishlistBtn) {
    wishlistBtn.addEventListener('click', () => {
      const isActive = wishlistBtn.dataset.active === 'true';
      if (isActive) {
        wishlistBtn.dataset.active = 'false';
        wishlistBtn.style.color = 'var(--navy)';
        wishlistBtn.style.borderColor = 'var(--line)';
        wishlistBtn.innerHTML = '♡';
      } else {
        wishlistBtn.dataset.active = 'true';
        wishlistBtn.style.color = '#e02424';
        wishlistBtn.style.borderColor = '#e02424';
        wishlistBtn.innerHTML = '♥';
      }
    });
  }

  // Variant Logic
  const variantButtonsElements = main.querySelectorAll('.pdp-variant-btn');
  const variantLabelEl = main.querySelector('#variant-label');
  variantButtonsElements.forEach(btn => {
    btn.addEventListener('click', () => {
      variantButtonsElements.forEach(b => {
        b.style.borderColor = 'var(--line)';
        b.style.color = 'var(--muted)';
        b.dataset.active = "false";
      });
      btn.style.borderColor = 'var(--navy)';
      btn.style.color = 'var(--navy)';
      btn.dataset.active = "true";
      if (variantLabelEl) variantLabelEl.textContent = btn.dataset.variant;
    });
  });

  // Accordion Logic
  const accordions = main.querySelectorAll('.pdp-accordion');
  accordions.forEach(acc => {
    const header = acc.querySelector('.pdp-accordion-header');
    const content = acc.querySelector('.pdp-accordion-content');
    const icon = acc.querySelector('.pdp-accordion-icon');
    if (header && content && icon) {
      header.addEventListener('click', () => {
        const isOpen = content.style.display === 'block';
        if (isOpen) {
          content.style.display = 'none';
          icon.textContent = '+';
        } else {
          content.style.display = 'block';
          icon.textContent = '−';
        }
      });
    }
  });

  // Quantity Selector Logic
  const qtyMinus = main.querySelector('#qty-minus');
  const qtyPlus = main.querySelector('#qty-plus');
  const qtyValue = main.querySelector('#qty-value');
  const addToCartPrice = main.querySelector('#add-to-cart-price');
  let currentQty = 1;

  if (qtyMinus && qtyPlus && qtyValue && addToCartPrice) {
    qtyMinus.addEventListener('click', () => {
      if (currentQty > 1) {
        currentQty--;
        qtyValue.textContent = currentQty;
        addToCartPrice.textContent = money(retailP * currentQty);
      }
    });
    qtyPlus.addEventListener('click', () => {
      if (currentQty < 10) {
        currentQty++;
        qtyValue.textContent = currentQty;
        addToCartPrice.textContent = money(retailP * currentQty);
      }
    });
  }

  // Apply visual to all thumbnails
  const thumbImages = main.querySelectorAll('.pdp-thumb .product-image');
  thumbImages.forEach(img => applyVisual(img, product));

  // Interactive Thumbnail Gallery
  const thumbnails = main.querySelectorAll('.pdp-thumb');
  const mainImageContainer = main.querySelector('.pdp-main-image');
  const mainProductImage = main.querySelector('.custom-product-image');

  if (thumbnails.length > 0 && mainImageContainer) {
    thumbnails.forEach(thumb => {
      thumb.addEventListener('mouseenter', () => { if (thumb.style.borderColor !== 'var(--blue)') thumb.style.opacity = '1'; });
      thumb.addEventListener('mouseleave', () => { if (thumb.style.borderColor !== 'var(--blue)') thumb.style.opacity = '0.5'; });
      thumb.addEventListener('click', () => {
        thumbnails.forEach(t => { t.style.borderColor = 'transparent'; t.style.opacity = '0.5'; });
        thumb.style.borderColor = 'var(--blue)';
        thumb.style.opacity = '1';

        // Quick visual pop to simulate image changing
        mainImageContainer.style.opacity = '0.7';
        mainImageContainer.style.transform = 'scale(0.98)';

        // Update main image transform
        const targetImage = document.getElementById('hero-main-image');
        const transVal = thumb.getAttribute('data-transform');
        if (targetImage && transVal) {
          targetImage.style.transform = transVal;
        }

        setTimeout(() => {
          mainImageContainer.style.opacity = '1';
          mainImageContainer.style.transform = 'scale(1)';
        }, 150);
      });
    });
  }
}
function initSearch() {
  const form = document.querySelector('#searchForm'), input = document.querySelector('#headerSearch'), category = document.querySelector('#headerCategory'); if (!form || !input) return;
  const params = new URLSearchParams(location.search);
  if (input && params.has('q')) input.value = params.get('q');
  if (category && params.has('category')) {
    const val = params.get('category');
    if (Array.from(category.options).some(o => o.value === val)) category.value = val;
  }
  form.addEventListener('submit', (event) => {
    event.preventDefault(); const target = new URL('./category.html', location.href); if (input.value.trim()) target.searchParams.set('q', input.value.trim()); if (category?.value && category.value !== 'all') target.searchParams.set('category', category.value); // Preserve demo state in search navigation
    const demoParams = new URLSearchParams(window.location.search);
    if (demoParams.has('identity')) target.searchParams.set('identity', demoParams.get('identity'));
    if (demoParams.has('member_tier')) target.searchParams.set('member_tier', demoParams.get('member_tier'));
    location.href = target.toString();
  });
}

function initIdentity() {
  const params = new URLSearchParams(location.search);
  const chip = document.querySelector('.account-chip');
  if (chip) {
    if (params.get('identity') === 'logged-in') {
      chip.dataset.identityState = 'recognized';
      chip.dataset.memberTier = 'plus';
      chip.dataset.customerHash = 'demo-customer-hash-abc123';
      chip.innerHTML = '<span class="greeting">Hello, Rahul</span><strong class="account-label">Shopora Plus</strong>';
    }

    // Demo helper: Clicking the chip toggles the login state
    chip.addEventListener('click', (e) => {
      e.preventDefault();
      const currentUrl = new URL(window.location);
      if (params.get('identity') === 'logged-in') {
        // Going to guest: remove BOTH identity AND member_tier
        currentUrl.searchParams.delete('identity');
        currentUrl.searchParams.delete('member_tier');
      } else {
        currentUrl.searchParams.set('identity', 'logged-in');
      }
      window.location.href = currentUrl.toString();
    });
  }
}

function initLoyaltyChip() {
  const params = new URLSearchParams(location.search);
  if (params.get('identity') === 'logged-in' && params.get('member_tier') === 'plus') {
    const chipHtml = `
      <div class="loyalty-chip" data-loyalty-tier="plus" data-loyalty-balance="450">
        <span class="tier-label">Shopora Plus</span>
        <span class="points">450 points</span>
        <span class="tier-threshold">50 from Gold</span>
      </div>
    `;

    // Inject into header (prepend to account-nav)
    const accountNav = document.querySelector('.account-nav');
    if (accountNav) {
      accountNav.insertAdjacentHTML('afterbegin', chipHtml);
    }

    // Inject into cart/checkout summaries
    const summaryCard = document.querySelector('.summary-card');
    const checkoutSummary = document.querySelector('.checkout-summary');

    if (checkoutSummary) {
      checkoutSummary.insertAdjacentHTML('afterbegin', '<div style="margin-bottom: 1rem; text-align: center;">' + chipHtml + '</div>');
    } else if (summaryCard) {
      summaryCard.insertAdjacentHTML('afterbegin', '<div style="margin-bottom: 1rem; text-align: center;">' + chipHtml + '</div>');
    }
  }
}

// Helper: navigate to a URL while preserving demo state params
function navWithParams(url) {
  const current = new URLSearchParams(window.location.search);
  const target = new URL(url, window.location.origin);
  if (current.has('identity')) target.searchParams.set('identity', current.get('identity'));
  if (current.has('member_tier')) target.searchParams.set('member_tier', current.get('member_tier'));
  location.href = target.toString();
}
function initGlobalInteractions() {
  // Persist demo state parameters across all internal links
  document.addEventListener('click', (e) => {
    const link = e.target.closest('a');
    if (!link || !link.href || link.href.startsWith('javascript:')) return;

    // Only intercept internal links to preserve demo state
    try {
      const linkUrl = new URL(link.href, window.location.origin);
      if (linkUrl.origin === window.location.origin && !link.classList.contains('account-chip')) {
        const currentParams = new URLSearchParams(window.location.search);
        if (currentParams.has('identity') || currentParams.has('member_tier')) {
          e.preventDefault();
          navWithParams(link.href);
        }
      }
    } catch (err) {
      // ignore invalid URLs
    }
  });

  initLoyaltyChip();
  initIdentity();
  document.querySelectorAll('[data-toast]').forEach((node) => node.addEventListener('click', (event) => { event.preventDefault(); toast(node.dataset.toast); }));
  const productForm = document.querySelector('#productFilterForm');
  if (productForm) {
    productForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const val = document.querySelector('#searchInput').value.trim();
      if (val) location.href = `./category.html?q=${encodeURIComponent(val)}`;
      else location.href = './category.html';
    });
  }

  // Update wishlist links dynamically to include the filter parameter
  document.querySelectorAll('.wishlist-link').forEach(link => {
    link.href = './category.html?wishlist=true';
  });

  const newsletter = document.querySelector('#newsletterForm');
  newsletter?.addEventListener('submit', (event) => { event.preventDefault(); toast('You are on the list. Watch your inbox for deals!', 'success'); newsletter.reset(); });

  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') { const modal = document.querySelector('#quickViewModal'); if (modal && !modal.hidden) { modal.hidden = true; document.body.classList.remove('modal-open'); } } });

  initZipStateAutofill();
}

// US ZIP codes are assigned in contiguous ranges by their first 3 digits
// (ZIP3), one or more ranges per state — this is the standard approach for
// ZIP -> state lookup without a full per-ZIP database.
const ZIP3_STATE_RANGES = [
  [10, 27, 'Massachusetts'], [28, 29, 'Rhode Island'], [30, 38, 'New Hampshire'],
  [39, 49, 'Maine'], [50, 59, 'Vermont'], [60, 69, 'Connecticut'],
  [70, 89, 'New Jersey'], [100, 149, 'New York'], [150, 196, 'Pennsylvania'],
  [197, 199, 'Delaware'], [200, 205, 'District of Columbia'], [206, 219, 'Maryland'],
  [220, 246, 'Virginia'], [247, 268, 'West Virginia'], [270, 289, 'North Carolina'],
  [290, 299, 'South Carolina'], [300, 319, 'Georgia'], [398, 399, 'Georgia'],
  [320, 349, 'Florida'], [350, 369, 'Alabama'], [370, 385, 'Tennessee'],
  [386, 397, 'Mississippi'], [400, 427, 'Kentucky'], [430, 459, 'Ohio'],
  [460, 479, 'Indiana'], [480, 499, 'Michigan'], [500, 528, 'Iowa'],
  [530, 549, 'Wisconsin'], [550, 567, 'Minnesota'], [570, 577, 'South Dakota'],
  [580, 588, 'North Dakota'], [590, 599, 'Montana'], [600, 629, 'Illinois'],
  [630, 658, 'Missouri'], [660, 679, 'Kansas'], [680, 693, 'Nebraska'],
  [700, 714, 'Louisiana'], [716, 729, 'Louisiana'], [730, 749, 'Oklahoma'],
  [750, 799, 'Texas'], [885, 885, 'Texas'], [800, 816, 'Colorado'],
  [820, 831, 'Wyoming'], [832, 838, 'Idaho'], [840, 847, 'Utah'],
  [850, 865, 'Arizona'], [870, 884, 'New Mexico'], [889, 898, 'Nevada'],
  [900, 961, 'California'], [967, 968, 'Hawaii'], [970, 979, 'Oregon'],
  [980, 994, 'Washington'], [995, 999, 'Alaska']
];
function stateForZip(zip) {
  const zip3 = parseInt(zip.slice(0, 3), 10);
  if (isNaN(zip3)) return null;
  const match = ZIP3_STATE_RANGES.find(([min, max]) => zip3 >= min && zip3 <= max);
  return match ? match[2] : null;
}
function initZipStateAutofill() {
  const postalInput = document.querySelector('#checkoutPostal');
  const stateSelect = document.querySelector('#checkoutState');
  if (!postalInput || !stateSelect) return;
  postalInput.addEventListener('input', () => {
    const zip = postalInput.value.trim();
    if (!/^\d{5}$/.test(zip)) return;
    const state = stateForZip(zip);
    if (state && [...stateSelect.options].some((opt) => opt.value === state)) {
      stateSelect.value = state;
    }
  });
}
function initOrders() {
  const container = document.querySelector('#ordersContainer');
  if (!container) return;

  let pastOrders = JSON.parse(localStorage.getItem('shopora-orders') || '[]');

  const renderOrders = () => {
    if (pastOrders.length === 0) {
      container.innerHTML = `<div class="empty-orders"><span>📦</span><h2>No orders found</h2><p>Looks like you haven't placed any orders yet.</p><a class="button button-accent" href="./category.html">Start shopping</a></div>`;
      return;
    }

    container.innerHTML = pastOrders.map(order => `
      <div class="order-card">
        <div class="order-header">
          <div class="order-meta-group">
            <div>
              ORDER PLACED
              <strong>${order.date}</strong>
            </div>
            <div>
              TOTAL
              <strong>${money(order.total)}</strong>
            </div>
            <div>
              SHIP TO
              <strong>Guest User</strong>
            </div>
          </div>
          <div>
            ORDER # ${order.id}
          </div>
        </div>
        <div class="order-body">
          <div class="order-status ${order.status.toLowerCase()}">
            <h3>${order.status === 'Delivered' ? '✓ Delivered' : (order.status === 'Processing' ? '⏳ Processing' : '🚚 Shipped')}</h3>
            ${order.status === 'Delivered' ? `<p style="margin:0; font-size: 0.85rem; color: var(--muted);">Your package was left at the front door.</p>` : `
              <div class="progress-track">
                <div class="progress-fill"></div>
              </div>
            `}
          </div>
          <div class="order-items">
            ${order.items.map(item => `
              <div class="order-item" data-item-id="${item.id}">
                <div class="product-image" style="cursor:pointer"></div>
                <div class="order-item-details">
                  <h4 style="cursor:pointer">${item.name}</h4>
                  <p>Qty: ${item.qty} · ${money(item.price)}</p>
                  <div class="order-actions">
                    <button class="button button-ghost track-btn">Track package</button>
                    <button class="button button-ghost return-btn">Return item</button>
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `).join('');

    // Apply visual sprites
    pastOrders.forEach(order => {
      order.items.forEach(item => {
        // Need to query dynamically since same item could be in multiple orders
        const itemEls = container.querySelectorAll(`[data-item-id="${item.id}"]`);
        itemEls.forEach(el => {
          const img = el.querySelector('.product-image');
          if (!img.hasAttribute('data-sprite-applied')) {
            img.setAttribute('data-sprite-applied', 'true');
            applyVisual(img, { id: item.id, category: item.category });
            const navPDP = (e) => { e.preventDefault(); navWithParams(`./pdp.html?id=${item.id}`); };
            img.addEventListener('click', navPDP);
            el.querySelector('h4').addEventListener('click', navPDP);
          }
        });
      });
    });

    // Add toast interaction to buttons
    container.querySelectorAll('.track-btn, .return-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        toast('This is a demo UI. Real tracking/returns require a backend!');
      });
    });
  };

  const clearBtn = document.querySelector('#clearOrdersBtn');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      localStorage.removeItem('shopora-orders');
      pastOrders = [];
      renderOrders();
      toast('Order history cleared.');
    });
  }

  renderOrders();
}

function refreshCartViews() { if (currentPage === 'cart.html') renderCart(); if (currentPage === 'checkout.html') { location.reload(); } }
updateHeaderCounts(); initSearch(); initGlobalInteractions();
if (currentPage === 'index.html' || currentPage === '') renderHome();
if (currentPage === 'category.html') renderCatalog();
if (currentPage === 'cart.html') { renderCart(); renderRecommendations(); }
if (currentPage === 'checkout.html') renderCheckout();
if (currentPage === 'pdp.html') { renderPDP(); renderRecommendations(); }
if (currentPage === 'orders.html') initOrders();
window.addEventListener('storage', () => { Object.keys(cart).forEach((key) => delete cart[key]); Object.assign(cart, loadCart()); wishlist.clear(); loadJSON(WISHLIST_KEY, []).forEach((id) => wishlist.add(id)); updateHeaderCounts(); if (currentPage === 'cart.html') renderCart(); });
