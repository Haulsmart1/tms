import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";

type QuotePdfLine = {
  description: string;
  quantity: number;
  unitPrice: number;
  vatRate: number;
  lineTotal: number;
};

export type QuotationPdfCompanyProfile = {
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

export type QuotationPdfDocumentSettings = {
  show_logo?: boolean | null;
  logo_signed_url?: string | null;
  show_contact_details?: boolean | null;
  show_company_registration?: boolean | null;
  show_vat_number?: boolean | null;
  footer_text?: string | null;
  generic_document_note?: string | null;
};

type GenerateQuotationPdfInput = {
  companyName: string;
  companyProfile?: QuotationPdfCompanyProfile | null;
  documentSettings?: QuotationPdfDocumentSettings | null;
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
  normal: PDFFont;
  bold: PDFFont;
  y: number;
  quoteNumber: string;
};

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 42;
const RIGHT = PAGE_WIDTH - MARGIN;
const WIDTH = PAGE_WIDTH - MARGIN * 2;
const BOTTOM = 54;

const NAVY =
  rgb(0.055, 0.10, 0.18);

const MUTED =
  rgb(0.34, 0.40, 0.48);

const LIGHT =
  rgb(0.95, 0.96, 0.97);

const LINE =
  rgb(0.82, 0.84, 0.87);

const ACCENT =
  rgb(0.78, 0.53, 0.08);

function clean(
  value: unknown
): string {
  return String(value ?? "")
    .trim();
}

function pdfSafe(
  value: unknown
): string {
  return String(value ?? "")
    .replace(/\r/g, "")
    .replace(/\u2018|\u2019/g, "'")
    .replace(/\u201C|\u201D/g, '"')
    .replace(/\u2013|\u2014/g, "-")
    .replace(/\u2022/g, "-")
    .replace(/\u00D7/g, "x")
    .replace(/\u00A0/g, " ")
    .replace(/[^\x09\x0A\x0D\x20-\x7E\u00A3]/g, "");
}

function money(
  value: number,
  currency: string
): string {
  return pdfSafe(
    new Intl.NumberFormat(
      "en-GB",
      {
        style: "currency",
        currency:
          currency || "GBP",
      }
    ).format(
      Number.isFinite(value)
        ? value
        : 0
    )
  );
}

function date(
  value: string | null
): string {
  if (!value) {
    return "-";
  }

  const parsed =
    new Date(
      `${value}T00:00:00Z`
    );

  if (
    Number.isNaN(
      parsed.getTime()
    )
  ) {
    return pdfSafe(value);
  }

  return parsed.toLocaleDateString(
    "en-GB",
    {
      timeZone: "UTC",
    }
  );
}

function splitText(
  value: string,
  font: PDFFont,
  size: number,
  maxWidth: number
): string[] {
  const paragraphs =
    pdfSafe(value)
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

      /*
        Handle a single token longer than the available width.
      */
      if (
        font.widthOfTextAtSize(
          word,
          size
        ) > maxWidth
      ) {
        let fragment = "";

        for (const char of word) {
          const next =
            fragment + char;

          if (
            font.widthOfTextAtSize(
              next,
              size
            ) <= maxWidth
          ) {
            fragment = next;
          } else {
            if (fragment) {
              output.push(fragment);
            }

            fragment = char;
          }
        }

        line = fragment;
      } else {
        line = word;
      }
    }

    if (line) {
      output.push(line);
    }
  }

  return output;
}

function rightText(
  context: PdfContext,
  value: string,
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

  const safeValue =
    pdfSafe(value);

  const width =
    font.widthOfTextAtSize(
      safeValue,
      size
    );

  context.page.drawText(
    safeValue,
    {
      x:
        (options?.right ?? RIGHT) -
        width,
      y,
      size,
      font,
      color: NAVY,
    }
  );
}

