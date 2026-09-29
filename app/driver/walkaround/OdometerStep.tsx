"use client";
/* One odometer reading, typed on the phone keypad as a whole number. */

import { w } from "./styles";

export default function OdometerStep({ label, hint, value, onChange }: { label: string; hint: string; value: string; onChange: (text: string) => void }) {
  return (
    <label className="block">
      <span className={w.label}>{label}</span>
      <input
        className={`${w.input} text-2xl font-black`}
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        maxLength={7}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <span className={`${w.muted} mt-2 block`}>{hint}</span>
    </label>
  );
}
