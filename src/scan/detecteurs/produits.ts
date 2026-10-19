import { z } from "zod";
import { analyserIa, iaDisponible } from "../ia";
import { extraitAutour } from "../html";
import { BLOCS, cleFiche, dateDansUrl, datesDansTexte, donneesStructurees, imagesContenu, ressemblanceTitres, similarite, type Fiche } from "../produits";
import { nonVerifiable, type Detecteur, type Resultat } from "../types";
import type { ScanContext } from "../context";

const court = (u: string) => { try { const x = new URL(u); return x.pathname.length > 60 ? `${x.pathname.slice(0, 57)}…` : x.pathname; } catch { return u; } };
const AUCUNE_FICHE = "Aucune fiche produit trouvée depuis la page d'accueil (ni dans la première page de résultats).";

async function fichesOuRien(ctx: ScanContext) {
  const { fiches, source } = await ctx.fiches();
  return { fiches, source, home: await ctx.accueil() };
}

// ───────── VIS-08 Données structurées ─────────

const TYPES_PRODUIT = /^(Product|Offer|AggregateOffer|TouristTrip|Trip|Event|TouristDestination|Hotel|LodgingBusiness|Vacation)$/;

export const VIS08: Detecteur = {
  critereId: "VIS-08",
  libelle: "Données structurées sur les fiches produits",
  async run(ctx) {
    const { fiches, source, home } = await fichesOuRien(ctx);
    if (!fiches.length) return nonVerifiable(AUCUNE_FICHE, { url: home.urlFinale });
    const res = fiches.map((f) => ({ f, d: donneesStructurees(f.html) }));
    const ok = res.filter((r) => r.d.types.some((t) => TYPES_PRODUIT.test(t)) && r.d.prix);
    const lignes = res.map((r) => `${court(r.f.url)} : ${r.d.types.length ? r.d.types.slice(0, 5).join(", ") : "aucune donnée structurée"}${r.d.prix ? " (avec prix)" : ""}`);
    const preuve = { texte: `Fiches analysées (${source}) : ${lignes.join(" · ")}.`, url: fiches[0].url };
    if (ok.length === fiches.length) return { statut: "OUI", valeur: ok.length, texte: `Données structurées produit avec prix sur les ${fiches.length} fiches analysées.`, confiance: "haute", preuve };
    if (ok.length || res.some((r) => r.d.types.some((t) => TYPES_PRODUIT.test(t)))) return { statut: "PARTIELLEMENT", valeur: ok.length, texte: `Données structurées produit incomplètes (${ok.length}/${fiches.length} fiches avec type produit et prix).`, confiance: "haute", preuve };
    return { statut: "NON", valeur: 0, texte: `Aucune donnée structurée produit (schema.org Product / Offer / TouristTrip) sur les ${fiches.length} fiches analysées.`, confiance: "haute", preuve };
  },
};

// ───────── PROD-03 / PROD-04 Qualité des fiches ─────────

export interface QualiteFiche {
  url: string;
  photosHd: number | null;
  photos: number;
  longueur: number;
  blocsManquants: string[];
  similariteMax: number;
  generique: string | null;
  conforme: boolean;
}

const SchemaGenerique = z.object({
  fiches: z.array(z.object({
    numero: z.number().int().describe("Numéro du document analysé (1, 2, 3…)"),
    texte_generique: z.boolean().describe("true si le descriptif semble repris tel quel d'un catalogue de tour-opérateur ou d'un flux, sans personnalisation par l'agence"),
    qualite: z.enum(["bonne", "moyenne", "faible"]).describe("Qualité rédactionnelle et commerciale du descriptif pour un internaute"),
    raison: z.string().describe("Une phrase factuelle justifiant l'évaluation"),
  })),
});

