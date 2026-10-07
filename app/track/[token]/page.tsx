import type { Metadata } from "next";
import TrackingView from "./TrackingView";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Track your delivery",
  robots: { index: false, follow: false },
};

/*
  Public tracking page. Fixed light palette, deliberately not tokenised and
  absent from lib/nav/themeableRoutes.ts, like /pod/share/[token]: a delivery
  recipient sees a neutral page, not the operator's theme. shouldShowShell
  hides the console sidebar here even for a signed-in office user.
  The token is only passed to the client view, which polls the JSON route;
  nothing is loaded on the server, so the page itself reveals nothing.
*/
export default async function TrackPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <main className="min-h-screen bg-slate-100 px-4 py-6 text-slate-950 [color-scheme:light]">
      <div className="mx-auto max-w-xl">
        <TrackingView token={token} />
      </div>
    </main>
  );
}
