import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { ScanContext } from "@/scan/context";
import { TECH05, TECH06 } from "@/scan/detecteurs/technique";
import { TRK01, TRK03, TRK04 } from "@/scan/detecteurs/tracking";
import { LEG01, LEG02, LEG05, LEG06 } from "@/scan/detecteurs/legal";
import { VIS07 } from "@/scan/detecteurs/visibilite";
import { executerDetecteurs } from "@/scan/runner";
import { navigateurDisponible } from "@/scan/browser";
import { ipPrivee, verifierUrl } from "@/scan/fetcher";

/** Détecteurs testés sur des pages HTML d'exemple servies en local (sans navigateur). */
process.env.SCAN_AUTORISER_LOCAL = "1";
process.env.SCAN_INTERVALLE_MS = "0";

let server: Server;
let base: string;
const dir = new URL("./fixtures/scan/", import.meta.url);

beforeAll(async () => {
  server = createServer((req, res) => {
    // robots.txt et sitemap.xml sont à la racine du domaine : on sert ceux du site « bon »
    const p = (req.url ?? "/").split("?")[0];
    const [site, ...rest] = (/^\/(robots\.txt|sitemap\.xml)$/.test(p) ? `/bon${p}` : p).split("/").filter(Boolean);
    let chemin = rest.join("/") || "index.html";
    if (!/\.\w+$/.test(chemin)) chemin += ".html";
    if (site === "mauvais" && chemin === "index.html" && req.url?.includes("prive")) { res.writeHead(302, { location: "/mauvais/connexion" }); return res.end(); }
    const f = new URL(`${site}/${chemin}`, dir);
    if (!existsSync(f)) { res.writeHead(404); return res.end("404"); }
    const type = chemin.endsWith(".xml") ? "application/xml" : chemin.endsWith(".txt") ? "text/plain" : "text/html; charset=utf-8";
    const headers: Record<string, string | string[]> = { "content-type": type };
    if (site === "mauvais" && chemin === "index.html") headers["set-cookie"] = ["_ga=GA1.1.123; Path=/"];
    res.writeHead(200, headers);
    // Les liens absolus « / » des fixtures pointent vers le site courant
    let corps = readFileSync(f, "utf8").replace(/(href|src)="\/(?!\/)/g, `$1="/${site}/`).replace(/Sitemap: \//, `Sitemap: /${site}/`);
    if (chemin === "robots.txt") corps = corps.replace(`Sitemap: /${site}/`, `Sitemap: ${base}/${site}/`);
    res.end(corps);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const a = server.address();
  base = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
});
afterAll(() => server.close());

const ctx = (site: string) => new ScanContext(`${base}/${site}/`, { navigateur: false });

describe("Détecteurs du pré-audit — site conforme", () => {
  it("TECH-06 reconnaît la plateforme SpeedResa", async () => {
    const r = await TECH06.run(ctx("bon"));
    expect(r.statut).toBe("OUI");
    expect(r.confiance).toBe("haute");
  });
  it("TRK-03 / TRK-01 trouvent GTM et GA4", async () => {
    const c = ctx("bon");
    expect((await TRK03.run(c)).statut).toBe("OUI");
    expect((await TRK01.run(c)).texte).toContain("G-AB12CD34EF");
  });
  it("TRK-04 : appel consent default visible dans le code (sans navigateur, confiance basse)", async () => {
    const r = await TRK04.run(ctx("bon"));
    expect(r.statut).toBe("PARTIELLEMENT");
    expect(r.confiance).toBe("basse");
  });
  it("LEG-02 : mentions légales complètes", async () => {
    const r = await LEG02.run(ctx("bon"));
    expect(r.statut).toBe("OUI");
    expect(r.preuve.texte).toContain("IM075100100");
  });
  it("LEG-05 : médiateur MTV dans les CGV", async () => {
    expect((await LEG05.run(ctx("bon"))).statut).toBe("OUI");
  });
  it("LEG-06 : politique de confidentialité complète", async () => {
    expect((await LEG06.run(ctx("bon"))).statut).toBe("OUI");
  });
  it("VIS-07 : sitemap déclaré dans robots.txt", async () => {
    const r = await VIS07.run(ctx("bon"));
    expect(r.statut).toBe("OUI");
    expect(r.valeur).toBe(3);
  });
  it("TECH-05 : viewport présent (rendu mobile non contrôlé sans navigateur)", async () => {
    const r = await TECH05.run(ctx("bon"));
    expect(r.statut).toBe("OUI");
    expect(r.confiance).toBe("moyenne");
  });
});

describe("Détecteurs du pré-audit — site non conforme", () => {
  it("TECH-06 : solution concurrente détectée", async () => {
    const r = await TECH06.run(ctx("mauvais"));
    expect(r.statut).toBe("NON");
    expect(r.texte).toMatch(/Bókun/);
  });
  it("LEG-01 : cookie _ga déposé d'emblée sans bannière", async () => {
    const r = await LEG01.run(ctx("mauvais"));
    expect(r.statut).toBe("NON");
    expect(r.texte).toContain("_ga");
  });
  it("LEG-02 : mentions incomplètes", async () => {
    expect((await LEG02.run(ctx("mauvais"))).statut).toBe("NON");
  });
  it("LEG-05 : pas de médiateur", async () => {
    expect((await LEG05.run(ctx("mauvais"))).statut).toBe("NON");
  });
  it("VIS-07 : page d'accueil en noindex", async () => {
    expect((await VIS07.run(ctx("mauvais"))).statut).toBe("NON");
  });
  it("TECH-05 : pas de viewport", async () => {
    expect((await TECH05.run(ctx("mauvais"))).statut).toBe("NON");
  });
  it("site derrière authentification : scan arrêté, tout en non vérifiable", async () => {
    const s = await executerDetecteurs(`${base}/mauvais/?prive=1`, { navigateur: false, detecteurs: [TECH06, LEG02] });
    expect(s.statut).toBe("auth");
    expect([...s.resultats.values()].every((r) => r.statut === null)).toBe(true);
  });
  it("un détecteur qui plante ne fait pas tomber le scan", async () => {
    const casse = { critereId: "X-01", libelle: "cassé", run: async () => { throw new Error("boum"); } };
    const s = await executerDetecteurs(`${base}/bon/`, { navigateur: false, detecteurs: [casse, TECH06] });
    expect(s.resultats.get("X-01")!.statut).toBeNull();
    expect(s.resultats.get("TECH-06")!.statut).toBe("OUI");
  });
});

describe("Sécurité du scan", () => {
  it("refuse les adresses internes hors tests", async () => {
    expect(ipPrivee("10.0.0.1")).toBe(true);
    expect(ipPrivee("192.168.1.10")).toBe(true);
    expect(ipPrivee("169.254.169.254")).toBe(true);
    expect(ipPrivee("::1")).toBe(true);
    expect(ipPrivee("8.8.8.8")).toBe(false);
    process.env.SCAN_AUTORISER_LOCAL = "0";
    await expect(verifierUrl("http://127.0.0.1/")).rejects.toThrow(/interne/);
    await expect(verifierUrl("file:///etc/passwd")).rejects.toThrow();
    process.env.SCAN_AUTORISER_LOCAL = "1";
  });
});

describe("Navigateur (si Chromium est installé)", () => {
  it("LEG-01 : cookie traceur posé par script avant consentement + bouton Refuser détecté", async () => {
    if (!(await navigateurDisponible())) return;
    const r = await LEG01.run(new ScanContext(`${base}/bon/`, { navigateur: true }));
    expect(r.preuve.texte).toMatch(/Gestionnaire de consentement : Axeptio/);
  }, 60_000);
});

describe("TECH-06 — faux positifs", () => {
  it("une photo produit hébergée chez un concurrent n'est pas un moteur concurrent", async () => {
    const { chercherEmpreintes } = await import("@/scan/detecteurs/technique");
    const { scriptsEtIframes } = await import("@/scan/html");
    const html = `<img src="https://admin-voyamar.orchestra-platform.com/admin/photo.jpeg"><script src="/assets/js/module/search/engine/configuration/script.js"></script>`;
    const code = scriptsEtIframes(html, "https://www.exemple.fr/");
    expect(chercherEmpreintes(code, [{ nom: "Orchestra", motif: "orchestra-platform" }])).toHaveLength(0);
  });
});
