import { z } from "zod";
import { extraitAutour, liens, ressources } from "../html";
import { analyserIa, iaDisponible, type DocumentIa } from "../ia";
import { nonVerifiable, type Detecteur, type Resultat } from "../types";

const SchemaElements = z.object({
  elements: z.array(z.object({
    nom: z.string().describe("Nom exact de l'élément, tel que fourni dans la liste"),
    present: z.boolean(),
    extrait: z.string().describe("Citation courte et exacte du document prouvant la présence, ou chaîne vide"),
  })),
  remarque: z.string().describe("Une phrase : point d'attention principal pour l'agence (ou chaîne vide)"),
});

/**
 * Vérifie par Claude la présence d'éléments obligatoires dans des pages légales.
 * Renvoie null si Claude n'est pas disponible ou en cas d'erreur (on garde alors l'analyse par motifs).
 */
async function elementsParIa(consigne: string, documents: DocumentIa[], elements: string[]) {
  if (!iaDisponible()) return null;
  try {
    const r = await analyserIa({
      outil: "verifier_elements",
      schema: SchemaElements,
      consigne: `${consigne}\nPour CHACUN des éléments suivants, indique s'il est présent dans les documents, avec une citation courte : ${elements.map((e) => `« ${e} »`).join(", ")}.`,
      documents,
    });
    const present = (n: string) => r.elements.find((e) => e.nom.toLowerCase() === n.toLowerCase());
    return { ok: elements.filter((n) => present(n)?.present), extraits: elements.map((n) => present(n)).filter((e) => e?.present && e.extrait).map((e) => `${e!.nom} : « ${e!.extrait.slice(0, 120)} »`), remarque: r.remarque };
  } catch { return null; }
}

/** Cookies non strictement nécessaires (mesure d'audience, publicité, réseaux sociaux). */
const COOKIES_TRACEURS = /^(_ga|_gid|_gat|_gcl_|_fbp|_fbc|fr$|_uet|_uetsid|_uetvid|_hj|_clck|_clsk|_pin_|_tt_|_ttp|IDE$|test_cookie$|NID$|_scid|_rdt_uuid|li_|bcookie|lidc|MUID|_dc_gtm_|__utm|_hp2|ajs_|mp_|amplitude|_pk_id|_pk_ses)/i;
const DOMAINES_TRACEURS = /(google-analytics\.com\/(g\/)?collect|analytics\.google\.com\/g\/collect|doubleclick\.net|googleadservices\.com|facebook\.com\/tr|connect\.facebook\.net\/.+\/fbevents|bat\.bing\.com|clarity\.ms\/collect|hotjar\.com|analytics\.tiktok\.com|px\.ads\.linkedin\.com|snap\.licdn\.com|ct\.pinterest\.com|matomo\.php|piwik\.php)/i;
const CMP_SCRIPTS: [string, RegExp][] = [
  ["Axeptio", /axept\.io|axeptio/i], ["Didomi", /didomi/i], ["OneTrust", /onetrust|cookielaw\.org/i], ["Cookiebot", /cookiebot/i],
  ["tarteaucitron", /tarteaucitron/i], ["Sirdata", /sirdata|choices\.consentframework/i], ["Usercentrics", /usercentrics/i],
  ["iubenda", /iubenda/i], ["Complianz", /complianz|cmplz/i], ["CookieYes", /cookieyes|cky-consent/i], ["Quantcast", /quantcast\.mgr|cmp\.quantcast/i],
  ["Consentmanager", /consentmanager\.net/i], ["Klaro", /klaro/i],
];

