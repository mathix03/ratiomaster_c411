# GhostSeed Pro 👻📈

GhostSeed Pro est une interface web moderne et sécurisée permettant de simuler du trafic BitTorrent (Ratio Spoofing) de manière avancée. Contrairement aux outils classiques, il intègre des mécaniques conçues pour imiter un comportement humain et se protéger des détections automatiques sur les trackers.

---

## 📸 Captures d'écran (Screenshots)

<!-- 
COMMENT AJOUTER VOS PHOTOS :
1. Créez un dossier nommé 'images' dans le dossier 'ratiomaster-web'.
2. Glissez-y vos 3 captures d'écran et renommez-les exactement comme ceci : 'main_ui.png', 'session_active.png', et 'session_warning.png'.
-->

### Interface Principale
![Vue Principale de l'interface GhostSeed Pro](./images/main_ui.png)

### Sessions Actives & Sécurité
![Session Active Normale](./images/session_active.png)
![Alerte de Sécurité (0 Leechers)](./images/session_warning.png)

---

## ✨ Fonctionnalités Principales (Features)

*   **Séquence Humaine (Human Loop) 🔁** : Le système ne spoofe pas en continu. Il alterne entre des périodes d'activité (avec des fluctuations naturelles de +/- 15%) et des pauses totales (4m on / 2m off / 10m on / etc.) pour un réalisme parfait.
*   **Safety Pause (Protection Zero-Leecher) 🛡️** : L'upload se coupe instantanément (vitesse 0 MB/s) et se met en veille s'il n'y a aucun leecher actif sur le torrent, évitant ainsi la principale cause de banissement.
*   **Bouton de Panique (Stop All) 🛑** : Un seul clic permet de couper proprement toutes les sessions actives en même temps en cas d'urgence.
*   **Batch Upload (Multitasking) 📂** : Glissez-déposez un dossier ou plusieurs torrents en une seule fois (jusqu'à 200 Mo max par fichier). GhostSeed lance une session individuelle pour chaque fichier automatiquement.
*   **Multiplicateur de Sessions 🚀** : Possibilité de cloner un même torrent sur plusieurs sessions distinctes avec des identifiants clients (Peer ID) différents.
*   **Live Ratio Simulator 📈** : Entrez votre Upload/Download actuel pour voir votre ratio s'améliorer en temps réel à l'écran.

## ⚙️ Prérequis

*   [Node.js](https://nodejs.org/) (version 16+ recommandée)
*   NPM (inclus avec Node.js)

## 🚀 Installation

1. Clonez ou téléchargez ce dossier sur votre ordinateur.
2. Installez les dépendances pour le serveur et l'interface :

```bash
# Installation du Backend
cd backend
npm install

# Installation du Frontend
cd ../frontend
npm install
```

## 💻 Démarrage rapide

Vous devez lancer le Backend et le Frontend en même temps (dans deux terminaux différents).

**Terminal 1 (Backend) :**
```bash
cd backend
node index.js
```

**Terminal 2 (Frontend) :**
```bash
cd frontend
npm run dev
```

L'interface web sera alors accessible sur `http://localhost:5173`.

## ⚠️ Avertissement (Disclaimer)

Cet outil est fourni à des fins éducatives et de recherche uniquement. Son utilisation sur des trackers privés peut aller à l'encontre de leurs conditions d'utilisation et entraîner la suspension de votre compte. Utilisez cet outil à vos propres risques.
