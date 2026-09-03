import type { ReactNode } from "react";
import Badge from "../../components/Badge";
import Skeleton from "../../components/Skeleton";
import type { ComplianceLevel, ComplianceResult } from "./types";

/* Moved verbatim out of page.tsx (bar Info's widened value prop and its new
   loading prop). These live in their own module rather than in the card
   because page.tsx uses each of them outside the card too, so putting them in
   the card would make page.tsx and the card import each other.

   Info is a passenger here: it is a generic label/value cell, not a compliance
   concern, and it lives in this file only because it had to escape page.tsx
   too. It belongs in a shared components/InfoField once a second page wants
   it, which /vehicles will. */

export function Info({
  label,
  value,
  loading,
}: {
  label: string;
  value: ReactNode;
  loading?: boolean;
}) {
  return (
    <div className="text-sm">
      <span className="text-kicker uppercase text-ink-2">{label}</span>{" "}
      <strong className="block text-ink">
        {/* inline-block keeps this block-level <strong>'s line box at its
            text height. A block skeleton shrinks each cell by 4px, and with
            two rows of cells the card jumps while loading. */}
        {loading ? <Skeleton display="inline-block" w="80%" h="0.875rem" /> : value || "—"}
      </strong>
    </div>
  );
}

export function getCompliance(expiry: string | null): ComplianceResult {
  if (!expiry) {
    return {
      level: "amber",
      label: "DATE NEEDED",
      days: null,
    };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const expiryDate = new Date(`${expiry}T00:00:00`);
  const days = Math.ceil((expiryDate.getTime() - today.getTime()) / 86_400_000);

  if (days < 0) {
    return {
      level: "red",
      label: `EXPIRED ${Math.abs(days)}d`,
      days,
    };
  }

  if (days <= 7) {
    return {
      level: "red",
      label: days === 0 ? "EXPIRES TODAY" : `NEEDS ATTENTION • ${days}d`,
      days,
    };
  }

  if (days <= 30) {
    return {
      level: "amber",
      label: `EXPIRING SOON • ${days}d`,
      days,
    };
  }

  return {
    level: "ok",
    label: `VALID • ${days}d`,
    days,
  };
}

export function mostUrgent(results: ComplianceResult[]): ComplianceResult {
  /* An empty list has no most-urgent member, so there is no honest value to
     return. This was safe while the function was page-local and every caller
     passed a fixed five, but it is a module API now: say so explicitly rather
     than letting reduce throw an opaque TypeError. */
  if (results.length === 0) {
    throw new Error("mostUrgent requires at least one compliance result");
  }

  const rank: Record<ComplianceLevel, number> = {
    ok: 0,
    amber: 1,
    red: 2,
  };

  return results.reduce((current, next) =>
    rank[next.level] > rank[current.level] ? next : current
  );
}

export function StatusBadge({ result }: { result: ComplianceResult }) {
  return (
    <Badge
      tone={
        result.level === "red"
          ? "danger"
          : result.level === "amber"
            ? "warning"
            : "success"
      }
    >
      {result.label}
    </Badge>
  );
}

export function subcontractorCardStyle(level: ComplianceLevel): string {
  if (level === "red") {
    return "rounded-lg border-2 border-danger bg-danger-tint p-3";
  }

  if (level === "amber") {
    return "rounded-lg border-2 border-warning bg-warning-tint p-3";
  }

  return "rounded-lg border border-line bg-surface-2 p-3";
}
