/*
  The in-product notice an admin accepts when approving a driver's objection to
  a walkaround VOR. This is product copy, not policy wording: the matching
  clause belongs in the source Terms document in docs/TMS POLICIES/ and goes
  through solicitor review. Bump the version whenever the text changes; the
  accepted version is stored on defect_objections.liability_notice_version.
*/

export const LIABILITY_NOTICE_VERSION = "2026-09-29.1";

export const LIABILITY_NOTICE_TEXT =
  "You are overriding a defect the walkaround checklist classes as dangerous. " +
  "This override is the operator's decision and responsibility, not TMS Wizzard's. " +
  "Only approve it if you are satisfied the vehicle is roadworthy.";
