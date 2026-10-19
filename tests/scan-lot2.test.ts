import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { ScanContext } from "@/scan/context";
import { PROD03, PROD04, PROD09, VIS08, LEG03, LEG07 } from "@/scan/detecteurs/produits";
import { LEG04, LEG08, LEG09 } from "@/scan/detecteurs/legal";
import { VIS01, VIS02, VIS03 } from "@/scan/detecteurs/visibilite";
import { TRK02, TRK05 } from "@/scan/detecteurs/tracking";
import { INN01, INN02, INN03, INN05 } from "@/scan/detecteurs/innovation";
import { PERF01, PERF14 } from "@/scan/detecteurs/performance";
import { TECH04 } from "@/scan/detecteurs/technique";
import { DETECTEURS } from "@/scan/registry";
import { choisirPlace, chercherFicheGoogle } from "@/scan/places";
import { cleFiche, datesDansTexte, donneesStructurees, liensFiches, ressemblanceTitres, similarite, textePropre } from "@/scan/produits";
import type { ScanDonnees } from "@/scan/types";
import { navigateurDisponible, parcourirTunnel } from "@/scan/browser";
import criteres from "../data/kit/03_criteres.json";

/** Lot 2 du pré-audit : détecteurs testés sur un site d'exemple servi en local, sans navigateur ni clé d'API. */
process.env.SCAN_AUTORISER_LOCAL = "1";
process.env.SCAN_INTERVALLE_MS = "0";
delete process.env.ANTHROPIC_API_KEY;

let server: Server;
let base: string;
const dir = new URL("./fixtures/scan/", import.meta.url);

