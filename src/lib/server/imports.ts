import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { agenceAliases, clients, dossierChanges, dossiers, importRows, imports } from "@/db/schema";
import { dossierChanged, type Anomalies, type DossierImport } from "@/lib/import/dossiers";
import { getMetricsParams, recomputeAll, type RecomputeDiff } from "./recompute";

/**
 * Import de l'export dossiers, en trois temps :
 *  1. createImport + addRows : les lignes lues dans le navigateur sont déposées en zone d'attente ;
 *  2. previewImport : comparaison avec la base (nouveaux, mis à jour, agences inconnues, anomalies) ;
 *  3. applyImport : fusion par IDresa (jamais de suppression : un extract partiel ou cumulatif
 *     donne le même résultat), recalcul de tout le portefeuille.
 * Chaque dossier modifié garde son état antérieur (dossier_changes) pour annuler le dernier import.
 *
 * L'interface DossierSource permettra plus tard de remplacer le dépôt manuel par un dossier
 * partagé surveillé ou une API SpeedResa : il suffira d'appeler createImport/addRows/applyImport.
 */
export interface DossierSource {
  nom: string;
  lire(): Promise<{ fichier: string; dossiers: DossierImport[]; anomalies: Anomalies }>;
}

export interface ImportMeta {
  fichier: string;
  feuille?: string | null;
  periode: { debut: string | null; fin: string | null };
  anomalies: Anomalies;
  lignesLues: number;
}

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

export async function createImport(db: DB, userId: number | null, meta: ImportMeta) {
  const [imp] = await db.insert(imports).values({
    type: "dossiers",
    fichier: meta.fichier,
    userId,
    statut: "brouillon",
    periodeDebut: meta.periode.debut,
    periodeFin: meta.periode.fin,
    stats: {
      feuille: meta.feuille ?? null,
      lignesLues: meta.lignesLues,
      anomalies: {
        lignesIgnorees: meta.anomalies.lignesIgnorees.slice(0, 50),
        nbLignesIgnorees: meta.anomalies.lignesIgnorees.length,
        datesFutures: meta.anomalies.datesFutures.slice(0, 50),
        nbDatesFutures: meta.anomalies.datesFutures.length,
        montantsNegatifs: meta.anomalies.montantsNegatifs.slice(0, 50),
        nbMontantsNegatifs: meta.anomalies.montantsNegatifs.length,
        doublons: meta.anomalies.doublons.slice(0, 50),
        nbDoublons: meta.anomalies.doublons.length,
      },
    },
  }).returning();
  return imp;
}

export async function addRows(db: DB, importId: number, rows: DossierImport[]) {
  const [imp] = await db.select().from(imports).where(eq(imports.id, importId));
  if (!imp || imp.statut !== "brouillon") throw new Error("Import introuvable ou déjà traité");
  for (const part of chunk(rows, 1000)) {
    await db.insert(importRows).values(part.map((d) => ({ importId, idResa: d.idResa, data: d })))
      .onConflictDoUpdate({ target: [importRows.importId, importRows.idResa], set: { data: sql`excluded.data` } });
  }
}

const toImport = (r: typeof dossiers.$inferSelect): DossierImport => ({
  idResa: r.idResa, idAgence: r.idAgence, producteur: r.producteur, voyage: r.voyage, nomAgence: r.nomAgence,
  fournisseur: r.fournisseur, date: r.date, heure: r.heure, pax: r.pax, statut: r.statut, origine: r.origine ?? "",
  total: r.total, encaisse: r.encaisse, erreurResalive: r.erreurResalive,
});

async function diffImport(db: DB, importId: number) {
  const staged = (await db.select({ data: importRows.data }).from(importRows).where(eq(importRows.importId, importId)))
    .map((r) => r.data as DossierImport);
  const existing = new Map((await db.select().from(dossiers)).map((r) => [r.idResa, r]));
  const nouveaux: DossierImport[] = [];
  const modifies: { avant: typeof dossiers.$inferSelect; apres: DossierImport }[] = [];
  const changementsStatut: Record<string, number> = {};
  for (const d of staged) {
    const e = existing.get(d.idResa);
    if (!e) nouveaux.push(d);
    else if (dossierChanged(toImport(e), d)) {
      modifies.push({ avant: e, apres: d });
      if (e.statut !== d.statut) {
        const k = `${e.statut} → ${d.statut}`;
        changementsStatut[k] = (changementsStatut[k] ?? 0) + 1;
      }
    }
  }
  return { staged, nouveaux, modifies, changementsStatut };
}

