import {
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  cameraAccessErrorMessage,
  createCameraDecodeGate,
  stopMediaTracks,
  submitBarcodeScan,
} from "./cameraBarcode";

describe(
  "driver camera barcode helpers",
  () => {
    it(
      "suppresses repeated decode callbacks until reset",
      () => {
        const gate =
          createCameraDecodeGate();

        expect(gate.tryLock()).toBe(true);
        expect(gate.tryLock()).toBe(false);
        expect(gate.isLocked()).toBe(true);

        gate.reset();

        expect(gate.isLocked()).toBe(false);
        expect(gate.tryLock()).toBe(true);
      },
    );

    it(
      "stops every media track",
      () => {
        const firstStop = vi.fn();
        const secondStop = vi.fn();

        stopMediaTracks({
          getTracks: () => [
            { stop: firstStop },
            { stop: secondStop },
          ],
        });

        expect(firstStop).toHaveBeenCalledTimes(1);
        expect(secondStop).toHaveBeenCalledTimes(1);
      },
    );

    it(
      "handles missing streams safely",
      () => {
        expect(() =>
          stopMediaTracks(null),
        ).not.toThrow();
      },
    );

    it(
      "gives a permission-specific fallback message",
      () => {
        expect(
          cameraAccessErrorMessage({
            name: "NotAllowedError",
          }),
        ).toMatch(/permission/i);

        expect(
          cameraAccessErrorMessage({
            name: "NotAllowedError",
          }),
        ).toMatch(/manually/i);
      },
    );

    it(
      "gives a no-camera fallback message",
      () => {
        expect(
          cameraAccessErrorMessage({
            name: "NotFoundError",
          }),
        ).toMatch(/no usable camera/i);
      },
    );

    it(
      "posts a successful camera scan",
      async () => {
        const fetcher = vi.fn(
          async (
            _input: string,
            init?: RequestInit,
          ) => {
            expect(init?.method).toBe("POST");

            expect(
              JSON.parse(
                String(init?.body),
              ),
            ).toEqual({
              serial_number:
                "BOX-ABC-001",
              scan_format:
                "code_128",
            });

            return new Response(
              JSON.stringify({
                ok: true,
                duplicate: false,
                message:
                  "Item verified.",
              }),
              {
                status: 201,
                headers: {
                  "Content-Type":
                    "application/json",
                },
              },
            );
          },
        );

        const result =
          await submitBarcodeScan(
            fetcher,
            "/api/test",
            "BOX-ABC-001",
            "code_128",
          );

        expect(result).toEqual({
          ok: true,
          duplicate: false,
          message: "Item verified.",
        });

        expect(fetcher).toHaveBeenCalledTimes(1);
      },
    );

    it(
      "preserves server rejection messages",
      async () => {
        const fetcher = vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                error:
                  "This barcode is not expected on this job.",
              }),
              {
                status: 422,
                headers: {
                  "Content-Type":
                    "application/json",
                },
              },
            ),
        );

        await expect(
          submitBarcodeScan(
            fetcher,
            "/api/test",
            "UNKNOWN",
            "code_128",
          ),
        ).rejects.toThrow(
          "This barcode is not expected on this job.",
        );
      },
    );

    it(
      "reports duplicate success without creating another unit",
      async () => {
        const fetcher = vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                ok: true,
                duplicate: true,
              }),
              {
                status: 200,
                headers: {
                  "Content-Type":
                    "application/json",
                },
              },
            ),
        );

        const result =
          await submitBarcodeScan(
            fetcher,
            "/api/test",
            "BOX-001",
            "code_128",
          );

        expect(result.duplicate).toBe(true);
        expect(result.message).toBe(
          "Already verified on this job.",
        );
      },
    );
  },
);
