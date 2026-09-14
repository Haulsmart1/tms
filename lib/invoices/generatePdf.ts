import {
  PDFDocument,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";

import { embedUnicodeFonts, pdfSafeText } from "../printing/pdfFonts";
import { fitPdfText, loadPdfLogo, wrapPdfText } from "../printing/pdfText";

/*
  Invoice PDF.

  Fonts: embedded DejaVu Sans (lib/printing/pdfFonts.ts), because the standard
  Helvetica font throws on any character outside WinAnsi ("Ł", "ş", "→"),
  which made invoices for Polish or Turkish customers impossible to email
  (INV-1). Every string is drawn through pdfSafeText, and every width is
  measured with the same font it is drawn in.

  Layout (INV-20): long words are hard-broken, fixed-width boxes truncate,
  continuation pages repeat a running header and the line-table header, and
  every page carries "Page x of y".
*/

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

type Color = ReturnType<typeof rgb>;

type Context = {
  pdf: PDFDocument;
  page: PDFPage;
  normal: PDFFont;
  bold: PDFFont;
  y: number;
  runningTitle: string;
  /** Redraws a table header after a page break inside the line table. */
  onPageBreak: (() => void) | null;
};

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 42;
const RIGHT = PAGE_WIDTH - MARGIN;
const WIDTH = PAGE_WIDTH - MARGIN * 2;
/* Lowest y body content may reach; the footer lives below it. */
const BOTTOM = 54;
/* First body y on a continuation page, below the running header. */
const CONTINUATION_TOP = PAGE_HEIGHT - 62;

const INK = rgb(0.08, 0.11, 0.17);
const MUTED = rgb(0.34, 0.4, 0.48);
const LINE = rgb(0.82, 0.84, 0.87);
const LIGHT = rgb(0.95, 0.96, 0.97);

const COLUMNS = {
  description: MARGIN + 8,
  descriptionWidth: 290,
  qty: 350,
  qtyWidth: 50,
  rate: 405,
  rateWidth: 54,
  vat: 463,
  vatWidth: 40,
  net: RIGHT - 8,
};

export function formatPdfMoney(value: number, currency: string): string {
  const amount = Number.isFinite(value) ? value : 0;
  const code = String(currency || "GBP").trim().toUpperCase();

  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: code,
    }).format(amount);
  } catch {
    /* A malformed currency code makes Intl throw; print the code instead. */
    return `${code} ${amount.toFixed(2)}`;
  }
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

/** The only place this file calls page.drawText. */
function draw(
  page: PDFPage,
  text: string,
  options: { x: number; y: number; size: number; font: PDFFont; color?: Color }
) {
  const safe = pdfSafeText(text, options.font);

  if (!safe) {
    return;
  }

  page.drawText(safe, {
    x: options.x,
    y: options.y,
    size: options.size,
    font: options.font,
    color: options.color ?? INK,
  });
}

function rightText(
  page: PDFPage,
  font: PDFFont,
  text: string,
  y: number,
  options: { size: number; right?: number; maxWidth?: number; color?: Color }
) {
  const fitted =
    options.maxWidth !== undefined
      ? fitPdfText(text, font, options.size, options.maxWidth)
      : pdfSafeText(text, font);

  const width = font.widthOfTextAtSize(fitted, options.size);

  draw(page, fitted, {
    x: (options.right ?? RIGHT) - width,
    y,
    size: options.size,
    font,
    color: options.color,
  });
}

function drawRule(context: Context, y: number) {
  context.page.drawLine({
    start: { x: MARGIN, y },
    end: { x: RIGHT, y },
    thickness: 0.7,
    color: LINE,
  });
}

function addPage(context: Context) {
  context.page = context.pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

  draw(context.page, fitPdfText(context.runningTitle, context.bold, 8, WIDTH * 0.6), {
    x: MARGIN,
    y: PAGE_HEIGHT - 38,
    size: 8,
    font: context.bold,
    color: MUTED,
  });

  context.page.drawLine({
    start: { x: MARGIN, y: PAGE_HEIGHT - 47 },
    end: { x: RIGHT, y: PAGE_HEIGHT - 47 },
    thickness: 0.7,
    color: LINE,
  });

  context.y = CONTINUATION_TOP;
  context.onPageBreak?.();
}

function ensureSpace(context: Context, required: number) {
  if (context.y - required < BOTTOM) {
    addPage(context);
  }
}

