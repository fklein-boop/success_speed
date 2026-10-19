import empreintesDefaut from "../../../config/empreintes.json";
import { statutFromSeuil } from "@/lib/audit/score";
import { recuperer } from "../fetcher";
import { ressources, scriptsEtIframes } from "../html";
import { nonVerifiable, type Detecteur } from "../types";

const JOUR = 86_400_000;
const fr = (d: Date) => d.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" });

export const TECH01: Detecteur = {
  critereId: "TECH-01",
  libelle: "Certificat HTTPS et redirection",
  async run(ctx) {
    let cert;
    try { cert = await ctx.certificat(); } catch (e) {
      return { statut: "NON", texte: "Le site ne répond pas en HTTPS.", confiance: "haute", preuve: { texte: `Connexion TLS impossible sur ${ctx.host}:443 (${e instanceof Error ? e.message : "erreur"})` } };
    }
    let redirige: boolean | null = null;
    try {
      const r = await recuperer(`http://${ctx.host}/`, { maxRedirections: 4 });
      redirige = r.urlFinale.startsWith("https://");
    } catch { redirige = null; }
    const jours = cert.expire ? Math.floor((cert.expire.getTime() - Date.now()) / JOUR) : null;
    const preuve = `Certificat ${cert.autorise ? "valide" : `invalide (${cert.erreur})`}${cert.emetteur ? `, émis par ${cert.emetteur}` : ""}${cert.expire ? `, expire le ${fr(cert.expire)} (dans ${jours} j)` : ""}. Redirection http → https : ${redirige === null ? "non vérifiée" : redirige ? "oui" : "non"}.`;
    if (!cert.autorise) return { statut: "NON", valeur: jours, texte: "Certificat HTTPS invalide.", confiance: "haute", preuve: { texte: preuve, url: `https://${ctx.host}/` } };
    if (jours !== null && jours <= 30) return { statut: "PARTIELLEMENT", valeur: jours, texte: `Certificat valide mais expire dans ${jours} jours.`, confiance: "haute", preuve: { texte: preuve } };
    if (redirige === false) return { statut: "PARTIELLEMENT", valeur: jours, texte: "Certificat valide, mais la version http ne redirige pas vers https.", confiance: "haute", preuve: { texte: preuve, url: `http://${ctx.host}/` } };
    return { statut: "OUI", valeur: jours, texte: `HTTPS en place, certificat valide encore ${jours} jours.`, confiance: redirige === null ? "moyenne" : "haute", preuve: { texte: preuve } };
  },
};

export const TECH02: Detecteur = {
  critereId: "TECH-02",
  libelle: "Expiration du nom de domaine (RDAP)",
  async run(ctx) {
    let r;
    try { r = await ctx.rdap(); } catch (e) { return nonVerifiable(`Registre RDAP indisponible pour ${ctx.domaine} (${e instanceof Error ? e.message : "erreur"}).`, { source: "RDAP" }); }
    if (!r.expiration) return nonVerifiable(`Le registre ne publie pas la date d'expiration de ${ctx.domaine}.`, { url: r.url, source: "RDAP" });
    const jours = Math.floor((r.expiration.getTime() - Date.now()) / JOUR);
    const texte = `${ctx.domaine} expire le ${fr(r.expiration)} (dans ${jours} j)${r.registrar ? `, bureau d'enregistrement ${r.registrar}` : ""}.`;
    return { statut: jours > 60 ? "OUI" : "NON", valeur: jours, texte, confiance: "haute", preuve: { texte, url: r.url, source: "RDAP" } };
  },
};

const SELECTEURS_DKIM = ["google", "default", "selector1", "selector2", "k1", "k2", "mail", "dkim", "s1", "s2", "mailjet", "mandrill", "sendinblue", "brevo", "smtp", "ovh"];

