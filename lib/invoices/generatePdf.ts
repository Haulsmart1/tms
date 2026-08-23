import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
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

export type InvoicePdfJob = {
  reference: string | null;
  externalReference?: string | null;
  customerReference?: string | null;
  podStatus?: string | null;
};

export type InvoicePdfCompanyProfile = {
  company_name?: string | null;
  trading_name?: string | null;
  address_line_1?: string | null;
  address_line_2?: string | null;
  city?: string | null;
  region?: string | null;
  postcode?: string | null;
  country_code?: string | null;
  business_phone?: string | null;
  business_email?: string | null;
  website?: string | null;
  registration_number?: string | null;
  vat_number?: string | null;
};

export type InvoicePdfDocumentSettings = {
  show_logo?: boolean | null;
  logo_signed_url?: string | null;
  show_contact_details?: boolean | null;
  show_company_registration?: boolean | null;
  show_vat_number?: boolean | null;
  bank_details?: string | null;
};

export type GenerateInvoicePdfInput = {
  companyName: string;
  companyProfile?: InvoicePdfCompanyProfile | null;
  documentSettings?: InvoicePdfDocumentSettings | null;
  customerName: string;
  invoiceNumber: string;
  status?: string | null;
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
  jobs?: InvoicePdfJob[];
};

type Context = {
  pdf: PDFDocument;
  page: PDFPage;
  normal: PDFFont;
  bold: PDFFont;
  y: number;
};

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 42;
const RIGHT = PAGE_WIDTH - MARGIN;
const WIDTH = PAGE_WIDTH - MARGIN * 2;

function money(
  value: number,
  currency: string
): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: currency || "GBP",
  }).format(value);
}

