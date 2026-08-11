"use client";

import { useState, type CSSProperties } from "react";
import { createClient } from "../../lib/supabase/browser";
import { classifyPodValue, signPodPath } from "../../lib/pod/podUrl";

const linkButtonStyle: CSSProperties = {
  color: "#2953E3", fontWeight: 600, cursor: "pointer",
  textDecoration: "underline", background: "none", border: "none", padding: 0,
};

const externalStyle: CSSProperties = { color: "#2953E3", fontWeight: 600 };

export default function PodLink({
  value, label,
}: { value: string | null | undefined; label: string }) {
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const pod = classifyPodValue(value);
  if (pod.kind === "empty") return null;

  if (pod.kind === "external") {
    return (
      <a href={pod.href} target="_blank" rel="noopener noreferrer" style={externalStyle}>
        Open external link ({pod.host})
      </a>
    );
  }

  const path = pod.path;
  return (
    <>
      <button
        type="button"
        style={linkButtonStyle}
        disabled={busy}
        onClick={async () => {
          setFailed(false);
          setBusy(true);
          const w = window.open("", "_blank");
          const url = await signPodPath(supabase, path);
          setBusy(false);
          if (url && w) {
            try { (w as unknown as { opener: unknown }).opener = null; } catch { /* ignore */ }
            w.location.href = url;
          } else {
            w?.close();
            setFailed(true);
          }
        }}
      >
        {busy ? "Opening..." : label}
      </button>
      {failed ? (
        <span style={{ color: "#D23E3E", marginLeft: 8 }}>Could not open the file.</span>
      ) : null}
    </>
  );
}
