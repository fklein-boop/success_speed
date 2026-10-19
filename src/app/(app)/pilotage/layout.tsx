import { requireUser } from "@/lib/server/auth";
import { SousNav } from "@/components/SousNav";

export default async function PilotageLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl">Pilotage</h1>
        <SousNav label="Pilotage" liens={[{ href: "/pilotage", label: "Alertes" }, { href: "/pilotage/benchmark", label: "Benchmark" }, { href: "/pilotage/opportunites", label: "Opportunités" }]} />
      </div>
      {children}
    </div>
  );
}
