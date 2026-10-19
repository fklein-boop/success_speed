import { nonVerifiable, type Detecteur } from "../types";

const s = (ms?: number) => (ms === undefined ? "—" : `${(ms / 1000).toFixed(1).replace(".", ",")} s`);

export const PERF10: Detecteur = {
  critereId: "PERF-10",
  libelle: "Core Web Vitals mobile",
  async run(ctx) {
    let ps;
    try { ps = await ctx.pagespeed(); } catch (e) { return nonVerifiable(`PageSpeed Insights indisponible : ${e instanceof Error ? e.message : "erreur"}.`, { source: "PageSpeed Insights" }); }
    if (!ps) return nonVerifiable("PageSpeed Insights indisponible.");
    const src = { source: "PageSpeed Insights (mobile)", url: `https://pagespeed.web.dev/analysis?url=${encodeURIComponent(ps.url)}&form_factor=mobile` };
    if (ps.terrain) {
      const t = ps.terrain;
      const ok = [t.lcp !== undefined && t.lcp <= 2500, t.inp !== undefined && t.inp <= 200, t.cls !== undefined && t.cls <= 0.1];
      const n = ok.filter(Boolean).length;
      const texte = `Données terrain (utilisateurs Chrome, 28 j) : LCP ${s(t.lcp)}, INP ${t.inp ?? "—"} ms, CLS ${t.cls?.toFixed(2).replace(".", ",") ?? "—"}.`;
      return { statut: n === 3 ? "OUI" : n === 2 ? "PARTIELLEMENT" : "NON", valeur: n, texte: n === 3 ? "Core Web Vitals au vert." : `${3 - n} indicateur(s) sur 3 hors des seuils.`, confiance: "haute", preuve: { texte, ...src } };
    }
    // Pas assez de trafic pour des données terrain : mesures de laboratoire (TBT comme approximation de l'INP)
    const l = ps.labo;
    const ok = [l.lcp !== undefined && l.lcp <= 2500, l.tbt !== undefined && l.tbt <= 200, l.cls !== undefined && l.cls <= 0.1];
    const n = ok.filter(Boolean).length;
    const texte = `Pas de données terrain ; mesures de laboratoire : LCP ${s(l.lcp)}, TBT ${l.tbt === undefined ? "—" : Math.round(l.tbt)} ms (approximation de l'INP), CLS ${l.cls?.toFixed(2).replace(".", ",") ?? "—"}.`;
    return { statut: n === 3 ? "OUI" : n === 2 ? "PARTIELLEMENT" : "NON", valeur: n, texte: `Mesures de laboratoire : ${n}/3 indicateurs au vert.`, confiance: "moyenne", preuve: { texte, ...src } };
  },
};

export const PERF11: Detecteur = {
  critereId: "PERF-11",
  libelle: "Score PageSpeed mobile",
  async run(ctx) {
    let ps;
    try { ps = await ctx.pagespeed(); } catch (e) { return nonVerifiable(`PageSpeed Insights indisponible : ${e instanceof Error ? e.message : "erreur"}.`, { source: "PageSpeed Insights" }); }
    if (!ps || ps.score === null) return nonVerifiable("Score PageSpeed indisponible.");
    const texte = `Score de performance mobile : ${ps.score}/100 (page d'accueil).`;
    return {
      statut: ps.score >= 70 ? "OUI" : ps.score >= 50 ? "PARTIELLEMENT" : "NON", valeur: ps.score, texte,
      confiance: "haute",
      preuve: { texte: `${texte} La moyenne avec une fiche produit arrive au lot 2.`, source: "PageSpeed Insights (mobile)", url: `https://pagespeed.web.dev/analysis?url=${encodeURIComponent(ps.url)}&form_factor=mobile` },
    };
  },
};

// ───────── PERF-01 Assurance dans le tunnel ─────────

