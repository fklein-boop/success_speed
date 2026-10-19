import { MATURITE_LIBELLE, type StatutMaturite } from "@/lib/audit/score";
import type { ActionProposee } from "./plan";
import type { LevierEnRetard } from "./leviers";

/**
 * Textes de la restitution : références réglementaires des alertes légales et modèles de repli
 * utilisés quand Claude n'est pas disponible. Tous modifiables avant envoi.
 * Les références sont des indications à faire valider par votre juridique (pas un avis juridique).
 */
export const MENTION_JURIDIQUE = "Ces points sont des indications de conformité établies à partir de votre site ; ils ne constituent pas un avis juridique.";

export const REFERENCES_LEGALES: Record<string, string> = {
  "TRK-04": "Exigence de Google pour diffuser des annonces auprès des internautes de l'Espace économique européen (règlement européen sur les marchés numériques).",
  "LEG-01": "Article 82 de la loi Informatique et Libertés et recommandations de la CNIL sur les cookies : refuser doit être aussi simple qu'accepter, aucun traceur avant consentement.",
  "LEG-02": "Article R211-2 du Code du tourisme (immatriculation Atout France, garantie financière, assurance RC Pro) et article 6 de la loi pour la confiance dans l'économie numérique (éditeur, hébergeur).",
  "LEG-03": "Articles L211-8 et R211-4 du Code du tourisme : le formulaire d'information standard doit être remis au voyageur avant la conclusion du contrat.",
  "LEG-04": "Articles L211-1 et suivants et R211-3 et suivants du Code du tourisme : informations précontractuelles et conditions du contrat de voyage, accessibles avant le paiement.",
  "LEG-05": "Articles L612-1 et L616-1 du Code de la consommation : le professionnel indique le médiateur de la consommation dont il relève.",
  "LEG-06": "Articles 13 et 14 du RGPD : finalités, durées de conservation, droits des personnes et contact doivent être indiqués.",
  "LEG-07": "Articles L112-1 et L112-1-1 du Code de la consommation : prix TTC frais obligatoires inclus ; toute réduction indique le prix le plus bas des 30 derniers jours.",
  "LEG-08": "Article L111-7-2 du Code de la consommation : le site indique si les avis affichés font l'objet d'un contrôle et selon quelles modalités.",
  "LEG-09": "Directive (UE) 2019/882 (European Accessibility Act), applicable depuis le 28/06/2025 : services accessibles et déclaration d'accessibilité, sauf exemption des micro-entreprises.",
  "LEG-10": "Réforme de la facturation électronique : toutes les entreprises doivent pouvoir recevoir des factures électroniques depuis le 01/09/2026, l'émission devient obligatoire selon un calendrier par taille d'entreprise.",
  "LEG-11": "Article L223-1 du Code de la consommation modifié : le démarchage téléphonique requiert le consentement préalable du consommateur à partir du 11/08/2026.",
  "LEG-12": "Directive européenne sur les services de paiement (DSP2) : authentification forte du payeur (3-D Secure) pour les paiements en ligne.",
};

/** Texte prêt à envoyer au client pour un point légal non conforme. */
export function texteAlerteLegale(c: { id: string; critere: string; offreSiNon: string | null }, statut: string, constat: string | null, references: Record<string, string> = REFERENCES_LEGALES): string {
  return [
    `${c.critere}`,
    `Constat : ${constat?.trim() || (statut === "NON" ? "ce point n'est pas en place sur votre site." : "ce point n'est que partiellement en place sur votre site.")}`,
    references[c.id] ? `Ce que prévoit la réglementation : ${references[c.id]}` : "",
    `Notre recommandation : ${c.offreSiNon ? `${c.offreSiNon}, que nous pouvons mettre en place avec vous.` : "en parler lors de notre prochain échange."}`,
  ].filter(Boolean).join("\n");
}

export interface ContexteTextes {
  client: string;
  csm: string | null;
  score: number | null;
  scoreVise: number | null;
  statut: StatutMaturite | null;
  couverture: number;
  preAudit: boolean;
  forces: string[];
  priorites: ActionProposee[];
  legaux: string[];
}

