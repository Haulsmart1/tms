import Stripe from "stripe";

let stripeClient: Stripe | null = null;

export function getStripe(): Stripe {
  if (typeof window !== "undefined") {
    throw new Error(
      "Stripe server client cannot be used in the browser."
    );
  }

  const secretKey =
    process.env.STRIPE_SECRET_KEY;

  if (!secretKey) {
    throw new Error(
      "STRIPE_SECRET_KEY is not configured."
    );
  }

  if (!secretKey.startsWith("sk_")) {
    throw new Error(
      "STRIPE_SECRET_KEY does not appear to be a Stripe secret key."
    );
  }

  if (!stripeClient) {
    stripeClient =
      new Stripe(secretKey);
  }

  return stripeClient;
}