function drawRule(
  context: PdfContext,
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
    color: LINE,
  });
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
    PAGE_HEIGHT - 62;

  context.page.drawText(
    "QUOTATION",
    {
      x: MARGIN,
      y: PAGE_HEIGHT - 38,
      size: 8,
      font: context.bold,
      color: MUTED,
    }
  );

  rightText(
    context,
    context.quoteNumber,
    PAGE_HEIGHT - 38,
    {
      size: 8,
      bold: true,
    }
  );

  drawRule(
    context,
    PAGE_HEIGHT - 47
  );
}

function ensureSpace(
  context: PdfContext,
  required: number
) {
  if (
    context.y - required <
    BOTTOM
  ) {
    addPage(context);
  }
}

function drawText(
  context: PdfContext,
  value: string,
  options?: {
    x?: number;
    y?: number;
    size?: number;
    bold?: boolean;
    maxWidth?: number;
    gapAfter?: number;
    color?: ReturnType<typeof rgb>;
  }
): number {
  const size =
    options?.size ?? 9;

  const font =
    options?.bold
      ? context.bold
      : context.normal;

  const x =
    options?.x ?? MARGIN;

  const y =
    options?.y ?? context.y;

  const maxWidth =
    options?.maxWidth ??
    (RIGHT - x);

  const lines =
    splitText(
      value,
      font,
      size,
      maxWidth
    );

  const lineHeight =
    size * 1.35;

  let drawY = y;

  for (const line of lines) {
    if (
      options?.y === undefined
    ) {
      ensureSpace(
        context,
        lineHeight
      );

      drawY =
        context.y;
    }

    if (line) {
      context.page.drawText(
        line,
        {
          x,
          y: drawY,
          size,
          font,
          color:
            options?.color ??
            NAVY,
        }
      );
    }

    if (
      options?.y === undefined
    ) {
      context.y -=
        lineHeight;

      drawY =
        context.y;
    } else {
      drawY -=
        lineHeight;
    }
  }

  if (
    options?.y === undefined
  ) {
    context.y -=
      options?.gapAfter ?? 2;
  }

  return drawY;
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
      await fetch(
        url,
        {
          cache: "no-store",
        }
      );

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
        ?.toLowerCase() ??
      "";

    if (
      contentType.includes(
        "png"
      )
    ) {
      return await pdf.embedPng(
        bytes
      );
    }

    if (
      contentType.includes(
        "jpeg"
      ) ||
      contentType.includes(
        "jpg"
      )
    ) {
      return await pdf.embedJpg(
        bytes
      );
    }

    try {
      return await pdf.embedPng(
        bytes
      );
    } catch {
      return await pdf.embedJpg(
        bytes
      );
    }
  } catch {
    return null;
  }
}

function drawTotals(
  context: PdfContext,
  input: GenerateQuotationPdfInput
) {
  ensureSpace(
    context,
    102
  );

  const labelX = 355;

  const rows = [
    [
      "Subtotal",
      money(
        input.subtotal,
        input.currency
      ),
    ],
    [
      "VAT",
      money(
        input.vatTotal,
        input.currency
      ),
    ],
  ];

  for (
    const [label, value]
    of rows
  ) {
    context.page.drawText(
      label,
      {
        x: labelX,
        y: context.y,
        size: 9,
        font: context.normal,
        color: NAVY,
      }
    );

    rightText(
      context,
      value,
      context.y,
      {
        size: 9,
        bold: true,
      }
    );

    context.y -= 20;
  }

  drawRule(
    context,
    context.y + 8
  );

  context.page.drawText(
    "TOTAL",
    {
      x: labelX,
      y: context.y - 5,
      size: 12,
      font: context.bold,
      color: NAVY,
    }
  );

  rightText(
    context,
    money(
      input.total,
      input.currency
    ),
    context.y - 5,
    {
      size: 13,
      bold: true,
    }
  );

  context.y -= 34;
}

