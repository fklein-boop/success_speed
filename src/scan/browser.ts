import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { USER_AGENT, verifierUrl } from "./fetcher";

/**
 * Collecte par navigateur headless (Playwright / Chromium), si disponible.
 * Contexte vierge, AUCUNE interaction : on ne clique sur rien, on ne remplit rien,
 * on ne soumet aucun formulaire. On observe la page telle qu'un visiteur la reçoit.
 */
export interface DonneesNavigateur {
  urlFinale: string;
  html: string;
  /** Texte visible (innerText) de la page d'accueil */
  texte: string;
  cookies: { name: string; domain: string }[];
  requetes: string[];
  consentement: unknown[][];
  boutonRefuser: string | null;
  boutonAccepter: string | null;
  cmpDom: string | null;
  mobile: { largeurPage: number; largeurEcran: number; debordement: boolean } | null;
  /** Événements poussés dans le dataLayer (noms), pour le suivi e-commerce */
  evenements: string[];
  /** Audit axe-core de la page d'accueil (WCAG 2.1 A/AA) */
  accessibilite: { critiques: number; graves: number; regles: string[] } | null;
  captures: { nom: string; data: string }[];
  dureeMs: number;
}

/** Script injecté avant le chargement : enregistre les appels gtag / dataLayer (Consent Mode, événements). */
const ESPION_CONSENTEMENT = `(() => {
  window.__srConsent = []; window.__srEvents = [];
  const noter = (x) => { try {
    if (x && typeof x === 'object' && !('length' in x) && typeof x.event === 'string' && window.__srEvents.length < 50) window.__srEvents.push(x.event);
    const a = Array.from(x); if (a[0] === 'consent') window.__srConsent.push(JSON.parse(JSON.stringify(a)));
    if (a[0] === 'event' && typeof a[1] === 'string' && window.__srEvents.length < 50) window.__srEvents.push(a[1]);
  } catch (e) {} };
  const brancher = (arr) => { if (!arr || arr.__srHook) return arr; const p = arr.push.bind(arr); arr.push = function () { for (const x of arguments) noter(x); return p.apply(null, arguments); }; arr.__srHook = true; for (const x of arr) noter(x); return arr; };
  let dl = brancher([]);
  Object.defineProperty(window, 'dataLayer', { configurable: true, get() { return dl; }, set(v) { dl = brancher(v); } });
})();`;

/** Recherche des boutons de la bannière cookies, y compris dans les shadow DOM ouverts. */
const LIRE_BOUTONS = `(() => {
  const refus = /(tout refuser|refuser tout|je refuse|refuser|continuer sans accepter|non merci|reject all|decline|deny)/i;
  const accept = /(tout accepter|accepter tout|j'accepte|accepter|accept all|ok pour moi|j.ai compris)/i;
  const vus = []; const visite = (root) => {
    for (const el of root.querySelectorAll('button, a, [role=button], input[type=button]')) {
      const t = (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().replace(/\\s+/g, ' ');
      const r = el.getBoundingClientRect();
      if (t && t.length < 60 && r.width > 0 && r.height > 0) vus.push(t);
    }
    for (const el of root.querySelectorAll('*')) if (el.shadowRoot) visite(el.shadowRoot);
  };
  visite(document);
  const cmps = { axeptio: '#axeptio_overlay, [class*=axeptio]', didomi: '#didomi-host, #didomi-popup', onetrust: '#onetrust-banner-sdk', cookiebot: '#CybotCookiebotDialog', tarteaucitron: '#tarteaucitronRoot', sirdata: '#sd-cmp, [id^=sd-cmp]', usercentrics: '#usercentrics-root', iubenda: '.iubenda-cs-container', complianz: '.cmplz-cookiebanner', cookieyes: '.cky-consent-container', quantcast: '.qc-cmp2-container' };
  let cmp = null; for (const [n, s] of Object.entries(cmps)) if (document.querySelector(s)) { cmp = n; break; }
  return { refuser: vus.find((t) => refus.test(t)) || null, accepter: vus.find((t) => accept.test(t)) || null, cmp };
})()`;

let indisponible: string | null = null;

