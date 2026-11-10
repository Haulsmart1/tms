"use client";

import { useEffect, useState } from "react";

type Layout = { order: string[]; collapsed: string[] };

export function orderVehicles<T extends { id: string }>(vehicles: T[], order: string[]): T[] {
  const byId = new Map(vehicles.map(vehicle => [vehicle.id, vehicle]));
  const ids = [...new Set([...order, ...vehicles.map(vehicle => vehicle.id)])];
  return ids.flatMap(id => byId.has(id) ? [byId.get(id)!] : []);
}

/** Presentation preferences never change a job's van, driver or route order. */
export function useVehicleLayout<T extends { id: string }>(vehicles: T[], scope: string, savedOrder: string[]) {
  const [stored, setStored] = useState<{ scope: string; layout: Layout } | null>(null);
  useEffect(() => {
    let layout: Layout | null = null;
    try {
      const raw = window.localStorage.getItem(`tms:vehicle-layout:v1:${scope}`);
      const value = raw && raw.length < 100_000 ? JSON.parse(raw) : null;
      if (value && Array.isArray(value.order) && value.order.every((id: unknown) => typeof id === "string") &&
          Array.isArray(value.collapsed) && value.collapsed.every((id: unknown) => typeof id === "string")) layout = value;
    } catch { /* Storage is optional on private/managed devices. */ }
    setStored(layout ? { scope, layout } : null);
  }, [scope]);
  const layout = stored?.scope === scope ? stored.layout : { order: savedOrder, collapsed: [] };
  const ordered = orderVehicles(vehicles, layout.order);
  const collapsed = new Set(layout.collapsed);
  function save(next: Layout) {
    setStored({ scope, layout: next });
    try { window.localStorage.setItem(`tms:vehicle-layout:v1:${scope}`, JSON.stringify(next)); } catch { /* Keep the in-memory layout. */ }
  }
  return {
    vehicles: ordered,
    collapsed,
    move(vehicleId: string, offset: -1 | 1) {
      const ids = ordered.map(vehicle => vehicle.id);
      const index = ids.indexOf(vehicleId), target = index + offset;
      if (index < 0 || target < 0 || target >= ids.length) return;
      [ids[index], ids[target]] = [ids[target], ids[index]];
      save({ ...layout, order: ids });
    },
    toggle(vehicleId: string) {
      const next = new Set(collapsed);
      if (next.has(vehicleId)) next.delete(vehicleId); else next.add(vehicleId);
      save({ ...layout, collapsed: [...next] });
    },
    collapseAll(value: boolean) { save({ ...layout, collapsed: value ? ordered.map(vehicle => vehicle.id) : [] }); },
  };
}
