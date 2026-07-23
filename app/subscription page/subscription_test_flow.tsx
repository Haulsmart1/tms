// Sandbox-only script: proves the full subscription flow end to end.
// Creates a test customer -> attaches a test card -> starts a subscription.
// Run: npx tsx --env-file=.env.local "app/subscription page/subscription_test_flow.tsx"

import { randomUUID } from "crypto";
import { SquareClient, SquareEnvironment } from "square";

const token = process.env.SQUARE_SANDBOX_TOKEN;
if (!token) {
    throw new Error("Missing SQUARE_SANDBOX_TOKEN environment variable");
}

// --- IDs from earlier steps (swap these when your catalog/location changes) ---
const LOCATION_ID = "LDDHMD9GZ9KFM";               // "Default Test Account" location
const PLAN_VARIATION_ID = "AKXI5FPNOIP4WCHMWTTYDTCL"; // the "Monthly" variation you created

// Square's sandbox test payment token. Stands in for the one the Web Payments
// SDK would produce in the browser in a real app. Sandbox-only -- never real cards.
const TEST_CARD_SOURCE_ID = "cnon:card-nonce-ok";

async function main() {
    const client = new SquareClient({
        token,
        environment: SquareEnvironment.Sandbox,
    });

    try {
        // 1. Create a customer.
        const customerRes = await client.customers.create({
            idempotencyKey: randomUUID(),
            givenName: "Test",
            familyName: "Driver",
            emailAddress: "test.driver@example.com",
        });
        const customerId = customerRes.customer?.id;
        if (!customerId) throw new Error("No customer id returned");
        console.log("customer:", customerId);

        // 2. Put a card on file for that customer (so Square can auto-charge).
        const cardRes = await client.cards.create({
            idempotencyKey: randomUUID(),
            sourceId: TEST_CARD_SOURCE_ID,
            card: {
                customerId,
            },
        });
        const cardId = cardRes.card?.id;
        if (!cardId) throw new Error("No card id returned");
        console.log("card:", cardId);

        // 3. Start the subscription: location + plan variation + customer + card.
        const subRes = await client.subscriptions.create({
            idempotencyKey: randomUUID(),
            locationId: LOCATION_ID,
            planVariationId: PLAN_VARIATION_ID,
            customerId,
            cardId,
        });

        console.log("subscription status:", subRes.subscription?.status);
        console.dir(subRes.subscription, { depth: null });
    } catch (err) {
        console.error("Square rejected the request:", err);
        process.exitCode = 1;
    }
}

main();