export interface ImportPreview {
  id: number;
  fichier: string;
  periode: { debut: string | null; fin: string | null };
  lignesLues: number;
  dossiersLus: number;
  nouveaux: number;
  modifies: number;
  inchanges: number;
  changementsStatut: { transition: string; nombre: number }[];
  agencesInconnues: { idAgence: string; nomAgence: string | null; dossiers: number }[];
  anomalies: Record<string, unknown>;
  type: "cumulatif" | "partiel" | "premier";
  phrase: string;
}

export async function previewImport(db: DB, importId: number): Promise<ImportPreview> {
  const [imp] = await db.select().from(imports).where(eq(imports.id, importId));
  if (!imp) throw new Error("Import introuvable");
  const { staged, nouveaux, modifies, changementsStatut } = await diffImport(db, importId);

  const known = new Set((await db.select({ id: clients.id }).from(clients)).map((c) => c.id));
  // Les agences de démo sont exclues des calculs : on ne les signale pas comme inconnues
  for (const id of (await getMetricsParams(db)).agencesDemo) known.add(id);
  for (const a of await db.select().from(agenceAliases)) known.add(a.idAgence);
  const inconnues = new Map<string, { idAgence: string; nomAgence: string | null; dossiers: number }>();
  for (const d of staged) {
    if (known.has(d.idAgence)) continue;
    const e = inconnues.get(d.idAgence) ?? { idAgence: d.idAgence, nomAgence: d.nomAgence, dossiers: 0 };
    e.dossiers++;
    inconnues.set(d.idAgence, e);
  }

  // Cumulatif si l'extract couvre la période déjà en base, partiel sinon
  const [{ min }] = await db.select({ min: sql<string | null>`min(${dossiers.date})` }).from(dossiers);
  const type = !min ? "premier" : imp.periodeDebut && imp.periodeDebut <= min ? "cumulatif" : "partiel";
  const stats = imp.stats as { lignesLues: number; anomalies: Record<string, unknown> };
  const fr = (d: string | null) => (d ? d.split("-").reverse().join("/") : "?");
  const n = (x: number) => x.toLocaleString("fr-FR");
  const phrase =
    `Extract ${type === "cumulatif" ? "cumulatif" : type === "partiel" ? "partiel" : "initial"} du ${fr(imp.periodeDebut)} au ${fr(imp.periodeFin)} : ` +
    `${n(staged.length)} dossiers lus, ${n(nouveaux.length)} nouveaux, ${n(modifies.length)} mis à jour` +
    (inconnues.size ? `, ${inconnues.size} agence${inconnues.size > 1 ? "s" : ""} inconnue${inconnues.size > 1 ? "s" : ""}.` : ".");

  return {
    id: imp.id,
    fichier: imp.fichier,
    periode: { debut: imp.periodeDebut, fin: imp.periodeFin },
    lignesLues: stats.lignesLues,
    dossiersLus: staged.length,
    nouveaux: nouveaux.length,
    modifies: modifies.length,
    inchanges: staged.length - nouveaux.length - modifies.length,
    changementsStatut: Object.entries(changementsStatut).map(([transition, nombre]) => ({ transition, nombre })).sort((a, b) => b.nombre - a.nombre),
    agencesInconnues: [...inconnues.values()].sort((a, b) => b.dossiers - a.dossiers),
    anomalies: stats.anomalies,
    type,
    phrase,
  };
}

export interface ApplyDecisions {
  /** Agences inconnues à créer comme nouveaux clients */
  creer?: string[];
  /** Agences inconnues à rattacher à un client existant : idAgence → clientId */
  rattacher?: Record<string, string>;
}

