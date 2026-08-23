import { Resend } from "resend";

type DeliveryDocumentType =
  | "quotation"
  | "invoice"
  | "credit_note"
  | "pod"
  | "statement"
  | "purchase_order"
  | "chase_letter";

type DeliveryAdminClient = {
  from(table: string): any;
};

export type DeliveryAttachment = {
  filename: string;
  content: Buffer;
  contentType?: string;
};

type SendLoggedDocumentEmailInput = {
  admin: DeliveryAdminClient;
  tenantId: string;
  documentType: DeliveryDocumentType;
  documentId: string;
  recipient: string;
  subject: string;
  text: string;
  attachments?: DeliveryAttachment[];
  shareReference?: string | null;
  initiatedBy?: string | null;
  metadata?: Record<string, unknown>;
};

export type SendLoggedDocumentEmailResult = {
  deliveryLogId: string;
  providerMessageId: string | null;
};

function attachmentManifest(
  attachments: DeliveryAttachment[]
) {
  return attachments.map((attachment) => ({
    filename: attachment.filename,
    contentType:
      attachment.contentType ??
      "application/octet-stream",
    size: attachment.content.length,
  }));
}

export async function sendLoggedDocumentEmail(
  input: SendLoggedDocumentEmailInput
): Promise<SendLoggedDocumentEmailResult> {
  const apiKey =
    process.env.RESEND_API_KEY;

  const from =
    process.env.MAIL_FROM;

  if (!apiKey || !from) {
    throw new Error(
      "Email delivery is not configured. RESEND_API_KEY and MAIL_FROM are required."
    );
  }

  const attachments =
    input.attachments ?? [];

  const manifest =
    attachmentManifest(attachments);

  const {
    data: pendingLog,
    error: pendingLogError,
  } = await input.admin
    .from("document_delivery_log")
    .insert({
      tenant_id:
        input.tenantId,

      document_type:
        input.documentType,

      document_id:
        input.documentId,

      action:
        "email",

      status:
        "pending",

      recipient_email:
        input.recipient,

      provider:
        "resend",

      share_reference:
        input.shareReference ?? null,

      attachments:
        manifest,

      metadata:
        input.metadata ?? {},

      initiated_by:
        input.initiatedBy ?? null,
    })
    .select("id")
    .single();

  if (pendingLogError || !pendingLog?.id) {
    throw new Error(
      pendingLogError?.message ||
        "Unable to create document delivery log."
    );
  }

  const deliveryLogId =
    String(pendingLog.id);

  try {
    const resend =
      new Resend(apiKey);

    const {
      data,
      error,
    } =
      await resend.emails.send({
        from,
        to:
          input.recipient,
        subject:
          input.subject,
        text:
          input.text,

        attachments:
          attachments.map(
            (attachment) => ({
              filename:
                attachment.filename,
              content:
                attachment.content,
              contentType:
                attachment.contentType,
            })
          ),
      });

    if (error) {
      throw new Error(
        error.message ||
          "Email provider rejected the message."
      );
    }

    const providerMessageId =
      data?.id ?? null;

    const {
      error: successLogError,
    } = await input.admin
      .from("document_delivery_log")
      .update({
        status:
          "success",

        provider_message_id:
          providerMessageId,

        error_message:
          null,
      })
      .eq(
        "id",
        deliveryLogId
      )
      .eq(
        "tenant_id",
        input.tenantId
      );

    if (successLogError) {
      throw new Error(
        successLogError.message
      );
    }

    return {
      deliveryLogId,
      providerMessageId,
    };
  }
  catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to send document email.";

    try {
      await input.admin
        .from("document_delivery_log")
        .update({
          status:
            "error",

          error_message:
            message,
        })
        .eq(
          "id",
          deliveryLogId
        )
        .eq(
          "tenant_id",
          input.tenantId
        );
    }
    catch {
      // Preserve the original delivery error.
    }

    throw error;
  }
}