export const LEG01: Detecteur = {
  critereId: "LEG-01",
  libelle: "Bannière cookies conforme CNIL",
  navigateur: true,
  async run(ctx) {
    const home = await ctx.accueil();
    const nav = await ctx.navigateur().catch(() => null);
    const html = nav?.html ?? home.corps;
    const toutes = [html, ...ressources(html, home.urlFinale), ...(nav?.requetes ?? [])].join("\n");
    const cmp = CMP_SCRIPTS.find(([, re]) => re.test(toutes))?.[0] ?? (nav?.cmpDom ? nav.cmpDom : null);

    if (!nav) {
      const traceurs = home.setCookies.map((c) => c.split("=")[0].trim()).filter((n) => COOKIES_TRACEURS.test(n));
      const texte = `${cmp ? `Gestionnaire de consentement détecté : ${cmp}.` : "Aucun gestionnaire de consentement reconnu dans le code."}${traceurs.length ? ` Cookies traceurs déposés d'emblée : ${traceurs.join(", ")}.` : ""}`;
      return { statut: cmp && !traceurs.length ? null : "NON", texte: cmp && !traceurs.length ? `${texte} Dépôt de cookies avant consentement non vérifiable sans navigateur.` : texte, confiance: "basse", preuve: { texte, url: home.urlFinale } };
    }

    const cookies = nav.cookies.filter((c) => COOKIES_TRACEURS.test(c.name));
    const requetes = nav.requetes.filter((u) => DOMAINES_TRACEURS.test(u));
    const lignes = [
      `Gestionnaire de consentement : ${cmp ?? "aucun détecté"}.`,
      `Bouton de refus au premier niveau : ${nav.boutonRefuser ? `« ${nav.boutonRefuser} »` : "non trouvé"}${nav.boutonAccepter ? ` (acceptation : « ${nav.boutonAccepter} »)` : ""}.`,
      `Avant tout consentement : ${cookies.length} cookie(s) traceur(s)${cookies.length ? ` (${[...new Set(cookies.map((c) => `${c.name} @${c.domain}`))].slice(0, 6).join(", ")})` : ""}, ${requetes.length} requête(s) vers des services de mesure ou de publicité.`,
    ];
    const preuve = { texte: lignes.join(" "), url: nav.urlFinale, requete: requetes[0], capture: "accueil-ordinateur" };
    const r = (statut: Resultat["statut"], texte: string): Resultat => ({ statut, texte, confiance: "haute", preuve });
    if (!cmp && !cookies.length && !requetes.length) return { ...r("OUI", "Aucun traceur avant consentement ; aucune bannière nécessaire."), confiance: "moyenne" };
    if (!cmp) return r("NON", "Traceurs déposés sans bannière de consentement.");
    // Matomo peut être exempté de consentement s'il est configuré selon les recommandations CNIL
    const seulementMatomo = requetes.length > 0 && requetes.every((u) => /matomo|piwik/i.test(u)) && cookies.every((c) => /^_pk_/.test(c.name));
    if (seulementMatomo) return { ...r("PARTIELLEMENT", `Bannière ${cmp} présente ; seul Matomo mesure avant consentement (exemption CNIL possible si configuré en mode exempté, à vérifier).`), confiance: "moyenne" };
    if (cookies.length || requetes.length) return r(nav.boutonRefuser ? "PARTIELLEMENT" : "NON", `Bannière ${cmp} présente, mais des traceurs sont déposés avant le consentement.`);
    if (!nav.boutonRefuser) return { ...r("PARTIELLEMENT", `Bannière ${cmp} présente, mais pas de bouton « Refuser » visible au premier niveau.`), confiance: "moyenne" };
    return r("OUI", `Bannière ${cmp} conforme : refus au premier niveau, aucun traceur avant consentement.`);
  },
};

// ───────── Pages légales (analyse par Claude si la clé est configurée, sinon par motifs) ─────────