function drawLineTableHeader(
  context: PdfContext
) {
  const top =
    context.y;

  context.page.drawRectangle({
    x: MARGIN,
    y: top - 21,
    width: WIDTH,
    height: 23,
    color: LIGHT,
  });

  const columns = {
    description: MARGIN + 8,
    qty: 350,
    rate: 405,
    vat: 465,
    net: RIGHT - 8,
  };

  context.page.drawText(
    "Description",
    {
      x: columns.description,
      y: top - 14,
      size: 7.5,
      font: context.bold,
      color: NAVY,
    }
  );

  context.page.drawText(
    "Qty",
    {
      x: columns.qty,
      y: top - 14,
      size: 7.5,
      font: context.bold,
      color: NAVY,
    }
  );

  context.page.drawText(
    "Rate",
    {
      x: columns.rate,
      y: top - 14,
      size: 7.5,
      font: context.bold,
      color: NAVY,
    }
  );

  context.page.drawText(
    "VAT",
    {
      x: columns.vat,
      y: top - 14,
      size: 7.5,
      font: context.bold,
      color: NAVY,
    }
  );

  rightText(
    context,
    "Net",
    top - 14,
    {
      size: 7.5,
      bold: true,
      right:
        columns.net,
    }
  );

  context.y =
    top - 32;
}

function drawLineItem(
  context: PdfContext,
  line: QuotePdfLine
) {
  const columns = {
    description: MARGIN + 8,
    qty: 350,
    rate: 405,
    vat: 465,
    net: RIGHT - 8,
  };

  const descriptionLines =
    splitText(
      line.description,
      context.normal,
      8,
      292
    );

  const rowHeight =
    Math.max(
      24,
      descriptionLines.length * 10 +
        12
    );

  ensureSpace(
    context,
    rowHeight
  );

  /*
    If ensureSpace moved us to a new page,
    redraw the line-table heading.
  */
  if (
    context.y >
    PAGE_HEIGHT - 100
  ) {
    drawLineTableHeader(
      context
    );
  }

  const top =
    context.y;

  let descriptionY =
    top;

  for (
    const descriptionLine
    of descriptionLines
  ) {
    context.page.drawText(
      descriptionLine,
      {
        x:
          columns.description,
        y:
          descriptionY,
        size: 8,
        font: context.normal,
        color: NAVY,
      }
    );

    descriptionY -= 10;
  }

  context.page.drawText(
    pdfSafe(line.quantity),
    {
      x: columns.qty,
      y: top,
      size: 8,
      font: context.normal,
      color: NAVY,
    }
  );

  context.page.drawText(
    money(
      line.unitPrice,
      "GBP"
    ),
    {
      x: columns.rate,
      y: top,
      size: 8,
      font: context.normal,
      color: NAVY,
    }
  );

  context.page.drawText(
    `${Number(
      line.vatRate
    )}%`,
    {
      x: columns.vat,
      y: top,
      size: 8,
      font: context.normal,
      color: NAVY,
    }
  );

  rightText(
    context,
    money(
      line.lineTotal,
      "GBP"
    ),
    top,
    {
      size: 8,
      bold: true,
      right:
        columns.net,
    }
  );

  context.page.drawLine({
    start: {
      x: MARGIN,
      y:
        top -
        rowHeight +
        7,
    },
    end: {
      x: RIGHT,
      y:
        top -
        rowHeight +
        7,
    },
    thickness: 0.45,
    color: LINE,
  });

  context.y =
    top -
    rowHeight;
}

