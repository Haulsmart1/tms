import { NextRequest, NextResponse } from "next/server";

import {
  errorResponse,
  requireTenantAccess,
} from "../../../../lib/accounts/server";

export const dynamic = "force-dynamic";

type CreditLineInput = {
  invoiceLineId: string;
  quantity: number;
};

type InvoiceLineRow = {
  id: string;
  job_id: string | null;
  description: string;
  quantity: number | string;
  unit_price: number | string;
  vat_rate: number | string;
};

type CalculatedCreditLine = {
  invoice_line_id: string;
  job_id: string | null;
  description: string;
  quantity: number;
  unit_price: number;
  vat_rate: number;
  net_amount: number;
  vat_amount: number;
  gross_amount: number;
};

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function parseCreditLines(value: unknown): CreditLineInput[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((row) => {
      if (!row || typeof row !== "object") {
        return null;
      }

      const raw = row as Record<string, unknown>;
      const invoiceLineId = String(raw.invoiceLineId ?? "").trim();
      const quantity = Number(raw.quantity ?? 0);

      if (!invoiceLineId || !Number.isFinite(quantity)) {
        return null;
      }

      return {
        invoiceLineId,
        quantity,
      };
    })
    .filter((row): row is CreditLineInput => row !== null);
}

async function getExistingAllocatedTotal(
  admin: Awaited<ReturnType<typeof requireTenantAccess>>["admin"],
  tenantId: string,
  invoiceId: string,
  excludeCreditNoteId?: string
): Promise<number> {
  let query = admin
    .from("credit_note_allocations")
    .select("credit_note_id,amount")
    .eq("tenant_id", tenantId)
    .eq("invoice_id", invoiceId);

  if (excludeCreditNoteId) {
    query = query.neq("credit_note_id", excludeCreditNoteId);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return roundMoney(
    (data ?? []).reduce(
      (sum, allocation) => sum + Number(allocation.amount ?? 0),
      0
    )
  );
}

async function calculateCreditLines(
  admin: Awaited<ReturnType<typeof requireTenantAccess>>["admin"],
  tenantId: string,
  invoiceId: string,
  requestedLines: CreditLineInput[],
  excludeCreditNoteId?: string
): Promise<{
  lines: CalculatedCreditLine[];
  subtotal: number;
  vatTotal: number;
  total: number;
}> {
  if (requestedLines.length === 0) {
    throw new Error("Add at least one credit-note line.");
  }

  const requestedIds = Array.from(
    new Set(requestedLines.map((line) => line.invoiceLineId))
  );

  if (requestedIds.length !== requestedLines.length) {
    throw new Error("Each invoice line can only appear once in a credit note.");
  }

  const { data: invoiceLines, error: invoiceLinesError } = await admin
    .from("invoice_lines")
    .select(
      "id,job_id,description,quantity,unit_price,vat_rate"
    )
    .eq("tenant_id", tenantId)
    .eq("invoice_id", invoiceId)
    .in("id", requestedIds);

  if (invoiceLinesError) {
    throw new Error(invoiceLinesError.message);
  }

  if ((invoiceLines ?? []).length !== requestedIds.length) {
    throw new Error("One or more invoice lines could not be found.");
  }

  const invoiceLineMap = new Map(
    (invoiceLines as InvoiceLineRow[]).map((line) => [line.id, line])
  );

  const { data: otherCreditNotes, error: creditNotesError } = await admin
    .from("credit_notes")
    .select("id,status")
    .eq("tenant_id", tenantId)
    .eq("original_invoice_id", invoiceId)
    .not("status", "in", '("cancelled","void")');

  if (creditNotesError) {
    throw new Error(creditNotesError.message);
  }

  const otherCreditNoteIds = (otherCreditNotes ?? [])
    .map((note) => String(note.id))
    .filter((id) => id && id !== excludeCreditNoteId);

  const alreadyCreditedByInvoiceLine = new Map<string, number>();

  if (otherCreditNoteIds.length > 0) {
    const { data: previousLines, error: previousLinesError } = await admin
      .from("credit_note_lines")
      .select("invoice_line_id,quantity")
      .eq("tenant_id", tenantId)
      .in("credit_note_id", otherCreditNoteIds)
      .not("invoice_line_id", "is", null);

    if (previousLinesError) {
      throw new Error(previousLinesError.message);
    }

    for (const line of previousLines ?? []) {
      const invoiceLineId = String(line.invoice_line_id ?? "");

      if (!invoiceLineId) {
        continue;
      }

      alreadyCreditedByInvoiceLine.set(
        invoiceLineId,
        Number(alreadyCreditedByInvoiceLine.get(invoiceLineId) ?? 0) +
          Number(line.quantity ?? 0)
      );
    }
  }

  const calculatedLines = requestedLines.map((requestedLine) => {
    const sourceLine = invoiceLineMap.get(requestedLine.invoiceLineId);

    if (!sourceLine) {
      throw new Error("Invoice line not found.");
    }

    const originalQuantity = Number(sourceLine.quantity ?? 0);
    const requestedQuantity = Number(requestedLine.quantity);
    const alreadyCredited = Number(
      alreadyCreditedByInvoiceLine.get(sourceLine.id) ?? 0
    );

    const remainingQuantity = Math.max(
      originalQuantity - alreadyCredited,
      0
    );

    if (
      !Number.isFinite(requestedQuantity) ||
      requestedQuantity <= 0
    ) {
      throw new Error(
        `Credit quantity for "${sourceLine.description}" must be greater than zero.`
      );
    }

    if (requestedQuantity > remainingQuantity + 0.000001) {
      throw new Error(
        `Credit quantity for "${sourceLine.description}" exceeds the remaining creditable quantity of ${remainingQuantity}.`
      );
    }

    const unitPrice = Number(sourceLine.unit_price ?? 0);
    const vatRate = Number(sourceLine.vat_rate ?? 0);

    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      throw new Error(
        `Invoice line "${sourceLine.description}" has an invalid unit price.`
      );
    }

    if (!Number.isFinite(vatRate) || vatRate < 0) {
      throw new Error(
        `Invoice line "${sourceLine.description}" has an invalid VAT rate.`
      );
    }

    const netAmount = roundMoney(requestedQuantity * unitPrice);
    const vatAmount = roundMoney(netAmount * (vatRate / 100));
    const grossAmount = roundMoney(netAmount + vatAmount);

    return {
      invoice_line_id: sourceLine.id,
      job_id: sourceLine.job_id,
      description: sourceLine.description,
      quantity: requestedQuantity,
      unit_price: unitPrice,
      vat_rate: vatRate,
      net_amount: netAmount,
      vat_amount: vatAmount,
      gross_amount: grossAmount,
    };
  });

  const subtotal = roundMoney(
    calculatedLines.reduce((sum, line) => sum + line.net_amount, 0)
  );

  const vatTotal = roundMoney(
    calculatedLines.reduce((sum, line) => sum + line.vat_amount, 0)
  );

  const total = roundMoney(
    calculatedLines.reduce((sum, line) => sum + line.gross_amount, 0)
  );

  return {
    lines: calculatedLines,
    subtotal,
    vatTotal,
    total,
  };
}

