import { asc, desc, eq } from "drizzle-orm";
import type { DB } from "@/db";
import { criteres, parametres } from "@/db/schema";
import empreintesConfig from "../../../config/empreintes.json";
import { REFERENCES_LEGALES } from "@/lib/restitution/textes";
import { compareCriteres } from "@/lib/audit/score";
import { AuditError } from "./audits";
import { logActivity } from "./activity";

/**
 * Paramètres modifiables dans l'administration. Valeurs par défaut dans le code ou config/,
 * surchargées par la table `parametres` : on peut toujours revenir aux valeurs d'origine.
 */
export async function lireParametre<T>(db: DB, cle: string): Promise<T | null> {
  const [p] = await db.select().from(parametres).where(eq(parametres.cle, cle));
  return (p?.valeur as T | undefined) ?? null;
}

export async function ecrireParametre(db: DB, cle: string, valeur: unknown, userId: number | null) {
  await db.insert(parametres).values({ cle, valeur: valeur as object, modifiePar: userId })
    .onConflictDoUpdate({ target: parametres.cle, set: { valeur: valeur as object, modifiePar: userId, modifieLe: new Date() } });
  await logActivity(userId, "parametre_modifie", "parametre", cle, {});
}

export async function supprimerParametre(db: DB, cle: string, userId: number) {
  await db.delete(parametres).where(eq(parametres.cle, cle));
  await logActivity(userId, "parametre_reinitialise", "parametre", cle, {});
}

// ───────────────────────── Empreintes TECH-06 ─────────────────────────

export interface Empreinte { nom: string; motif: string; force?: string }
export interface Empreintes { a_valider: boolean; speedresa: Empreinte[]; concurrents: Empreinte[] }

export async function empreintes(db: DB): Promise<Empreintes> {
  return (await lireParametre<Empreintes>(db, "empreintes")) ?? { a_valider: empreintesConfig.a_valider, speedresa: empreintesConfig.speedresa, concurrents: empreintesConfig.concurrents };
}

// ───────────────────────── Références légales ─────────────────────────

export async function referencesLegales(db: DB): Promise<Record<string, string>> {
  return { ...REFERENCES_LEGALES, ...((await lireParametre<Record<string, string>>(db, "references_legales")) ?? {}) };
}

// ───────────────────────── Critères (versionnés) ─────────────────────────

export type Critere = typeof criteres.$inferSelect;

/** Dernière version de chaque critère, actifs et désactivés. */
export async function tousCriteres(db: DB): Promise<Critere[]> {
  const all = await db.select().from(criteres).orderBy(asc(criteres.id), desc(criteres.version));
  const vus = new Set<string>();
  return all.filter((c) => (vus.has(c.id) ? false : (vus.add(c.id), true))).sort(compareCriteres);
}

export type PatchCritere = Partial<Pick<Critere, "pilier" | "critere" | "commentVerifier" | "source" | "type" | "sens" | "seuilPlein" | "seuilMoitie" | "unite" | "points" | "obligationLegale" | "offreSiNon" | "questionClient" | "actif">>;

/**
 * Modifie un critère en créant une nouvelle version : les audits passés gardent la version
 * avec laquelle ils ont été évalués, les nouveaux audits utilisent la dernière.
 */
export async function versionnerCritere(db: DB, id: string, patch: PatchCritere, userId: number) {
  const [dernier] = await db.select().from(criteres).where(eq(criteres.id, id)).orderBy(desc(criteres.version)).limit(1);
  if (!dernier) throw new AuditError("Critère introuvable", 404);
  const { createdAt: _c, ...base } = dernier;
  const nouveau = { ...base, ...patch, version: dernier.version + 1 };
  if (nouveau.type === "Seuil" && (nouveau.seuilPlein === null || nouveau.seuilMoitie === null || !nouveau.sens)) throw new AuditError("Un critère à seuil doit avoir un sens et deux seuils.", 400);
  if (!Number.isInteger(nouveau.points) || nouveau.points < 0 || nouveau.points > 50) throw new AuditError("Points : entier entre 0 et 50.", 400);
  const modifs = Object.keys(patch).filter((k) => JSON.stringify((dernier as Record<string, unknown>)[k]) !== JSON.stringify((patch as Record<string, unknown>)[k]));
  if (!modifs.length) return { version: dernier.version, inchange: true };
  await db.insert(criteres).values(nouveau);
  await logActivity(userId, "critere_modifie", "critere", id, { version: nouveau.version, champs: modifs });
  return { version: nouveau.version, inchange: false };
}

export async function creerCritere(db: DB, c: Omit<Critere, "version" | "createdAt" | "ligneGrilleV1" | "detectionAuto" | "actif"> & { detectionAuto?: string | null }, userId: number) {
  if (!/^[A-Z]{2,5}-\d{2}$/.test(c.id)) throw new AuditError("Identifiant au format PILIER-NN (ex. VIS-09).", 400);
  const [existe] = await db.select({ id: criteres.id }).from(criteres).where(eq(criteres.id, c.id)).limit(1);
  if (existe) throw new AuditError("Cet identifiant existe déjà.", 409);
  await db.insert(criteres).values({ ...c, version: 1, actif: true, ligneGrilleV1: null, detectionAuto: c.detectionAuto ?? null });
  await logActivity(userId, "critere_cree", "critere", c.id, {});
}
