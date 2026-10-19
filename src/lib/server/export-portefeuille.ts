import type { DB } from "@/db";
import { cell } from "@/lib/audit/export-csv";
import { MATURITE_LIBELLE, type StatutMaturite } from "@/lib/audit/score";
import { loadPortfolio } from "./portfolio";

const num = (x: number | null | undefined, d = 1) => (x === null || x === undefined ? "" : x.toLocaleString("fr-FR", { maximumFractionDigits: d }).replace(/ | /g, " "));
const pct = (x: number | null | undefined) => (x === null || x === undefined ? "" : `${num(x * 100, 1)} %`);
const fr = (iso: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "");

/** Export CSV du portefeuille (super admin) : scores, alertes et opportunités de chaque client. Format Excel français. */
export async function csvPortefeuille(db: DB) {
  const { rows, reference } = await loadPortfolio(db);
  const entete = ["ID", "Client", "Groupe", "Modèle", "CSM", "Site", "Segment", "Risque", "Usage", "Score santé", "Volume 12 mois (€)", "VA confirmé 12 mois (€)", "Évolution 90 j", "Transformation", "Jours sans dossier", "Part du potentiel captée", "Visites / mois", "Conversion du trafic", "Manque à gagner estimé / mois (€)",
    "Score de maturité", "Statut de maturité", "Couverture", "Score visé après actions", "Dernier audit", "Audit en cours", "Alerte principale", "Nombre d'alertes", "Alertes", "Opportunités"];
  const lignes = [entete.map(cell).join(";")];
  for (const r of [...rows].sort((a, b) => a.nom.localeCompare(b.nom))) {
    const m = r.m;
    lignes.push([
      r.id, r.nom, r.groupe ?? "", r.modele ?? "", r.csm ?? "", r.urls[0] ?? "", m?.segment ?? "", m?.risque ?? "", m?.usage ?? "", m?.sante ?? "",
      num(m?.volume_12m, 0), num(m?.va_confirme_12m, 0), pct(m?.evol_90j), pct(m?.transformation), m?.jours_sans_dossier ?? "", pct(m?.part_captee), m?.visites_mensuelles ?? "", m?.conversion != null ? `${num(m.conversion * 100, 2)} %` : "", num(m?.manque_a_gagner_mensuel, 0),
      num(r.maturite?.score), r.maturite?.statut ? MATURITE_LIBELLE[r.maturite.statut as StatutMaturite] : "", r.maturite ? pct(r.maturite.couverture) : "", num(r.maturite?.scoreApres),
      fr(r.dernierAudit), r.auditEnCours ? "oui" : "", m?.alerte_principale ?? "", m?.alertes.length ?? 0, (m?.alertes ?? []).map((a) => a.message).join(" | "),
      (m?.opportunites ?? []).map((o) => `${o.libelle} : ${o.detail}`).join(" | "),
    ].map(cell).join(";"));
  }
  return { filename: `Portefeuille-SpeedResa_${(reference ?? new Date().toISOString()).slice(0, 10)}.csv`, content: "﻿" + lignes.join("\r\n") + "\r\n" };
}
