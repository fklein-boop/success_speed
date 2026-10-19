import { z } from "zod";
import { extraitAutour, ressources } from "../html";
import { analyserIa, iaDisponible, rechercheIa } from "../ia";
import { nonVerifiable, type Detecteur } from "../types";
import type { ScanContext } from "../context";

/** Code de la page d'accueil (rendue si possible) et requêtes réseau, pour repérer les widgets. */
async function codeAccueil(ctx: ScanContext) {
  const home = await ctx.accueil();
  const nav = await ctx.navigateur().catch(() => null);
  const html = nav?.html ?? home.corps;
  return { home, nav, code: [html, ...ressources(html, home.urlFinale), ...(nav?.requetes ?? [])].join("\n") };
}

const CHATS: [string, RegExp][] = [
  ["Crisp", /crisp\.chat/i], ["Intercom", /intercom(cdn)?\.(io|com)|widget\.intercom/i], ["Zendesk", /zdassets\.com|zopim/i], ["tawk.to", /tawk\.to/i],
  ["HubSpot", /js\.(hs-scripts|usemessages)\.com/i], ["Tidio", /tidio(chat)?\.co/i], ["Freshchat", /freshchat|wchat\.freshchat/i], ["LiveChat", /livechatinc\.com/i],
  ["Drift", /js\.driftt?\.com/i], ["iAdvize", /iadvize\.com/i], ["Smartsupp", /smartsupp/i], ["Chatra", /chatra\.io/i], ["Botpress", /botpress/i],
  ["Brevo Conversations", /conversations-widget\.brevo|sibautomation.*conversations/i], ["Userlike", /userlike/i], ["Voiceflow", /voiceflow/i],
  ["WhatsApp", /wa\.me\/|api\.whatsapp\.com|whatsapp:\/\/|web\.whatsapp\.com\/send/i], ["Messenger", /m\.me\/[A-Za-z0-9.]+/i],
];

export const INN02: Detecteur = {
  critereId: "INN-02",
  libelle: "Chat, assistant IA ou WhatsApp Business",
  navigateur: true,
  async run(ctx) {
    const { home, nav, code } = await codeAccueil(ctx);
    const trouves = CHATS.filter(([, re]) => re.test(code)).map(([n]) => n);
    const texte = trouves.length ? `Contact instantané présent : ${trouves.join(", ")}.` : "Aucun chat, assistant conversationnel ni lien WhatsApp détecté.";
    return { statut: trouves.length ? "OUI" : "NON", texte, confiance: trouves.length ? "haute" : nav ? "moyenne" : "basse", preuve: { texte, url: home.urlFinale, requete: (nav?.requetes ?? []).find((u) => CHATS.some(([, re]) => re.test(u))) } };
  },
};

const AVIS: [string, RegExp][] = [
  ["Avis Vérifiés", /avis-verifies|netreviews/i], ["Trustpilot", /trustpilot/i], ["Guest Suite", /guest-?suite/i], ["Custplace", /custplace/i],
  ["Feefo", /feefo/i], ["Opinion System", /opinionsystem|opinion-system/i], ["Google (widget d'avis)", /elfsight|trustindex|embedsocial/i],
];

export const INN03: Detecteur = {
  critereId: "INN-03",
  libelle: "Collecte automatique d'avis vérifiés",
  async run(ctx) {
    const { home, code } = await codeAccueil(ctx);
    const trouves = AVIS.filter(([, re]) => re.test(code)).map(([n]) => n);
    if (trouves.length) {
      const texte = `Plateforme d'avis en place : ${trouves.join(", ")}. Collecte automatique après le voyage à confirmer par le client.`;
      return { statut: "OUI", texte, confiance: "moyenne", preuve: { texte, url: home.urlFinale } };
    }
    const texte = "Aucune plateforme d'avis vérifiés détectée sur le site (la collecte peut exister sans widget : question au client).";
    return { statut: "NON", texte, confiance: "basse", preuve: { texte, url: home.urlFinale } };
  },
};

const CARBONE = /empreinte\s+carbone|\d[\d\s.,]*\s?(kg|t|tonnes?)\s?(d.)?\s?(eq\.?\s?)?CO[2₂]|compensation\s+carbone|bilan\s+carbone/i;
const MENTION_CO2 = /[ée]missions?\s+de\s+(gaz\s+[àa]\s+effet\s+de\s+serre|CO[2₂])|\bCO[2₂]\b/i;
const LABELS = /\bATR\b|Agir\s+pour\s+un\s+Tourisme\s+Responsable|Travelife|Clef\s+Verte|Green\s+Globe|[ÉE]colabel|B\s?Corp|Tourisme\s+&?\s*Handicap|Qualit[ée]\s+Tourisme|Flocon\s+Vert/i;
const DISCOURS = /tourisme\s+(responsable|durable)|voyage(r|s)?\s+(responsable|durable|[ée]co-?responsable)|[ée]co-?responsab|RSE\b|d[ée]veloppement\s+durable/i;