export const TECH03: Detecteur = {
  critereId: "TECH-03",
  libelle: "Authentification des emails (SPF, DMARC, DKIM)",
  async run(ctx) {
    const d = ctx.domaine;
    const [txt, dmarcTxt] = await Promise.all([ctx.txt(d), ctx.txt(`_dmarc.${d}`)]);
    if (txt === null || dmarcTxt === null) return nonVerifiable("Serveurs DNS injoignables.", { source: "DNS" });
    const spf = txt.find((t) => /^v=spf1/i.test(t)) ?? null;
    const dmarc = dmarcTxt.find((t) => /^v=DMARC1/i.test(t)) ?? null;
    const politique = dmarc?.match(/;\s*p=(\w+)/i)?.[1]?.toLowerCase() ?? null;
    let dkim: string | null = null;
    for (const s of SELECTEURS_DKIM) {
      const r = await ctx.txt(`${s}._domainkey.${d}`);
      if (r?.some((t) => /v=DKIM1|k=rsa|p=/i.test(t))) { dkim = s; break; }
    }
    const texte = `SPF : ${spf ? "présent" : "absent"} · DMARC : ${dmarc ? `présent (p=${politique})` : "absent"} · DKIM : ${dkim ? `trouvé (sélecteur « ${dkim} »)` : "non trouvé parmi les sélecteurs courants (non vérifiable)"}.`;
    const preuve = { texte, extrait: [spf, dmarc].filter(Boolean).join(" | "), source: `DNS ${d}` };
    // Pas de DKIM trouvé ≠ NON (sélecteur inconnu) : on baisse la confiance
    const confiance = dkim ? "haute" as const : "moyenne" as const;
    if (!spf || !dmarc) return { statut: "NON", texte: `Emails du domaine mal authentifiés : ${!spf ? "SPF" : ""}${!spf && !dmarc ? " et " : ""}${!dmarc ? "DMARC" : ""} absent${!spf && !dmarc ? "s" : ""}.`, confiance, preuve };
    if (politique === "quarantine" || politique === "reject") return { statut: "OUI", texte: `SPF et DMARC (p=${politique}) en place.`, confiance, preuve };
    return { statut: "PARTIELLEMENT", texte: "SPF présent, DMARC en simple surveillance (p=none).", confiance, preuve };
  },
};