/** Évalue la qualité de fiches produits (photos HD, longueur, blocs, unicité). */
export async function qualiteFiches(fiches: Fiche[]): Promise<{ details: QualiteFiche[]; ia: boolean }> {
  const details: QualiteFiche[] = fiches.map((f, i) => {
    const imgs = imagesContenu(f.images);
    const hd = f.rendue || imgs.some((x) => x.largeur !== null) ? imgs.filter((x) => (x.largeur ?? 0) >= 1200).length : null;
    const sims = fiches.filter((_, j) => j !== i).map((g) => similarite(f.textePropre, g.textePropre));
    return {
      url: f.url,
      photosHd: hd,
      photos: imgs.length,
      longueur: f.textePropre.length,
      blocsManquants: BLOCS.filter(([, re]) => !re.test(f.textePropre)).map(([n]) => n),
      similariteMax: sims.length ? Math.max(...sims) : 0,
      generique: null,
      conforme: false,
    };
  });
  let ia = false;
  if (iaDisponible() && fiches.length) {
    try {
      const r = await analyserIa({
        outil: "evaluer_fiches",
        schema: SchemaGenerique,
        consigne: "Voici les descriptifs de fiches produits d'une agence de voyages. Pour chacun, indique si le texte paraît générique (repris d'un catalogue de tour-opérateur sans personnalisation) et évalue sa qualité pour un internaute.",
        documents: fiches.map((f, i) => ({ titre: `${i + 1}. ${f.titre}`, url: f.url, texte: f.textePropre })),
        maxCaracteres: 24_000,
      });
      for (const x of r.fiches) {
        const d = details[x.numero - 1];
        if (d && (x.texte_generique || x.qualite === "faible")) d.generique = x.raison;
      }
      ia = true;
    } catch { /* analyse par motifs seule */ }
  }
  for (const d of details) d.conforme = (d.photosHd === null || d.photosHd >= 5) && d.longueur >= 1500 && d.blocsManquants.length === 0 && d.similariteMax < 0.3 && !d.generique;
  return { details, ia };
}

function resumeQualite(d: QualiteFiche): string {
  const pb: string[] = [];
  if (d.photosHd !== null && d.photosHd < 5) pb.push(`${d.photosHd} photo(s) HD ≥ 1 200 px sur ${d.photos}`);
  if (d.longueur < 1500) pb.push(`descriptif de ${d.longueur} caractères`);
  if (d.blocsManquants.length) pb.push(`blocs manquants : ${d.blocsManquants.join(", ")}`);
  if (d.similariteMax >= 0.3) pb.push(`texte similaire à ${Math.round(d.similariteMax * 100)} % à une autre fiche`);
  if (d.generique) pb.push(`texte générique (${d.generique})`);
  return `${court(d.url)} : ${pb.length ? pb.join(" ; ") : "conforme"}`;
}

function resultatQualite(details: QualiteFiche[], ia: boolean, rendues: boolean, intro: string): Resultat {
  const ok = details.filter((d) => d.conforme).length;
  const texteDetails = details.map(resumeQualite).join(" · ");
  const preuve = { texte: `${intro} ${texteDetails}.${ia ? "" : " Unicité évaluée par comparaison des textes (analyse par Claude non disponible)."}${rendues ? "" : " Largeur réelle des photos non mesurée sans navigateur."}`, url: details[0]?.url, source: ia ? "Analyse Claude + mesures" : "Mesures automatiques" };
  const confiance = rendues ? "moyenne" : "basse";
  if (ok === details.length) return { statut: "OUI", valeur: ok, texte: `Les ${details.length} fiches analysées sont complètes (photos HD, textes uniques, tous les blocs).`, confiance, preuve };
  const principal = details.find((d) => !d.conforme)!;
  const raison = principal.photosHd !== null && principal.photosHd < 5 ? "photos HD insuffisantes" : principal.longueur < 1500 ? "descriptifs trop courts" : principal.blocsManquants.length ? `bloc « ${principal.blocsManquants[0]} » absent` : "textes peu personnalisés";
  if (ok > 0) return { statut: "PARTIELLEMENT", valeur: ok, texte: `${ok}/${details.length} fiches conformes (${raison}).`, confiance, preuve };
  if (details.every((d) => d.blocsManquants.length === 0 && d.longueur >= 1500)) return { statut: "PARTIELLEMENT", valeur: 0, texte: `Fiches complètes et détaillées, mais ${raison}.`, confiance, preuve };
  return { statut: "NON", valeur: 0, texte: `Aucune des ${details.length} fiches n'est conforme (${raison}).`, confiance, preuve };
}

