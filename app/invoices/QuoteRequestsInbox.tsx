"use client";

import {
  useCallback,
  useEffect,
  useState,
} from "react";

import Button from "../../components/Button";

export type QuoteRequestPrefill = {
  id: string;
  customerName: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  collectionAddress: string | null;
  collectionCity: string | null;
  collectionPostcode: string | null;
  deliveryAddress: string | null;
  deliveryCity: string | null;
  deliveryPostcode: string | null;
  requestedServiceDate: string | null;
  customerReference: string | null;
  poReference: string | null;
  description: string | null;
  quantity: number | null;
  notes: string | null;
};

type QuoteRequestRow = {
  id: string;
  source: string;
  status: string;
  customer_name: string | null;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  collection_address: string | null;
  collection_city: string | null;
  collection_postcode: string | null;
  delivery_address: string | null;
  delivery_city: string | null;
  delivery_postcode: string | null;
  requested_service_date: string | null;
  customer_reference: string | null;
  po_reference: string | null;
  description: string | null;
  quantity: number | string | null;
  notes: string | null;
  received_at: string;
};

type Props = {
  tenantId: string;

  onCreateQuotation: (
    request: QuoteRequestPrefill
  ) => void;
};

function location(
  address: string | null,
  city: string | null,
  postcode: string | null
): string {
  return [
    address,
    city,
    postcode,
  ]
    .filter(Boolean)
    .join(", ") || "—";
}

export default function QuoteRequestsInbox({
  tenantId,
  onCreateQuotation,
}: Props) {
  const [
    rows,
    setRows,
  ] = useState<QuoteRequestRow[]>(
    []
  );

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    workingId,
    setWorkingId,
  ] = useState("");

  const [
    error,
    setError,
  ] = useState("");

  const load =
    useCallback(
      async () => {
        setLoading(true);
        setError("");

        try {
          const response =
            await fetch(
              `/api/accounts/quote-requests?tenantId=${encodeURIComponent(
                tenantId
              )}`,
              {
                cache:
                  "no-store",
              }
            );

          const body =
            await response.json();

          if (
            !response.ok
          ) {
            throw new Error(
              body.error ||
                "Unable to load quote requests."
            );
          }

          setRows(
            body.quoteRequests ??
              []
          );
        }
        catch (loadError) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Unable to load quote requests."
          );
        }
        finally {
          setLoading(false);
        }
      },
      [
        tenantId,
      ]
    );

  useEffect(() => {
    void load();
  }, [
    load,
  ]);

  async function updateStatus(
    requestId: string,
    status: string
  ) {
    setWorkingId(
      requestId
    );

    setError("");

    try {
      const response =
        await fetch(
          "/api/accounts/quote-requests",
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
                requestId,
                status,
              }),
          }
        );

      const body =
        await response.json();

      if (
        !response.ok
      ) {
        throw new Error(
          body.error ||
            "Unable to update quote request."
        );
      }

      await load();
    }
    catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : "Unable to update quote request."
      );
    }
    finally {
      setWorkingId("");
    }
  }

  function createQuotation(
    row: QuoteRequestRow
  ) {
    onCreateQuotation({
      id:
        row.id,

      customerName:
        row.customer_name,

      contactName:
        row.contact_name,

      email:
        row.email,

      phone:
        row.phone,

      collectionAddress:
        row.collection_address,

      collectionCity:
        row.collection_city,

      collectionPostcode:
        row.collection_postcode,

      deliveryAddress:
        row.delivery_address,

      deliveryCity:
        row.delivery_city,

      deliveryPostcode:
        row.delivery_postcode,

      requestedServiceDate:
        row.requested_service_date,

      customerReference:
        row.customer_reference,

      poReference:
        row.po_reference,

      description:
        row.description,

      quantity:
        row.quantity == null
          ? null
          : Number(
              row.quantity
            ),

      notes:
        row.notes,
    });

    void updateStatus(
      row.id,
      "reviewing"
    );
  }

  return (
    <div className="mt-4 rounded-lg border border-line bg-surface-2 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="m-0 text-md font-semibold text-ink">
            Quote Requests
          </h3>

          <p className="mb-0 mt-1 text-sm text-ink-3">
            Website and form enquiries waiting to be quoted.
          </p>
        </div>

        <Button
          type="button"
          variant="secondary"
          disabled={
            loading
          }
          onClick={() =>
            void load()
          }
        >
          Refresh Requests
        </Button>
      </div>

      {error ? (
        <div className="mt-3 rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink">
          {error}
        </div>
      ) : null}

      {loading ? (
        <p className="mt-4 text-sm text-ink-3">
          Loading quote requests...
        </p>
      ) : rows.length === 0 ? (
        <p className="mt-4 text-sm text-ink-3">
          No new quote requests.
        </p>
      ) : (
        <div className="mt-4 grid gap-3">
          {rows.map(
            (
              row
            ) => (
              <article
                key={
                  row.id
                }
                className="rounded-lg border border-line bg-surface p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <strong className="text-ink">
                      {row.customer_name ||
                        row.contact_name ||
                        "Website enquiry"}
                    </strong>

                    <div className="mt-1 text-sm text-ink-3">
                      {row.contact_name ||
                        "No contact name"}
                      {row.email
                        ? ` · ${row.email}`
                        : ""}
                    </div>
                  </div>

                  <span className="rounded-full border border-line px-2 py-1 text-xs font-semibold capitalize text-ink">
                    {row.status}
                  </span>
                </div>

                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div>
                    <div className="text-xs font-semibold uppercase text-ink-3">
                      Collection
                    </div>

                    <div className="mt-1 text-sm text-ink">
                      {location(
                        row.collection_address,
                        row.collection_city,
                        row.collection_postcode
                      )}
                    </div>
                  </div>

                  <div>
                    <div className="text-xs font-semibold uppercase text-ink-3">
                      Delivery
                    </div>

                    <div className="mt-1 text-sm text-ink">
                      {location(
                        row.delivery_address,
                        row.delivery_city,
                        row.delivery_postcode
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <strong>Date:</strong>{" "}
                    {row.requested_service_date ||
                      "—"}
                  </div>

                  <div>
                    <strong>Reference:</strong>{" "}
                    {row.customer_reference ||
                      "—"}
                  </div>

                  <div>
                    <strong>PO:</strong>{" "}
                    {row.po_reference ||
                      "—"}
                  </div>

                  <div>
                    <strong>Qty:</strong>{" "}
                    {row.quantity ??
                      "—"}
                  </div>
                </div>

                {row.description ? (
                  <p className="mb-0 mt-3 text-sm text-ink">
                    {row.description}
                  </p>
                ) : null}

                {row.notes ? (
                  <p className="mb-0 mt-2 text-sm text-ink-3">
                    {row.notes}
                  </p>
                ) : null}

                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    disabled={
                      workingId ===
                      row.id
                    }
                    onClick={() =>
                      createQuotation(
                        row
                      )
                    }
                  >
                    Create Quotation
                  </Button>

                  <Button
                    type="button"
                    variant="secondary"
                    disabled={
                      workingId ===
                      row.id
                    }
                    onClick={() =>
                      void updateStatus(
                        row.id,
                        "rejected"
                      )
                    }
                  >
                    Reject
                  </Button>
                </div>
              </article>
            )
          )}
        </div>
      )}
    </div>
  );
}