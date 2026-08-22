import {
  createHash,
} from "crypto";

const MAX_STRING_LENGTH = 4000;
const MAX_RAW_STRING_LENGTH = 8000;

export type PublicQuoteRequestPayload =
  Record<string, unknown>;

function firstValue(
  payload: PublicQuoteRequestPayload,
  keys: string[]
): unknown {
  for (const key of keys) {
    const value =
      payload[key];

    if (
      value !== undefined &&
      value !== null &&
      String(value).trim() !== ""
    ) {
      return value;
    }
  }

  return null;
}

export function cleanString(
  value: unknown,
  maxLength = MAX_STRING_LENGTH
): string | null {
  if (
    value === undefined ||
    value === null
  ) {
    return null;
  }

  const cleaned =
    String(value)
      .replace(/\u0000/g, "")
      .trim();

  if (!cleaned) {
    return null;
  }

  return cleaned.slice(
    0,
    maxLength
  );
}

function cleanPostcode(
  value: unknown
): string | null {
  const result =
    cleanString(
      value,
      32
    );

  return result
    ? result.toUpperCase()
    : null;
}

function cleanEmail(
  value: unknown
): string | null {
  const result =
    cleanString(
      value,
      320
    );

  if (!result) {
    return null;
  }

  const emailPattern =
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  return emailPattern.test(
    result
  )
    ? result
    : null;
}

function cleanDate(
  value: unknown
): string | null {
  const result =
    cleanString(
      value,
      32
    );

  if (!result) {
    return null;
  }

  const isoMatch =
    result.match(
      /^(\d{4})-(\d{2})-(\d{2})$/
    );

  if (!isoMatch) {
    return null;
  }

  const parsed =
    new Date(
      `${result}T12:00:00Z`
    );

  if (
    Number.isNaN(
      parsed.getTime()
    )
  ) {
    return null;
  }

  return result;
}

function cleanQuantity(
  value: unknown
): number | null {
  if (
    value === undefined ||
    value === null ||
    String(value).trim() === ""
  ) {
    return null;
  }

  const quantity =
    Number(value);

  if (
    !Number.isFinite(quantity) ||
    quantity <= 0
  ) {
    return null;
  }

  return Math.min(
    quantity,
    1000000
  );
}

export function hashQuoteRequestToken(
  token: string
): string {
  return createHash(
    "sha256"
  )
    .update(
      token,
      "utf8"
    )
    .digest(
      "hex"
    );
}

