import { getDb } from "@/db";
import { abandonImport } from "@/lib/server/imports";
import { handle } from "@/lib/server/http";
import { assertImporter } from "@/lib/server/import-access";

export const POST = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await assertImporter();
  const { id } = await ctx.params;
  await abandonImport(await getDb(), Number(id));
  return { ok: true };
});