let sourceAxe: string | null = null;
function axe(): string | null {
  if (sourceAxe !== null) return sourceAxe || null;
  try { sourceAxe = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8"); } catch { sourceAxe = ""; }
  return sourceAxe || null;
}

/** Lance axe-core (WCAG 2.1 A/AA) dans la page et compte les violations critiques et graves. */
async function auditAccessibilite(page: import("playwright").Page): Promise<DonneesNavigateur["accessibilite"]> {
  const src = axe();
  if (!src) return null;
  try {
    await page.addScriptTag({ content: src });
    const r = (await page.evaluate(`axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, resultTypes: ['violations'] })
      .then((r) => r.violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length })))`)) as { id: string; impact: string; n: number }[];
    const critiques = r.filter((v) => v.impact === "critical").reduce((a, v) => a + v.n, 0);
    const graves = r.filter((v) => v.impact === "serious").reduce((a, v) => a + v.n, 0);
    return { critiques, graves, regles: r.filter((v) => v.impact === "critical" || v.impact === "serious").map((v) => v.id).slice(0, 8) };
  } catch { return null; }
}

export async function navigateurDisponible(): Promise<boolean> {
  if (process.env.SCAN_NAVIGATEUR === "non") return false;
  if (indisponible) return false;
  try {
    const { chromium } = await import("playwright");
    const b = await chromium.launch({ headless: true });
    await b.close();
    return true;
  } catch (e) {
    indisponible = e instanceof Error ? e.message.split("\n")[0] : "indisponible";
    return false;
  }
}

export async function collecterNavigateur(url: string): Promise<DonneesNavigateur> {
  const debut = Date.now();
  await verifierUrl(url);
  const { chromium } = await import("playwright");
  const navigateur = await chromium.launch({ headless: true });
  try {
    const ua = `${USER_AGENT.replace("compatible; ", "")} Chrome/131.0 Safari/537.36`;
    // 1. Desktop, contexte vierge : cookies et requêtes AVANT toute interaction
    const ctx = await navigateur.newContext({ userAgent: ua, locale: "fr-FR", viewport: { width: 1366, height: 900 } });
    await ctx.addInitScript(ESPION_CONSENTEMENT);
    const page = await ctx.newPage();
    const requetes: string[] = [];
    page.on("request", (r) => { if (requetes.length < 800) requetes.push(r.url()); });
    // On bloque toute soumission de formulaire, par sécurité
    await page.route("**/*", (route) => (route.request().method() === "POST" && route.request().resourceType() === "document" ? route.abort() : route.continue()));
    await page.goto(url, { waitUntil: "load", timeout: 30000 });
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(2500);
    // Contrôle SSRF de l'URL finale
    await verifierUrl(page.url());
    const boutons = (await page.evaluate(LIRE_BOUTONS).catch(() => ({ refuser: null, accepter: null, cmp: null }))) as { refuser: string | null; accepter: string | null; cmp: string | null };
    // Bannières dans des iframes (certaines CMP)
    for (const f of page.frames().slice(1, 6)) {
      if (boutons.refuser) break;
      const b = (await f.evaluate(LIRE_BOUTONS).catch(() => null)) as typeof boutons | null;
      if (b?.refuser) boutons.refuser = b.refuser;
    }
    const consentement = (await page.evaluate("window.__srConsent || []").catch(() => [])) as unknown[][];
    const evenements = (await page.evaluate("window.__srEvents || []").catch(() => [])) as string[];
    const cookies = (await ctx.cookies()).map((c) => ({ name: c.name, domain: c.domain }));
    const html = await page.content();
    const texte = (await page.evaluate("document.body ? document.body.innerText : ''").catch(() => "")) as string;
    const captures: DonneesNavigateur["captures"] = [];
    captures.push({ nom: "accueil-ordinateur", data: (await page.screenshot({ type: "jpeg", quality: 55 })).toString("base64") });
    const urlFinale = page.url();
    const accessibilite = await auditAccessibilite(page);
    await ctx.close();

    // 2. Mobile 390 px : débordement horizontal et capture
    let mobile: DonneesNavigateur["mobile"] = null;
    try {
      const m = await navigateur.newContext({ userAgent: `${ua} Mobile`, locale: "fr-FR", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
      const p = await m.newPage();
      await p.goto(urlFinale, { waitUntil: "load", timeout: 30000 });
      await p.waitForTimeout(2000);
      // Débordement réel : la page peut-elle défiler horizontalement ?
      const l = (await p.evaluate("(() => { window.scrollTo(2000, 0); const x = window.scrollX; window.scrollTo(0, 0); return { page: document.documentElement.scrollWidth, ecran: window.innerWidth, x }; })()")) as { page: number; ecran: number; x: number };
      mobile = { largeurPage: Math.round(l.ecran + l.x), largeurEcran: l.ecran, debordement: l.x > 4 };
      captures.push({ nom: "accueil-mobile", data: (await p.screenshot({ type: "jpeg", quality: 50, scale: "css" })).toString("base64") });
      await m.close();
    } catch { /* mobile facultatif */ }

    return {
      urlFinale, html, texte, cookies, requetes, consentement,
      boutonRefuser: boutons.refuser, boutonAccepter: boutons.accepter, cmpDom: boutons.cmp,
      mobile, evenements, accessibilite, captures, dureeMs: Date.now() - debut,
    };
  } finally {
    await navigateur.close();
  }
}

export interface PageRendue {
  url: string;
  urlFinale: string;
  html: string;
  texte: string;
  titre: string;
  /** Images chargées : source et largeur naturelle (px) */
  images: { src: string; largeur: number }[];
  /** Textes des prix barrés (promotions) */
  prixBarres: string[];
  evenements: string[];
  liens: { href: string; texte: string }[];
}

/** Lecture de la page côté navigateur : images réelles, prix barrés, liens rendus par JavaScript. */
const LIRE_PAGE = `(() => {
  const vus = new Set(); const images = [];
  for (const i of document.images) { if (!i.currentSrc || vus.has(i.currentSrc)) continue; vus.add(i.currentSrc); images.push({ src: i.currentSrc, largeur: i.naturalWidth }); }
  const barres = [...document.querySelectorAll('del, s, strike, [class*=barre], [class*=old-price], [class*=price-old], [class*=oldprice], [class*=strike], [class*=crossed]')]
    .map((e) => (e.innerText || '').trim()).filter((t) => /\d/.test(t) && t.length < 40).slice(0, 10);
  const liens = [...document.querySelectorAll('a[href]')].map((a) => ({ href: a.href, texte: (a.innerText || a.title || '').trim().replace(/\s+/g, ' ').slice(0, 200) }));
  return { images, prixBarres: barres, liens, texte: document.body ? document.body.innerText : '', titre: document.title };
})()`;

/**
 * Rend plusieurs pages du même site dans un seul navigateur (fiches produits, page de résultats).
 * Aucune interaction : on fait défiler la page pour charger les images, sans cliquer ni saisir.
 */
export async function rendrePages(urls: string[]): Promise<PageRendue[]> {
  const { chromium } = await import("playwright");
  const navigateur = await chromium.launch({ headless: true });
  const out: PageRendue[] = [];
  try {
    const ctx = await navigateur.newContext({ userAgent: `${USER_AGENT.replace("compatible; ", "")} Chrome/131.0 Safari/537.36`, locale: "fr-FR", viewport: { width: 1366, height: 900 } });
    await ctx.addInitScript(ESPION_CONSENTEMENT);
    await ctx.route("**/*", (route) => (route.request().method() === "POST" && route.request().resourceType() === "document" ? route.abort() : route.continue()));
    for (const url of urls) {
      try {
        await verifierUrl(url);
        const page = await ctx.newPage();
        await page.goto(url, { waitUntil: "load", timeout: 30000 });
        await page.waitForLoadState("networkidle", { timeout: 6000 }).catch(() => {});
        // Défilement progressif pour déclencher le chargement différé des images
        await page.evaluate(`(async () => { for (let y = 0; y < document.body.scrollHeight && y < 20000; y += 800) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); } window.scrollTo(0, 0); })()`).catch(() => {});
        await page.waitForTimeout(1200);
        await verifierUrl(page.url());
        const l = (await page.evaluate(LIRE_PAGE)) as Omit<PageRendue, "url" | "urlFinale" | "html" | "evenements">;
        const evenements = (await page.evaluate("window.__srEvents || []").catch(() => [])) as string[];
        out.push({ url, urlFinale: page.url(), html: await page.content(), evenements, ...l });
        await page.close();
      } catch { /* page suivante */ }
    }
  } finally {
    await navigateur.close();
  }
  return out;
}

// ───────── Parcours du tunnel de réservation (PERF-01, LEG-03, LEG-04, LEG-07, PERF-14) ─────────

export interface ResultatTunnel {
  etapes: { url: string; action: string }[];
  /** Raison de l'arrêt du parcours */
  arret: string;
  assurance: { proposee: boolean; visible: boolean; extrait: string | null };
  /** Texte visible de chaque étape parcourue (hors fiche de départ) */
  texte: string;
  prixAffiches: string[];
  liensCgv: boolean;
  requetesBloquees: number;
  capture: string | null;
}

/** Boutons autorisés : avancer dans le tunnel (dates, participants, options). */
const CLIC_AUTORISE = /^(devis\s*\/\s*)?r[ée]serv(er|ation|ez)\b|^voir (tous )?les (tarifs|dates|prix|disponibilit)|^continuer\b|^[ée]tape suivante|^suivant\b|^choisir\b|^s[ée]lectionner\b|^valider$/i;
/** Jamais : paiement, confirmation, envoi, compte, contact. */
const CLIC_INTERDIT = /pa(yer|iement)|confirm|command|envoy|souscri|inscri|newsletter|information|contact|connexion|identifi|compte|mot de passe|valider (ma|la|votre|le|mon) |rappel|devis gratuit|demande de devis|imprimer|partag|mail/i;
/** Requêtes non-GET autorisées sur le site : lectures de prix, disponibilités, recherche. */
const POST_SUR = /(price|prix|tarif|search|load|availability|dispo|calendar|calendrier|video|photo|stat)/i;
const POST_RISQUE = /(book|reserv|devis|quotation|quote|order|commande|panier|cart|checkout|paiement|payment|\bpay|contact|ask|mail|message|lead|subscribe|newsletter|customer|client|account|compte|save|create|insert|submit)/i;
const POST_TIERS_OK = /google-analytics|analytics\.google|googletagmanager|doubleclick|facebook\.com\/tr|clarity\.ms|hotjar|axept|didomi|consent|cookiebot|onetrust/i;

const LIRE_ETAPE = `(() => {
  const visible = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const champsPerso = [...document.querySelectorAll('input[type=text], input[type=email], input[type=tel], input[type=password], input:not([type]), textarea')].filter(visible).filter((e) => !/search|recherche|q$/i.test(e.name || ''));
  const paiement = !!document.querySelector('input[autocomplete^=cc-], input[name*=card i], iframe[src*=payzen], iframe[src*=stripe], iframe[src*=adyen], iframe[src*=paybox], iframe[src*=systempay], iframe[src*=monetico], iframe[src*=lyra]');
  // Assurance : un libellé « assurance / annulation / rapatriement » à côté d'une case, d'un bouton radio ou d'une liste
  let assurance = null;
  for (const e of document.querySelectorAll('label, li, tr, div, p, td, span, h2, h3, h4')) {
    if (!visible(e)) continue;
    const t = (e.innerText || '').trim();
    if (t.length > 300 || !/assurance|multirisque|rapatriement|garantie annulation/i.test(t)) continue;
    let p = e; let choix = null;
    for (let i = 0; i < 4 && p && !choix; i++) { choix = p.querySelector('input[type=checkbox], input[type=radio], select, button'); p = p.parentElement; }
    if (!choix) continue;
    window.scrollTo(0, 0);
    const r = e.getBoundingClientRect();
    assurance = { extrait: t.replace(/\\s+/g, ' ').slice(0, 160), visible: r.top + window.scrollY < window.innerHeight };
    break;
  }
  const prix = [...document.body.innerText.matchAll(/\\d[\\d\\s.]*(,\\d{2})?\\s?€/g)].map((m) => m[0].trim()).slice(0, 8);
  const cgv = [...document.querySelectorAll('a[href]')].some((a) => /cgv|conditions/i.test(a.href + ' ' + a.innerText));
  const candidats = [...document.querySelectorAll('a, button, input[type=submit], input[type=button], [role=button], .button')]
    .filter(visible)
    .map((e, i) => {
      e.setAttribute('data-sr-clic', String(i));
      const texte = (e.innerText || e.value || e.getAttribute('aria-label') || '').trim().replace(/\\s+/g, ' ');
      const form = e.closest('form, [role=dialog], .reveal, .modal, .popin');
      const formPerso = form ? [...form.querySelectorAll('input[type=text], input[type=email], input[type=tel], input[type=password], textarea')].some(visible) : false;
      const href = e.getAttribute('href') || '';
      return { i, texte, formPerso, externe: /^https?:/i.test(href) && !href.includes(location.hostname) };
    });
  return { url: location.href, texte: document.body.innerText, champsPerso: champsPerso.map((e) => (e.form ? (e.form.getAttribute('action') || '') : '') + '#' + (e.name || e.id || e.type)), paiement, assurance, prix, cgv, candidats };
})()`;

interface EtatEtape {
  url: string; texte: string; champsPerso: string[]; paiement: boolean;
  assurance: { extrait: string; visible: boolean } | null; prix: string[]; cgv: boolean;
  candidats: { i: number; texte: string; formPerso: boolean; externe: boolean }[];
}

/**
 * Parcours prudent du tunnel depuis une fiche produit, jusqu'à l'étape des options :
 * - aucune saisie au clavier, aucun champ rempli ;
 * - seuls des boutons « Réserver / Voir les tarifs / Continuer / Choisir » sont cliqués ;
 * - arrêt immédiat dès qu'une étape demande des coordonnées ou un paiement ;
 * - toute requête d'écriture (réservation, devis, commande, contact, paiement) est bloquée au niveau réseau.
 */
export async function parcourirTunnel(urlFiche: string, maxClics = 5): Promise<ResultatTunnel> {
  await verifierUrl(urlFiche);
  const hoteSite = new URL(urlFiche).hostname.split(".").slice(-2).join(".");
  const { chromium } = await import("playwright");
  const navigateur = await chromium.launch({ headless: true });
  let bloquees = 0;
  const out: ResultatTunnel = { etapes: [], arret: "", assurance: { proposee: false, visible: false, extrait: null }, texte: "", prixAffiches: [], liensCgv: false, requetesBloquees: 0, capture: null };
  try {
    const ctx = await navigateur.newContext({ userAgent: `${USER_AGENT.replace("compatible; ", "")} Chrome/131.0 Safari/537.36`, locale: "fr-FR", viewport: { width: 1366, height: 900 } });
    await ctx.route("**/*", (route) => {
      const r = route.request();
      if (r.method() === "GET" || r.method() === "HEAD" || r.method() === "OPTIONS") return route.continue();
      const u = r.url();
      const memeSite = (() => { try { return new URL(u).hostname.endsWith(hoteSite); } catch { return false; } })();
      const ok = r.resourceType() !== "document" && (memeSite ? POST_SUR.test(u) && !POST_RISQUE.test(u) : POST_TIERS_OK.test(u));
      if (ok) return route.continue();
      bloquees++;
      return route.abort();
    });
    const page = await ctx.newPage();
    page.on("dialog", (d) => void d.dismiss().catch(() => {}));
    await page.goto(urlFiche, { waitUntil: "load", timeout: 30000 });
    await page.waitForLoadState("networkidle", { timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(1000);
    const cliques = new Set<string>();
    // Champs déjà présents sur la fiche (formulaire « Demande d'informations ») : ignorés
    let champsFiche = new Set<string>();
    for (let n = 0; n <= maxClics; n++) {
      await verifierUrl(page.url());
      const e = (await page.evaluate(LIRE_ETAPE)) as EtatEtape;
      if (n === 0) champsFiche = new Set(e.champsPerso);
      const nouveauxChamps = e.champsPerso.filter((c) => !champsFiche.has(c) || e.url.split("?")[0] !== urlFiche.split("?")[0]);
      if (n > 0) { out.texte += `\n${e.texte}`; out.prixAffiches.push(...e.prix); out.liensCgv ||= e.cgv; }
      if (e.assurance && n > 0) { out.assurance = { proposee: true, visible: e.assurance.visible, extrait: e.assurance.extrait }; out.arret = "Étape des options atteinte."; break; }
      if (e.paiement) { out.arret = "Étape de paiement atteinte : arrêt."; break; }
      if (n > 0 && nouveauxChamps.length > 0) { out.arret = "Étape des coordonnées atteinte : arrêt, aucune saisie."; break; }
      if (n === maxClics) { out.arret = `Arrêt après ${maxClics} clics.`; break; }
      const c = e.candidats.find((x) => CLIC_AUTORISE.test(x.texte) && !CLIC_INTERDIT.test(x.texte) && !x.formPerso && !x.externe && !cliques.has(`${x.texte}#${x.i}`))
        ?? null;
      if (!c) { out.arret = n === 0 ? "Aucun bouton de réservation reconnu sur la fiche." : "Plus de bouton pour avancer dans le tunnel."; break; }
      cliques.add(`${c.texte}#${c.i}`);
      const el = page.locator(`[data-sr-clic="${c.i}"]`).first();
      await el.click({ timeout: 5000 }).catch(() => null);
      out.etapes.push({ url: page.url(), action: c.texte.slice(0, 60) });
      await page.waitForLoadState("networkidle", { timeout: 6000 }).catch(() => {});
      await page.waitForTimeout(1500);
    }
    out.capture = (await page.screenshot({ type: "jpeg", quality: 55 }).catch(() => null))?.toString("base64") ?? null;
  } finally {
    out.requetesBloquees = bloquees;
    await navigateur.close();
  }
  return out;
}
