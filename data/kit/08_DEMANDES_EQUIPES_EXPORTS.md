# Données à demander aux équipes — pour automatiser l'audit CSM

*Suite au test de l'outil du 22/10/2026. Objectif : que tout ce qui est connu du back-office SpeedResa se remplisse **automatiquement** chaque lundi, et que les CSM ne répondent plus à la main qu'aux questions qui demandent un vrai jugement.*

---

## Règles communes à tous les exports

Il faut les mêmes règles que l'export dossiers actuel, que l'outil sait déjà lire :

| Règle | Valeur |
|---|---|
| Format | CSV, encodage UTF-8 (avec BOM), séparateur **point-virgule** |
| En-têtes | Une ligne d'en-têtes, **noms de colonnes exactement comme ci-dessous**, toujours dans le même ordre |
| Clé client | `IDagence` (ex. `S25`) sur chaque ligne, la même que dans l'export dossiers |
| Dates | `JJ/MM/AAAA` (et `HH:MM` pour une heure) |
| Montants | Point décimal, sans symbole € ni séparateur de milliers (`1250.00`) |
| Oui / non | `oui` ou `non`, en minuscules |
| Listes | Plusieurs valeurs dans une cellule séparées par une barre verticale : `PayBox\|Virement` |
| Périmètre | **Photo complète à date** (tous les clients, tous les produits actifs), pas seulement les changements de la semaine |
| Fréquence | Chaque lundi avant 10 h, avec l'export dossiers (sauf mention contraire) |
| Nom du fichier | `export_<type>_<AAAA-MM-JJ>.csv` (ex. `export_catalogue_2026-10-26.csv`) |
| Données personnelles | **Aucune** : ni nom, ni email, ni téléphone de voyageur ou d'utilisateur. Des indicateurs oui/non ou des compteurs suffisent. |

---

## 1. Export dossiers — 7 colonnes à ajouter
**À demander à : Mathieu** (le même export qu'aujourd'hui, enrichi)

On garde les 14 colonnes actuelles et on ajoute à la fin :

| Colonne | Contenu | Sert à |
|---|---|---|
| `ID produit` | Identifiant du produit réservé | Relier le dossier au catalogue, top 5 des ventes (PROD-04) |
| `Origine` | `site web`, `back-office agence`, `RésaLive`, `API` ou `marketplace` | Calculer une **vraie conversion web**. Aujourd'hui, les dossiers saisis en agence gonflent le taux (PERF-04). |
| `Montant options` | Total des options et suppléments vendus dans le dossier | **Part de l'upsell (PERF-08)** |
| `Montant assurance` | Total des assurances vendues dans le dossier (0 si aucune) | **Part des assurances (PERF-08)** |
| `Date de confirmation` | Date du passage en statut confirmé (vide sinon) | Délai de transformation, suivi des devis (PERF-12, SOC-07) |
| `Email renseigné` | `oui` si le voyageur a saisi un email avant d'abandonner | **Abandon panier avec email (PERF-07)**. Uniquement oui/non, jamais l'adresse. |
| `Payé en ligne` | Montant encaissé par paiement en ligne (PayBox ou autre) | Rapprochement PayBox / dossiers (SOC-04) |

---

## 2. Export catalogue produits — nouveau
**À demander à : Mathieu** · une ligne par produit, **actif ou en ligne**, de chaque client

| Colonne | Contenu |
|---|---|
| `IDagence` | Client |
| `ID produit` | Identifiant |
| `Titre` | Nom du produit |
| `Type` | séjour, circuit, croisière, billetterie… |
| `Source` | `production interne`, `flux TO` ou `réseau S01` |
| `Fournisseur` | Nom du TO ou du partenaire si la source n'est pas interne |
| `En ligne` | `oui` / `non` |
| `Partagé sur S01` | `oui` / `non` |
| `Date de création` | |
| `Date de dernière mise à jour` | Dernière modification du contenu, des prix ou des départs |
| `Départs futurs ouverts` | Nombre de dates de départ futures réservables |
| `Prochain départ` | Date du prochain départ ouvert |
| `Stock géré` | `oui` / `non` |
| `Prix adulte` | `oui` / `non` (un prix adulte existe) |
| `Prix enfant` | `oui` / `non` |
| `Nb suppléments` | Nombre de suppléments paramétrés |
| `Nb options` | Nombre d'options paramétrées |
| `Assurance associée` | `oui` / `non` |
| `Nb photos` | Nombre de photos de la fiche |
| `Publié sur Veepee` | `oui` / `non` |

