export const PUBLIC_CONTACT = {
  email: "support@tmswizard.com",
  phone: "0800 999 1263",
  phoneHref: "tel:08009991263",
  path: "/contact",
  thankYouPath: "/contact/thank-you",
} as const;

// The recipient is the published support address, not a credential or API key.
export const FORMSUBMIT_ACTION = `https://formsubmit.co/${PUBLIC_CONTACT.email}`;
export const FORMSUBMIT_AJAX = `https://formsubmit.co/ajax/${PUBLIC_CONTACT.email}`;

// Source policy PDFs retain their historical contact address. The user's
// official contact update applies to every displayed occurrence and mailto.
// This narrow presentation substitution does not rewrite the source contracts.
export function publicContactText(text: string): string {
  return text.replaceAll("it@silverlady.group", PUBLIC_CONTACT.email);
}
