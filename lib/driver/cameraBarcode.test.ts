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
      "names what can be typed instead of scanning",
      () => {
        expect(cameraAccessErrorMessage({ name: "NotFoundError" })).toBe(
          "No usable camera was found. Enter the serial manually.",
        );
        expect(cameraAccessErrorMessage({ name: "NotFoundError" }, "registration")).toBe(
          "No usable camera was found. Enter the registration manually.",
        );
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
  },
);
