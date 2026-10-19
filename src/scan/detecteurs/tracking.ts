import { recuperer } from "../fetcher";
import type { Detecteur } from "../types";

const uniq = <T,>(a: T[]) => [...new Set(a)];

/** Identifiants Google trouvés dans le HTML, les requêtes réseau et le conteneur GTM. */
async function balises(ctx: Parameters<Detecteur["run"]>[0]) {
  const home = await ctx.accueil();
  const nav = await ctx.navigateur().catch(() => null);
  const html = nav?.html ?? home.corps;
  const sources = [html, ...(nav?.requetes ?? [])].join("\n");
  const gtm = uniq([...sources.matchAll(/GTM-[A-Z0-9]{4,10}/g)].map((m) => m[0]));
  let ga4 = uniq([...sources.matchAll(/\bG-(?=[A-Z0-9]*[A-Z])[A-Z0-9]{8,12}\b/g)].map((m) => m[0]));
  let viaGtm = false;
  // GA4 souvent configuré dans le conteneur GTM : on lit le conteneur public
  if (!ga4.length && gtm.length) {
    try {
      const r = await recuperer(`https://www.googletagmanager.com/gtm.js?id=${gtm[0]}`, { accept: "*/*" });
      const ids = uniq([...r.corps.matchAll(/\bG-(?=[A-Z0-9]*[A-Z])[A-Z0-9]{8,12}\b/g)].map((m) => m[0]));
      if (ids.length) { ga4 = ids; viaGtm = true; }
    } catch { /* conteneur inaccessible */ }
  }
  const hitsGa = (nav?.requetes ?? []).filter((u) => /google-analytics\.com\/g\/collect|analytics\.google\.com\/g\/collect/.test(u));
  return { home, nav, gtm, ga4, viaGtm, hitsGa };
}

export const TRK01: Detecteur = {
  critereId: "TRK-01",
  libelle: "Google Analytics 4",
  navigateur: true,
  async run(ctx) {
    const b = await balises(ctx);
    if (b.ga4.length) {
      const texte = `GA4 en place : ${b.ga4.join(", ")}${b.viaGtm ? ` (configuré dans le conteneur ${b.gtm[0]})` : ""}.`;
      return { statut: "OUI", texte, confiance: "haute", preuve: { texte, url: b.home.urlFinale, requete: b.hitsGa[0] } };
    }
    const texte = "Aucun identifiant Google Analytics 4 (G-…) trouvé dans la page, le conteneur GTM ou les requêtes.";
    // GA peut n'être chargé qu'après consentement : confiance moyenne
    return { statut: "NON", texte, confiance: b.nav ? "moyenne" : "basse", preuve: { texte: texte + (b.gtm.length ? "" : " Aucun Google Tag Manager non plus."), url: b.home.urlFinale } };
  },
};

export const TRK03: Detecteur = {
  critereId: "TRK-03",
  libelle: "Google Tag Manager",
  async run(ctx) {
    const b = await balises(ctx);
    if (b.gtm.length) {
      const texte = `Google Tag Manager en place : ${b.gtm.join(", ")}.`;
      return { statut: "OUI", texte, confiance: "haute", preuve: { texte, url: b.home.urlFinale, requete: (b.nav?.requetes ?? []).find((u) => u.includes("gtm.js")) } };
    }
    const texte = "Aucun conteneur Google Tag Manager (GTM-…) trouvé.";
    return { statut: "NON", texte, confiance: b.nav ? "haute" : "moyenne", preuve: { texte, url: b.home.urlFinale } };
  },
};