export const PROD03: Detecteur = {
  critereId: "PROD-03",
  libelle: "Qualité des 3 premières fiches",
  navigateur: true,
  async run(ctx) {
    const { fiches, source, home } = await fichesOuRien(ctx);
    if (!fiches.length) return nonVerifiable(AUCUNE_FICHE, { url: home.urlFinale });
    const { details, ia } = await qualiteFiches(fiches);
    return resultatQualite(details, ia, fiches.every((f) => f.rendue), `Fiches de la ${source} :`);
  },
};

export const PROD04: Detecteur = {
  critereId: "PROD-04",
  libelle: "Top ventes : photos HD et textes uniques",
  navigateur: true,
  async run(ctx) {
    const top = ctx.donnees.topVentes ?? [];
    if (!top.length) return nonVerifiable("Top ventes indisponible (aucun nom de voyage dans les dossiers importés) : à vérifier par le CSM.");
    const { liens } = await ctx.liensProduits();
    const trouves: { voyage: string; href: string }[] = [];
    for (const t of top.slice(0, 5)) {
      const best = liens.map((l) => ({ l, s: Math.max(ressemblanceTitres(t.voyage, l.texte), ressemblanceTitres(t.voyage, decodeURIComponent(l.href.split("/").slice(-4).join(" ")).replace(/-/g, " "))) })).sort((a, b) => b.s - a.s)[0];
      if (best && best.s >= 0.6 && !trouves.some((x) => x.href === best.l.href)) trouves.push({ voyage: t.voyage, href: best.l.href });
    }
    const liste = top.slice(0, 5).map((t) => `« ${t.voyage} » (${t.nb})`).join(", ");
    if (!trouves.length) return nonVerifiable(`Aucun des 5 produits les plus vendus n'a été retrouvé dans les fiches liées depuis l'accueil : à vérifier par le CSM.`, { texte: `Top ventes 12 mois : ${liste}.` });
    const fiches = await ctx.analyserFiches(trouves.map((t) => t.href));
    if (!fiches.length) return nonVerifiable("Fiches des top ventes inaccessibles.");
    const { details, ia } = await qualiteFiches(fiches);
    const attendus = Math.min(5, top.length);
    const r = resultatQualite(details, ia, fiches.every((f) => f.rendue), `Top ventes 12 mois : ${liste}. Retrouvés sur le site : ${trouves.length}/${attendus}.`);
    return trouves.length < attendus ? { ...r, confiance: "basse", texte: `${r.texte} (${trouves.length}/${attendus} top ventes retrouvés sur le site)` } : r;
  },
};

// ───────── PROD-09 Offres expirées ─────────

/** « Complet » au sens « plus de place » (pas « centre complet » ni « programme complet »). */
const COMPLET = /(d[ée]part|date|s[ée]jour|voyage|circuit|croisi[èe]re|offre)s?\s+(est\s+|sont\s+)?complets?\b|^\s*complet\s*!?\s*$|c.est\s+complet|plus\s+de\s+places?\b|aucune\s+(place|disponibilit)|plus\s+de\s+disponibilit|[ée]puis[ée]|sold\s?out/im;