**Ce que l'outil en tire automatiquement :**
- tarification complète (PROD-02) ;
- utilisation des stocks (PROD-05) ;
- part des produits avec options (PROD-06) ;
- assurances paramétrées (PROD-07) ;
- **fraîcheur du catalogue (PROD-08)** ;
- disponibilité de la production interne (PERF-03) ;
- partage S01 (RES-02) et produits externes ouverts (RES-03) ;
- produits sur Veepee (DIST-01) ;
- et un premier indicateur de digitalisation (PROD-01).

---

## 3. Export configuration des comptes — nouveau
**À demander à : Mathieu**, avec Martin pour Scylla et l'ADV pour les contrats · une ligne par client

| Colonne | Contenu | Critère |
|---|---|---|
| `IDagence` | Client | |
| `Migration Scylla` | `oui` / `non` | SOC-06 |
| `Date migration Scylla` | | SOC-06 |
| `Scylla vérifié` | `oui` si le bon fonctionnement a été contrôlé après migration | SOC-06 |
| `Date mise à jour KIT` | Date de la dernière mise à jour du KIT | SOC-02 |
| `Moyens de paiement` | Liste : `PayBox\|Virement\|Chèques-vacances\|…` | SOC-03 |
| `Paiement en ligne actif` | `oui` / `non` | SOC-03 |
| `3-D Secure actif` | `oui` / `non` | LEG-12 |
| `Paiement en plusieurs fois` | `oui` / `non` (+ solution dans `Moyens de paiement`) | PERF-14 |
| `Module assurance actif` | `oui` / `non` | PROD-07, PERF-01 |
| `Assureur` | Nom de l'assureur partenaire | |
| `RésaLive actif` | `oui` / `non` | RES-04 |
| `Connecteurs` | Outils connectés : `RésaLive\|CRM <nom>\|ERP <nom>\|Veepee\|…` | SOC-01, RES-04 |
| `Date dernier échange connecteur` | Dernière synchronisation réussie | SOC-01, RES-05 |
| `Comptes B2B / CSE autonomes` | Nombre de comptes clients autonomes créés | RES-01 |
| `Opt-in Veepee` | `oui` / `non` / `éligible` | DIST-01 |
| `Filtres flux TO actifs` | `oui` si la gestion des axes / filtres des flux est paramétrée | PERF-02 |
| `Relance panier active` | `oui` / `non` | PERF-13 |
| `Dernière connexion back-office` | Date | SOC-08 |
| `Connexions back-office 30 j` | Nombre de connexions sur 30 jours | SOC-08 |
| `Utilisateurs actifs 30 j` | Nombre d'utilisateurs distincts connectés | SOC-08 |
| `Date fin de contrat` | Échéance (ADV) | Alerte churn |
| `Offre souscrite` | Nom de l'abonnement ou du pack | Opportunités |

> Si les logs de connexion ne peuvent pas être agrégés, un export séparé `export_connexions_<date>.csv` suffit : `IDagence; Date; Nb connexions; Nb utilisateurs distincts`, une ligne par client et par jour, **sans nom d'utilisateur**.

---

