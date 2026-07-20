import { useEffect, useState } from 'react';
import { AreaChart, Area, BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { ShieldAlert, Database, Activity, TrendingUp, Users, Ban, Unlock, KeyRound, Trash2, X, SlidersHorizontal, Trophy, Check, MessageSquare, Send } from 'lucide-react';
import { fetchWithAuth, subscribeAdminStream } from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { useUI } from '../context/UIContext';
import '../App.css';

interface AdminUser {
  username: string;
  role: string;
  createdAt: string | null;
  blocked: boolean;
  totalUploaded: number;
  activeSessions: number;
  currentUploadSpeed: number;
  limits: { maxSpeed: number; maxSessions: number };
}

interface AdminMessage {
  id: number;
  username: string;
  body: string;
  createdAt: number;
  reply: string | null;
  repliedAt: number | null;
  readByAdmin: number;
}

function formatBytes(bytes: number, decimals = 2) {
  if (!+bytes) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<any>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [tempPass, setTempPass] = useState<{ username: string; password: string } | null>(null);
  const [limitsEditor, setLimitsEditor] = useState<{ username: string; maxSpeedMB: string; maxSessions: string } | null>(null);
  const [messages, setMessages] = useState<AdminMessage[]>([]);
  const [unread, setUnread] = useState(0);
  const [replyDrafts, setReplyDrafts] = useState<Record<number, string>>({});
  const [connected, setConnected] = useState(false);
  const { username: myUsername } = useAuth();
  const { toast, confirm } = useUI();

  // Live feed: one SSE connection replaces polling. The backend pushes a fresh
  // snapshot on every action anywhere on the site, so the dashboard mirrors it
  // in real time — including actions taken by other users and by sessions.
  useEffect(() => {
    const applySnapshot = (snap: any) => {
      if (snap.stats) {
        const formattedHistory = (snap.stats.history || []).map((h: any) => {
          const d = new Date(h.time);
          return {
            ...h,
            timeStr: `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
          };
        });
        setStats({ ...snap.stats, history: formattedHistory });
      }
      if (snap.users) setUsers(snap.users);
      if (snap.messages) {
        setMessages(snap.messages.messages);
        setUnread(snap.messages.unread);
      }
    };

    return subscribeAdminStream(applySnapshot, setConnected);
  }, []);

  // Fire an admin action. The dashboard refreshes itself through the live feed,
  // so there's no manual reload here.
  const handleAction = async (action: () => Promise<Response>) => {
    try {
      const res = await action();
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data.error || 'Action failed', 'error');
        return null;
      }
      return data;
    } catch {
      toast('Network error', 'error');
      return null;
    }
  };

  const toggleBlock = async (user: AdminUser) => {
    const data = await handleAction(() => fetchWithAuth(`/admin/users/${encodeURIComponent(user.username)}/block`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blocked: !user.blocked })
    }));
    if (data) toast(user.blocked ? `${user.username} unblocked` : `${user.username} blocked`, 'success');
  };

  const resetPassword = async (user: AdminUser) => {
    const ok = await confirm({
      title: 'Reset password',
      message: `Reset the password for "${user.username}"? Their current password will stop working and a temporary one will be generated.`,
      confirmLabel: 'Reset password'
    });
    if (!ok) return;
    const data = await handleAction(() => fetchWithAuth(`/admin/users/${encodeURIComponent(user.username)}/reset-password`, {
      method: 'POST'
    }));
    if (data?.tempPassword) setTempPass({ username: user.username, password: data.tempPassword });
  };

  const deleteUser = async (user: AdminUser) => {
    const ok = await confirm({
      title: 'Delete account',
      message: `Delete account "${user.username}"? This stops all their sessions and cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true
    });
    if (!ok) return;
    const data = await handleAction(() => fetchWithAuth(`/admin/users/${encodeURIComponent(user.username)}`, {
      method: 'DELETE'
    }));
    if (data) toast(`${user.username} deleted`, 'success');
  };

  const openLimits = (user: AdminUser) => {
    setLimitsEditor({
      username: user.username,
      maxSpeedMB: user.limits.maxSpeed ? String(+(user.limits.maxSpeed / (1024 * 1024)).toFixed(2)) : '',
      maxSessions: user.limits.maxSessions ? String(user.limits.maxSessions) : ''
    });
  };

  const saveLimits = async () => {
    if (!limitsEditor) return;
    const data = await handleAction(() => fetchWithAuth(`/admin/users/${encodeURIComponent(limitsEditor.username)}/limits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        maxSpeedMB: limitsEditor.maxSpeedMB || 0,
        maxSessions: limitsEditor.maxSessions || 0
      })
    }));
    if (data) {
      toast(`Limits updated for ${limitsEditor.username}`, 'success');
      setLimitsEditor(null);
    }
  };

  const sendReply = async (msg: AdminMessage) => {
    const reply = (replyDrafts[msg.id] || '').trim();
    if (!reply) return;
    try {
      const res = await fetchWithAuth(`/admin/messages/${msg.id}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reply })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast(`Reply sent to ${msg.username}`, 'success');
        setReplyDrafts(prev => ({ ...prev, [msg.id]: '' }));
      } else {
        toast(data.error || 'Failed to send reply', 'error');
      }
    } catch {
      toast('Network error', 'error');
    }
  };

  const deleteMessage = async (msg: AdminMessage) => {
    const ok = await confirm({
      title: 'Delete message',
      message: `Delete the message from "${msg.username}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true
    });
    if (!ok) return;
    const res = await fetchWithAuth(`/admin/messages/${msg.id}`, { method: 'DELETE' });
    if (res.ok) {
      toast('Message deleted', 'success');
    } else {
      toast('Failed to delete message', 'error');
    }
  };

  if (!stats) {
    return (
      <div className="admin-page">
        <div className="admin-loading">
          <Activity size={32} className="icon-ghost admin-loading-icon" />
          <span>Loading dashboard…</span>
        </div>
      </div>
    );
  }

  const activeNow = stats.activeNow ?? (stats.history.length > 0
    ? stats.history[stats.history.length - 1].activeSessions
    : 0);

  const leaderboard = [...users]
    .filter(u => u.totalUploaded > 0)
    .sort((a, b) => b.totalUploaded - a.totalUploaded)
    .slice(0, 8);

  return (
    <div className="admin-page">
      <div className="admin-container">
        <header className="admin-header">
          <ShieldAlert size={36} className="icon-ghost" />
          <div>
            <h1>Admin Dashboard</h1>
            <p className="admin-subtitle">Global activity across every session</p>
          </div>
          <span
            className="admin-live-indicator"
            title={connected ? 'Live — updates in real time' : 'Reconnecting to the live feed…'}
            style={{
              marginLeft: 'auto',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '0.85rem',
              fontWeight: 600,
              letterSpacing: '0.02em',
              color: connected ? 'var(--accent-color, #00f0ff)' : '#8b92a5'
            }}
          >
            <span
              style={{
                width: 9,
                height: 9,
                borderRadius: '50%',
                background: connected ? 'var(--accent-color, #00f0ff)' : '#8b92a5',
                boxShadow: connected ? '0 0 8px var(--accent-color, #00f0ff)' : 'none'
              }}
            />
            {connected ? 'Live' : 'Reconnecting…'}
          </span>
        </header>

        <div className="stat-cards">
          <div className="glass-panel stat-card">
            <div className="stat-card-head">
              <TrendingUp size={18} />
              <span>Total Uploaded</span>
            </div>
            <div className="stat-card-value">{formatBytes(stats.totalUploadedEver)}</div>
            <div className="stat-card-caption">Across all historical sessions</div>
          </div>

          <div className="glass-panel stat-card">
            <div className="stat-card-head">
              <Database size={18} />
              <span>Total Sessions Run</span>
            </div>
            <div className="stat-card-value">{stats.totalSessionsEver}</div>
            <div className="stat-card-caption">Total initiated sessions</div>
          </div>

          <div className="glass-panel stat-card">
            <div className="stat-card-head">
              <Activity size={18} />
              <span>Current Active Sessions</span>
            </div>
            <div className="stat-card-value">{activeNow}</div>
            <div className="stat-card-caption">Currently running right now</div>
          </div>
        </div>

        <div className="glass-panel users-panel">
          <h2 className="section-title">
            <Users size={22} /> User Accounts
          </h2>

          {tempPass && (
            <div className="admin-notice admin-notice-success">
              <span>
                Temporary password for <strong>{tempPass.username}</strong>:{' '}
                <code className="temp-password">{tempPass.password}</code> — share it now, it won't be shown again.
              </span>
              <button className="notice-close" onClick={() => setTempPass(null)}><X size={14} /></button>
            </div>
          )}

          <div className="users-table-wrap">
            <table className="users-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Status</th>
                  <th>Generated</th>
                  <th>Sessions</th>
                  <th>Speed</th>
                  <th>Limits</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map(user => (
                  <tr key={user.username} className={user.blocked ? 'row-blocked' : ''}>
                    <td>
                      <span className="user-name">{user.username}</span>
                      {user.role === 'admin' && <span className="badge badge-admin">admin</span>}
                      {user.username === myUsername && <span className="badge badge-you">you</span>}
                    </td>
                    <td>
                      {user.blocked
                        ? <span className="badge badge-blocked">blocked</span>
                        : <span className="badge badge-active">active</span>}
                    </td>
                    <td className="cell-accent">{formatBytes(user.totalUploaded)}</td>
                    <td>{user.activeSessions}</td>
                    <td>{user.currentUploadSpeed > 0 ? `${formatBytes(user.currentUploadSpeed)}/s` : '—'}</td>
                    <td className="cell-muted">
                      <span className="limit-chip">{user.limits.maxSpeed ? `${+(user.limits.maxSpeed / (1024 * 1024)).toFixed(1)} MB/s` : '∞ speed'}</span>
                      <span className="limit-chip">{user.limits.maxSessions ? `${user.limits.maxSessions} sess.` : '∞ sess.'}</span>
                    </td>
                    <td className="cell-muted">
                      {user.createdAt ? new Date(user.createdAt).toLocaleDateString() : '—'}
                    </td>
                    <td>
                      <div className="user-actions">
                        <button
                          className={`icon-btn ${user.blocked ? 'icon-btn-success' : 'icon-btn-warning'}`}
                          title={user.blocked ? 'Unblock account' : 'Block account (stops all sessions)'}
                          disabled={user.username === myUsername}
                          onClick={() => toggleBlock(user)}
                        >
                          {user.blocked ? <Unlock size={15} /> : <Ban size={15} />}
                        </button>
                        <button
                          className="icon-btn"
                          title="Set per-account limits (speed & sessions)"
                          onClick={() => openLimits(user)}
                        >
                          <SlidersHorizontal size={15} />
                        </button>
                        <button
                          className="icon-btn"
                          title="Reset password (generates a temporary one)"
                          onClick={() => resetPassword(user)}
                        >
                          <KeyRound size={15} />
                        </button>
                        <button
                          className="icon-btn icon-btn-danger"
                          title="Delete account"
                          disabled={user.username === myUsername}
                          onClick={() => deleteUser(user)}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="glass-panel users-panel">
          <h2 className="section-title">
            <MessageSquare size={22} /> Messages
            {unread > 0 && <span className="badge badge-unread">{unread} new</span>}
          </h2>

          {messages.length === 0 ? (
            <div className="no-sessions">No messages from users yet.</div>
          ) : (
            <div className="message-thread">
              {messages.map(msg => (
                <div key={msg.id} className={`message-item ${!msg.readByAdmin ? 'message-unread' : ''}`}>
                  <div className="message-bubble message-from-user">
                    <div className="message-meta">
                      <strong className="user-name">{msg.username}</strong> · {new Date(msg.createdAt).toLocaleString()}
                      {!msg.reply && <span className="badge badge-pending">needs reply</span>}
                      <button className="icon-btn icon-btn-danger message-delete" title="Delete message"
                        onClick={() => deleteMessage(msg)}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <div className="message-body">{msg.body}</div>
                  </div>

                  {msg.reply ? (
                    <div className="message-bubble message-admin">
                      <div className="message-meta">
                        <ShieldAlert size={13} /> Your reply · {msg.repliedAt ? new Date(msg.repliedAt).toLocaleString() : ''}
                      </div>
                      <div className="message-body">{msg.reply}</div>
                    </div>
                  ) : (
                    <div className="reply-box">
                      <input
                        type="text"
                        className="form-control"
                        placeholder={`Reply to ${msg.username}…`}
                        value={replyDrafts[msg.id] || ''}
                        onChange={e => setReplyDrafts(prev => ({ ...prev, [msg.id]: e.target.value }))}
                        onKeyDown={e => { if (e.key === 'Enter') sendReply(msg); }}
                      />
                      <button className="btn btn-start reply-send" onClick={() => sendReply(msg)}
                        disabled={!(replyDrafts[msg.id] || '').trim()}>
                        <Send size={16} /> Reply
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {leaderboard.length > 0 && (
          <div className="glass-panel chart-panel">
            <h2 className="section-title">
              <Trophy size={22} /> Top Generators
            </h2>
            <div className="chart-body chart-body-sm">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={leaderboard} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" horizontal={false} />
                  <XAxis type="number" stroke="#8b92a5" fontSize={12} tickLine={false} axisLine={false}
                    tickFormatter={(val) => formatBytes(val)} />
                  <YAxis type="category" dataKey="username" stroke="#8b92a5" fontSize={12} tickLine={false} axisLine={false} width={90} />
                  <Tooltip
                    cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                    contentStyle={{ backgroundColor: 'rgba(15, 17, 26, 0.95)', border: '1px solid rgba(0, 240, 255, 0.3)', borderRadius: '8px' }}
                    itemStyle={{ color: '#e5e5e5' }}
                    formatter={(value: any) => [formatBytes(value as number), 'Total Generated']}
                    labelStyle={{ color: '#8b92a5', marginBottom: '4px' }}
                  />
                  <Bar dataKey="totalUploaded" radius={[0, 6, 6, 0]}>
                    {leaderboard.map((_, i) => (
                      <Cell key={i} fill={i === 0 ? '#00f0ff' : i === 1 ? '#3ba7c9' : '#a855f7'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        <div className="glass-panel chart-panel">
          <h2 className="section-title">
            <Activity size={22} /> Network Traffic History
          </h2>
          <div className="chart-body">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={stats.history} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorSpeed" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#00f0ff" stopOpacity={0.35}/>
                    <stop offset="95%" stopColor="#00f0ff" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis dataKey="timeStr" stroke="#8b92a5" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis
                  stroke="#8b92a5"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(val) => formatBytes(val) + '/s'}
                  width={80}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: 'rgba(15, 17, 26, 0.95)', border: '1px solid rgba(0, 240, 255, 0.3)', borderRadius: '8px' }}
                  itemStyle={{ color: '#e5e5e5' }}
                  formatter={(value: any) => [formatBytes(value as number) + '/s', 'Upload Speed']}
                  labelStyle={{ color: '#8b92a5', marginBottom: '4px' }}
                />
                <Area type="monotone" dataKey="totalUploadSpeed" stroke="#00f0ff" fillOpacity={1} fill="url(#colorSpeed)" strokeWidth={2} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="glass-panel chart-panel">
          <h2 className="section-title">
            <Database size={22} /> Active Sessions History
          </h2>
          <div className="chart-body chart-body-sm">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={stats.history} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorSessions" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#a855f7" stopOpacity={0.35}/>
                    <stop offset="95%" stopColor="#a855f7" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis dataKey="timeStr" stroke="#8b92a5" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis
                  stroke="#8b92a5"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                  width={40}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: 'rgba(15, 17, 26, 0.95)', border: '1px solid rgba(168, 85, 247, 0.3)', borderRadius: '8px' }}
                  itemStyle={{ color: '#e5e5e5' }}
                  formatter={(value: any) => [value, 'Active Sessions']}
                  labelStyle={{ color: '#8b92a5', marginBottom: '4px' }}
                />
                <Area type="step" dataKey="activeSessions" stroke="#a855f7" fillOpacity={1} fill="url(#colorSessions)" strokeWidth={2} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {limitsEditor && (
        <div className="confirm-overlay" onClick={() => setLimitsEditor(null)}>
          <div className="confirm-dialog glass-panel" onClick={e => e.stopPropagation()}>
            <h3 className="confirm-title">
              <SlidersHorizontal size={20} /> Limits — {limitsEditor.username}
            </h3>
            <p className="confirm-message">Leave a field empty for unlimited.</p>
            <div className="form-group">
              <label>Max upload speed (MB/s)</label>
              <input type="number" min="0" step="0.5" className="form-control" placeholder="Unlimited"
                value={limitsEditor.maxSpeedMB}
                onChange={e => setLimitsEditor({ ...limitsEditor, maxSpeedMB: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Max concurrent sessions</label>
              <input type="number" min="0" step="1" className="form-control" placeholder="Unlimited"
                value={limitsEditor.maxSessions}
                onChange={e => setLimitsEditor({ ...limitsEditor, maxSessions: e.target.value })} />
            </div>
            <div className="confirm-actions">
              <button className="btn btn-secondary" onClick={() => setLimitsEditor(null)}>Cancel</button>
              <button className="btn btn-start" onClick={saveLimits}><Check size={18} /> Save Limits</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
