import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";

type QuotePdfLine = {
  description: string;
  quantity: number;
  unitPrice: number;
  vatRate: number;
  lineTotal: number;
};

type GenerateQuotationPdfInput = {
  companyName: string;
  customerName: string;
  quoteNumber: string;
  quoteDate: string | null;
  validUntil: string | null;
  currency: string;
  subtotal: number;
  vatTotal: number;
  total: number;
  notes?: string | null;
  customerReference?: string | null;
  poReference?: string | null;
  lines: QuotePdfLine[];
  termsSnapshot?: string | null;
};

type PdfContext = {
  pdf: PDFDocument;
  page: PDFPage;
  font: PDFFont;
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
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number
): string[] {
  const normalized =
    text.replace(/\r/g, "");

  const paragraphs =
    normalized.split("\n");

  const output: string[] = [];

  for (const paragraph of paragraphs) {
    if (!paragraph.trim()) {
      output.push("");
      continue;
    }

    const words =
      paragraph.split(/\s+/);

    let current = "";

    for (const word of words) {
      const candidate =
        current
          ? `${current} ${word}`
          : word;

      if (
        font.widthOfTextAtSize(
          candidate,
          size
        ) <= maxWidth
      ) {
        current = candidate;
        continue;
      }

      if (current) {
        output.push(current);
      }

      current = word;
    }

    if (current) {
      output.push(current);
    }
  }

  return output;
}

function newPage(
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
  requiredHeight: number
) {
  if (
    context.y - requiredHeight <
    MARGIN
  ) {
    newPage(context);
  }
}

function drawLine(
  context: PdfContext,
  text: string,
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
      : context.font;

  const indent =
    options?.indent ?? 0;

  const lines =
    splitText(
      text,
      font,
      size,
      CONTENT_WIDTH - indent
    );

  const lineHeight =
    size * 1.35;

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
            rgb(0.08, 0.08, 0.08),
        }
      );
    }

    context.y -= lineHeight;
  }

  context.y -=
    options?.gapAfter ?? 2;
}

export async function generateQuotationPdf(
  input: GenerateQuotationPdfInput
): Promise<{
  bytes: Uint8Array;
  filename: string;
}> {
  const pdf =
    await PDFDocument.create();

  const font =
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
    font,
    bold,
    y:
      PAGE_HEIGHT - MARGIN,
  };

  drawLine(
    context,
    input.companyName,
    {
      size: 18,
      bold: true,
      gapAfter: 8,
    }
  );

  drawLine(
    context,
    "QUOTATION",
    {
      size: 16,
      bold: true,
      gapAfter: 10,
    }
  );

  drawLine(
    context,
    `Quotation: ${input.quoteNumber}`,
    {
      bold: true,
    }
  );

  drawLine(
    context,
    `Customer: ${input.customerName}`
  );

  drawLine(
    context,
    `Quote date: ${input.quoteDate ?? "—"}`
  );

  drawLine(
    context,
    `Valid until: ${input.validUntil ?? "—"}`,
    {
      gapAfter: 8,
    }
  );

  if (input.customerReference) {
    drawLine(
      context,
      `Customer reference: ${input.customerReference}`
    );
  }

  if (input.poReference) {
    drawLine(
      context,
      `PO reference: ${input.poReference}`,
      {
        gapAfter: 8,
      }
    );
  }

  drawLine(
    context,
    "Items",
    {
      size: 13,
      bold: true,
      gapAfter: 5,
    }
  );

  input.lines.forEach(
    (line, index) => {
      drawLine(
        context,
        `${index + 1}. ${line.description}`,
        {
          bold: true,
        }
      );

      drawLine(
        context,
        `Qty ${line.quantity} × ${money(
          line.unitPrice,
          input.currency
        )} | VAT ${line.vatRate}% | ${money(
          line.lineTotal,
          input.currency
        )}`,
        {
          indent: 12,
          gapAfter: 5,
        }
      );
    }
  );

  context.y -= 5;

  drawLine(
    context,
    `Subtotal: ${money(
      input.subtotal,
      input.currency
    )}`,
    {
      bold: true,
    }
  );

  drawLine(
    context,
    `VAT: ${money(
      input.vatTotal,
      input.currency
    )}`,
    {
      bold: true,
    }
  );

  drawLine(
    context,
    `TOTAL: ${money(
      input.total,
      input.currency
    )}`,
    {
      size: 13,
      bold: true,
      gapAfter: 12,
    }
  );

  if (input.notes?.trim()) {
    drawLine(
      context,
      "Notes",
      {
        size: 12,
        bold: true,
      }
    );

    drawLine(
      context,
      input.notes.trim(),
      {
        gapAfter: 10,
      }
    );
  }

  if (input.termsSnapshot?.trim()) {
    ensureSpace(
      context,
      60
    );

    drawLine(
      context,
      "Terms and Conditions",
      {
        size: 13,
        bold: true,
        gapAfter: 8,
      }
    );

    drawLine(
      context,
      input.termsSnapshot.trim(),
      {
        size: 8.5,
      }
    );
  }

  const bytes =
    await pdf.save();

  const safeNumber =
    input.quoteNumber
      .replace(
        /[^A-Za-z0-9._-]+/g,
        "-"
      );

  return {
    bytes,
    filename:
      `Quotation-${safeNumber}.pdf`,
  };
}