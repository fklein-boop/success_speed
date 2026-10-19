import { count, eq } from "drizzle-orm";
import type { DB } from "@/db";
import { clients, clientUrls, criteres, groupes, users } from "@/db/schema";
import clientsJson from "../../data/kit/04_clients.json";
import criteresJson from "../../data/kit/03_criteres.json";

/** Comptes d'un même groupe (l'estimation de VA n'est comptée qu'une fois). */
const GROUPES: [string, RegExp][] = [
  ["APAS-BTP", /^apas-btp/i],
  ["NewTour", /^newtour/i],
  ["Quartier Libre", /^quartier libre/i],
  ["ResaReva", /^resareva/i],
  ["Visit Europe", /^visit europe/i],
  ["Univairmer", /^univairmer/i],
];

type ClientJson = (typeof clientsJson)["clients"][number];

/** Initialise critères et clients si les tables sont vides. Idempotent. */
export async function seedReferentiel(db: DB) {
  const out: Record<string, number> = {};

  const [{ n: nbCriteres }] = await db.select({ n: count() }).from(criteres);
  if (nbCriteres === 0) {
    await db.insert(criteres).values(
      criteresJson.criteres.map((c) => ({
        id: c.id,
        version: 1,
        pilier: c.pilier,
        critere: c.critere,
        commentVerifier: c.comment_verifier,
        source: c.source,
        type: c.type,
        sens: c.sens,
        seuilPlein: c.seuil_plein,
        seuilMoitie: c.seuil_moitie,
        unite: c.unite,
        points: c.points,
        obligationLegale: c.obligation_legale,
        offreSiNon: c.offre_si_non,
        questionClient: c.question_client,
        ligneGrilleV1: c.ligne_grille_v1,
        detectionAuto: c.detection_auto,
      })),
    );
    out.criteres = criteresJson.criteres.length;
  }

  const [{ n: nbClients }] = await db.select({ n: count() }).from(clients);
  if (nbClients === 0) {
    const groupeIds = new Map<string, number>();
    for (const [nom] of GROUPES) {
      const [g] = await db.insert(groupes).values({ nom }).onConflictDoNothing().returning();
      if (g) groupeIds.set(nom, g.id);
      else groupeIds.set(nom, (await db.select().from(groupes).where(eq(groupes.nom, nom)))[0].id);
    }
    const groupeDe = (nom: string) => {
      const g = GROUPES.find(([, re]) => re.test(nom));
      return g ? groupeIds.get(g[0]) ?? null : null;
    };
    const list = clientsJson.clients as ClientJson[];
    await db.insert(clients).values(
      list.map((c) => ({
        id: c.id,
        nom: c.client,
        modele: c.modele,
        groupeId: groupeDe(c.client),
        vaGlobalEstime: c.va_global_estime,
        // Les comptes secondaires d'un groupe ont va_global_estime_groupe = null
        vaCompteeDansTotaux: c.va_global_estime_groupe !== null || c.va_global_estime === null,
      })),
    );
    const urls = list.flatMap((c) => c.urls.map((url, i) => ({ clientId: c.id, url, principale: i === 0 })));
    // Comptes fournis sans dossiers dans l'export
    const hors = clientsJson.hors_referentiel_dossiers.map((h, i) => ({
      id: `HE${String(i + 1).padStart(2, "0")}`,
      nom: h.nom,
      horsExport: true,
      url: h.url,
    }));
    await db.insert(clients).values(hors.map(({ url: _u, ...c }) => c));
    urls.push(...hors.map((h) => ({ clientId: h.id, url: h.url, principale: true })));
    if (urls.length) await db.insert(clientUrls).values(urls).onConflictDoNothing();
    out.clients = list.length + hors.length;
    out.urls = urls.length;
  }

  await ensureSuperadmin(db);
  return out;
}

/** Garantit que SUPERADMIN_EMAIL existe, est actif et super admin. */
export async function ensureSuperadmin(db: DB) {
  const email = process.env.SUPERADMIN_EMAIL?.trim().toLowerCase();
  if (!email) return;
  await db
    .insert(users)
    .values({ email, role: "superadmin", actif: true, peutImporter: true })
    .onConflictDoUpdate({ target: users.email, set: { role: "superadmin", actif: true, peutImporter: true } });
}
