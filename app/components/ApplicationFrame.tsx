"use client";

import type { ReactNode } from "react";
import AppShell from "./AppShell";
import ThemeScope from "./ThemeScope";
import { TenantProvider } from "./TenantProvider";
import PastDueBanner from "../../components/billing/PastDueBanner";
import ContextualAssistant from "../../components/assistant/ContextualAssistant";

// The existing application frame, deferred on static public documents.
export default function ApplicationFrame({ children }: { children: ReactNode }) {
  return (
    <TenantProvider>
      <PastDueBanner />
      <div style={{ display: "flex", minHeight: "100vh" }}>
        <AppShell />
        <ThemeScope>{children}</ThemeScope>
      </div>
      <ContextualAssistant />
    </TenantProvider>
  );
}
