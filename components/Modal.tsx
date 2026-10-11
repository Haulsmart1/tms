"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { modalTabTarget } from "../lib/ui/modalFocus";

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  /** "md" is the confirm-dialog width. "lg" is for read-only detail views
      with lists (Planning job detail); the panel scrolls when tall. */
  size?: "md" | "lg";
};

const widths: Record<NonNullable<Props["size"]>, string> = {
  md: "max-w-md",
  lg: "max-w-2xl",
};

/* Contain keyboard focus while open; restore the opener on close. */
export default function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = "md",
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  // Per-instance id: a fixed "modal-title" would collide if two ever mount.
  const titleId = useId();

  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  /* Depends on `open` only. Callers pass inline arrows for onClose, and the
     Planning page re-renders on a 30-second position poll; with onClose in
     the deps every poll would pull focus back to the panel, away from a
     footer button or the label printer overlay. */
  useEffect(() => {
    if (!open) return;
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    panelRef.current?.focus();
    function onKeyDown(e: KeyboardEvent) {
      const panel = panelRef.current;
      const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
      // A higher overlay (for example label printing) owns its own focus.
      if (!panel || panel.closest('[inert]') || dialogs[dialogs.length - 1] !== panel) return;
      if (e.key === "Escape" && !e.defaultPrevented) { e.preventDefault(); onCloseRef.current(); }
      if (e.key === "Tab" && !e.defaultPrevented) {
        const controls = Array.from(panel.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')).filter(el => el.getClientRects().length > 0 && el.tabIndex >= 0);
        const target = modalTabTarget<HTMLElement>(controls, document.activeElement as HTMLElement | null, panel, e.shiftKey);
        if (target) { e.preventDefault(); target.focus(); }
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (opener?.isConnected) opener.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[rgba(11,18,32,0.55)]" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`relative z-10 flex max-h-[85vh] w-full flex-col rounded-lg bg-surface p-6 shadow-lg outline-none ${widths[size]}`}
      >
        <h2 id={titleId} className="text-lg font-semibold text-ink">
          {title}
        </h2>
        <div className="mt-3 min-h-0 overflow-y-auto text-sm text-ink-2">{children}</div>
        {footer ? <div className="mt-6 flex flex-wrap justify-end gap-2">{footer}</div> : null}
      </div>
    </div>
  );
}
