import { describe, expect, it } from "vitest";
import { EnquirySchema, formSubmitPayload, formSubmitResult } from "./enquiry";
import { FORMSUBMIT_ACTION, FORMSUBMIT_AJAX, PUBLIC_CONTACT, publicContactText } from "./details";
import { allLegalDocuments } from "../legal/documents";
import { documentTexts, linkify, resolvePlaceholders } from "../legal/text";

const valid = {
  name: " Alex Operator ", company: " Example Haulage ", email: " alex@example.invalid ",
  phone: "", vehicles: "", enquiry: "Product enquiry", message: "Please explain the POD and invoicing workflow.",
};

describe("TMS enquiries", () => {
  it("accepts an enquiry without a telephone number or fleet size and trims contact fields", () => {
    expect(EnquirySchema.parse(valid)).toMatchObject({ name: "Alex Operator", email: "alex@example.invalid", vehicles: "", phone: "" });
  });

  it.each([
    { name: "   " }, { company: " " }, { email: "invalid-email" },
    { phone: "not a phone" }, { phone: "12" }, { vehicles: "0" },
    { vehicles: "-1" }, { vehicles: "1.5" }, { vehicles: "10001" },
    { enquiry: "<script>" }, { message: "short" }, { message: "x".repeat(5001) },
  ])("rejects malformed or oversized details before sending: %j", (changes) => {
    expect(EnquirySchema.safeParse({ ...valid, ...changes }).success).toBe(false);
  });

  it("accepts a formatted telephone number and a whole fleet count", () => {
    expect(EnquirySchema.safeParse({ ...valid, phone: "+44 (0)800 999 1263", vehicles: "24" }).success).toBe(true);
  });

  it("does not forward visitor-supplied provider configuration or CC addresses", () => {
    const enquiry = EnquirySchema.parse({ ...valid, _cc: "unwanted@example.invalid", _subject: "Changed" });
    const payload = formSubmitPayload(enquiry);
    expect(payload).not.toHaveProperty("_cc");
    expect(payload._subject).toBe("TMS Wizard website enquiry");
    expect(payload._next).toBe("https://tmswizard.cloud/contact/thank-you");
    expect(payload).not.toHaveProperty("_captcha");
  });

  it("uses the official recipient and documented endpoints", () => {
    expect(FORMSUBMIT_ACTION).toBe(`https://formsubmit.co/${PUBLIC_CONTACT.email}`);
    expect(FORMSUBMIT_AJAX).toBe(`https://formsubmit.co/ajax/${PUBLIC_CONTACT.email}`);
  });

  it.each([true, "true"])("accepts the provider's boolean/string success value: %j", (success) => {
    expect(formSubmitResult({ success, message: "Success! Form submitted successfully." })).toBe("submitted");
  });

  it.each([null, "true", {}, { success: false }, { success: "false" }, { success: "yes" }])("never treats an ambiguous or failed response as success: %j", (value) => {
    expect(formSubmitResult(value)).toBe("failed");
  });

  it("does not report first-use activation as a delivered enquiry", () => {
    expect(formSubmitResult({ success: "true", message: "Please check your email for activation." })).toBe("activation-required");
  });
});

describe("published contact consistency", () => {
  it("updates every rendered policy contact without altering source documents", () => {
    for (const document of allLegalDocuments()) {
      const source = documentTexts(document.content).join("\n");
      expect(source).toContain("it@silverlady.group");
      const displayed = publicContactText(resolvePlaceholders(source));
      expect(displayed).not.toContain("it@silverlady.group");
      expect(displayed).toContain(PUBLIC_CONTACT.email);
      expect(linkify(displayed, document.path).filter((part) => part.kind === "link").map((part) => part.kind === "link" ? part.href : "")).toContain(`mailto:${PUBLIC_CONTACT.email}`);
    }
  });
});
