import {
  PDFDocument,
  StandardFonts,
  rgb,
} from "pdf-lib";
import { createAdminClient } from "../supabase/admin";
import {
  loadSharedPod,
  type SharedPodData,
} from "./shareData";

const POD_BUCKET = "pod-files";

function formatDateTime(
  value: string | null
): string {
  if (!value) {
    return "-";
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("en-GB", {
        timeZone: "Europe/London",
      });
}

function safeText(
  value: string | null | undefined
): string {
  return value?.trim() || "-";
}

export async function generatePodPdf(
  tenantId: string,
  jobId: string
): Promise<{
  bytes: Uint8Array;
  filename: string;
  pod: SharedPodData;
}> {
  const pod =
    await loadSharedPod(
      tenantId,
      jobId
    );

  if (!pod) {
    throw new Error(
      "POD job not found."
    );
  }

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

  const page =
    pdf.addPage([595.28, 841.89]);

  let y = 795;

  page.drawText(
    "ADR CARRIERS",
    {
      x: 45,
      y,
      size: 20,
      font: bold,
    }
  );

  y -= 28;

  page.drawText(
    "PROOF OF DELIVERY",
    {
      x: 45,
      y,
      size: 16,
      font: bold,
    }
  );

  y -= 35;

  const drawRow = (
    label: string,
    value: string
  ) => {
    page.drawText(
      `${label}:`,
      {
        x: 45,
        y,
        size: 10,
        font: bold,
      }
    );

    page.drawText(
      value.slice(0, 82),
      {
        x: 160,
        y,
        size: 10,
        font: normal,
      }
    );

    y -= 18;
  };

  drawRow(
    "Job reference",
    pod.reference
  );

  drawRow(
    "Customer",
    pod.customerName
  );

  drawRow(
    "Customer reference",
    safeText(
      pod.customerReference
    )
  );

  drawRow(
    "Status",
    safeText(pod.status)
  );

  drawRow(
    "Scheduled",
    safeText(
      pod.scheduledDate
    )
  );

  y -= 12;

  for (const stop of pod.stops) {
    if (y < 170) {
      break;
    }

    page.drawText(
      `Stop ${stop.stopOrder} - ${stop.type}`,
      {
        x: 45,
        y,
        size: 12,
        font: bold,
      }
    );

    y -= 20;

    drawRow(
      "Address",
      [
        stop.address,
        stop.city,
        stop.postcode,
      ]
        .filter(Boolean)
        .join(", ")
    );

    drawRow(
      "Recipient",
      safeText(
        stop.recipientName
      )
    );

    drawRow(
      "Delivered",
      formatDateTime(
        stop.deliveredAt
      )
    );

    drawRow(
      "POD status",
      safeText(
        stop.podStatus
      )
    );

    drawRow(
      "Notes",
      safeText(
        stop.podNotes
      ).slice(0, 82)
    );

    drawRow(
      "Evidence",
      `${stop.evidence.length} file(s)`
    );

    y -= 12;
  }

  page.drawLine({
    start: {
      x: 45,
      y: 70,
    },
    end: {
      x: 550,
      y: 70,
    },
    thickness: 0.5,
    color: rgb(
      0.65,
      0.65,
      0.65
    ),
  });

  page.drawText(
    `Generated ${new Date().toLocaleString(
      "en-GB",
      {
        timeZone:
          "Europe/London",
      }
    )}`,
    {
      x: 45,
      y: 52,
      size: 8,
      font: normal,
    }
  );

  const admin =
    createAdminClient();

  for (const stop of pod.stops) {
    const images =
      stop.evidence.filter(
        (item) =>
          item.mimeType ===
            "image/jpeg" ||
          item.mimeType ===
            "image/png"
      );

    for (const image of images) {
      try {
        const {
          data,
          error,
        } = await admin.storage
          .from(POD_BUCKET)
          .download(
            image.storagePath
          );

        if (error || !data) {
          continue;
        }

        const bytes =
          new Uint8Array(
            await data.arrayBuffer()
          );

        const embedded =
          image.mimeType ===
          "image/png"
            ? await pdf.embedPng(
                bytes
              )
            : await pdf.embedJpg(
                bytes
              );

        const imagePage =
          pdf.addPage([
            595.28,
            841.89,
          ]);

        imagePage.drawText(
          `POD Photo - ${pod.reference}`,
          {
            x: 45,
            y: 795,
            size: 14,
            font: bold,
          }
        );

        imagePage.drawText(
          image.filename.slice(
            0,
            75
          ),
          {
            x: 45,
            y: 772,
            size: 9,
            font: normal,
          }
        );

        const availableWidth =
          505;

        const availableHeight =
          680;

        const scale =
          Math.min(
            availableWidth /
              embedded.width,
            availableHeight /
              embedded.height,
            1
          );

        const width =
          embedded.width * scale;

        const height =
          embedded.height * scale;

        imagePage.drawImage(
          embedded,
          {
            x:
              (595.28 - width) /
              2,
            y:
              55 +
              (availableHeight -
                height) /
                2,
            width,
            height,
          }
        );
      } catch (error) {
        console.error(
          "Unable to embed POD image:",
          image.storagePath,
          error
        );
      }
    }
  }

  const bytes =
    await pdf.save();

  const safeReference =
    pod.reference.replace(
      /[^a-zA-Z0-9._-]/g,
      "_"
    );

  return {
    bytes,
    filename:
      `POD-${safeReference}.pdf`,
    pod,
  };
}
