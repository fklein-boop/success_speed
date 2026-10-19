import { resolveTxt } from "node:dns/promises";
import { connect } from "node:tls";
import { collecterNavigateur, parcourirTunnel, rendrePages, type DonneesNavigateur, type ResultatTunnel } from "./browser";
import { domaineEnregistrable, recuperer, verifierUrl, type Reponse } from "./fetcher";
import { liens, texteDe, type Lien } from "./html";
import { chercherFicheGoogle, type FicheGoogle } from "./places";
import { ficheRendue, ficheStatique, liensFiches, type Fiche } from "./produits";
import { SiteProtegeError, type ScanDonnees } from "./types";

export interface Page extends Reponse {
  texte: string;
  liens: Lien[];
}

export type TypePageLegale = "mentions" | "cgv" | "confidentialite";

const MOTIFS_LEGAUX: Record<TypePageLegale, { texte: RegExp; url: RegExp; chemins: string[] }> = {
  mentions: { texte: /mentions?\s+l[ée]gales|informations\s+l[ée]gales|legal/i, url: /mentions?[-_]?legales|informations[-_]legales|legal/i, chemins: ["/mentions-legales", "/mentions-legales.html"] },
  cgv: { texte: /conditions\s+(g[ée]n[ée]rales|particuli[èe]res)|cgv|conditions\s+de\s+vente/i, url: /cgv|conditions[-_]?(generales|de[-_]vente|particulieres)/i, chemins: ["/cgv", "/conditions-generales-de-vente"] },
  confidentialite: { texte: /confidentialit|donn[ée]es\s+personnelles|vie\s+priv[ée]e|rgpd|privacy/i, url: /confidentialit|donnees[-_]personnelles|vie[-_]privee|rgpd|privacy/i, chemins: ["/politique-de-confidentialite", "/donnees-personnelles"] },
};

export interface PageSpeed {
  score: number | null;
  terrain: { lcp?: number; inp?: number; cls?: number; categorie?: string } | null;
  labo: { lcp?: number; cls?: number; tbt?: number };
  url: string;
}

/** Contexte de scan : chaque ressource est récupérée une seule fois, à la demande. */
export class ScanContext {
  readonly url: string;
  readonly host: string;
  readonly domaine: string;
  private cache = new Map<string, Promise<unknown>>();
  /** Captures produites pendant le scan (enregistrées à la fin) */
  captures: { nom: string; data: string }[] = [];

  constructor(url: string, private opts: { navigateur: boolean; pagespeedKey?: string | null; placesKey?: string | null; tunnel?: boolean; donnees?: ScanDonnees } = { navigateur: false }) {
    this.url = url;
    this.host = new URL(url).hostname;
    this.domaine = domaineEnregistrable(this.host);
  }

  get avecNavigateur() { return this.opts.navigateur; }
  get donnees(): ScanDonnees { return this.opts.donnees ?? {}; }
  get tunnelActive() { return !!this.opts.tunnel && this.opts.navigateur; }

  private une<T>(cle: string, f: () => Promise<T>): Promise<T> {
    if (!this.cache.has(cle)) this.cache.set(cle, f());
    return this.cache.get(cle) as Promise<T>;
  }

