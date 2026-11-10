"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { parseImplicitAuthFragment, type ImplicitLink } from "../../../lib/auth/implicit";

// Supabase's default email template verifies the link before redirecting and
// returns credentials in a fragment. The server cannot see that fragment.
// Keep it in memory, remove it from history, and require a human POST before
// creating the site's cookies. Never initialise an auto-detecting auth client.
export default function ImplicitLinkConfirmation({ next }: { next: string }) {
  const [link, setLink] = useState<ImplicitLink | null>(null);
  const captured = useRef(false);
  useEffect(() => {
    if (captured.current) return;
    captured.current = true;
    setLink(parseImplicitAuthFragment(window.location.hash));
    if (window.location.hash) {
      window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
    }
  }, []);

  if (!link) return <p className="mt-2 text-sm text-ink-2" role="status">Checking your sign-in link…</p>;
  if (link.kind !== "session") return <>
    <p className="mt-2 text-sm text-ink-2">{link.kind === "unavailable"
      ? "This sign-in link has expired or has already been used. Request a fresh link below."
      : "This sign-in link is incomplete or invalid. Request a fresh link below."}</p>
    <Link href={`/login?next=${encodeURIComponent(next)}`} prefetch={false} className="mt-5 inline-block text-sm font-semibold text-primary-deep underline">Request a new login link</Link>
  </>;

  return <>
    <p className="mt-2 text-sm text-ink-2">Press continue to finish signing in to TMS Wizard.</p>
    <p className="mt-2 text-sm text-ink-2">Only continue if this invitation or login link was sent to your own email address.</p>
    <form method="post" action="/api/auth/callback" className="mt-5">
      <input type="hidden" name="mode" value="implicit" />
      <input type="hidden" name="access_token" value={link.session.access_token} />
      <input type="hidden" name="refresh_token" value={link.session.refresh_token} />
      <input type="hidden" name="type" value={link.type} />
      <input type="hidden" name="next" value={next} />
      <button type="submit" className="w-full rounded-md bg-primary px-4 py-3 text-sm font-semibold text-on-primary hover:bg-primary-hover">Continue to TMS Wizard</button>
    </form>
  </>;
}
