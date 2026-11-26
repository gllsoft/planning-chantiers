# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Application de bureau Electron (macOS, Windows, Linux) de planning de chantiers (Gantt) avec base SQLite locale. Interface, code et messages sont en français.

## Commandes

```sh
npm start            # lance l'app en développement
npm test             # tests : test/run.js se relance sous Electron (ELECTRON_RUN_AS_NODE) ; assertions node:assert
npm run dist         # build de la plateforme courante → dist/ : .dmg + .zip (Mac), .exe NSIS (Windows), .AppImage (Linux)
node build/build.js --win|--linux   # cible forcée (en local sur Mac Apple Silicon : nécessite Rosetta pour makensis/appimagetool)
npm run dist:universal
node build/build.js -c.extraMetadata.version=1.0.1   # build avec une version forcée (tests de mise à jour)
```

Les tests doivent tourner sous le Node d'Electron, car `node:sqlite` et la version de Node diffèrent du Node système. Il n'y a qu'un fichier de test ; pas de lint configuré.

## Architecture

**Trois couches, communication uniquement par IPC :**
- `index.html` : tout le renderer (CSS + HTML + JS en un seul fichier, sans framework ni bundler). L'état est un objet unique `state = {settings, teams, chantiers[{phases}], entries}`. `render()` recalcule tout via `compute()` (moteur de planification : devis en heures → jours ouvrés, prévision à partir du dernier « reste à faire » saisi, glissement des phases suivantes, charge par équipe) puis appelle `save()`.
- `preload.js` : expose `window.planningApi` (ne pas renommer en `api` : collision avec `const api` déclaré dans `index.html`).
- Guide de première installation : dialogue `#dlgGuide` (bienvenue, dossier de travail, organisation, prise en main, démarrage vide/démo/import). Affiché tant que `config.onboarded` est faux (absent d'une config existante = déjà configuré), rouvrable via « ? » ou Aide › Guide (`guide:show`). Pendant le guide, `db:changed` ne ferme pas ce dialogue.
- Multiplateforme : libellés (Finder/Explorateur, ⌘/Ctrl) via `planningApi.platform` ; menu `appMenu`/`windowMenu` et `setRepresentedFilename` réservés à macOS.
- `main.js` : fenêtre, menus, dossier de travail, sauvegardes/restauration, import/export JSON, mises à jour. Les handlers IPC sont dans l'objet `handlers` (`db:*`, `update:*`). Après remplacement de la base (restauration, changement de dossier, import), main envoie `db:changed` et le renderer recharge tout.

**Persistance (`db.js`) :** SQLite intégré à Electron (`node:sqlite`, `DatabaseSync`) — aucun module natif, ne pas introduire better-sqlite3. `save(state)` réécrit toutes les tables dans une transaction à chaque rendu (volume faible, choix assumé). Le schéma est versionné par `PRAGMA user_version` dans `Store.migrate()` : toute évolution du schéma doit y ajouter une étape. Journal en mode `DELETE` pour garder un fichier unique (dossiers synchronisés). Sauvegardes via `VACUUM INTO`.

**Emplacements à l'exécution :**
- Config : `<userData>/config.json` (`dataDir`, `autoBackup`, `keepBackups`, `onboarded`) — Mac : `~/Library/Application Support/Planning Chantiers/`.
- Changer de dossier alors que la base n'a aucun chantier ne pose pas de question (ouvre la base existante ou y copie les paramètres) ; une base vierge créée pendant la session est alors supprimée (`createdDb`).
- Base : `<dataDir>/planning-chantiers.sqlite` (défaut `~/Documents/Planning Chantiers`), sauvegardes dans `<dataDir>/Sauvegardes/` (`auto-*` élaguées, `manuelle-*`, `avant-restauration-*`, `avant-import-*`, `avant-mise-a-jour-*`).

## Build et signature

- `build/build.js` lance electron-builder **hors du projet** (`os.tmpdir()`) puis copie seulement `.dmg`/`.zip` dans `dist/` : le projet est dans Documents, synchronisé par iCloud (File Provider), qui ajoute des attributs étendus que `codesign` refuse (même dans un dossier `.nosync`).
- Windows : installateur NSIS one-click par utilisateur (non signé → avertissement SmartScreen) ; Linux : AppImage x64.
- Pas de certificat Apple : signature **ad hoc** dans le hook `afterPack` (`build/adhoc-sign.js`, copie → `xattr -cr` → `codesign --deep -s -`).
- Les fichiers embarqués sont listés dans `build.files` de `package.json` : tout nouveau fichier JS du main process doit y être ajouté.
- `artifactName` (`planning-chantiers-${version}-${arch}.${ext}`, dans `mac`, `nsis`, `linux`) est utilisé par l'updater pour trouver l'asset (`-<arch>.<ext>`, alias x64/x86_64/amd64) : ne pas le changer sans adapter `updater.js`.

## Mises à jour (`updater.js`)

Updater maison (Squirrel.Mac/electron-updater refusent une app signée ad hoc) : lit `releases/latest` du dépôt `gllsoft/planning-chantiers`. Mac : télécharge le `.zip`, vérifie signature et version, puis un script shell détaché attend la fin du processus, échange les bundles `.app` et relance. Windows : lance l'installateur `.exe` en silencieux (`/S --force-run`) si l'app a été installée par NSIS. Linux : remplace le fichier `$APPIMAGE` puis relance (version .deb/non-AppImage : lien de téléchargement). Vérification au démarrage et toutes les 6 h, seulement si `app.isPackaged`.

Tester une app empaquetée **sans toucher au profil réel de l'utilisateur** : `--user-data-dir=<dossier temporaire>` (avec un `config.json` pointant `dataDir` vers un dossier temporaire **déjà créé** : sinon la boîte « dossier introuvable » propose le dossier par défaut, c'est-à-dire la vraie base ; ajouter `"onboarded": false` pour voir le guide). `PLANNING_UPDATE_FEED=<url>` remplace l'URL de l'API GitHub par un faux flux JSON local ; `--remote-debugging-port` permet de piloter l'interface.

## Git et CI

- `develop` = branche par défaut/de travail ; `main` = versions publiées. Une règle GitHub interdit les push directs sur les deux : toujours passer par une branche + PR, avec le contrôle requis « Build macOS » (`.github/workflows/build.yml` : matrice macOS/Windows/Linux, tests + build + installateur en artefact ; garder ce nom de job).
- Chaque push sur `main` déclenche `.github/workflows/release.yml` : numéro = version de `package.json` si plus haute que le dernier tag, sinon dernier tag + 1 (patch) ; construit les trois plateformes puis publie en une fois la Release GitHub (`.dmg` + `.zip`, `.exe`, `.AppImage`) que les apps installées détectent. Pour une version mineure/majeure, modifier `version` dans `package.json` dans la PR.