/** Synthèse pour la restitution client (sans données internes). Modèle de repli. */
export function syntheseModele(x: ContexteTextes): string {
  const niveau = x.statut ? MATURITE_LIBELLE[x.statut].toLowerCase() : "en cours d'évaluation";
  const p = [
    `${x.preAudit ? "Ce pré-audit automatique" : "Cet audit"} de votre présence numérique aboutit à un score de ${x.score !== null ? `${Math.round(x.score)}/100` : "— (couverture insuffisante)"}, soit une ${niveau}.`,
    x.forces.length ? `Vos points forts : ${x.forces.slice(0, 3).join(" ; ").toLowerCase()}.` : "",
    x.priorites.length ? `Les leviers les plus utiles pour vous : ${x.priorites.slice(0, 3).map((a) => (a.offre ?? a.libelle).toLowerCase()).join(", ")}.` : "",
    x.legaux.length ? `${x.legaux.length} point(s) de conformité légale méritent une attention rapide.` : "",
    x.scoreVise !== null && x.score !== null && x.scoreVise > x.score ? `En menant le plan d'action proposé, votre score pourrait atteindre ${Math.round(x.scoreVise)}/100.` : "",
  ];
  return p.filter(Boolean).join(" ");
}

export function emailModele(x: ContexteTextes): { objet: string; corps: string } {
  return {
    objet: `${x.preAudit ? "Pré-audit" : "Audit"} de votre site : vos résultats et nos recommandations`,
    corps: [
      "Bonjour,",
      `Nous avons réalisé ${x.preAudit ? "un pré-audit automatique" : "l'audit"} de la présence numérique de ${x.client}. Vous trouverez en pièce jointe la restitution détaillée${x.preAudit ? ", à confirmer ensemble" : ""}.`,
      x.score !== null ? `En résumé : un score de ${Math.round(x.score)}/100${x.scoreVise !== null && x.scoreVise > x.score ? `, avec un potentiel de ${Math.round(x.scoreVise)}/100 après les actions proposées` : ""}.` : "",
      x.priorites.length ? `Nos trois priorités pour vous :\n${x.priorites.slice(0, 3).map((a) => `- ${a.offre ?? a.libelle}`).join("\n")}` : "",
      x.legaux.length ? `Nous avons aussi relevé ${x.legaux.length} point(s) de conformité légale à regarder rapidement. ${MENTION_JURIDIQUE}` : "",
      "Je vous propose d'en parler lors d'un rendez-vous de 30 minutes. Quelles disponibilités auriez-vous dans les deux prochaines semaines ?",
      `Bien cordialement,\n${x.csm ?? "Votre chargé(e) de clientèle"}\nSpeedResa — Speedmedia`,
    ].filter(Boolean).join("\n\n"),
  };
}

/** Explication interne « pourquoi ce client sous-performe » et plan 30 jours. Modèle de repli. */
export function explicationModele(nom: string, enRetard: LevierEnRetard[], causes: { levier: string; criteres: string[] }[], plan: ActionProposee[]): { explication: string; plan30: string[] } {
  const enCause = causes.reduce((n, c) => n + c.criteres.length, 0);
  const explication = enRetard.length
    ? [
      `${nom} est en retard sur ${enRetard.length} levier(s) : ${enRetard.map((l) => `${l.libelle.toLowerCase()} (${l.constat.replace(/\.$/, "").replace(/^./, (x) => x.toLowerCase())})`).join(" ; ")}.`,
      enCause ? `L'audit relève ${enCause} critère(s) à NON ou partiels sur ces leviers (détail ci-dessous) : les actions correspondantes sont en tête du plan.` : "L'audit ne relève pas de critère à NON sur ces leviers : la cause est probablement commerciale ou liée à l'usage de l'outil.",
    ].join(" ")
    : `${nom} ne présente pas d'indicateur en retard dans les données SpeedResa. Le plan d'action vise à consolider la maturité numérique.`;
  const plan30 = plan.slice(0, 4).map((a, i) => `Semaine ${i + 1} : ${a.offre ?? a.libelle} (${a.critereId})`);
  return { explication, plan30 };
}
