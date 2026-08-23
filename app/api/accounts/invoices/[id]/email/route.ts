import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  errorResponse,
  requireTenantAccess,
} from "../../../../../../lib/accounts/server";

import {
  sendLoggedDocumentEmail,
} from "../../../../../../lib/documents/delivery";

import {
  buildDocumentEmailHtml,
} from "../../../../../../lib/documents/emailTemplate";

import {
  generateInvoicePdf,
} from "../../../../../../lib/invoices/generatePdf";

import {
  generatePodPdf,
} from "../../../../../../lib/pod/generatePdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_PATTERN =
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const POD_READY_STATUSES =
  new Set([
    "complete",
    "completed",
    "approved",
    "received",
    "delivered",
  ]);

function safeHeader(
  value: string
): string {
  return value
    .replace(/[\r\n]+/g, " ")
    .slice(0, 180);
}

async function loadDocumentBranding(
  request: NextRequest,
  tenantId: string
) {
  try {
    const url =
      new URL(
        "/api/settings/documents",
        request.url
      );

    url.searchParams.set(
      "tenantId",
      tenantId
    );

    const headers =
      new Headers();

    const cookie =
      request.headers.get(
        "cookie"
      );

    const authorization =
      request.headers.get(
        "authorization"
      );

    if (cookie) {
      headers.set(
        "cookie",
        cookie
      );
    }

    if (authorization) {
      headers.set(
        "authorization",
        authorization
      );
    }

    const response =
      await fetch(
        url,
        {
          method: "GET",
          headers,
          cache: "no-store",
        }
      );

    if (!response.ok) {
      return null;
    }

    return await response.json();
  } catch {
    return null;
  }
}

