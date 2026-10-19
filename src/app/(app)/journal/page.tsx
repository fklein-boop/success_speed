import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { activityLog, users } from "@/db/schema";
import { requireUser } from "@/lib/server/auth";
import { fmtDateTime } from "@/lib/format";

const LIBELLES: Record<string, string> = {
  connexion: "Connexion", import_applique: "Import appliqué", import_annule: "Import annulé",
  utilisateur_ajoute: "Utilisateur ajouté", utilisateur_modifie: "Utilisateur modifié", invitation_envoyee: "Invitation envoyée",
  clients_reattribues: "Clients réattribués", client_modifie: "Fiche client modifiée", url_ajoutee: "URL ajoutée", url_supprimee: "URL retirée",
};

export default async function JournalPage() {
  await requireUser(["superadmin"]);
  const db = await getDb();
  const list = await db.select({ a: activityLog, email: users.email }).from(activityLog).leftJoin(users, eq(users.id, activityLog.userId)).orderBy(desc(activityLog.createdAt)).limit(300);
  return (
    <div className="space-y-6">
      <h1 className="text-3xl">Journal d&apos;activité</h1>
      <section className="carte overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gris-clair/50 text-left text-xs text-gris-texte">
            <tr>{["Date", "Utilisateur", "Action", "Objet", "Détails"].map((h) => <th key={h} scope="col" className="px-3 py-2 font-semibold">{h}</th>)}</tr>
          </thead>
          <tbody>
            {list.map(({ a, email }) => (
              <tr key={a.id} className="border-t border-gris-clair align-top">
                <td className="px-3 py-2 whitespace-nowrap">{fmtDateTime(a.createdAt)}</td>
                <td className="px-3 py-2">{email ?? "système"}</td>
                <td className="px-3 py-2">{LIBELLES[a.action] ?? a.action}</td>
                <td className="px-3 py-2">{a.entite ? `${a.entite} ${a.entiteId ?? ""}` : "—"}</td>
                <td className="px-3 py-2 font-mono text-xs text-gris-texte">{a.details ? JSON.stringify(a.details) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
