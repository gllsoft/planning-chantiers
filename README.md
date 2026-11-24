# Planning Chantiers — application Mac

Application Electron basée sur `index.html`, avec une base de données SQLite locale (moteur SQLite intégré à Electron, sans module natif).

## Développement

```sh
npm install
npm start          # lance l'application
npm test           # tests (base de données, versions)
npm run dist       # construit dist/planning-chantiers-<version>-arm64.dmg (+ .zip)
npm run dist:universal   # variante Intel + Apple Silicon
```

Le build se fait dans un dossier temporaire puis seuls le `.dmg` et le `.zip` sont copiés dans `dist/` : le dossier Documents étant synchronisé par iCloud, macOS y ajoute des attributs qui cassent la signature de l'app.

## Fichiers

| Fichier | Rôle |
|---|---|
| `main.js` | Processus principal : fenêtre, menus, dossier de travail, sauvegardes, import/export |
| `db.js` | Schéma SQLite et lecture/écriture des données |
| `updater.js` | Recherche et installation des mises à jour depuis les Releases GitHub |
| `preload.js` | Passerelle sécurisée entre l'interface et le processus principal (`window.planningApi`) |
| `index.html` | Interface de l'application |
| `build/` | Icône, script de build, signature ad hoc |
| `test/` | Tests lancés par `npm test` et par la CI |
| `.github/workflows/` | Pipelines GitHub Actions |

## Données

- Base : `<dossier de travail>/planning-chantiers.sqlite` (par défaut `~/Documents/Planning Chantiers`).
- Sauvegardes : `<dossier de travail>/Sauvegardes/` — automatique une fois par jour au démarrage (les 30 dernières sont conservées), manuelle avec ⌘S, et avant chaque restauration, import ou chargement des données démo.
- Configuration (dossier de travail, options de sauvegarde) : `~/Library/Application Support/Planning Chantiers/config.json`.
- Ne pas ouvrir la même base depuis deux Mac en même temps (par exemple via un dossier partagé).

## Organisation du travail (Git)

- `develop` : branche de travail (branche par défaut). `main` : versions publiées.
- Aucune modification directe : tout passe par une Pull Request, qui doit passer le contrôle « Build macOS ».
- Cycle : branche `feature/...` → PR vers `develop` → quand on veut livrer, PR `develop` → `main`.

## Pipelines

- **Build** (chaque PR vers `develop`/`main`, chaque push sur `develop`) : tests, construction, et image `.dmg` téléchargeable dans les *Artifacts* du run.
- **Release** (chaque push sur `main`) : construit une nouvelle version et la publie dans les [Releases](https://github.com/gllsoft/planning-chantiers/releases).
  Numéro : celui de `package.json` s'il est nouveau (le modifier dans la PR pour passer en 1.1.0, 2.0.0…), sinon dernière version + 1 (1.0.0 → 1.0.1).

## Mises à jour de l'application

Au démarrage puis toutes les 6 heures, l'application consulte la dernière Release GitHub. Si elle est plus récente, un bandeau propose « Installer et redémarrer » : une sauvegarde de la base est faite, la nouvelle version est téléchargée, sa signature vérifiée, puis l'application est remplacée et relancée. Vérification manuelle : menu *Planning Chantiers → Rechercher des mises à jour…* ou dans Paramètres.

L'application doit être installée dans un dossier modifiable (ex. `/Applications`), pas lancée depuis l'image disque.
