import Link from "next/link";
import { asc } from "drizzle-orm";
import { LogOut } from "lucide-react";
import { getDb } from "@/db";
import { clients } from "@/db/schema";
import { canImport, requireUser } from "@/lib/server/auth";
import { Logo } from "@/components/Logo";
import { BoutonImport, ImportProvider } from "@/components/import/ImportProvider";
import { NavLink } from "@/components/NavLink";
import { ScanNotifier } from "@/components/scan/ScanNotifier";
import { deconnexion } from "../connexion/actions";

const ROLES: Record<string, string> = { superadmin: "Super admin", csm: "CSM", lecture: "Lecture seule" };

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const db = await getDb();
  const list = await db.select({ id: clients.id, nom: clients.nom }).from(clients).orderBy(asc(clients.nom));
  const admin = user.role === "superadmin";
  return (
    <ImportProvider autorise={canImport(user)} clients={list}>
      <a href="#contenu" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-white focus:p-2">Aller au contenu</a>
      <header className="bg-minuit text-white">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3">
          <Link href="/" className="shrink-0"><Logo inverse /></Link>
          <nav aria-label="Navigation principale" className="flex flex-1 items-center gap-1 text-sm">
            <NavLink href="/">Portefeuille</NavLink>
            <NavLink href="/criteres">Critères</NavLink>
            <NavLink href="/pilotage">Pilotage</NavLink>
            <NavLink href="/imports">Imports</NavLink>
            {admin && <NavLink href="/utilisateurs">Utilisateurs</NavLink>}
            {admin && <NavLink href="/journal">Journal</NavLink>}
            {admin && <NavLink href="/admin">Administration</NavLink>}
          </nav>
          <BoutonImport className="btn bg-white text-minuit hover:bg-gris-clair" />
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-right leading-tight lg:block">
              <span className="block">{user.nom || user.email}</span>
              <span className="block text-xs text-lagon">{ROLES[user.role]}</span>
            </span>
            <form action={deconnexion}>
              <button className="rounded-full p-2 hover:bg-white/10" aria-label="Se déconnecter" title="Se déconnecter"><LogOut size={18} /></button>
            </form>
          </div>
        </div>
        <div className="bg-degrade h-1" aria-hidden />
      </header>
      <main id="contenu" className="mx-auto max-w-[1400px] px-6 py-6">{children}</main>
      <ScanNotifier />
    </ImportProvider>
  );
}
