import { STATUT_LIBELLE, type ScoreResult, type Statut } from "./score";
import { formatValeur } from "./valeur";

/**
 * Export CSV d'un audit, compatible Excel français : UTF-8 avec BOM, séparateur « ; »,
 * dates JJ/MM/AAAA, décimales à virgule, aucune formule.
 */

export interface ExportCritere {
  id: string; pilier: string; critere: string; points: number; obligationLegale: boolean; offreSiNon: string | null;
  unite: string | null; sens: string | null; seuilPlein: number | null; seuilMoitie: number | null; source: string;
}
export interface ExportEval {
  critereId: string; statut: Statut | null; valeur: string | null; commentaire: string | null; source: string | null;
  confiance: string | null; aEnvoyerClient: boolean; proposition: { statut: Statut | null; valeur: number | null; texte?: string } | null;
  preuve: unknown; auteur: string | null; updatedAt: string | Date | null;
}
export interface ExportInput {
  version: "client" | "interne";
  client: { id: string; nom: string };
  audit: { date: string; statut: string; urlAuditee: string | null; mention: string | null };
  csm: string | null;
  score: ScoreResult;
  criteres: ExportCritere[];
  evaluations: ExportEval[];
  interne?: { sante: number | null; risque: string | null; alertes: string[] };
}

const fr = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");
const num = (x: number | null | undefined, d = 1) => (x === null || x === undefined ? "" : x.toLocaleString("fr-FR", { maximumFractionDigits: d }).replace(/ | /g, " "));

/** Échappe une cellule : guillemets si nécessaire, neutralise les formules (=, +, @, - suivi d'une lettre). */
export function cell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  s = s.replace(/\r?\n/g, " ").replace(/ | /g, " ");
  if (/^[=+@\t\r]/.test(s) || /^-[^\d\s]/.test(s)) s = "'" + s;
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const ligne = (cols: unknown[]) => cols.map(cell).join(";");

export function priorite(c: ExportCritere, statut: Statut | null): "haute" | "moyenne" | "basse" | "" {
  if (statut !== "NON" && statut !== "PARTIELLEMENT") return "";
  if (c.obligationLegale) return "haute";
  if (statut === "NON") return c.points >= 10 ? "haute" : "moyenne";
  return c.points >= 8 ? "moyenne" : "basse";
}

function constat(c: ExportCritere, statut: Statut | null, valeurTxt: string): string {
  const base: Record<string, string> = {
    OUI: "Point conforme.",
    PARTIELLEMENT: "Point partiellement en place.",
    NON: c.obligationLegale ? "Point non conforme à une obligation légale." : "Point à mettre en place.",
    "CORRIGÉ": "Point corrigé, à confirmer lors du prochain audit.",
    "N.A.": "Non applicable à votre activité.",
  };
  let t = statut ? base[statut] : "Non vérifié à ce stade.";
  if (valeurTxt && statut && statut !== "N.A.") {
    const op = c.sens === "↓" ? "≤" : "≥";
    t += ` Valeur mesurée : ${valeurTxt}${c.seuilPlein !== null ? ` (objectif ${op} ${formatValeur(c.seuilPlein, c.unite)})` : ""}.`;
  }
  return t;
}

export function nomFichier(nomClient: string, type: "pre-audit" | "audit-final", date: string) {
  const n = nomClient.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `Audit-SpeedResa_${n}_${type}_${date.slice(0, 10)}.csv`;
}

