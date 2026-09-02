export type LabelTemplate = {
  id: string;
  name: string;
  pageWidthMm: number;
  pageHeightMm: number;
  labelWidthMm: number;
  labelHeightMm: number;
  columns: number;
  rows: number;
  marginLeftMm: number;
  marginTopMm: number;
  gapXmm: number;
  gapYmm: number;
};

export const BOX_LABEL_TEMPLATES: LabelTemplate[] = [
  {
    id: "a4-24-635x339",
    name: "A4 - 24 labels - 63.5 x 33.9 mm",
    pageWidthMm: 210,
    pageHeightMm: 297,
    labelWidthMm: 63.5,
    labelHeightMm: 33.9,
    columns: 3,
    rows: 8,
    marginLeftMm: 7.75,
    marginTopMm: 12.9,
    gapXmm: 2,
    gapYmm: 0,
  },
  {
    id: "a4-21-635x381",
    name: "A4 - 21 labels - 63.5 x 38.1 mm",
    pageWidthMm: 210,
    pageHeightMm: 297,
    labelWidthMm: 63.5,
    labelHeightMm: 38.1,
    columns: 3,
    rows: 7,
    marginLeftMm: 7.75,
    marginTopMm: 15.15,
    gapXmm: 2,
    gapYmm: 0,
  },
  {
    id: "a4-14-991x381",
    name: "A4 - 14 labels - 99.1 x 38.1 mm",
    pageWidthMm: 210,
    pageHeightMm: 297,
    labelWidthMm: 99.1,
    labelHeightMm: 38.1,
    columns: 2,
    rows: 7,
    marginLeftMm: 4.65,
    marginTopMm: 15.15,
    gapXmm: 2.5,
    gapYmm: 0,
  },
  {
    id: "a4-8-991x677",
    name: "A4 - 8 labels - 99.1 x 67.7 mm",
    pageWidthMm: 210,
    pageHeightMm: 297,
    labelWidthMm: 99.1,
    labelHeightMm: 67.7,
    columns: 2,
    rows: 4,
    marginLeftMm: 4.65,
    marginTopMm: 13.1,
    gapXmm: 2.5,
    gapYmm: 0,
  },
  {
    id: "thermal-4x6",
    name: "4 x 6 inch thermal",
    pageWidthMm: 101.6,
    pageHeightMm: 152.4,
    labelWidthMm: 101.6,
    labelHeightMm: 152.4,
    columns: 1,
    rows: 1,
    marginLeftMm: 0,
    marginTopMm: 0,
    gapXmm: 0,
    gapYmm: 0,
  },
];

export const DEFAULT_CUSTOM_TEMPLATE: LabelTemplate = {
  id: "custom",
  name: "Custom",
  pageWidthMm: 210,
  pageHeightMm: 297,
  labelWidthMm: 63.5,
  labelHeightMm: 33.9,
  columns: 3,
  rows: 8,
  marginLeftMm: 7.75,
  marginTopMm: 12.9,
  gapXmm: 2,
  gapYmm: 0,
};

export function templateCapacity(template: LabelTemplate): number {
  return template.columns * template.rows;
}

export function validateLabelTemplate(
  template: LabelTemplate,
): string | null {
  const numericValues = [
    template.pageWidthMm,
    template.pageHeightMm,
    template.labelWidthMm,
    template.labelHeightMm,
    template.columns,
    template.rows,
    template.marginLeftMm,
    template.marginTopMm,
    template.gapXmm,
    template.gapYmm,
  ];

  if (numericValues.some((value) => !Number.isFinite(value))) {
    return "Template values must be valid numbers.";
  }

  if (
    template.pageWidthMm <= 0 ||
    template.pageHeightMm <= 0 ||
    template.labelWidthMm <= 0 ||
    template.labelHeightMm <= 0 ||
    template.columns < 1 ||
    template.rows < 1
  ) {
    return "Page, label, row and column sizes must be positive.";
  }

  if (
    !Number.isInteger(template.columns) ||
    !Number.isInteger(template.rows)
  ) {
    return "Rows and columns must be whole numbers.";
  }

  if (
    template.marginLeftMm < 0 ||
    template.marginTopMm < 0 ||
    template.gapXmm < 0 ||
    template.gapYmm < 0
  ) {
    return "Margins and gaps cannot be negative.";
  }

  const usedWidth =
    template.marginLeftMm +
    template.columns * template.labelWidthMm +
    Math.max(0, template.columns - 1) * template.gapXmm;

  const usedHeight =
    template.marginTopMm +
    template.rows * template.labelHeightMm +
    Math.max(0, template.rows - 1) * template.gapYmm;

  if (usedWidth > template.pageWidthMm + 0.01) {
    return "Labels exceed the printable page width.";
  }

  if (usedHeight > template.pageHeightMm + 0.01) {
    return "Labels exceed the printable page height.";
  }

  return null;
}
