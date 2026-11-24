# Planning Chantiers — application Mac

Application Electron basée sur `index.html`, avec une base de données SQLite locale (moteur SQLite intégré à Electron, sans module natif).

## Développement

```sh
npm install
npm start          # lance l'application
npm run dist       # construit dist/Planning Chantiers-<version>-arm64.dmg (+ .zip)
npm run dist:universal   # variante Intel + Apple Silicon
```

Le build se fait dans un dossier temporaire puis seuls le `.dmg` et le `.zip` sont copiés dans `dist/` : le dossier Documents étant synchronisé par iCloud, macOS y ajoute des attributs qui cassent la signature de l'app.

## Fichiers

| Fichier | Rôle |
|---|---|
| `main.js` | Processus principal : fenêtre, menus, dossier de travail, sauvegardes, import/export |
| `db.js` | Schéma SQLite et lecture/écriture des données |
| `preload.js` | Passerelle sécurisée entre l'interface et le processus principal (`window.planningApi`) |
| `index.html` | Interface de l'application |
| `build/` | Icône, script de build, signature ad hoc |

## Données

- Base : `<dossier de travail>/planning-chantiers.sqlite` (par défaut `~/Documents/Planning Chantiers`).
- Sauvegardes : `<dossier de travail>/Sauvegardes/` — automatique une fois par jour au démarrage (les 30 dernières sont conservées), manuelle avec ⌘S, et avant chaque restauration, import ou chargement des données démo.
- Configuration (dossier de travail, options de sauvegarde) : `~/Library/Application Support/Planning Chantiers/config.json`.
- Ne pas ouvrir la même base depuis deux Mac en même temps (par exemple via un dossier partagé).
