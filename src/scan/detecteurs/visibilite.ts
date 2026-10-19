import { statutFromSeuil } from "@/lib/audit/score";
import { liens, metaContent } from "../html";
import { nonVerifiable, type Detecteur } from "../types";

export const VIS07: Detecteur = {
  critereId: "VIS-07",
  libelle: "Indexation : robots.txt, sitemap, noindex",
  async run(ctx) {
    const home = await ctx.accueil();
    const origine = new URL(home.urlFinale).origin;
    const robots = await ctx.get(`${origine}/robots.txt`, "text/plain,*/*");
    const robotsTxt = robots && !/<html/i.test(robots.corps) ? robots.corps : "";
    // Blocage global pour tous les robots ?
    const blocs = robotsTxt.split(/\n(?=\s*user-agent)/i);
    const bloqueTout = blocs.some((b) => /user-agent:\s*\*/i.test(b) && /^\s*disallow:\s*\/\s*$/im.test(b));
    const metaRobots = metaContent(home.corps, "robots") ?? "";
    const noindex = /noindex/i.test(metaRobots) || /noindex/i.test(home.headers["x-robots-tag"] ?? "");
    const declares = [...robotsTxt.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1]);
    let sitemapUrl: string | null = null, nbUrls = 0, index = false;
    for (const u of [...declares, `${origine}/sitemap.xml`, `${origine}/sitemap_index.xml`].slice(0, 4)) {
      const s = await ctx.get(u, "application/xml,text/xml,*/*");
      if (!s || !/<(urlset|sitemapindex)/i.test(s.corps)) continue;
      sitemapUrl = s.urlFinale;
      index = /<sitemapindex/i.test(s.corps);
      if (index) {
        const enfants = [...s.corps.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)].map((m) => m[1]).slice(0, 3);
        for (const e of enfants) { const c = await ctx.get(e, "application/xml,*/*"); nbUrls += c ? (c.corps.match(/<url>/gi) ?? []).length : 0; }
      } else nbUrls = (s.corps.match(/<url>/gi) ?? []).length;
      break;
    }
    const texte = [
      `robots.txt : ${robotsTxt ? (bloqueTout ? "bloque tout le site" : "présent") : "absent"}.`,
      `Sitemap : ${sitemapUrl ? `${sitemapUrl} (${nbUrls}${index ? "+ " : " "}URL)` : "introuvable"}.`,
      `Page d'accueil : ${noindex ? "noindex (exclue de Google)" : "indexable"}.`,
      "Le nombre de pages produits réellement indexées (requête site:) n'est pas vérifié automatiquement.",
    ].join(" ");
    const preuve = { texte, url: sitemapUrl ?? `${origine}/robots.txt` };
    if (noindex || bloqueTout) return { statut: "NON", valeur: nbUrls, texte: noindex ? "La page d'accueil est exclue de Google (noindex)." : "robots.txt bloque l'exploration de tout le site.", confiance: "haute", preuve };
    if (!sitemapUrl || nbUrls === 0) return { statut: "PARTIELLEMENT", valeur: nbUrls, texte: "Site indexable mais sans sitemap exploitable.", confiance: "haute", preuve };
    return { statut: "OUI", valeur: nbUrls, texte: `Sitemap présent (${nbUrls}${index ? "+" : ""} URL), site indexable.`, confiance: "moyenne", preuve };
  },
};

// ───────── Google Business Profile et réseaux sociaux (lot 2) ─────────

