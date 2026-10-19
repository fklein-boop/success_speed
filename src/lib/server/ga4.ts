import { eq } from "drizzle-orm";
import type { DB } from "@/db";
import { imports, metriquesClientMensuelles } from "@/db/schema";
import { normaliser, rapprocher, type ClientRef } from "@/lib/import/trafic";
import { dimensions, emailCompteService, ga4Configure, Ga4Error, proprietes, rapport, type Dimension } from "@/lib/ga4/client";
import { AuditError } from "./audits";
import { ecrireParametre, lireParametre } from "./parametres";
import { CLE_MEMO, clientsRef } from "./trafic";
import { recomputeAll } from "./recompute";
import { logActivity } from "./activity";

/**
 * Google Analytics 4 : une seule propriété consolidée pour tous les sites clients, chaque événement porte
 * le paramètre « Nom du client » (déclaré en dimension personnalisée). Lecture mensuelle :
 * sessions, débuts de réservation, achats et CA web par client, sur les 13 derniers mois complets.
 * Les valeurs de « Nom du client » sont rattachées aux clients comme les lignes du fichier GTM
 * (mêmes correspondances mémorisées) ; une valeur incertaine attend la validation d'un administrateur.
 */
export interface ConfigGa4 {
  propertyId: string | null;
  /** apiName de la dimension client (ex. customEvent:nom_du_client) */
  dimension: string | null;
  dimensionNom: string | null;
  evenementDebut: string;
  evenementAchat: string;
}

export interface EtatGa4 {
  derniereSync: string | null;
  mois: string[];
  clients: number;
  /** Valeurs de « Nom du client » non rattachées (à valider dans l'administration) */
  enAttente: { valeur: string; sessions: number }[];
  erreur: string | null;
}

const CLE_CONFIG = "ga4_config";
const CLE_ETAT = "ga4_etat";
export const MOIS_GA4 = 13;
const NOM_DIMENSION = "nom du client";
/** Valeurs techniques de GA4 (événement sans paramètre) */
const NON_RENSEIGNE = new Set(["(not set)", "(none)", ""]);

export async function configGa4(db: DB): Promise<ConfigGa4> {
  const c = (await lireParametre<Partial<ConfigGa4>>(db, CLE_CONFIG)) ?? {};
  return {
    propertyId: c.propertyId || process.env.GA4_PROPERTY_ID?.trim() || null,
    dimension: c.dimension || null,
    dimensionNom: c.dimensionNom || null,
    evenementDebut: c.evenementDebut || "begin_checkout",
    evenementAchat: c.evenementAchat || "purchase",
  };
}

export async function etatGa4(db: DB): Promise<EtatGa4> {
  return { derniereSync: null, mois: [], clients: 0, enAttente: [], erreur: null, ...((await lireParametre<EtatGa4>(db, CLE_ETAT)) ?? {}) };
}

/** Dimension « Nom du client » parmi les dimensions personnalisées (nom affiché ou nom technique). */
export function trouverDimensionClient(dims: Dimension[]): Dimension | null {
  const perso = dims.filter((d) => d.personnalisee);
  return perso.find((d) => normaliser(d.nom) === NOM_DIMENSION)
    ?? perso.find((d) => normaliser(d.apiName.replace(/^customEvent:|^customUser:/, "").replace(/_/g, " ")) === NOM_DIMENSION)
    ?? perso.find((d) => /nom.*client|client.*nom|client_?name/i.test(`${d.nom} ${d.apiName}`))
    ?? null;
}

/** Période : les `n` derniers mois complets (AAAA-MM-JJ). */
export function periode(n = MOIS_GA4, maintenant = new Date()) {
  const debut = new Date(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth() - n, 1));
  const fin = new Date(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth(), 0));
  return { startDate: debut.toISOString().slice(0, 10), endDate: fin.toISOString().slice(0, 10) };
}

/** État de la connexion pour l'écran d'administration (aucune donnée secrète). */
export async function connexionGa4(db: DB) {
  const config = await configGa4(db);
  const base = { configure: ga4Configure(), compte: emailCompteService(), config, proprietes: [] as { id: string; nom: string; compte: string }[], dimensionsPerso: [] as Dimension[], erreur: null as string | null };
  if (!base.configure) return base;
  try {
    base.proprietes = await proprietes();
    const propertyId = config.propertyId ?? (base.proprietes.length === 1 ? base.proprietes[0].id : null);
    if (propertyId) {
      const dims = await dimensions(propertyId);
      base.dimensionsPerso = dims.filter((d) => d.personnalisee);
      const auto = config.dimension ? null : trouverDimensionClient(dims);
      base.config = { ...config, propertyId, dimension: config.dimension ?? auto?.apiName ?? null, dimensionNom: config.dimensionNom ?? auto?.nom ?? null };
    }
  } catch (e) { base.erreur = e instanceof Ga4Error ? e.message : "Connexion à Google Analytics impossible."; }
  return base;
}

