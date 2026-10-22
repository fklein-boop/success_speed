# Décisions

Choix pris quand le cahier des charges ne tranchait pas. À relire et à corriger si besoin.

## Étape 1 — Socle (16/10/2026)

### Hébergement et services
- **Vercel** (région `fra1`, Francfort) + **Neon** PostgreSQL (Francfort) + **Resend** (UE) pour les emails, **lien magique + Google** pour la connexion — choix validés le 16/10/2026.
- **Écart avec les repères techniques** : pas de Docker Compose. Vercel ne l'utilise pas, et en local la base PGlite (PostgreSQL embarqué en WebAssembly) évite toute installation. Le code reste du PostgreSQL standard.
- **Pas d'Auth.js** : connexion maison (≈ 200 lignes, `src/lib/server/auth.ts`) avec la bibliothèque `arctic` pour Google. Plus simple à auditer et à restreindre à la liste blanche. Sessions en base, jeton haché (SHA-256) dans un cookie `httpOnly`.
- **Tâches de fond** : Vercel n'exécute pas de worker permanent. Pour l'étape 1, les traitements tiennent dans une requête (import + recalcul ≈ 5 à 15 s, `maxDuration` 300 s) et le rappel du lundi passe par **Vercel Cron**. Le moteur de scan (étape 3, Playwright) aura besoin d'un worker séparé : voir « Points ouverts ».

### Connexion et droits
- Lien magique valable **15 minutes**, à usage unique, **5 demandes max par adresse et par quart d'heure**. La réponse est identique que l'adresse soit autorisée ou non.
- Le lien de l'email ouvre une page avec un bouton « Me connecter » : les antivirus de messagerie qui pré-ouvrent les liens ne consomment donc pas le jeton.
- Déconnexion après **8 h d'inactivité** ; durée maximale d'une session : **14 jours**.
- Le super admin défini par `SUPERADMIN_EMAIL` est créé automatiquement à sa première demande de connexion. Il ne peut être ni désactivé ni rétrogradé depuis l'interface. Un super admin ne peut pas non plus modifier son propre rôle ou se désactiver.
- Sans clé Resend : en local, les emails s'affichent dans le terminal ; en production, rien n'est écrit dans les logs (pas de lien de connexion en clair).

### Données et import
- **L'extract du lundi est cumulatif** depuis le 01/01/2025. Constat sur les fichiers fournis : l'extract CSV (05/10/2026) et l'onglet « 3. Métriques mensuelles » (12/10/2026) couvrent tous deux la période depuis le 01/01/2025. Entre les deux : 220 dossiers nouveaux, 17 changements de statut (surtout Devis/Demande → Abandonnée), 1 changement de montant, 7 changements d'encaissement.
- **Fusion par IDresa sans jamais supprimer** : un dossier absent de l'extract est conservé. Le résultat est donc juste que l'extract soit cumulatif ou partiel.
- **Lecture du fichier dans le navigateur**, envoi des dossiers par paquets de 5 000. Raison : Vercel limite le corps d'une requête à 4,5 Mo et l'extract fait 4,8 Mo. Effet secondaire utile : **seules les 14 colonnes connues sont envoyées**, aucune autre colonne (donc aucune donnée nominative) ne peut entrer dans la base.
- **Annulation** : chaque import garde l'état antérieur des dossiers qu'il a créés ou modifiés (`dossier_changes`). Seul le **dernier** import appliqué peut être annulé, par un super admin.
- Les agences de démo (`D01`, `D10`) ne sont pas signalées comme « agences inconnues ».
- **Comptes « hors export »** (SRV – Aéroport de Saint-Étienne, Chauchard Evasion) : créés avec les identifiants provisoires `HE01` et `HE02`, sans indicateurs tant qu'ils n'ont pas de dossiers. Pour les relier à leurs dossiers le jour où ils apparaissent dans l'extract, choisir « Rattacher à… » dans l'aperçu d'import.
- **Groupes** (APAS-BTP, NewTour, Quartier Libre, ResaReva, Visit Europe, Univairmer) : reconnus au nom du compte. L'estimation de VA n'est comptée qu'une fois dans les totaux (comptes secondaires = `va_global_estime_groupe` vide dans 04_clients.json). Chaque compte garde l'estimation du groupe pour sa propre « part captée », comme dans le cockpit d'origine.
- **Correspondance des colonnes** : mémorisée dans la table `parametres` (clé `import_mapping_dossiers`).

### Règles de calcul déduites de la recette
La recette retrouve **exactement** les 81 clients de 04_clients.json (santé, sous-scores, volumes, ratios, segment, risque, usage, alerte principale, nombre d'alertes et d'opportunités). Quatre règles n'étaient pas écrites dans 02_REGLES_DE_CALCUL.md ; elles ont été déduites des valeurs attendues :
1. **Fenêtres** : 12 mois = 365 jours glissants ; 90 j N-1 = même fenêtre décalée d'un an calendaire ; 30 j comparés aux jours 31 à 120.
2. **Dynamique sans base N-1** : 60 % des points si le client a du volume sur 90 j, sinon évolution considérée comme nulle (50 % des points, soit 12,5). Pour les 30 j : 60 % s'il y a du volume, sinon 0.
3. **Alertes « 30 derniers jours » et « volume quasi nul »** : non levées si le client a déjà l'alerte « aucun dossier depuis 30 jours ou plus » (il n'est plus « actif »).
4. **Opportunités** : « Conversion » ne se cumule pas avec « Usage à faire évoluer » ; un client Fantôme n'a pas d'opportunité « Potentiel non capté ». Libellé de l'alerte Fantôme : « Aucun dossier depuis plus de 12 mois ».

