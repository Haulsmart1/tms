import Container from "../Container";

export default function Footer() {
  return (
    <footer className="border-t border-line bg-surface">
      <Container className="flex flex-col items-start justify-between gap-3 py-6 text-xs text-ink-3 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2">
          <span className="h-4 w-4 rounded bg-line-strong" aria-hidden />
          TMS Wizzard · Cloud transport management
        </div>
        {/* Privacy and Terms are hidden, not faked (review SET-26). They were
            href="#" placeholders that went nowhere. Restore them once real
            privacy notice and terms pages are published. */}
        <nav className="flex gap-4" aria-label="Footer">
          <a href="#request-access" className="hover:text-ink-2">
            Contact
          </a>
        </nav>
      </Container>
    </footer>
  );
}