/** Flowing, wrapped text at context.y that breaks onto new pages as needed. */
function drawText(
  context: Context,
  text: string,
  options?: {
    x?: number;
    size?: number;
    bold?: boolean;
    maxWidth?: number;
    gapAfter?: number;
    color?: Color;
  }
) {
  const size = options?.size ?? 9;
  const font = options?.bold ? context.bold : context.normal;
  const x = options?.x ?? MARGIN;
  const maxWidth = options?.maxWidth ?? RIGHT - x;
  const lineHeight = size * 1.35;

  for (const line of wrapPdfText(text, font, size, maxWidth)) {
    ensureSpace(context, lineHeight);
    draw(context.page, line, { x, y: context.y, size, font, color: options?.color });
    context.y -= lineHeight;
  }

  context.y -= options?.gapAfter ?? 2;
}

function drawTableHeader(context: Context) {
  const top = context.y;

  context.page.drawRectangle({
    x: MARGIN,
    y: top - 20,
    width: WIDTH,
    height: 22,
    color: LIGHT,
  });

  const labelY = top - 13;
  draw(context.page, "Description", { x: COLUMNS.description, y: labelY, size: 7.5, font: context.bold });
  draw(context.page, "Qty", { x: COLUMNS.qty, y: labelY, size: 7.5, font: context.bold });
  draw(context.page, "Rate", { x: COLUMNS.rate, y: labelY, size: 7.5, font: context.bold });
  draw(context.page, "VAT", { x: COLUMNS.vat, y: labelY, size: 7.5, font: context.bold });
  rightText(context.page, context.bold, "Net", labelY, { size: 7.5, right: COLUMNS.net });

  context.y = top - 31;
}

function drawLine(context: Context, line: InvoicePdfLine, currency: string) {
  const size = 8;
  const lineHeight = 10;
  const descriptionLines = wrapPdfText(line.description, context.normal, size, COLUMNS.descriptionWidth);

  /* A description taller than a page is split across pages; the figures are
     printed on the first chunk only. */
  const maxLinesPerPage = Math.max(1, Math.floor((CONTINUATION_TOP - 31 - BOTTOM - 12) / lineHeight));
  let remaining = descriptionLines;
  let first = true;

  while (first || remaining.length > 0) {
    const chunk = remaining.slice(0, maxLinesPerPage);
    remaining = remaining.slice(chunk.length);

    const rowHeight = Math.max(28, chunk.length * lineHeight + 12);
    ensureSpace(context, rowHeight + 8);

    const top = context.y;
    let descriptionY = top;

    for (const descriptionLine of chunk) {
      draw(context.page, descriptionLine, { x: COLUMNS.description, y: descriptionY, size, font: context.normal });
      descriptionY -= lineHeight;
    }

    if (first) {
      draw(context.page, fitPdfText(String(line.quantity), context.normal, size, COLUMNS.qtyWidth), {
        x: COLUMNS.qty,
        y: top,
        size,
        font: context.normal,
      });

      draw(context.page, fitPdfText(formatPdfMoney(line.unitPrice, currency), context.normal, size, COLUMNS.rateWidth), {
        x: COLUMNS.rate,
        y: top,
        size,
        font: context.normal,
      });

      draw(context.page, fitPdfText(`${line.vatRate}%`, context.normal, size, COLUMNS.vatWidth), {
        x: COLUMNS.vat,
        y: top,
        size,
        font: context.normal,
      });

      rightText(context.page, context.normal, formatPdfMoney(line.netAmount, currency), top, {
        size,
        right: COLUMNS.net,
        maxWidth: COLUMNS.net - (COLUMNS.vat + COLUMNS.vatWidth) - 4,
      });
    }

    context.y = top - rowHeight;
    drawRule(context, context.y + 8);
    first = false;
  }
}

function drawTotals(context: Context, input: GenerateInvoicePdfInput) {
  ensureSpace(context, 125);

  const labelX = 340;
  const valueWidth = RIGHT - labelX - 70;

  const rows: Array<[string, string]> = [
    ["Subtotal", formatPdfMoney(input.subtotal, input.currency)],
    ["VAT", formatPdfMoney(input.vatTotal, input.currency)],
  ];

  for (const [label, value] of rows) {
    draw(context.page, label, { x: labelX, y: context.y, size: 9, font: context.normal });
    rightText(context.page, context.bold, value, context.y, { size: 9, maxWidth: valueWidth });
    context.y -= 18;
  }

  drawRule(context, context.y + 6);

  draw(context.page, "Total", { x: labelX, y: context.y - 4, size: 12, font: context.normal });
  rightText(context.page, context.bold, formatPdfMoney(input.total, input.currency), context.y - 4, {
    size: 12,
    maxWidth: valueWidth,
  });

  context.y -= 28;

  draw(context.page, "Balance due", { x: labelX, y: context.y, size: 10, font: context.normal });
  rightText(context.page, context.bold, formatPdfMoney(input.balanceDue, input.currency), context.y, {
    size: 11,
    maxWidth: valueWidth,
  });

  context.y -= 28;
}

