import { inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { clients } from "@/db/schema";
import { assertUser } from "@/lib/server/auth";
import { scansRecents } from "@/lib/server/scans";
import { handle } from "@/lib/server/http";

/** Scans de l'utilisateur terminés récemment (notification quand il a quitté la page). */
export const GET = handle(async () => {
  const u = await assertUser();
  const db = await getDb();
  const list = await scansRecents(db, u.id, new Date(Date.now() - 30 * 60_000));
  const noms = list.length ? new Map((await db.select({ id: clients.id, nom: clients.nom }).from(clients).where(inArray(clients.id, list.map((l) => l.clientId)))).map((c) => [c.id, c.nom])) : new Map();
  return { scans: list.map((l) => ({ ...l, client: noms.get(l.clientId) ?? l.clientId })) };
});
