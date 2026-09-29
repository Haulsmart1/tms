/*
  The locked baseline walkaround catalogue: the checks every HGV needs, based on
  the DVSA guide to the daily walkaround check. DVSA-based, not DVSA-endorsed:
  never describe it as approved.

  THE CONTRACT with docs/sql/shifts_02_catalogue_seed.sql: every entry here is
  seeded there with the same code and severity, and
  lib/walkaround/baselineSql.test.ts fails when they drift. Companies cannot
  edit, retire or downgrade these rows (trigger in shifts_03).
*/

import type { AppliesTo, Severity } from "./types";

export type BaselineEntry = {
  code: string;
  category: string;
  itemLabel: string;
  defectLabel: string;
  guidance: string;
  severity: Severity;
  appliesTo: AppliesTo;
  sortOrder: number;
};

type Row = [code: string, category: string, itemLabel: string, defectLabel: string, severity: Severity, appliesTo: AppliesTo, guidance: string];

const ROWS: Row[] = [
  ["mirrors_glass.mirror_missing_broken", "mirrors_glass", "Mirrors and glass", "Mirror missing, broken or cannot be adjusted", "dangerous", "vehicle", "Check every mirror is present, secure, unbroken and gives a clear view."],
  ["mirrors_glass.windscreen_view", "mirrors_glass", "Mirrors and glass", "Windscreen damage in the driver's line of sight", "dangerous", "vehicle", "Look for cracks, chips or discolouration in the area swept by the wipers."],
  ["mirrors_glass.windscreen_other", "mirrors_glass", "Mirrors and glass", "Windscreen or window damage outside the driver's line of sight", "minor", "vehicle", "Report any other crack or chip so it can be repaired before it spreads."],
  ["wipers.inoperative", "wipers_washers", "Wipers and washers", "Wipers do not work or blades are missing or worn", "dangerous", "vehicle", "Operate the wipers and washers; the blades must clear the screen."],
  ["wipers.washer_empty", "wipers_washers", "Wipers and washers", "Washer fluid empty or washers do not spray", "minor", "vehicle", "Operate the washers and top up the fluid if needed."],
  ["front_view.obstructed", "front_view", "Front view", "Driver's view obstructed by stickers or objects", "minor", "vehicle", "Nothing should block the view through the windscreen in the area swept by the wipers."],
  ["dashboard.brake_warning", "dashboard", "Dashboard warning lights and gauges", "Brake, ABS or EBS warning light stays on", "dangerous", "vehicle", "Switch on the ignition; every warning light must go out after the self-test."],
  ["dashboard.other_warning", "dashboard", "Dashboard warning lights and gauges", "Other warning light stays on or a gauge does not work", "minor", "vehicle", "Note which warning light or gauge is affected."],
  ["steering.excessive_play", "steering", "Steering", "Excessive play, stiffness or noise in the steering", "dangerous", "vehicle", "With the engine running, turn the wheel; there must be no excessive free play or jamming."],
  ["horn.inoperative", "horn", "Horn", "Horn does not work", "minor", "vehicle", "Sound the horn; it must work and be within reach."],
  ["brakes.air_leak", "brakes_air", "Brakes and air build-up", "Audible air leak", "dangerous", "both", "Listen for air leaks with the system charged; pressure must build and hold."],
  ["brakes.pressure_build", "brakes_air", "Brakes and air build-up", "Air pressure does not build or the warning buzzer stays on", "dangerous", "vehicle", "Watch the gauges while the system charges; the warning must clear."],
  ["brakes.parking_brake", "brakes_air", "Brakes and air build-up", "Parking brake does not hold", "dangerous", "both", "Apply the parking brake and check the vehicle does not creep."],
  ["height_marker.missing_wrong", "height_marker", "Height marker", "Height marker missing or showing the wrong height", "minor", "vehicle", "The cab height indicator must show the current running height."],
  ["seatbelts.faulty", "seatbelts", "Seatbelts", "Seatbelt cut, frayed, or does not latch or retract", "dangerous", "vehicle", "Every seatbelt must be undamaged and latch and retract properly."],
  ["lights.headlamp", "lights", "Lights and indicators", "Headlamp or sidelamp not working", "dangerous", "vehicle", "Walk round with the lamps on; every lamp must work, show the right colour and have an intact lens."],
  ["lights.brake_lamp", "lights", "Lights and indicators", "Brake light not working", "dangerous", "both", "Use a reflection or a colleague to check the brake lights."],
  ["lights.indicator", "lights", "Lights and indicators", "Indicator or hazard light not working", "dangerous", "both", "Switch on the hazard lights and check every indicator flashes."],
  ["lights.lens_damaged", "lights", "Lights and indicators", "Lamp lens cracked or missing, lamp still works", "minor", "both", "Report any damaged lens so it can be replaced."],
  ["leaks.fuel", "fuel_oil_leaks", "Fuel and oil leaks", "Fuel leak", "dangerous", "vehicle", "Look under the vehicle and around the tanks with the engine running."],
  ["leaks.fuel_cap", "fuel_oil_leaks", "Fuel and oil leaks", "Fuel cap missing or not secure", "dangerous", "vehicle", "Every fuel cap must be present and sealed."],
  ["leaks.oil", "fuel_oil_leaks", "Fuel and oil leaks", "Oil or other fluid dripping onto the road", "dangerous", "both", "Look under the engine, gearbox and axles for drips."],
  ["battery.insecure", "battery", "Battery security and condition", "Battery insecure or leaking", "minor", "vehicle", "The battery must be held down and show no leaks."],
  ["adblue.low", "adblue", "Diesel exhaust fluid (AdBlue)", "AdBlue low or warning light on", "minor", "vehicle", "Check the AdBlue level and top up if needed."],
  ["exhaust.smoke", "exhaust", "Excessive engine exhaust smoke", "Excessive smoke from the exhaust", "minor", "vehicle", "With the engine running, check the exhaust does not give off excessive smoke."],
  ["body.insecure", "body_wings", "Security of body and wings", "Body panel, wing or fitting loose and likely to fall", "dangerous", "both", "Check doors, panels, wings and fittings are secure."],
  ["spray.missing", "spray_suppression", "Spray suppression", "Spray suppression flap or mudguard missing or damaged", "minor", "both", "Every wheel must have its mudguard and spray suppression fitted and secure."],
  ["tyres.tread", "tyres_wheels", "Tyres and wheel fixing", "Tread below 1mm or cords visible", "dangerous", "both", "Check every tyre, including inner twins, for tread depth and exposed cords."],
  ["tyres.damage", "tyres_wheels", "Tyres and wheel fixing", "Cut, bulge or damage to a tyre", "dangerous", "both", "Look at both sidewalls of every tyre for cuts, bulges and damage."],
  ["tyres.underinflated", "tyres_wheels", "Tyres and wheel fixing", "Tyre flat or visibly under-inflated", "dangerous", "both", "Every tyre must be visibly inflated; report any that look low."],
  ["wheels.nut_loose", "tyres_wheels", "Tyres and wheel fixing", "Wheel nut missing or loose, or indicator moved", "dangerous", "both", "Check every wheel nut is present and any wheel nut indicators line up."],
  ["brake_lines.damaged", "brake_lines", "Brake lines", "Brake line or air hose damaged, chafed or leaking", "dangerous", "both", "Check the air lines and brake hoses for damage and chafing."],
  ["electrical.connections", "electrical", "Electrical connections", "Trailer electrical connection damaged or insecure", "dangerous", "both", "Every electrical line must be connected, undamaged and not chafing."],
  ["coupling.insecure", "coupling", "Coupling security", "Fifth wheel or drawbar coupling not locked or secured", "dangerous", "both", "Check the fifth wheel jaw is locked, the safety catch is on and the landing legs are raised."],
  ["load.insecure", "load", "Security of load", "Load not secured or at risk of shifting", "dangerous", "both", "Check straps, chains, curtains and doors hold the load securely."],
  ["number_plate.illegible", "number_plate", "Number plate", "Number plate missing, dirty or illegible", "minor", "both", "Every number plate must be present, clean and readable."],
  ["reflectors.missing", "reflectors", "Reflectors", "Reflector missing, broken or dirty", "minor", "both", "Check the side and rear reflectors are present, clean and unbroken."],
  ["markings.missing", "markings", "Markings and warning plates", "Required marking or warning plate missing", "minor", "both", "Check rear markings and any hazard warning plates are fitted and correct for the load."],
];

export const BASELINE_CATALOGUE: readonly BaselineEntry[] = ROWS.map(
  ([code, category, itemLabel, defectLabel, severity, appliesTo, guidance], index) => ({
    code,
    category,
    itemLabel,
    defectLabel,
    guidance,
    severity,
    appliesTo,
    sortOrder: (index + 1) * 10,
  }),
);
