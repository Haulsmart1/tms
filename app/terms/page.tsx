import LegalPage from "../../components/legal/LegalPage";
import { legalMetadata } from "../../lib/legal/metadata";

/* A public policy page. The words live in lib/legal/content/, the layout in
   components/legal/LegalPage.tsx. Adding or moving one of these means touching
   the lists named at the top of lib/legal/routes.ts. */
const PATH = "/terms";

export const metadata = legalMetadata(PATH);

export default function Page() {
  return <LegalPage path={PATH} />;
}
