import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { clients, clientUrls, scanResults, scanRuns } from "@/db/schema";
import { DETECTEURS } from "@/scan/registry";
import { creerScan } from "./scans";
import { ecrireParametre, lireParametre } from "./parametres";
import { loadCriteres } from "./audits";
import { logActivity } from "./activity";

/**
 * Lot E : fiabilité des contrôles automatiques sur tout le portefeuille. Une campagne lance un pré-audit
 * (type « fiabilite », sans audit enregistré) sur le site principal de chaque client ; le rapport donne, par critère,
 * la répartition des résultats, la confiance moyenne, la cause principale des « non vérifiable », et repère
 * les critères « plateforme » (même résultat sur presque tous les sites : produit par les gabarits SpeedResa).
 */
export const CLE_PLATEFORME = "criteres_plateforme";
const CLE_CAMPAGNE = "campagne_fiabilite";
/** Part minimale de sites avec le même résultat, et nombre minimal de sites vérifiés, pour proposer « plateforme » */
export const SEUIL_PLATEFORME = 0.9, MIN_SITES_PLATEFORME = 10;

export async function criteresPlateforme(db: DB): Promise<string[]> {
  return (await lireParametre<string[]>(db, CLE_PLATEFORME)) ?? [];
}
export async function marquerPlateforme(db: DB, userId: number, critereId: string, plateforme: boolean) {
  const l = new Set(await criteresPlateforme(db));
  if (plateforme) l.add(critereId); else l.delete(critereId);
  await ecrireParametre(db, CLE_PLATEFORME, [...l].sort(), userId);
}

/** Met en file un pré-audit « fiabilité » pour chaque client actif ayant un site. */
export async function lancerCampagneFiabilite(db: DB, userId: number | null) {
  const sites = await db.select({ clientId: clientUrls.clientId, url: clientUrls.url }).from(clientUrls)
    .innerJoin(clients, eq(clients.id, clientUrls.clientId)).where(and(eq(clientUrls.principale, true), eq(clients.actif, true)));
  let crees = 0;
  const refus: { clientId: string; raison: string }[] = [];
  for (const s of sites) {
    try { const r = await creerScan(db, s.clientId, s.url, userId, "fiabilite"); if (!r.existant) crees++; }
    catch (e) { refus.push({ clientId: s.clientId, raison: e instanceof Error ? e.message : "refusé" }); }
  }
  await ecrireParametre(db, CLE_CAMPAGNE, { lanceeLe: new Date().toISOString(), sites: sites.length, crees, refus }, userId);
  await logActivity(userId, "campagne_fiabilite", "scan", "", { sites: sites.length, crees, refus: refus.length });
  return { sites: sites.length, crees, refus };
}

export type Cause = "clé d'API manquante" | "site sans navigateur" | "tunnel désactivé" | "page ou fiche introuvable" | "erreur d'un service externe" | "donnée interne manquante" | "monitoring non démarré" | "autre";
/** Cause principale d'un « non vérifiable », d'après le texte du contrôle */
export function causeNonVerifiable(texte: string | null, mode: string | null): Cause {
  const t = (texte ?? "").toLowerCase();
  if (/cl[ée] .*(manquante|non configur|absente)|sans cl[ée]|api_key/.test(t)) return "clé d'API manquante";
  if (/tunnel/.test(t) && /(désactiv|scan_tunnel)/.test(t)) return "tunnel désactivé";
  if (/sans navigateur|navigateur indisponible/.test(t) || (mode === "http" && /tunnel|rendu|javascript/.test(t))) return "site sans navigateur";
  if (/monitoring/.test(t)) return "monitoring non démarré";
  if (/top ventes|dossiers import|ville et destination/.test(t)) return "donnée interne manquante";
  if (/introuvable|aucune fiche|non trouv|aucun des|inaccessible|pdf/.test(t)) return "page ou fiche introuvable";
  if (/erreur|quota|indisponible|injoignable|refus|délai|timeout/.test(t)) return "erreur d'un service externe";
  return "autre";
}

const CONF: Record<string, number> = { haute: 1, moyenne: 0.5, basse: 0 };

export interface LigneFiabilite {
  critereId: string; critere: string; pilier: string;
  sites: number; oui: number; partiel: number; non: number; nonVerifiable: number; na: number;
  /** Part des sites où le contrôle a donné un résultat (hors non vérifiable) */
  verifiable: number;
  confianceMoyenne: number | null;
  causePrincipale: Cause | null; causes: Partial<Record<Cause, number>>;
  /** Résultat dominant et sa part parmi les sites vérifiés */
  dominant: string | null; partDominant: number;
  plateformeProposee: boolean; plateforme: boolean;
}

