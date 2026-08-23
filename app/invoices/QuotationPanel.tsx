"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Button from "../../components/Button";
import QuoteRequestsInbox, { type QuoteRequestPrefill } from "./QuoteRequestsInbox";

type Customer = {
  id: string;
  name: string;
  vat_rate: number | null;
};

type QuickCustomerDraft = {
  name: string;
  contactName: string;
  email: string;
  phone: string;
  accountsEmail: string;
  vatRate: string;
};

type QuoteLine = {
  id: string;
  line_number: number;
  description: string;
  quantity: number;
  unit_price: number;
  vat_rate: number;
  line_subtotal: number;
  line_vat: number;
  line_total: number;
};

type QuoteStop = {
  id: string;
  stop_order: number;
  type: "collection" | "delivery";
  address_line: string;
  city: string | null;
  postcode: string | null;
  recipient_name: string | null;
  contact_phone: string | null;
  notes: string | null;
};

type Quotation = {
  id: string;
  customer_id: string;
  quote_number: string;
  status: string;
  quote_date: string;
  valid_until: string | null;
  proposed_service_date: string | null;
  customer_reference: string | null;
  po_reference: string | null;
  currency_code: string;
  subtotal: number;
  vat_total: number;
  total: number;
  notes: string | null;
  terms: string | null;
  converted_job_id: string | null;
  converted_at: string | null;
  customers?: {
    id: string;
    name: string;
  } | null;
  quotation_lines: QuoteLine[];
  quotation_stops: QuoteStop[];
};

type DocumentBranding = {
  companyProfile: {
    company_name: string | null;
    trading_name: string | null;
    registration_number: string | null;
    vat_number: string | null;
    business_email: string | null;
    business_phone: string | null;
    website: string | null;
    address_line_1: string | null;
    address_line_2: string | null;
    city: string | null;
    region: string | null;
    postcode: string | null;
    country_code: string | null;
  } | null;

  documentSettings: {
    logo_path: string | null;
    logo_signed_url: string | null;
    footer_text: string | null;
    bank_details: string | null;
    generic_document_note: string | null;
    show_logo: boolean;
    show_company_registration: boolean;
    show_vat_number: boolean;
    show_contact_details: boolean;
  } | null;

  quotationTemplate: {
    heading: string | null;
    intro_text: string | null;
    footer_text: string | null;
    show_company_registration: boolean;
    show_vat_number: boolean;
    show_route_details: boolean;
    show_line_vat: boolean;
  } | null;
};
type LineDraft = {
  description: string;
  quantity: string;
  unitPrice: string;
  vatRate: string;
};

type StopDraft = {
  type: "collection" | "delivery";
  addressLine: string;
  city: string;
  postcode: string;
  recipientName: string;
  contactPhone: string;
  notes: string;
};

const today = () => new Date().toISOString().slice(0, 10);

function addDays(date: string, days: number) {
  const result = new Date(`${date}T12:00:00`);
  result.setDate(result.getDate() + days);
  return result.toISOString().slice(0, 10);
}

function money(value: number, currency = "GBP") {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
  }).format(Number(value || 0));
}

function emptyLine(vatRate = 20): LineDraft {
  return {
    description: "Transport service",
    quantity: "1",
    unitPrice: "",
    vatRate: String(vatRate),
  };
}

function emptyStop(
  type: "collection" | "delivery"
): StopDraft {
  return {
    type,
    addressLine: "",
    city: "",
    postcode: "",
    recipientName: "",
    contactPhone: "",
    notes: "",
  };
}

