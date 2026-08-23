import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";

export type InvoicePdfLine = {
  description: string;
  quantity: number;
  unitPrice: number;
  vatRate: number;
  netAmount: number;
  vatAmount: number;
  grossAmount: number;
};

export type GenerateInvoicePdfInput = {
  companyName: string;
  customerName: string;
  invoiceNumber: string;
  issueDate: string | null;
  dueDate: string | null;
  currency: string;
  poReference?: string | null;
  customerReference?: string | null;
  notes?: string | null;
  subtotal: number;
  vatTotal: number;
  total: number;
  amountPaid: number;
  creditTotal: number;
  balanceDue: number;
  lines: InvoicePdfLine[];
};

type PdfContext = {
  pdf: PDFDocument;
  page: PDFPage;
  normal: PDFFont;
  bold: PDFFont;
  y: number;
};

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 48;
const CONTENT_WIDTH =
  PAGE_WIDTH - MARGIN * 2;

function money(
  value: number,
  currency: string
): string {
  return new Intl.NumberFormat(
    "en-GB",
    {
      style: "currency",
      currency:
        currency || "GBP",
    }
  ).format(value);
}

function splitText(
  value: string,
  font: PDFFont,
  size: number,
  maxWidth: number
): string[] {
  const paragraphs =
    value
      .replace(/\r/g, "")
      .split("\n");

  const output: string[] = [];

  for (const paragraph of paragraphs) {
    if (!paragraph.trim()) {
      output.push("");
      continue;
    }

    const words =
      paragraph.split(/\s+/);

    let line = "";

    for (const word of words) {
      const candidate =
        line
          ? `${line} ${word}`
          : word;

      if (
        font.widthOfTextAtSize(
          candidate,
          size
        ) <= maxWidth
      ) {
        line = candidate;
        continue;
      }

      if (line) {
        output.push(line);
      }

      line = word;
    }

    if (line) {
      output.push(line);
    }
  }

  return output;
}

function addPage(
  context: PdfContext
) {
  context.page =
    context.pdf.addPage([
      PAGE_WIDTH,
      PAGE_HEIGHT,
    ]);

  context.y =
    PAGE_HEIGHT - MARGIN;
}

function ensureSpace(
  context: PdfContext,
  height: number
) {
  if (
    context.y - height <
    MARGIN
  ) {
    addPage(context);
  }
}

function drawText(
  context: PdfContext,
  value: string,
  options?: {
    size?: number;
    bold?: boolean;
    indent?: number;
    gapAfter?: number;
  }
) {
  const size =
    options?.size ?? 10;

  const font =
    options?.bold
      ? context.bold
      : context.normal;

  const indent =
    options?.indent ?? 0;

  const lineHeight =
    size * 1.35;

  const lines =
    splitText(
      value,
      font,
      size,
      CONTENT_WIDTH - indent
    );

  for (const line of lines) {
    ensureSpace(
      context,
      lineHeight
    );

    if (line) {
      context.page.drawText(
        line,
        {
          x:
            MARGIN + indent,
          y:
            context.y,
          size,
          font,
          color:
            rgb(
              0.08,
              0.08,
              0.08
            ),
        }
      );
    }

    context.y -=
      lineHeight;
  }

  context.y -=
    options?.gapAfter ?? 2;
}

export async function generateInvoicePdf(
  input: GenerateInvoicePdfInput
): Promise<{
  bytes: Uint8Array;
  filename: string;
}> {
  const pdf =
    await PDFDocument.create();

  const normal =
    await pdf.embedFont(
      StandardFonts.Helvetica
    );

  const bold =
    await pdf.embedFont(
      StandardFonts.HelveticaBold
    );

  const context: PdfContext = {
    pdf,
    page:
      pdf.addPage([
        PAGE_WIDTH,
        PAGE_HEIGHT,
      ]),
    normal,
    bold,
    y:
      PAGE_HEIGHT - MARGIN,
  };

  drawText(
    context,
    input.companyName,
    {
      size: 18,
      bold: true,
      gapAfter: 8,
    }
  );

  drawText(
    context,
    "INVOICE",
    {
      size: 16,
      bold: true,
      gapAfter: 10,
    }
  );

  drawText(
    context,
    `Invoice: ${input.invoiceNumber}`,
    {
      bold: true,
    }
  );

  drawText(
    context,
    `Customer: ${input.customerName}`
  );

  drawText(
    context,
    `Issue date: ${input.issueDate ?? "-"}`
  );

  drawText(
    context,
    `Due date: ${input.dueDate ?? "-"}`,
    {
      gapAfter: 8,
    }
  );

  if (input.poReference) {
    drawText(
      context,
      `PO reference: ${input.poReference}`
    );
  }

  if (input.customerReference) {
    drawText(
      context,
      `Customer reference: ${input.customerReference}`,
      {
        gapAfter: 8,
      }
    );
  }

  drawText(
    context,
    "Invoice lines",
    {
      size: 13,
      bold: true,
      gapAfter: 5,
    }
  );

  input.lines.forEach(
    (line, index) => {
      drawText(
        context,
        `${index + 1}. ${line.description}`,
        {
          bold: true,
        }
      );

      drawText(
        context,
        [
          `Qty ${line.quantity}`,
          `Unit ${money(
            line.unitPrice,
            input.currency
          )}`,
          `VAT ${line.vatRate}%`,
          `Net ${money(
            line.netAmount,
            input.currency
          )}`,
          `Gross ${money(
            line.grossAmount,
            input.currency
          )}`,
        ].join(" | "),
        {
          indent: 12,
          gapAfter: 5,
        }
      );
    }
  );

  context.y -= 6;

  drawText(
    context,
    `Subtotal: ${money(
      input.subtotal,
      input.currency
    )}`,
    {
      bold: true,
    }
  );

  drawText(
    context,
    `VAT: ${money(
      input.vatTotal,
      input.currency
    )}`,
    {
      bold: true,
    }
  );

  drawText(
    context,
    `Total: ${money(
      input.total,
      input.currency
    )}`,
    {
      size: 13,
      bold: true,
      gapAfter: 5,
    }
  );

  drawText(
    context,
    `Payments received: ${money(
      input.amountPaid,
      input.currency
    )}`
  );

  drawText(
    context,
    `Credits applied: ${money(
      input.creditTotal,
      input.currency
    )}`
  );

  drawText(
    context,
    `Balance due: ${money(
      input.balanceDue,
      input.currency
    )}`,
    {
      size: 12,
      bold: true,
      gapAfter: 10,
    }
  );

  if (input.notes?.trim()) {
    drawText(
      context,
      "Notes",
      {
        size: 12,
        bold: true,
      }
    );

    drawText(
      context,
      input.notes.trim()
    );
  }

  const bytes =
    await pdf.save();

  const safeNumber =
    input.invoiceNumber.replace(
      /[^A-Za-z0-9._-]+/g,
      "-"
    );

  return {
    bytes,
    filename:
      `Invoice-${safeNumber}.pdf`,
  };
}