/** Rapport sur le dernier scan « fiabilité » terminé de chaque client. */
export async function rapportFiabilite(db: DB) {
  const runs = await db.select({ id: scanRuns.id, clientId: scanRuns.clientId, mode: scanRuns.mode, statut: scanRuns.statut, fin: scanRuns.fin, createdAt: scanRuns.createdAt })
    .from(scanRuns).where(eq(scanRuns.type, "fiabilite")).orderBy(desc(scanRuns.id));
  const dernier = new Map<string, (typeof runs)[number]>();
  for (const r of runs) if (r.statut === "termine" && !dernier.has(r.clientId)) dernier.set(r.clientId, r);
  const enCours = new Set(runs.filter((r) => r.statut === "en_attente" || r.statut === "en_cours").map((r) => r.clientId)).size;
  const erreurs = runs.filter((r) => (r.statut === "erreur" || r.statut === "auth") && !dernier.has(r.clientId)).length;
  const ids = [...dernier.values()].map((r) => r.id);
  const res = ids.length ? await db.select().from(scanResults).where(inArray(scanResults.scanRunId, ids)) : [];
  const modeDe = new Map([...dernier.values()].map((r) => [r.id, r.mode]));
  const plateforme = new Set(await criteresPlateforme(db));
  const cs = new Map((await loadCriteres(db)).map((c) => [c.id, c]));
  const lignes: LigneFiabilite[] = DETECTEURS.map((d) => {
    const l = res.filter((r) => r.critereId === d.critereId);
    const nv = l.filter((r) => r.etat === "non_verifiable" || !r.statutPropose);
    const v = l.filter((r) => !nv.includes(r));
    const compte = (s: string) => v.filter((r) => r.statutPropose === s).length;
    const causes: Partial<Record<Cause, number>> = {};
    for (const r of nv) { const c = causeNonVerifiable(r.texte, modeDe.get(r.scanRunId) ?? null); causes[c] = (causes[c] ?? 0) + 1; }
    const causePrincipale = (Object.entries(causes).sort((a, b) => b[1] - a[1])[0]?.[0] as Cause | undefined) ?? null;
    const parStatut = ["OUI", "PARTIELLEMENT", "NON", "N.A."].map((s) => [s, compte(s)] as const).sort((a, b) => b[1] - a[1]);
    const [dominant, nDom] = parStatut[0];
    const partDominant = v.length ? nDom / v.length : 0;
    const confs = v.map((r) => CONF[r.confiance ?? ""]).filter((x): x is number => x !== undefined);
    const c = cs.get(d.critereId);
    return {
      critereId: d.critereId, critere: c?.critere ?? d.libelle, pilier: c?.pilier ?? "",
      sites: l.length, oui: compte("OUI"), partiel: compte("PARTIELLEMENT"), non: compte("NON"), nonVerifiable: nv.length, na: compte("N.A."),
      verifiable: l.length ? v.length / l.length : 0,
      confianceMoyenne: confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : null,
      causePrincipale, causes, dominant: v.length ? dominant : null, partDominant,
      plateformeProposee: v.length >= MIN_SITES_PLATEFORME && partDominant >= SEUIL_PLATEFORME,
      plateforme: plateforme.has(d.critereId),
    };
  });
  const campagne = await lireParametre<{ lanceeLe: string; sites: number; crees: number; refus: { clientId: string; raison: string }[] }>(db, CLE_CAMPAGNE);
  const modes = [...dernier.values()].reduce<Record<string, number>>((m, r) => { const k = r.mode ?? "?"; m[k] = (m[k] ?? 0) + 1; return m; }, {});
  // Chantiers produit Speedmedia : critères plateforme (proposés ou retenus) dont le résultat dominant n'est pas OUI
  const chantiersProduit = lignes.filter((l) => (l.plateforme || l.plateformeProposee) && l.dominant && l.dominant !== "OUI" && l.dominant !== "N.A.")
    .map((l) => ({ critereId: l.critereId, critere: l.critere, clients: l.dominant === "NON" ? l.non : l.partiel + l.non, sur: l.sites - l.nonVerifiable }));
  return { campagne, sitesAnalyses: dernier.size, enCours, erreurs, modes, lignes, chantiersProduit };
}

export async function csvFiabilite(db: DB): Promise<string> {
  const r = await rapportFiabilite(db);
  const pct = (x: number | null) => (x === null ? "" : String(Math.round(x * 100)));
  const esc = (v: string | number | null) => { const s = String(v ?? ""); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const entete = ["Critère", "Libellé", "Pilier", "Sites", "OUI", "PARTIELLEMENT", "NON", "Non vérifiable", "N.A.", "Vérifiable (%)", "Confiance moyenne (%)", "Cause principale du non vérifiable", "Résultat dominant", "Part du dominant (%)", "Plateforme proposée", "Marqué plateforme"];
  const lignes = r.lignes.map((l) => [l.critereId, l.critere, l.pilier, l.sites, l.oui, l.partiel, l.non, l.nonVerifiable, l.na, pct(l.verifiable), pct(l.confianceMoyenne), l.causePrincipale ?? "", l.dominant ?? "", pct(l.partDominant), l.plateformeProposee ? "oui" : "non", l.plateforme ? "oui" : "non"]);
  return "﻿" + [entete, ...lignes].map((x) => x.map(esc).join(";")).join("\r\n");
}

/** Nombre de scans « fiabilité » encore en file (pour l'écran) */
export async function fileFiabilite(db: DB) {
  const [x] = await db.select({ n: sql<number>`count(*)::int` }).from(scanRuns).where(and(eq(scanRuns.type, "fiabilite"), inArray(scanRuns.statut, ["en_attente", "en_cours"])));
  return x.n;
}
