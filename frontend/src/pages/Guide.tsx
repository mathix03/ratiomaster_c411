import { BookOpen, Server, Search, Upload, Sparkles, Network } from 'lucide-react';
import '../App.css';

export default function Guide() {
  return (
    <div className="admin-page">
      <div className="admin-container">
        <header className="admin-header">
          <BookOpen size={36} className="icon-ghost" />
          <div>
            <h1>Guide d'utilisation</h1>
            <p className="admin-subtitle">Comment utiliser GhostSeed avec ton serveur Jellyfin</p>
          </div>
        </header>

        <div className="glass-panel users-panel">
          <p className="guide-intro">
            GhostSeed peut récupérer automatiquement les affiches de tes films et séries
            directement depuis ton propre serveur Jellyfin. Trois étapes suffisent.
          </p>
        </div>

        <div className="glass-panel users-panel">
          <h2 className="section-title">
            <Server size={22} /> 1. Configuration <span className="guide-badge">à faire une seule fois</span>
          </h2>
          <p className="guide-text">
            Avant de l'utiliser, il faut indiquer à l'application où se trouve ton Jellyfin.
          </p>
          <ol className="guide-steps">
            <li>Va dans la page <strong>My Account</strong> (dans le menu de navigation, en haut).</li>
            <li>
              Dans la section <strong>Jellyfin Integration</strong>, entre l'<strong>URL de ton serveur</strong>{' '}
              (ex : <code>http://192.168.1.50:8096</code>) et une <strong>clé d'API</strong> générée depuis
              le panneau d'administration de ton Jellyfin.
            </li>
            <li>Clique sur <strong>Save Settings</strong>.</li>
          </ol>
          <p className="guide-hint">
            💡 La clé d'API se génère dans Jellyfin → <em>Dashboard → API Keys → « + »</em>.
          </p>
        </div>

        <div className="glass-panel users-panel">
          <h2 className="section-title">
            <Upload size={22} /> 2. Ajout d'un torrent
          </h2>
          <p className="guide-text">Lorsque tu ajoutes un nouveau torrent dans GhostSeed :</p>
          <ol className="guide-steps">
            <li>
              Va dans le formulaire d'ajout (page <strong>Spoofer</strong>) et charge ton fichier{' '}
              <code>.torrent</code>.
            </li>
            <li>
              Dans la section <strong>Assign Jellyfin Metadata</strong>, repère la barre{' '}
              <strong>« Search Jellyfin… »</strong> et tape le nom du film ou de la série correspondant
              au fichier torrent (par exemple <em>Inception</em>).
            </li>
            <li>
              Clique sur la petite loupe{' '}
              <Search size={14} className="guide-inline-icon" />.
            </li>
          </ol>
        </div>

        <div className="glass-panel users-panel">
          <h2 className="section-title">
            <Sparkles size={22} /> 3. Le résultat
          </h2>
          <ol className="guide-steps">
            <li>
              L'application va interroger ton Jellyfin et te proposer les films/séries correspondants
              avec leurs affiches.
            </li>
            <li>Tu cliques sur la bonne affiche.</li>
            <li>
              <strong>Boum !</strong> Le torrent est créé, et dans ton tableau de bord, au lieu d'avoir
              juste un texte triste, tu auras la vraie affiche du film récupérée depuis chez toi.
              Ça rend l'interface de GhostSeed magnifique ! ✨
            </li>
          </ol>
        </div>

        <div className="glass-panel users-panel">
          <h2 className="section-title">
            <Network size={22} /> 4. Proxy Transparent qBittorrent (Radarr / Sonarr)
          </h2>
          <p className="guide-text">
            GhostSeed peut se faire passer pour un vrai client qBittorrent. Cela permet à tes outils d'automatisation (Radarr, Sonarr, Jellyseerr) d'envoyer les torrents directement à GhostSeed !
          </p>
          <ol className="guide-steps">
            <li>Va dans la page <strong>My Account</strong> et active le <strong>qBittorrent Transparent Proxy</strong>.</li>
            <li>Entre l'URL, le nom d'utilisateur et le mot de passe de ton <strong>vrai</strong> serveur qBittorrent. Sauvegarde.</li>
            <li>Dans Radarr ou Sonarr, ajoute un nouveau client de téléchargement <strong>qBittorrent</strong>.</li>
            <li>Pour l'hôte (Host), mets l'adresse de ton serveur <strong>GhostSeed</strong>.</li>
            <li>Pour le nom d'utilisateur et le mot de passe, utilise <strong>tes identifiants GhostSeed</strong>.</li>
            <li>Sauvegarde et teste ! Radarr croira parler à qBittorrent, mais en réalité il parlera à GhostSeed. Le torrent se mettra en faux seed (pour le ratio), puis sera transféré silencieusement à ton vrai client pour le téléchargement !</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
