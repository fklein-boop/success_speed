import { getDb } from "@/db";
import { assertUser } from "@/lib/server/auth";
import { handle } from "@/lib/server/http";
import { logActivity } from "@/lib/server/activity";
import { csvPortefeuille } from "@/lib/server/export-portefeuille";

/** Export du portefeuille complet (super admin uniquement : contient les données internes). */
export const GET = handle(async () => {
  const u = await assertUser(["superadmin"]);
  const { filename, content } = await csvPortefeuille(await getDb());
  await logActivity(u.id, "export_portefeuille", "portefeuille", "", { fichier: filename });
  return new Response(content, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${filename}"`, "cache-control": "no-store" } });
});
