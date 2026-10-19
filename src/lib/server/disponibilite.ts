import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { clients, clientUrls, disponibiliteMesures } from "@/db/schema";
import { recuperer } from "@/scan/fetcher";

/**
 * Monitoring de disponibilité (TECH-04) : la page d'accueil de chaque site client est testée
 * toutes les 15 minutes (statut HTTP et temps de réponse). Lancé par le worker ou par la tâche
 * planifiée /api/cron/disponibilite. Historique conservé 90 jours.
 */
export async function mesurerDisponibilite(db: DB, parallele = 8) {
  const sites = await db.select({ clientId: clientUrls.clientId, url: clientUrls.url })
    .from(clientUrls).innerJoin(clients, eq(clients.id, clientUrls.clientId))
    .where(and(eq(clientUrls.principale, true), eq(clients.actif, true)));
  const avant = new Set((await sitesEnPanne(db)).keys());
  const file = [...sites];
  const resultats: (typeof disponibiliteMesures.$inferInsert)[] = [];
  const travailleur = async () => {
    for (let s = file.shift(); s; s = file.shift()) {
      const debut = Date.now();
      try {
        const r = await recuperer(s.url);
        // Un site protégé (401/403) répond : il est disponible
        const ok = r.statut < 500 && r.statut !== 404 && r.statut !== 410;
        resultats.push({ clientId: s.clientId, url: s.url, ok, statutHttp: r.statut, dureeMs: Date.now() - debut, erreur: ok ? null : `HTTP ${r.statut}` });
      } catch (e) {
        resultats.push({ clientId: s.clientId, url: s.url, ok: false, statutHttp: null, dureeMs: Date.now() - debut, erreur: (e instanceof Error ? e.message : "erreur").slice(0, 200) });
      }
    }
  };
  await Promise.all(Array.from({ length: parallele }, travailleur));
  if (resultats.length) await db.insert(disponibiliteMesures).values(resultats);
  await db.delete(disponibiliteMesures).where(lt(disponibiliteMesures.at, new Date(Date.now() - 90 * 86400_000)));
  // Un site tombe en panne ou revient : on met à jour alertes et risques
  const apres = new Set((await sitesEnPanne(db)).keys());
  const change = [...apres].some((id) => !avant.has(id)) || [...avant].some((id) => !apres.has(id));
  if (change) { const { recomputeAll } = await import("./recompute"); await recomputeAll(db); }
  return { mesures: resultats.length, enPanne: resultats.filter((r) => !r.ok).length, alertesMisesAJour: change };
}

/** Statistiques sur 30 jours glissants pour un client. */
export async function statsDisponibilite(db: DB, clientId: string) {
  const depuis = new Date(Date.now() - 30 * 86400_000);
  const [r] = await db.select({
    mesures: sql<number>`count(*)::int`,
    ok: sql<number>`count(*) filter (where ${disponibiliteMesures.ok})::int`,
    premiere: sql<string | null>`min(${disponibiliteMesures.at})`,
  }).from(disponibiliteMesures).where(and(eq(disponibiliteMesures.clientId, clientId), gte(disponibiliteMesures.at, depuis)));
  const [premiereTout] = await db.select({ at: sql<string | null>`min(${disponibiliteMesures.at})` }).from(disponibiliteMesures).where(eq(disponibiliteMesures.clientId, clientId));
  const [erreur] = await db.select({ erreur: disponibiliteMesures.erreur, at: disponibiliteMesures.at }).from(disponibiliteMesures)
    .where(and(eq(disponibiliteMesures.clientId, clientId), eq(disponibiliteMesures.ok, false), gte(disponibiliteMesures.at, depuis)))
    .orderBy(sql`${disponibiliteMesures.at} desc`).limit(1);
  return {
    mesures: r?.mesures ?? 0,
    ok: r?.ok ?? 0,
    premiere: premiereTout?.at ? new Date(premiereTout.at) : null,
    derniereErreur: erreur ? `${erreur.erreur} le ${erreur.at.toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}` : null,
  };
}

/** Nombre de mesures en échec consécutives qui déclenchent l'alerte « site inaccessible » (1 h). */
export const ECHECS_ALERTE = 4;
const JOUR = 86_400_000;

/** Sites dont les N dernières mesures ont toutes échoué (avec la date de la première panne de la série). */
export async function sitesEnPanne(db: DB) {
  const depuis = new Date(Date.now() - 2 * JOUR);
  const rows = await db.select({ clientId: disponibiliteMesures.clientId, ok: disponibiliteMesures.ok, at: disponibiliteMesures.at, erreur: disponibiliteMesures.erreur })
    .from(disponibiliteMesures).where(gte(disponibiliteMesures.at, depuis)).orderBy(desc(disponibiliteMesures.at));
  const par = new Map<string, typeof rows>();
  for (const r of rows) { const a = par.get(r.clientId) ?? []; if (a.length < 50) a.push(r); par.set(r.clientId, a); }
  const out = new Map<string, { depuis: Date; erreur: string | null }>();
  for (const [id, a] of par) {
    const serie = [];
    for (const r of a) { if (r.ok) break; serie.push(r); }
    if (serie.length >= ECHECS_ALERTE) out.set(id, { depuis: serie[serie.length - 1].at, erreur: serie[0].erreur });
  }
  return out;
}

