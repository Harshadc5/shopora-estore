// Demo customer identity, hashed the way a retailer would before it reaches the page.
// The account id and salt stay in this file; only the hash is put on the page
// (data-customer-hash), and tag.js reports that hash, never an account number.

const DEMO_ACCOUNT_ID = 'CUST-100482';
const HASH_SALT = 'shopora-demo-salt';

// cyrb53: a fast 53-bit string hash (not cryptographic — fine for a demo identity).
function cyrb53(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

// Stable for the same customer on every visit; a guest never gets one.
export function demoCustomerHash() {
  return 'c_' + cyrb53(HASH_SALT + ':' + DEMO_ACCOUNT_ID).toString(16).padStart(14, '0');
}