  /** Page d'accueil. Lève SiteProtegeError si le site renvoie vers une page de connexion. */
  accueil(): Promise<Page> {
    return this.une("accueil", async () => {
      const r = await recuperer(this.url);
      const p = this.page(r);
      const chemin = new URL(p.urlFinale).pathname.toLowerCase();
      const motDePasse = /<input[^>]+type\s*=\s*["']?password/i.test(r.corps);
      if (r.statut === 401 || /\/(login|connexion|signin|sign-in|auth|identification)\b/.test(chemin) || (motDePasse && p.texte.length < 2500)) {
        throw new SiteProtegeError(p.urlFinale);
      }
      return p;
    });
  }

  private page(r: Reponse): Page {
    return { ...r, texte: texteDe(r.corps), liens: liens(r.corps, r.urlFinale) };
  }

  /** Récupère une URL du même site (pages légales, robots, sitemap…). null en cas d'échec. */
  get(url: string, accept?: string): Promise<Page | null> {
    return this.une(`get:${url}`, async () => {
      try {
        const r = await recuperer(url, { accept });
        return r.statut >= 200 && r.statut < 300 ? this.page(r) : null;
      } catch { return null; }
    });
  }

  /** Page légale découverte via les liens de la page d'accueil (pied de page), sinon chemins courants. Les PDF sont ignorés (LEG-04 les signale). */
  pageLegale(type: TypePageLegale): Promise<Page | null> {
    return this.une(`legal:${type}`, async () => {
      const home = await this.accueil();
      const m = MOTIFS_LEGAUX[type];
      const memeSite = home.liens.filter((l) => { try { return domaineEnregistrable(new URL(l.href).hostname) === this.domaine; } catch { return false; } });
      // Les liens de fin de page (pied de page) sont prioritaires
      const candidats = [...memeSite].reverse().filter((l) => (m.texte.test(l.texte) || m.url.test(l.href)) && !/\.pdf($|\?)/i.test(l.href));
      for (const c of candidats.slice(0, 2)) {
        const p = await this.get(c.href);
        if (p && p.texte.length > 300 && !estPdf(p)) return p;
      }
      for (const chemin of m.chemins) {
        const p = await this.get(new URL(chemin, home.urlFinale).toString());
        if (p && p.texte.length > 300 && !estPdf(p) && (m.texte.test(p.texte.slice(0, 3000)) || m.url.test(p.urlFinale))) return p;
      }
      return null;
    });
  }

  navigateur(): Promise<DonneesNavigateur | null> {
    return this.une("navigateur", async () => {
      if (!this.opts.navigateur) return null;
      const home = await this.accueil();
      const d = await collecterNavigateur(home.urlFinale);
      this.captures.push(...d.captures);
      return d;
    });
  }

  /** HTML le plus complet disponible (rendu navigateur si possible). */
  async html(): Promise<string> {
    const nav = await this.navigateur().catch(() => null);
    return nav?.html ?? (await this.accueil()).corps;
  }

  pagespeed(): Promise<PageSpeed | null> {
    return this.une("pagespeed", async () => {
      const home = await this.accueil();
      const u = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
      u.searchParams.set("url", home.urlFinale);
      u.searchParams.set("strategy", "mobile");
      u.searchParams.set("category", "performance");
      u.searchParams.set("locale", "fr");
      if (this.opts.pagespeedKey) u.searchParams.set("key", this.opts.pagespeedKey);
      const res = await fetch(u, { signal: AbortSignal.timeout(110_000) });
      if (!res.ok) throw new Error(res.status === 429 ? "Quota PageSpeed atteint (clé API à configurer)" : `PageSpeed : erreur ${res.status}`);
      const j = await res.json() as {
        loadingExperience?: { overall_category?: string; metrics?: Record<string, { percentile: number }> };
        lighthouseResult?: { categories?: { performance?: { score: number | null } }; audits?: Record<string, { numericValue?: number }> };
      };
      const m = j.loadingExperience?.metrics;
      const a = j.lighthouseResult?.audits ?? {};
      const sc = j.lighthouseResult?.categories?.performance?.score;
      return {
        url: home.urlFinale,
        score: sc === null || sc === undefined ? null : Math.round(sc * 100),
        terrain: m && (m.LARGEST_CONTENTFUL_PAINT_MS || m.INTERACTION_TO_NEXT_PAINT || m.CUMULATIVE_LAYOUT_SHIFT_SCORE) ? {
          lcp: m.LARGEST_CONTENTFUL_PAINT_MS?.percentile,
          inp: m.INTERACTION_TO_NEXT_PAINT?.percentile,
          cls: m.CUMULATIVE_LAYOUT_SHIFT_SCORE ? m.CUMULATIVE_LAYOUT_SHIFT_SCORE.percentile / 100 : undefined,
          categorie: j.loadingExperience?.overall_category,
        } : null,
        labo: { lcp: a["largest-contentful-paint"]?.numericValue, cls: a["cumulative-layout-shift"]?.numericValue, tbt: a["total-blocking-time"]?.numericValue },
      };
    });
  }

  txt(nom: string): Promise<string[] | null> {
    return this.une(`dns:${nom}`, async () => {
      try { return (await resolveTxt(nom)).map((r) => r.join("")); }
      catch (e) { const code = (e as { code?: string }).code; if (code === "ENODATA" || code === "ENOTFOUND") return []; return null; }
    });
  }

  certificat(): Promise<{ autorise: boolean; erreur: string | null; expire: Date | null; emetteur: string | null }> {
    return this.une("tls", async () => {
      await verifierUrl(`https://${this.host}/`);
      return new Promise((resolve, reject) => {
        const s = connect({ host: this.host, port: 443, servername: this.host, timeout: 10000, rejectUnauthorized: false }, () => {
          const c = s.getPeerCertificate();
          resolve({
            autorise: s.authorized,
            erreur: s.authorizationError ? String(s.authorizationError) : null,
            expire: c?.valid_to ? new Date(c.valid_to) : null,
            emetteur: (c?.issuer?.O as string | undefined) ?? (c?.issuer?.CN as string | undefined) ?? null,
          });
          s.end();
        });
        s.on("error", reject);
        s.on("timeout", () => { s.destroy(); reject(new Error("Délai dépassé")); });
      });
    });
  }

  rdap(): Promise<{ expiration: Date | null; registrar: string | null; url: string }> {
    return this.une("rdap", async () => {
      const url = `https://rdap.org/domain/${this.domaine}`;
      const res = await fetch(url, { headers: { accept: "application/rdap+json", "user-agent": "SpeedmediaAuditBot/1.0" }, signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`RDAP : erreur ${res.status}`);
      const j = await res.json() as { events?: { eventAction: string; eventDate: string }[]; entities?: { roles?: string[]; vcardArray?: [string, [string, unknown, string, string][]] }[] };
      const exp = j.events?.find((e) => e.eventAction === "expiration")?.eventDate;
      const reg = j.entities?.find((e) => e.roles?.includes("registrar"))?.vcardArray?.[1]?.find((v) => v[0] === "fn")?.[3] ?? null;
      return { expiration: exp ? new Date(exp) : null, registrar: reg, url };
    });
  }

  // ───────── Fiches produits ─────────

  /**
   * Liens vers les fiches produits, dans l'ordre de la page d'accueil (rendue si possible).
   * S'il y en a moins de 3, on complète avec la première page de résultats du moteur.
   */
  liensProduits(): Promise<{ liens: Lien[]; source: string }> {
    return this.une("liensProduits", async () => {
      const home = await this.accueil();
      const nav = await this.navigateur().catch(() => null);
      const tous = nav ? liens(nav.html, nav.urlFinale) : home.liens;
      let trouves = liensFiches(tous, this.domaine);
      let source = "page d'accueil";
      if (trouves.length < 3) {
        const recherche = tous.find((l) => /\/search\/result\/|\/recherche|\/resultats?/i.test(l.href) && l.href.includes(this.domaine));
        if (recherche) {
          const page = this.opts.navigateur ? (await rendrePages([recherche.href]).catch(() => []))[0] : null;
          const l2 = page ? page.liens : (await this.get(recherche.href))?.liens ?? [];
          const suite = liensFiches(l2, this.domaine).filter((l) => !trouves.some((t) => t.href === l.href));
          if (suite.length) { trouves = [...trouves, ...suite]; source = trouves.length > suite.length ? "page d'accueil et page de résultats" : `page de résultats (${new URL(recherche.href).pathname})`; }
        }
      }
      // Les fiches au gabarit SpeedResa d'abord
      trouves.sort((a, b) => Number(/\/produit\//.test(b.href)) - Number(/\/produit\//.test(a.href)));
      return { liens: trouves, source };
    });
  }

  private cacheFiches = new Map<string, Fiche | null>();

  /** Analyse des fiches (rendu navigateur si disponible, sinon HTML brut). */
  async analyserFiches(urls: string[]): Promise<Fiche[]> {
    const manquantes = urls.filter((u) => !this.cacheFiches.has(u));
    if (manquantes.length) {
      const nav = await this.navigateur().catch(() => null);
      const texteAccueil = nav?.texte ?? (await this.accueil()).texte;
      if (this.opts.navigateur) {
        const pages = await rendrePages(manquantes).catch(() => []);
        for (const u of manquantes) {
          const p = pages.find((x) => x.url === u);
          this.cacheFiches.set(u, p ? ficheRendue(p, texteAccueil) : null);
        }
      } else {
        for (const u of manquantes) {
          const r = await this.get(u);
          this.cacheFiches.set(u, r ? ficheStatique(r.urlFinale, r.corps, texteAccueil) : null);
        }
      }
    }
    return urls.map((u) => this.cacheFiches.get(u)).filter((f): f is Fiche => !!f);
  }

  /** Les 3 premières fiches produits de la page d'accueil. */
  fiches(): Promise<{ fiches: Fiche[]; source: string }> {
    return this.une("fiches", async () => {
      const { liens: l, source } = await this.liensProduits();
      return { fiches: await this.analyserFiches(l.slice(0, 3).map((x) => x.href)), source };
    });
  }

  /** Textes du site disponibles (accueil rendu, fiches, pages légales) pour les recherches de mentions. */
  async corpus(): Promise<{ url: string; texte: string; html: string }[]> {
    const home = await this.accueil();
    const nav = await this.navigateur().catch(() => null);
    const out = [{ url: nav?.urlFinale ?? home.urlFinale, texte: nav?.texte ?? home.texte, html: nav?.html ?? home.corps }];
    for (const f of (await this.fiches().catch(() => ({ fiches: [] as Fiche[] }))).fiches) out.push({ url: f.url, texte: f.texte, html: f.html });
    for (const t of ["mentions", "cgv", "confidentialite"] as const) {
      const p = await this.pageLegale(t).catch(() => null);
      if (p) out.push({ url: p.urlFinale, texte: p.texte, html: p.corps });
    }
    return out;
  }

  // ───────── Google Places ─────────

  place(): Promise<FicheGoogle | null> {
    return this.une("place", async () => {
      const cle = this.opts.placesKey;
      const client = this.donnees.client;
      if (!cle || !client) return null;
      const f = await chercherFicheGoogle({ nom: client.nom, domaine: this.domaine, placeId: client.placeId, cle });
      if (f && f.correspondance === "site" && f.id !== client.placeId) await this.donnees.onPlaceTrouvee?.(f.id).catch(() => null);
      return f;
    });
  }

  get placesDisponible() { return !!this.opts.placesKey && !!this.donnees.client; }

  // ───────── Tunnel de réservation ─────────

  tunnel(): Promise<ResultatTunnel | null> {
    return this.une("tunnel", async () => {
      if (!this.tunnelActive) return null;
      const { fiches } = await this.fiches();
      const f = fiches[0];
      if (!f) return null;
      const r = await parcourirTunnel(f.url);
      if (r.capture) this.captures.push({ nom: "tunnel", data: r.capture });
      return r;
    });
  }
}

const estPdf = (p: Page) => /pdf/i.test(p.headers["content-type"] ?? "") || p.corps.startsWith("%PDF");