export default function QuotationPanel({
  tenantId,
  customers,
}: {
  tenantId: string;
  customers: Customer[];
}) {
  const [availableCustomers, setAvailableCustomers] =
    useState<Customer[]>(customers);

  const [showQuickCustomer, setShowQuickCustomer] =
    useState(false);

  const [creatingCustomer, setCreatingCustomer] =
    useState(false);

  const [quickCustomer, setQuickCustomer] =
    useState<QuickCustomerDraft>({
      name: "",
      contactName: "",
      email: "",
      phone: "",
      accountsEmail: "",
      vatRate: "20",
    });

  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [preview, setPreview] = useState<Quotation | null>(null);
  const [activeQuoteRequestId, setActiveQuoteRequestId] = useState("");

  const [
    editingQuotation,
    setEditingQuotation,
  ] =
    useState<Quotation | null>(
      null
    );

  const [branding, setBranding] =
    useState<DocumentBranding | null>(null);

  const [customerId, setCustomerId] = useState("");
  const [quoteDate, setQuoteDate] = useState(today());
  const [validUntil, setValidUntil] = useState(addDays(today(), 14));
  const [serviceDate, setServiceDate] = useState("");
  const [customerReference, setCustomerReference] = useState("");
  const [poReference, setPoReference] = useState("");
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState(
    "Quotation valid for 14 days from date of issue."
  );

  const [lines, setLines] = useState<LineDraft[]>([
    emptyLine(),
  ]);

  const [stops, setStops] = useState<StopDraft[]>([
    emptyStop("collection"),
    emptyStop("delivery"),
  ]);

  const selectedCustomer = availableCustomers.find(
    (customer) => customer.id === customerId
  );

  const totals = useMemo(() => {
    return lines.reduce(
      (result, line) => {
        const quantity = Number(line.quantity || 0);
        const unitPrice = Number(line.unitPrice || 0);
        const vatRate = Number(line.vatRate || 0);

        const subtotal = quantity * unitPrice;
        const vat = subtotal * (vatRate / 100);

        result.subtotal += subtotal;
        result.vat += vat;
        result.total += subtotal + vat;

        return result;
      },
      {
        subtotal: 0,
        vat: 0,
        total: 0,
      }
    );
  }, [lines]);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage("");

    try {
      const response = await fetch(
        `/api/accounts/quotations?tenantId=${encodeURIComponent(
          tenantId
        )}`,
        {
          cache: "no-store",
        }
      );

      const body = await response.json();

      if (!response.ok) {
        throw new Error(
          body.error || "Unable to load quotations."
        );
      }

      setQuotations(body.quotations ?? []);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to load quotations."
      );
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;

    async function loadBranding() {
      try {
        const response = await fetch(
          `/api/settings/documents?tenantId=${encodeURIComponent(
            tenantId
          )}`,
          {
            cache: "no-store",
          }
        );

        const body = await response.json();

        if (!response.ok) {
          throw new Error(
            body.error ||
              "Unable to load document branding."
          );
        }

        if (!cancelled) {
          setBranding(body);
        }
      }
      catch (brandingError) {
        console.error(
          "Unable to load document branding",
          brandingError
        );
      }
    }

    void loadBranding();

    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  function populateFromQuoteRequest(
    request: QuoteRequestPrefill
  ) {
    const matchedCustomer =
      availableCustomers.find(
        (customer) =>
          request.customerName &&
          customer.name
            .trim()
            .toLowerCase() ===
            request.customerName
              .trim()
              .toLowerCase()
      );

    setActiveQuoteRequestId(
      request.id
    );

    setCustomerId(
      matchedCustomer?.id ??
        ""
    );

    setServiceDate(
      request.requestedServiceDate ??
        ""
    );

    setCustomerReference(
      request.customerReference ??
        ""
    );

    setPoReference(
      request.poReference ??
        ""
    );

    setNotes(
      [
        request.notes,
        request.contactName
          ? `Contact: ${request.contactName}`
          : null,
        request.email
          ? `Email: ${request.email}`
          : null,
        request.phone
          ? `Phone: ${request.phone}`
          : null,
      ]
        .filter(Boolean)
        .join("\n")
    );

    setLines([
      {
        description:
          request.description ||
          "Transport service",

        quantity:
          String(
            request.quantity ??
              1
          ),

        unitPrice:
          "",

        vatRate:
          String(
            matchedCustomer?.vat_rate ??
              20
          ),
      },
    ]);

    setStops([
      {
        type:
          "collection",

        addressLine:
          request.collectionAddress ??
          "",

        city:
          request.collectionCity ??
          "",

        postcode:
          request.collectionPostcode ??
          "",

        recipientName:
          request.contactName ??
          "",

        contactPhone:
          request.phone ??
          "",

        notes:
          "",
      },
      {
        type:
          "delivery",

        addressLine:
          request.deliveryAddress ??
          "",

        city:
          request.deliveryCity ??
          "",

        postcode:
          request.deliveryPostcode ??
          "",

        recipientName:
          "",

        contactPhone:
          "",

        notes:
          "",
      },
    ]);

    setShowForm(
      true
    );

    setPreview(
      null
    );

    if (
      matchedCustomer
    ) {
      setMessage(
        `Quote request loaded. Customer matched to ${matchedCustomer.name}. Review pricing before creating the quotation.`
      );
    }
    else {
      setQuickCustomer({
        name:
          request.customerName ??
          "",

        contactName:
          request.contactName ??
          "",

        email:
          request.email ??
          "",

        phone:
          request.phone ??
          "",

        accountsEmail:
          "",

        vatRate:
          "20",
      });

      setShowQuickCustomer(
        true
      );

      setMessage(
        `Quote request loaded for ${request.customerName || "new customer"}. Create the customer below, then review pricing.`
      );
    }

    window.setTimeout(
      () => {
        document
          .getElementById(
            "new-quotation-form"
          )
          ?.scrollIntoView({
            behavior:
              "smooth",

            block:
              "start",
          });
      },
      50
    );
  }
  function resetForm() {
    const date = today();

    setActiveQuoteRequestId("");
    setCustomerId("");
    setQuoteDate(date);
    setValidUntil(addDays(date, 14));
    setServiceDate("");
    setCustomerReference("");
    setPoReference("");
    setNotes("");
    setTerms("Quotation valid for 14 days from date of issue.");
    setLines([emptyLine()]);
    setStops([
      emptyStop("collection"),
      emptyStop("delivery"),
    ]);
  }

  function updateLine(
    index: number,
    field: keyof LineDraft,
    value: string
  ) {
    setLines((current) =>
      current.map((line, lineIndex) =>
        lineIndex === index
          ? {
              ...line,
              [field]: value,
            }
          : line
      )
    );
  }

  function updateStop(
    index: number,
    field: keyof StopDraft,
    value: string
  ) {
    setStops((current) =>
      current.map((stop, stopIndex) =>
        stopIndex === index
          ? {
              ...stop,
              [field]: value,
            }
          : stop
      )
    );
  }

  function updateQuickCustomer(
    field: keyof QuickCustomerDraft,
    value: string
  ) {
    setQuickCustomer((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function closeQuickCustomer() {
    setShowQuickCustomer(false);

    setQuickCustomer({
      name: "",
      contactName: "",
      email: "",
      phone: "",
      accountsEmail: "",
      vatRate: "20",
    });
  }

  async function createQuickCustomer() {
    const name =
      quickCustomer.name.trim();

    if (!name) {
      setMessage(
        "Customer name is required."
      );
      return;
    }

    const vatRate =
      Number(
        quickCustomer.vatRate ||
          20
      );

    if (
      !Number.isFinite(vatRate) ||
      vatRate < 0
    ) {
      setMessage(
        "Customer VAT rate is invalid."
      );
      return;
    }

    setCreatingCustomer(true);
    setMessage("");

    try {
      const response =
        await fetch(
          "/api/customers",
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                name,

                contact_name:
                  quickCustomer.contactName.trim() ||
                  null,

                email:
                  quickCustomer.email.trim() ||
                  null,

                phone:
                  quickCustomer.phone.trim() ||
                  null,

                accounts_email:
                  quickCustomer.accountsEmail.trim() ||
                  null,

                vat_rate:
                  vatRate,

                active:
                  true,

                payment_terms_days:
                  30,

                currency_code:
                  "GBP",

                country_code:
                  "GB",
              }),
          }
        );

      const body =
        await response.json();

      if (!response.ok) {
        throw new Error(
          body.error ||
            "Unable to create customer."
        );
      }

      const created =
        body.customer as
          | {
              id?: string;
              name?: string;
              vat_rate?: number | null;
            }
          | undefined;

      if (
        !created?.id ||
        !created.name
      ) {
        throw new Error(
          "Customer was created but an invalid response was returned."
        );
      }

      const newCustomer:
        Customer = {
        id:
          created.id,

        name:
          created.name,

        vat_rate:
          created.vat_rate ??
          vatRate,
      };

      setAvailableCustomers(
        (current) => {
          const withoutDuplicate =
            current.filter(
              (customer) =>
                customer.id !==
                newCustomer.id
            );

          return [
            ...withoutDuplicate,
            newCustomer,
          ].sort(
            (
              left,
              right
            ) =>
              left.name.localeCompare(
                right.name
              )
          );
        }
      );

      setCustomerId(
        newCustomer.id
      );

      setLines((current) =>
        current.map(
          (line) => ({
            ...line,

            vatRate:
              String(
                newCustomer.vat_rate ??
                  vatRate
              ),
          })
        )
      );

      setShowQuickCustomer(
        false
      );

      setQuickCustomer({
        name: "",
        contactName: "",
        email: "",
        phone: "",
        accountsEmail: "",
        vatRate: "20",
      });

      setMessage(
        `${newCustomer.name} created and selected.`
      );
    }
    catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to create customer."
      );
    }
    finally {
      setCreatingCustomer(
        false
      );
    }
  }
  function openNewQuotation() {
    setEditingQuotation(null);
    setPreview(null);
    resetForm();
    setShowForm(true);
    setMessage("");

    window.setTimeout(
      () => {
        document
          .getElementById(
            "new-quotation-form"
          )
          ?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
      },
      0
    );
  }

  function startEditQuotation(
    quotation: Quotation
  ) {
    if (
      quotation.converted_job_id
    ) {
      setMessage(
        "Converted quotations cannot be edited."
      );
      return;
    }

    if (
      ![
        "draft",
        "sent",
      ].includes(
        quotation.status
      )
    ) {
      setMessage(
        "Only draft or sent quotations can be edited."
      );
      return;
    }

    setEditingQuotation(
      quotation
    );

    setPreview(null);

    setCustomerId(
      quotation.customer_id
    );

    setQuoteDate(
      quotation.quote_date
    );

    setValidUntil(
      quotation.valid_until ??
        ""
    );

    setServiceDate(
      quotation
        .proposed_service_date ??
        ""
    );

    setCustomerReference(
      quotation
        .customer_reference ??
        ""
    );

    setPoReference(
      quotation.po_reference ??
        ""
    );

    setNotes(
      quotation.notes ?? ""
    );

    setTerms(
      quotation.terms ?? ""
    );

    const nextLines =
      [
        ...(
          quotation
            .quotation_lines ??
          []
        ),
      ]
        .sort(
          (a, b) =>
            a.line_number -
            b.line_number
        )
        .map(
          (line) => ({
            description:
              line.description,

            quantity:
              String(
                line.quantity
              ),

            unitPrice:
              String(
                line.unit_price
              ),

            vatRate:
              String(
                line.vat_rate
              ),
          })
        );

    setLines(
      nextLines.length > 0
        ? nextLines
        : [
            emptyLine(),
          ]
    );

    const nextStops =
      [
        ...(
          quotation
            .quotation_stops ??
          []
        ),
      ]
        .sort(
          (a, b) =>
            a.stop_order -
            b.stop_order
        )
        .map(
          (stop) => ({
            type:
              stop.type,

            addressLine:
              stop.address_line,

            city:
              stop.city ?? "",

            postcode:
              stop.postcode ??
              "",

            recipientName:
              stop.recipient_name ??
              "",

            contactPhone:
              stop.contact_phone ??
              "",

            notes:
              stop.notes ?? "",
          })
        );

    setStops(
      nextStops.length > 0
        ? nextStops
        : [
            emptyStop(
              "collection"
            ),
            emptyStop(
              "delivery"
            ),
          ]
    );

    setShowForm(true);
    setMessage(
      `Editing ${quotation.quote_number}.`
    );

    window.setTimeout(
      () => {
        document
          .getElementById(
            "new-quotation-form"
          )
          ?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
      },
      0
    );
  }

  function cancelEditQuotation() {
    setEditingQuotation(null);
    resetForm();
    setShowForm(false);
    setMessage(
      "Quotation edit cancelled."
    );
  }

  async function saveQuotation() {
    if (!editingQuotation) {
      return;
    }

    if (!customerId) {
      setMessage(
        "Choose a customer."
      );
      return;
    }

    if (
      lines.some(
        (line) =>
          !line.description.trim()
      )
    ) {
      setMessage(
        "Every quotation line requires a description."
      );
      return;
    }

    if (
      lines.some(
        (line) =>
          Number(
            line.quantity
          ) <= 0 ||
          Number(
            line.unitPrice
          ) < 0
      )
    ) {
      setMessage(
        "Check quotation quantities and prices."
      );
      return;
    }

    if (
      stops.some(
        (stop) =>
          !stop.addressLine.trim()
      )
    ) {
      setMessage(
        "Every quotation stop requires an address."
      );
      return;
    }

    setWorking(true);
    setMessage("");

    try {
      const response =
        await fetch(
          "/api/accounts/quotations",
          {
            method:
              "PATCH",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                tenantId,

                quotationId:
                  editingQuotation.id,

                customerId,

                quoteDate,

                validUntil:
                  validUntil ||
                  null,

                proposedServiceDate:
                  serviceDate ||
                  null,

                customerReference:
                  customerReference
                    .trim() ||
                  null,

                poReference:
                  poReference
                    .trim() ||
                  null,

                notes:
                  notes.trim() ||
                  null,

                terms:
                  terms.trim() ||
                  null,

                lines:
                  lines.map(
                    (line) => ({
                      description:
                        line.description.trim(),

                      quantity:
                        Number(
                          line.quantity
                        ),

                      unitPrice:
                        Number(
                          line.unitPrice
                        ),

                      vatRate:
                        Number(
                          line.vatRate
                        ),
                    })
                  ),

                stops:
                  stops.map(
                    (stop) => ({
                      type:
                        stop.type,

                      addressLine:
                        stop.addressLine.trim(),

                      city:
                        stop.city.trim() ||
                        null,

                      postcode:
                        stop.postcode
                          .trim()
                          .toUpperCase() ||
                        null,

                      recipientName:
                        stop.recipientName
                          .trim() ||
                        null,

                      contactPhone:
                        stop.contactPhone
                          .trim() ||
                        null,

                      notes:
                        stop.notes.trim() ||
                        null,
                    })
                  ),
              }),
          }
        );

      const body =
        await response.json();

      if (!response.ok) {
        throw new Error(
          body.error ||
            "Unable to save quotation."
        );
      }

      const savedNumber =
        body.quotation
          ?.quote_number ||
        editingQuotation
          .quote_number;

      setEditingQuotation(
        null
      );

      resetForm();
      setShowForm(false);

      setMessage(
        `${savedNumber} saved successfully.`
      );

      await load();
    }
    catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to save quotation."
      );
    }
    finally {
      setWorking(false);
    }
  }
  async function createQuotation() {
    if (!customerId) {
      setMessage("Choose a customer.");
      return;
    }

    if (lines.some((line) => !line.description.trim())) {
      setMessage("Every quotation line requires a description.");
      return;
    }

    if (
      lines.some(
        (line) =>
          Number(line.quantity) <= 0 ||
          Number(line.unitPrice) < 0
      )
    ) {
      setMessage("Check quotation quantities and prices.");
      return;
    }

    if (stops.some((stop) => !stop.addressLine.trim())) {
      setMessage("Every quotation stop requires an address.");
      return;
    }

    setWorking(true);
    setMessage("");

    try {
      const response = await fetch(
        "/api/accounts/quotations",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            tenantId,
            customerId,
            quoteDate,
            validUntil: validUntil || null,
            proposedServiceDate: serviceDate || null,
            customerReference:
              customerReference.trim() || null,
            poReference: poReference.trim() || null,
            notes: notes.trim() || null,
            terms: terms.trim() || null,

            lines: lines.map((line) => ({
              description: line.description.trim(),
              quantity: Number(line.quantity),
              unitPrice: Number(line.unitPrice),
              vatRate: Number(line.vatRate),
            })),

            stops: stops.map((stop) => ({
              type: stop.type,
              addressLine: stop.addressLine.trim(),
              city: stop.city.trim() || null,
              postcode:
                stop.postcode.trim().toUpperCase() || null,
              recipientName:
                stop.recipientName.trim() || null,
              contactPhone:
                stop.contactPhone.trim() || null,
              notes: stop.notes.trim() || null,
            })),
          }),
        }
      );

      const body = await response.json();

      if (!response.ok) {
        throw new Error(
          body.error || "Unable to create quotation."
        );
      }

      if (
        activeQuoteRequestId &&
        body.quotation?.id
      ) {
        const requestResponse =
          await fetch(
            "/api/accounts/quote-requests",
            {
              method: "PATCH",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                tenantId,
                requestId:
                  activeQuoteRequestId,
                status:
                  "converted",
                quotationId:
                  body.quotation.id,
              }),
            }
          );

        const requestBody =
          await requestResponse.json();

        if (!requestResponse.ok) {
          throw new Error(
            requestBody.error ||
              "Quotation created but quote request could not be linked."
          );
        }
      }

      setMessage(
        `${body.quotation?.quote_number || "Quotation"} created.`
      );

      resetForm();
      setShowForm(false);
      await load();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to create quotation."
      );
    } finally {
      setWorking(false);
    }
  }

  async function setStatus(
    quotation: Quotation,
    status: string
  ) {
    setWorking(true);
    setMessage("");

    try {
      const response = await fetch(
        "/api/accounts/quotations",
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            tenantId,
            quotationId: quotation.id,
            status,
          }),
        }
      );

      const body = await response.json();

      if (!response.ok) {
        throw new Error(
          body.error || "Unable to update quotation."
        );
      }

      setMessage(
        `${quotation.quote_number} marked ${status}.`
      );

      setPreview(null);
      await load();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to update quotation."
      );
    } finally {
      setWorking(false);
    }
  }

  async function emailQuotation(
    quotation: Quotation
  ) {
    if (
      !window.confirm(
        `Email ${
          quotation.quote_number ||
          "this quotation"
        } with PDF and secure acceptance link?`
      )
    ) {
      return;
    }

    setWorking(true);
    setMessage("");

    try {
      const response = await fetch(
        `/api/accounts/quotations/${quotation.id}/email`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            tenantId,
          }),
        }
      );

      const body = (await response.json()) as {
        ok?: boolean;
        recipient?: string;
        quoteNumber?: string;
        shareUrl?: string;
        deliveryLogId?: string;
        id?: string | null;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(
          body.error ||
          "Unable to email quotation."
        );
      }

      const acknowledgement =
        body.id
          ? ` Microsoft 365 acknowledgement: ${body.id}.`
          : "";

      setMessage(
        `${
          body.quoteNumber ||
          quotation.quote_number
        } emailed to ${
          body.recipient ||
          "the customer"
        }. PDF and secure acceptance link included.${acknowledgement}`
      );

      await load();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to email quotation."
      );
    } finally {
      setWorking(false);
    }
  }
  async function copyShareLink(quotation: Quotation) {
    setWorking(true);
    setMessage("");

    try {
      const response = await fetch(
        `/api/accounts/quotations/${quotation.id}/share`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            tenantId,
          }),
        }
      );

      const body = await response.json();

      if (!response.ok) {
        throw new Error(
          body.error || "Unable to create quotation share link."
        );
      }

      const shareUrl =
        typeof body.shareUrl === "string"
          ? body.shareUrl.trim()
          : "";

      if (!shareUrl) {
        throw new Error(
          "Quotation share API did not return a share URL."
        );
      }

      let copied = false;

      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(shareUrl);
          copied = true;
        }
      } catch (clipboardError) {
        console.warn(
          "Modern clipboard API failed:",
          clipboardError
        );
      }

      if (!copied) {
        try {
          const textarea =
            document.createElement("textarea");

          textarea.value = shareUrl;
          textarea.setAttribute("readonly", "");
          textarea.style.position = "fixed";
          textarea.style.opacity = "0";
          textarea.style.pointerEvents = "none";

          document.body.appendChild(textarea);

          textarea.focus();
          textarea.select();
          textarea.setSelectionRange(
            0,
            textarea.value.length
          );

          copied =
            document.execCommand("copy");

          document.body.removeChild(textarea);
        } catch (fallbackError) {
          console.warn(
            "Clipboard fallback failed:",
            fallbackError
          );

          copied = false;
        }
      }

      if (copied) {
        setMessage(
          `${quotation.quote_number} share link copied to clipboard.`
        );
      } else {
        setMessage(
          `${quotation.quote_number} share link created.`
        );
      }

      window.prompt(
        "Quotation share link - Ctrl+C to copy:",
        shareUrl
      );

      await load();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to copy quotation share link."
      );
    } finally {
      setWorking(false);
    }
  }
  async function convertToJob(quotation: Quotation) {
    if (
      !window.confirm(
        `Convert ${quotation.quote_number} into a live Job?`
      )
    ) {
      return;
    }

    setWorking(true);
    setMessage("");

    try {
      const response = await fetch(
        `/api/accounts/quotations/${quotation.id}/convert`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            tenantId,
          }),
        }
      );

      const body = await response.json();

      if (!response.ok) {
        throw new Error(
          body.error || "Unable to convert quotation to Job."
        );
      }

      setMessage(
        `${quotation.quote_number} converted to Job successfully.`
      );

      setPreview(null);
      await load();

      if (
        body.jobUrl &&
        window.confirm("Open the new Job now?")
      ) {
        window.location.href = body.jobUrl;
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to convert quotation to Job."
      );
    } finally {
      setWorking(false);
    }
  }

  return (
    <section className="rounded-lg border border-line bg-surface p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="m-0 text-md font-semibold text-ink">
            Quotations
          </h2>

          <p className="mt-1 text-sm text-ink-3">
            Build customer quotations and convert accepted work
            directly into Jobs.
          </p>
        </div>

        <Button
          type="button"
          onClick={() => {
            if (
              editingQuotation
            ) {
              cancelEditQuotation();
              return;
            }

            if (showForm) {
              resetForm();
              setShowForm(false);
              return;
            }

            openNewQuotation();
          }}
        >
          {editingQuotation
            ? "Cancel Edit"
            : showForm
              ? "Close New Quote"
              : "New Quotation"}
        </Button>
      </div>

      {message ? (
        <div className="mt-3 rounded-md border border-line bg-surface-2 px-3 py-2 text-sm text-ink">
          {message}
        </div>
      ) : null}

      <QuoteRequestsInbox
        tenantId={tenantId}
        onCreateQuotation={populateFromQuoteRequest}
      />
      {showForm ? (
        <div id="new-quotation-form" className="mt-4 rounded-lg border border-line bg-surface-2 p-4">
          <h3 className="m-0 mb-3 text-md font-semibold text-ink">
            {editingQuotation
              ? `Edit ${editingQuotation.quote_number}`
              : "New Quotation"}
          </h3>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <Field label="Customer">
              <select
                className="control"
                value={customerId}
                onChange={(event) => {
                  const id =
                    event.target.value;

                  if (
                    id ===
                    "__new_customer__"
                  ) {
                    setCustomerId(
                      ""
                    );

                    setShowQuickCustomer(
                      true
                    );

                    return;
                  }

                  setCustomerId(
                    id
                  );

                  setShowQuickCustomer(
                    false
                  );

                  const customer =
                    availableCustomers.find(
                      (item) =>
                        item.id ===
                        id
                    );

                  if (
                    customer?.vat_rate !=
                    null
                  ) {
                    setLines(
                      (current) =>
                        current.map(
                          (line) => ({
                            ...line,

                            vatRate:
                              String(
                                customer.vat_rate
                              ),
                          })
                        )
                    );
                  }
                }}
              >
                <option value="">
                  Choose customer
                </option>

                <option value="__new_customer__">
                  + Add New Customer
                </option>

                {availableCustomers.map((customer) => (
                  <option
                    key={customer.id}
                    value={customer.id}
                  >
                    {customer.name}
                  </option>
                ))}
              </select>
            </Field>

            {showQuickCustomer ? (
              <div className="rounded-lg border border-line bg-surface p-4 md:col-span-2 xl:col-span-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h4 className="m-0 text-sm font-semibold text-ink">
                      Add New Customer
                    </h4>

                    <p className="mb-0 mt-1 text-sm text-ink-3">
                      Create the customer without leaving this quotation.
                    </p>
                  </div>

                  <Button
                    type="button"
                    variant="secondary"
                    disabled={creatingCustomer}
                    onClick={closeQuickCustomer}
                  >
                    Cancel
                  </Button>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <Field label="Customer Name">
                    <input
                      className="control"
                      value={quickCustomer.name}
                      onChange={(event) =>
                        updateQuickCustomer(
                          "name",
                          event.target.value
                        )
                      }
                      placeholder="Company or customer name"
                    />
                  </Field>

                  <Field label="Contact Name">
                    <input
                      className="control"
                      value={quickCustomer.contactName}
                      onChange={(event) =>
                        updateQuickCustomer(
                          "contactName",
                          event.target.value
                        )
                      }
                      placeholder="Contact name"
                    />
                  </Field>

                  <Field label="Email">
                    <input
                      className="control"
                      type="email"
                      value={quickCustomer.email}
                      onChange={(event) =>
                        updateQuickCustomer(
                          "email",
                          event.target.value
                        )
                      }
                      placeholder="customer@example.com"
                    />
                  </Field>

                  <Field label="Telephone">
                    <input
                      className="control"
                      value={quickCustomer.phone}
                      onChange={(event) =>
                        updateQuickCustomer(
                          "phone",
                          event.target.value
                        )
                      }
                      placeholder="Telephone"
                    />
                  </Field>

                  <Field label="Accounts Email">
                    <input
                      className="control"
                      type="email"
                      value={quickCustomer.accountsEmail}
                      onChange={(event) =>
                        updateQuickCustomer(
                          "accountsEmail",
                          event.target.value
                        )
                      }
                      placeholder="accounts@example.com"
                    />
                  </Field>

                  <Field label="VAT Rate (%)">
                    <input
                      className="control"
                      type="number"
                      min="0"
                      step="0.01"
                      value={quickCustomer.vatRate}
                      onChange={(event) =>
                        updateQuickCustomer(
                          "vatRate",
                          event.target.value
                        )
                      }
                    />
                  </Field>
                </div>

                <div className="mt-4">
                  <Button
                    type="button"
                    disabled={creatingCustomer}
                    onClick={() =>
                      void createQuickCustomer()
                    }
                  >
                    {creatingCustomer
                      ? "Creating Customer..."
                      : "Create & Select Customer"}
                  </Button>
                </div>
              </div>
            ) : null}

            <Field label="Quote Date">
              <input
                type="date"
                className="control"
                value={quoteDate}
                onChange={(event) =>
                  setQuoteDate(event.target.value)
                }
              />
            </Field>

            <Field label="Valid Until">
              <input
                type="date"
                className="control"
                value={validUntil}
                onChange={(event) =>
                  setValidUntil(event.target.value)
                }
              />
            </Field>

            <Field label="Proposed Service Date">
              <input
                type="date"
                className="control"
                value={serviceDate}
                onChange={(event) =>
                  setServiceDate(event.target.value)
                }
              />
            </Field>

            <Field label="Customer Reference">
              <input
                className="control"
                value={customerReference}
                onChange={(event) =>
                  setCustomerReference(event.target.value)
                }
              />
            </Field>

            <Field label="PO Reference">
              <input
                className="control"
                value={poReference}
                onChange={(event) =>
                  setPoReference(event.target.value)
                }
              />
            </Field>
          </div>

          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between gap-3">
              <h4 className="m-0 text-sm font-semibold text-ink">
                Charge Lines
              </h4>

              <Button
                type="button"
                variant="secondary"
                onClick={() =>
                  setLines((current) => [
                    ...current,
                    emptyLine(
                      selectedCustomer?.vat_rate ?? 20
                    ),
                  ])
                }
              >
                Add Line
              </Button>
            </div>

            <div className="grid gap-3">
              {lines.map((line, index) => {
                const net =
                  Number(line.quantity || 0) *
                  Number(line.unitPrice || 0);

                return (
                  <div
                    key={index}
                    className="grid gap-2 rounded-md border border-line bg-surface p-3 lg:grid-cols-[2fr_100px_140px_100px_140px_auto]"
                  >
                    <input
                      className="control"
                      placeholder="Description"
                      value={line.description}
                      onChange={(event) =>
                        updateLine(
                          index,
                          "description",
                          event.target.value
                        )
                      }
                    />

                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      className="control"
                      value={line.quantity}
                      onChange={(event) =>
                        updateLine(
                          index,
                          "quantity",
                          event.target.value
                        )
                      }
                    />

                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      className="control"
                      placeholder="Unit price"
                      value={line.unitPrice}
                      onChange={(event) =>
                        updateLine(
                          index,
                          "unitPrice",
                          event.target.value
                        )
                      }
                    />

                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      className="control"
                      value={line.vatRate}
                      onChange={(event) =>
                        updateLine(
                          index,
                          "vatRate",
                          event.target.value
                        )
                      }
                    />

                    <div className="flex min-h-10 items-center justify-end font-mono text-sm text-ink">
                      {money(net)}
                    </div>

                    <Button
                      type="button"
                      variant="secondary"
                      disabled={lines.length === 1}
                      onClick={() =>
                        setLines((current) =>
                          current.filter(
                            (_, lineIndex) =>
                              lineIndex !== index
                          )
                        )
                      }
                    >
                      Remove
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-5">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
              <h4 className="m-0 text-sm font-semibold text-ink">
                Collection / Delivery Stops
              </h4>

              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() =>
                    setStops((current) => [
                      ...current,
                      emptyStop("collection"),
                    ])
                  }
                >
                  Add Collection
                </Button>

                <Button
                  type="button"
                  variant="secondary"
                  onClick={() =>
                    setStops((current) => [
                      ...current,
                      emptyStop("delivery"),
                    ])
                  }
                >
                  Add Delivery
                </Button>
              </div>
            </div>

            <div className="grid gap-3">
              {stops.map((stop, index) => (
                <div
                  key={index}
                  className="rounded-md border border-line bg-surface p-3"
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <strong className="capitalize text-sm text-ink">
                      {index + 1}. {stop.type}
                    </strong>

                    <Button
                      type="button"
                      variant="secondary"
                      disabled={stops.length === 1}
                      onClick={() =>
                        setStops((current) =>
                          current.filter(
                            (_, stopIndex) =>
                              stopIndex !== index
                          )
                        )
                      }
                    >
                      Remove
                    </Button>
                  </div>

                  <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                    <select
                      className="control"
                      value={stop.type}
                      onChange={(event) =>
                        updateStop(
                          index,
                          "type",
                          event.target.value
                        )
                      }
                    >
                      <option value="collection">
                        Collection
                      </option>
                      <option value="delivery">
                        Delivery
                      </option>
                    </select>

                    <input
                      className="control xl:col-span-2"
                      placeholder="Address"
                      value={stop.addressLine}
                      onChange={(event) =>
                        updateStop(
                          index,
                          "addressLine",
                          event.target.value
                        )
                      }
                    />

                    <input
                      className="control"
                      placeholder="City"
                      value={stop.city}
                      onChange={(event) =>
                        updateStop(
                          index,
                          "city",
                          event.target.value
                        )
                      }
                    />

                    <input
                      className="control"
                      placeholder="Postcode"
                      value={stop.postcode}
                      onChange={(event) =>
                        updateStop(
                          index,
                          "postcode",
                          event.target.value.toUpperCase()
                        )
                      }
                    />

                    <input
                      className="control"
                      placeholder="Recipient"
                      value={stop.recipientName}
                      onChange={(event) =>
                        updateStop(
                          index,
                          "recipientName",
                          event.target.value
                        )
                      }
                    />

                    <input
                      className="control"
                      placeholder="Telephone"
                      value={stop.contactPhone}
                      onChange={(event) =>
                        updateStop(
                          index,
                          "contactPhone",
                          event.target.value
                        )
                      }
                    />

                    <input
                      className="control md:col-span-2"
                      placeholder="Stop notes"
                      value={stop.notes}
                      onChange={(event) =>
                        updateStop(
                          index,
                          "notes",
                          event.target.value
                        )
                      }
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2">
            <Field label="Notes">
              <textarea
                className="min-h-24 rounded-md border border-ink-3 bg-surface px-3 py-2 text-base text-ink"
                value={notes}
                onChange={(event) =>
                  setNotes(event.target.value)
                }
              />
            </Field>

            <Field label="Terms">
              <textarea
                className="min-h-24 rounded-md border border-ink-3 bg-surface px-3 py-2 text-base text-ink"
                value={terms}
                onChange={(event) =>
                  setTerms(event.target.value)
                }
              />
            </Field>
          </div>

          <div className="mt-5 ml-auto grid max-w-sm gap-2 rounded-md border border-line bg-surface p-3">
            <TotalRow
              label="Subtotal"
              value={money(totals.subtotal)}
            />
            <TotalRow
              label="VAT"
              value={money(totals.vat)}
            />
            <TotalRow
              label="Total"
              value={money(totals.total)}
              strong
            />
          </div>

          <div className="mt-4 flex flex-wrap justify-end gap-2">
            {editingQuotation ? (
              <Button
                type="button"
                variant="secondary"
                disabled={working}
                onClick={() =>
                  cancelEditQuotation()
                }
              >
                Cancel
              </Button>
            ) : null}

            <Button
              type="button"
              disabled={working}
              onClick={() =>
                void (
                  editingQuotation
                    ? saveQuotation()
                    : createQuotation()
                )
              }
            >
              {working
                ? editingQuotation
                  ? "Saving..."
                  : "Creating..."
                : editingQuotation
                  ? "Save Changes"
                  : "Create Quotation"}
            </Button>
          </div>
        </div>
      ) : null}

      {preview ? (
        <article
          id="quotation-preview"
          className="mt-4 rounded-lg border border-line bg-white p-6 text-slate-950 shadow-sm"
        >
          {branding ? (
            <div
              data-document-branding="quotation"
              className="mb-5 border-b border-slate-200 pb-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-5">
                <div className="flex min-w-0 items-start gap-4">
                  {branding.documentSettings?.show_logo &&
                  branding.documentSettings?.logo_signed_url ? (
                    <img
                      src={
                        branding.documentSettings
                          .logo_signed_url
                      }
                      alt={`${branding.companyProfile?.company_name || branding.companyProfile?.trading_name || "Company"} logo`}
                      className="max-h-20 max-w-48 shrink-0 object-contain"
                    />
                  ) : null}

                  {branding.companyProfile ? (
                    <div className="min-w-0">
                      <div className="text-xl font-bold text-slate-950">
                        {branding.companyProfile.company_name ||
                          branding.companyProfile.trading_name ||
                          "Company"}
                      </div>

                    {[
                      branding.companyProfile.address_line_1,
                      branding.companyProfile.address_line_2,
                      branding.companyProfile.city,
                      branding.companyProfile.region,
                      branding.companyProfile.postcode,
                      branding.companyProfile.country_code,
                    ].filter(Boolean).length > 0 ? (
                      <div className="mt-1 max-w-lg text-sm leading-5 text-slate-600">
                        {[
                          branding.companyProfile.address_line_1,
                          branding.companyProfile.address_line_2,
                          branding.companyProfile.city,
                          branding.companyProfile.region,
                          branding.companyProfile.postcode,
                          branding.companyProfile.country_code,
                        ]
                          .filter(Boolean)
                          .join(", ")}
                      </div>
                    ) : null}

                    {branding.documentSettings
                      ?.show_contact_details ? (
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                        {branding.companyProfile.business_phone ? (
                          <span>
                            Tel:{" "}
                            {
                              branding.companyProfile
                                .business_phone
                            }
                          </span>
                        ) : null}

                        {branding.companyProfile.business_email ? (
                          <span>
                            Email:{" "}
                            {
                              branding.companyProfile
                                .business_email
                            }
                          </span>
                        ) : null}

                        {branding.companyProfile.website ? (
                          <span>
                            {
                              branding.companyProfile
                                .website
                            }
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                    </div>
                  ) : null}
                </div>

                {branding.companyProfile ? (
                  <div className="text-right text-xs leading-5 text-slate-600">
                  {branding.documentSettings
                    ?.show_company_registration &&
                  branding.quotationTemplate
                    ?.show_company_registration !== false &&
                  branding.companyProfile
                    .registration_number ? (
                    <div>
                      Company No:{" "}
                      {
                        branding.companyProfile
                          .registration_number
                      }
                    </div>
                  ) : null}

                  {branding.documentSettings
                    ?.show_vat_number &&
                  branding.quotationTemplate
                    ?.show_vat_number !== false &&
                  branding.companyProfile.vat_number ? (
                    <div>
                      VAT No:{" "}
                      {
                        branding.companyProfile
                          .vat_number
                      }
                    </div>
                  ) : null}
                  </div>
                ) : null}
              </div>

              {branding.quotationTemplate?.intro_text ? (
                <div className="mt-4 whitespace-pre-wrap text-sm text-slate-700">
                  {branding.quotationTemplate.intro_text}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4">
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
                {branding?.quotationTemplate?.heading ||
                  "Quotation"}
              </div>

              <h3 className="m-0 mt-1 text-2xl font-bold">
                {preview.quote_number}
              </h3>

              <div className="mt-1 text-sm text-slate-600">
                {preview.customers?.name || "Customer"}
              </div>
            </div>

            <div className="flex flex-wrap gap-2 print:hidden">
              <Button
                type="button"
                variant="secondary"
                onClick={() => window.print()}
              >
                Print / Save PDF
              </Button>

              <Button
                type="button"
                variant="secondary"
                onClick={() => setPreview(null)}
              >
                Close
              </Button>
            </div>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <PreviewInfo
                label="Quote date"
                value={preview.quote_date}
              />
              <PreviewInfo
                label="Valid until"
                value={preview.valid_until || "—"}
              />
              <PreviewInfo
                label="Proposed service"
                value={
                  preview.proposed_service_date || "—"
                }
              />
            </div>

            <div>
              <PreviewInfo
                label="Customer reference"
                value={
                  preview.customer_reference || "—"
                }
              />
              <PreviewInfo
                label="PO reference"
                value={preview.po_reference || "—"}
              />
              <PreviewInfo
                label="Status"
                value={preview.status}
              />
            </div>
          </div>

          <div className="mt-5">
            <h4 className="text-sm font-bold uppercase text-slate-500">
              Route
            </h4>

            <div className="grid gap-2">
              {[...preview.quotation_stops]
                .sort(
                  (a, b) =>
                    a.stop_order - b.stop_order
                )
                .map((stop) => (
                  <div
                    key={stop.id}
                    className="rounded-md border border-slate-200 p-3 text-sm"
                  >
                    <strong className="capitalize">
                      {stop.stop_order}. {stop.type}
                    </strong>

                    <div>
                      {[
                        stop.address_line,
                        stop.city,
                        stop.postcode,
                      ]
                        .filter(Boolean)
                        .join(", ")}
                    </div>
                  </div>
                ))}
            </div>
          </div>

          <div className="mt-5 overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="border-b border-slate-300 px-2 py-2 text-left">
                    Description
                  </th>
                  <th className="border-b border-slate-300 px-2 py-2 text-right">
                    Qty
                  </th>
                  <th className="border-b border-slate-300 px-2 py-2 text-right">
                    Rate
                  </th>
                  <th className="border-b border-slate-300 px-2 py-2 text-right">
                    VAT
                  </th>
                  <th className="border-b border-slate-300 px-2 py-2 text-right">
                    Total
                  </th>
                </tr>
              </thead>

              <tbody>
                {[...preview.quotation_lines]
                  .sort(
                    (a, b) =>
                      a.line_number - b.line_number
                  )
                  .map((line) => (
                    <tr key={line.id}>
                      <td className="border-b border-slate-200 px-2 py-3">
                        {line.description}
                      </td>
                      <td className="border-b border-slate-200 px-2 py-3 text-right">
                        {line.quantity}
                      </td>
                      <td className="border-b border-slate-200 px-2 py-3 text-right">
                        {money(
                          line.unit_price,
                          preview.currency_code
                        )}
                      </td>
                      <td className="border-b border-slate-200 px-2 py-3 text-right">
                        {line.vat_rate}%
                      </td>
                      <td className="border-b border-slate-200 px-2 py-3 text-right font-semibold">
                        {money(
                          line.line_total,
                          preview.currency_code
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          <div className="ml-auto mt-5 grid max-w-sm gap-2">
            <TotalRow
              label="Subtotal"
              value={money(
                preview.subtotal,
                preview.currency_code
              )}
            />
            <TotalRow
              label="VAT"
              value={money(
                preview.vat_total,
                preview.currency_code
              )}
            />
            <TotalRow
              label="Total"
              value={money(
                preview.total,
                preview.currency_code
              )}
              strong
            />
          </div>

          {preview.notes ? (
            <div className="mt-5 text-sm">
              <strong>Notes:</strong> {preview.notes}
            </div>
          ) : null}

          {preview.terms ? (
            <div className="mt-3 text-sm">
              <strong>Terms:</strong> {preview.terms}
            </div>
          ) : null}

          {branding?.documentSettings
            ?.generic_document_note ? (
            <div className="mt-4 whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-xs text-slate-600">
              {
                branding.documentSettings
                  .generic_document_note
              }
            </div>
          ) : null}

          {branding?.documentSettings?.footer_text ||
          branding?.quotationTemplate?.footer_text ? (
            <footer
              data-document-footer="quotation"
              className="mt-6 border-t border-slate-200 pt-4 text-center text-xs leading-5 text-slate-500"
            >
              <div className="whitespace-pre-wrap">
                {branding.documentSettings?.footer_text}
              </div>

              {branding.quotationTemplate?.footer_text ? (
                <div className="mt-1 whitespace-pre-wrap">
                  {branding.quotationTemplate.footer_text}
                </div>
              ) : null}
            </footer>
          ) : null}
        </article>
      ) : null}

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {loading ? (
          <p className="col-span-full py-8 text-center text-sm text-ink-3">
            Loading quotations...
          </p>
        ) : quotations.length === 0 ? (
          <p className="col-span-full py-8 text-center text-sm text-ink-3">
            No quotations yet.
          </p>
        ) : (
          quotations.map((quotation) => {
            const converted =
              Boolean(quotation.converted_job_id);

            return (
              <article
                key={quotation.id}
                className="rounded-lg border border-line bg-surface-2 p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <strong className="font-mono text-sm text-ink">
                      {quotation.quote_number}
                    </strong>

                    <div className="text-sm text-ink-3">
                      {quotation.customers?.name ||
                        "Customer"}
                    </div>
                  </div>

                  <span className="rounded-full border border-line px-2 py-1 text-xs font-semibold capitalize text-ink">
                    {quotation.status}
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <PreviewInfo
                    label="Quote date"
                    value={quotation.quote_date}
                  />
                  <PreviewInfo
                    label="Valid until"
                    value={
                      quotation.valid_until || "—"
                    }
                  />
                  <PreviewInfo
                    label="Total"
                    value={money(
                      quotation.total,
                      quotation.currency_code
                    )}
                  />
                  <PreviewInfo
                    label="Stops"
                    value={String(
                      quotation.quotation_stops?.length ?? 0
                    )}
                  />
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setPreview(quotation)}
                  >
                    Preview
                  </Button>

                  <Button
                    type="button"
                    variant="secondary"
                    disabled={working}
                    onClick={() =>
                      void copyShareLink(quotation)
                    }
                  >
                    Copy Share Link
                  </Button>

                  <Button
                    type="button"
                    variant="secondary"
                    disabled={working}
                    onClick={() =>
                      void emailQuotation(quotation)
                    }
                  >
                    {working
                      ? "Working..."
                      : "Email Quotation"}
                  </Button>

                  {["draft", "sent"].includes(
                    quotation.status
                  ) &&
                  !quotation.converted_job_id ? (
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={working}
                      onClick={() =>
                        startEditQuotation(
                          quotation
                        )
                      }
                    >
                      Edit
                    </Button>
                  ) : null}

                  {quotation.status === "draft" ? (
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={working}
                      onClick={() =>
                        void setStatus(
                          quotation,
                          "sent"
                        )
                      }
                    >
                      Mark Sent
                    </Button>
                  ) : null}

                  {["draft", "sent"].includes(
                    quotation.status
                  ) ? (
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={working}
                      onClick={() =>
                        void setStatus(
                          quotation,
                          "accepted"
                        )
                      }
                    >
                      Accept
                    </Button>
                  ) : null}

                  {["draft", "sent"].includes(
                    quotation.status
                  ) ? (
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={working}
                      onClick={() =>
                        void setStatus(
                          quotation,
                          "declined"
                        )
                      }
                    >
                      Decline
                    </Button>
                  ) : null}

                  {quotation.status === "accepted" &&
                  !converted ? (
                    <Button
                      type="button"
                      disabled={working}
                      onClick={() =>
                        void convertToJob(quotation)
                      }
                    >
                      Convert to Job
                    </Button>
                  ) : null}

                  {converted ? (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => {
                        window.location.href =
                          `/jobs?job=${encodeURIComponent(
                            String(
                              quotation.converted_job_id
                            )
                          )}`;
                      }}
                    >
                      View Job
                    </Button>
                  ) : null}
                </div>
              </article>
            );
          })
        )}
      </div>

      <style jsx>{`
        .control {
          height: 2.5rem;
          width: 100%;
          min-width: 0;
          border-radius: 0.375rem;
          border: 1px solid var(--ink-3);
          background: var(--surface);
          padding: 0 0.75rem;
          font-size: 1rem;
          color: var(--ink);
        }
      `}</style>
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-sm font-medium text-ink-2">
        {label}
      </span>
      {children}
    </label>
  );
}

function TotalRow({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div
      className={`flex justify-between gap-4 ${
        strong
          ? "border-t border-current pt-2 text-lg font-bold"
          : ""
      }`}
    >
      <span>{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}

function PreviewInfo({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase text-slate-500">
        {label}
      </div>
      <div className="capitalize">{value}</div>
    </div>
  );
}