function drawFooters(context: Context, displayCompany: string, invoiceNumber: string) {
  const pages = context.pdf.getPages();

  pages.forEach((page, index) => {
    page.drawLine({
      start: { x: MARGIN, y: 36 },
      end: { x: RIGHT, y: 36 },
      thickness: 0.45,
      color: LINE,
    });

    draw(page, fitPdfText(`${displayCompany}  |  Invoice ${invoiceNumber}`, context.normal, 6.8, WIDTH - 90), {
      x: MARGIN,
      y: 22,
      size: 6.8,
      font: context.normal,
      color: MUTED,
    });

    rightText(page, context.normal, `Page ${index + 1} of ${pages.length}`, 22, {
      size: 6.8,
      color: MUTED,
    });
  });
}

export async function generateInvoicePdf(
  input: GenerateInvoicePdfInput
): Promise<{
  bytes: Uint8Array;
  filename: string;
}> {
  const pdf = await PDFDocument.create();
  const { regular: normal, bold } = await embedUnicodeFonts(pdf);

  const profile = input.companyProfile ?? {};
  const settings = input.documentSettings ?? {};

  const displayCompany =
    clean(profile.company_name) ||
    clean(profile.trading_name) ||
    clean(input.companyName);

  const invoiceNumber = clean(input.invoiceNumber);

  const context: Context = {
    pdf,
    page: pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]),
    normal,
    bold,
    y: PAGE_HEIGHT - MARGIN,
    runningTitle: `${displayCompany}  |  Invoice ${invoiceNumber}`,
    onPageBreak: null,
  };

  const logo =
    settings.show_logo !== false
      ? await loadPdfLogo(pdf, settings.logo_signed_url)
      : null;

  let headerTextX = MARGIN;

  if (logo) {
    const scale = Math.min(70 / logo.height, 78 / logo.width);
    const logoWidth = logo.width * scale;
    const logoHeight = logo.height * scale;

    context.page.drawImage(logo, {
      x: MARGIN,
      y: PAGE_HEIGHT - MARGIN - logoHeight,
      width: logoWidth,
      height: logoHeight,
    });

    headerTextX = MARGIN + logoWidth + 16;
  }

  /* The right-hand 150pt of the header belongs to Company No / VAT No. */
  const headerTextWidth = RIGHT - 150 - headerTextX;

  draw(context.page, fitPdfText(displayCompany, bold, 11, headerTextWidth), {
    x: headerTextX,
    y: PAGE_HEIGHT - MARGIN - 13,
    size: 11,
    font: bold,
  });

  const address = [
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

  let headerY = PAGE_HEIGHT - MARGIN - 30;

  if (address) {
    /* At most three address lines so the header cannot reach the title. */
    for (const line of wrapPdfText(address, normal, 7.5, headerTextWidth).slice(0, 3)) {
      draw(context.page, line, { x: headerTextX, y: headerY, size: 7.5, font: normal });
      headerY -= 10;
    }
  }

  if (settings.show_contact_details !== false) {
    const contacts = [
      clean(profile.business_phone) ? `Tel: ${clean(profile.business_phone)}` : "",
      clean(profile.business_email) ? `Email: ${clean(profile.business_email)}` : "",
      clean(profile.website),
    ]
      .filter(Boolean)
      .join("   ");

    if (contacts) {
      draw(context.page, fitPdfText(contacts, normal, 7.2, headerTextWidth), {
        x: headerTextX,
        y: headerY - 2,
        size: 7.2,
        font: normal,
      });
    }
  }

  if (settings.show_company_registration !== false && clean(profile.registration_number)) {
    rightText(context.page, normal, `Company No: ${clean(profile.registration_number)}`, PAGE_HEIGHT - MARGIN - 14, {
      size: 7,
      maxWidth: 140,
    });
  }

  if (settings.show_vat_number !== false && clean(profile.vat_number)) {
    rightText(context.page, normal, `VAT No: ${clean(profile.vat_number)}`, PAGE_HEIGHT - MARGIN - 27, {
      size: 7,
      maxWidth: 140,
    });
  }

  context.y = PAGE_HEIGHT - 148;
  drawRule(context, context.y + 18);

  drawText(context, "Invoice", { size: 22, bold: true, gapAfter: 3 });
  drawText(context, invoiceNumber, { size: 14, gapAfter: 12 });

  const detailTop = context.y;
  const rightX = 382;
  const leftWidth = rightX - MARGIN - 16;

  drawText(context, "CUSTOMER", { size: 7, bold: true, gapAfter: 4, maxWidth: leftWidth });
  drawText(context, input.customerName, { size: 10, bold: true, gapAfter: 8, maxWidth: leftWidth });
  drawText(context, "CUSTOMER REFERENCE", { size: 7, bold: true, gapAfter: 3, maxWidth: leftWidth });
  drawText(context, clean(input.customerReference) || "-", { size: 9, gapAfter: 8, maxWidth: leftWidth });
  drawText(context, "PO REFERENCE", { size: 7, bold: true, gapAfter: 3, maxWidth: leftWidth });
  drawText(context, clean(input.poReference) || "-", { size: 9, maxWidth: leftWidth });

  /* The left column can wrap onto a second page for absurdly long input; the
     right column is drawn on the first page, where its labels belong. */
  const firstPage = pdf.getPage(0);
  const leftBottom = context.page === firstPage ? context.y : BOTTOM;
  const rightWidth = RIGHT - rightX;

  draw(firstPage, "ISSUE DATE", { x: rightX, y: detailTop, size: 7, font: bold });
  rightText(firstPage, normal, date(input.issueDate), detailTop - 14, { size: 9, maxWidth: rightWidth });

  draw(firstPage, "DUE DATE", { x: rightX, y: detailTop - 42, size: 7, font: bold });
  rightText(firstPage, normal, date(input.dueDate), detailTop - 56, { size: 9, maxWidth: rightWidth });

  draw(firstPage, "STATUS", { x: rightX, y: detailTop - 84, size: 7, font: bold });
  rightText(
    firstPage,
    normal,
    clean(input.status)
      ? clean(input.status)
          .replaceAll("_", " ")
          .replace(/^\w/, (letter) => letter.toUpperCase())
      : "Invoice",
    detailTop - 98,
    { size: 9, maxWidth: rightWidth }
  );

  if (context.page === firstPage) {
    context.y = Math.min(leftBottom, detailTop - 112) - 12;
  } else {
    context.y -= 12;
  }

  drawRule(context, context.y + 8);

  if (input.jobs && input.jobs.length > 0) {
    drawText(context, "JOBS / RMA REFERENCES", { size: 7, bold: true, gapAfter: 7 });

    const boxWidth = 172;
    const textWidth = boxWidth - 16;

    for (const job of input.jobs) {
      ensureSpace(context, 38);

      context.page.drawRectangle({
        x: MARGIN,
        y: context.y - 28,
        width: boxWidth,
        height: 34,
        borderWidth: 0.7,
        borderColor: LINE,
      });

      draw(context.page, fitPdfText(clean(job.reference) || "Job", bold, 8, textWidth), {
        x: MARGIN + 8,
        y: context.y - 6,
        size: 8,
        font: bold,
      });

      const secondary = clean(job.externalReference) || clean(job.customerReference);

      if (secondary) {
        draw(context.page, fitPdfText(secondary, normal, 6.8, textWidth), {
          x: MARGIN + 8,
          y: context.y - 17,
          size: 6.8,
          font: normal,
        });
      }

      if (clean(job.podStatus)) {
        draw(context.page, fitPdfText(`POD: ${clean(job.podStatus)}`, normal, 6.8, textWidth), {
          x: MARGIN + 8,
          y: context.y - 27,
          size: 6.8,
          font: normal,
        });
      }

      context.y -= 42;
    }

    context.y -= 4;
  }

  ensureSpace(context, 100);
  drawTableHeader(context);

  context.onPageBreak = () => drawTableHeader(context);

  for (const line of input.lines) {
    drawLine(context, line, input.currency);
  }

  context.onPageBreak = null;
  context.y -= 10;

  drawTotals(context, input);

  if (clean(input.notes)) {
    ensureSpace(context, 30);
    drawText(context, "NOTES", { size: 7, bold: true, gapAfter: 4 });
    drawText(context, clean(input.notes), { size: 8, gapAfter: 12 });
  }

  if (clean(settings.bank_details)) {
    ensureSpace(context, 80);
    drawRule(context, context.y + 8);
    drawText(context, "PAYMENT DETAILS", { size: 7, bold: true, gapAfter: 5 });
    drawText(context, clean(settings.bank_details), { size: 8, gapAfter: 6 });
  }

  drawFooters(context, displayCompany, invoiceNumber);

  const safeNumber = invoiceNumber.replace(/[^A-Za-z0-9._-]+/g, "-") || "invoice";

  return {
    bytes: await pdf.save(),
    filename: `${safeNumber}.pdf`,
  };
}