### Interface
- **Charte** : tokens dans `src/app/globals.css`. Police des titres **Outfit** (auto-hébergée) en attendant Silka : un seul token `--sr-font-titres` à changer. Logo provisoire en texte (« speed**resa** ») et favicon provisoire : à remplacer par les fichiers vectoriels officiels.
- Texte secondaire en `#5B6479` (gris foncé de la charte assombri) : le `#7B859B` de la charte n'atteint que 3,7:1 sur blanc, sous le seuil AA de 4,5:1 pour du texte courant.
- **Email récapitulatif après import** : envoyé aux super admins et aux CSM actifs (pas aux comptes lecture seule).
- **Rappel du lundi** : Vercel Cron à 10 h UTC (12 h à Paris en heure d'été, 11 h en hiver).
- **« 83 clients »** dans la phrase de synthèse : inclut les deux comptes hors export.
- Matrice **maturité × santé** : l'onglet est présent mais vide jusqu'aux premiers audits (étape 2). La vue santé × dynamique est affichée par défaut.

## Étape 2 — Audit manuel (16/10/2026)

### Score et règles
- Moteur pur dans `src/lib/audit/score.ts`, utilisé côté serveur et pour le **score en direct** dans le navigateur. Couverture = critères évalués ÷ critères applicables (les N.A. sont exclus des deux). Score « fiable » à partir de 70 % de couverture.
- **Score visé après actions** : CORRIGÉ compté à 100 % (comme la colonne « Score après action » de l'ancienne grille). Les actions du plan (étape 5) l'alimenteront ensuite.
- **Commentaire obligatoire** dans deux cas : quand on contredit un résultat automatique, et quand on retient pour un critère à seuil un autre statut que celui calculé à partir de la valeur saisie (sauf CORRIGÉ). Dans les autres cas, il est facultatif, y compris quand la réponse diffère du dernier audit.
- **Critères calculés sur les données** à la création de l'audit (étape A) : PERF-05 (ventes confirmées 90 j vs N-1, en nombre), PERF-06 (évolution du volume 90 j), PERF-12 (transformation 12 mois), RES-04 (RésaLive utilisé), RES-05 (erreurs RésaLive ; N.A. sans dossier RésaLive), SOC-07 (part des dossiers de 30 à 365 j encore en Devis / Demande de réservation / En demande, sur l'ensemble des dossiers de cet âge). Les 20 autres critères « Données Speedmedia » demandent des informations absentes de l'export (catalogue, PayBox, back-office…) : ils restent à saisir par le CSM.
- Les résultats automatiques sont des **propositions** : ils ne comptent dans le score qu'une fois validés (« Valider les N résultats sûrs » ou un par un).

### Écran de complétion
- Raccourcis : O, N, P, C, A, `?` (envoyer au client, Maj + , sur un clavier AZERTY), → / ← (passer / revenir), **I** (inchangé depuis le dernier audit), **V** (aller au champ valeur), Entrée dans le champ valeur (retenir le statut calculé), Ctrl + Entrée dans le commentaire, **H** pour l'aide. Écart : le cahier des charges proposait `?` pour l'aide, mais `?` sert déjà à « envoyer au client » ; l'aide est donc sur H.
- **Travail à plusieurs** : enregistrement critère par critère. Si un collègue a enregistré le même critère depuis que vous l'avez affiché, l'enregistrement est refusé et la carte propose « Garder sa réponse » ou « Remplacer par la mienne ». Synchronisation et présence (« Camille travaille aussi sur cet audit ») toutes les 6 s. Chaque enregistrement est conservé dans `evaluation_historique`.
- Un seul audit en cours (brouillon) par client : « Lancer l'audit » rouvre le brouillon existant. Un audit finalisé est en lecture seule ; l'auteur, la personne assignée ou un super admin peut le rouvrir.
- « Lancer l'audit » remplace provisoirement « Lancer le pré-audit » dans la liste : à l'étape 3, ce bouton lancera aussi le scan.

### Alertes issues de l'audit
- À la finalisation, le portefeuille est recalculé : « critère légal à NON au dernier audit » et « score de maturité en baisse de plus de 10 points entre les deux derniers audits finalisés » deviennent des alertes « À surveiller ».

### Import des anciens audits
- Les deux audits de l'onglet « 2. Grille de scoring » ont été extraits dans `data/kit/audits_v1.json` (34 critères v2 reliés par `ligne_grille_v1`). Ils sont importés automatiquement au déploiement, marqués « ancienne grille ».
- **Sourires du monde** : 18/06/2025, 12 critères renseignés (couverture 16 %, score non fiable).
- **Cannelle voyages** : date inconnue, importé à la date du jour avec une mention explicite. Conséquence : il compte comme « audité depuis moins de 6 mois » dans la couverture d'audit. Donnez-moi la date réelle pour corriger.
- Les scores ne sont pas comparables à l'ancienne grille sur 300 points : seuls les critères repris en v2 sont comptés.

### Export CSV
- Fichier `Audit-SpeedResa_<Client>_<pre-audit|audit-final>_<date de l'audit>.csv`. Un audit en cours est exporté comme pré-audit : on y reprend les réponses validées, à défaut les propositions automatiques, sinon « Non vérifié ».
- **Version client** : pas de valeur chiffrée pour les critères de source « Données » (ce sont des chiffres de vente), pas de commentaire, de source, de confiance ni d'auteur. Le constat et la recommandation sont générés par des phrases types ; ils seront rédigés par Claude à l'étape 5.
- **Priorité** : haute pour une obligation légale non remplie ou un NON sur un critère de 10 points ou plus ; moyenne pour les autres NON et les PARTIELLEMENT de 8 points ou plus ; basse sinon.
- « Envoyer au client » (email avec CSV et PDF) arrive avec la restitution (étape 5).

## Étape 3 — Pré-audit automatique, lot 1 (16/10/2026)

### Niveaux de maturité
- À votre demande, « Fantôme / Formule 1 pilotée en 4L / Formule 1 » deviennent **« Maturité faible »** (< 35), **« Maturité intermédiaire »** (35 à 72) et **« Maturité avancée »** (≥ 73). Les seuils sont inchangés. Le niveau est recalculé à partir du score : les audits déjà enregistrés s'affichent avec les nouveaux libellés. Le segment santé « Fantôme » (aucun dossier sur 12 mois) vient des règles du cockpit et n'a pas été modifié.

### Architecture
- Le moteur est dans `src/scan/`, sans dépendance à l'interface ni à la base :
  - `registry.ts` associe chaque critère à son détecteur (`src/scan/detecteurs/`) ;
  - `runner.ts` les exécute.
- Ajouter un critère = écrire un détecteur et l'ajouter au registre. Le même moteur sert l'app, le worker et la ligne de commande (`npm run scan -- https://…`). Il servira aussi l'auto-audit public.
- **Deux modes d'exécution** :
  - `SCAN_MODE=inline` (par défaut) : le scan tourne dans Vercel après la réponse (`after()`, 5 min max). **Vercel n'a pas de navigateur** : LEG-01 (cookies avant consentement), TRK-04 (Consent Mode) et TECH-05 (rendu mobile) passent en confiance basse ou en « non vérifiable », et il n'y a pas de capture d'écran.
  - `SCAN_MODE=worker` : le scan est mis en file (table `scan_runs`) et exécuté par un **worker Playwright séparé** (`Dockerfile.worker`, `scripts/scan-worker.ts`). Plusieurs workers peuvent tourner en parallèle (réservation `for update skip locked`).
- **Hébergement recommandé pour le worker : Fly.io, région Paris** (`fly.worker.toml`, environ 5 €/mois pour une machine de 1 Go). Alternatives UE : Railway (Amsterdam), Scaleway Serverless Containers (Paris).
- En local, Playwright est installé : les scans tournent avec navigateur, directement dans `npm run dev`.

### Politesse et sécurité
- User-agent `SpeedmediaAuditBot/1.0`, avec l'URL de `SCAN_CONTACT_URL`.
- 1 requête par seconde par domaine, 15 s maximum par page, 4 Mo maximum par réponse.
- Jamais de POST, aucun clic, aucune saisie : le navigateur observe la page telle qu'elle arrive. Les soumissions de formulaire sont bloquées par précaution. Le tunnel de réservation arrive au lot 2.
- **Site derrière authentification** (redirection vers /connexion ou /login, page avec mot de passe) : le scan s'arrête et tous les contrôles sont « non vérifiables ». Vérifié sur touloisirs.fr.
- **Protection contre les requêtes vers des adresses internes (SSRF)** : chaque URL et chaque redirection est résolue, et les adresses privées, locales ou de métadonnées cloud sont refusées.
- Seules les URL enregistrées pour le client peuvent être scannées. Une URL saisie par un CSM authentifié est d'abord ajoutée à la fiche.
- Un détecteur qui échoue passe en « non vérifiable » : le scan ne tombe jamais.

### Choix par critère (améliorations des méthodes de 03_criteres.json)
- **TECH-01** : certificat valide depuis plus de 30 jours, et redirection http → https. Certificat valide sans redirection = PARTIELLEMENT.
- **TECH-02** : interrogation RDAP via rdap.org. Si le registre ne publie pas la date d'expiration = non vérifiable.
- **TECH-03** : le domaine des emails est supposé être celui du site. DKIM est testé sur 16 sélecteurs courants ; s'il n'est pas trouvé, la confiance passe à moyenne (le statut n'est pas NON).
- **TECH-05** : balise viewport et débordement horizontal réel à 390 px (on tente de faire défiler la page). Le volet PageSpeed mobile est porté par PERF-10 et PERF-11.
- **TECH-06** : empreintes dans `config/empreintes.json`. **Première version déduite le 16/10/2026 de 6 sites clients, à valider par l'équipe technique** :
  - `/assets/js/module/search/engine/` : plateforme de site SpeedResa, présente sur la majorité des sites testés ;
  - `*.resatravel.com` : moteur de réservation hébergé ;
  - `speedmedia.fr` et « speedresa » : signaux moyens ;
  - concurrents : exemples à compléter.
- Les concurrents ne sont cherchés que dans le code exécuté (scripts, iframes, formulaires, requêtes), puis dans les liens, jamais dans les images. Cela corrige un faux positif sur Voyages Peirani : une photo produit hébergée sur la plateforme Orchestra d'un fournisseur.
- **Alerte rouge « module absent ou concurrent détecté »** : uniquement si la confiance est moyenne ou haute. Un contrôle sans navigateur ou un simple lien sortant ne déclenche pas d'alerte.
- **TRK-01** : si GA4 n'est pas dans la page, on lit le conteneur GTM public. Les dates du type « G-20250910 » sont exclues. Absence = confiance moyenne (GA peut n'être chargé qu'après consentement).
- **TRK-04** : on enregistre les appels `gtag('consent','default')` faits avant toute interaction et les paramètres `gcs`/`gcd` des requêtes Google. Aucune balise Google = N.A.
- **LEG-01** : on contrôle la présence d'une CMP (13 solutions reconnues), un bouton de refus au premier niveau (y compris dans les shadow DOM et les iframes), et l'absence de cookies et de requêtes de mesure ou de publicité avant consentement.
  - Matomo seul = PARTIELLEMENT, avec mention de l'exemption CNIL possible.
  - Aucun traceur et aucune bannière = OUI (confiance moyenne).
- **LEG-02, LEG-05, LEG-06** : analyse par motifs (n° IM suivi de 9 chiffres, garants connus, RC Pro, SIREN/RCS, hébergeur, médiateur, éléments RGPD). Confiance moyenne : la confirmation par Claude arrive au lot 2. Sans page de confidentialité dédiée, on retient la page qui en tient lieu (mentions, CGV ou page cookies).
- **VIS-07** : contrôle de robots.txt, du sitemap (déclaré ou aux chemins usuels, index de sitemaps suivi sur 3 fichiers), de la balise meta robots et de l'en-tête X-Robots-Tag. Les pages produits réellement indexées (requête `site:`) ne sont pas vérifiées : aucune API Google ne le permet proprement.
- **PERF-10 et PERF-11** : PageSpeed Insights mobile sur la page d'accueil (la fiche produit arrive au lot 2). **Sans clé, l'appel est quand même tenté**, mais le quota anonyme est presque toujours épuisé : ces critères restent « non vérifiables » tant que `GOOGLE_PAGESPEED_API_KEY` n'est pas renseignée.

### Test sur 5 sites réels (16/10/2026, mode navigateur)
| Site | Durée | Constats notables |
|---|---|---|
| souriresdumonde.com | 20 s | Module SpeedResa reconnu ; DMARC en p=none ; pas de sitemap ; pas de GA ni GTM ; débordement horizontal sur mobile |
| pretapartir.fr | 15 s | Moteur resatravel.com reconnu ; mentions complètes ; **pas de médiateur** ; Matomo actif avant consentement (bannière tarteaucitron) |
| amerikasia.fr | 19 s | **Nom de domaine expirant le 23/10/2026** ; DMARC absent ; mentions incomplètes (n° Atout France, garant) |
| ollandini.fr | 22 s | Mentions sans n° Atout France ni RC Pro (vérifié à la main) |
| touloisirs.fr | 0 s | Site derrière authentification : scan arrêté proprement |
| voyagespeirani.com (test dans l'app) | 19 s | GA4 sans GTM ; Consent Mode v1 ; traceurs sans bannière |

PERF-10 et PERF-11 sont restés « non vérifiables » faute de clé PageSpeed.

### Notification et durées
- Fin de scan : une notification apparaît dans l'app pour les scans lancés par l'utilisateur, même s'il a quitté la page de suivi (vérification toutes les 15 s).
- Les durées sont mesurées et stockées (début et fin de chaque scan, durée de chaque contrôle). Leur affichage dans l'administration arrive à l'étape 7.
- Un scan bloqué plus de 10 minutes (fonction interrompue) est marqué « interrompu ».

## Étape 4 — Pré-audit automatique, lot 2 (17/10/2026)

Les **36 critères Auto** du référentiel ont maintenant un détecteur (15 au lot 1, 21 au lot 2). Un test vérifie que le registre couvre exactement les critères « Auto » de 03_criteres.json.

### Fiches produits
- Sur les sites SpeedResa, les fiches suivent le gabarit `/produit/package/<id>-<source>/<titre>/from-…/date-AAAA-MM-JJ/…`. Les offres de l'accueil sont chargées en JavaScript : **le navigateur est nécessaire** pour les trouver (sans navigateur, seuls les liens présents dans le HTML sont lus).
- Les 3 premières fiches de l'accueil sont analysées ; s'il y en a moins de 3, le scan complète avec la première page de résultats du moteur.
- **Texte propre à la fiche** = lignes absentes de la page d'accueil (menu et pied de page retirés), pour mesurer la longueur du descriptif et comparer les fiches entre elles.
- **PROD-03** : photos de largeur réelle ≥ 1 200 px (mesurée dans le navigateur, logos et pictos exclus), descriptif ≥ 1 500 caractères, 5 blocs (programme, prix, inclus, non inclus, dates), unicité (similarité < 30 % entre fiches). Constat : les photos des catalogues TO sont souvent servies en 825 px, d'où beaucoup de fiches « photos HD insuffisantes ». Le seuil de 1 200 px vient du référentiel ; il est facile à ajuster si vous le jugez trop strict.
- **PROD-04** : le top 5 vient de la colonne « Voyage » de l'extract (dossiers confirmés d'abord, 12 mois). Les produits sont retrouvés sur le site par ressemblance de titre ; s'ils ne sont pas tous retrouvés, confiance basse.
- **PROD-09** : une date de départ passée dans l'URL d'une offre de l'accueil suffit à conclure NON (cas fréquent des offres oubliées). « Complet » n'est retenu qu'au sens « plus de place » (« centre complet » ou « programme complet » sont ignorés : faux positif constaté sur un vrai site).

### Analyse par Claude
- Utilisée si `ANTHROPIC_API_KEY` est définie, modèle `ANTHROPIC_MODEL` (par défaut `claude-sonnet-5-5`). Pour LEG-02 (mentions légales), LEG-06 (confidentialité), LEG-04 (CGV et Code du tourisme), PROD-03/04 (texte générique de catalogue) et INN-01.
- Sortie structurée : outil imposé dont le schéma est généré à partir d'un schéma Zod, réponse revalidée par ce même schéma. Le texte des sites est passé entre balises `<document>`, avec la consigne explicite de ne jamais suivre d'instruction qu'il contiendrait.
- **Sans clé**, chaque critère garde son analyse par motifs (preuve marquée « Analyse par motifs ») : le scan ne tombe jamais.
- **INN-01** (visibilité dans les moteurs de réponse IA) : Claude déduit la ville et la destination phare, puis pose jusqu'à 3 questions métier avec l'outil de recherche web. L'agence est « citée » si son domaine ou son nom apparaît dans la réponse ou les sources. Confiance basse (les réponses varient d'une fois à l'autre). Coût : environ 3 recherches web par scan ; désactivable avec `SCAN_VISIBILITE_IA=non`.

### Google Places
- API Places (New), clé `GOOGLE_PLACES_API_KEY` transmise en en-tête, jamais dans l'URL.
- Recherche « nom de l'agence + agence de voyages », puis par domaine. La fiche retenue est celle **dont le site web est celui du client** (confiance haute, et son identifiant est enregistré sur le client) ; à défaut, le premier résultat, en confiance basse « à confirmer ».
- L'identifiant de fiche est modifiable sur la fiche client (« Fiche Google (identifiant Places) ») : le CSM peut corriger une mauvaise correspondance.
- **VIS-03** (réponse aux avis) : l'API Google ne renvoie pas les réponses du propriétaire. Le critère reste « non vérifiable », avec le lien vers la fiche pour un contrôle manuel.

### Parcours du tunnel (PERF-01, et aide pour LEG-03, LEG-07, PERF-14)
- **Désactivé par défaut** (`SCAN_TUNNEL=oui` pour l'activer). Raison : sur les sites SpeedResa, le bouton « DEVIS / RÉSERVATION » puis « Valider » des critères de voyage pourrait créer une **demande de devis réelle** chez le client, donc un faux dossier dans ses statistiques. Je n'ai pas exécuté ce parcours sur un vrai site.
- Garde-fous du parcours :
  - aucune saisie au clavier, aucun champ rempli ;
  - seuls les boutons « Réserver / Voir les tarifs / Continuer / Choisir / Valider (dans une fenêtre sans champ texte) » sont cliqués, jamais « Envoyer, Payer, Confirmer, Commander, Contact » ;
  - arrêt dès qu'apparaissent des champs de coordonnées ou de paiement (le formulaire « Demande d'informations » déjà présent sur la fiche est ignoré) ;
  - **au niveau réseau**, toute requête d'écriture vers le site est bloquée sauf les lectures de prix, de disponibilités ou de recherche, et toute écriture vers un tiers est bloquée sauf la mesure d'audience.
- Testé sur une copie locale d'un tunnel : options atteintes, assurance trouvée, les 2 tentatives d'écriture (réservation, devis) bloquées avant le serveur, formulaire de contact jamais soumis.
- **Proposition** : un essai supervisé avec vous sur un site que vous choisissez (idéalement un compte de démonstration SpeedResa), en vérifiant ensuite dans SpeedResa qu'aucun devis n'a été créé. Puis activation.

### Autres choix par critère
- **TECH-04** : le worker teste la page d'accueil de chaque client **toutes les 15 minutes** (un 401/403 compte comme disponible : le site répond). Historique de 90 jours. Avant 30 jours de mesures : « en cours de mesure » avec le taux provisoire. Sans worker : route `/api/cron/disponibilite` (Vercel Cron toutes les 15 min = offre Pro, ou planificateur externe).
- **TRK-02** : l'achat ne s'observe que sur la page de confirmation, jamais atteinte. Le scan cherche une **balise d'événement « purchase » réellement configurée** dans le conteneur GTM ou le code (le code standard de Google contient toujours le mot « purchase » : faux positif évité). Résultat au mieux PARTIEL, à confirmer par le CSM.
- **TRK-05** : pixels lus aussi dans le conteneur GTM public (ils ne se chargent souvent qu'après consentement). L'API Conversions Meta n'est pas détectable : question au client.
- **LEG-07** : une réduction est un prix barré réel (`<del>`, « au lieu de 628 € », « -20 % »), pas le mot « promotion » (« taxes de promotion touristique » : faux positif constaté). La cohérence avec le prix du tunnel reste à vérifier par le CSM tant que le tunnel est désactivé.
- **LEG-08** : les étoiles des hôtels et le mot « témoignage » seul ne sont pas des avis clients (faux positif constaté). Sans avis affiché : N.A.
- **LEG-09** : axe-core (WCAG 2.1 A/AA) est lancé sur l'accueil ; le nombre d'erreurs critiques et graves est la valeur mesurée. Le statut dépend de la déclaration d'accessibilité ; l'exemption micro-entreprise reste une question client.
- **LEG-04** : des CGV publiées seulement en PDF ne sont pas analysées (« non vérifiable », lien fourni) ; aucun PDF n'est plus lu comme une page (faux positif constaté).
- **INN-05** : OUI si une empreinte carbone chiffrée ou un label (ATR, Travelife, Clef Verte…) est affiché ; une simple mention « émissions de CO2 » donne PARTIEL.

### Test sur 5 sites réels (17/10/2026, mode navigateur, sans clés Google ni Anthropic, tunnel désactivé)
| Site | Durée | Constats notables du lot 2 |
|---|---|---|
| rhinos-evasion.fr | 85 s | Aucune donnée structurée ; photos 825 px ; événement d'achat GA4 configuré dans GTM (avec valeur) ; pixel Google Ads sans Meta ; 31 erreurs d'accessibilité |
| voyagespeirani.com (dans l'app) | 52 s | Formulaire d'information standard seulement dans les CGV ; CGV complètes ; pas de pixel ; acompte mais pas de paiement en plusieurs fois |
| borneovoyages.fr | 68 s | Prix barrés « au lieu de… » sans prix de référence 30 jours (Omnibus) ; fiches complètes ; pas de GA4 |
| cannelle-voyages.fr | 75 s | Aucun réseau social lié ; fiches sans blocs « inclus / non inclus » |
| ollandini.fr | 130 s | Pas de page CGV trouvée ; formulaire d'information standard absent |

Durée totale : 52 à 136 s, sous l'objectif de 3 minutes. Avec PageSpeed, Claude et la recherche IA, compter environ 1 minute de plus.

## Étape 5 — Restitution, plan d'action, PDF, email de RDV (17/10/2026)

### Sur la fiche client
- **Audit de référence** : le dernier audit finalisé, à défaut le pré-audit en cours. Pour un pré-audit, le résultat automatique tient lieu de réponse tant que le CSM n'a pas répondu (comme l'export CSV).
- **Maturité par pilier** comparée à la moyenne du portefeuille et à celle des Champions (dernier audit finalisé de chaque client). Les moyennes ne s'affichent qu'à partir de **3 audits** : avec 2 audits aujourd'hui, elles sont masquées.
- **« Pourquoi ce client sous-performe »** (§ 7) :
  - les indicateurs en retard viennent des données SpeedResa : volume 90 j ≤ −15 % ou 30 jours sans dossier, transformation < 20 %, erreurs RésaLive ≥ 5 % ou annulations ≥ 15 %, et le risque légal ;
  - ils sont croisés avec les critères d'audit à NON ou partiels de chaque levier ;
  - les leviers trafic, conversion et abandon panier attendent l'import du trafic mensuel ;
  - le bloc est interne et n'est jamais envoyé au client.
- **Plan d'action** :
  - impact = points du critère × part manquante (NON 1, partiel 0,5) × poids du levier en retard (3 critique, 2 en retard, 1 sinon) ;
  - priorité = impact ÷ effort (faible 1, moyen 2, fort 3) ; les obligations légales à NON passent toujours en tête ;
  - l'effort de chaque offre est une première estimation, à valider, dans `config/offres.json` ; il sera modifiable dans l'administration à l'étape 7.
- **Plan recommandé** = toutes les obligations légales + les **8 actions les plus prioritaires** (les suivantes s'ajoutent par 5). Sans cette limite, le « score visé » atteignait 100/100, ce qui n'a pas de sens.
- **Score visé après actions** : critères couverts par une action non abandonnée (avant création du plan, ceux du plan recommandé) comptés comme corrigés.
- **Action « faite » → re-vérification** :
  - critère avec contrôle automatique : scan ciblé sur ce seul critère, résultat affiché sur l'action ;
  - critère « Données Speedmedia » : recalcul immédiat sur le dernier export ;
  - autre critère : « à confirmer au prochain audit ».
- **Alertes légales** : bloc rouge, un texte prêt à envoyer par point (critère, constat, référence réglementaire, recommandation) et la mention « indications, pas un avis juridique ».
  - Les références (Code du tourisme, Code de la consommation, RGPD, EAA, DSP2…) sont dans `src/lib/restitution/textes.ts`.
  - **À faire valider par votre juridique** ; elles deviendront éditables dans l'administration (étape 7).

### PDF de restitution
- **Rendu en JavaScript pur (@react-pdf/renderer) au lieu de Playwright**. Raison : Vercel n'a pas de navigateur. Ce choix permet un PDF généré partout, en moins d'une seconde, sans dépendre du worker.
- Polices Outfit et Open Sans embarquées (licence OFL).
- 2 à 4 pages :
  1. score, statut, score visé, couverture, synthèse, barres par pilier ;
  2. points forts, évolution depuis l'audit précédent, plan d'action ;
  3. points légaux, si le client en a.
- **Construit uniquement à partir d'un « modèle client »** qui ne contient ni score santé, ni risque, ni alertes de départ, ni chiffres de vente, ni commentaire interne, ni niveau de confiance. Un test le vérifie.
- L'aperçu s'affiche dans la page « Préparer le RDV ». Seul ce PDF peut être affiché dans un cadre, et uniquement depuis l'application (`SAMEORIGIN`) ; tout le reste reste en `DENY`.

### Textes, email et rendez-vous
- **« Rédiger avec Claude »** produit en un appel structuré :
  - l'explication interne et le plan sur 30 jours ;
  - la synthèse du PDF ;
  - l'objet et le corps de l'email.

  Les données internes sont passées dans un document séparé, avec la consigne de ne jamais les citer côté client. **Sans clé Anthropic**, des modèles de texte prennent le relais. Tout est modifiable et enregistré avant envoi.
- **Envoi au client** :
  - email aux couleurs SpeedResa, avec le PDF et, au choix, le CSV « version client » en pièces jointes ;
  - les réponses du client arrivent au CSM ;
  - 5 destinataires maximum, avec confirmation avant envoi ;
  - chaque envoi est tracé (historique du client et journal).
- **Rendez-vous** : date et heure saisies en heure de Paris, objet, notes internes. L'historique de la relation (RDV, envois) est sur la page « Préparer le RDV ». Les questionnaires s'y ajouteront à l'étape 6.

### Vérifications
- Test de bout en bout, exigé par la spec, sur une base en mémoire. Il enchaîne :
  1. pré-audit réel sur une page d'exemple servie en local ;
  2. validation des résultats sûrs, réponses du CSM et finalisation ;
  3. restitution (leviers, plan, score visé) ;
  4. création du plan et re-vérification des 3 types d'actions ;
  5. textes ;
  6. contrôle qu'aucune donnée interne n'apparaît dans le modèle client ;
  7. PDF ;
  8. envoi tracé.
- Vérifié dans l'application sur Voyages Peirani :
  - plan recommandé de 14 actions ;
  - 6 alertes légales ;
  - score visé 89/100 pour 46/100 aujourd'hui ;
  - aperçu PDF ;
  - RDV enregistré.
- **Non vérifié** :
  - la rédaction réelle par Claude, faute de clé : seuls le schéma et les modèles de repli sont testés ;
  - l'envoi réel par Resend, faute de clé : en local l'email est écrit dans la console ;
  - le PDF sur Vercel : il fonctionne en local et au build, avec les polices bien incluses dans la fonction.

## Étape 6 — Questionnaire client (17/10/2026)

### Questions
- Le questionnaire complète l'**audit en cours** (à défaut, le dernier audit). Il contient :
  - les critères de source « Client » auxquels le CSM n'a pas déjà répondu ;
  - les critères que le CSM a marqués « envoyer au client » (touche `?` dans l'audit).
- Libellés, dans l'ordre :
  1. règle propre au critère (`config/questionnaire.json`) ;
  2. `question_client` du référentiel ;
  3. reformulation par Claude, mise en cache (paramètre `questions_client_ia`) ;
  4. à défaut, « Ce point est-il en place dans votre agence : … ? ».
- Types de réponse : Oui / En partie / Non / Je ne sais pas, un nombre (VIS-05), un pourcentage (PROD-01), une note sur 10 (REL-02). Une précision facultative est possible pour chaque question.
- **Interprétation** (`config/questionnaire.json`) :
  - Oui → OUI, En partie → PARTIEL, Non → NON par défaut ;
  - les seuils du référentiel s'appliquent aux nombres et aux notes ;
  - cas particuliers :
    - LEG-09 : « moins de 10 salariés et 2 M€ » → **N.A.** (exemption), sinon c'est le contrôle automatique qui décide ;
    - TRK-05 : « pas de publicité en ligne » → **N.A.** ;
    - VIS-05 : 2 publications ou plus → OUI, 1 → PARTIEL.

### Lien magique (client sans compte)
- Lien personnel `/q/<jeton>`, valable **30 jours**. Une fois les réponses envoyées, le lien est clos : il affiche un remerciement et n'est plus modifiable.
- Créer un nouveau questionnaire **annule** le lien précédent.
- **Le jeton n'est jamais stocké.** Il est dérivé de `AUTH_SECRET` et d'un nonce (HMAC) ; la base ne garde qu'une empreinte. On peut ainsi recopier le lien ou le renvoyer dans une relance, sans qu'une fuite de la base suffise à ouvrir les questionnaires.
- Page publique sans menu ni donnée interne :
  - le client voit le nom de son agence, le prénom de son CSM, ses questions et ses réponses ;
  - un test vérifie qu'aucun score, risque ni alerte n'est exposé ;
  - la page n'est pas indexée et ne transmet pas de référent (`no-referrer`).
- Mobile d'abord : grandes cases, barre de progression collante, **sauvegarde automatique** de chaque réponse. Le client peut s'arrêter et reprendre, et peut envoyer même s'il n'a pas tout rempli.

### Report dans l'audit
- Sur un audit en cours, la réponse devient le statut du critère (source « client », commentaire « Réponse client du … »), sauf si le CSM l'a déjà tranché.
- Exception : un « N.A. » du client l'emporte sur un résultat automatique (ex. pas de publicité → pixels sans objet).
- Dans les autres cas, la réponse est ajoutée en commentaire, à arbitrer par le CSM : CSM déjà passé, réponse informative, audit finalisé.
- Le CSM peut toujours corriger. L'historique de l'évaluation trace la réponse.
- Le CSM reçoit un email à la réception des réponses.

### Envoi et relances
- Depuis la fiche client, deux possibilités : « Envoyer le questionnaire » par email, aux couleurs SpeedResa, ou « Créer le lien sans envoyer » pour le copier.
- On peut aussi renvoyer l'invitation, éventuellement à une autre adresse, ou annuler le questionnaire.
- Suivi visible : envoyé le, ouvert le, réponses en cours (x/N), relances prévues ou envoyées, réponses reçues.
- **Relances automatiques à J+3 et J+7** après l'envoi, une seule fois chacune, par la tâche planifiée quotidienne `/api/cron/relances-questionnaires` (Vercel Cron à 8 h UTC, compatible avec l'offre gratuite).

### Vérifié
- 10 tests : choix des questions, validation, interprétation, création et jeton non stocké, vue client sans données internes, sauvegarde, report dans l'audit, lien clos, annulé et expiré, relances J+3 et J+7, libellés de toutes les questions.
- Dans l'application, sur Voyages Peirani :
  - lien créé (11 questions) ;
  - formulaire sur mobile ;
  - 2 réponses sauvegardées et retrouvées après rechargement, suivi « 2/11 » côté CSM ;
  - annulation, puis lien refusé.
- Je n'ai pas envoyé de réponses depuis l'interface, pour ne pas écrire de fausses réponses dans l'audit local : ce cas est couvert par les tests.
- **Non vérifiés** : l'envoi réel des emails (sans clé Resend, ils sont écrits dans la console) et la reformulation par Claude (sans clé).

## Étape 7 — Pilotage, administration, scans planifiés et monitoring (17/10/2026)

### Pilotage (menu « Pilotage », tous les rôles)
- **File « À faire cette semaine »** en tête du portefeuille : les clients du CSM connecté, ou tout le portefeuille pour le super admin et pour un CSM sans client attribué. Elle regroupe :
  - les clients critiques sans RDV, à venir ou tenu dans les 30 derniers jours ;
  - les audits à relancer : brouillon sans modification depuis 14 jours, ou client à risque dont le dernier audit a plus de 6 mois ;
  - les questionnaires sans réponse depuis plus de 3 jours ;
  - les points légaux à NON pas encore envoyés au client.

  Les clients jamais audités n'y figurent pas, sinon la liste doublait celle des critiques : ils sont suivis par l'indicateur « couverture d'audit ».
- **Fil des alertes** : alertes ouvertes et closes sur 60 jours, filtres par niveau, origine (données, audit, scan / monitoring), état et CSM.
- **Benchmark (§ 7)** :
  - les 5 critères qui distinguent le plus les Champions (taux de OUI au dernier audit) ;
  - un nuage maturité × évolution 90 j ;
  - pour chaque critère, l'évolution moyenne des clients OUI vs NON, avec les effectifs et l'avertissement « corrélation, pas causalité » sous 10 clients.

  Avec 2 audits aujourd'hui, la page le dit clairement. Le **manque à gagner** attend l'import du trafic mensuel.
- **Opportunités consolidées** : celles des données SpeedResa et les actions ouvertes des plans d'audit, filtrables par type, offre, origine et CSM, avec le décompte des offres les plus demandées.

### Email du lundi
- Toujours envoyé après l'import, le lundi matin. Il contient désormais :
  - une partie commune : chiffres, nouveaux critiques, chutes, reprises, modules SpeedResa disparus, sites inaccessibles et nouveaux critères légaux à NON de la semaine ;
  - la **file « À faire » personnelle** de chaque destinataire.

### Administration (super admin)
- **Critères**, versionnés :
  - modifier = créer la version suivante ; les audits passés gardent leur version ;
  - désactiver, ou ajouter un critère (identifiant `PILIER-NN`) ;
  - garde-fous : un critère à seuil exige un sens et deux seuils ; les points vont de 0 à 50.
- **Paramètres de calcul** :
  - 45 seuils et poids (score santé, segments, alertes, opportunités), en pourcentage, euros ou jours, avec la valeur d'origine rappelée ;
  - l'enregistrement recalcule tout le portefeuille, et un bouton rétablit les valeurs d'origine ;
  - **attention** : la recette de non-régression (04_clients.json) est établie avec les valeurs d'origine.
- **Offres et effort** (63 offres) : faible, moyen ou fort, pour la priorisation des plans d'action.
- **Empreintes TECH-06** : SpeedResa (force forte ou moyenne) et concurrents, avec la case « à valider par l'équipe technique ». Elles s'appliquent aux scans suivants ; un bouton revient au fichier d'origine.
- **Textes légaux** : la référence réglementaire de chaque obligation légale, reprise dans les alertes et le PDF.
- **Supervision** :
  - durées mesurées : pré-audit (médiane, part sous 3 min) et complétion (temps actif, part sous 10 min) ;
  - rescan mensuel, avec un bouton « Lancer maintenant » ;
  - disponibilité des sites sur 30 jours ;
  - **export CSV du portefeuille** (données internes, réservé au super admin).
- Sont déjà en place depuis l'étape 1 : utilisateurs, attribution des CSM, réattribution des clients d'un CSM qui part, import des exports et journal d'activité.

### Scans planifiés et monitoring
- **Rescan léger mensuel** le 1er du mois (cookies, mentions légales, module SpeedResa, certificat, PageSpeed) de chaque site principal.
  - Avec le worker, les scans passent tout de suite.
  - Sans worker, la tâche de nuit `/api/cron/scans` traite la file environ 5 minutes par nuit. Un scan léger dure de 10 s à 1 min : comptez quelques nuits pour les 80 clients.
  - Les alertes sont recalculées une seule fois, en fin de campagne.
- **Monitoring de disponibilité** : toutes les 15 minutes par le worker.
  - 4 échecs consécutifs (1 h) ouvrent une alerte rouge « Site inaccessible depuis le … » ; le client passe critique.
  - Au retour du site, l'alerte se ferme.
  - Les alertes ne sont recalculées que si un site tombe ou revient.
- **Tâches planifiées Vercel** :

  | Tâche | Fréquence |
  |---|---|
  | Rappel d'import | lundi 10 h UTC |
  | Relances des questionnaires | tous les jours, 8 h |
  | Rescan mensuel | le 1er du mois, 3 h |
  | Traitement de la file de scans | tous les jours, 3 h 30 |

  Toutes respectent la limite de l'offre gratuite (une exécution par jour au plus). Le monitoring toutes les 15 minutes nécessite le worker, ou l'offre Pro avec la route `/api/cron/disponibilite`.

### Vérifié
- 9 tests :
  - libellés des paramètres ;
  - critères versionnés et désactivés ;
  - surcharge des empreintes et des textes légaux ;
  - alerte « site inaccessible » ouverte puis fermée ;
  - file « À faire » (critiques et RDV, points légaux et envoi, questionnaires, périmètre d'un CSM) ;
  - benchmark, opportunités et durées ;
  - rescan sans doublon ;
  - export CSV ;
  - email du lundi.
- Dans l'application : file « À faire » (33 critiques sans RDV, 1 audit à refaire), fil d'alertes (36 critiques, 38 à surveiller), benchmark avec l'avertissement d'effectif, 104 opportunités, 77 critères, 45 paramètres, supervision (pré-audit médian 19 s), export de 84 clients.
- **Non vérifiés** : exécution réelle des tâches planifiées sur Vercel, et monitoring réel (le worker n'est pas déployé).

## Ajouts avant déploiement — nouveaux clients, trafic et conversion (17/10/2026)

### Nouveau client
- **Administration → Clients** (ou « + Nouveau client » sur le portefeuille, pour le super admin) : créer un client avec son IDagence SpeedResa, ou un **identifiant provisoire** (NC01, NC02…) s'il n'est pas encore connu. Champs : nom, groupe, modèle de distribution, site, CSM, email, VA estimé et « compté dans les totaux ».
- Tant qu'il n'a pas de dossiers, le client est marqué « hors export » : il n'est **pas noté** (pas d'alerte « aucun dossier »), mais on peut déjà l'auditer et lui envoyer un questionnaire.
  - Dès ses premiers dossiers, il est noté normalement.
  - S'il a été créé avec un identifiant provisoire, on rattache son vrai IDagence dans l'aperçu de l'import du lundi (« Rattacher à… »).
- **Nom, groupe et modèle se modifient sur la fiche client** : taper un nom de groupe inconnu le crée. La case « VA compté dans les totaux » sert aux comptes secondaires d'un groupe. Un client peut aussi être désactivé ou réactivé.
- Pour le site, seul le format est vérifié à la création ; le contrôle de sécurité (adresse publique) est fait à chaque scan.

### Trafic mensuel (Imports → « Trafic mensuel des sites »)
- Lecture de l'onglet « 4. Métriques GTM », ou de tout tableau « nom du client | mois… ».
  - Mois reconnus : « May », « mai 2026 », « 2026-05 », « 05/2026 », dates Excel.
  - **Année des colonnes sans année** : déduite de la date des données (2026 pour mai à septembre avec des données au 12/10/2026), modifiable dans l'aperçu.
- **Les 0 et les cellules vides valent « non mesuré »** : un site en ligne n'a jamais zéro visite. Ces zéros correspondent aux mois où le marqueur n'était pas encore posé, et les compter fausserait la conversion.
- **Rapprochement des noms** :
  - par nom exact, par mots (« Aéroport de Toulouse » → Aéroport Toulouse Blagnac) et par domaine du site (« SejoursVoyages » → SVC Voyages Cagnes, sejoursvoyages.com) ;
  - les rapprochements incertains sont marqués « à confirmer » ; les comptes de démo (D01) sont ignorés ;
  - **les choix sont mémorisés** pour les imports suivants, y compris « ignorer » ;
  - plusieurs lignes vers un même client s'additionnent.
- Sur le fichier réel, les 13 lignes sont rapprochées correctement : 10 clients, la ligne de démo ignorée, 1 ligne à confirmer (`sejours.toulouse.aeroport.frToulouse`, 5 visites).

### Conversion et manque à gagner (§ 7)
- **Conversion** = dossiers confirmés ÷ visites, sur les mois complets mesurés des 12 derniers mois. On affiche aussi la conversion des demandes (dossiers hors annulations ÷ visites).
  - **Limite** : les dossiers saisis en agence sont comptés avec ceux du site, la conversion est donc un **majorant**.
  - Distinguer les dossiers web demandera une information d'origine dans l'extract, ou les achats GA4.
- **Référence** = médiane des **Champions** (au moins 3 avec 100 visites par mois ou plus), à défaut celle du portefeuille (au moins 5 clients).
- **Manque à gagner mensuel (estimation)** = (référence − conversion du client) × visites mensuelles × panier moyen confirmé. Il est affiché sur la fiche client, dans le benchmark (total et top 10) et dans l'export du portefeuille. C'est une donnée interne, absente du PDF client.
- **Levier « conversion faible »** : il s'active sous 70 % de la référence (critique sous 40 %), dans « Pourquoi ce client sous-performe » et dans la priorisation du plan d'action (PERF-10/11, PROD-03/04, PERF-02, PERF-14, TECH-05).
- Le levier « abandon panier » reste inactif : l'onglet GTM ne contient que des visites, pas l'entonnoir de réservation.
- Graphique mensuel de la fiche client : les visites apparaissent sur un second axe.
- Premier résultat sur les données réelles :
  - PERIER Voyages : 8 428 visites par mois, 0,10 % de conversion, au niveau de la référence ;
  - Top of Travel : 0,06 %, soit un manque estimé de 4,5 k€ par mois ;
  - total portefeuille : 4,7 k€ par mois sur 3 clients.

### Vérifié
- 10 tests : en-têtes de mois, année par défaut, lecture de l'onglet réel, rapprochement sur les vrais clients, mémorisation, calcul de conversion (mois incomplets et anciens exclus), référence Champions ou portefeuille, levier, import en base, création de client provisoire, groupe, désactivation.
- **202 tests au total**, recette de non-régression intacte.

## Points ouverts (à trancher avec vous)
- **Adresse du super admin** : à saisir dans `SUPERADMIN_EMAIL` sur Vercel.
- **Date réelle de l'audit Cannelle voyages** : importé à la date du 16/10/2026 faute de mieux.
- **Hébergement du worker de scan** : Fly.io Paris recommandé (voir étape 3). Sans worker, les scans tournent sur Vercel sans navigateur.
- **Clé Google PageSpeed** : indispensable pour PERF-10/11 (gratuite, console Google Cloud).
- **Fichiers de police Silka, logo vectoriel**.
- **Clés d'API** : Google Places (VIS-01 à VIS-03) et Anthropic (analyse des textes, INN-01). Sans elles, ces critères restent en analyse par motifs ou « non vérifiables ».
- **Parcours du tunnel** : essai supervisé à faire avec vous avant d'activer `SCAN_TUNNEL=oui` (voir étape 4).
- **Références réglementaires des alertes légales** (`src/lib/restitution/textes.ts`) : à faire valider par votre juridique.
- **Source des chiffres de l'onglet « 4. Métriques GTM »** : à préciser, pour automatiser l'import (connecteur GA4 ou conteneur commun) au lieu du dépôt manuel.
- **Interprétation des réponses client** (`config/questionnaire.json`) et durée de validité du lien (30 jours) : à valider.
- **Effort des 63 offres** (`config/offres.json`) : première estimation à valider.
- **Seuil photos HD de PROD-03** (1 200 px) : à confirmer, la plupart des photos de catalogue font 825 px.
- **Empreintes TECH-06** : première version dans `config/empreintes.json`, à valider par l'équipe technique (concurrents à compléter).
- **Git** : les outils en ligne de commande d'Apple (Xcode) ne sont pas installés sur ce Mac, donc le projet n'est pas encore un dépôt Git.

## Connecteur Google Analytics 4 (19/10/2026)

- **Une seule propriété** GA4 réunit les sites de tous les clients ; chaque événement porte le paramètre **« Nom du client »** (dimension personnalisée de portée Événement). La dimension est détectée automatiquement (libellé « Nom du client », ou nom technique `customEvent:nom_du_client`) et reste modifiable dans **Administration → Google Analytics**.
- **Accès** : compte de service `audit-csm@audit-speedresa.iam.gserviceaccount.com`, rôle Lecteur, portée `analytics.readonly`. La clé JSON est lue depuis `GA4_CREDENTIALS` (Vercel) ou `GA4_CREDENTIALS_FILE` (local) ; elle n'est jamais affichée, journalisée ni versionnée. Jeton signé localement (RS256), sans dépendance ajoutée.
- **Relevé** : 13 derniers mois complets, par mois et par client : sessions (→ `visites`), événements `begin_checkout` et `purchase` (noms modifiables), `purchaseRevenue`. Le 2 de chaque mois à 5 h (cron `/api/cron/ga4`), ou à la demande.
- **Rattachement** : identifiant client exact, sinon mêmes règles et **mêmes correspondances mémorisées** que le fichier GTM. Le relevé automatique n'écrit que les valeurs sûres ; une valeur incertaine reste « à rattacher » jusqu'à validation par un super admin. Les sessions sans nom du client (`(not set)`) sont ignorées et comptées à part.
- **Priorité** : un mois mesuré par GA4 n'est jamais écrasé par le fichier GTM ; « Effacer le trafic » ne touche que le fichier. Le bouton « Supprimer les mesures Google Analytics » permet de revenir au fichier.
- **Nouveaux indicateurs** (fiche client, bloc Trafic) : conversion web = achats ÷ sessions ; abandon panier = 1 − achats ÷ débuts de réservation (au moins 30 débuts sur la période) ; CA web mensuel ; origine des visites. La conversion « confirmés ÷ visites » et le manque à gagner restent calculés comme avant, pour rester comparables entre clients GA4 et fichier.
- **Levier « Abandon panier élevé »** désormais actif : au-dessus de la médiane du portefeuille + 10 points (critique à + 20 points), ou au-dessus de 90 % tant que moins de 5 clients sont mesurés.
- **À vérifier sur les vraies données** : que le module SpeedResa envoie bien `begin_checkout` et `purchase` (sinon, renseigner les noms réels des événements dans l'écran) et que « Nom du client » est rempli sur ces événements.

## Compte de test sans lien magique (19/10/2026)

- Pour tester sans boîte mail : `TEST_LOGIN_EMAIL` + `TEST_LOGIN_PASSWORD` (16 caractères au moins) activent sur la page de connexion un bouton discret « Connexion avec le compte de test » (email et mot de passe). Sans ces variables, rien n'apparaît et rien n'est accepté.
- Rôle `TEST_LOGIN_ROLE` (super admin par défaut). Le compte est créé au premier usage et apparaît dans « Utilisateurs » ; s'il y est désactivé, il reste bloqué.
- Comparaison en temps constant ; 5 échecs en 15 minutes bloquent la connexion de test pendant 15 minutes ; chaque connexion est journalisée (méthode « test »).
- À supprimer quand les vrais comptes fonctionnent : c'est un accès par mot de passe, moins sûr que le lien magique.

## Identifiant et mot de passe par utilisateur (20/10/2026)

- **Connexion principale** : identifiant = adresse email, mot de passe. Le lien par email reste disponible (« Recevoir plutôt un lien »), le compte de test aussi.
- **Création par le super admin** (Utilisateurs → « Créer un mot de passe ») : mot de passe provisoire saisi, ou généré si le champ reste vide (format `Kp7m-Xq2r-Tz9w-Hn4c`, environ 90 bits). Affiché **une seule fois**, avec un bouton qui copie identifiant et mot de passe. « Réinitialiser » remplace l'ancien et ferme les sessions de l'utilisateur.
- **Première connexion** : avec un mot de passe provisoire, toutes les pages renvoient vers « Choisissez votre mot de passe » (et les actions sont refusées) tant qu'il n'est pas remplacé. Ensuite, l'icône clé de l'en-tête permet de le changer ; les autres sessions sont alors fermées.
- **Règles** : 12 caractères au moins, pas l'identifiant, pas de mot de passe évident. Stockage scrypt salé (N = 2^15), jamais en clair ; comparaison en temps constant, durée de réponse identique pour une adresse inconnue.
- **Anti-force brute** : 5 échecs en 15 minutes sur une adresse bloquent les essais 15 minutes (100 échecs tous comptes confondus bloquent tout le monde 15 minutes). Échecs, créations et changements sont journalisés.

## Lot A — retours du test du 22/10/2026 : ne plus demander à la main ce que les données savent

**A1. Cause trouvée.** S30 n'a plus aucun dossier depuis mai 2025 : le calcul s'arrêtait dès que le client n'avait aucun dossier sur 12 mois (`dossiers_12m === 0`), et tous les critères « Données » retombaient dans « Répondre au reste ». Désormais, PERF-05, PERF-06, PERF-12, RES-04, RES-05 et SOC-07 ont **toujours** un statut en confiance haute, avec une phrase :
- aucune vente sur les deux périodes → NON ; volume nul cette année mais pas l'an dernier → NON ;
- historique insuffisant (premier dossier moins de 15 mois avant la date des données, ou aucun dossier) → N.A. ;
- ventes cette année et aucune l'an dernier (client ancien) → OUI.
Les propositions sont **rafraîchies à chaque ouverture d'un brouillon** (nouvel export, GA4) sans toucher aux réponses déjà données ; une donnée sûre (confiance haute) n'est plus écrasée par le scan (ex. TRK-01 par GA4).

**A2.** PERF-04 = confirmés ÷ visites (dossiers « site web » seulement dès que la colonne `Origine` est livrée), sinon « non vérifiable — trafic inconnu » avec un lien vers l'écran Google Analytics (dans « À valider », jamais en question). TRK-01 = OUI en confiance haute si la propriété GA4 commune reçoit des sessions pour le client.

**A3. Exports back-office.** La mise à jour du lundi accepte plusieurs fichiers déposés ensemble ; chaque fichier est reconnu **à ses colonnes** (dossiers, catalogue, configuration, connexions, PayBox) ; un seul aperçu récapitule tout. Colonnes manquantes → écran de correspondance, mémorisé par type d'export. Catalogue et configuration = photos complètes (remplacées) ; connexions et PayBox s'ajoutent. Envoi par morceaux de 2 000 lignes (limite de taille des requêtes Vercel). Les 7 colonnes de l'export dossiers enrichi sont facultatives : un export sans elles n'efface pas les valeurs déjà connues. Fichiers d'exemple fictifs : `tests/fixtures/backoffice/`. Tant qu'un export n'est pas livré, ses critères restent manuels avec la mention « En attente de l'export … ».

**A4. Règles retenues** (module `src/lib/audit/backoffice.ts`) :
- PROD-02 : produits internes en ligne avec prix adulte **et** prix enfant, 90 % / 60 %. L'export ne dit pas si un prix enfant est « applicable » : un produit adultes seulement compte comme incomplet. *À trancher : ajouter une colonne « Prix enfant applicable », ou ne compter que le prix adulte.*
- PROD-05 50 % / 20 % ; PROD-06, PROD-08, PERF-03, PERF-08 : seuils existants. PROD-07 : module actif et ≥ 50 % des produits avec assurance = OUI, module actif sinon = PARTIEL.
- **RES-02 et RES-03 (seuils proposés, à valider)** : RES-02 ≥ 30 % des produits internes partagés sur S01 = OUI, ≥ 10 % = PARTIEL ; RES-03 ≥ 10 % des produits en ligne venant de S01 = OUI, ≥ 3 % = PARTIEL.
- SOC-01 : CRM ou ERP connecté avec un échange de moins de 7 jours = OUI, connecté sans échange récent = PARTIEL. SOC-06 : migration seule = PARTIEL. DIST-01 : « éligible » sans opt-in = NON (« à proposer »).
- SOC-04 : dossiers payés en ligne sur la période couverte par l'export PayBox ; ≥ 98 % avec transaction acceptée = OUI, ≥ 90 % = PARTIEL ; les écarts (IDresa) sont listés.
- SOC-08 : 4 semaines sur 4 avec connexion, ou ≥ 4 connexions sur 30 j = OUI ; au moins une = PARTIEL.
- PERF-02 : proposé en confiance moyenne (à confirmer par le CSM). PERF-07 : source réglable dans Administration → État des services (GA4 par défaut, en attendant la réponse de Martin) ; avec l'export, abandon = paniers avec email non confirmés ÷ paniers avec email (12 mois, 20 au moins).
- **Alertes** : fin de contrat (export configuration, à défaut l'échéance de la fiche) dans moins de 90 jours sans rendez-vous futur → rouge ; aucune connexion au back-office depuis 30 jours → rouge.

**A5.** Le scan enregistre `businessStatus` de la fiche Google (seulement si la fiche est identifiée par place_id ou site identique) : « définitivement fermé » → alerte rouge et bandeau sur la fiche client ; « temporairement fermé » → orange.

**A6.** VIS-02/VIS-03 donnent la cause exacte : « Clé Google Places manquante — à renseigner dans Administration (État des services) », clé refusée par Google (message de l'API), ou fiche introuvable. En production, la clé était bien renseignée depuis le 19/10 : si VIS-02 reste vide, l'écran « État des services » affiche désormais l'erreur renvoyée par Google (souvent *Places API (New)* non activée sur la clé). VIS-03 reste manuel : lien direct vers les avis, note et nombre d'avis, et un champ « sur les 10 derniers avis, combien ont une réponse ? » qui calcule le statut (80 % / 50 %). Nouvel écran **Administration → État des services** : chaque clé, le worker et les exports, configuré ou non, dernier succès, dernier échec et critères dépendants.

**Effet mesuré (démo locale, export réel du lundi + exports d'exemple)** : critères pré-remplis avec un statut avant → après : S30 0 → 24, P17 6 → 24 (23 en confiance haute). Avec le seul export dossiers réel (sans les exports à venir), S30 passe de 0 à 6 et PERF-04 / TRK-01 s'ajoutent dès que GA4 est synchronisé.
