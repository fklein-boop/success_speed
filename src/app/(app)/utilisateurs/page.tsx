import { asc, count, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { clients, users } from "@/db/schema";
import { isSuperadminEmail, requireUser } from "@/lib/server/auth";
import { fmtDateTime } from "@/lib/format";
import { AjoutUtilisateurs, Reattribution } from "@/components/utilisateurs/Forms";
import { modifierUtilisateur, renvoyerInvitation } from "./actions";

const ROLES: [string, string][] = [["superadmin", "Super admin"], ["csm", "CSM"], ["lecture", "Lecture seule"]];

export default async function UtilisateursPage() {
  const me = await requireUser(["superadmin"]);
  const db = await getDb();
  const list = await db.select().from(users).orderBy(asc(users.email));
  const parCsm = new Map((await db.select({ csm: clients.csmId, n: count() }).from(clients).groupBy(clients.csmId)).map((r) => [r.csm, r.n]));
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl">Utilisateurs</h1>
        <p className="mt-1 max-w-2xl text-gris-texte">Seules les adresses de cette liste peuvent se connecter. On ne supprime pas un compte : on le désactive, pour garder l&apos;historique des audits.</p>
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <section className="carte p-4 lg:col-span-2" aria-labelledby="ajout-titre">
          <h2 id="ajout-titre" className="text-lg">Ajouter des utilisateurs</h2>
          <AjoutUtilisateurs />
        </section>
        <section className="carte p-4" aria-labelledby="reatt-titre">
          <h2 id="reatt-titre" className="text-lg">Réattribuer les clients d&apos;un CSM</h2>
          <Reattribution csms={list.filter((u) => u.role !== "lecture").map((u) => ({ id: u.id, nom: u.nom || u.email, n: parCsm.get(u.id) ?? 0 }))} />
        </section>
      </div>
      <section className="carte overflow-x-auto" aria-labelledby="liste-titre">
        <h2 id="liste-titre" className="border-b border-gris-clair p-4 text-lg">Comptes ({list.length})</h2>
        <table className="w-full text-sm">
          <thead className="bg-gris-clair/50 text-left text-xs text-gris-texte">
            <tr>{["Email", "Nom", "Rôle", "Import du lundi", "Clients", "Dernière connexion", "État", ""].map((h, i) => <th key={i} scope="col" className="px-3 py-2 font-semibold">{h}</th>)}</tr>
          </thead>
          <tbody>
            {list.map((u) => {
              const protege = isSuperadminEmail(u.email) || u.id === me.id;
              return (
                <tr key={u.id} className={`border-t border-gris-clair ${u.actif ? "" : "text-gris-texte"}`}>
                  <td className="px-3 py-2">{u.email}{isSuperadminEmail(u.email) && <span className="ml-2 rounded-full bg-minuit px-2 py-0.5 text-xs text-white">principal</span>}</td>
                  <td className="px-3 py-2">
                    <form action={modifierUtilisateur} className="flex gap-1">
                      <input type="hidden" name="id" value={u.id} /><input type="hidden" name="champ" value="nom" />
                      <label className="sr-only" htmlFor={`nom-${u.id}`}>Nom de {u.email}</label>
                      <input id={`nom-${u.id}`} name="valeur" defaultValue={u.nom ?? ""} className="champ w-36 py-1" placeholder="Prénom Nom" />
                      <button className="btn-discret px-2 py-1 text-xs">OK</button>
                    </form>
                  </td>
                  <td className="px-3 py-2">
                    {protege ? ROLES.find(([r]) => r === u.role)?.[1] : (
                      <form action={modifierUtilisateur} className="flex gap-1">
                        <input type="hidden" name="id" value={u.id} /><input type="hidden" name="champ" value="role" />
                        <label className="sr-only" htmlFor={`role-${u.id}`}>Rôle de {u.email}</label>
                        <select id={`role-${u.id}`} name="valeur" defaultValue={u.role} className="champ w-32 py-1">{ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                        <button className="btn-discret px-2 py-1 text-xs">OK</button>
                      </form>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {u.role === "csm" ? (
                      <form action={modifierUtilisateur}>
                        <input type="hidden" name="id" value={u.id} /><input type="hidden" name="champ" value="peutImporter" /><input type="hidden" name="valeur" value={String(!u.peutImporter)} />
                        <button className="btn-discret px-2 py-1 text-xs" aria-pressed={u.peutImporter}>{u.peutImporter ? "✓ Autorisé" : "Non autorisé"}</button>
                      </form>
                    ) : u.role === "superadmin" ? "✓" : "—"}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{parCsm.get(u.id) ?? 0}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{u.derniereConnexion ? fmtDateTime(u.derniereConnexion) : "Jamais"}</td>
                  <td className="px-3 py-2">
                    {protege ? (u.actif ? "Actif" : "Inactif") : (
                      <form action={modifierUtilisateur}>
                        <input type="hidden" name="id" value={u.id} /><input type="hidden" name="champ" value="actif" /><input type="hidden" name="valeur" value={String(!u.actif)} />
                        <button className={u.actif ? "btn-discret px-2 py-1 text-xs" : "btn-secondaire px-3 py-1 text-xs"}>{u.actif ? "Désactiver" : "Réactiver"}</button>
                      </form>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {u.actif && !u.derniereConnexion && (
                      <form action={renvoyerInvitation}><input type="hidden" name="id" value={u.id} /><button className="btn-discret px-2 py-1 text-xs">Envoyer l&apos;invitation</button></form>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