const GARANTS = /(APST|Groupama\s+Assurance[- ]Cr[ée]dit|Atradius|Atout\s+France\s+garantie|Hiscox|Axa\s+(France\s+)?Caution|CMB?\s+garantie|BNP\s+Paribas|Cr[ée]dit\s+(Agricole|Mutuel)|Banque\s+Populaire|Caisse\s+d'[ÉE]pargne|garant(ie)?\s+financi[èe]re|garant\s*:)/i;

export const LEG02: Detecteur = {
  critereId: "LEG-02",
  libelle: "Mentions légales complètes",
  async run(ctx) {
    const p = await ctx.pageLegale("mentions");
    if (!p) return { statut: "NON", texte: "Page « Mentions légales » introuvable depuis la page d'accueil.", confiance: "moyenne", preuve: { texte: "Aucun lien « Mentions légales » trouvé, ni à /mentions-legales.", url: (await ctx.accueil()).urlFinale } };
    // Le n° Atout France figure souvent aussi dans le pied de page ou les CGV
    const cgv = await ctx.pageLegale("cgv");
    const t = [p.texte, cgv?.texte ?? "", (await ctx.accueil()).texte.slice(-4000)].join("\n");
    const items: [string, RegExp][] = [
      ["immatriculation Atout France", /\bIM\s?\d{3}\s?\d{2}\s?\d{4}\b|\bIM\d{9}\b/i],
      ["garant financier", GARANTS],
      ["assureur RC Pro", /responsabilit[ée]\s+civile\s+professionnelle|\bRC\s?Pro\b|assurance\s+(de\s+)?responsabilit/i],
      ["éditeur (raison sociale, SIREN/RCS)", /\b(SIREN|SIRET|RCS|R\.C\.S\.)\b|\b\d{3}\s?\d{3}\s?\d{3}(\s?\d{5})?\b/i],
      ["hébergeur", /h[ée]berg[ée]?(ur|ement)?\b|\bh[ée]bergeur/i],
    ];
    let ok = items.filter(([, re]) => re.test(t)).map(([n]) => n);
    const ia = await elementsParIa(
      "Vérifie la complétude des mentions légales d'une agence de voyages française (articles L211-18 et R211-2 du Code du tourisme, loi pour la confiance dans l'économie numérique).",
      [{ titre: "Mentions légales", url: p.urlFinale, texte: p.texte }, ...(cgv ? [{ titre: "CGV", url: cgv.urlFinale, texte: cgv.texte }] : []), { titre: "Pied de page", texte: (await ctx.accueil()).texte.slice(-4000) }],
      items.map(([n]) => n),
    );
    if (ia) ok = ia.ok;
    const manquants = items.filter(([n]) => !ok.includes(n)).map(([n]) => n);
    const im = t.match(/\bIM\s?\d{3}\s?\d{2}\s?\d{4}\b|\bIM\d{9}\b/i)?.[0];
    const texte = manquants.length ? `Mentions incomplètes : ${manquants.join(", ")} non trouvé${manquants.length > 1 ? "s" : ""}.` : "Mentions légales complètes.";
    const preuve = { texte: `Trouvés : ${ok.join(", ") || "aucun"}.${im ? ` N° Atout France : ${im}.` : ""}${ia?.remarque ? ` ${ia.remarque}` : ""}`, url: p.urlFinale, extrait: (ia?.extraits.slice(0, 3).join(" · ") || extraitAutour(p.texte, /IM\s?\d{3}|garant|responsabilit[ée] civile|h[ée]berg/i)) ?? undefined, source: ia ? "Analyse Claude" : "Analyse par motifs" };
    return { statut: manquants.length === 0 ? "OUI" : ok.length >= 3 ? "PARTIELLEMENT" : "NON", valeur: ok.length, texte, confiance: "moyenne", preuve };
  },
};

export const LEG05: Detecteur = {
  critereId: "LEG-05",
  libelle: "Médiateur de la consommation",
  async run(ctx) {
    const pages = (await Promise.all([ctx.pageLegale("mentions"), ctx.pageLegale("cgv")])).filter((p) => p !== null);
    const home = await ctx.accueil();
    if (!pages.length) return { statut: null, texte: "Ni mentions légales ni CGV trouvées : médiateur non vérifiable.", confiance: "basse", preuve: { texte: "Pages légales introuvables.", url: home.urlFinale } };
    const t = pages.map((p) => p.texte).join("\n");
    const html = [home.corps, ...pages.map((p) => p.corps)].join("\n");
    const mediateur = /(M[ée]diation\s+Tourisme\s+(et|&)\s+Voyage|\bMTV\b|mtv\.travel|m[ée]diateur\s+de\s+la\s+consommation|m[ée]diateur\s+(du|de)\s+tourisme|saisir\s+le\s+m[ée]diateur)/i;
    const odr = /ec\.europa\.eu\/consumers\/odr/i.test(html);
    const m = mediateur.test(t);
    const preuve = { texte: `Médiateur ${m ? "mentionné" : "non trouvé"} dans ${pages.map((p) => new URL(p.urlFinale).pathname).join(" et ")}.${odr ? " Lien vers la plateforme européenne RLL (fermée le 20/07/2025) encore présent." : ""}`, url: pages[0].urlFinale, extrait: extraitAutour(t, mediateur) ?? undefined };
    if (!m) return { statut: "NON", texte: "Aucun médiateur de la consommation mentionné.", confiance: "moyenne", preuve };
    if (odr) return { statut: "PARTIELLEMENT", texte: "Médiateur mentionné, mais lien à retirer vers la plateforme européenne RLL (fermée le 20/07/2025).", confiance: "haute", preuve };
    return { statut: "OUI", texte: "Médiateur de la consommation mentionné.", confiance: "moyenne", preuve };
  },
};

const ITEMS_RGPD: RegExp[] = [/finalit/i, /conserv/i, /rectification|effacement|opposition/i, /\bDPO\b|exercer/i, /\bCNIL\b/i];
const score = (t: string) => ITEMS_RGPD.filter((re) => re.test(t)).length;

export const LEG06: Detecteur = {
  critereId: "LEG-06",
  libelle: "Politique de confidentialité RGPD",
  async run(ctx) {
    let p = await ctx.pageLegale("confidentialite");
    // Souvent intégrée aux mentions légales, aux CGV ou à la page cookies : on retient la plus complète
    let integree = false;
    if (!p) {
      const home = await ctx.accueil();
      const cookies = home.liens.find((l) => /cookie/i.test(l.href));
      const candidates = [await ctx.pageLegale("mentions"), await ctx.pageLegale("cgv"), cookies ? await ctx.get(cookies.href) : null]
        .filter((x): x is NonNullable<typeof x> => !!x && /donn[ée]es\s+(à\s+caract[èe]re\s+)?personnel|rgpd|confidentialit/i.test(x.texte));
      p = candidates.sort((a, b) => score(b.texte) - score(a.texte))[0] ?? null;
      integree = !!p;
    }
    if (!p) return { statut: "NON", texte: "Politique de confidentialité introuvable.", confiance: "moyenne", preuve: { texte: "Aucun lien « Confidentialité » / « Données personnelles » trouvé.", url: (await ctx.accueil()).urlFinale } };
    const items: [string, RegExp][] = [
      ["finalités", /finalit[ée]s?|utilis(ons|er)\s+vos\s+donn[ée]es|pour\s+quoi/i],
      ["durées de conservation", /dur[ée]e?s?\s+de\s+conservation|conserv[ée]es?\s+(pendant|durant)|conservons/i],
      ["droits des personnes", /droit\s+d.acc[èe]s|rectification|effacement|opposition|portabilit/i],
      ["contact / DPO", /d[ée]l[ée]gu[ée]\s+[àa]\s+la\s+protection|\bDPO\b|exercer\s+(vos|ces)\s+droits|@[a-z0-9-]+\.[a-z]{2,}/i],
      ["réclamation CNIL", /\bCNIL\b/i],
    ];
    let ok = items.filter(([, re]) => re.test(p!.texte)).map(([n]) => n);
    const ia = await elementsParIa(
      "Vérifie la complétude de la politique de confidentialité d'une agence de voyages au regard des articles 13 et 14 du RGPD.",
      [{ titre: "Politique de confidentialité", url: p.urlFinale, texte: p.texte }],
      items.map(([n]) => n),
    );
    if (ia) ok = ia.ok;
    const manquants = items.filter(([n]) => !ok.includes(n)).map(([n]) => n);
    const texte = manquants.length ? `Politique incomplète : ${manquants.join(", ")} non trouvé${manquants.length > 1 ? "s" : ""}.` : "Politique de confidentialité complète.";
    return { statut: ok.length >= 5 ? "OUI" : ok.length >= 3 ? "PARTIELLEMENT" : "NON", valeur: ok.length, texte, confiance: "moyenne", preuve: { texte: `Éléments trouvés : ${ok.join(", ") || "aucun"}.` + (integree ? " Pas de page dédiée : informations intégrées à une autre page." : "") + (ia?.remarque ? ` ${ia.remarque}` : ""), url: p.urlFinale, extrait: ia?.extraits.slice(0, 3).join(" · ") || undefined, source: ia ? "Analyse Claude" : "Analyse par motifs" } };
  },
};

// ───────── LEG-04 CGV conformes au Code du tourisme ─────────

const ELEMENTS_CGV = [
  "référence aux articles du Code du tourisme (L211-… / R211-…)",
  "conditions d'annulation par le voyageur (frais)",
  "conditions de modification du prix",
  "cession du contrat",
  "information sur l'assurance facultative",
  "garant financier",
  "médiateur de la consommation",
];
const MOTIFS_CGV: RegExp[] = [
  /\b[LR]\.?\s?211-\d+|code\s+du\s+tourisme/i, /annulation|r[ée]siliation/i, /r[ée]vision\s+du\s+prix|modification\s+du\s+prix|variation/i,
  /cession/i, /assurance/i, /garant|garantie\s+financi[èe]re|APST/i, /m[ée]diat/i,
];

export const LEG04: Detecteur = {
  critereId: "LEG-04",
  libelle: "CGV conformes au Code du tourisme",
  async run(ctx) {
    const home = await ctx.accueil();
    const nav = await ctx.navigateur().catch(() => null);
    const cgv = await ctx.pageLegale("cgv");
    const tous = nav ? liens(nav.html, nav.urlFinale) : home.liens;
    const pdf = tous.find((l) => /\.pdf($|\?)/i.test(l.href) && /cgv|conditions/i.test(l.href + " " + l.texte));
    const { fiches } = await ctx.fiches().catch(() => ({ fiches: [] as { texte: string; html: string }[] }));
    const tunnel = await ctx.tunnel().catch(() => null);
    const avantPaiement = fiches.some((f) => /conditions\s+(g[ée]n[ée]rales|particuli[èe]res|de\s+vente)|\bCGV\b/i.test(f.texte)) || !!tunnel?.liensCgv;
    if (!cgv) {
      if (pdf) return nonVerifiable("CGV publiées en PDF : contenu non analysé automatiquement, à vérifier par le CSM.", { url: pdf.href, texte: `CGV en PDF : ${pdf.href}.` });
      return { statut: "NON", texte: "Aucune page de CGV / conditions particulières de vente trouvée.", confiance: "moyenne", preuve: { texte: "Ni lien « CGV / Conditions de vente » ni page /cgv trouvés.", url: home.urlFinale } };
    }
    let ok = ELEMENTS_CGV.filter((_, i) => MOTIFS_CGV[i].test(cgv.texte));
    const ia = await elementsParIa(
      "Vérifie que ces conditions générales ou particulières de vente d'une agence de voyages respectent le Code du tourisme (articles L211-1 et suivants, R211-3 et suivants) pour les forfaits touristiques.",
      [{ titre: "Conditions de vente", url: cgv.urlFinale, texte: cgv.texte }],
      ELEMENTS_CGV,
    );
    if (ia) ok = ia.ok;
    const manquants = ELEMENTS_CGV.filter((e) => !ok.includes(e));
    const preuve = {
      texte: `Éléments trouvés : ${ok.length}/${ELEMENTS_CGV.length}${manquants.length ? ` (manquants : ${manquants.join(", ")})` : ""}. Lien vers les CGV ${avantPaiement ? "présent sur les fiches produits ou dans le tunnel" : "non trouvé sur les fiches produits"}.${ia?.remarque ? ` ${ia.remarque}` : ""}`,
      url: cgv.urlFinale, extrait: ia?.extraits.slice(0, 2).join(" · ") || extraitAutour(cgv.texte, /\b[LR]\.?\s?211-\d+|code\s+du\s+tourisme/i) || undefined,
      source: ia ? "Analyse Claude" : "Analyse par motifs",
    };
    // Résultat toujours « à confirmer par le CSM » : confiance moyenne au mieux
    if (manquants.length === 0 && avantPaiement) return { statut: "OUI", valeur: ok.length, texte: "CGV conformes en apparence et accessibles avant la réservation (à confirmer).", confiance: "moyenne", preuve };
    if (ok.length >= 4) return { statut: "PARTIELLEMENT", valeur: ok.length, texte: manquants.length ? `CGV incomplètes : ${manquants.slice(0, 3).join(", ")}.` : "CGV complètes mais lien absent des fiches produits.", confiance: "moyenne", preuve };
    return { statut: "NON", valeur: ok.length, texte: `CGV très incomplètes (${ok.length}/${ELEMENTS_CGV.length} éléments).`, confiance: "moyenne", preuve };
  },
};

// ───────── LEG-08 Authenticité des avis (Omnibus) ─────────

const WIDGETS_AVIS: [string, RegExp][] = [
  ["Avis Vérifiés", /avis-verifies|netreviews/i], ["Trustpilot", /trustpilot/i], ["Guest Suite", /guest-?suite/i], ["Custplace", /custplace/i],
  ["Google (widget)", /elfsight|trustindex|embedsocial|widget.*google.*review|grw-/i], ["Tripadvisor", /tripadvisor\.[a-z.]+\/(WidgetEmbed|img)/i], ["Feefo", /feefo/i], ["Opinion System", /opinionsystem|opinion-system/i],
];
const CERTIFIES = new Set(["Avis Vérifiés", "Trustpilot", "Guest Suite", "Custplace", "Feefo", "Opinion System"]);

export const LEG08: Detecteur = {
  critereId: "LEG-08",
  libelle: "Authenticité des avis affichés",
  async run(ctx) {
    const pages = await ctx.corpus();
    const html = pages.map((p) => p.html).join("\n");
    const texte = pages.map((p) => p.texte).join("\n");
    const widgets = WIDGETS_AVIS.filter(([, re]) => re.test(html)).map(([n]) => n);
    // Les étoiles des hôtels et le mot « témoignage » seul ne sont pas des avis clients
    const notes = /aggregateRating|ratingValue/i.test(html)
      || /avis\s+(de\s+nos\s+|des\s+)?(clients|voyageurs)|nos\s+(clients|voyageurs)\s+(t[ée]moignent|ont\s+aim[ée])|t[ée]moignages?\s+(de\s+nos\s+|des\s+)?(clients|voyageurs)|ils\s+nous\s+ont\s+fait\s+confiance/i.test(texte)
      || /\b[0-5][,.]\d\s?\/\s?5\b.{0,40}\bavis\b|\bavis\b.{0,40}\b[0-5][,.]\d\s?\/\s?5\b/i.test(texte);
    if (!widgets.length && !notes) return { statut: "N.A.", texte: "Aucun avis client affiché sur les pages analysées.", confiance: "moyenne", preuve: { texte: `${pages.length} page(s) analysée(s) : ni widget d'avis, ni notes, ni témoignages.`, url: pages[0].url } };
    const mention = /avis\s+v[ée]rifi[ée]s|v[ée]rifi[ée]s?\s+par|contr[ôo]l[ée]s?\s+(par|des\s+avis)|mod[ée]ration|authenticit[ée]|proc[ée]dure\s+de\s+contr[ôo]le|norme\s+NF\s?Z\s?74-501|ISO\s?20488/i;
    const avecMention = pages.find((p) => mention.test(p.texte));
    const preuve = { texte: `Avis affichés : ${widgets.length ? `widget ${widgets.join(", ")}` : "notes ou témoignages"}. Information sur le contrôle des avis : ${avecMention ? "présente" : "non trouvée"}.`, url: avecMention?.url ?? pages[0].url, extrait: avecMention ? extraitAutour(avecMention.texte, mention) ?? undefined : undefined };
    if (avecMention) return { statut: "OUI", texte: "Avis affichés avec une information sur leur contrôle.", confiance: "moyenne", preuve };
    if (widgets.some((w) => CERTIFIES.has(w))) return { statut: "PARTIELLEMENT", texte: `Avis gérés par ${widgets.find((w) => CERTIFIES.has(w))} (contrôle assuré par la plateforme), mais pas d'information visible sur le site.`, confiance: "moyenne", preuve };
    return { statut: "NON", texte: "Avis affichés sans information sur le contrôle de leur authenticité.", confiance: "moyenne", preuve };
  },
};

// ───────── LEG-09 Accessibilité (European Accessibility Act) ─────────

export const LEG09: Detecteur = {
  critereId: "LEG-09",
  libelle: "Accessibilité : déclaration et erreurs",
  navigateur: true,
  async run(ctx) {
    const home = await ctx.accueil();
    const nav = await ctx.navigateur().catch(() => null);
    const tous = nav ? liens(nav.html, nav.urlFinale) : home.liens;
    const lien = tous.find((l) => /accessibilit/i.test(l.texte + " " + l.href));
    const page = lien ? await ctx.get(lien.href) : null;
    const declaration = page && /d[ée]claration\s+d.accessibilit|[ée]tat\s+de\s+conformit|RGAA|WCAG|(partiellement|totalement|non)\s+conforme/i.test(page.texte) ? page : null;
    const a11y = nav?.accessibilite ?? null;
    const erreurs = a11y ? a11y.critiques + a11y.graves : null;
    const texteA11y = a11y ? `Audit automatique de l'accueil (axe-core, WCAG 2.1 AA) : ${a11y.critiques} erreur(s) critique(s), ${a11y.graves} grave(s)${a11y.regles.length ? ` (${a11y.regles.slice(0, 5).join(", ")})` : ""}.` : "Audit automatique axe-core non réalisé (navigateur indisponible).";
    const preuve = { texte: `Déclaration d'accessibilité : ${declaration ? "présente" : lien ? "lien trouvé mais page non reconnue comme une déclaration" : "absente"}. ${texteA11y} Exemption possible pour les micro-entreprises (moins de 10 salariés et 2 M€ de CA) : question au client.`, url: declaration?.urlFinale ?? lien?.href ?? home.urlFinale, extrait: declaration ? extraitAutour(declaration.texte, /(partiellement|totalement|non)\s+conforme|taux\s+de\s+conformit/i) ?? undefined : undefined, capture: a11y ? "accueil-ordinateur" : undefined };
    if (declaration) return { statut: erreurs !== null && erreurs > 20 ? "PARTIELLEMENT" : "OUI", valeur: erreurs, texte: `Déclaration d'accessibilité publiée${erreurs !== null ? ` ; ${erreurs} erreur(s) critiques ou graves sur l'accueil` : ""}.`, confiance: "moyenne", preuve };
    return { statut: "NON", valeur: erreurs, texte: `Pas de déclaration d'accessibilité${erreurs !== null ? ` ; ${erreurs} erreur(s) critiques ou graves sur l'accueil` : ""} (sauf exemption micro-entreprise, à confirmer par le client).`, confiance: "moyenne", preuve };
  },
};
