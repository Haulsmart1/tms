export type DocumentEmailSummaryRow = {
  label: string;
  value: string;
};

export type DocumentEmailInput = {
  companyName: string;
  recipientName?: string | null;
  title: string;
  intro: string;
  summaryRows?: DocumentEmailSummaryRow[];
  attachmentText?: string | null;
  actionLabel?: string | null;
  actionUrl?: string | null;
  footerText?: string | null;
};

export function escapeHtml(
  value: unknown
): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function buildDocumentEmailHtml(
  input: DocumentEmailInput
): string {
  const companyName =
    escapeHtml(
      input.companyName
    );

  const recipientName =
    escapeHtml(
      input.recipientName?.trim() ||
      "there"
    );

  const title =
    escapeHtml(
      input.title
    );

  const intro =
    escapeHtml(
      input.intro
    );

  const attachmentText =
    input.attachmentText
      ? escapeHtml(
          input.attachmentText
        )
      : "";

  const footerText =
    escapeHtml(
      input.footerText?.trim() ||
      "Thank you for your business."
    );

  const rows =
    (input.summaryRows ?? [])
      .filter(
        (row) =>
          row.label.trim() &&
          row.value.trim()
      )
      .map(
        (row) => `
          <tr>
            <td
              style="
                padding:12px 14px;
                border-bottom:1px solid #e2e8f0;
              "
            >
              <div
                style="
                  margin:0 0 4px;
                  color:#64748b;
                  font-size:11px;
                  line-height:1.35;
                  font-weight:700;
                  text-transform:uppercase;
                  letter-spacing:.4px;
                "
              >
                ${escapeHtml(row.label)}
              </div>

              <div
                style="
                  margin:0;
                  color:#0f172a;
                  font-size:14px;
                  line-height:1.45;
                  font-weight:700;
                  overflow-wrap:anywhere;
                  word-break:break-word;
                "
              >
                ${escapeHtml(row.value)}
              </div>
            </td>
          </tr>
        `
      )
      .join("");

  const actionUrl =
    input.actionUrl?.trim() ||
    "";

  const actionLabel =
    input.actionLabel?.trim() ||
    "";

  const actionHtml =
    actionUrl &&
    actionLabel
      ? `
        <table
          role="presentation"
          width="100%"
          cellspacing="0"
          cellpadding="0"
          border="0"
          style="
            width:100%;
            margin:28px 0 14px;
          "
        >
          <tr>
            <td align="center">
              <table
                role="presentation"
                cellspacing="0"
                cellpadding="0"
                border="0"
              >
                <tr>
                  <td
                    align="center"
                    bgcolor="#b47a00"
                    style="
                      border-radius:6px;
                    "
                  >
                    <a
                      href="${escapeHtml(actionUrl)}"
                      style="
                        display:inline-block;
                        background:#b47a00;
                        color:#ffffff;
                        text-decoration:none;
                        font-size:14px;
                        line-height:18px;
                        font-weight:700;
                        padding:13px 22px;
                        border-radius:6px;
                      "
                    >
                      ${escapeHtml(actionLabel)}
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      `
      : "";

  return `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta
      name="viewport"
      content="width=device-width,initial-scale=1"
    >
  </head>

  <body
    style="
      margin:0;
      padding:0;
      background:#f1f5f9;
      font-family:
        Arial,
        Helvetica,
        sans-serif;
      color:#0f172a;
    "
  >
    <table
      role="presentation"
      width="100%"
      cellspacing="0"
      cellpadding="0"
      border="0"
      style="
        width:100%;
        background:#f1f5f9;
      "
    >
      <tr>
        <td
          align="center"
          style="
            padding:30px 14px;
          "
        >
          <table
            role="presentation"
            width="100%"
            cellspacing="0"
            cellpadding="0"
            border="0"
            style="
              width:100%;
              max-width:660px;
              background:#ffffff;
              border-radius:10px;
              overflow:hidden;
              box-shadow:
                0 1px 4px
                rgba(15,23,42,.12);
            "
          >

            <tr>
              <td
                style="
                  background:#081a33;
                  padding:24px 28px;
                  border-bottom:
                    4px solid #d39b19;
                "
              >
                <div
                  style="
                    color:#ffffff;
                    font-size:20px;
                    font-weight:700;
                    letter-spacing:.3px;
                  "
                >
                  ${companyName}
                </div>

                <div
                  style="
                    color:#d39b19;
                    font-size:11px;
                    font-weight:700;
                    letter-spacing:1.8px;
                    margin-top:5px;
                  "
                >
                  SAFE. SECURE. RELIABLE.
                </div>
              </td>
            </tr>

            <tr>
              <td
                style="
                  padding:30px;
                "
              >
                <h1
                  style="
                    margin:0 0 18px;
                    color:#081a33;
                    font-size:24px;
                    line-height:1.25;
                    font-weight:700;
                  "
                >
                  ${title}
                </h1>

                <p
                  style="
                    margin:0 0 14px;
                    color:#334155;
                    font-size:14px;
                    line-height:1.65;
                  "
                >
                  Hi ${recipientName},
                </p>

                <p
                  style="
                    margin:0 0 22px;
                    color:#334155;
                    font-size:14px;
                    line-height:1.65;
                  "
                >
                  ${intro}
                </p>

                ${
                  rows
                    ? `
                      <table
                        role="presentation"
                        width="100%"
                        cellspacing="0"
                        cellpadding="0"
                        border="0"
                        style="
                          width:100%;
                          border:1px solid #e2e8f0;
                          border-radius:7px;
                          overflow:hidden;
                          margin:0 0 20px;
                        "
                      >
                        ${rows}
                      </table>
                    `
                    : ""
                }

                ${
                  attachmentText
                    ? `
                      <div
                        style="
                          margin:18px 0;
                          padding:13px 15px;
                          background:#f8fafc;
                          border-left:
                            4px solid #d39b19;
                          color:#475569;
                          font-size:13px;
                          line-height:1.55;
                        "
                      >
                        ${attachmentText}
                      </div>
                    `
                    : ""
                }

                ${actionHtml}

                <p
                  style="
                    margin:24px 0 0;
                    color:#475569;
                    font-size:13px;
                    line-height:1.6;
                  "
                >
                  ${footerText}
                </p>

                <p
                  style="
                    margin:20px 0 0;
                    color:#334155;
                    font-size:13px;
                    line-height:1.6;
                  "
                >
                  Kind regards,<br>
                  <strong>
                    ${companyName}
                  </strong>
                </p>
              </td>
            </tr>

            <tr>
              <td
                style="
                  background:#081a33;
                  color:#cbd5e1;
                  text-align:center;
                  font-size:11px;
                  line-height:1.5;
                  padding:14px 20px;
                "
              >
                ${companyName}
                &nbsp;&bull;&nbsp;
                Professional transport services
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`.trim();
}