export const PROD09: Detecteur = {
  critereId: "PROD-09",
  libelle: "Aucune offre expirée",
  async run(ctx) {
    const { liens, source } = await ctx.liensProduits();
    const { fiches } = await ctx.fiches();
    const home = await ctx.accueil();
    if (!liens.length) return nonVerifiable(AUCUNE_FICHE, { url: home.urlFinale });
    const aujourdhui = new Date(); aujourdhui.setUTCHours(0, 0, 0, 0);
    const expiresLiens = liens.filter((l) => { const d = dateDansUrl(l.href); return d && d < aujourdhui; });
    const fichesPassees = fiches.filter((f) => {
      const ds = [...datesDansTexte(f.textePropre), ...(dateDansUrl(f.url) ? [dateDansUrl(f.url)!] : [])];
      return ds.length > 0 && ds.every((d) => d < aujourdhui);
    });
    const complet = fiches.filter((f) => COMPLET.test(f.textePropre));
    const lignes = [
      `${liens.length} offre(s) liée(s) (${source}) dont ${expiresLiens.length} avec une date de départ passée${expiresLiens.length ? ` (ex. ${court(expiresLiens[0].href)})` : ""}.`,
      `${fiches.length} fiche(s) ouvertes : ${fichesPassees.length} sans départ futur, ${complet.length} affichant « complet » ou « aucune disponibilité ».`,
    ].join(" ");
    const preuve = { texte: lignes, url: expiresLiens[0]?.href ?? fichesPassees[0]?.url ?? complet[0]?.url ?? fiches[0]?.url ?? home.urlFinale, extrait: complet[0] ? extraitAutour(complet[0].textePropre, COMPLET) ?? undefined : undefined };
    const expirees = new Set([...expiresLiens.map((l) => cleFiche(l.href)), ...fichesPassees.map((f) => cleFiche(f.url))]).size;
    if (expirees) return { statut: "NON", valeur: expirees, texte: `${expirees} offre(s) expirée(s) encore en avant.`, confiance: "moyenne", preuve };
    if (complet.length) return { statut: "PARTIELLEMENT", valeur: complet.length, texte: `${complet.length} fiche(s) mise(s) en avant sans disponibilité.`, confiance: "moyenne", preuve };
    return { statut: "OUI", valeur: 0, texte: "Aucune offre expirée ou sans départ parmi les offres de la page d'accueil.", confiance: "moyenne", preuve };
  },
};

// ───────── LEG-07 Prix TTC et promotions (Omnibus) ─────────

/** Réduction affichée : « au lieu de 628 € », « -20 % », « prix barré » (pas « taxe de promotion touristique »). */
const PROMO = /au\s+lieu\s+de\s+\d[\d\s.,]*\s?€|(^|\s)-\s?\d{1,2}\s?%|prix\s+barr[ée]|\bpromo(tion)?s?\b(?!\s+touristique)(?=.{0,40}\d\s?(€|%))/im;
const REFERENCE_30J = /prix\s+(de\s+r[ée]f[ée]rence|le\s+plus\s+bas|ant[ée]rieur)|30\s+(derniers\s+)?jours\s+pr[ée]c[ée]dent|au\s+cours\s+des\s+30\s+(derniers\s+)?jours/i;

