import FeaturePage from "../../../components/landing/FeaturePage";
import { FEATURES } from "../../../lib/seo/content";
import { publicMetadata } from "../../../lib/seo/site";
const content = FEATURES[1];
export const metadata = publicMetadata(content.path, content.title, content.description);
export default function Page() { return <FeaturePage content={content} />; }
