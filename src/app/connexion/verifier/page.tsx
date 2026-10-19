import { Logo } from "@/components/Logo";
import { verifierLien } from "../actions";

/**
 * Le lien de l'email mène à cette page de confirmation : les antivirus de messagerie qui
 * « pré-ouvrent » les liens ne consomment donc pas le jeton (il n'est utilisé qu'au clic).
 */
export default async function VerifierPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center bg-minuit px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center"><Logo inverse className="text-3xl" /></div>
        <form action={verifierLien} className="carte space-y-4 p-8 text-center">
          <h1 className="text-2xl">Connexion</h1>
          <p className="text-sm text-gris-texte">Cliquez pour ouvrir votre session.</p>
          <input type="hidden" name="token" value={token ?? ""} />
          <button type="submit" className="btn-primaire w-full" autoFocus>Me connecter →</button>
        </form>
      </div>
    </main>
  );
}
