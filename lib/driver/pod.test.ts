import {
  describe,
  expect,
  it,
} from "vitest";
import {
  MAX_POD_PHOTO_SIZE_BYTES,
  areAllDeliveryStopsDelivered,
  validatePodCompletion,
  validatePodPhotoContent,
  validatePodPhotoMetadata,
} from "./pod";

describe("validatePodPhotoMetadata", () => {
  it("rejects an empty photo", () => {
    expect(
      validatePodPhotoMetadata({
        size: 0,
        mimeType: "image/jpeg",
      }),
    ).toEqual({
      ok: false,
      status: 400,
      message:
        "The uploaded photo is empty.",
    });
  });

  it("rejects photos over 15 MB", () => {
    expect(
      validatePodPhotoMetadata({
        size:
          MAX_POD_PHOTO_SIZE_BYTES +
          1,
        mimeType: "image/jpeg",
      }),
    ).toMatchObject({
      ok: false,
      status: 413,
    });
  });

  it("rejects unsupported MIME types", () => {
    expect(
      validatePodPhotoMetadata({
        size: 1024,
        mimeType: "image/svg+xml",
      }),
    ).toMatchObject({
      ok: false,
      status: 415,
    });
  });

  it("accepts supported photos", () => {
    for (const mimeType of [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/heic",
    ]) {
      expect(
        validatePodPhotoMetadata({
          size: 1024,
          mimeType,
        }),
      ).toEqual({
        ok: true,
      });
    }
  });
});

describe("validatePodCompletion", () => {
  it("requires a recipient name", () => {
    expect(
      validatePodCompletion({
        recipientName: "   ",
        podNotes: "",
        evidenceCount: 1,
        legacyPhotoUrl: null,
      }),
    ).toMatchObject({
      ok: false,
      status: 400,
      message:
        "Recipient name is required.",
    });
  });

  it("rejects recipient names over 200 characters", () => {
    expect(
      validatePodCompletion({
        recipientName:
          "x".repeat(201),
        podNotes: "",
        evidenceCount: 1,
        legacyPhotoUrl: null,
      }),
    ).toMatchObject({
      ok: false,
      status: 400,
      message:
        "Recipient name is too long.",
    });
  });

  it("rejects POD notes over 4000 characters", () => {
    expect(
      validatePodCompletion({
        recipientName:
          "Jane Recipient",
        podNotes:
          "x".repeat(4001),
        evidenceCount: 1,
        legacyPhotoUrl: null,
      }),
    ).toMatchObject({
      ok: false,
      status: 400,
      message:
        "POD notes are too long.",
    });
  });

  it("requires POD evidence", () => {
    expect(
      validatePodCompletion({
        recipientName:
          "Jane Recipient",
        podNotes: "",
        evidenceCount: 0,
        legacyPhotoUrl: null,
      }),
    ).toMatchObject({
      ok: false,
      status: 400,
      message:
        "Upload at least one POD photo before completing this delivery.",
    });
  });

  it("accepts existing pod_evidence", () => {
    expect(
      validatePodCompletion({
        recipientName:
          " Jane Recipient ",
        podNotes:
          " Left with reception ",
        evidenceCount: 1,
        legacyPhotoUrl: null,
      }),
    ).toEqual({
      ok: true,
      recipientName:
        "Jane Recipient",
      podNotes:
        "Left with reception",
    });
  });

  it("accepts a legacy POD photo", () => {
    expect(
      validatePodCompletion({
        recipientName:
          "Jane Recipient",
        podNotes: "",
        evidenceCount: 0,
        legacyPhotoUrl:
          "tenant/job/photo.jpg",
      }),
    ).toEqual({
      ok: true,
      recipientName:
        "Jane Recipient",
      podNotes: null,
    });
  });
});

describe("areAllDeliveryStopsDelivered", () => {
  it("returns false when there are no delivery stops", () => {
    expect(
      areAllDeliveryStopsDelivered(
        [],
      ),
    ).toBe(false);
  });

  it("returns false when any delivery is incomplete", () => {
    expect(
      areAllDeliveryStopsDelivered([
        {
          pod_status:
            "delivered",
        },
        {
          pod_status:
            "pending",
        },
      ]),
    ).toBe(false);
  });

  it("returns true when every delivery is delivered", () => {
    expect(
      areAllDeliveryStopsDelivered([
        {
          pod_status:
            "delivered",
        },
        {
          pod_status:
            "delivered",
        },
      ]),
    ).toBe(true);
  });
});
describe("validatePodPhotoContent", () => {
  it("accepts JPEG bytes", () => {
    expect(
      validatePodPhotoContent({
        mimeType: "image/jpeg",
        bytes: new Uint8Array([
          0xff,
          0xd8,
          0xff,
          0xe0,
        ]),
      }),
    ).toEqual({
      ok: true,
    });
  });

  it("accepts PNG bytes", () => {
    expect(
      validatePodPhotoContent({
        mimeType: "image/png",
        bytes: new Uint8Array([
          0x89,
          0x50,
          0x4e,
          0x47,
          0x0d,
          0x0a,
          0x1a,
          0x0a,
        ]),
      }),
    ).toEqual({
      ok: true,
    });
  });

  it("accepts WebP bytes", () => {
    expect(
      validatePodPhotoContent({
        mimeType: "image/webp",
        bytes: new Uint8Array([
          0x52,
          0x49,
          0x46,
          0x46,
          0,
          0,
          0,
          0,
          0x57,
          0x45,
          0x42,
          0x50,
        ]),
      }),
    ).toEqual({
      ok: true,
    });
  });

  it("accepts HEIC container bytes", () => {
    expect(
      validatePodPhotoContent({
        mimeType: "image/heic",
        bytes: new Uint8Array([
          0,
          0,
          0,
          24,
          0x66,
          0x74,
          0x79,
          0x70,
          0x68,
          0x65,
          0x69,
          0x63,
        ]),
      }),
    ).toEqual({
      ok: true,
    });
  });

  it("rejects forged image content", () => {
    expect(
      validatePodPhotoContent({
        mimeType: "image/jpeg",
        bytes:
          new TextEncoder().encode(
            "<script>alert(1)</script>",
          ),
      }),
    ).toMatchObject({
      ok: false,
      status: 415,
    });
  });

  it("rejects mismatched MIME and bytes", () => {
    expect(
      validatePodPhotoContent({
        mimeType: "image/png",
        bytes: new Uint8Array([
          0xff,
          0xd8,
          0xff,
        ]),
      }),
    ).toMatchObject({
      ok: false,
      status: 415,
    });
  });
});
