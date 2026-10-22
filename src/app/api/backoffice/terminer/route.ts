import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { handle } from "@/lib/server/http";
import { assertImporter } from "@/lib/server/import-access";
import { recomputeAll } from "@/lib/server/recompute";

export const maxDuration = 300;

/** Après des exports back-office seuls (sans export dossiers) : recalcul des alertes du portefeuille. */
export const POST = handle(async () => {
  await assertImporter();
  await recomputeAll(await getDb());
  revalidatePath("/", "layout");
  return { ok: true };
});
