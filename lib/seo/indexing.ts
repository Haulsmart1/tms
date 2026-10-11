import { LEGAL_PATHS } from "../legal/routes";
import { MARKETING_PATHS } from "./routes";

// Used by Next headers(), including token URLs with dots, PDFs, API responses
// and redirects. New application routes remain noindex by default.
export function privateHeaderSource(): string {
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const publicPaths = [...MARKETING_PATHS, ...LEGAL_PATHS]
    .map((path) => escape(path.slice(1)))
    .join("|");
  return `/((?!(?:${publicPaths}|robots\\.txt|sitemap\\.xml|social-preview)/?$|_next/).*)`;
}