export async function POST(
  request: NextRequest,
  context: {
    params: Promise<{
      id: string;
    }>;
  }
) {
  try {
    const body =
      await request.json();

    const tenantId =
      String(
        body.tenantId ?? ""
      ).trim();

    const requestedRecipient =
      String(
        body.to ?? ""
      ).trim();

    const includePodRequested =
      body.includePod === true;

    const {
      id: invoiceId,
    } =
      await context.params;

    if (!tenantId) {
      return NextResponse.json(
        {
          error:
            "tenantId is required.",
        },
        {
          status: 400,
        }
      );
    }

    if (!invoiceId) {
      return NextResponse.json(
        {
          error:
            "Invoice id is required.",
        },
        {
          status: 400,
        }
      );
    }

    const {
      admin,
      user,
    } =
      await requireTenantAccess(
        tenantId
      );

    const {
      data: invoice,
      error: invoiceError,
    } = await admin
      .from("invoices")
      .select(`
        id,
        tenant_id,
        customer_id,
        invoice_number,
        status,
        issue_date,
        due_date,
        subtotal,
        vat_total,
        total,
        amount_paid,
        credit_total,
        balance_due,
        currency,
        po_reference,
        customer_reference,
        notes,
        invoice_email
      `)
      .eq(
        "id",
        invoiceId
      )
      .eq(
        "tenant_id",
        tenantId
      )
      .maybeSingle();

    if (invoiceError) {
      throw new Error(
        invoiceError.message
      );
    }

    if (!invoice) {
      return NextResponse.json(
        {
          error:
            "Invoice not found.",
        },
        {
          status: 404,
        }
      );
    }

    const invoiceStatus =
      String(
        invoice.status ?? ""
      ).toLowerCase();

    if (
      !["approved", "sent"].includes(
        invoiceStatus
      )
    ) {
      return NextResponse.json(
        {
          error:
            "Approve the invoice before emailing it.",
        },
        {
          status: 409,
        }
      );
    }

    if (!invoice.invoice_number) {
      return NextResponse.json(
        {
          error:
            "Invoice has no invoice number.",
        },
        {
          status: 409,
        }
      );
    }

    if (!invoice.customer_id) {
      return NextResponse.json(
        {
          error:
            "Invoice has no customer.",
        },
        {
          status: 409,
        }
      );
    }

    const [
      customerResult,
      tenantResult,
      linesResult,
    ] =
      await Promise.all([
        admin
          .from("customers")
          .select(`
            id,
            name,
            contact_name,
            email,
            operations_email,
            accounts_email,
            pod_required,
            invoice_pod_attachment_required
          `)
          .eq(
            "id",
            invoice.customer_id
          )
          .eq(
            "tenant_id",
            tenantId
          )
          .maybeSingle(),

        admin
          .from("tenants")
          .select(`
            id,
            name
          `)
          .eq(
            "id",
            tenantId
          )
          .maybeSingle(),

        admin
          .from("invoice_lines")
          .select(`
            id,
            job_id,
            line_number,
            description,
            quantity,
            unit_price,
            vat_rate,
            net_amount,
            vat_amount,
            gross_amount
          `)
          .eq(
            "invoice_id",
            invoice.id
          )
          .eq(
            "tenant_id",
            tenantId
          )
          .order(
            "line_number",
            {
              ascending: true,
            }
          ),
      ]);

    if (customerResult.error) {
      throw new Error(
        customerResult.error.message
      );
    }

    if (tenantResult.error) {
      throw new Error(
        tenantResult.error.message
      );
    }

    if (linesResult.error) {
      throw new Error(
        linesResult.error.message
      );
    }

    const customer =
      customerResult.data;

    const tenant =
      tenantResult.data;

    const invoiceLines =
      linesResult.data ?? [];

    if (!customer) {
      return NextResponse.json(
        {
          error:
            "Invoice customer not found.",
        },
        {
          status: 404,
        }
      );
    }

    if (!tenant?.name) {
      return NextResponse.json(
        {
          error:
            "Tenant company name is not configured.",
        },
        {
          status: 409,
        }
      );
    }

    if (invoiceLines.length === 0) {
      return NextResponse.json(
        {
          error:
            "Invoice contains no invoice lines.",
        },
        {
          status: 409,
        }
      );
    }

    const recipient =
      requestedRecipient ||
      String(
        invoice.invoice_email ??
          customer.accounts_email ??
          customer.email ??
          customer.operations_email ??
          ""
      ).trim();

    if (
      !recipient ||
      !EMAIL_PATTERN.test(
        recipient
      )
    ) {
      return NextResponse.json(
        {
          error:
            "A valid invoice email recipient is required.",
        },
        {
          status: 400,
        }
      );
    }

    const jobIds =
      Array.from(
        new Set(
          invoiceLines
            .map(
              (line) =>
                line.job_id
            )
            .filter(
              (
                value
              ): value is string =>
                typeof value === "string" &&
                value.length > 0
            )
        )
      );

    let jobs:
      Array<{
        id: string;
        reference: string | null;
        status: string | null;
        pod_status: string | null;
        external_reference: string | null;
        customer_reference: string | null;
      }> = [];

    if (jobIds.length > 0) {
      const {
        data,
        error,
      } = await admin
        .from("jobs")
        .select(`
          id,
          reference,
          status,
          pod_status,
          external_reference,
          customer_reference
        `)
        .eq(
          "tenant_id",
          tenantId
        )
        .in(
          "id",
          jobIds
        );

      if (error) {
        throw new Error(
          error.message
        );
      }

      jobs =
        data ?? [];
    }

    const requiresPod =
      customer.pod_required === true;

    const requiresPodAttachment =
      customer.invoice_pod_attachment_required ===
      true;

    const attachPod =
      requiresPodAttachment ||
      includePodRequested;

    if (
      (requiresPod ||
        requiresPodAttachment) &&
      jobIds.length === 0
    ) {
      return NextResponse.json(
        {
          error:
            "This customer requires POD, but the invoice has no linked jobs.",
        },
        {
          status: 409,
        }
      );
    }

    const jobsById =
      new Map(
        jobs.map(
          (job) => [
            job.id,
            job,
          ]
        )
      );

    const missingJobs =
      jobIds.filter(
        (jobId) =>
          !jobsById.has(jobId)
      );

    if (missingJobs.length > 0) {
      return NextResponse.json(
        {
          error:
            "One or more invoice jobs could not be loaded.",
          missingJobIds:
            missingJobs,
        },
        {
          status: 409,
        }
      );
    }

    if (
      requiresPod ||
      attachPod
    ) {
      const incompleteJobs =
        jobs.filter(
          (job) =>
            !POD_READY_STATUSES.has(
              String(
                job.pod_status ?? ""
              ).toLowerCase()
            )
        );

      if (
        incompleteJobs.length > 0
      ) {
        return NextResponse.json(
          {
            error:
              "Invoice cannot be emailed because POD is incomplete for one or more jobs.",
            missingPodJobs:
              incompleteJobs.map(
                (job) => ({
                  id:
                    job.id,
                  reference:
                    job.reference ??
                    job.id,
                  podStatus:
                    job.pod_status ??
                    "pending",
                })
              ),
          },
          {
            status: 409,
          }
        );
      }
    }

    const branding =
      await loadDocumentBranding(
        request,
        tenantId
      );

    const {
      bytes: invoicePdfBytes,
      filename: invoicePdfFilename,
    } = await generateInvoicePdf({
      companyName:
        String(tenant.name),
      companyProfile:
        branding?.companyProfile ??
        null,
      documentSettings:
        branding?.documentSettings ??
        null,
      status:
        invoice.status ??
        null,
      jobs:
        jobs.map(
          (job) => ({
            reference:
              job.reference,
            externalReference:
              job.external_reference,
            customerReference:
              job.customer_reference,
            podStatus:
              job.pod_status,
          })
        ),
      customerName:
        String(
          customer.name ??
            "Customer"
        ),
      invoiceNumber:
        String(
          invoice.invoice_number
        ),
      issueDate:
        invoice.issue_date ?? null,
      dueDate:
        invoice.due_date ?? null,
      currency:
        invoice.currency ??
        "GBP",
      poReference:
        invoice.po_reference ??
        null,
      customerReference:
        invoice.customer_reference ??
        null,
      notes:
        invoice.notes ??
        null,
      subtotal:
        Number(
          invoice.subtotal ?? 0
        ),
      vatTotal:
        Number(
          invoice.vat_total ?? 0
        ),
      total:
        Number(
          invoice.total ?? 0
        ),
      amountPaid:
        Number(
          invoice.amount_paid ?? 0
        ),
      creditTotal:
        Number(
          invoice.credit_total ?? 0
        ),
      balanceDue:
        Number(
          invoice.balance_due ?? 0
        ),
      lines:
        invoiceLines.map(
          (line) => ({
            description:
              String(
                line.description ??
                  ""
              ),
            quantity:
              Number(
                line.quantity ?? 0
              ),
            unitPrice:
              Number(
                line.unit_price ?? 0
              ),
            vatRate:
              Number(
                line.vat_rate ?? 0
              ),
            netAmount:
              Number(
                line.net_amount ?? 0
              ),
            vatAmount:
              Number(
                line.vat_amount ?? 0
              ),
            grossAmount:
              Number(
                line.gross_amount ?? 0
              ),
          })
        ),
    });

    const attachments = [
      {
        filename:
          invoicePdfFilename,
        content:
          Buffer.from(
            invoicePdfBytes
          ),
        contentType:
          "application/pdf",
      },
    ];

    const attachedPodJobIds:
      string[] = [];

    if (attachPod) {
      for (const job of jobs) {
        const {
          bytes,
          filename,
        } =
          await generatePodPdf(
            tenantId,
            job.id
          );

        attachments.push({
          filename,
          content:
            Buffer.from(bytes),
          contentType:
            "application/pdf",
        });

        attachedPodJobIds.push(
          job.id
        );
      }
    }

    const invoiceNumber =
      String(
        invoice.invoice_number
      );

    const customerName =
      String(
        customer.contact_name ??
          customer.name ??
          "Customer"
      );

    const subject =
      safeHeader(
        `Invoice ${invoiceNumber} from ${tenant.name}`
      );

    const podDescription =
      attachPod
        ? `${attachedPodJobIds.length} POD PDF${
            attachedPodJobIds.length === 1
              ? ""
              : "s"
          } are also attached.`
        : "";

    const text = [
      `Hi ${customerName},`,
      "",
      `Please find invoice ${invoiceNumber} attached.`,
      "",
      podDescription,
      "",
      `Amount due: ${new Intl.NumberFormat(
        "en-GB",
        {
          style:
            "currency",
          currency:
            invoice.currency ??
            "GBP",
        }
      ).format(
        Number(
          invoice.balance_due ??
            invoice.total ??
            0
        )
      )}`,
      "",
      "Regards,",
      String(tenant.name),
    ]
      .filter(
        (line) =>
          line !== ""
            ? true
            : true
      )
      .join("\n");

    const html =
      buildDocumentEmailHtml({
        companyName:
          String(
            tenant.name
          ),
        recipientName:
          customerName,
        title:
          `Invoice ${invoiceNumber}`,
        intro:
          `Please find invoice ${invoiceNumber} attached.`,
        summaryRows: [
          {
            label:
              "Invoice",
            value:
              invoiceNumber,
          },
          {
            label:
              "Issue date",
            value:
              invoice.issue_date ||
              "-",
          },
          {
            label:
              "Due date",
            value:
              invoice.due_date ||
              "-",
          },
          {
            label:
              "Amount due",
            value:
              new Intl.NumberFormat(
                "en-GB",
                {
                  style:
                    "currency",
                  currency:
                    invoice.currency ||
                    "GBP",
                }
              ).format(
                Number(
                  invoice.balance_due ??
                  invoice.total ??
                  0
                )
              ),
          },
        ],
        attachmentText:
          attachPod
            ? `${attachedPodJobIds.length} POD PDF${
                attachedPodJobIds.length === 1
                  ? ""
                  : "s"
              } ${
                attachedPodJobIds.length === 1
                  ? "is"
                  : "are"
              } included with the invoice PDF.`
            : "The invoice PDF is attached.",
        footerText:
          "Please contact us if you have any questions regarding this invoice.",
      });
    const delivery =
      await sendLoggedDocumentEmail({
        admin,
        tenantId,
        documentType:
          "invoice",
        documentId:
          invoice.id,
        recipient,
        subject,
        text,
        html,
        initiatedBy:
          user.id,
        attachments,
        metadata: {
          invoiceNumber,
          customerId:
            invoice.customer_id,
          customerName:
            customer.name ??
            null,
          includePod:
            attachPod,
          podRequired:
            requiresPod,
          podAttachmentRequired:
            requiresPodAttachment,
          podJobIds:
            attachedPodJobIds,
        },
      });

    const sentAt =
      new Date()
        .toISOString();

    const {
      error: invoiceUpdateError,
    } = await admin
      .from("invoices")
      .update({
        status:
          "sent",
        sent_at:
          sentAt,
        sent_by:
          user.id,
        invoice_email:
          recipient,
        updated_at:
          sentAt,
      })
      .eq(
        "id",
        invoice.id
      )
      .eq(
        "tenant_id",
        tenantId
      );

    if (invoiceUpdateError) {
      throw new Error(
        invoiceUpdateError.message
      );
    }

    if (
      attachedPodJobIds.length >
      0
    ) {
      const {
        error: podAttachedError,
      } = await admin
        .from("invoice_jobs")
        .update({
          pod_attached:
            true,
        })
        .eq(
          "invoice_id",
          invoice.id
        )
        .eq(
          "tenant_id",
          tenantId
        )
        .in(
          "job_id",
          attachedPodJobIds
        );

      if (podAttachedError) {
        throw new Error(
          podAttachedError.message
        );
      }
    }

    return NextResponse.json({
      ok: true,
      invoiceId:
        invoice.id,
      invoiceNumber,
      recipient,
      deliveryLogId:
        delivery.deliveryLogId,
      providerMessageId:
        delivery.providerMessageId,
      attachments:
        attachments.map(
          (attachment) =>
            attachment.filename
        ),
      podAttachmentCount:
        attachedPodJobIds.length,
      sentAt,
    });
  }
  catch (error) {
    const result =
      errorResponse(error);

    return NextResponse.json(
      result.body,
      {
        status:
          result.status,
      }
    );
  }
}