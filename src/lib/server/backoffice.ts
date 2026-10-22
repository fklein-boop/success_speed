import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { agenceAliases, catalogueProduits, clients, configComptes, connexionsBo, imports, transactionsPaybox } from "@/db/schema";
import type { LigneBackoffice, TypeBackoffice } from "@/lib/import/backoffice";
import { LIBELLES_TYPE } from "@/lib/import/backoffice";
import type { ConfigCompte, EntreeBackoffice, ProduitCatalogue } from "@/lib/audit/backoffice";
import type { ClientMetrics, Dossier } from "@/lib/metrics/compute";
import { AuditError } from "./audits";
import { lireParametre } from "./parametres";
import { logActivity } from "./activity";

/**
 * Exports back-office (lot A3) : enregistrement et lecture.
 * Catalogue et configuration sont des photos complètes (remplacées à chaque import) ;
 * connexions et PayBox s'ajoutent (clé : client + jour, référence de transaction).
 */
const chunk = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

/** Identifiant d'agence de l'export → client (alias d'agences de la mise à jour du lundi) */
async function versClient(db: DB): Promise<(id: string) => string> {
  const al = new Map((await db.select().from(agenceAliases)).map((a) => [a.idAgence, a.clientId]));
  return (id) => al.get(id) ?? id;
}

export async function apercuExport(db: DB, type: TypeBackoffice, lignes: LigneBackoffice[]) {
  const map = await versClient(db);
  const connus = new Set((await db.select({ id: clients.id }).from(clients)).map((c) => c.id));
  const agences = [...new Set(lignes.map((l) => l.idAgence))];
  const inconnues = agences.filter((a) => !connus.has(map(a)));
  const dates = lignes.map((l) => l.date as string | null).filter((d): d is string => !!d).sort();
  return {
    type, libelle: LIBELLES_TYPE[type], lignes: lignes.length,
    clients: agences.length - inconnues.length, agencesInconnues: inconnues.slice(0, 30), nbInconnues: inconnues.length,
    periode: dates.length ? { debut: dates[0], fin: dates[dates.length - 1] } : null,
  };
}

/**
 * Enregistre un export par morceaux (limite de taille des requêtes) : le premier morceau crée l'entrée d'historique
 * et, pour les photos complètes (catalogue, configuration), vide l'état précédent ; les suivants passent `importId`.
 */
export async function appliquerExport(db: DB, userId: number | null, type: TypeBackoffice, fichier: string, lignes: LigneBackoffice[], suite?: { importId: number }) {
  if (!lignes.length) throw new AuditError(`${LIBELLES_TYPE[type]} : aucune ligne lisible.`, 400);
  const resume = await apercuExport(db, type, lignes);
  let imp: { id: number };
  if (suite) {
    const [x] = await db.select().from(imports).where(and(eq(imports.id, suite.importId), eq(imports.type, type)));
    if (!x) throw new AuditError("Import introuvable.", 404);
    const st = (x.stats ?? {}) as { lignes?: number };
    await db.update(imports).set({ stats: { ...st, lignes: (st.lignes ?? 0) + lignes.length } }).where(eq(imports.id, x.id));
    imp = x;
  } else {
    [imp] = await db.insert(imports).values({
      type, fichier: fichier.slice(0, 300), userId, statut: "applique", appliqueLe: new Date(),
      periodeDebut: resume.periode?.debut ?? null, periodeFin: resume.periode?.fin ?? null,
      stats: { lignes: lignes.length, clients: resume.clients, agencesInconnues: resume.agencesInconnues },
    }).returning();
    if (type === "catalogue") await db.delete(catalogueProduits);
    if (type === "configuration") await db.delete(configComptes);
  }
  const s = (v: unknown) => (typeof v === "string" ? v : null);
  const b = (v: unknown) => (typeof v === "boolean" ? v : null);
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  if (type === "catalogue") {
    const vals = new Map(lignes.map((l) => [`${l.idAgence}|${s(l.idProduit)}`, {
      idAgence: l.idAgence, idProduit: String(l.idProduit), titre: s(l.titre), type: s(l.type), source: s(l.source),
      enLigne: b(l.enLigne), partageS01: b(l.partageS01), dateMaj: s(l.dateMaj), departsFuturs: n(l.departsFuturs),
      stockGere: b(l.stockGere), prixAdulte: b(l.prixAdulte), prixEnfant: b(l.prixEnfant), nbSupplements: n(l.nbSupplements),
      nbOptions: n(l.nbOptions), assurance: b(l.assurance), nbPhotos: n(l.nbPhotos), veepee: b(l.veepee), importId: imp.id,
    }]));
    for (const part of chunk([...vals.values()], 1000)) await db.insert(catalogueProduits).values(part).onConflictDoNothing();
  } else if (type === "configuration") {
    const vals = new Map(lignes.map((l) => { const { idAgence, ...data } = l; return [idAgence, { idAgence, data, importId: imp.id }]; }));
    for (const part of chunk([...vals.values()], 500)) await db.insert(configComptes).values(part).onConflictDoUpdate({ target: configComptes.idAgence, set: { data: sql`excluded.data`, importId: sql`excluded.import_id` } });
  } else if (type === "connexions") {
    const vals = new Map(lignes.map((l) => [`${l.idAgence}|${s(l.date)}`, { idAgence: l.idAgence, date: String(l.date), nbConnexions: n(l.nbConnexions) ?? 0, nbUtilisateurs: n(l.nbUtilisateurs) }]));
    for (const part of chunk([...vals.values()], 1000)) {
      await db.insert(connexionsBo).values(part).onConflictDoUpdate({ target: [connexionsBo.idAgence, connexionsBo.date], set: { nbConnexions: sql`excluded.nb_connexions`, nbUtilisateurs: sql`excluded.nb_utilisateurs` } });
    }
  } else {
    const vals = new Map(lignes.map((l) => [String(l.reference), {
      reference: String(l.reference), idAgence: l.idAgence, date: String(l.date), idResa: s(l.idResa)?.replace(/\.0$/, "") ?? null,
      montant: n(l.montant), statut: s(l.statut), troisDs: b(l.troisDs), importId: imp.id,
    }]));
    for (const part of chunk([...vals.values()], 1000)) {
      await db.insert(transactionsPaybox).values(part).onConflictDoUpdate({
        target: transactionsPaybox.reference,
        set: { idAgence: sql`excluded.id_agence`, date: sql`excluded.date`, idResa: sql`excluded.id_resa`, montant: sql`excluded.montant`, statut: sql`excluded.statut`, troisDs: sql`excluded.trois_ds`, importId: sql`excluded.import_id` },
      });
    }
  }
  if (!suite) await logActivity(userId, "import_backoffice", "import", String(imp.id), { type });
  return { ...resume, importId: imp.id };
}

