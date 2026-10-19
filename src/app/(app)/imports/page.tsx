import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { imports, users } from "@/db/schema";
import { canImport, requireUser } from "@/lib/server/auth";
import { fmtDate, fmtDateTime, fmtNb } from "@/lib/format";
import { BoutonImport } from "@/components/import/ImportProvider";
import { AnnulerDernierImport } from "@/components/import/AnnulerDernierImport";
import { ImportTrafic } from "@/components/import/ImportTrafic";
import { historiqueTrafic, referenceDonnees } from "@/lib/server/trafic";

const STATUTS: Record<string, string> = { applique: "Appliqué", annule: "Annulé", brouillon: "En attente", abandonne: "Abandonné" };

export default async function ImportsPage() {
  const user = await requireUser();
  const db = await getDb();
  const list = await db.select({ i: imports, auteur: users.email }).from(imports).leftJoin(users, eq(users.id, imports.userId)).where(and(eq(imports.type, "dossiers"), inArray(imports.statut, ["applique", "annule"]))).orderBy(desc(imports.createdAt)).limit(50);
  const dernier = list.find((x) => x.i.statut === "applique");
  const [trafic, reference] = await Promise.all([historiqueTrafic(db), referenceDonnees(db)]);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl">Imports</h1>
          <p className="mt-1 max-w-2xl text-gris-texte">Chaque lundi, déposez l&apos;extract SpeedResa (xlsx ou csv) n&apos;importe où dans l&apos;application. Les dossiers sont fusionnés par IDresa : un extract cumulatif ou partiel donne le même résultat.</p>
        </div>
        {canImport(user) ? <BoutonImport /> : <p className="text-sm text-gris-texte">Votre rôle ne permet pas d&apos;importer. Demandez l&apos;autorisation au super admin.</p>}
      </div>
      <section className="carte overflow-x-auto" aria-labelledby="hist-titre">
        <div className="flex items-center justify-between border-b border-gris-clair p-4">
          <h2 id="hist-titre" className="text-lg">Historique des extracts SpeedResa</h2>
          {user.role === "superadmin" && dernier && <AnnulerDernierImport fichier={dernier.i.fichier} />}
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gris-clair/50 text-left text-xs text-gris-texte">
            <tr>{["Date", "Par", "Fichier", "Période", "Dossiers lus", "Nouveaux", "Mis à jour", "Données au", "Statut"].map((h) => <th key={h} scope="col" className="px-3 py-2 font-semibold">{h}</th>)}</tr>
          </thead>
          <tbody>
            {list.map(({ i, auteur }) => {
              const s = (i.stats ?? {}) as Record<string, number | string | null>;
              return (
                <tr key={i.id} className="border-t border-gris-clair">
                  <td className="px-3 py-2 whitespace-nowrap">{fmtDateTime(i.appliqueLe ?? i.createdAt)}</td>
                  <td className="px-3 py-2">{auteur ?? "—"}</td>
                  <td className="px-3 py-2">{i.fichier}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{fmtDate(i.periodeDebut)} → {fmtDate(i.periodeFin)}</td>
                  <td className="px-3 py-2 tabular-nums">{fmtNb(s.dossiersLus as number ?? s.lignesLues as number)}</td>
                  <td className="px-3 py-2 tabular-nums">{s.nouveaux !== undefined ? fmtNb(s.nouveaux as number) : "—"}</td>
                  <td className="px-3 py-2 tabular-nums">{s.modifies !== undefined ? fmtNb(s.modifies as number) : "—"}</td>
                  <td className="px-3 py-2">{fmtDate(s.reference as string | null)}</td>
                  <td className="px-3 py-2">{STATUTS[i.statut] ?? i.statut}</td>
                </tr>
              );
            })}
            {!list.length && <tr><td colSpan={9} className="p-8 text-center text-gris-texte">Aucun import pour l&apos;instant.</td></tr>}
          </tbody>
        </table>
      </section>

      {canImport(user) && <ImportTrafic reference={reference} />}
      {trafic.length > 0 && (
        <section className="carte p-4" aria-labelledby="hist-trafic">
          <h2 id="hist-trafic" className="text-lg">Imports de trafic</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {trafic.map((t) => { const s = (t.stats ?? {}) as { clients?: number; mois?: number; lignesIgnorees?: string[] }; return (
              <li key={t.id}><strong>{fmtDateTime(t.appliqueLe ?? t.createdAt)}</strong> — {t.fichier} · {s.clients} client(s), {s.mois} mois ({fmtDate(t.periodeDebut).slice(3)} → {fmtDate(t.periodeFin).slice(3)}){s.lignesIgnorees?.length ? <span className="text-gris-texte"> · ignorées : {s.lignesIgnorees.join(", ")}</span> : null}</li>
            ); })}
          </ul>
        </section>
      )}
    </div>
  );
}
