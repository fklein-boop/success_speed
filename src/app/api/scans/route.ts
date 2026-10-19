import { after } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { clientUrls } from "@/db/schema";
import { assertUser } from "@/lib/server/auth";
import { creerScan, executerScan } from "@/lib/server/scans";
import { handle } from "@/lib/server/http";
import { logActivity } from "@/lib/server/activity";

// Le scan continue en tâche de fond après la réponse (jusqu'à 5 minutes sur Vercel)
export const maxDuration = 300;

const Body = z.object({ clientId: z.string().min(1), url: z.string().min(4).max(500), nouvelleUrl: z.boolean().optional() });

export const POST = handle(async (req: Request) => {
  const u = await assertUser(["superadmin", "csm"]);
  const b = Body.parse(await req.json());
  const db = await getDb();
  let url = b.url.trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  url = new URL(url).toString();
  if (b.nouvelleUrl) {
    // URL saisie par un CSM authentifié : elle rejoint le référentiel du client
    const existantes = await db.select().from(clientUrls).where(eq(clientUrls.clientId, b.clientId));
    await db.insert(clientUrls).values({ clientId: b.clientId, url, principale: existantes.length === 0 }).onConflictDoNothing();
    await logActivity(u.id, "url_ajoutee", "client", b.clientId, { url });
  }
  const r = await creerScan(db, b.clientId, url, u.id);
  if (!r.existant) {
    await logActivity(u.id, "scan_lance", "scan", String(r.id), { clientId: b.clientId, url });
    if (process.env.SCAN_MODE !== "worker") after(() => executerScan(db, r.id).catch((e) => console.error("Scan", r.id, e)));
  }
  return r;
});
