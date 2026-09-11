/* Single definition of "shaped like a UUID". Before this file existed, this
   exact pattern was copied byte-for-byte into four places: this feature's
   two /api/super-admin/[id] routes, lib/superAdmin/tenantEdit.ts, and
   lib/driver/loadManifest.ts. The risk with four independent copies is
   concrete, not theoretical: a future loosening of one copy (say, to accept
   a prefixed id) desyncs the route-param check from the request-body check
   within the SAME request, so a value one guard rejects the other accepts.

   lib/driver/loadManifest.ts keeps its own copy on purpose -- it predates
   this file and is outside the super-admin feature this file was extracted
   for -- but nothing stops a future cleanup from pointing it here too. */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}
