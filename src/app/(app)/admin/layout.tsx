import { requireUser } from "@/lib/server/auth";
import { SousNav } from "@/components/SousNav";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireUser(["superadmin"]);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl">Administration</h1>
        <SousNav label="Administration" liens={[
          { href: "/admin", label: "Critères" }, { href: "/admin/clients", label: "Clients" }, { href: "/admin/parametres", label: "Paramètres de calcul" }, { href: "/admin/offres", label: "Offres et effort" }, { href: "/admin/google-analytics", label: "Google Analytics" },
          { href: "/admin/empreintes", label: "Empreintes TECH-06" }, { href: "/admin/textes-legaux", label: "Textes légaux" }, { href: "/admin/supervision", label: "Supervision" },
        ]} />
      </div>
      {children}
    </div>
  );
}
