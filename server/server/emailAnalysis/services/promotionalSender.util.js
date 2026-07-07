/**
 * Promotional/bulk-sender detection — shared by prioritization and junk
 * rescue so marketplace blasts, newsletters and offer mails are always kept
 * at Low priority, even when their copy uses urgent-sounding keywords
 * ("IMPORTANT: your order", "URGENT: sale ends tonight", …).
 */

// Well-known shopping / marketplace / consumer-service domains that only ever
// send the user bulk mail (orders, offers, recommendations).
const PROMO_DOMAINS = [
  "flipkart",
  "amazon",
  "myntra",
  "ajio",
  "meesho",
  "snapdeal",
  "shopsy",
  "tatacliq",
  "croma",
  "reliancedigital",
  "jiomart",
  "bigbasket",
  "blinkit",
  "zepto",
  "swiggy",
  "zomato",
  "dominos",
  "nykaa",
  "purplle",
  "paytm",
  "phonepe",
  "mobikwik",
  "makemytrip",
  "goibibo",
  "cleartrip",
  "ixigo",
  "redbus",
  "olacabs",
  "uber",
  "bookmyshow",
  "lenskart",
  "firstcry",
  "pepperfry",
  "urbanladder",
  "oyorooms",
  "airbnb",
  "aliexpress",
  "ebay",
  "walmart",
  "temu",
  "shein",
];

// Bulk-mailer local parts / mailbox names typical of newsletters & campaigns.
const PROMO_MAILBOX_RE =
  /^(newsletter|newsletters|news|promo|promotions?|offers?|deals?|marketing|mailer|campaign|digest|sale|sales-?blast|bulletin)\b/i;

// Bulk-mail sending platforms (whatever brand is behind them, it's a blast).
const PROMO_ESP_RE =
  /@(?:[a-z0-9-]+\.)?(mailchimp|sendgrid|mailgun|sendinblue|brevo|klaviyo|braze|mailerlite|campaign-?monitor|constantcontact|substack|beehiiv)\./i;

/** Pull the bare address out of a `Name <addr@host>` from-header. */
function extractAddress(from = "") {
  const match = String(from).match(/<([^>]+)>/);
  const addr = (match ? match[1] : String(from)).trim().toLowerCase();
  return addr.includes("@") ? addr : "";
}

/**
 * True when the from-header looks like a promotional / newsletter / bulk
 * sender rather than a person or a transactional business contact.
 */
export function isPromotionalSender(from = "") {
  const addr = extractAddress(from);
  if (!addr) return false;
  const [mailbox, domain] = addr.split("@");

  if (PROMO_MAILBOX_RE.test(mailbox)) return true;
  if (PROMO_ESP_RE.test(`@${domain}.`)) return true;

  const domainParts = domain.split(".");
  return PROMO_DOMAINS.some((d) => domainParts.some((part) => part === d || part.startsWith(`${d}-`)));
}

export default { isPromotionalSender };
