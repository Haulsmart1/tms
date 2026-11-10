import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { isPublicPath } from "../auth/publicRoutes";

it("installs Warehouse separately from Driver, with authenticated navigation inside its scope", () => {
  const manifest = JSON.parse(readFileSync(resolve("public/warehouse/manifest.webmanifest"), "utf8"));
  const driver = JSON.parse(readFileSync(resolve("public/driver/manifest.webmanifest"), "utf8"));
  const origin = "https://fixture.invalid";
  expect(new URL(manifest.id, origin).href).not.toBe(new URL(driver.id, origin).href);
  expect(manifest.start_url).toBe("/warehouse"); expect(manifest.display).toBe("standalone");
  for (const path of [manifest.start_url, "/login", "/auth/confirm", "/jobs"]) {
    expect(new URL(path, origin).href.startsWith(new URL(manifest.scope, origin).href)).toBe(true);
  }
  for (const icon of manifest.icons) expect(existsSync(resolve("public", `.${icon.src}`))).toBe(true);
  expect(isPublicPath(manifest.start_url)).toBe(false);
  expect(driver.start_url).toBe("/driver/dashboard"); expect(driver.scope).toBe("/driver/");
});
