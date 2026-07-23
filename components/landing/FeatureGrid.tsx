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

const features = [
  { icon: ClipboardList, title: "Jobs Management", body: "Plan, assign, dispatch." },
  { icon: PackageCheck, title: "POD Capture", body: "Signatures and photos." },
  { icon: ReceiptText, title: "Transport Invoicing", body: "Bill and reconcile." },
  { icon: Truck, title: "Fleet Management", body: "Vehicles and assets." },
  { icon: UserRound, title: "Driver Management", body: "Hours and licences." },
  { icon: Network, title: "Subcontractors", body: "Rates and control." },
  { icon: MapPin, title: "Live Tracking", body: "Real-time positions." },
  { icon: ShieldCheck, title: "Compliance and Tacho", body: "Stay road-legal." },
];

export default function FeatureGrid() {
  return (
    <section id="features" className="border-y border-line bg-surface py-12 md:py-16">
      <Container>
        <p className="text-overline uppercase text-ink-3">Everything in one place</p>
        <h2 className="mt-1 text-xl font-semibold text-ink">One platform, the whole operation</h2>
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {features.map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-lg border border-line p-4">
              <Icon size={20} strokeWidth={2} className="text-primary" aria-hidden />
              <h3 className="mt-2 text-base font-semibold text-ink">{title}</h3>
              <p className="mt-1 text-sm text-ink-3">{body}</p>
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
}
