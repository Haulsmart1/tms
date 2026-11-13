"use client";

import { useEffect, useState } from "react";
import Button from "../../components/Button";
import type { TenantRole } from "../../lib/tenant/context";
import styles from "./warehouse.module.css";

type InstallEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> };

export default function WarehouseAppAccess({ email, role, workspace }: {
  email: string | null; role: TenantRole; workspace: string | null;
}) {
  const [install, setInstall] = useState<InstallEvent | null>(null);
  const [standalone, setStandalone] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [problem, setProblem] = useState("");

  useEffect(() => {
    const display = window.matchMedia("(display-mode: standalone)");
    const update = () => setStandalone(display.matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);
    const offer = (event: Event) => { event.preventDefault(); setInstall(event as InstallEvent); };
    const installed = () => { setInstall(null); setStandalone(true); };
    update();
    display.addEventListener("change", update);
    window.addEventListener("beforeinstallprompt", offer);
    window.addEventListener("appinstalled", installed);
    return () => {
      display.removeEventListener("change", update);
      window.removeEventListener("beforeinstallprompt", offer);
      window.removeEventListener("appinstalled", installed);
    };
  }, []);

  async function installApp() {
    if (!install || installing) return;
    setInstalling(true); setProblem("");
    try { await install.prompt(); await install.userChoice; }
    catch { setProblem("Use your browser’s Add to Home Screen option below."); }
    finally { setInstall(null); setInstalling(false); }
  }

  return <section className={styles.appAccess} aria-label="Warehouse access">
    <div><strong>{workspace ? `${workspace} · ` : ""}{role === "staff" ? "Staff" : "Administrator"}</strong>
      {email && <p>Signed in as {email}</p>}</div>
    {!standalone && <div className={styles.install}>
      {install && <Button size="sm" loading={installing} onClick={() => void installApp()}>Install Warehouse app</Button>}
      <details><summary>Add Warehouse to your phone</summary>
        <p><strong>iPhone:</strong> open this page in Safari, tap Share, then Add to Home Screen.</p>
        <p><strong>Android:</strong> open the browser menu and choose Install app or Add to Home screen.</p>
        <p>Name it TMS Warehouse. This shortcut opens the Warehouse dashboard.</p>
      </details>
      {problem && <p role="status">{problem}</p>}
    </div>}
    <a href="/driver/dashboard" target="_blank" rel="noopener noreferrer" className="underline">
      Open TMS Driver
    </a>
    <p className={styles.connectionHint}>Connect to the internet to scan, load and save jobs.</p>
  </section>;
}
