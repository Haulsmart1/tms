"use client";
import { useEffect, useState } from "react";
import { useOnline } from "./useDriverShift";

type InstallEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> };
export default function DriverPwa() {
  const online = useOnline();
  const [install, setInstall] = useState<InstallEvent | null>(null);
  const [problem, setProblem] = useState("");
  useEffect(() => {
    if (!('serviceWorker' in navigator) || process.env.NODE_ENV !== "production") return;
    void navigator.serviceWorker.register("/driver/sw.js", { scope: "/driver/", updateViaCache: "none" })
      .then(async () => {
        const registration = await navigator.serviceWorker.ready;
        registration.active?.postMessage({ type: "PREPARE_DRIVER_PAGES", paths: [
          "/driver/dashboard", "/driver/walkaround?phase=start", "/driver/walkaround?phase=swap",
        ] });
      }).catch(() => setProblem("Offline reopening is unavailable in this browser."));
    const offer = (event: Event) => { event.preventDefault(); setInstall(event as InstallEvent); };
    const installed = () => setInstall(null);
    window.addEventListener("beforeinstallprompt", offer);
    window.addEventListener("appinstalled", installed);
    return () => { window.removeEventListener("beforeinstallprompt", offer); window.removeEventListener("appinstalled", installed); };
  }, []);
  return <div className="ds bg-canvas px-4 py-2 font-sans text-sm text-ink" role="status">
    {!online ? <span>Offline. Saved work will send when you reconnect. </span> : null}
    {problem ? <span>{problem} </span> : null}
    {install ? <button type="button" onClick={async () => { await install.prompt(); await install.userChoice; setInstall(null); }}>Install driver app</button> : null}
    {!install && online ? <span>For quick access, add TMS Driver to your phone’s home screen.</span> : null}
  </div>;
}
