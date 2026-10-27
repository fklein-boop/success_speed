import { getDb } from "@/db";
import { assertUser } from "@/lib/server/auth";
import { handle } from "@/lib/server/http";
import { csvFiabilite } from "@/lib/server/fiabilite";

/** Rapport de fiabilité des contrôles (CSV, séparateur point-virgule, UTF-8 avec BOM). */
export const GET = handle(async () => {
  await assertUser(["superadmin"]);
  const csv = await csvFiabilite(await getDb());
  return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="fiabilite-controles-${new Date().toISOString().slice(0, 10)}.csv"` } });
});
