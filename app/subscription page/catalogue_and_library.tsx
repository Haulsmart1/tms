// This page will be used to create a catalogue and library for the subscription page

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
        const response = await client.catalog.batchUpsert({
            idempotencyKey: randomUUID(),
            batches: [
                {
                    objects: [
                        {
                            type: "ITEM",
                            id: "#item",
                            itemData: {
                                name: "TMSWizzard Vehicle License",
                                productType: "DIGITAL",
                                taxIds: [
                                    "#TAX",
                                ]
                            }
                        },
                        {
                            type: "TAX",
                            id: "#TAX",
                            taxData: {
                                appliesToCustomAmounts: true,
                                enabled: true,
                                name: "Tax",
                                percentage: "10",
                            },
                        },
                    ],
                },
            ],
        });

        console.dir(response, { depth: null });
    } catch (err) {
        console.error("Square rejected the request:", err);
        process.exitCode = 1;
    }
}

main();
