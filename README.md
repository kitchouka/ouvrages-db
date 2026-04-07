# 🏗️ OuvragesDB

Base d'ouvrages BTP pour entrepreneur du bâtiment.

## Stack

- **Backend** : Node.js + Express + better-sqlite3 + multer + xlsx
- **Frontend** : HTML/CSS/JS vanilla + Tailwind CSS (CDN)
- **Port** : 3040

## Fonctionnalités

- 📚 **Bibliothèque** : recherche, filtre par famille, tri, vue détail par drawer
- 📥 **Import Excel** : parsing des devis au format fixe, déduplication automatique par moyenne pondérée
- 📊 **Stats** : répartition par famille, top 10 ouvrages les plus fréquents
- 📤 **Export CSV** : export complet de la base

## Familles détectées automatiquement

- Maçonnerie, Terrassement, Plomberie, Charpente/Couverture, Menuiserie
- Électricité, Isolation, Carrelage, Peinture, Divers

## Format Excel attendu

- Feuille : `Devis` (sinon première feuille)
- Colonnes : `[0]` ref (L\d+), `[1]` désignation, `[2]` qté, `[3]` unité, `[4]` PU HT, `[5]` total HT, `[7]` heures total, `[8]` achat mat total

## Installation

```bash
npm install
npm start
```

Ouvrir [http://localhost:3040](http://localhost:3040)

## API

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/ouvrages` | Liste avec filtres |
| POST | `/api/ouvrages` | Créer manuellement |
| PUT | `/api/ouvrages/:id` | Modifier |
| DELETE | `/api/ouvrages/:id` | Supprimer |
| POST | `/api/import` | Import Excel |
| GET | `/api/imports` | Historique imports |
| GET | `/api/stats` | Statistiques |
| GET | `/api/ouvrages/export/csv` | Export CSV |