/** Types d'exports déjà importés au moins une fois, avec la date du dernier. */
export async function exportsDisponibles(db: DB): Promise<Map<TypeBackoffice, Date>> {
  const rows = await db.select({ type: imports.type, le: imports.appliqueLe }).from(imports)
    .where(and(inArray(imports.type, ["catalogue", "configuration", "connexions", "paybox"]), eq(imports.statut, "applique"))).orderBy(desc(imports.appliqueLe));
  const out = new Map<TypeBackoffice, Date>();
  for (const r of rows) if (!out.has(r.type as TypeBackoffice) && r.le) out.set(r.type as TypeBackoffice, r.le);
  return out;
}

export type SourceAbandon = "dossiers" | "ga4";
export const CLE_SOURCE_ABANDON = "perf07_source";
export async function sourceAbandon(db: DB): Promise<SourceAbandon> {
  return (await lireParametre<SourceAbandon>(db, CLE_SOURCE_ABANDON)) === "dossiers" ? "dossiers" : "ga4";
}

/** Données back-office d'un client, prêtes pour le calcul des critères. */
export async function entreeBackoffice(db: DB, clientId: string, m: ClientMetrics | null, dossiers: Dossier[]): Promise<EntreeBackoffice> {
  const [[c], al, dispo, src] = await Promise.all([
    db.select({ modele: clients.modele }).from(clients).where(eq(clients.id, clientId)),
    db.select().from(agenceAliases).where(eq(agenceAliases.clientId, clientId)),
    exportsDisponibles(db),
    sourceAbandon(db),
  ]);
  const ids = [clientId, ...al.map((a) => a.idAgence)];
  const [cat, conf, cnx, pb] = await Promise.all([
    dispo.has("catalogue") ? db.select().from(catalogueProduits).where(inArray(catalogueProduits.idAgence, ids)) : null,
    dispo.has("configuration") ? db.select().from(configComptes).where(inArray(configComptes.idAgence, ids)) : null,
    dispo.has("connexions") ? db.select().from(connexionsBo).where(inArray(connexionsBo.idAgence, ids)) : null,
    dispo.has("paybox") ? db.select().from(transactionsPaybox).where(inArray(transactionsPaybox.idAgence, ids)) : null,
  ]);
  return {
    aujourdhui: new Date().toISOString().slice(0, 10),
    modele: c?.modele ?? null,
    catalogue: cat ? cat.map((p): ProduitCatalogue => ({ ...p })) : null,
    config: conf === null ? undefined : conf.length ? (conf[0].data as ConfigCompte) : null,
    connexions: cnx ? cnx.map((x) => ({ date: x.date, nb: x.nbConnexions })) : null,
    paybox: pb ? pb.map((t) => ({ idResa: t.idResa, statut: t.statut, date: t.date })) : null,
    dossiers, m, sourceAbandon: src,
  };
}

/** Configuration de chaque client (alertes : fin de contrat, connexions au back-office). */
export async function configsParClient(db: DB): Promise<Map<string, ConfigCompte>> {
  const map = await versClient(db);
  return new Map((await db.select().from(configComptes)).map((r) => [map(r.idAgence), r.data as ConfigCompte]));
}

/** Dernière connexion connue de chaque client dans l'export connexions. */
export async function derniereConnexionParClient(db: DB): Promise<Map<string, string>> {
  const map = await versClient(db);
  const rows = await db.select({ id: connexionsBo.idAgence, d: sql<string>`max(${connexionsBo.date})` }).from(connexionsBo).where(sql`${connexionsBo.nbConnexions} > 0`).groupBy(connexionsBo.idAgence);
  const out = new Map<string, string>();
  for (const r of rows) { const k = map(r.id); if (!out.has(k) || out.get(k)! < r.d) out.set(k, String(r.d).slice(0, 10)); }
  return out;
}