export async function applyImport(db: DB, importId: number, userId: number | null, decisions: ApplyDecisions = {}) {
  const [imp] = await db.select().from(imports).where(eq(imports.id, importId));
  if (!imp || imp.statut !== "brouillon") throw new Error("Import introuvable ou déjà traité");
  const { staged, nouveaux, modifies } = await diffImport(db, importId);

  await db.transaction(async (t) => {
  const tx = t as unknown as DB;
  // Agences inconnues
  const names = new Map(staged.map((d) => [d.idAgence, d.nomAgence]));
  for (const id of decisions.creer ?? []) {
    await tx.insert(clients).values({ id, nom: names.get(id) ?? id }).onConflictDoNothing();
  }
  for (const [idAgence, clientId] of Object.entries(decisions.rattacher ?? {})) {
    if (idAgence === clientId) continue;
    await tx.insert(agenceAliases).values({ idAgence, clientId })
      .onConflictDoUpdate({ target: agenceAliases.idAgence, set: { clientId } });
    await tx.update(clients).set({ horsExport: false }).where(eq(clients.id, clientId));
  }

  // Sauvegarde de l'état antérieur puis fusion par IDresa
  const changes = [
    ...nouveaux.map((d) => ({ importId, idResa: d.idResa, avant: null })),
    ...modifies.map((m) => ({ importId, idResa: m.avant.idResa, avant: m.avant as unknown as Record<string, unknown> })),
  ];
  for (const part of chunk(changes, 1000)) await tx.insert(dossierChanges).values(part);
  const upserts = [...nouveaux, ...modifies.map((m) => m.apres)].map((d) => ({ ...d, importId, updatedAt: new Date() }));
  for (const part of chunk(upserts, 1000)) {
    await tx.insert(dossiers).values(part).onConflictDoUpdate({
      target: dossiers.idResa,
      set: {
        idAgence: sql`excluded.id_agence`, producteur: sql`excluded.producteur`, voyage: sql`excluded.voyage`,
        nomAgence: sql`excluded.nom_agence`, fournisseur: sql`excluded.fournisseur`, date: sql`excluded.date`,
        heure: sql`excluded.heure`, pax: sql`excluded.pax`, statut: sql`excluded.statut`, origine: sql`excluded.origine`,
        total: sql`excluded.total`, encaisse: sql`excluded.encaisse`, erreurResalive: sql`excluded.erreur_resalive`,
        importId: sql`excluded.import_id`, updatedAt: sql`excluded.updated_at`,
      },
    });
  }
  await tx.delete(importRows).where(eq(importRows.importId, importId));
  await tx.update(imports).set({ statut: "applique", appliqueLe: new Date() }).where(eq(imports.id, importId));
  });

  const diff = await recomputeAll(db, importId);
  const stats = {
    ...(imp.stats as object),
    dossiersLus: staged.length,
    nouveaux: nouveaux.length,
    modifies: modifies.length,
    reference: diff.reference,
    clientsCrees: decisions.creer ?? [],
    agencesRattachees: decisions.rattacher ?? {},
    diff,
  };
  await db.update(imports).set({ stats }).where(eq(imports.id, importId));
  return { nouveaux: nouveaux.length, modifies: modifies.length, diff };
}

/** Annule le dernier import appliqué (restaure les dossiers dans leur état antérieur). */
export async function undoLastImport(db: DB): Promise<{ importId: number; diff: RecomputeDiff }> {
  const [last] = await db.select().from(imports)
    .where(and(eq(imports.type, "dossiers"), eq(imports.statut, "applique")))
    .orderBy(desc(imports.appliqueLe)).limit(1);
  if (!last) throw new Error("Aucun import à annuler");
  const changes = await db.select().from(dossierChanges).where(eq(dossierChanges.importId, last.id));
  const created = changes.filter((c) => c.avant === null).map((c) => c.idResa);
  for (const part of chunk(created, 1000)) await db.delete(dossiers).where(inArray(dossiers.idResa, part));
  const restored = changes.filter((c) => c.avant !== null).map((c) => {
    const a = c.avant as Record<string, unknown>;
    return { ...(a as typeof dossiers.$inferInsert), updatedAt: new Date(String(a.updatedAt)) };
  });
  for (const part of chunk(restored, 1000)) {
    await db.insert(dossiers).values(part).onConflictDoUpdate({
      target: dossiers.idResa,
      set: {
        idAgence: sql`excluded.id_agence`, date: sql`excluded.date`, statut: sql`excluded.statut`, total: sql`excluded.total`,
        encaisse: sql`excluded.encaisse`, erreurResalive: sql`excluded.erreur_resalive`, origine: sql`excluded.origine`,
        pax: sql`excluded.pax`, importId: sql`excluded.import_id`, updatedAt: sql`excluded.updated_at`,
      },
    });
  }
  await db.update(imports).set({ statut: "annule", annuleLe: new Date() }).where(eq(imports.id, last.id));
  const diff = await recomputeAll(db, null);
  return { importId: last.id, diff };
}

export async function abandonImport(db: DB, importId: number) {
  await db.delete(importRows).where(eq(importRows.importId, importId));
  await db.update(imports).set({ statut: "abandonne" }).where(and(eq(imports.id, importId), eq(imports.statut, "brouillon")));
}
