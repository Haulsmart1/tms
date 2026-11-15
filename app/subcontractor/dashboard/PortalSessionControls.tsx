"use client";

import { useState } from "react";
import { ArrowLeft, LogOut } from "lucide-react";
import Button, { buttonClasses } from "../../../components/Button";
import { createClient } from "../../../lib/supabase/browser";

export default function PortalSessionControls({ awayFromJobs = false }: { awayFromJobs?: boolean }) {
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState("");

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    setError("");
    try {
      const { error } = await createClient().auth.signOut({ scope: "local" });
      if (error) throw error;
      // A full navigation discards the portal's client state after the session is cleared.
      window.location.replace("/login?next=%2Fsubcontractor%2Fdashboard");
    } catch {
      setError("Could not log out. Please try again.");
      setSigningOut(false);
    }
  }

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <a href={awayFromJobs ? "#assigned-jobs" : "/"} className={buttonClasses("secondary", "md")}>
          <ArrowLeft size={16} aria-hidden />
          {awayFromJobs ? "Back to Jobs" : "Back to TMS home"}
        </a>
        <Button type="button" variant="secondary" loading={signingOut} onClick={() => void signOut()}>
          <LogOut size={16} aria-hidden />
          Log out
        </Button>
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  );
}
