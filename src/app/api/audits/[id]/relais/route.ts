import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { audits, clients } from "@/db/schema";
import { assertUser } from "@/lib/server/auth";
import { AuditError } from "@/lib/server/audits";
import { handle } from "@/lib/server/http";
import { iaDisponible } from "@/scan/ia";
import { chercherRelais } from "@/scan/relais";

export const maxDuration = 120;

/** VIS-04 : pages qui citent le site du client, à cocher par le CSM. */
export const POST = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await assertUser(["superadmin", "csm"]);
  const { id } = await ctx.params;
  const db = await getDb();
  const [a] = await db.select().from(audits).where(eq(audits.id, Number(id)));
  if (!a) throw new AuditError("Audit introuvable", 404);
  if (!a.urlAuditee) throw new AuditError("Aucune URL auditée pour ce client.", 400);
  if (!iaDisponible()) throw new AuditError("Clé Anthropic manquante — à renseigner (Administration → État des services). Utilisez les liens de recherche en attendant.", 503);
  const [c] = await db.select({ nom: clients.nom }).from(clients).where(eq(clients.id, a.clientId));
  const domaine = new URL(a.urlAuditee).hostname.replace(/^www\./, "");
  return { relais: await chercherRelais(c?.nom ?? domaine, domaine) };
});