export function normaliseQuoteRequest(
  payload: PublicQuoteRequestPayload
) {
  const customerName =
    cleanString(
      firstValue(
        payload,
        [
          "customer_name",
          "company_name",
          "company",
          "business_name",
          "organisation",
          "organization",
        ]
      ),
      250
    );

  const contactName =
    cleanString(
      firstValue(
        payload,
        [
          "contact_name",
          "contact",
          "full_name",
          "your_name",
          "name",
        ]
      ),
      250
    );

  const email =
    cleanEmail(
      firstValue(
        payload,
        [
          "email",
          "contact_email",
          "your_email",
        ]
      )
    );

  const phone =
    cleanString(
      firstValue(
        payload,
        [
          "phone",
          "telephone",
          "tel",
          "mobile",
          "contact_phone",
        ]
      ),
      100
    );

  const accountsEmail =
    cleanEmail(
      firstValue(
        payload,
        [
          "accounts_email",
          "billing_email",
          "invoice_email",
        ]
      )
    );

  const collectionAddress =
    cleanString(
      firstValue(
        payload,
        [
          "collection_address",
          "pickup_address",
          "pick_up_address",
          "collection",
          "pickup",
          "from_address",
          "from",
        ]
      )
    );

  const collectionCity =
    cleanString(
      firstValue(
        payload,
        [
          "collection_city",
          "pickup_city",
          "from_city",
        ]
      ),
      250
    );

  const collectionPostcode =
    cleanPostcode(
      firstValue(
        payload,
        [
          "collection_postcode",
          "pickup_postcode",
          "pickup_zip",
          "from_postcode",
          "from_zip",
        ]
      )
    );

  const deliveryAddress =
    cleanString(
      firstValue(
        payload,
        [
          "delivery_address",
          "dropoff_address",
          "drop_off_address",
          "delivery",
          "dropoff",
          "to_address",
          "to",
        ]
      )
    );

  const deliveryCity =
    cleanString(
      firstValue(
        payload,
        [
          "delivery_city",
          "dropoff_city",
          "to_city",
        ]
      ),
      250
    );

  const deliveryPostcode =
    cleanPostcode(
      firstValue(
        payload,
        [
          "delivery_postcode",
          "dropoff_postcode",
          "delivery_zip",
          "to_postcode",
          "to_zip",
        ]
      )
    );

  const requestedServiceDate =
    cleanDate(
      firstValue(
        payload,
        [
          "requested_service_date",
          "service_date",
          "collection_date",
          "pickup_date",
          "date",
        ]
      )
    );

  const customerReference =
    cleanString(
      firstValue(
        payload,
        [
          "customer_reference",
          "reference",
          "job_reference",
          "job_ref",
          "booking_reference",
        ]
      ),
      250
    );

  const poReference =
    cleanString(
      firstValue(
        payload,
        [
          "po_reference",
          "po_number",
          "purchase_order",
          "purchase_order_number",
          "po",
        ]
      ),
      250
    );

  const description =
    cleanString(
      firstValue(
        payload,
        [
          "description",
          "goods",
          "goods_description",
          "load_description",
          "consignment",
          "service_required",
        ]
      )
    );

  const quantity =
    cleanQuantity(
      firstValue(
        payload,
        [
          "quantity",
          "qty",
          "pallets",
          "pallet_count",
          "units",
        ]
      )
    );

  const notes =
    cleanString(
      firstValue(
        payload,
        [
          "notes",
          "message",
          "comments",
          "additional_information",
          "additional_info",
        ]
      ),
      8000
    );

  return {
    customer_name:
      customerName,

    contact_name:
      contactName,

    email,

    phone,

    accounts_email:
      accountsEmail,

    collection_address:
      collectionAddress,

    collection_city:
      collectionCity,

    collection_postcode:
      collectionPostcode,

    delivery_address:
      deliveryAddress,

    delivery_city:
      deliveryCity,

    delivery_postcode:
      deliveryPostcode,

    requested_service_date:
      requestedServiceDate,

    customer_reference:
      customerReference,

    po_reference:
      poReference,

    description,

    quantity,

    notes,
  };
}

export function hasUsefulQuoteRequestData(
  normalised: ReturnType<
    typeof normaliseQuoteRequest
  >
): boolean {
  return Boolean(
    normalised.customer_name ||
    normalised.contact_name ||
    normalised.email ||
    normalised.phone ||
    normalised.collection_address ||
    normalised.collection_postcode ||
    normalised.delivery_address ||
    normalised.delivery_postcode ||
    normalised.description ||
    normalised.notes
  );
}

export function safeRawPayload(
  payload: PublicQuoteRequestPayload
): Record<string, unknown> {
  const entries =
    Object.entries(payload)
      .slice(
        0,
        100
      )
      .map(
        (
          [
            key,
            value,
          ]
        ) => {
          const safeKey =
            String(key)
              .slice(
                0,
                200
              );

          if (
            value === null ||
            value === undefined
          ) {
            return [
              safeKey,
              null,
            ];
          }

          if (
            typeof value ===
            "number" ||
            typeof value ===
            "boolean"
          ) {
            return [
              safeKey,
              value,
            ];
          }

          return [
            safeKey,
            String(value)
              .replace(
                /\u0000/g,
                ""
              )
              .slice(
                0,
                MAX_RAW_STRING_LENGTH
              ),
          ];
        }
      );

  return Object.fromEntries(
    entries
  );
}