function date(value: string | null): string {
  if (!value) {
    return "-";
  }

  const parsed = new Date(`${value}T00:00:00Z`);

  if (!Number.isFinite(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}

function clean(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

function splitText(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number
): string[] {
  const output: string[] = [];

  for (
    const paragraph of text.replace(/\r/g, "").split("\n")
  ) {
    if (!paragraph.trim()) {
      output.push("");
      continue;
    }

    let current = "";

    for (const word of paragraph.split(/\s+/)) {
      const candidate =
        current ? `${current} ${word}` : word;

      if (
        font.widthOfTextAtSize(candidate, size) <=
        maxWidth
      ) {
        current = candidate;
      } else {
        if (current) {
          output.push(current);
        }

        current = word;
      }
    }

    if (current) {
      output.push(current);
    }
  }

  return output;
}

function addPage(context: Context) {
  context.page =
    context.pdf.addPage([
      PAGE_WIDTH,
      PAGE_HEIGHT,
    ]);

  context.y = PAGE_HEIGHT - MARGIN;
}

function ensureSpace(
  context: Context,
  required: number
) {
  if (context.y - required < MARGIN) {
    addPage(context);
  }
}

function drawText(
  context: Context,
  text: string,
  options?: {
    x?: number;
    y?: number;
    size?: number;
    bold?: boolean;
    maxWidth?: number;
    gapAfter?: number;
  }
): number {
  const size = options?.size ?? 9;
  const font =
    options?.bold
      ? context.bold
      : context.normal;

  const x = options?.x ?? MARGIN;
  let y = options?.y ?? context.y;

  const maxWidth =
    options?.maxWidth ??
    RIGHT - x;

  const lines =
    splitText(
      text,
      font,
      size,
      maxWidth
    );

  const lineHeight = size * 1.35;

  for (const line of lines) {
    ensureSpace(context, lineHeight);

    if (line) {
      context.page.drawText(line, {
        x,
        y,
        size,
        font,
        color: rgb(
          0.08,
          0.11,
          0.17
        ),
      });
    }

    y -= lineHeight;
  }

  if (options?.y === undefined) {
    context.y =
      y - (options?.gapAfter ?? 2);
  }

  return y;
}

function drawRule(
  context: Context,
  y: number
) {
  context.page.drawLine({
    start: {
      x: MARGIN,
      y,
    },
    end: {
      x: RIGHT,
      y,
    },
    thickness: 0.7,
    color: rgb(
      0.82,
      0.84,
      0.87
    ),
  });
}

function rightText(
  context: Context,
  text: string,
  y: number,
  options?: {
    size?: number;
    bold?: boolean;
    right?: number;
  }
) {
  const size =
    options?.size ?? 9;

  const font =
    options?.bold
      ? context.bold
      : context.normal;

  const right =
    options?.right ?? RIGHT;

  const width =
    font.widthOfTextAtSize(
      text,
      size
    );

  context.page.drawText(text, {
    x: right - width,
    y,
    size,
    font,
    color: rgb(
      0.08,
      0.11,
      0.17
    ),
  });
}

async function loadLogo(
  pdf: PDFDocument,
  url: string | null | undefined
): Promise<PDFImage | null> {
  if (!url) {
    return null;
  }

  try {
    const response =
      await fetch(url, {
        cache: "no-store",
      });

    if (!response.ok) {
      return null;
    }

    const bytes =
      new Uint8Array(
        await response.arrayBuffer()
      );

    const contentType =
      response.headers
        .get("content-type")
        ?.toLowerCase() ?? "";

    if (
      contentType.includes("png") ||
      url.toLowerCase().includes(".png")
    ) {
      return await pdf.embedPng(bytes);
    }

    return await pdf.embedJpg(bytes);
  } catch {
    return null;
  }
}

function drawTotals(
  context: Context,
  input: GenerateInvoicePdfInput
) {
  ensureSpace(context, 125);

  const labelX = 340;
  const valueRight = RIGHT;

  const rows = [
    ["Subtotal", money(input.subtotal, input.currency)],
    ["VAT", money(input.vatTotal, input.currency)],
  ];

  for (const [label, value] of rows) {
    context.page.drawText(label, {
      x: labelX,
      y: context.y,
      size: 9,
      font: context.normal,
    });

    rightText(
      context,
      value,
      context.y,
      {
        bold: true,
        right: valueRight,
      }
    );

    context.y -= 18;
  }

  drawRule(
    context,
    context.y + 6
  );

  context.page.drawText("Total", {
    x: labelX,
    y: context.y - 4,
    size: 12,
    font: context.normal,
  });

  rightText(
    context,
    money(
      input.total,
      input.currency
    ),
    context.y - 4,
    {
      size: 12,
      bold: true,
      right: valueRight,
    }
  );

  context.y -= 28;

  context.page.drawText(
    "Balance due",
    {
      x: labelX,
      y: context.y,
      size: 10,
      font: context.normal,
    }
  );

  rightText(
    context,
    money(
      input.balanceDue,
      input.currency
    ),
    context.y,
    {
      size: 11,
      bold: true,
      right: valueRight,
    }
  );

  context.y -= 28;
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

  const context: Context = {
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

  const profile =
    input.companyProfile ?? {};

  const settings =
    input.documentSettings ?? {};

  const logo =
    settings.show_logo !== false
      ? await loadLogo(
          pdf,
          settings.logo_signed_url
        )
      : null;

  let headerTextX = MARGIN;

  if (logo) {
    const scale =
      Math.min(
        70 / logo.height,
        78 / logo.width
      );

    const logoWidth =
      logo.width * scale;

    const logoHeight =
      logo.height * scale;

    context.page.drawImage(
      logo,
      {
        x: MARGIN,
        y:
          PAGE_HEIGHT -
          MARGIN -
          logoHeight,
        width:
          logoWidth,
        height:
          logoHeight,
      }
    );

    headerTextX =
      MARGIN + logoWidth + 16;
  }

  const displayCompany =
    clean(
      profile.company_name
    ) ||
    clean(
      profile.trading_name
    ) ||
    input.companyName;

  context.page.drawText(
    displayCompany,
    {
      x: headerTextX,
      y:
        PAGE_HEIGHT -
        MARGIN -
        13,
      size: 11,
      font: bold,
    }
  );

  const address =
    [
      profile.address_line_1,
      profile.address_line_2,
      profile.city,
      profile.region,
      profile.postcode,
      profile.country_code,
    ]
      .map(clean)
      .filter(Boolean)
      .join(", ");

  let headerY =
    PAGE_HEIGHT -
    MARGIN -
    30;

  if (address) {
    const lines =
      splitText(
        address,
        normal,
        7.5,
        285
      );

    for (const line of lines) {
      context.page.drawText(
        line,
        {
          x: headerTextX,
          y: headerY,
          size: 7.5,
          font: normal,
        }
      );

      headerY -= 10;
    }
  }

  if (
    settings.show_contact_details !==
    false
  ) {
    const contacts =
      [
        clean(
          profile.business_phone
        )
          ? `Tel: ${clean(
              profile.business_phone
            )}`
          : "",
        clean(
          profile.business_email
        )
          ? `Email: ${clean(
              profile.business_email
            )}`
          : "",
        clean(profile.website),
      ]
        .filter(Boolean)
        .join("   ");

    if (contacts) {
      context.page.drawText(
        contacts,
        {
          x: headerTextX,
          y: headerY - 2,
          size: 7.2,
          font: normal,
        }
      );
    }
  }

  if (
    settings.show_company_registration !==
      false &&
    clean(
      profile.registration_number
    )
  ) {
    rightText(
      context,
      `Company No: ${clean(
        profile.registration_number
      )}`,
      PAGE_HEIGHT - MARGIN - 14,
      {
        size: 7,
      }
    );
  }

  if (
    settings.show_vat_number !==
      false &&
    clean(profile.vat_number)
  ) {
    rightText(
      context,
      `VAT No: ${clean(
        profile.vat_number
      )}`,
      PAGE_HEIGHT - MARGIN - 27,
      {
        size: 7,
      }
    );
  }

  context.y =
    PAGE_HEIGHT - 148;

  drawRule(
    context,
    context.y + 18
  );

  drawText(
    context,
    "Invoice",
    {
      size: 22,
      bold: true,
      gapAfter: 3,
    }
  );

  drawText(
    context,
    input.invoiceNumber,
    {
      size: 14,
      gapAfter: 12,
    }
  );

  const detailTop =
    context.y;

  drawText(
    context,
    "CUSTOMER",
    {
      size: 7,
      bold: true,
      gapAfter: 4,
    }
  );

  drawText(
    context,
    input.customerName,
    {
      size: 10,
      bold: true,
      gapAfter: 8,
    }
  );

  drawText(
    context,
    "CUSTOMER REFERENCE",
    {
      size: 7,
      bold: true,
      gapAfter: 3,
    }
  );

  drawText(
    context,
    clean(
      input.customerReference
    ) || "-",
    {
      size: 9,
      gapAfter: 8,
    }
  );

  drawText(
    context,
    "PO REFERENCE",
    {
      size: 7,
      bold: true,
      gapAfter: 3,
    }
  );

  drawText(
    context,
    clean(
      input.poReference
    ) || "-",
    {
      size: 9,
    }
  );

  const leftBottom =
    context.y;

  const rightX = 382;

  context.page.drawText(
    "ISSUE DATE",
    {
      x: rightX,
      y: detailTop,
      size: 7,
      font: bold,
    }
  );

  rightText(
    context,
    date(input.issueDate),
    detailTop - 14,
    {
      size: 9,
    }
  );

  context.page.drawText(
    "DUE DATE",
    {
      x: rightX,
      y: detailTop - 42,
      size: 7,
      font: bold,
    }
  );

  rightText(
    context,
    date(input.dueDate),
    detailTop - 56,
    {
      size: 9,
    }
  );

  context.page.drawText(
    "STATUS",
    {
      x: rightX,
      y: detailTop - 84,
      size: 7,
      font: bold,
    }
  );

  rightText(
    context,
    clean(input.status)
      ? clean(input.status)
          .replaceAll("_", " ")
          .replace(
            /^\w/,
            (letter) =>
              letter.toUpperCase()
          )
      : "Invoice",
    detailTop - 98,
    {
      size: 9,
    }
  );

  context.y =
    Math.min(
      leftBottom,
      detailTop - 112
    ) - 12;

  drawRule(
    context,
    context.y + 8
  );

  if (
    input.jobs &&
    input.jobs.length > 0
  ) {
    drawText(
      context,
      "JOBS / RMA REFERENCES",
      {
        size: 7,
        bold: true,
        gapAfter: 7,
      }
    );

    for (const job of input.jobs) {
      ensureSpace(
        context,
        38
      );

      const reference =
        clean(job.reference) ||
        "Job";

      context.page.drawRectangle({
        x: MARGIN,
        y: context.y - 28,
        width: 172,
        height: 34,
        borderWidth: 0.7,
        borderColor:
          rgb(
            0.82,
            0.84,
            0.87
          ),
      });

      context.page.drawText(
        reference,
        {
          x: MARGIN + 8,
          y: context.y - 6,
          size: 8,
          font: bold,
        }
      );

      const secondary =
        clean(
          job.externalReference
        ) ||
        clean(
          job.customerReference
        );

      if (secondary) {
        context.page.drawText(
          secondary,
          {
            x: MARGIN + 8,
            y: context.y - 17,
            size: 6.8,
            font: normal,
          }
        );
      }

      if (
        clean(job.podStatus)
      ) {
        context.page.drawText(
          `POD: ${clean(
            job.podStatus
          )}`,
          {
            x: MARGIN + 8,
            y: context.y - 27,
            size: 6.8,
            font: normal,
          }
        );
      }

      context.y -= 42;
    }

    context.y -= 4;
  }

  ensureSpace(
    context,
    100
  );

  const tableTop =
    context.y;

  context.page.drawRectangle({
    x: MARGIN,
    y: tableTop - 20,
    width: WIDTH,
    height: 22,
    color:
      rgb(
        0.95,
        0.96,
        0.97
      ),
  });

  const columns = {
    description: MARGIN + 8,
    qty: 350,
    rate: 405,
    vat: 463,
    net: RIGHT - 8,
  };

  context.page.drawText(
    "Description",
    {
      x: columns.description,
      y: tableTop - 13,
      size: 7.5,
      font: bold,
    }
  );

  context.page.drawText(
    "Qty",
    {
      x: columns.qty,
      y: tableTop - 13,
      size: 7.5,
      font: bold,
    }
  );

  context.page.drawText(
    "Rate",
    {
      x: columns.rate,
      y: tableTop - 13,
      size: 7.5,
      font: bold,
    }
  );

  context.page.drawText(
    "VAT",
    {
      x: columns.vat,
      y: tableTop - 13,
      size: 7.5,
      font: bold,
    }
  );

  rightText(
    context,
    "Net",
    tableTop - 13,
    {
      size: 7.5,
      bold: true,
      right: columns.net,
    }
  );

  context.y =
    tableTop - 31;

  for (
    const line of input.lines
  ) {
    const descriptionLines =
      splitText(
        line.description,
        normal,
        8,
        295
      );

    const rowHeight =
      Math.max(
        28,
        descriptionLines.length *
          10 +
          12
      );

    ensureSpace(
      context,
      rowHeight + 8
    );

    let descriptionY =
      context.y;

    for (
      const descriptionLine of
      descriptionLines
    ) {
      context.page.drawText(
        descriptionLine,
        {
          x:
            columns.description,
          y:
            descriptionY,
          size: 8,
          font: normal,
        }
      );

      descriptionY -= 10;
    }

    context.page.drawText(
      String(line.quantity),
      {
        x: columns.qty,
        y: context.y,
        size: 8,
        font: normal,
      }
    );

    context.page.drawText(
      money(
        line.unitPrice,
        input.currency
      ),
      {
        x: columns.rate,
        y: context.y,
        size: 8,
        font: normal,
      }
    );

    context.page.drawText(
      `${line.vatRate}%`,
      {
        x: columns.vat,
        y: context.y,
        size: 8,
        font: normal,
      }
    );

    rightText(
      context,
      money(
        line.netAmount,
        input.currency
      ),
      context.y,
      {
        size: 8,
        right: columns.net,
      }
    );

    context.y -= rowHeight;

    drawRule(
      context,
      context.y + 8
    );
  }

  context.y -= 10;

  drawTotals(
    context,
    input
  );

  if (
    clean(input.notes)
  ) {
    drawText(
      context,
      "NOTES",
      {
        size: 7,
        bold: true,
        gapAfter: 4,
      }
    );

    drawText(
      context,
      clean(input.notes),
      {
        size: 8,
        gapAfter: 12,
      }
    );
  }

  if (
    clean(
      settings.bank_details
    )
  ) {
    ensureSpace(
      context,
      80
    );

    drawRule(
      context,
      context.y + 8
    );

    drawText(
      context,
      "PAYMENT DETAILS",
      {
        size: 7,
        bold: true,
        gapAfter: 5,
      }
    );

    drawText(
      context,
      clean(
        settings.bank_details
      ),
      {
        size: 8,
        gapAfter: 6,
      }
    );
  }

  const safeNumber =
    input.invoiceNumber.replace(
      /[^A-Za-z0-9._-]+/g,
      "-"
    );

  return {
    bytes:
      await pdf.save(),
    filename:
      `${safeNumber}.pdf`,
  };
}