const RESEAUX: [string, RegExp][] = [
  ["Facebook", /facebook\.com\/(?!sharer|share|dialog|tr\b|plugins)/i], ["Instagram", /instagram\.com\//i], ["LinkedIn", /linkedin\.com\/(company|in|school)\//i],
  ["TikTok", /tiktok\.com\/@/i], ["YouTube", /youtube\.com\/(channel|c\/|user|@)|youtu\.be\//i], ["Pinterest", /pinterest\.[a-z.]+\/(?!pin\/create)/i], ["X / Twitter", /(twitter|x)\.com\/(?!share|intent)[A-Za-z0-9_]+\/?$/i],
];
const LIEN_GOOGLE = /g\.page\/|maps\.google\.|google\.[a-z.]+\/maps|goo\.gl\/maps|maps\.app\.goo\.gl|business\.google\.com|google\.[a-z.]+\/search\?[^"']*(lrd=|ludocid)/i;

const fichePreuve = (f: { nom: string; adresse: string | null; urlMaps: string | null; correspondance: string }) =>
  `Fiche Google : ${f.nom}${f.adresse ? ` (${f.adresse})` : ""} — identifiée par ${f.correspondance === "place_id" ? "identifiant enregistré" : f.correspondance === "site" ? "site web identique" : "nom seul, à confirmer"}.`;

export const VIS01: Detecteur = {
  critereId: "VIS-01",
  libelle: "Site lié depuis Google et les réseaux sociaux",
  async run(ctx) {
    const home = await ctx.accueil();
    const nav = await ctx.navigateur().catch(() => null);
    const tous = nav ? liens(nav.html, nav.urlFinale) : home.liens;
    const reseaux = RESEAUX.filter(([, re]) => tous.some((l) => re.test(l.href))).map(([n]) => n);
    const lienGoogle = tous.find((l) => LIEN_GOOGLE.test(l.href));
    let place = null, erreur: string | null = null;
    try { place = await ctx.place(); } catch (e) { erreur = e instanceof Error ? e.message : "erreur"; }
    const siteSurFiche = place ? (() => { try { return !!place!.site && new URL(place!.site).hostname.endsWith(ctx.domaine); } catch { return false; } })() : null;
    const lignes = [
      `Réseaux sociaux liés depuis le site : ${reseaux.length ? reseaux.join(", ") : "aucun"}.`,
      `Lien vers la fiche Google depuis le site : ${lienGoogle ? "oui" : "non"}.`,
      place ? `${fichePreuve(place)} Site indiqué sur la fiche : ${place.site ?? "aucun"}.` : ctx.placesDisponible ? `Fiche Google introuvable${erreur ? ` (${erreur})` : ""}.` : "Fiche Google non consultée (clé Google Places non configurée).",
    ].join(" ");
    const preuve = { texte: lignes, url: place?.urlMaps ?? lienGoogle?.href ?? home.urlFinale, source: place ? "Google Places + page d'accueil" : "Page d'accueil" };
    const confiance = place && place.correspondance !== "nom" ? "haute" : "moyenne";
    if (place && siteSurFiche && reseaux.length) return { statut: "OUI", valeur: reseaux.length, texte: `Site indiqué sur la fiche Google et relié à ${reseaux.length} réseau(x) social(aux).`, confiance, preuve };
    if (place && !siteSurFiche) return { statut: reseaux.length ? "PARTIELLEMENT" : "NON", valeur: reseaux.length, texte: `La fiche Google n'indique pas le site${reseaux.length ? "" : " et aucun réseau social n'est lié"}.`, confiance: "moyenne", preuve };
    if (!place && !ctx.placesDisponible) {
      if (reseaux.length && lienGoogle) return { statut: "OUI", valeur: reseaux.length, texte: `Liens vers la fiche Google et ${reseaux.length} réseau(x) social(aux) ; fiche Google non consultée.`, confiance: "basse", preuve };
      return { statut: reseaux.length ? "PARTIELLEMENT" : "NON", valeur: reseaux.length, texte: reseaux.length ? `${reseaux.length} réseau(x) social(aux) lié(s) ; fiche Google à vérifier par le CSM.` : "Aucun lien vers les réseaux sociaux ni vers la fiche Google.", confiance: "basse", preuve };
    }
    return { statut: reseaux.length ? "PARTIELLEMENT" : "NON", valeur: reseaux.length, texte: reseaux.length ? "Réseaux sociaux liés, mais fiche Google introuvable ou sans le site." : "Ni fiche Google reliée au site, ni réseau social.", confiance: "moyenne", preuve };
  },
};

export const VIS02: Detecteur = {
  critereId: "VIS-02",
  libelle: "Fiche Google : note ≥ 4,3 et ≥ 50 avis",
  async run(ctx) {
    if (!ctx.placesDisponible) return nonVerifiable("Clé Google Places non configurée : note et nombre d'avis à relever par le CSM.");
    const place = await ctx.place();
    if (!place) return nonVerifiable("Fiche Google Business Profile introuvable : à identifier par le CSM.");
    const texteFiche = `${place.note !== null ? `${String(place.note).replace(".", ",")}/5` : "pas de note"} sur ${place.nbAvis} avis.`;
    const preuve = { texte: `${fichePreuve(place)} ${texteFiche}`, url: place.urlMaps ?? undefined, source: "Google Places" };
    const confiance = place.correspondance === "nom" ? "basse" : "haute";
    if (place.note === null) return { statut: "NON", valeur: null, texte: "Fiche Google sans note (aucun avis).", confiance, preuve };
    let statut = statutFromSeuil(place.note, { sens: "↑", seuilPlein: 4.3, seuilMoitie: 4.0 });
    if (statut === "OUI" && place.nbAvis < 50) statut = "PARTIELLEMENT";
    return { statut, valeur: place.note, texte: `Fiche Google : ${texteFiche}${place.nbAvis < 50 ? " Moins de 50 avis." : ""}`, confiance, preuve };
  },
};

export const VIS03: Detecteur = {
  critereId: "VIS-03",
  libelle: "Réponse aux avis Google",
  async run(ctx) {
    if (!ctx.placesDisponible) return nonVerifiable("Clé Google Places non configurée : réponses aux avis à vérifier par le CSM.");
    const place = await ctx.place().catch(() => null);
    if (!place) return nonVerifiable("Fiche Google Business Profile introuvable : à identifier par le CSM.");
    // L'API Google Places ne renvoie pas les réponses du propriétaire : vérification manuelle
    const recents = place.avis.filter((a) => a.date && Date.parse(a.date) > Date.now() - 183 * 86400_000).length;
    return nonVerifiable(`Réponses du propriétaire non fournies par l'API Google : à vérifier sur la fiche (${place.avis.length} avis renvoyés par l'API, dont ${recents} de moins de 6 mois).`, { url: place.urlMaps ?? undefined, texte: `${fichePreuve(place)} L'API Google Places (5 avis maximum) n'indique pas si le propriétaire a répondu : ouvrir la fiche pour compter les réponses sur 6 mois.`, source: "Google Places" });
  },
};