beforeAll(async () => {
  server = createServer((req, res) => {
    const p = (req.url ?? "/").split("?")[0];
    const [site, ...rest] = p.split("/").filter(Boolean);
    // Fiches au gabarit SpeedResa : /produit/package/<id>-<source>/… → produit-<id>.html
    let chemin = rest[0] === "produit" ? `produit-${rest[2].split("-")[0]}.html` : rest.join("/") || "index.html";
    if (!/\.\w+$/.test(chemin)) chemin += ".html";
    const f = new URL(`${site}/${chemin}`, dir);
    if (!existsSync(f)) { res.writeHead(404); return res.end("404"); }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(readFileSync(f, "utf8").replace(/(href|src)="\/(?!\/)/g, `$1="/${site}/`));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const a = server.address();
  base = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
});
afterAll(() => { server.close(); vi.unstubAllGlobals(); });

const ctx = (donnees?: ScanDonnees, placesKey?: string) => new ScanContext(`${base}/lot2/`, { navigateur: false, donnees, placesKey });

describe("Registre", () => {
  it("couvre les 36 critères Auto du référentiel, sans doublon", () => {
    const ids = DETECTEURS.map((d) => d.critereId);
    expect(new Set(ids).size).toBe(ids.length);
    const auto = (criteres as { criteres: { id: string; source: string }[] }).criteres.filter((c) => c.source.startsWith("Auto")).map((c) => c.id);
    expect(ids.sort()).toEqual(auto.sort());
  });
});

describe("Fonctions des fiches produits", () => {
  it("reconnaît les liens de fiches SpeedResa et les dédoublonne", () => {
    const l = liensFiches([
      { href: "https://www.x.fr/produit/package/101-1/circuit/from-PAR/date-2027-05-10/nights-7", texte: "Circuit" },
      { href: "https://www.x.fr/produit/package/101-1/circuit/from-PAR/date-2027-05-10/nights-7?tab=dates", texte: "Voir les dates" },
      { href: "https://www.x.fr/search/result/package/source-1/engine-1/", texte: "Séjours" },
      { href: "https://www.x.fr/contact", texte: "Contact" },
      { href: "https://autre.fr/produit/package/9-1/x", texte: "Ailleurs" },
    ], "x.fr");
    expect(l).toHaveLength(1);
    expect(cleFiche(l[0].href)).toBe("sr:101");
  });
  it("lit les dates de départ françaises", () => {
    const d = datesDansTexte("Départs le 08/03/2027 et le 1er avril 2027.");
    expect(d.map((x) => x.toISOString().slice(0, 10))).toEqual(["2027-03-08", "2027-04-01"]);
  });
  it("mesure la similarité des textes et la ressemblance des titres", () => {
    const t = "Découvrez les plus beaux paysages de la Norvège à bord de notre navire, avec escales dans les fjords et excursions guidées.";
    expect(similarite(t, t)).toBe(1);
    expect(similarite(t, "Un séjour balnéaire en Crète dans un hôtel club tout compris face à la mer Égée.")).toBe(0);
    expect(ressemblanceTitres("Circuit Italie du Nord", "Circuit Italie du Nord 8j/7n")).toBe(1);
  });
  it("retire le texte commun au site (menu, pied de page)", () => {
    expect(textePropre("Accueil\nContact\nCircuit en Italie\nMentions légales", "Accueil\nContact\nMentions légales")).toBe("Circuit en Italie");
  });
  it("lit le JSON-LD (y compris @graph) et les microdonnées", () => {
    expect(donneesStructurees('<script type="application/ld+json">{"@graph":[{"@type":"Product","offers":{"@type":"Offer","price":10}}]}</script>')).toEqual({ types: ["Product", "Offer"], prix: true });
    expect(donneesStructurees('<div itemscope itemtype="https://schema.org/Product"><span itemprop="price">5</span></div>').prix).toBe(true);
  });
});

describe("Google Places", () => {
  const places = [
    { id: "A", displayName: { text: "Autre agence" }, websiteUri: "https://autre.fr/", rating: 4.9, userRatingCount: 10 },
    { id: "B", displayName: { text: "Évasions Exemple" }, websiteUri: "https://www.evasions-exemple.fr/accueil", rating: 4.6, userRatingCount: 120 },
  ];
  it("retient la fiche dont le site est celui du client", () => {
    expect(choisirPlace(places, "evasions-exemple.fr")?.id).toBe("B");
    expect(choisirPlace(places, "evasions-exemple.fr")?.correspondance).toBe("site");
    expect(choisirPlace(places.slice(0, 1), "evasions-exemple.fr")?.correspondance).toBe("nom");
  });
  it("interroge l'API (New) avec la clé en en-tête, jamais dans l'URL", async () => {
    const appels: { url: string; init?: RequestInit }[] = [];
    const fetcher = (async (url: string, init?: RequestInit) => { appels.push({ url, init }); return new Response(JSON.stringify({ places })); }) as unknown as typeof fetch;
    const f = await chercherFicheGoogle({ nom: "Évasions Exemple", domaine: "evasions-exemple.fr", cle: "CLE-TEST", fetcher });
    expect(f?.id).toBe("B");
    expect(appels[0].url).not.toContain("CLE-TEST");
    expect((appels[0].init?.headers as Record<string, string>)["X-Goog-Api-Key"]).toBe("CLE-TEST");
  });
});

describe("Détecteurs du lot 2 — site d'exemple", () => {
  it("VIS-08 : données structurées sur 2 fiches sur 3", async () => {
    const r = await VIS08.run(ctx());
    expect(r.statut).toBe("PARTIELLEMENT");
    expect(r.valeur).toBe(2);
  });
  it("PROD-03 : fiches incomplètes (photos, textes, blocs)", async () => {
    const r = await PROD03.run(ctx());
    expect(r.statut).toBe("NON");
    expect(r.confiance).toBe("basse");
    expect(r.preuve.texte).toContain("photo(s) HD");
  });
  it("PROD-04 : retrouve le top vente sur le site", async () => {
    const r = await PROD04.run(ctx({ topVentes: [{ voyage: "Circuit Italie du Nord", nb: 42 }] }));
    expect(r.statut).not.toBeNull();
    expect(r.preuve.texte).toContain("Retrouvés sur le site : 1/1");
    expect((await PROD04.run(ctx())).statut).toBeNull();
  });
  it("PROD-09 : une offre au départ passé est encore en avant", async () => {
    const r = await PROD09.run(ctx());
    expect(r.statut).toBe("NON");
    expect(r.valeur).toBe(1); // la même offre n'est comptée qu'une fois (lien + fiche)
    expect(r.preuve.url).toContain("date-2024-06-01");
    expect(r.preuve.texte).toContain("0 affichant « complet »"); // « centre complet » n'est pas une offre complète
  });
  it("LEG-07 : prix barré sans prix de référence sur 30 jours", async () => {
    const r = await LEG07.run(ctx());
    expect(r.statut).toBe("NON");
    expect(r.preuve.extrait).toContain("1 990");
    expect(r.preuve.texte).toContain("1 fiche(s) avec promotion"); // pas « taxes de promotion touristique »
  });
  it("LEG-03 : formulaire d'information standard seulement dans les CGV", async () => {
    expect((await LEG03.run(ctx())).statut).toBe("PARTIELLEMENT");
  });
  it("LEG-04 : CGV complètes et liées depuis les fiches", async () => {
    const r = await LEG04.run(ctx());
    expect(r.statut).toBe("OUI");
    expect(r.valeur).toBe(7);
    expect(r.preuve.source).toBe("Analyse par motifs");
  });
  it("LEG-08 : avis affichés avec information sur leur contrôle", async () => {
    expect((await LEG08.run(ctx())).statut).toBe("OUI");
  });
  it("LEG-09 : déclaration d'accessibilité publiée", async () => {
    const r = await LEG09.run(ctx());
    expect(r.statut).toBe("OUI");
    expect(r.valeur).toBeNull();
  });
  it("VIS-01 : réseaux sociaux et lien Google, sans clé Places (confiance basse)", async () => {
    const r = await VIS01.run(ctx());
    expect(r.statut).toBe("OUI");
    expect(r.confiance).toBe("basse");
  });
  it("VIS-02 / VIS-03 : non vérifiables sans clé Places", async () => {
    expect((await VIS02.run(ctx())).statut).toBeNull();
    expect((await VIS03.run(ctx())).statut).toBeNull();
  });
  it("VIS-02 : note Google lue via l'API et fiche enregistrée quand le site correspond", async () => {
    const vraiFetch = globalThis.fetch;
    vi.stubGlobal("fetch", (async (url: string | URL, init?: RequestInit) => String(url).includes("places.googleapis.com")
      ? new Response(JSON.stringify({ places: [{ id: "PLACE-1", displayName: { text: "Évasions Exemple" }, websiteUri: `${base}/lot2/`, rating: 4.4, userRatingCount: 38, googleMapsUri: "https://maps.google.com/?cid=1" }] }))
      : vraiFetch(url, init)) as typeof fetch);
    let enregistre: string | null = null;
    const r = await VIS02.run(ctx({ client: { nom: "Évasions Exemple" }, onPlaceTrouvee: async (id) => { enregistre = id; } }, "CLE"));
    vi.unstubAllGlobals();
    expect(r.statut).toBe("PARTIELLEMENT"); // 4,4/5 mais moins de 50 avis
    expect(r.valeur).toBe(4.4);
    expect(r.confiance).toBe("haute");
    expect(enregistre).toBe("PLACE-1");
  });
  it("TRK-05 : pixels Meta et Google Ads", async () => {
    const r = await TRK05.run(ctx());
    expect(r.statut).toBe("OUI");
    expect(r.preuve.texte).toContain("AW-987654321");
  });
  it("TRK-02 : pas de GA4, donc pas d'événement d'achat", async () => {
    expect((await TRK02.run(ctx())).statut).toBe("NON");
  });
  it("INN-02 / INN-03 / INN-05 : chat, avis vérifiés, label ATR", async () => {
    const c = ctx();
    expect((await INN02.run(c)).texte).toContain("Crisp");
    expect((await INN03.run(c)).statut).toBe("OUI");
    expect((await INN05.run(c)).statut).toBe("OUI");
  });
  it("INN-01 : non vérifiable sans clé Anthropic", async () => {
    expect((await INN01.run(ctx())).statut).toBeNull();
  });
  it("PERF-14 : paiement en plusieurs fois et acompte, sans portefeuille mobile", async () => {
    const r = await PERF14.run(ctx());
    expect(r.statut).toBe("PARTIELLEMENT");
    expect(r.valeur).toBe(2);
  });
  it("PERF-01 : tunnel jamais parcouru sans navigateur ni activation explicite", async () => {
    const r = await PERF01.run(ctx());
    expect(r.statut).toBeNull();
  });
  it("TECH-04 : en cours de mesure avant 30 jours, puis statut sur le taux", async () => {
    const jours = (n: number) => new Date(Date.now() - n * 86400_000);
    expect((await TECH04.run(ctx())).statut).toBeNull();
    const debut = await TECH04.run(ctx({ disponibilite: { mesures: 900, ok: 900, premiere: jours(10), derniereErreur: null } }));
    expect(debut.statut).toBeNull();
    expect(debut.texte).toContain("En cours de mesure");
    expect((await TECH04.run(ctx({ disponibilite: { mesures: 2880, ok: 2879, premiere: jours(45), derniereErreur: null } }))).statut).toBe("OUI");
    expect((await TECH04.run(ctx({ disponibilite: { mesures: 2880, ok: 2850, premiere: jours(45), derniereErreur: "HTTP 503" } }))).statut).toBe("PARTIELLEMENT");
  });
});

describe("Tunnel de réservation (si Chromium est installé) — copie locale d'un tunnel", () => {
  let tunnel: Server;
  let racine: string;
  const ecritures: string[] = [];
  beforeAll(async () => {
    tunnel = createServer((req, res) => {
      const p = (req.url ?? "/").split("?")[0];
      if (req.method !== "GET") { ecritures.push(`${req.method} ${p}`); res.writeHead(200, { "content-type": "application/json" }); return res.end("{}"); }
      const parts = p.split("/").filter(Boolean);
      let chemin = parts[0] === "produit" ? `produit-${parts[2].split("-")[0]}.html` : parts.join("/") || "index.html";
      if (!/\.\w+$/.test(chemin)) chemin += ".html";
      const f = new URL(`tunnel/${chemin}`, dir);
      if (!existsSync(f)) { res.writeHead(404); return res.end("404"); }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(readFileSync(f, "utf8"));
    });
    await new Promise<void>((r) => tunnel.listen(0, "127.0.0.1", () => r()));
    const a = tunnel.address();
    racine = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
  });
  afterAll(() => tunnel.close());

  it("atteint l'étape des options sans écrire ni soumettre le formulaire de contact", async () => {
    if (!(await navigateurDisponible())) return;
    ecritures.length = 0;
    const t = await parcourirTunnel(`${racine}/produit/package/201-1/circuit-test/from-PAR/date-2027-05-10/nights-7`);
    expect(t.assurance.proposee).toBe(true);
    expect(t.assurance.visible).toBe(true);
    expect(t.etapes.map((e) => e.action)).toEqual(["DEVIS / RÉSERVATION", "DEVIS / RÉSERVATION", "Valider"]);
    expect(t.etapes.some((e) => /envoyer/i.test(e.action))).toBe(false);
    // Seule la lecture de prix est passée ; réservation et devis bloqués avant d'atteindre le serveur
    expect(ecritures).toEqual(["POST /rest/product/package/price.json"]);
    expect(t.requetesBloquees).toBe(2);
    expect(t.capture).toBeTruthy();
  }, 60_000);

  it("s'arrête à l'étape des coordonnées sans rien saisir", async () => {
    if (!(await navigateurDisponible())) return;
    ecritures.length = 0;
    const t = await parcourirTunnel(`${racine}/produit/package/202-1/sejour-test/from-PAR/date-2027-06-15/nights-7`);
    expect(t.arret).toMatch(/coordonnées/);
    expect(t.assurance.proposee).toBe(false);
    expect(ecritures).toEqual([]);
  }, 60_000);

  it("PERF-01 : assurance proposée et visible (tunnel activé explicitement)", async () => {
    if (!(await navigateurDisponible())) return;
    const r = await PERF01.run(new ScanContext(`${racine}/`, { navigateur: true, tunnel: true }));
    expect(r.statut).toBe("OUI");
    expect(r.preuve.capture).toBe("tunnel");
  }, 90_000);
});

describe("Faux positifs relevés sur des sites réels", () => {
  it("LEG-08 : étoiles d'hôtel et « témoignage de l'héritage » ne sont pas des avis clients", async () => {
    const r = await LEG08.run(new ScanContext(`${base}/bon/`, { navigateur: false }));
    expect(r.statut).toBe("N.A.");
  });
  it("les CGV en PDF ne sont jamais analysées comme du texte", async () => {
    const vraiFetch = globalThis.fetch;
    vi.stubGlobal("fetch", (async (url: string | URL, init?: RequestInit) => String(url).endsWith("/pdf-cgv/")
      ? new Response('<html><body><h1>Agence</h1><footer><a href="/pdf-cgv/cgv.pdf">CGV</a></footer></body></html>', { headers: { "content-type": "text/html" } })
      : String(url).endsWith("/cgv.pdf") ? new Response(`%PDF-1.7\n${"x".repeat(2000)}`, { headers: { "content-type": "application/pdf" } })
      : String(url).includes("/pdf-cgv/") ? new Response("404", { status: 404 }) : vraiFetch(url, init)) as typeof fetch);
    const c = new ScanContext(`${base}/pdf-cgv/`, { navigateur: false });
    const cgv = await c.pageLegale("cgv");
    const r = await LEG04.run(c);
    vi.unstubAllGlobals();
    expect(cgv).toBeNull();
    expect(r.statut).toBeNull();
    expect(r.texte).toContain("PDF");
  });
});
