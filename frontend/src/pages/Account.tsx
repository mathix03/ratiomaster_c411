import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { User, TrendingUp, Activity, Gauge, KeyRound, History, RotateCcw, Clock, MessageSquare, Send, ShieldAlert, Server, Save } from 'lucide-react';
import { fetchWithAuth } from '../utils/api';
import { useUI } from '../context/UIContext';
import '../App.css';

function formatBytes(bytes: number, decimals = 2) {
  if (!+bytes) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

interface Me {
  username: string;
  role: string;
  createdAt: string | null;
  totalUploaded: number;
  activeSessions: number;
  limits: { maxSpeed: number; maxSessions: number };
}

interface HistoryItem {
  id: string;
  name: string;
  infoHash: string;
  tracker: string;
  client: string;
  baseUploadSpeed: number;
  uploaded: number;
  startTime: number;
  endTime: number;
  config: any;
}

interface Message {
  id: number;
  username: string;
  body: string;
  createdAt: number;
  reply: string | null;
  repliedAt: number | null;
}

export default function Account() {
  const [me, setMe] = useState<Me | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPw, setSavingPw] = useState(false);
  
  const [jellyfinUrl, setJellyfinUrl] = useState('');
  const [jellyfinApiKey, setJellyfinApiKey] = useState('');
  const [savingJellyfin, setSavingJellyfin] = useState(false);

  const { toast } = useUI();
  const navigate = useNavigate();

  const load = useCallback(async () => {
    try {
      const [meRes, histRes, msgRes, settingsRes] = await Promise.all([
        fetchWithAuth('/me'),
        fetchWithAuth('/history'),
        fetchWithAuth('/messages'),
        fetchWithAuth('/settings')
      ]);
      if (meRes.ok) setMe(await meRes.json());
      if (histRes.ok) setHistory(await histRes.json());
      if (msgRes.ok) setMessages(await msgRes.json());
      if (settingsRes.ok) {
        const data = await settingsRes.json();
        setJellyfinUrl(data.jellyfinUrl || '');
        setJellyfinApiKey(data.jellyfinApiKey || '');
      }
    } catch (err) {
      console.error(err);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 10000);
    return () => clearInterval(interval);
  }, [load]);

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast('New passwords do not match', 'error');
      return;
    }
    if (newPassword.length < 6) {
      toast('Password must be at least 6 characters', 'error');
      return;
    }
    setSavingPw(true);
    try {
      const res = await fetchWithAuth('/me/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast('Password updated successfully', 'success');
        setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
      } else {
        toast(data.error || 'Failed to change password', 'error');
      }
    } finally {
      setSavingPw(false);
    }
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    setSending(true);
    try {
      const res = await fetchWithAuth('/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: draft })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast('Message sent to the admins', 'success');
        setDraft('');
        load();
      } else {
        toast(data.error || 'Failed to send message', 'error');
      }
    } finally {
      setSending(false);
    }
  };

  const relaunch = async (item: HistoryItem) => {
    const cfg = item.config || {};
    const res = await fetchWithAuth('/session/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        infoHash: item.infoHash,
        name: item.name,
        tracker: item.tracker,
        client: item.client,
        baseUploadSpeed: item.baseUploadSpeed,
        useSequence: cfg.useSequence,
        sequenceLoops: cfg.sequenceLoops,
        stopAtSizeMB: cfg.stopAtSize ? Math.round(cfg.stopAtSize / (1024 * 1024)) : '',
        stopAtTimeMins: cfg.stopAtTime ? Math.round(cfg.stopAtTime / 60000) : '',
        initialUploadedGB: cfg.initialUploadedGB,
        initialDownloadedGB: cfg.initialDownloadedGB
      })
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      toast(`Relaunched "${item.name}"`, 'success');
      navigate('/');
    } else {
      toast(data.error || 'Failed to relaunch', 'error');
    }
  };

  if (!me) {
    return (
      <div className="admin-page">
        <div className="admin-loading">
          <Activity size={32} className="icon-ghost admin-loading-icon" />
          <span>Loading account…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-page">
      <div className="admin-container">
        <header className="admin-header">
          <User size={36} className="icon-ghost" />
          <div>
            <h1>My Account</h1>
            <p className="admin-subtitle">{me.username} · {me.role}</p>
          </div>
        </header>

        <div className="stat-cards">
          <div className="glass-panel stat-card">
            <div className="stat-card-head"><TrendingUp size={18} /><span>Total Generated</span></div>
            <div className="stat-card-value">{formatBytes(me.totalUploaded)}</div>
            <div className="stat-card-caption">Uploaded on your account</div>
          </div>
          <div className="glass-panel stat-card">
            <div className="stat-card-head"><Activity size={18} /><span>Active Sessions</span></div>
            <div className="stat-card-value">
              {me.activeSessions}{me.limits.maxSessions ? ` / ${me.limits.maxSessions}` : ''}
            </div>
            <div className="stat-card-caption">
              {me.limits.maxSessions ? 'Running / your limit' : 'No session limit'}
            </div>
          </div>
          <div className="glass-panel stat-card">
            <div className="stat-card-head"><Gauge size={18} /><span>Max Speed</span></div>
            <div className="stat-card-value">
              {me.limits.maxSpeed ? `${formatBytes(me.limits.maxSpeed)}/s` : 'Unlimited'}
            </div>
            <div className="stat-card-caption">Your per-session speed cap</div>
          </div>
        </div>

        <div className="glass-panel users-panel">
          <h2 className="section-title"><KeyRound size={22} /> Change Password</h2>
          <form onSubmit={submitPassword} className="account-form">
            <div className="form-group">
              <label>Current password</label>
              <input type="password" className="form-control" value={currentPassword}
                onChange={e => setCurrentPassword(e.target.value)} autoComplete="current-password" required />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>New password</label>
                <input type="password" className="form-control" value={newPassword}
                  onChange={e => setNewPassword(e.target.value)} autoComplete="new-password" required />
              </div>
              <div className="form-group">
                <label>Confirm new password</label>
                <input type="password" className="form-control" value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)} autoComplete="new-password" required />
              </div>
            </div>
            <button type="submit" className="btn btn-start account-submit" disabled={savingPw}>
              <KeyRound size={18} /> {savingPw ? 'Saving…' : 'Update Password'}
            </button>
          </form>
        </div>

        <div className="glass-panel users-panel">
          <h2 className="section-title"><Server size={22} /> Jellyfin Integration</h2>
          <p className="settings-description" style={{ marginBottom: '1.5rem', color: '#8b92a5' }}>
            Connect your personal Jellyfin server to automatically fetch movie and TV show posters
            when uploading torrents.
          </p>

          <form onSubmit={async (e) => {
            e.preventDefault();
            setSavingJellyfin(true);
            try {
              const res = await fetchWithAuth('/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ jellyfinUrl, jellyfinApiKey })
              });
              const data = await res.json().catch(() => ({}));
              if (res.ok && data.success) {
                toast('Jellyfin settings saved', 'success');
              } else {
                toast(data.error || 'Failed to save', 'error');
              }
            } catch {
              toast('Network error', 'error');
            }
            setSavingJellyfin(false);
          }} className="account-form">
            <div className="form-group">
              <label>Jellyfin server URL</label>
              <input
                type="url"
                className="form-control"
                value={jellyfinUrl}
                onChange={e => setJellyfinUrl(e.target.value)}
                placeholder="http://localhost:8096"
              />
            </div>

            <div className="form-group">
              <label>Jellyfin API key</label>
              <input
                type="password"
                className="form-control"
                value={jellyfinApiKey}
                onChange={e => setJellyfinApiKey(e.target.value)}
                placeholder="Enter the API key from your Jellyfin dashboard"
                autoComplete="off"
              />
              <div className="field-hint" style={{ fontSize: '0.8rem', color: '#8b92a5', marginTop: '0.4rem' }}>
                Jellyfin → Dashboard → API Keys → “+”. The key is stored securely.
              </div>
            </div>

            <button type="submit" className="btn btn-start account-submit" disabled={savingJellyfin}>
              <Save size={18} /> {savingJellyfin ? 'Saving…' : 'Save Settings'}
            </button>
          </form>
        </div>

        <div className="glass-panel users-panel">
          <h2 className="section-title"><MessageSquare size={22} /> Contact Admin</h2>
          <form onSubmit={sendMessage} className="account-form">
            <div className="form-group">
              <label>Your message</label>
              <textarea
                className="form-control message-textarea"
                rows={4}
                maxLength={2000}
                placeholder="Ask a question, report a problem, request a higher limit…"
                value={draft}
                onChange={e => setDraft(e.target.value)}
              />
              <div className="char-counter">{draft.length} / 2000</div>
            </div>
            <button type="submit" className="btn btn-start account-submit" disabled={sending || !draft.trim()}>
              <Send size={18} /> {sending ? 'Sending…' : 'Send Message'}
            </button>
          </form>

          {messages.length > 0 && (
            <div className="message-thread">
              {messages.map(m => (
                <div key={m.id} className="message-item">
                  <div className="message-bubble message-mine">
                    <div className="message-meta">
                      You · {new Date(m.createdAt).toLocaleString()}
                      {!m.reply && <span className="badge badge-pending">awaiting reply</span>}
                    </div>
                    <div className="message-body">{m.body}</div>
                  </div>
                  {m.reply && (
                    <div className="message-bubble message-admin">
                      <div className="message-meta">
                        <ShieldAlert size={13} /> Admin · {m.repliedAt ? new Date(m.repliedAt).toLocaleString() : ''}
                      </div>
                      <div className="message-body">{m.reply}</div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="glass-panel users-panel">
          <h2 className="section-title"><History size={22} /> Session History</h2>
          {history.length === 0 ? (
            <div className="no-sessions">No past sessions yet.</div>
          ) : (
            <div className="users-table-wrap">
              <table className="users-table">
                <thead>
                  <tr>
                    <th style={{ width: '40px' }}></th>
                    <th>Torrent</th>
                    <th>Tracker</th>
                    <th>Generated</th>
                    <th>Ended</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map(item => (
                    <tr key={item.id}>
                      <td>
                        {item.config?.posterUrl ? (
                          <img src={item.config.posterUrl} alt="Poster" style={{ width: '32px', height: '48px', objectFit: 'cover', borderRadius: '4px' }} />
                        ) : (
                          <div style={{ width: '32px', height: '48px', background: 'rgba(0,0,0,0.5)', borderRadius: '4px' }} />
                        )}
                      </td>
                      <td><span className="user-name">{item.name}</span></td>
                      <td className="cell-muted">
                        {(() => { try { return new URL(item.tracker).hostname; } catch { return item.tracker; } })()}
                      </td>
                      <td className="cell-accent">{formatBytes(item.uploaded)}</td>
                      <td className="cell-muted">
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                          <Clock size={13} /> {item.endTime ? new Date(item.endTime).toLocaleString() : '—'}
                        </span>
                      </td>
                      <td>
                        <button className="icon-btn icon-btn-success" title="Relaunch with the same settings"
                          onClick={() => relaunch(item)}>
                          <RotateCcw size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
