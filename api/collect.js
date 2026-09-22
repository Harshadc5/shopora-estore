import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

export default async function handler(req, res) {
  // Allow CORS from any origin
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method === 'POST') {
    try {
      // Depending on how the tag sends data (JSON vs text/plain),
      // req.body might already be parsed, or it might be a string.
      const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

      console.log('\n' + '═'.repeat(60));
      console.log(`📡 BEACON RECEIVED  [${new Date().toLocaleTimeString()}]`);
      console.log('═'.repeat(60));
      console.log(`📄 Page      : ${payload.page?.page_type?.toUpperCase()} — ${payload.page?.page_url}`);
      console.log(`🆔 Client    : ${payload.client_id}`);
      console.log(`🔑 Beacon ID : ${payload.beacon_id}`);
      console.log(`⏱  Timestamp : ${payload.ts || payload.timestamp}`);

      // Promo banners
      const banners = payload.signals?.promo_banners || [];
      console.log(`\n🏷  Promo Banners (${banners.length}):`);
      banners.forEach(b => console.log(`   [${b.surface}] "${b.text_scrubbed}" → ${b.claim_type}`));

      // Fulfillment offers
      const offers = payload.signals?.fulfillment_offers || [];
      console.log(`\n🚚 Fulfillment Offers (${offers.length}):`);
      offers.forEach(o => console.log(`   [${o.trigger_type}] "${o.text_scrubbed}" threshold: ${o.threshold_value_bucket}`));

      // Cart state
      const cart = payload.signals?.cart_state;
      if (cart) {
        console.log(`\n🛒 Cart State:`);
        console.log(`   Items: ${cart.item_count}  |  Subtotal: ${cart.subtotal}`);
        console.log(`   Promo field: ${cart.promo_field_present}  |  Shipping bar: ${cart.shipping_bar_shown}`);
      }

      // Product tiles
      const tiles = payload.signals?.tiles || [];
      console.log(`\n📦 Product Tiles Captured (${tiles.length}):`);
      tiles.slice(0, 10).forEach(t => {
        const markdown = t.has_markdown ? ` [MARKDOWN: ${t.old_price} → ${t.price}]` : '';
        console.log(`   #${t.position + 1} ${t.name}  ${t.price}${markdown}  badge: ${t.badge || '—'}  stock: ${t.in_stock ? '✓' : '✗'}`);
      });
      if (tiles.length > 10) console.log(`   ... and ${tiles.length - 10} more`);

      // DOM size
      const domSize = payload.dom ? Math.round(payload.dom.length / 1024) : 0;
      console.log(`\n🧩 DOM size  : ${domSize} KB (scrubbed)`);
      console.log('═'.repeat(60));

      // Save to Supabase database
      if (supabase) {
        // De-duplicate on beacon_id (page payloads) / flush_id (interaction-event
        // envelopes) — sendBeacon or its fetch fallback can occasionally deliver
        // the same payload twice; skip the repeat instead of storing it again.
        const dedupeId = payload.beacon_id || payload.flush_id || null;
        let isDuplicate = false;
        if (dedupeId) {
          const { data: existing, error: dupeError } = await supabase
            .from('events')
            .select('id')
            .or(`payload->>beacon_id.eq.${dedupeId},payload->>flush_id.eq.${dedupeId}`)
            .limit(1);
          if (dupeError) console.error('\n⚠️  Supabase dedupe check error:', dupeError.message);
          isDuplicate = !dupeError && existing && existing.length > 0;
        }

        if (isDuplicate) {
          console.log(`\n↩️  Duplicate beacon (${dedupeId}) — already stored, skipping insert.`);
        } else {
          // received_ts is the collector's own clock, stamped on arrival — kept
          // alongside the tag's own ts/timestamp, which reflects the visitor's
          // (not always trustworthy) device clock.
          const storedPayload = Object.assign({}, payload, { received_ts: new Date().toISOString() });
          const { error } = await supabase.from('events').insert([
            {
              client_id: payload.client_id,
              // The tag sends session_id (schema v3); older rows used session_token. The column name is unchanged.
              session_token: payload.session_id || payload.session_token || null,
              page_url: payload.page?.page_url || 'unknown',
              payload: storedPayload
            }
          ]);
          if (error) {
            console.error('\n⚠️  Supabase Insert Error:', error.message);
          } else {
            console.log('\n✅  Successfully saved to Supabase!');
          }
        }
      } else {
        console.log('\n⚠️  Supabase keys not found in Environment Variables. Skipping DB insert.');
      }

      return res.status(202).json({ status: 'accepted' });
    } catch (e) {
      console.error('\n⚠️  Could not parse payload:', e.message);
      return res.status(400).json({ error: 'Invalid payload' });
    }
  }

  return res.status(404).end();
}
