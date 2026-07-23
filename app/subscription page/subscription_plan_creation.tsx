// This page will be used to create a subscription plan using the Square Catalog API
import { randomUUID } from "crypto";
import { SquareClient, SquareEnvironment } from "square";

const token = process.env.SQUARE_SANDBOX_TOKEN;
if (!token) {
    throw new Error("Missing SQUARE_SANDBOX_TOKEN environment variable");
}

async function main() {
    const client = new SquareClient({
        token,
        environment: SquareEnvironment.Sandbox,
    });

    try {
        // The plan and the variation go in the SAME batch, so that the
        // "#plan" temporary id below resolves to the real plan id.
        const response = await client.catalog.batchUpsert({
            idempotencyKey: randomUUID(),
            batches: [
                {
                    objects: [
                        {
                            type: "SUBSCRIPTION_PLAN",
                            id: "#plan",
                            subscriptionPlanData: {
                                name: "TMSWizzard Vehicle Plan",
                            },
                        },
                        {
                            type: "SUBSCRIPTION_PLAN_VARIATION",
                            id: "#plan_variation",
                            subscriptionPlanVariationData: {
                                name: "Monthly",
                                subscriptionPlanId: "#plan",
                                phases: [
                                    {
                                        cadence: "MONTHLY",
                                        ordinal: 0n,
                                        pricing: {
                                            type: "STATIC",
                                            priceMoney: { amount: 1000n, currency: "GBP" },
                                        },
                                    },
                                ],
                            },
                        },
                    ],
                },
            ],
        });

        // console.dir, not JSON.stringify -- the response contains bigints,
        // which JSON.stringify throws on.
        console.dir(response, { depth: null });
    } catch (err) {
        console.error("Square rejected the request:", err);
        process.exitCode = 1;
    }
}

main();
