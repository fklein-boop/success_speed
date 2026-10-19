import { getDb } from "@/db";
import { previewImport } from "@/lib/server/imports";
import { handle } from "@/lib/server/http";
import { assertImporter } from "@/lib/server/import-access";

export const maxDuration = 60;

export const GET = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await assertImporter();
  const { id } = await ctx.params;
  return previewImport(await getDb(), Number(id));
});
