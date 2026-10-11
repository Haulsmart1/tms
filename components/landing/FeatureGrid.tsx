import {
  ClipboardList,
  PackageCheck,
  ReceiptText,
  Truck,
  UserRound,
  Network,
  MapPin,
  ShieldCheck,
} from "lucide-react";
import Container from "../Container";
import Link from "next/link";
import { SectionHeading } from "./Brand";

const features = [
  { icon: ClipboardList, title: "Jobs Management", body: "Bookings, stops and assignments.", href: "/features/transport-job-management" },
  { icon: PackageCheck, title: "POD Capture", body: "Recipient details, photos and documents.", href: "/features/electronic-proof-of-delivery" },
  { icon: ReceiptText, title: "Transport Invoicing", body: "Invoices, payments and statements.", href: "/features/transport-invoicing" },
  { icon: Truck, title: "Fleet Management", body: "Vehicles and assets." },
  { icon: UserRound, title: "Driver Management", body: "Hours and licences." },
  { icon: Network, title: "Subcontractors", body: "Rates and control." },
  { icon: MapPin, title: "Vehicle Tracking", body: "Latest available vehicle positions." },
  { icon: ShieldCheck, title: "Compliance Records", body: "Driver activity and maintenance records." },
];

export default function FeatureGrid() {
  return (
    <section id="features" className="brand-section brand-feature-section">
      <Container>
        <SectionHeading label="AROUND THE TRANSPORT JOB" title="The people, vehicles and records behind the work."><p>Connect the core job workflow with fleet, driver and subcontractor records. Explore the tools your office needs, then check their fit against your own operation.</p></SectionHeading>
        <div className="feature-cards">
          {features.map(({ icon: Icon, title, body, href }) => (
            <div key={title} className="feature-card">
              <Icon size={20} strokeWidth={2} className="text-primary" aria-hidden />
              <h3 className="mt-2 text-base font-semibold text-ink">{href ? <Link href={href} className="text-primary-deep underline">{title}</Link> : title}</h3>
              <p className="mt-1 text-sm text-ink-2">{body}</p>
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
}