export const PERF01: Detecteur = {
  critereId: "PERF-01",
  libelle: "Assurance proposée dans le tunnel",
  navigateur: true,
  async run(ctx) {
    if (!ctx.avecNavigateur) return nonVerifiable("Parcours du tunnel impossible sans navigateur : à vérifier par le CSM.");
    if (!ctx.tunnelActive) return nonVerifiable("Parcours automatique du tunnel désactivé (SCAN_TUNNEL) : assurance à vérifier par le CSM sur une fiche produit.");
    const { fiches } = await ctx.fiches();
    if (!fiches.length) return nonVerifiable("Aucune fiche produit trouvée : tunnel non parcouru.");
    const t = await ctx.tunnel();
    if (!t) return nonVerifiable("Tunnel non parcouru.");
    const etapes = t.etapes.map((e) => `« ${e.action} »`).join(" → ") || "aucune";
    const preuve = { texte: `Depuis ${fiches[0].url} : clics ${etapes}. ${t.arret}${t.assurance.extrait ? ` Libellé : « ${t.assurance.extrait} ».` : ""} ${t.requetesBloquees} requête(s) d'écriture bloquée(s) par sécurité.`, url: fiches[0].url, capture: t.capture ? "tunnel" : undefined };
    if (t.assurance.proposee) return { statut: t.assurance.visible ? "OUI" : "PARTIELLEMENT", texte: t.assurance.visible ? "Assurance proposée et visible dès l'étape des options." : "Assurance proposée, mais sous la ligne de flottaison.", confiance: "moyenne", preuve };
    if (/coordonn|paiement/.test(t.arret)) return { statut: "NON", texte: "Aucune assurance proposée avant l'étape des coordonnées.", confiance: "basse", preuve };
    return nonVerifiable(`Étape des options non atteinte (${t.arret.replace(/\.$/, "").toLowerCase()}) : à vérifier par le CSM.`, preuve);
  },
};

// ───────── PERF-14 Moyens de paiement modernes ─────────

const FRACTIONNE = /\b(alma|oney|floa|klarna|younited|cofidis\s+pay|scalapay|pledg)\b|paiement\s+en\s+(2|3|4|10|plusieurs)\s*(fois|x)|\b[34]\s?x\s+sans\s+frais|en\s+(3|4)\s+fois\s+sans\s+frais/i;
const PORTEFEUILLE = /apple\s?pay|google\s?pay|paypal|lydia/i;
const ACOMPTE = /\bacompte\b|\barrhes\b|paiement\s+(partiel|[ée]chelonn[ée])/i;

export const PERF14: Detecteur = {
  critereId: "PERF-14",
  libelle: "Moyens de paiement modernes",
  async run(ctx) {
    const pages = await ctx.corpus();
    const tunnel = await ctx.tunnel().catch(() => null);
    const sources = [...pages.map((p) => ({ url: p.url, t: `${p.texte}\n${p.html.match(/<script[^>]+src=["'][^"']+/gi)?.join(" ") ?? ""}` })), ...(tunnel ? [{ url: "tunnel", t: tunnel.texte }] : [])];
    const cherche = (re: RegExp) => sources.find((s) => re.test(s.t));
    const f = cherche(FRACTIONNE), w = cherche(PORTEFEUILLE), a = cherche(ACOMPTE);
    const nom = (s: typeof f, re: RegExp) => (s ? `oui (${s.t.match(re)?.[0].trim()})` : "non trouvé");
    const preuve = { texte: `Paiement en plusieurs fois : ${nom(f, FRACTIONNE)}. Apple Pay / Google Pay / PayPal : ${nom(w, PORTEFEUILLE)}. Acompte : ${nom(a, ACOMPTE)}. Analyse : accueil, fiches, pages légales${tunnel ? ", tunnel" : ""} (sans aller jusqu'au paiement).`, url: (f ?? w ?? a)?.url !== "tunnel" ? (f ?? w ?? a)?.url : undefined };
    const n = [f, w, a].filter(Boolean).length;
    const confiance = tunnel ? "moyenne" : "basse";
    if (n === 3) return { statut: "OUI", valeur: n, texte: "Paiement en plusieurs fois, portefeuille mobile et acompte proposés.", confiance, preuve };
    if (n > 0) return { statut: "PARTIELLEMENT", valeur: n, texte: `${n}/3 moyens modernes repérés${f ? "" : " ; pas de paiement en plusieurs fois"}.`, confiance, preuve };
    return { statut: "NON", valeur: 0, texte: "Aucun moyen de paiement moderne repéré (plusieurs fois, Apple/Google Pay, acompte).", confiance: "basse", preuve };
  },
};
