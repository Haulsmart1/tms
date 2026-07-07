import { z } from "zod";

const JobPageValidation = z.object({
    reference: z.string().trim().min(1, "A reference is required"),
    scheduled_date: z.date()
        .refine((date) => {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            return date >= today;
        }, "Date must be today or in the future")
})