export const INN05: Detecteur = {
  critereId: "INN-05",
  libelle: "Information RSE : empreinte carbone ou label",
  async run(ctx) {
    const pages = await ctx.corpus();
    const trouve = (re: RegExp) => pages.find((p) => re.test(p.texte));
    const carbone = trouve(CARBONE), label = trouve(LABELS), co2 = trouve(MENTION_CO2), discours = trouve(DISCOURS);
    const lignes = `Empreinte carbone : ${carbone ? "affichée" : co2 ? "mention des émissions de CO2 sans chiffrage" : "non trouvée"}. Label durable : ${label ? (label.texte.match(LABELS)?.[0] ?? "oui") : "aucun"}. Engagement RSE rédigé : ${discours ? "oui" : "non"} (${pages.length} pages analysées).`;
    const source = carbone ?? label ?? co2 ?? discours;
    const preuve = { texte: lignes, url: source?.url ?? pages[0].url, extrait: source ? extraitAutour(source.texte, carbone ? CARBONE : label ? LABELS : co2 ? MENTION_CO2 : DISCOURS) ?? undefined : undefined };
    if (carbone || label) return { statut: "OUI", texte: carbone ? "Empreinte carbone affichée." : `Label durable mis en avant (${label!.texte.match(LABELS)?.[0]}).`, confiance: "moyenne", preuve };
    if (co2) return { statut: "PARTIELLEMENT", texte: "Émissions de CO2 évoquées, sans empreinte carbone chiffrée ni label.", confiance: "moyenne", preuve };
    if (discours) return { statut: "PARTIELLEMENT", texte: "Engagement responsable évoqué, sans empreinte carbone ni label.", confiance: "moyenne", preuve };
    return { statut: "NON", texte: "Aucune information RSE (empreinte carbone, label, engagement).", confiance: "moyenne", preuve };
  },
};

// ───────── INN-01 Visibilité dans les moteurs de réponse IA ─────────

const SchemaRequetes = z.object({
  ville: z.string().describe("Ville principale de l'agence (siège ou agence physique), chaîne vide si inconnue"),
  destination: z.string().describe("Destination ou type de voyage phare de l'agence, en 2 à 4 mots"),
});

export const INN01: Detecteur = {
  critereId: "INN-01",
  libelle: "Visibilité dans les moteurs de réponse IA",
  async run(ctx) {
    if (!iaDisponible()) return nonVerifiable("Clé Anthropic non configurée : visibilité dans les moteurs de réponse IA non testée.");
    if (process.env.SCAN_VISIBILITE_IA === "non") return nonVerifiable("Test de visibilité IA désactivé (SCAN_VISIBILITE_IA=non).");
    const home = await ctx.accueil();
    const place = await ctx.place().catch(() => null);
    const top = ctx.donnees.topVentes?.[0]?.voyage;
    const { fiches } = await ctx.fiches().catch(() => ({ fiches: [] as { titre: string }[] }));
    const nom = ctx.donnees.client?.nom ?? new URL(home.urlFinale).hostname;
    // Ville et destination phare déduites du site (et de la fiche Google si disponible)
    const contexte = await analyserIa({
      outil: "contexte_agence",
      schema: SchemaRequetes,
      consigne: "À partir de ces informations sur une agence de voyages, indique sa ville principale et sa destination ou son type de voyage phare.",
      documents: [{ titre: "Accueil", url: home.urlFinale, texte: `${place?.adresse ? `Adresse Google : ${place.adresse}\n` : ""}${top ? `Produit le plus vendu : ${top}\n` : ""}${fiches.map((f) => `Fiche : ${f.titre}`).join("\n")}\n${home.texte.slice(0, 5000)}` }],
      maxCaracteres: 7000, maxTokens: 300,
    });
    const requetes = [
      contexte.ville ? `Quelle agence de voyages choisir à ${contexte.ville} ?` : null,
      contexte.destination ? `Quelle agence française recommandes-tu pour un voyage : ${contexte.destination} ?` : null,
      contexte.ville && contexte.destination ? `Agence de voyages ${contexte.ville} spécialiste ${contexte.destination}` : null,
    ].filter((x): x is string => !!x).slice(0, 3);
    if (!requetes.length) return nonVerifiable("Ville et destination phare non identifiées : requêtes métier à définir par le CSM.");
    const domaine = ctx.domaine.toLowerCase();
    const motsNom = nom.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\b(voyages?|agence|de|des|du|la|le|les|tourisme|sas|sarl)\b/g, " ").trim();
    const resultats = [];
    for (const q of requetes) {
      try {
        const r = await rechercheIa(q);
        const t = r.texte.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
        const cite = r.sources.some((s) => s.toLowerCase().includes(domaine)) || t.includes(domaine) || (motsNom.length >= 4 && t.includes(motsNom));
        resultats.push({ q, cite });
      } catch (e) { resultats.push({ q, cite: false, erreur: e instanceof Error ? e.message : "erreur" }); }
    }
    const cites = resultats.filter((r) => r.cite).length;
    const texte = `Requêtes testées (Claude avec recherche web) : ${resultats.map((r) => `« ${r.q} » → ${r.cite ? "cité" : "non cité"}`).join(" ; ")}.`;
    return { statut: cites > 0 ? "OUI" : "NON", valeur: cites, texte: cites ? `Agence citée sur ${cites}/${resultats.length} requêtes métier.` : `Agence non citée sur les ${resultats.length} requêtes métier testées.`, confiance: "basse", preuve: { texte, source: "Claude + recherche web" } };
  },
};
