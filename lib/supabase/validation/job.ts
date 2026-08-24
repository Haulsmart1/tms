import { z } from "zod";

/*
 * Validates the top job form.
 * Optional monetary fields may be blank, but supplied values
 * must be valid non-negative numbers.
 */

const optionalNonNegativeNumber = (
    message: string,
) =>
    z.preprocess(
        (value) => {
            if (
                value === "" ||
                value === null ||
                value === undefined
            ) {
                return undefined;
            }

            return value;
        },
        z.coerce
            .number()
            .nonnegative(message)
            .optional(),
    );

export const JobPageValidation = z.object({
    reference: z
        .string()
        .trim()
        .min(1, "A reference is required."),

    scheduled_date: z.coerce
        .date()
        .refine(
            (date) => {
                const today = new Date();
                today.setHours(0, 0, 0, 0);

                return date >= today;
            },
            "Scheduled date cannot be in the past.",
        ),

    customer_id: z
        .string()
        .trim()
        .min(1, "Select a customer."),

    vehicle_id: z
        .string()
        .trim()
        .min(1, "Select a vehicle."),

    driver_id: z
        .string()
        .trim()
        .min(1, "Select a driver."),

    customer_price:
        optionalNonNegativeNumber(
            "Price cannot be negative.",
        ),

    subcontractor_id: z
        .string()
        .trim()
        .optional(),

    subcontractor_cost:
        optionalNonNegativeNumber(
            "Subcontractor cost cannot be negative.",
        ),
});

export const CollectionStopValidation = z.object({
    type: z.literal("collection"),

    address_line: z
        .string()
        .trim()
        .min(1, "An address is required."),

    city: z
        .string()
        .trim()
        .min(1, "A city is required."),

    postcode: z
        .string()
        .trim()
        .min(1, "A postcode is required."),
});

export const DeliveryStopValidation = z.object({
    type: z.literal("delivery"),

    address_line: z
        .string()
        .trim()
        .min(1, "An address is required."),

    city: z
        .string()
        .trim()
        .min(1, "A city is required."),

    postcode: z
        .string()
        .trim()
        .min(1, "A postcode is required."),
});