export async function generateQuotationPdf(
  input: GenerateQuotationPdfInput
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
    quoteNumber:
      pdfSafe(
        input.quoteNumber
      ),
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

  let headerTextX =
    MARGIN;

  if (logo) {
    const scale =
      Math.min(
        68 / logo.height,
        78 / logo.width
      );

    const logoWidth =
      logo.width *
      scale;

    const logoHeight =
      logo.height *
      scale;

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
      MARGIN +
      logoWidth +
      16;
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
    pdfSafe(
      displayCompany
    ),
    {
      x:
        headerTextX,
      y:
        PAGE_HEIGHT -
        MARGIN -
        13,
      size: 11,
      font: bold,
      color: NAVY,
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
    29;

  if (address) {
    const addressLines =
      splitText(
        address,
        normal,
        7.4,
        300
      );

    for (
      const addressLine
      of addressLines
    ) {
      context.page.drawText(
        addressLine,
        {
          x:
            headerTextX,
          y:
            headerY,
          size: 7.4,
          font: normal,
          color: MUTED,
        }
      );

      headerY -= 9.5;
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
        ),
        clean(
          profile.business_email
        ),
        clean(
          profile.website
        ),
      ]
        .filter(Boolean)
        .join("   ");

    if (contacts) {
      context.page.drawText(
        pdfSafe(
          contacts
        ),
        {
          x:
            headerTextX,
          y:
            headerY - 2,
          size: 7,
          font: normal,
          color: MUTED,
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
      PAGE_HEIGHT -
        MARGIN -
        14,
      {
        size: 7,
      }
    );
  }

  if (
    settings.show_vat_number !==
      false &&
    clean(
      profile.vat_number
    )
  ) {
    rightText(
      context,
      `VAT No: ${clean(
        profile.vat_number
      )}`,
      PAGE_HEIGHT -
        MARGIN -
        27,
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
    "Quotation",
    {
      size: 22,
      bold: true,
      gapAfter: 3,
    }
  );

  drawText(
    context,
    input.quoteNumber,
    {
      size: 14,
      bold: true,
      gapAfter: 14,
      color: ACCENT,
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
      color: MUTED,
    }
  );

  drawText(
    context,
    input.customerName,
    {
      size: 10,
      bold: true,
      gapAfter: 9,
    }
  );

  drawText(
    context,
    "CUSTOMER REFERENCE",
    {
      size: 7,
      bold: true,
      gapAfter: 3,
      color: MUTED,
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
      color: MUTED,
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
    "QUOTE DATE",
    {
      x: rightX,
      y: detailTop,
      size: 7,
      font: bold,
      color: MUTED,
    }
  );

  rightText(
    context,
    date(
      input.quoteDate
    ),
    detailTop - 14,
    {
      size: 9,
    }
  );

  context.page.drawText(
    "VALID UNTIL",
    {
      x: rightX,
      y: detailTop - 43,
      size: 7,
      font: bold,
      color: MUTED,
    }
  );

  rightText(
    context,
    date(
      input.validUntil
    ),
    detailTop - 57,
    {
      size: 9,
    }
  );

  context.page.drawText(
    "TOTAL",
    {
      x: rightX,
      y: detailTop - 86,
      size: 7,
      font: bold,
      color: MUTED,
    }
  );

  rightText(
    context,
    money(
      input.total,
      input.currency
    ),
    detailTop - 101,
    {
      size: 11,
      bold: true,
    }
  );

  context.y =
    Math.min(
      leftBottom,
      detailTop - 115
    ) - 12;

  drawRule(
    context,
    context.y + 8
  );

  context.y -= 10;

  drawLineTableHeader(
    context
  );

  for (
    const line
    of input.lines
  ) {
    /*
      Preserve original currency.
      drawLineItem uses GBP internally only for column rendering,
      so replace formatted values here when currency differs.
    */
    const columns = {
      description: MARGIN + 8,
      qty: 350,
      rate: 405,
      vat: 465,
      net: RIGHT - 8,
    };

    const descriptionLines =
      splitText(
        line.description,
        normal,
        8,
        292
      );

    const rowHeight =
      Math.max(
        24,
        descriptionLines.length *
          10 +
          12
      );

    ensureSpace(
      context,
      rowHeight
    );

    if (
      context.y >
      PAGE_HEIGHT - 100
    ) {
      drawLineTableHeader(
        context
      );
    }

    const top =
      context.y;

    let descriptionY =
      top;

    for (
      const descriptionLine
      of descriptionLines
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
          color: NAVY,
        }
      );

      descriptionY -= 10;
    }

    context.page.drawText(
      pdfSafe(
        line.quantity
      ),
      {
        x: columns.qty,
        y: top,
        size: 8,
        font: normal,
        color: NAVY,
      }
    );

    context.page.drawText(
      money(
        line.unitPrice,
        input.currency
      ),
      {
        x: columns.rate,
        y: top,
        size: 8,
        font: normal,
        color: NAVY,
      }
    );

    context.page.drawText(
      `${Number(
        line.vatRate
      )}%`,
      {
        x: columns.vat,
        y: top,
        size: 8,
        font: normal,
        color: NAVY,
      }
    );

    rightText(
      context,
      money(
        line.lineTotal,
        input.currency
      ),
      top,
      {
        size: 8,
        bold: true,
        right:
          columns.net,
      }
    );

    context.page.drawLine({
      start: {
        x: MARGIN,
        y:
          top -
          rowHeight +
          7,
      },
      end: {
        x: RIGHT,
        y:
          top -
          rowHeight +
          7,
      },
      thickness: 0.45,
      color: LINE,
    });

    context.y =
      top -
      rowHeight;
  }

  context.y -= 8;

  drawTotals(
    context,
    input
  );

  if (
    clean(
      input.notes
    )
  ) {
    ensureSpace(
      context,
      60
    );

    drawText(
      context,
      "NOTES",
      {
        size: 7,
        bold: true,
        gapAfter: 5,
        color: MUTED,
      }
    );

    drawText(
      context,
      clean(
        input.notes
      ),
      {
        size: 8,
        gapAfter: 14,
      }
    );
  }

  if (
    clean(
      settings.generic_document_note
    )
  ) {
    ensureSpace(
      context,
      60
    );

    drawRule(
      context,
      context.y + 7
    );

    drawText(
      context,
      clean(
        settings.generic_document_note
      ),
      {
        size: 7.5,
        gapAfter: 12,
        color: MUTED,
      }
    );
  }

  if (
    clean(
      input.termsSnapshot
    )
  ) {
    ensureSpace(
      context,
      70
    );

    drawRule(
      context,
      context.y + 8
    );

    drawText(
      context,
      "TERMS & CONDITIONS",
      {
        size: 10,
        bold: true,
        gapAfter: 10,
      }
    );

    const termsLines =
      splitText(
        clean(
          input.termsSnapshot
        ),
        normal,
        7.4,
        WIDTH
      );

    for (
      const line
      of termsLines
    ) {
      ensureSpace(
        context,
        11
      );

      if (line) {
        context.page.drawText(
          line,
          {
            x: MARGIN,
            y: context.y,
            size: 7.4,
            font: normal,
            color: NAVY,
          }
        );
      }

      context.y -= 10;
    }
  }

  if (
    clean(
      settings.footer_text
    )
  ) {
    ensureSpace(
      context,
      44
    );

    drawRule(
      context,
      context.y + 8
    );

    drawText(
      context,
      clean(
        settings.footer_text
      ),
      {
        size: 7,
        color: MUTED,
      }
    );
  }

  const pages =
    pdf.getPages();

  pages.forEach(
    (page, index) => {
      page.drawLine({
        start: {
          x: MARGIN,
          y: 36,
        },
        end: {
          x: RIGHT,
          y: 36,
        },
        thickness: 0.45,
        color: LINE,
      });

      page.drawText(
        pdfSafe(
          displayCompany
        ),
        {
          x: MARGIN,
          y: 22,
          size: 6.8,
          font: normal,
          color: MUTED,
        }
      );

      const pageText =
        `Page ${
          index + 1
        } of ${pages.length}`;

      const pageWidth =
        normal.widthOfTextAtSize(
          pageText,
          6.8
        );

      page.drawText(
        pageText,
        {
          x:
            RIGHT -
            pageWidth,
          y: 22,
          size: 6.8,
          font: normal,
          color: MUTED,
        }
      );
    }
  );

  const safeNumber =
    input.quoteNumber
      .replace(
        /[^A-Za-z0-9._-]+/g,
        "-"
      );

  return {
    bytes:
      await pdf.save(),
    filename:
      `Quotation-${safeNumber}.pdf`,
  };
}