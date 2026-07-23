import Container from "../Container";

export default function Footer() {
  return (
    <footer className="border-t border-line bg-surface">
      <Container className="flex flex-col items-start justify-between gap-3 py-6 text-xs text-ink-3 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2">
          <span className="h-4 w-4 rounded bg-line-strong" aria-hidden />
          TMS Wizzard · Cloud transport management
        </div>
        <nav className="flex gap-4" aria-label="Footer">
          <a href="#" className="hover:text-ink-2">
            Privacy
          </a>
          <a href="#" className="hover:text-ink-2">
            Terms
          </a>
          <a href="#request-access" className="hover:text-ink-2">
            Contact
          </a>
        </nav>
      </Container>
    </footer>
  );
}
