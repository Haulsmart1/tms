import { z } from "zod";

/* Validates the top form to ensure a reference is present, schedule date is today or the future,
customer, vehicle and driver are selected, price is not a negative number,
with an optional subcontractor id and price check if they choose to use one */

export const JobPageValidation = z.object({
    reference: z.string().trim().min(1, "A reference is required."),
    scheduled_date: z.coerce.date()
        .refine((date) => {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            return date >= today;
        }, "Scheduled date cannot be in the past."),
    customer_id: z.string().trim().min(1, "Select a customer."),
    vehicle_id: z.string().trim().min(1, "Select a vehicle."),
    driver_id: z.string().trim().min(1, "Select a driver."),
    customer_price: z.preprocess(
        (val) => (val === "" ? undefined : val),
        z.coerce.number().nonnegative("Price cannot be negative."),
    ),
    subcontractor_id: z.string().trim().optional(), // Optional
    subcontractor_cost: z.preprocess(
        (val) => (val === "" ? undefined : val),
        z.coerce.number().nonnegative("Price cannot be negative."),
    ).optional(), // Optional 
})

// Validates the collection stop so that no fields are blank and whitespace is trimmed
export const CollectionStopValidation = z.object({
    type: z.literal("collection"),
    address_line: z.string().trim().min(1, "An address is required."),
    city: z.string().trim().min(1, "A city is required."),
    postcode: z.string().trim().min(1, "A postcode is required."),
})

// Validates the delivery stop so that no fields are blank and whitespace is trimmed
export const DeliveryStopValidation = z.object({
    type: z.literal("delivery"),
    address_line: z.string().trim().min(1, "An address is required."),
    city: z.string().trim().min(1, "A city is required."),
    postcode: z.string().trim().min(1, "A postcode is required."),
})