export async function enregistrerConfigGa4(db: DB, userId: number, c: ConfigGa4) {
  if (c.propertyId && !/^\d{4,15}$/.test(c.propertyId)) throw new AuditError("Identifiant de propriété invalide (nombre, ex. 312345678).", 400);
  if (c.dimension && !/^custom(Event|User):[A-Za-z0-9_]{1,40}$/.test(c.dimension)) throw new AuditError("Dimension invalide.", 400);
  for (const ev of [c.evenementDebut, c.evenementAchat]) if (!/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(ev)) throw new AuditError("Nom d'événement invalide.", 400);
  await ecrireParametre(db, CLE_CONFIG, c, userId);
}

export interface MesureWeb { sessions: number; debuts: number; achats: number; ca: number }
/** valeur de « Nom du client » → mois AAAA-MM → mesures */
export type DonneesGa4 = Map<string, Map<string, MesureWeb>>;

/** Lecture GA4 : deux rapports (sessions et CA ; événements de réservation). */
export async function lireGa4(config: ConfigGa4, maintenant = new Date()): Promise<DonneesGa4> {
  if (!config.propertyId || !config.dimension) throw new AuditError("Choisissez la propriété Google Analytics et la dimension « Nom du client ».", 400);
  const dateRanges = [periode(MOIS_GA4, maintenant)];
  const [sessions, evenements] = await Promise.all([
    rapport(config.propertyId, { dateRanges, dimensions: ["yearMonth", config.dimension], metrics: ["sessions", "purchaseRevenue"] }),
    rapport(config.propertyId, {
      dateRanges, dimensions: ["yearMonth", config.dimension, "eventName"], metrics: ["eventCount"],
      dimensionFilter: { filter: { fieldName: "eventName", inListFilter: { values: [config.evenementDebut, config.evenementAchat] } } },
    }),
  ]);
  const out: DonneesGa4 = new Map();
  const cellule = (valeur: string, ym: string) => {
    const mois = `${ym.slice(0, 4)}-${ym.slice(4, 6)}`;
    const v = out.get(valeur) ?? new Map<string, MesureWeb>(); out.set(valeur, v);
    const c = v.get(mois) ?? { sessions: 0, debuts: 0, achats: 0, ca: 0 }; v.set(mois, c);
    return c;
  };
  for (const r of sessions) { const c = cellule(r.dims[1].trim(), r.dims[0]); c.sessions += r.mets[0]; c.ca += r.mets[1]; }
  for (const r of evenements) {
    const c = cellule(r.dims[1].trim(), r.dims[0]);
    if (r.dims[2] === config.evenementDebut) c.debuts += r.mets[0]; else c.achats += r.mets[0];
  }
  return out;
}

/** Rattachement d'une valeur : identifiant client exact, sinon correspondance mémorisée ou nom très proche. */
function rattacher(valeur: string, cl: ClientRef[], memo: Record<string, string>) {
  const id = cl.find((c) => c.id.toLowerCase() === valeur.toLowerCase());
  if (id && memo[normaliser(valeur)] === undefined) return { clientId: id.id, score: 1, sur: true };
  return rapprocher(valeur, cl, memo);
}

const totalSessions = (m: Map<string, MesureWeb>) => [...m.values()].reduce((s, x) => s + x.sessions, 0);

/** Aperçu pour l'administration : chaque valeur de « Nom du client » et le client proposé. */
export async function apercuGa4(db: DB) {
  const config = await configGa4(db);
  const donnees = await lireGa4(config);
  const cl = await clientsRef(db);
  const memo = (await lireParametre<Record<string, string>>(db, CLE_MEMO)) ?? {};
  const valeurs = [...donnees].filter(([v]) => !NON_RENSEIGNE.has(v)).map(([valeur, m]) => ({ valeur, sessions: totalSessions(m), ...rattacher(valeur, cl, memo) }))
    .sort((a, b) => b.sessions - a.sessions);
  const nonRenseigne = [...donnees].filter(([v]) => NON_RENSEIGNE.has(v)).reduce((s, [, m]) => s + totalSessions(m), 0);
  return { clients: cl.map((c) => ({ id: c.id, nom: c.nom })).sort((a, b) => a.nom.localeCompare(b.nom, "fr")), valeurs, nonRenseigne, periode: periode() };
}

