import { assertUser, canImport, HttpError } from "./auth";

export async function assertImporter() {
  const u = await assertUser();
  if (!canImport(u)) throw new HttpError(403, "Vous n'êtes pas autorisé à importer des données.");
  return u;
}