async function loadCreditNote(
  admin: Awaited<ReturnType<typeof requireTenantAccess>>["admin"],
  tenantId: string,
  creditNoteId: string
) {
  const { data, error } = await admin
    .from("credit_notes")
    .select(`
      *,
      customers (
        id,
        name
      ),
      invoices (
        id,
        invoice_number,
        total,
        credit_total,
        balance_due,
        currency
      ),
      credit_note_lines (
        id,
        invoice_line_id,
        job_id,
        description,
        quantity,
        unit_price,
        vat_rate,
        net_amount,
        vat_amount,
        gross_amount,
        created_at
      ),
      credit_note_allocations (
        id,
        invoice_id,
        amount,
        allocated_at
      )
    `)
    .eq("tenant_id", tenantId)
    .eq("id", creditNoteId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function GET(request: NextRequest) {
  try {
    const tenantId =
      request.nextUrl.searchParams.get("tenantId")?.trim() ?? "";

    if (!tenantId) {
      return NextResponse.json(
        {
          error: "tenantId is required.",
        },
        {
          status: 400,
        }
      );
    }

    const { admin } = await requireTenantAccess(tenantId);

    const { data, error } = await admin
      .from("credit_notes")
      .select(`
        *,
        customers (
          id,
          name
        ),
        invoices (
          id,
          invoice_number,
          total,
          credit_total,
          balance_due,
          currency
        ),
        credit_note_lines (
          id,
          invoice_line_id,
          job_id,
          description,
          quantity,
          unit_price,
          vat_rate,
          net_amount,
          vat_amount,
          gross_amount,
          created_at
        ),
        credit_note_allocations (
          id,
          invoice_id,
          amount,
          allocated_at
        )
      `)
      .eq("tenant_id", tenantId)
      .order("created_at", {
        ascending: false,
      });

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({
      creditNotes: data ?? [],
    });
  } catch (error) {
    const result = errorResponse(error);

    return NextResponse.json(
      result.body,
      {
        status: result.status,
      }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const tenantId = String(body.tenantId ?? "").trim();
    const invoiceId = String(body.invoiceId ?? "").trim();
    const requestedLines = parseCreditLines(body.lines);

    if (!tenantId || !invoiceId) {
      return NextResponse.json(
        {
          error: "tenantId and invoiceId are required.",
        },
        {
          status: 400,
        }
      );
    }

    const { admin, user } = await requireTenantAccess(tenantId);

    const { data: invoice, error: invoiceError } = await admin
      .from("invoices")
      .select(
        "id,customer_id,invoice_number,total,credit_total,balance_due,currency"
      )
      .eq("id", invoiceId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (invoiceError) {
      throw new Error(invoiceError.message);
    }

    if (!invoice?.customer_id) {
      return NextResponse.json(
        {
          error: "Invoice not found.",
        },
        {
          status: 404,
        }
      );
    }

    const calculated = await calculateCreditLines(
      admin,
      tenantId,
      invoiceId,
      requestedLines
    );

    const allocatedTotal = await getExistingAllocatedTotal(
      admin,
      tenantId,
      invoiceId
    );

    const invoiceTotal = Number(invoice.total ?? 0);

    const remainingGross = roundMoney(
      Math.max(invoiceTotal - allocatedTotal, 0)
    );

    if (calculated.total > remainingGross + 0.009) {
      return NextResponse.json(
        {
          error:
            `Credit total ${calculated.total.toFixed(2)} exceeds the remaining invoice creditable amount ${remainingGross.toFixed(2)}.`,
        },
        {
          status: 409,
        }
      );
    }

    const creditNumber =
      String(body.creditNoteNumber ?? "").trim() ||
      `CN-${new Date()
        .toISOString()
        .replace(/\D/g, "")
        .slice(0, 14)}`;

    const { data: creditNote, error: creditError } = await admin
      .from("credit_notes")
      .insert({
        tenant_id: tenantId,
        customer_id: invoice.customer_id,
        original_invoice_id: invoiceId,
        credit_note_number: creditNumber,
        status: "draft",
        issue_date:
          String(body.issueDate ?? "").trim() ||
          new Date().toISOString().slice(0, 10),
        reason:
          String(body.reason ?? "").trim() ||
          null,
        subtotal: calculated.subtotal,
        vat_total: calculated.vatTotal,
        total: calculated.total,
        currency: invoice.currency || "GBP",
        created_by: user.id,
      })
      .select("id")
      .single();

    if (creditError) {
      throw new Error(creditError.message);
    }

    const { error: lineInsertError } = await admin
      .from("credit_note_lines")
      .insert(
        calculated.lines.map((line) => ({
          tenant_id: tenantId,
          credit_note_id: creditNote.id,
          ...line,
        }))
      );

    if (lineInsertError) {
      await admin
        .from("credit_notes")
        .delete()
        .eq("tenant_id", tenantId)
        .eq("id", creditNote.id);

      throw new Error(lineInsertError.message);
    }

    const completed = await loadCreditNote(
      admin,
      tenantId,
      creditNote.id
    );

    return NextResponse.json(
      {
        ok: true,
        creditNote: completed,
      },
      {
        status: 201,
      }
    );
  } catch (error) {
    const result = errorResponse(error);

    return NextResponse.json(
      result.body,
      {
        status: result.status,
      }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();

    const tenantId = String(body.tenantId ?? "").trim();
    const creditNoteId = String(body.creditNoteId ?? "").trim();
    const action = String(body.action ?? "save").trim().toLowerCase();

    if (!tenantId || !creditNoteId) {
      return NextResponse.json(
        {
          error: "tenantId and creditNoteId are required.",
        },
        {
          status: 400,
        }
      );
    }

    const { admin, user } = await requireTenantAccess(tenantId);

    const { data: creditNote, error: creditNoteError } = await admin
      .from("credit_notes")
      .select(
        "id,status,original_invoice_id,total,customer_id,currency"
      )
      .eq("tenant_id", tenantId)
      .eq("id", creditNoteId)
      .maybeSingle();

    if (creditNoteError) {
      throw new Error(creditNoteError.message);
    }

    if (!creditNote) {
      return NextResponse.json(
        {
          error: "Credit note not found.",
        },
        {
          status: 404,
        }
      );
    }

    if (action === "cancel") {
      if (creditNote.status !== "draft") {
        return NextResponse.json(
          {
            error: "Only draft credit notes can be cancelled.",
          },
          {
            status: 409,
          }
        );
      }

      const { error: cancelError } = await admin
        .from("credit_notes")
        .update({
          status: "cancelled",
        })
        .eq("tenant_id", tenantId)
        .eq("id", creditNoteId);

      if (cancelError) {
        throw new Error(cancelError.message);
      }

      const completed = await loadCreditNote(
        admin,
        tenantId,
        creditNoteId
      );

      return NextResponse.json({
        ok: true,
        creditNote: completed,
      });
    }

    if (action === "approve") {
      if (creditNote.status !== "draft") {
        return NextResponse.json(
          {
            error: "Only draft credit notes can be approved.",
          },
          {
            status: 409,
          }
        );
      }

      if (!creditNote.original_invoice_id) {
        return NextResponse.json(
          {
            error: "Credit note has no original invoice.",
          },
          {
            status: 409,
          }
        );
      }

      const { data: existingAllocation, error: allocationLookupError } =
        await admin
          .from("credit_note_allocations")
          .select("id,amount")
          .eq("tenant_id", tenantId)
          .eq("credit_note_id", creditNoteId)
          .maybeSingle();

      if (allocationLookupError) {
        throw new Error(allocationLookupError.message);
      }

      if (existingAllocation) {
        return NextResponse.json(
          {
            error: "This credit note is already allocated.",
          },
          {
            status: 409,
          }
        );
      }

      const { data: invoice, error: invoiceError } = await admin
        .from("invoices")
        .select("id,total")
        .eq("tenant_id", tenantId)
        .eq("id", creditNote.original_invoice_id)
        .maybeSingle();

      if (invoiceError) {
        throw new Error(invoiceError.message);
      }

      if (!invoice) {
        return NextResponse.json(
          {
            error: "Original invoice not found.",
          },
          {
            status: 404,
          }
        );
      }

      const allocatedTotal = await getExistingAllocatedTotal(
        admin,
        tenantId,
        creditNote.original_invoice_id,
        creditNoteId
      );

      const invoiceTotal = Number(invoice.total ?? 0);
      const remainingGross = roundMoney(
        Math.max(invoiceTotal - allocatedTotal, 0)
      );

      const creditTotal = roundMoney(Number(creditNote.total ?? 0));

      if (creditTotal <= 0) {
        return NextResponse.json(
          {
            error: "Credit note total must be greater than zero.",
          },
          {
            status: 409,
          }
        );
      }

      if (creditTotal > remainingGross + 0.009) {
        return NextResponse.json(
          {
            error:
              `Credit total ${creditTotal.toFixed(2)} exceeds the remaining invoice creditable amount ${remainingGross.toFixed(2)}.`,
          },
          {
            status: 409,
          }
        );
      }

      const { data: allocation, error: allocationError } = await admin
        .from("credit_note_allocations")
        .insert({
          tenant_id: tenantId,
          credit_note_id: creditNoteId,
          invoice_id: creditNote.original_invoice_id,
          amount: creditTotal,
          allocated_by: user.id,
        })
        .select("id")
        .single();

      if (allocationError) {
        throw new Error(allocationError.message);
      }

      const approvedAt = new Date().toISOString();

      const { error: approveError } = await admin
        .from("credit_notes")
        .update({
          status: "approved",
          approved_by: user.id,
          approved_at: approvedAt,
        })
        .eq("tenant_id", tenantId)
        .eq("id", creditNoteId);

      if (approveError) {
        await admin
          .from("credit_note_allocations")
          .delete()
          .eq("tenant_id", tenantId)
          .eq("id", allocation.id);

        throw new Error(approveError.message);
      }

      const completed = await loadCreditNote(
        admin,
        tenantId,
        creditNoteId
      );

      return NextResponse.json({
        ok: true,
        creditNote: completed,
      });
    }

    if (action !== "save") {
      return NextResponse.json(
        {
          error: "Invalid credit-note action.",
        },
        {
          status: 400,
        }
      );
    }

    if (creditNote.status !== "draft") {
      return NextResponse.json(
        {
          error: "Only draft credit notes can be edited.",
        },
        {
          status: 409,
        }
      );
    }

    if (!creditNote.original_invoice_id) {
      return NextResponse.json(
        {
          error: "Credit note has no original invoice.",
        },
        {
          status: 409,
        }
      );
    }

    const requestedLines = parseCreditLines(body.lines);

    const calculated = await calculateCreditLines(
      admin,
      tenantId,
      creditNote.original_invoice_id,
      requestedLines,
      creditNoteId
    );

    const allocatedTotal = await getExistingAllocatedTotal(
      admin,
      tenantId,
      creditNote.original_invoice_id,
      creditNoteId
    );

    const { data: invoice, error: invoiceError } = await admin
      .from("invoices")
      .select("id,total")
      .eq("tenant_id", tenantId)
      .eq("id", creditNote.original_invoice_id)
      .maybeSingle();

    if (invoiceError) {
      throw new Error(invoiceError.message);
    }

    if (!invoice) {
      return NextResponse.json(
        {
          error: "Original invoice not found.",
        },
        {
          status: 404,
        }
      );
    }

    const remainingGross = roundMoney(
      Math.max(Number(invoice.total ?? 0) - allocatedTotal, 0)
    );

    if (calculated.total > remainingGross + 0.009) {
      return NextResponse.json(
        {
          error:
            `Credit total ${calculated.total.toFixed(2)} exceeds the remaining invoice creditable amount ${remainingGross.toFixed(2)}.`,
        },
        {
          status: 409,
        }
      );
    }

    const { data: oldLines, error: oldLinesError } = await admin
      .from("credit_note_lines")
      .select(
        "invoice_line_id,job_id,description,quantity,unit_price,vat_rate,net_amount,vat_amount,gross_amount"
      )
      .eq("tenant_id", tenantId)
      .eq("credit_note_id", creditNoteId);

    if (oldLinesError) {
      throw new Error(oldLinesError.message);
    }

    const { error: deleteLinesError } = await admin
      .from("credit_note_lines")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("credit_note_id", creditNoteId);

    if (deleteLinesError) {
      throw new Error(deleteLinesError.message);
    }

    const { error: insertLinesError } = await admin
      .from("credit_note_lines")
      .insert(
        calculated.lines.map((line) => ({
          tenant_id: tenantId,
          credit_note_id: creditNoteId,
          ...line,
        }))
      );

    if (insertLinesError) {
      if ((oldLines ?? []).length > 0) {
        await admin
          .from("credit_note_lines")
          .insert(
            (oldLines ?? []).map((line) => ({
              tenant_id: tenantId,
              credit_note_id: creditNoteId,
              invoice_line_id: line.invoice_line_id,
              job_id: line.job_id,
              description: line.description,
              quantity: line.quantity,
              unit_price: line.unit_price,
              vat_rate: line.vat_rate,
              net_amount: line.net_amount,
              vat_amount: line.vat_amount,
              gross_amount: line.gross_amount,
            }))
          );
      }

      throw new Error(insertLinesError.message);
    }

    const { error: updateError } = await admin
      .from("credit_notes")
      .update({
        issue_date:
          body.issueDate === undefined
            ? undefined
            : String(body.issueDate ?? "").trim() ||
              new Date().toISOString().slice(0, 10),
        reason:
          body.reason === undefined
            ? undefined
            : String(body.reason ?? "").trim() || null,
        subtotal: calculated.subtotal,
        vat_total: calculated.vatTotal,
        total: calculated.total,
      })
      .eq("tenant_id", tenantId)
      .eq("id", creditNoteId);

    if (updateError) {
      await admin
        .from("credit_note_lines")
        .delete()
        .eq("tenant_id", tenantId)
        .eq("credit_note_id", creditNoteId);

      if ((oldLines ?? []).length > 0) {
        await admin
          .from("credit_note_lines")
          .insert(
            (oldLines ?? []).map((line) => ({
              tenant_id: tenantId,
              credit_note_id: creditNoteId,
              invoice_line_id: line.invoice_line_id,
              job_id: line.job_id,
              description: line.description,
              quantity: line.quantity,
              unit_price: line.unit_price,
              vat_rate: line.vat_rate,
              net_amount: line.net_amount,
              vat_amount: line.vat_amount,
              gross_amount: line.gross_amount,
            }))
          );
      }

      throw new Error(updateError.message);
    }

    const completed = await loadCreditNote(
      admin,
      tenantId,
      creditNoteId
    );

    return NextResponse.json({
      ok: true,
      creditNote: completed,
    });
  } catch (error) {
    const result = errorResponse(error);

    return NextResponse.json(
      result.body,
      {
        status: result.status,
      }
    );
  }
}