/**
 * Synchronisation : écrit les mesures des valeurs rattachées avec certitude (ou validées par l'administrateur via
 * `correspondances`, qui sont mémorisées), recalcule conversion, abandon panier et manque à gagner.
 * Appelée par l'administration (userId) ou par le cron mensuel (userId null, sans nouvelle correspondance).
 */
export async function synchroniserGa4(db: DB, userId: number | null, correspondances?: Record<string, string | null>, maintenant = new Date()) {
  const config = await configGa4(db);
  const etatPrecedent = await etatGa4(db);
  try {
    const donnees = await lireGa4(config, maintenant);
    const cl = await clientsRef(db);
    const valides = new Set(cl.map((c) => c.id));
    const memo = (await lireParametre<Record<string, string>>(db, CLE_MEMO)) ?? {};
    if (correspondances && userId !== null) {
      for (const [valeur, cid] of Object.entries(correspondances)) {
        if (cid && !valides.has(cid)) throw new AuditError(`Client inconnu : ${cid}`, 400);
        memo[normaliser(valeur)] = cid ?? "";
      }
      await ecrireParametre(db, CLE_MEMO, memo, userId);
    }

    const parCle = new Map<string, MesureWeb & { clientId: string; mois: string }>();
    const enAttente: EtatGa4["enAttente"] = [];
    for (const [valeur, m] of donnees) {
      if (NON_RENSEIGNE.has(valeur)) continue;
      const r = rattacher(valeur, cl, memo);
      if (!r.sur || !r.clientId) {
        if (memo[normaliser(valeur)] === undefined) enAttente.push({ valeur, sessions: totalSessions(m) });
        continue;
      }
      // Plusieurs valeurs pour un même client (variantes d'écriture) : on additionne
      for (const [mois, x] of m) {
        const k = `${r.clientId}|${mois}`;
        const c = parCle.get(k) ?? { clientId: r.clientId, mois, sessions: 0, debuts: 0, achats: 0, ca: 0 };
        c.sessions += x.sessions; c.debuts += x.debuts; c.achats += x.achats; c.ca += x.ca;
        parCle.set(k, c);
      }
    }

    const t = metriquesClientMensuelles;
    for (const c of parCle.values()) {
      if (c.sessions <= 0) continue;
      const v = { visites: Math.round(c.sessions), debutsReservation: Math.round(c.debuts), achatsWeb: Math.round(c.achats), caWeb: Math.round(c.ca * 100) / 100, sourceTrafic: "ga4" };
      await db.insert(t).values({ clientId: c.clientId, mois: c.mois, ...v }).onConflictDoUpdate({ target: [t.clientId, t.mois], set: v });
    }
    const mois = [...new Set([...parCle.values()].map((c) => c.mois))].sort();
    const clientsTouches = new Set([...parCle.values()].map((c) => c.clientId));
    enAttente.sort((a, b) => b.sessions - a.sessions);
    const etat: EtatGa4 = { derniereSync: new Date().toISOString(), mois, clients: clientsTouches.size, enAttente, erreur: null };
    await ecrireParametre(db, CLE_ETAT, etat, userId);
    if (parCle.size) {
      await db.insert(imports).values({
        type: "ga4", fichier: `Google Analytics 4 · propriété ${config.propertyId}`, userId, statut: "applique",
        periodeDebut: `${mois[0]}-01`, periodeFin: `${mois[mois.length - 1]}-01`,
        stats: { clients: clientsTouches.size, mois: mois.length, valeurs: parCle.size, enAttente: enAttente.map((e) => e.valeur) }, appliqueLe: new Date(),
      });
      await recomputeAll(db);
    }
    await logActivity(userId, "synchro_ga4", "import", config.propertyId ?? "", { clients: clientsTouches.size, mois: mois.length, enAttente: enAttente.length });
    return etat;
  } catch (e) {
    const message = e instanceof Ga4Error || e instanceof AuditError ? e.message : "Erreur inattendue pendant la synchronisation Google Analytics.";
    await ecrireParametre(db, CLE_ETAT, { ...etatPrecedent, erreur: message }, userId);
    throw e;
  }
}

/** Revenir au fichier GTM : supprime les mesures GA4 (les visites du fichier devront être réimportées). */
export async function effacerGa4(db: DB, userId: number) {
  const t = metriquesClientMensuelles;
  await db.update(t).set({ visites: null, debutsReservation: null, achatsWeb: null, caWeb: null, sourceTrafic: null }).where(eq(t.sourceTrafic, "ga4"));
  await ecrireParametre(db, CLE_ETAT, { derniereSync: null, mois: [], clients: 0, enAttente: [], erreur: null } satisfies EtatGa4, userId);
  await recomputeAll(db);
  await logActivity(userId, "ga4_efface", "import", "", {});
}
