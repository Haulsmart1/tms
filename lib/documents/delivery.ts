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
  html?: string;
  attachments?: DeliveryAttachment[];
  shareReference?: string | null;
  initiatedBy?: string | null;
  metadata?: Record<string, unknown>;
};

export type SendLoggedDocumentEmailResult = {
  deliveryLogId: string;
  providerMessageId: string | null;
};

type GraphTokenResponse = {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

function attachmentManifest(
  attachments: DeliveryAttachment[]
) {
  return attachments.map((attachment) => ({
    filename: attachment.filename,
    contentType:
      attachment.contentType ??
      "application/octet-stream",
    size:
      attachment.content.length,
  }));
}

function sanitizeHeader(
  value: string
): string {
  return value
    .replace(/[\r\n]+/g, " ")
    .trim();
}

async function getMicrosoftGraphAccessToken(): Promise<string> {
  const tenantId =
    process.env.MS_GRAPH_TENANT_ID?.trim();

  const clientId =
    process.env.MS_GRAPH_CLIENT_ID?.trim();

  const clientSecret =
    process.env.MS_GRAPH_CLIENT_SECRET?.trim();

  if (
    !tenantId ||
    !clientId ||
    !clientSecret
  ) {
    throw new Error(
      "Microsoft 365 email delivery is not configured. " +
        "MS_GRAPH_TENANT_ID, MS_GRAPH_CLIENT_ID and " +
        "MS_GRAPH_CLIENT_SECRET are required."
    );
  }

  const tokenUrl =
    `https://login.microsoftonline.com/${encodeURIComponent(
      tenantId
    )}/oauth2/v2.0/token`;

  const params =
    new URLSearchParams({
      client_id:
        clientId,
      client_secret:
        clientSecret,
      scope:
        "https://graph.microsoft.com/.default",
      grant_type:
        "client_credentials",
    });

  const response =
    await fetch(
      tokenUrl,
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/x-www-form-urlencoded",
        },
        body:
          params.toString(),
        cache:
          "no-store",
      }
    );

  const body =
    (await response.json()) as
      GraphTokenResponse;

  if (
    !response.ok ||
    !body.access_token
  ) {
    throw new Error(
      body.error_description ||
        body.error ||
        `Microsoft Graph authentication failed with HTTP ${response.status}.`
    );
  }

  return body.access_token;
}

async function sendMicrosoftGraphEmail(input: {
  recipient: string;
  subject: string;
  text: string;
  html?: string;
  attachments: DeliveryAttachment[];
  deliveryLogId: string;
}): Promise<{
  acknowledgementId: string | null;
}> {
  const sender =
    process.env.MS_GRAPH_SENDER?.trim();

  if (!sender) {
    throw new Error(
      "Microsoft 365 sender is not configured. " +
        "MS_GRAPH_SENDER is required."
    );
  }

  const accessToken =
    await getMicrosoftGraphAccessToken();

  const graphUrl =
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(
      sender
    )}/sendMail`;

  const message = {
    message: {
      subject:
        sanitizeHeader(
          input.subject
        ),

      body: {
        contentType:
          input.html
            ? "HTML"
            : "Text",
        content:
          input.html ??
          input.text,
      },

      toRecipients: [
        {
          emailAddress: {
            address:
              input.recipient,
          },
        },
      ],

      internetMessageHeaders: [
        {
          name:
            "x-tms-delivery-log-id",
          value:
            input.deliveryLogId,
        },
      ],

      attachments:
        input.attachments.map(
          (attachment) => ({
            "@odata.type":
              "#microsoft.graph.fileAttachment",

            name:
              attachment.filename,

            contentType:
              attachment.contentType ??
              "application/octet-stream",

            contentBytes:
              attachment.content.toString(
                "base64"
              ),
          })
        ),
    },

    saveToSentItems:
      true,
  };

  const response =
    await fetch(
      graphUrl,
      {
        method:
          "POST",

        headers: {
          Authorization:
            `Bearer ${accessToken}`,

          "Content-Type":
            "application/json",

          Accept:
            "application/json",
        },

        body:
          JSON.stringify(message),

        cache:
          "no-store",
      }
    );

  if (response.status !== 202) {
    const responseText =
      await response.text();

    let detail =
      responseText.trim();

    if (detail) {
      try {
        const parsed =
          JSON.parse(detail) as {
            error?: {
              code?: string;
              message?: string;
            };
          };

        const code =
          parsed.error?.code;

        const message =
          parsed.error?.message;

        detail = [
          code,
          message,
        ]
          .filter(Boolean)
          .join(": ");
      } catch {
        // Keep Graph response text.
      }
    }

    throw new Error(
      detail ||
        `Microsoft Graph sendMail failed with HTTP ${response.status}.`
    );
  }

  const acknowledgementId =
    response.headers.get(
      "request-id"
    ) ??
    response.headers.get(
      "x-ms-request-id"
    ) ??
    response.headers.get(
      "client-request-id"
    );

  return {
    acknowledgementId,
  };
}

export async function sendLoggedDocumentEmail(
  input: SendLoggedDocumentEmailInput
): Promise<SendLoggedDocumentEmailResult> {
  const sender =
    process.env.MS_GRAPH_SENDER?.trim();

  if (!sender) {
    throw new Error(
      "Microsoft 365 sender is not configured. " +
        "MS_GRAPH_SENDER is required."
    );
  }

  const attachments =
    input.attachments ?? [];

  const manifest =
    attachmentManifest(
      attachments
    );

  const metadata = {
    ...(input.metadata ?? {}),
    mailProvider:
      "microsoft_graph",
    sender,
  };

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
        "microsoft_graph",

      share_reference:
        input.shareReference ?? null,

      attachments:
        manifest,

      metadata,

      initiated_by:
        input.initiatedBy ?? null,
    })
    .select("id")
    .single();

  if (
    pendingLogError ||
    !pendingLog?.id
  ) {
    throw new Error(
      pendingLogError?.message ||
        "Unable to create document delivery log."
    );
  }

  const deliveryLogId =
    String(
      pendingLog.id
    );

  try {
    const result =
      await sendMicrosoftGraphEmail({
        recipient:
          input.recipient,
        subject:
          input.subject,
        text:
          input.text,
        html:
          input.html,
        attachments,
        deliveryLogId,
      });

    const {
      error: successLogError,
    } = await input.admin
      .from("document_delivery_log")
      .update({
        status:
          "success",

        provider_message_id:
          result.acknowledgementId,

        error_message:
          null,

        metadata: {
          ...metadata,
          providerAcknowledged:
            true,
          providerHttpStatus:
            202,
          acknowledgementType:
            "microsoft_graph_request_id",
        },
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
      providerMessageId:
        result.acknowledgementId,
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to send document email through Microsoft 365.";

    try {
      await input.admin
        .from("document_delivery_log")
        .update({
          status:
            "error",

          error_message:
            message,

          metadata: {
            ...metadata,
            providerAcknowledged:
              false,
          },
        })
        .eq(
          "id",
          deliveryLogId
        )
        .eq(
          "tenant_id",
          input.tenantId
        );
    } catch {
      // Preserve the original delivery failure.
    }

    throw error;
  }
}