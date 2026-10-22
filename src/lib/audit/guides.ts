/**
 * « Comment vérifier » (lot B3) : pour chaque critère qui peut rester manuel, 2 à 4 étapes concrètes
 * et des liens qui s'ouvrent directement. Variables des liens : {site} (URL auditée), {domaine}, {nom} (client), {placeId}.
 * Textes à faire valider par l'équipe CS (cf. DECISIONS.md).
 */
export interface Guide {
  etapes: string[];
  liens?: { libelle: string; url: string }[];
  /** Définition à afficher telle quelle (critère ambigu) */
  definition?: string;
  /** Saisie guidée : nombre compté par le CSM, converti en statut */
  comptage?: { libelle: string; max?: number; oui: number; partiel: number };
}

const G = (q: string) => `https://www.google.com/search?q=${q}`;
const BO = "le back-office SpeedResa du client";

export const GUIDES: Record<string, Guide> = {
  "VIS-03": {
    etapes: ["Ouvrez les avis de la fiche Google (lien ci-dessous) et triez par « Plus récents ».", "Sur les 10 derniers avis, comptez ceux qui ont une « Réponse du propriétaire ».", "Saisissez ce nombre : 8 ou plus = OUI, 5 à 7 = PARTIELLEMENT, moins de 5 = NON."],
    liens: [{ libelle: "Avis de la fiche Google", url: "https://search.google.com/local/reviews?placeid={placeId}" }, { libelle: "Rechercher la fiche", url: G("{nom}+avis") }],
  },
  "VIS-04": {
    etapes: ["Cliquez sur « Chercher les relais » : l'outil interroge le web (pages qui citent ou lient le site, hors site du client).", "Cochez les vrais relais locaux : mairie, CSE, office de tourisme, partenaire, presse locale. Ignorez les annuaires automatiques.", "2 relais ou plus = OUI, 1 = PARTIELLEMENT, aucun = NON. Ne vous contentez pas du déclaratif du client."],
    liens: [{ libelle: "Pages qui citent le domaine", url: G("%22{domaine}%22+-site%3A{domaine}") }, { libelle: "Mairies", url: G("%22{nom}%22+mairie") }, { libelle: "CSE", url: G("%22{nom}%22+CSE") }, { libelle: "Offices de tourisme", url: G("%22{nom}%22+office+de+tourisme") }],
  },
  "VIS-05": {
    definition: "Une publication sur Facebook, Instagram ou LinkedIn qui présente une offre précise (un voyage, un séjour) et dont le lien mène directement à la fiche de ce voyage sur le site de l'agence, pas à la page d'accueil.",
    etapes: ["Ouvrez les pages sociales trouvées par le scan (VIS-01) ou cherchez-les.", "Comptez les publications de ce type sur les 4 dernières semaines (cliquez sur le lien : il doit ouvrir une fiche voyage).", "8 ou plus = OUI, 4 à 7 = PARTIELLEMENT, moins de 4 = NON. Réseaux introuvables ou privés : envoyez la question au client."],
    liens: [{ libelle: "Facebook", url: G("{nom}+site%3Afacebook.com") }, { libelle: "Instagram", url: G("{nom}+site%3Ainstagram.com") }, { libelle: "LinkedIn", url: G("{nom}+site%3Alinkedin.com") }],
    comptage: { libelle: "Publications d'offres avec lien direct sur les 4 dernières semaines", oui: 8, partiel: 4 },
  },
  "VIS-06": { etapes: ["Question au client : les catalogues, flyers et la vitrine portent-ils un QR code vers le site ?", "Demandez une photo d'un support si possible."] },
  "PROD-01": { etapes: ["Question au client : quelle part de sa production (en nombre de voyages) est en ligne sur son site ?", "Comparez avec le nombre de produits en ligne (export catalogue, ou page « nos voyages » du site)."], liens: [{ libelle: "Produits indexés", url: G("site%3A{domaine}") }] },
  "PROD-02": { etapes: [`Ouvrez 5 fiches de production interne dans ${BO} (ou sur le site).`, "Vérifiez qu'il y a un prix adulte, un prix enfant quand c'est pertinent, et les suppléments.", "En attendant l'export catalogue, si vous ne savez pas : envoyez au client."], liens: [{ libelle: "Site du client", url: "{site}" }] },
  "PROD-04": { etapes: ["Ouvrez les 5 produits les plus vendus (liste de la preuve, ou export dossiers).", "Chaque fiche doit avoir au moins 5 photos nettes et un texte propre au client (pas le texte du TO)."] },
  "PROD-05": { etapes: [`Dans ${BO}, ouvrez quelques produits : la gestion de stock est-elle activée ?`, "La moitié des produits ou plus = OUI."] },
  "PROD-06": { etapes: [`Dans ${BO}, comptez les produits qui proposent au moins une option (excursion, chambre individuelle…).`, "50 % ou plus = OUI, 25 % ou plus = PARTIELLEMENT."] },
  "PROD-07": { etapes: [`Dans ${BO} : le module assurance est-il actif ?`, "Les produits ont-ils une assurance associée (au moins la moitié) ?"] },
  "PROD-08": { etapes: [`Dans ${BO}, regardez la date de dernière modification des produits en ligne.`, "70 % mis à jour depuis moins de 90 jours = OUI, 40 % = PARTIELLEMENT."] },
  "PERF-02": { etapes: ["Ouvrez le site comme un internaute et parcourez les listes de voyages.", "Les produits des flux TO sont-ils filtrés (pas de doublons, de destinations hors cible, de dates passées) ?", "L'offre est lisible = OUI ; beaucoup de « bruit » = NON."], liens: [{ libelle: "Site du client", url: "{site}" }] },
  "PERF-03": { etapes: [`Dans ${BO}, listez les produits internes en ligne.`, "Comptez ceux qui ont au moins un départ futur ouvert : 90 % = OUI, 70 % = PARTIELLEMENT."] },
  "PERF-04": { etapes: ["Connectez Google Analytics (Administration → Google Analytics) ou importez le trafic mensuel : la conversion se calcule alors seule."], liens: [{ libelle: "Écran Google Analytics", url: "/admin/google-analytics" }] },
  "PERF-07": { etapes: ["Calculé avec Google Analytics (débuts de réservation et achats) ou avec l'export dossiers enrichi : voir Administration → État des services."] },
  "PERF-08": { etapes: ["En attendant l'export dossiers enrichi : sur 10 dossiers confirmés récents, additionnez options et assurances et divisez par le total des dossiers.", "15 % ou plus = OUI, 8 % = PARTIELLEMENT."] },
  "PERF-09": { etapes: ["Vérifiez dans vos envois (ou ceux du CSM précédent) qu'un rapport de performance a été envoyé au client chaque mois sur les 3 derniers mois."] },
  "PERF-13": { etapes: [`Dans ${BO} : la relance automatique des paniers et des devis est-elle activée ?`, "Testez si possible : un panier abandonné avec email reçoit-il une relance ?"] },
  "TRK-02": { etapes: ["Ouvrez Google Analytics (propriété commune), rapport Événements, filtre « Nom du client ».", "L'événement purchase remonte-t-il avec une valeur (montant du dossier) ?"], liens: [{ libelle: "Écran Google Analytics", url: "/admin/google-analytics" }] },
  "TRK-05": { etapes: ["Question au client : fait-il de la publicité en ligne (Meta, Google Ads) ? Sinon : N.A.", "S'il en fait, le scan a-t-il trouvé le pixel Meta et la balise Google Ads ? Demandez si l'API Conversions est en place."] },
  "LEG-04": { etapes: ["Ouvrez les CGV (lien de la preuve) : contiennent-elles les mentions du Code du tourisme (articles R211-3 et suivants, conditions d'annulation, garant) ?", "Sont-elles accessibles avant le paiement, dans le tunnel ?"] },
  "LEG-07": { etapes: ["Ouvrez 3 fiches avec un prix : le prix affiché inclut-il les frais obligatoires (taxes, frais de dossier) ?", "Une promotion affiche-t-elle le prix de référence (le plus bas des 30 derniers jours) ?"], liens: [{ libelle: "Site du client", url: "{site}" }] },
  "LEG-09": { etapes: ["Question au client : son entreprise a-t-elle 10 salariés ou plus, ou plus de 2 M€ de chiffre d'affaires ? Sinon, l'accessibilité n'est pas obligatoire (N.A.).", "Si oui : une déclaration d'accessibilité est-elle publiée sur le site ?"] },
  "LEG-10": {
    definition: "Facturation électronique : depuis le 1er septembre 2026, toutes les entreprises doivent pouvoir recevoir des factures électroniques ; les PME devront aussi les émettre à partir du 1er septembre 2027. Il faut pour cela choisir une plateforme agréée par l'administration.",
    etapes: ["Question au client : « Avez-vous choisi votre plateforme agréée ? »", "Oui = OUI ; démarche en cours = PARTIELLEMENT ; non = NON (piste d'offre : accompagnement facturation électronique)."],
    liens: [{ libelle: "Plateformes agréées (impots.gouv.fr)", url: G("plateformes+agr%C3%A9%C3%A9es+facturation+%C3%A9lectronique+site%3Aimpots.gouv.fr") }],
  },
  "LEG-11": { etapes: ["Question au client : fait-il du démarchage téléphonique ? Sinon : N.A.", "Si oui : recueille-t-il le consentement préalable des prospects (règle applicable depuis 2026) ?"] },
  "LEG-12": { etapes: [`Dans ${BO}, module de paiement : 3-D Secure est-il actif ?`] },
  "RES-01": { etapes: ["Client B2B ou CSE uniquement (sinon N.A.).", `Dans ${BO} : des comptes clients autonomes ont-ils été créés ?`] },
  "RES-02": { etapes: [`Dans ${BO}, comptez les produits internes partagés sur le réseau S01.`] },
  "RES-03": { etapes: [`Dans ${BO}, comptez les produits en ligne venant du réseau S01.`] },
  "SOC-01": { etapes: ["Question au client : quels outils utilise-t-il (CRM, ERP, comptabilité) ?", "Sont-ils connectés à SpeedResa (pas de ressaisie manuelle) ? Demandez à l'équipe technique l'état du connecteur."] },
  "SOC-02": { etapes: ["Demandez à l'équipe technique la date de la dernière mise à jour du KIT du client."] },
  "SOC-03": { etapes: [`Dans ${BO} : un moyen de paiement en ligne est-il paramétré et actif ?`] },
  "SOC-04": { etapes: ["Comparez, sur un mois, le nombre de transactions PayBox et le nombre de dossiers payés en ligne dans SpeedResa."] },
  "SOC-05": { etapes: ["Vérifiez que le client est sur MT et non sur SRA2."] },
  "SOC-06": { etapes: ["Demandez à Martin si la migration Scylla est faite et si le bon fonctionnement a été vérifié."] },
  "SOC-08": { etapes: [`Dans ${BO}, journal des connexions : au moins une connexion par semaine sur les 4 dernières semaines ?`] },
  "DIST-01": { etapes: ["Le client est-il éligible à Veepee ? A-t-il donné son accord (opt-in) ?"] },
  "DIST-02": { etapes: ["Ouvrez les produits du client publiés sur Veepee : photos, textes et prix sont-ils au niveau du site ?"] },
  "INN-03": { etapes: ["Question au client : envoie-t-il une demande d'avis automatique après le voyage (Avis Vérifiés, Google…) ?"] },
  "INN-04": { etapes: ["Sur le site, une fiche voyage propose-t-elle des produits similaires ou des recommandations ?", "Les emails sont-ils personnalisés selon les voyages consultés ?"], liens: [{ libelle: "Site du client", url: "{site}" }] },
  "INN-05": { etapes: ["Le site affiche-t-il l'empreinte carbone des voyages ou un label durable (ATR, Green Globe…) ?", "Sinon, question au client."] },
  "REL-01": { etapes: ["Un rendez-vous de suivi a-t-il eu lieu depuis moins de 90 jours (fiche client, rendez-vous) ?"] },
  "REL-02": { etapes: ["Question au client : note de satisfaction de 0 à 10."] },
  "REL-03": { etapes: ["Un interlocuteur digital est-il identifié chez le client (nom, rôle) ?"] },
};

/** Remplace les variables d'un lien ; renvoie null s'il manque une valeur (ex. pas de fiche Google). */
export function lienGuide(url: string, v: { site?: string | null; domaine?: string | null; nom?: string | null; placeId?: string | null }): string | null {
  let manque = false;
  const r = url.replace(/\{(site|domaine|nom|placeId)\}/g, (_, k: keyof typeof v) => {
    const x = v[k];
    if (!x) { manque = true; return ""; }
    return k === "site" ? x : encodeURIComponent(x).replace(/%20/g, "+");
  });
  return manque ? null : r;
}

/** Statut d'un comptage guidé (VIS-05 : publications sur 4 semaines). */
export const statutComptage = (g: NonNullable<Guide["comptage"]>, n: number) => (n >= g.oui ? "OUI" : n >= g.partiel ? "PARTIELLEMENT" : "NON") as "OUI" | "PARTIELLEMENT" | "NON";