## 4. Export transactions PayBox — nouveau (mensuel)
**À demander à : Mathieu** (à valider : peut-on l'extraire de PayBox avec la référence du dossier ?)

| Colonne | Contenu |
|---|---|
| `IDagence` | Client |
| `Date` | Date de la transaction |
| `Référence transaction` | Référence PayBox |
| `IDresa` | N° du dossier SpeedResa associé (indispensable pour le rapprochement) |
| `Montant` | |
| `Statut` | `acceptée`, `refusée`, `remboursée` |
| `3-D Secure` | `oui` / `non` |

**Sert à :** SOC-04, c'est-à-dire autant de transactions PayBox que de dossiers SpeedResa payés en ligne. L'outil fera le rapprochement tout seul et listera les écarts.

---

## 5. Questions à poser (réponse attendue, pas un export)

**À Martin (directeur des opérations)**
1. **Abandon panier** : comment mesurer de façon fiable les paniers abandonnés avec email (PERF-07) ? Deux pistes : la colonne `Email renseigné` de l'export dossiers, ou les événements Google Analytics `begin_checkout` / `purchase` déjà relevés par l'outil. Laquelle est la plus juste ?
2. **Scylla** : la liste des clients migrés et vérifiés. Elle entre dans l'export configuration, mais il faut une première liste tout de suite.
3. **Relance automatique des paniers et devis** : Speedmedia peut-il proposer une **séquence d'emails automatique** à ses clients (sujet évoqué ce matin avec un tour-opérateur) ? Si oui, cela devient une offre à proposer dans l'audit.
4. **Transformation** : beaucoup de clients confirment leurs dossiers dans **leur propre back-office** (outil tiers de type « MP3M », à confirmer), pas dans SpeedResa. Peut-on récupérer le statut final par le connecteur ? Sinon, la transformation mesurée dans SpeedResa sous-estime leurs ventes et le critère PERF-12 doit être lu en conséquence.

**À Mathieu**
5. **Document des connecteurs** : pour chaque client, quel outil est connecté (CRM, ERP, RésaLive, Veepee…), depuis quand, et l'état du connecteur. C'est la base de la colonne `Connecteurs`.
6. **KIT** : que recouvre exactement la « mise à jour du KIT » et où trouver sa date ?
7. **PayBox** : peut-on extraire les transactions avec l'`IDresa` (export 4) ?
8. **Données structurées (schema.org) et qualité des fiches** : les fiches produits sont générées par la plateforme SpeedResa. Si les gabarits n'ont pas de données structurées, c'est un **chantier plateforme** pour tous les clients, pas un manque du client (VIS-08).

**À l'ADV / finance**
9. Les **dates de fin de contrat** et l'offre souscrite par client (export 3).

**À vous (super admin)**
10. Créer la **clé API Google Places** (console Google Cloud, gratuite jusqu'à un certain volume) et la renseigner dans l'outil. Sans elle, VIS-01 et VIS-02 ne peuvent pas être vérifiés : c'est la raison pour laquelle la fiche Google n'a pas été trouvée pendant le test.
11. Créer aussi la **clé Google PageSpeed** (vitesse du site) si ce n'est pas fait.

---

## 6. Ce qui restera à faire à la main par les CSM (et c'est normal)

| Critère | Qui | Pourquoi |
|---|---|---|
| VIS-03 Réponse aux avis Google | CSM | Google ne fournit pas les réponses du propriétaire par son API. L'outil donnera le lien direct vers la fiche. |
| VIS-04 Relais de l'URL (mairies, CSE, partenaires) | Outil + CSM | L'outil proposera une liste de pages qui citent le site, à confirmer |
| VIS-05 Publications d'offres sur les réseaux | CSM, puis client | Les réseaux sociaux ne sont pas lisibles sans l'accès du client. Méthode guidée dans l'outil. |
| VIS-06 QR codes, PROD-01 part digitalisée | Client | Déclaratif |
| PERF-02 Flux TO lisibles | CSM | Jugement de lisibilité de l'offre, aidé par la colonne `Filtres flux TO actifs` |
| PERF-09 Rapport mensuel envoyé | CSM | Suivi interne |
| DIST-02 Qualité des produits Veepee | CSM | Jugement |
| LEG-10 Facturation électronique, LEG-11 Prospection | Client | Déclaratif, avec une explication simple dans le questionnaire |
| INN-04 Personnalisation | CSM | Jugement |

**Supprimés à votre demande** : REL-01 (RDV de moins de 90 jours), REL-02 (NPS), SOC-05 (MT / SRA2 : plus aucun client sur SRA2). REL-03 (interlocuteur digital) passe en simple information sur la fiche client, hors score.