export function buildAuditCsv(x: ExportInput): { filename: string; content: string } {
  const finalise = x.audit.statut === "finalise";
  const type = finalise ? "audit-final" : "pre-audit";
  const ev = new Map(x.evaluations.map((e) => [e.critereId, e]));
  const s = x.score;
  const L: string[] = [];
  L.push(ligne(["Audit de maturité numérique SpeedResa"]));
  L.push(ligne(["Client", x.client.nom]));
  L.push(ligne(["Site audité", x.audit.urlAuditee ?? ""]));
  L.push(ligne(["Date", fr(x.audit.date)]));
  L.push(ligne(["Type", finalise ? "Audit finalisé" : "Pré-audit automatique (à confirmer)"]));
  L.push(ligne(["CSM", x.csm ?? ""]));
  L.push(ligne(["Score de maturité (/100)", num(s.score)]));
  L.push(ligne(["Score visé après actions (/100)", num(s.scoreApres)]));
  L.push(ligne(["Couverture", `${num(s.couverture * 100, 0)} %`]));
  if (!finalise) L.push(ligne(["Mention", "Ce pré-audit est établi automatiquement et doit être confirmé avec votre CSM. Les points non encore évalués apparaissent comme « Non vérifié »."]));
  L.push(ligne(["Mention légale", "Les points de conformité légale sont des indications et ne constituent pas un avis juridique."]));
  if (x.audit.mention) L.push(ligne(["Remarque", x.audit.mention]));
  if (x.version === "interne" && x.interne) {
    L.push(ligne(["Score santé (interne)", x.interne.sante ?? ""]));
    L.push(ligne(["Niveau de risque (interne)", x.interne.risque ?? ""]));
    L.push(ligne(["Alertes (interne)", x.interne.alertes.join(" | ")]));
  }
  L.push("");

  const enTete = ["Pilier", "Critère", "Statut", "Valeur mesurée", "Constat", "Recommandation", "Priorité", "Obligation légale", "Solution SpeedResa proposée"];
  if (x.version === "interne") enTete.push("ID critère", "Points", "Source", "Confiance", "Résultat automatique proposé", "Preuve", "Commentaire interne", "Envoyé au client", "Auteur", "Dernière modification");
  L.push(ligne(enTete));

  for (const c of x.criteres) {
    const e = ev.get(c.id);
    // Pré-audit : à défaut de réponse validée, on reprend le résultat automatique proposé
    const statut: Statut | null = e?.statut ?? (!finalise ? e?.proposition?.statut ?? null : null);
    const brut = e?.valeur ?? (e?.proposition?.valeur !== undefined && e?.proposition?.valeur !== null ? String(e.proposition.valeur) : null);
    // Version client : pas de chiffres issus des données de vente
    const masquer = x.version === "client" && /Données/.test(c.source);
    // Valeur affichée uniquement pour les critères à seuil (les autres gardent une valeur technique interne)
    const valeurTxt = masquer || c.seuilPlein === null ? "" : formatValeur(brut, c.unite);
    const aTraiter = statut === "NON" || statut === "PARTIELLEMENT";
    const row: unknown[] = [
      c.pilier, c.critere, statut ? STATUT_LIBELLE[statut] : "Non vérifié", valeurTxt, constat(c, statut, valeurTxt),
      aTraiter ? (c.offreSiNon ? `Nous recommandons : ${c.offreSiNon}.` : "À traiter avec votre CSM.") : "",
      priorite(c, statut), c.obligationLegale ? "oui" : "non", aTraiter ? c.offreSiNon ?? "" : "",
    ];
    if (x.version === "interne") {
      const pr = e?.preuve as { texte?: string; source?: string; periode?: string } | null;
      row.push(c.id, c.points, e?.source ?? "", e?.confiance ?? "", e?.proposition?.statut ?? "",
        pr?.texte ? `${pr.texte}${pr.source ? ` (${pr.source}${pr.periode ? `, ${pr.periode}` : ""})` : ""}` : "",
        e?.commentaire ?? "", e?.aEnvoyerClient ? "oui" : "", e?.auteur ?? "", e?.updatedAt ? fr(new Date(e.updatedAt).toISOString()) : "");
    }
    L.push(ligne(row));
  }
  return { filename: nomFichier(x.client.nom, type, x.audit.date), content: "﻿" + L.join("\r\n") + "\r\n" };
}