export const LEG07: Detecteur = {
  critereId: "LEG-07",
  libelle: "Prix TTC et promotions (Omnibus)",
  async run(ctx) {
    const { fiches, home } = await fichesOuRien(ctx);
    if (!fiches.length) return nonVerifiable(AUCUNE_FICHE, { url: home.urlFinale });
    const nav = await ctx.navigateur().catch(() => null);
    const tunnel = await ctx.tunnel().catch(() => null);
    const promos = fiches.filter((f) => f.prixBarres.length > 0 || PROMO.test(f.textePropre));
    const avecReference = promos.filter((f) => REFERENCE_30J.test(f.texte));
    const ttc = fiches.filter((f) => /\bTTC\b|toutes taxes|taxes (et frais )?incluses|frais (de dossier )?inclus/i.test(f.texte));
    const homePromo = nav ? PROMO.test(nav.texte) : false;
    const lignes = [
      `Mention TTC / frais inclus sur ${ttc.length}/${fiches.length} fiches.`,
      promos.length ? `${promos.length} fiche(s) avec promotion ou prix barré, dont ${avecReference.length} avec mention du prix de référence (30 jours).` : `Aucun prix barré sur les fiches analysées${homePromo ? " (promotions annoncées sur l'accueil)" : ""}.`,
      tunnel?.prixAffiches.length ? `Premier prix affiché dans le tunnel : ${tunnel.prixAffiches[0]}.` : "Cohérence avec le prix du tunnel (frais obligatoires inclus) : à vérifier par le CSM.",
    ].join(" ");
    const preuve = { texte: lignes, url: promos[0]?.url ?? fiches[0].url, extrait: promos[0]?.prixBarres[0] ? `Prix barré : ${promos[0].prixBarres[0]}` : undefined };
    if (promos.length > avecReference.length) return { statut: "NON", texte: "Prix barrés sans mention du prix de référence sur 30 jours (directive Omnibus).", confiance: "moyenne", preuve };
    if (ttc.length < fiches.length) return { statut: "PARTIELLEMENT", texte: `Mention TTC absente sur ${fiches.length - ttc.length} fiche(s) ; frais obligatoires à vérifier dans le tunnel.`, confiance: "basse", preuve };
    return { statut: "OUI", texte: `Prix affichés TTC${promos.length ? ", promotions avec prix de référence" : ""} ; inclusion des frais obligatoires à confirmer par le CSM.`, confiance: "basse", preuve };
  },
};

// ───────── LEG-03 Formulaire d'information standard ─────────

const FIS = /formulaire\s+d.information\s+standard|(directive|\(UE\))\s*(\(UE\)\s*)?2015\/2302|2015\/2302/i;

export const LEG03: Detecteur = {
  critereId: "LEG-03",
  libelle: "Formulaire d'information standard",
  async run(ctx) {
    const { fiches, home } = await fichesOuRien(ctx);
    const tunnel = await ctx.tunnel().catch(() => null);
    const cgv = await ctx.pageLegale("cgv").catch(() => null);
    const surFiche = fiches.find((f) => FIS.test(f.texte) || /formulaire[-_]?d?[-_]?information/i.test(f.html));
    const dansTunnel = tunnel && FIS.test(tunnel.texte);
    const dansCgv = cgv && FIS.test(cgv.texte);
    const preuveUrl = surFiche?.url ?? cgv?.urlFinale ?? fiches[0]?.url ?? home.urlFinale;
    const extrait = surFiche ? extraitAutour(surFiche.texte, FIS) : dansCgv ? extraitAutour(cgv!.texte, FIS) : null;
    const lieux = [surFiche && "fiche produit", dansTunnel && "tunnel", dansCgv && "CGV"].filter(Boolean).join(", ");
    const preuve = { texte: `Formulaire d'information standard ${lieux ? `trouvé : ${lieux}` : "non trouvé"} (${fiches.length} fiche(s)${tunnel ? ", tunnel" : ""}${cgv ? ", CGV" : ""} analysés).`, url: preuveUrl, extrait: extrait ?? undefined };
    if (surFiche || dansTunnel) return { statut: "OUI", texte: `Formulaire d'information standard présenté avant la réservation (${lieux}).`, confiance: "moyenne", preuve };
    if (!fiches.length && !cgv) return nonVerifiable("Ni fiche produit ni CGV trouvées : formulaire d'information standard non vérifiable.", { url: home.urlFinale });
    if (dansCgv) return { statut: "PARTIELLEMENT", texte: "Formulaire d'information standard seulement dans les CGV : il doit être présenté avant la réservation.", confiance: "moyenne", preuve };
    return { statut: "NON", texte: "Formulaire d'information standard (directive (UE) 2015/2302) non trouvé.", confiance: ctx.tunnelActive ? "moyenne" : "basse", preuve };
  },
};