export const TECH05: Detecteur = {
  critereId: "TECH-05",
  libelle: "Site adapté au mobile",
  navigateur: true,
  async run(ctx) {
    const home = await ctx.accueil();
    const viewport = /<meta[^>]+name\s*=\s*["']viewport["'][^>]*width\s*=\s*device-width/i.test(home.corps);
    const nav = await ctx.navigateur().catch(() => null);
    if (!viewport) return { statut: "NON", texte: "Pas de balise viewport : le site n'est pas conçu pour le mobile.", confiance: "haute", preuve: { texte: "Balise <meta name=\"viewport\" content=\"width=device-width…\"> absente de la page d'accueil.", url: home.urlFinale } };
    if (!nav?.mobile) return { statut: "OUI", texte: "Balise viewport présente (rendu mobile non contrôlé sans navigateur).", confiance: "moyenne", preuve: { texte: "Balise viewport width=device-width présente.", url: home.urlFinale } };
    const m = nav.mobile;
    const texte = `Rendu à 390 px : largeur de page ${m.largeurPage} px pour un écran de ${m.largeurEcran} px${m.debordement ? " — défilement horizontal" : ", sans défilement horizontal"}.`;
    return { statut: m.debordement ? "PARTIELLEMENT" : "OUI", texte: m.debordement ? "Viewport présent, mais la page déborde horizontalement sur mobile." : "Site adapté au mobile.", confiance: "haute", preuve: { texte, url: nav.urlFinale, capture: "accueil-mobile" } };
  },
};

interface Empreinte { nom: string; motif: string; force?: string }

export function chercherEmpreintes(sources: string[], liste: Empreinte[]) {
  const trouvees: { e: Empreinte; ou: string }[] = [];
  for (const e of liste) {
    const m = e.motif.toLowerCase();
    const ou = sources.find((s) => s.toLowerCase().includes(m));
    if (ou) trouvees.push({ e, ou: ou.length > 160 ? (() => { const i = ou.toLowerCase().indexOf(m); return `…${ou.slice(Math.max(0, i - 60), i + m.length + 60)}…`; })() : ou });
  }
  return trouvees;
}

export const TECH06: Detecteur = {
  critereId: "TECH-06",
  libelle: "Module SpeedResa présent, aucun concurrent",
  navigateur: true,
  async run(ctx) {
    const home = await ctx.accueil();
    const nav = await ctx.navigateur().catch(() => null);
    const html = nav?.html ?? home.corps;
    const sources = [...ressources(html, home.urlFinale), ...home.liens.map((l) => l.href), ...(nav?.requetes ?? []), html];
    const empreintes = ctx.donnees.empreintes ?? empreintesDefaut;
    const sr = chercherEmpreintes(sources, empreintes.speedresa);
    // Concurrents : uniquement du code exécuté ou intégré (scripts, iframes, formulaires) et les liens.
    // Les images, polices et styles sont exclus : les photos produits viennent souvent des fournisseurs
    // (ex. visuels hébergés sur la plateforme d'un tour-opérateur), ce n'est pas un moteur concurrent.
    const statique = /\.(jpe?g|png|gif|webp|avif|svg|ico|bmp|woff2?|ttf|otf|eot|css)(\?|#|$)/i;
    const code = [...scriptsEtIframes(html, home.urlFinale), ...(nav?.requetes ?? [])].filter((u) => !statique.test(u));
    const liensSortants = home.liens.map((l) => l.href).filter((u) => !statique.test(u));
    const concCode = chercherEmpreintes(code, empreintes.concurrents);
    const conc = concCode.length ? concCode : chercherEmpreintes(liensSortants, empreintes.concurrents);
    const aValider = empreintes.a_valider ? " (empreintes en cours de validation par l'équipe technique)" : "";
    if (conc.length) {
      const texte = `Solution concurrente détectée : ${conc.map((c) => c.e.nom.replace(/ \(À COMPLÉTER\)/, "")).join(", ")}${sr.length ? ` (module SpeedResa également présent)` : ""}.`;
      // Simple lien sortant, ou module SpeedResa également présent : confiance réduite (pas d'alerte rouge automatique)
      return { statut: "NON", texte, confiance: !concCode.length ? "basse" : sr.length ? "moyenne" : "haute", preuve: { texte: texte + aValider, extrait: conc[0].ou, url: home.urlFinale, capture: nav ? "accueil-ordinateur" : undefined } };
    }
    if (sr.length) {
      const forte = sr.some((s) => s.e.force === "forte");
      const texte = `Module SpeedResa détecté : ${sr.map((s) => s.e.nom).join(" ; ")}.`;
      return { statut: "OUI", texte, confiance: forte ? "haute" : "moyenne", preuve: { texte: texte + aValider, extrait: sr[0].ou, url: home.urlFinale } };
    }
    // Absence = alerte churn rouge : on ne conclut à NON qu'avec un rendu navigateur complet
    const texte = "Aucune empreinte SpeedResa trouvée sur la page d'accueil.";
    return { statut: "NON", texte, confiance: nav ? "moyenne" : "basse", preuve: { texte: texte + aValider + (nav ? "" : " Contrôle sans navigateur : le module peut être chargé dynamiquement."), url: home.urlFinale, capture: nav ? "accueil-ordinateur" : undefined } };
  },
};

// ───────── TECH-04 Disponibilité sur 30 jours ─────────

export const TECH04: Detecteur = {
  critereId: "TECH-04",
  libelle: "Disponibilité ≥ 99,5 % sur 30 jours",
  async run(ctx) {
    const d = ctx.donnees.disponibilite;
    if (!d || !d.mesures) return nonVerifiable("Monitoring de disponibilité pas encore démarré pour ce site (mesure toutes les 15 min par le worker).");
    const taux = d.ok / d.mesures;
    const pct = (x: number) => `${(x * 100).toFixed(2).replace(".", ",")} %`;
    const jours = d.premiere ? Math.floor((Date.now() - d.premiere.getTime()) / 86400_000) : 0;
    const texte = `${pct(taux)} de disponibilité sur ${d.mesures} mesures (${jours} jour(s))${d.derniereErreur ? `. Dernière erreur : ${d.derniereErreur}` : ""}.`;
    if (jours < 30) return { statut: null, valeur: taux, texte: `En cours de mesure : ${texte}`, confiance: "basse", preuve: { texte: `${texte} Le statut sera proposé après 30 jours d'historique.`, source: "Monitoring Speedmedia" } };
    return { statut: statutFromSeuil(taux, { sens: "↑", seuilPlein: 0.995, seuilMoitie: 0.98 }), valeur: taux, texte: `Disponibilité sur 30 jours : ${texte}`, confiance: "haute", preuve: { texte, source: "Monitoring Speedmedia" } };
  },
};