export const TRK04: Detecteur = {
  critereId: "TRK-04",
  libelle: "Google Consent Mode v2",
  navigateur: true,
  async run(ctx) {
    const b = await balises(ctx);
    if (!b.gtm.length && !b.ga4.length && !/googletagmanager|google-analytics|googleadservices|doubleclick/.test(b.nav?.html ?? b.home.corps))
      return { statut: "N.A.", texte: "Aucune balise Google détectée : Consent Mode sans objet.", confiance: "moyenne", preuve: { texte: "Ni GTM, ni GA4, ni balise Google Ads trouvés.", url: b.home.urlFinale } };
    const defauts = (b.nav?.consentement ?? []).filter((c) => c[1] === "default");
    const v2 = defauts.some((c) => { const o = c[2] as Record<string, unknown> | undefined; return !!o && "ad_user_data" in o && "ad_personalization" in o; });
    const hitsGcs = (b.nav?.requetes ?? []).filter((u) => /[?&](gcs|gcd)=/.test(u));
    if (v2 || (defauts.length && hitsGcs.some((u) => /[?&]gcd=/.test(u)))) {
      const texte = "Consent Mode v2 actif : valeurs par défaut déclarées avant toute interaction (ad_user_data, ad_personalization).";
      return { statut: "OUI", texte, confiance: "haute", preuve: { texte, extrait: JSON.stringify(defauts[0]).slice(0, 300), requete: hitsGcs[0] } };
    }
    if (defauts.length || hitsGcs.length) {
      const texte = "Consent Mode présent mais pas en version 2 (paramètres ad_user_data / ad_personalization absents).";
      return { statut: "PARTIELLEMENT", texte, confiance: "haute", preuve: { texte, extrait: defauts[0] ? JSON.stringify(defauts[0]).slice(0, 300) : undefined, requete: hitsGcs[0] } };
    }
    if (!b.nav) {
      const statique = /['"]consent['"]\s*,\s*['"]default['"]/.test(b.home.corps);
      return { statut: statique ? "PARTIELLEMENT" : null, texte: statique ? "Appel gtag('consent','default') présent dans le code (version non vérifiée sans navigateur)." : "Consent Mode non vérifiable sans navigateur.", confiance: "basse", preuve: { texte: "Contrôle statique du HTML uniquement.", url: b.home.urlFinale } };
    }
    const texte = "Balises Google présentes, mais aucun signal Consent Mode avant interaction.";
    return { statut: "NON", texte, confiance: "haute", preuve: { texte, url: b.home.urlFinale } };
  },
};

/** Code des balises : page rendue, requêtes réseau, conteneur GTM public (lu une seule fois). */
async function codeBalises(ctx: Parameters<Detecteur["run"]>[0]) {
  const b = await balises(ctx);
  const conteneurs = await Promise.all(b.gtm.slice(0, 2).map((id) => ctx.get(`https://www.googletagmanager.com/gtm.js?id=${id}`, "*/*").catch(() => null)));
  const fiches = (await ctx.fiches().catch(() => ({ fiches: [] as { evenements: string[]; html: string }[] }))).fiches;
  const page = [b.nav?.html ?? b.home.corps, ...(b.nav?.requetes ?? [])].join("\n");
  const gtm = conteneurs.map((c) => c?.corps ?? "").join("\n");
  return { ...b, code: `${page}\n${gtm}`, page, gtm, fiches };
}

export const TRK02: Detecteur = {
  critereId: "TRK-02",
  libelle: "Événement d'achat GA4 avec la valeur du dossier",
  navigateur: true,
  async run(ctx) {
    const b = await codeBalises(ctx);
    if (!b.ga4.length) return { statut: "NON", texte: "Pas de Google Analytics 4 : aucun événement d'achat ne peut être remonté.", confiance: b.nav ? "moyenne" : "basse", preuve: { texte: "Aucun identifiant GA4 trouvé (voir TRK-01).", url: b.home.urlFinale } };
    const evenements = uniq([...(b.nav?.evenements ?? []), ...b.fiches.flatMap((f) => f.evenements)]);
    const ecommerce = evenements.filter((e) => /view_item|select_item|add_to_cart|begin_checkout|purchase/i.test(e));
    // Le code de la bibliothèque Google contient toujours « purchase » : on cherche une balise configurée
    const purchaseCode = /vtp_eventName["']?\s*[:,]\s*["']purchase["']/.test(b.gtm)
      || /['"]event['"]\s*:\s*['"]purchase['"]|gtag\(\s*['"]event['"]\s*,\s*['"]purchase['"]/.test(b.page);
    const texte = [
      `GA4 en place (${b.ga4.join(", ")}).`,
      ecommerce.length ? `Événements e-commerce observés : ${ecommerce.join(", ")}.` : "Aucun événement e-commerce observé sur l'accueil et les fiches.",
      purchaseCode ? "Un événement « purchase » est configuré dans le code ou le conteneur GTM." : "",
      "L'événement d'achat ne s'observe que sur la page de confirmation, jamais atteinte par le scan : à confirmer par le CSM dans GA4 (Monétisation > Achats e-commerce).",
    ].filter(Boolean).join(" ");
    // Sans réservation test, le scan ne peut pas conclure : proposition « à confirmer » seulement
    return { statut: purchaseCode || ecommerce.length ? "PARTIELLEMENT" : null, texte: purchaseCode ? "Suivi e-commerce GA4 configuré ; achat avec valeur à confirmer par le CSM." : ecommerce.length ? "Suivi e-commerce GA4 partiel ; achat à confirmer par le CSM." : "Événement d'achat GA4 non vérifiable sans réservation : à confirmer par le CSM.", confiance: "basse", preuve: { texte, url: b.home.urlFinale } };
  },
};

export const TRK05: Detecteur = {
  critereId: "TRK-05",
  libelle: "Pixels publicitaires Meta et Google Ads",
  navigateur: true,
  async run(ctx) {
    const b = await codeBalises(ctx);
    const meta = /connect\.facebook\.net\/[^"'\s]+\/fbevents\.js|fbq\(\s*['"]init|facebook\.com\/tr[/?]/i.test(b.code);
    const ids = uniq([...b.code.matchAll(/\bAW-\d{6,12}\b/g)].map((m) => m[0]));
    const ads = ids.length > 0 || /googleads\.g\.doubleclick\.net|googleadservices\.com\/pagead\/conversion|google\.com\/ccm\/collect|ad\.doubleclick\.net\/ccm/i.test(b.code);
    const autres = [["TikTok", /analytics\.tiktok\.com|ttq\.load/i], ["Microsoft Ads", /bat\.bing\.com/i], ["LinkedIn", /snap\.licdn\.com|px\.ads\.linkedin/i], ["Pinterest", /ct\.pinterest\.com|pintrk\(/i]].filter(([, re]) => (re as RegExp).test(b.code)).map(([n]) => n as string);
    const texte = [
      `Pixel Meta : ${meta ? "présent" : "absent"}.`,
      `Google Ads : ${ads ? `présent${ids.length ? ` (${ids.join(", ")})` : ""}` : "absent"}.`,
      autres.length ? `Autres pixels : ${autres.join(", ")}.` : "",
      "L'API Conversions de Meta (côté serveur) n'est pas détectable : question au client.",
    ].filter(Boolean).join(" ");
    const preuve = { texte, url: b.home.urlFinale, requete: (b.nav?.requetes ?? []).find((u) => /facebook\.com\/tr|googleadservices|doubleclick/.test(u)) };
    if (meta && ads) return { statut: "OUI", texte: "Pixels Meta et Google Ads en place (API Conversions à confirmer par le client).", confiance: "moyenne", preuve };
    if (meta || ads) return { statut: "PARTIELLEMENT", texte: `Seul le pixel ${meta ? "Meta" : "Google Ads"} est en place.`, confiance: "moyenne", preuve };
    return { statut: "NON", texte: "Aucun pixel publicitaire (Meta, Google Ads) : sans objet si le client ne fait pas de campagnes.", confiance: b.nav ? "moyenne" : "basse", preuve };
  },
};
