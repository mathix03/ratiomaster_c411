const express = require('express');
const cors = require('cors');
const multer = require('multer');
const axios = require('axios');
const crypto = require('crypto');
const path = require('path');
const auth = require('./auth');
const store = require('./database');
const qbittorrentRouter = require('./qbittorrent');

const app = express();
app.use(cors());
app.use(express.json());

// Admin Stats tracking — restored from disk on boot so a restart doesn't reset totals
const adminStats = {
  history: store.getKv('adminStats.history', []),
  totalUploadedEver: store.getKv('adminStats.totalUploadedEver', 0),
  totalSessionsEver: store.getKv('adminStats.totalSessionsEver', 0)
};
const MAX_HISTORY = 1000;

function persistAdminStats() {
  store.setKv('adminStats.history', adminStats.history);
  store.setKv('adminStats.totalUploadedEver', adminStats.totalUploadedEver);
  store.setKv('adminStats.totalSessionsEver', adminStats.totalSessionsEver);
}

// ---- Real-time admin stream (Server-Sent Events) ----
// Every open admin dashboard holds one SSE connection here. Any action that
// changes admin-visible state calls broadcastAdmin(), which pushes a fresh
// snapshot to all of them instantly. A slow periodic tick keeps the live
// upload counters (which grow between announces) ticking smoothly.
const adminStreams = new Set();

function buildAdminSnapshot() {
  const now = Date.now();
  const running = Array.from(activeSessions.values()).filter(s => s.status === 'running');
  const activeCount = running.length;
  const currentSpeed = running.reduce((acc, s) => acc + s.currentUploadSpeed, 0);
  // Bytes uploaded since each session's last announce, not yet persisted
  const liveTotalDelta = running.reduce(
    (acc, s) => acc + Math.floor(((now - s.lastAnnounce) / 1000) * s.currentUploadSpeed), 0
  );

  const users = auth.listUsers().map(u => {
    const userRunning = running.filter(s => s.username === u.username);
    const liveDelta = userRunning.reduce(
      (acc, s) => acc + Math.floor(((now - s.lastAnnounce) / 1000) * s.currentUploadSpeed), 0
    );
    return {
      ...u,
      totalUploaded: u.totalUploaded + liveDelta,
      activeSessions: userRunning.length,
      currentUploadSpeed: userRunning.reduce((acc, s) => acc + s.currentUploadSpeed, 0)
    };
  });

  return {
    stats: {
      history: adminStats.history,
      totalUploadedEver: adminStats.totalUploadedEver + liveTotalDelta,
      totalSessionsEver: adminStats.totalSessionsEver,
      totalUsers: users.length,
      activeNow: activeCount,
      currentUploadSpeed: currentSpeed
    },
    users,
    messages: { messages: store.getAllMessages(), unread: store.countUnreadMessages() }
  };
}

function broadcastAdmin() {
  if (adminStreams.size === 0) return;
  const payload = `data: ${JSON.stringify(buildAdminSnapshot())}\n\n`;
  for (const res of adminStreams) {
    try { res.write(payload); } catch { /* connection already gone; cleaned up on 'close' */ }
  }
}

setInterval(() => {
  const now = Date.now();
  const sessions = Array.from(activeSessions.values());
  const activeCount = sessions.filter(s => s.status === 'running').length;
  const currentSpeed = sessions.reduce((acc, s) => acc + (s.status === 'running' ? s.currentUploadSpeed : 0), 0);

  adminStats.history.push({
    time: now,
    activeSessions: activeCount,
    totalUploadSpeed: currentSpeed
  });

  if (adminStats.history.length > MAX_HISTORY) {
    adminStats.history.shift();
  }
  persistAdminStats();
  broadcastAdmin(); // push the new history point to open dashboards right away
}, 60000); // every minute

// Keep live upload counters and speeds ticking on open dashboards (no-op when none are connected)
setInterval(broadcastAdmin, 2000);

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (auth.verifyUser(username, password)) {
    if (auth.isBlocked(username)) {
      return res.status(403).json({ error: 'This account has been blocked' });
    }
    const token = auth.generateToken(username);
    res.json({ success: true, token });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

app.post('/api/register', (req, res) => {
  const { username, password } = req.body;
  const result = auth.registerUser(username, password);
  if (result.success) {
    const token = auth.generateToken(result.username);
    broadcastAdmin(); // new account should appear on admin dashboards immediately
    res.json({ success: true, token });
  } else {
    res.status(400).json({ error: result.error });
  }
});

// Protect all API routes below this point (except login/register which are above)
app.use('/api', (req, res, next) => {
  if (req.path === '/login' || req.path === '/register' || req.path.startsWith('/v2/')) return next();
  return auth.authenticateToken(req, res, next);
});

// Mount qBittorrent proxy at /api/v2
app.use('/api/v2', qbittorrentRouter);

app.get('/api/admin/stats', auth.isAdmin, (req, res) => {
  const userCount = auth.getUserCount();
  res.json({ ...adminStats, totalUsers: userCount });
});

// Real-time admin feed. The admin dashboard opens this once and receives a full
// snapshot immediately, then a new snapshot on every state change.
app.get('/api/admin/stream', auth.isAdmin, (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no' // disable proxy buffering so events flush immediately
  });
  res.write('retry: 3000\n\n');
  res.write(`data: ${JSON.stringify(buildAdminSnapshot())}\n\n`);
  adminStreams.add(res);

  // Comment heartbeat keeps the connection alive through idle proxies/tunnels
  const heartbeat = setInterval(() => {
    try { res.write(': ping\n\n'); } catch { /* ignore */ }
  }, 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    adminStreams.delete(res);
  });
});

// Stop (and optionally remove) every session belonging to a user
async function stopUserSessions(username, removeSessions = false) {
  for (const [sessionId, session] of activeSessions.entries()) {
    if (session.username !== username) continue;
    clearInterval(session.intervalId);
    if (session.status === 'running') {
      session.status = 'stopped';
      session.currentUploadSpeed = 0;
      await announce(session, 'stopped');
      store.recordHistory(session);
    }
    if (removeSessions) {
      activeSessions.delete(sessionId);
      store.deleteSavedSession(sessionId);
    } else {
      store.saveSession(session);
    }
  }
}

app.get('/api/admin/users', auth.isAdmin, (req, res) => {
  const now = Date.now();
  const sessions = Array.from(activeSessions.values());
  const users = auth.listUsers().map(u => {
    const running = sessions.filter(s => s.username === u.username && s.status === 'running');
    // Uploaded bytes accrued since each session's last announce, not yet persisted
    const liveDelta = running.reduce((acc, s) => acc + Math.floor(((now - s.lastAnnounce) / 1000) * s.currentUploadSpeed), 0);
    return {
      ...u,
      totalUploaded: u.totalUploaded + liveDelta,
      activeSessions: running.length,
      currentUploadSpeed: running.reduce((acc, s) => acc + s.currentUploadSpeed, 0),
      limits: auth.getLimits(u.username)
    };
  });
  res.json(users);
});

app.post('/api/admin/users/:username/limits', auth.isAdmin, (req, res) => {
  const { username } = req.params;
  // maxSpeed in bytes/s (0 or null = unlimited), maxSessions count (0 or null = unlimited)
  const maxSpeedMB = req.body.maxSpeedMB;
  const maxSessions = req.body.maxSessions;
  const limits = {
    maxSpeed: maxSpeedMB ? Math.round(parseFloat(maxSpeedMB) * 1024 * 1024) : 0,
    maxSessions: maxSessions ? parseInt(maxSessions, 10) : 0
  };
  const result = auth.setLimits(username, limits);
  if (result.error) return res.status(400).json({ error: result.error });
  addLog(null, `Admin ${req.user.username} set limits for "${username}": ${maxSpeedMB || '∞'} MB/s, ${maxSessions || '∞'} sessions`, 'info');
  broadcastAdmin();
  res.json({ success: true, limits });
});

app.post('/api/admin/users/:username/block', auth.isAdmin, async (req, res) => {
  const { username } = req.params;
  const blocked = !!req.body.blocked;
  if (username === req.user.username) {
    return res.status(400).json({ error: 'You cannot block your own account' });
  }
  const result = auth.setBlocked(username, blocked);
  if (result.error) return res.status(400).json({ error: result.error });
  if (blocked) {
    await stopUserSessions(username);
    addLog(null, `Admin ${req.user.username} blocked account "${username}" (sessions stopped)`, 'warning');
  } else {
    addLog(null, `Admin ${req.user.username} unblocked account "${username}"`, 'info');
  }
  broadcastAdmin();
  res.json({ success: true, blocked });
});

app.post('/api/admin/users/:username/reset-password', auth.isAdmin, (req, res) => {
  const { username } = req.params;
  const result = auth.resetPassword(username);
  if (result.error) return res.status(400).json({ error: result.error });
  addLog(null, `Admin ${req.user.username} reset password for "${username}"`, 'warning');
  res.json({ success: true, tempPassword: result.tempPassword });
});

app.delete('/api/admin/users/:username', auth.isAdmin, async (req, res) => {
  const { username } = req.params;
  if (username === req.user.username) {
    return res.status(400).json({ error: 'You cannot delete your own account' });
  }
  await stopUserSessions(username, true);
  const result = auth.deleteUser(username);
  if (result.error) return res.status(400).json({ error: result.error });
  addLog(null, `Admin ${req.user.username} deleted account "${username}"`, 'warning');
  broadcastAdmin();
  res.json({ success: true });
});


// In-memory store for active sessions
const activeSessions = new Map();

// Global logs — `username` tags who owns the log so clients only see their own,
// while admins see everything. Logs without a username are admin-only (system/admin actions).
const globalLogs = [];
function addLog(sessionId, message, type = 'info', username = null) {
  const time = new Date().toLocaleTimeString();
  const shortId = sessionId ? sessionId.substring(0, 8) : 'SYSTEM';
  globalLogs.push({ time, sessionId: shortId, message, type, username });
  if (globalLogs.length > 100) globalLogs.shift();
  console.log(`[${time}] [${shortId}] ${message}`);
}

const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 200 * 1024 * 1024 } // 200 MB limit
});

function generatePeerId(client = 'qBittorrent') {
  let prefix = '';
  if (client === 'qBittorrent') {
    prefix = '-qB4350-';
  } else if (client === 'Transmission') {
    prefix = '-TR3000-';
  } else {
    prefix = '-qB4350-'; // default
  }
  const randomStr = crypto.randomBytes(6).toString('hex');
  return prefix + randomStr;
}

function generateKey() {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

app.post('/api/torrent/parse', upload.single('torrent'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No torrent file uploaded' });
    }
    
    const torrentData = req.file.buffer;
    const { default: parseTorrent } = await import('parse-torrent');
    const parsed = await parseTorrent(torrentData);
    
    const trackers = parsed.announce || [];
    if (trackers.length === 0) {
      return res.status(400).json({ error: 'No trackers found in torrent' });
    }

    res.json({
      name: parsed.name,
      infoHash: parsed.infoHash,
      length: parsed.length,
      trackers: trackers
    });
  } catch (error) {
    console.error('Error parsing torrent:', error);
    res.status(500).json({ error: 'Failed to parse torrent' });
  }
});

function createAnnounceUrl(trackerUrl, params) {
  const url = new URL(trackerUrl);
  Object.keys(params).forEach(key => url.searchParams.append(key, params[key]));
  return url.toString();
}

async function announce(session, event) {
  const { tracker, infoHash, peerId, port, uploaded, downloaded, left, key, client } = session;
  
  // Create URLSearchParams to handle proper encoding
  // InfoHash needs specific encoding (URL encoded binary string)
  const infoHashBuffer = Buffer.from(infoHash, 'hex');
  let infoHashStr = '';
  for (let i = 0; i < infoHashBuffer.length; i++) {
    const hex = infoHashBuffer[i].toString(16).toUpperCase();
    infoHashStr += '%' + (hex.length === 1 ? '0' + hex : hex);
  }

  const params = [
    `info_hash=${infoHashStr}`,
    `peer_id=${peerId}`,
    `port=${port}`,
    `uploaded=${uploaded}`,
    `downloaded=${downloaded}`,
    `left=${left}`,
    `corrupt=0`,
    `key=${key}`,
    `event=${event}`,
    `numwant=200`,
    `compact=1`,
    `no_peer_id=1`
  ];

  const fullUrl = `${tracker}${tracker.includes('?') ? '&' : '?'}${params.join('&')}`;

  let userAgent = 'qBittorrent/4.3.5';
  if (client === 'Transmission') userAgent = 'Transmission/3.00';

  try {
    const response = await axios.get(fullUrl, {
      headers: {
        'User-Agent': userAgent,
        'Accept-Encoding': 'gzip'
      },
      responseType: 'arraybuffer' // Tracker responses are often bencoded
    });
    
    // Parse bencoded response to extract leechers (incomplete) and seeders (complete)
    try {
      const { default: bencode } = await import('bencode');
      const decoded = bencode.decode(response.data);
      if (decoded.incomplete !== undefined) {
        session.leechers = decoded.incomplete;
      }
      if (decoded.complete !== undefined) {
        session.seeders = decoded.complete;
      }
    } catch (e) {
      addLog(session.id, `Failed to decode tracker response: ${e.message}`, 'error', session.username);
    }

    addLog(session.id, `Announce successful: ${event} (Seeders: ${session.seeders}, Leechers: ${session.leechers})`, 'success', session.username);
    return true;
  } catch (error) {
    addLog(session.id, `Announce failed: ${error.message}`, 'error', session.username);
    return false;
  }
}

const SEQUENCE = [
  { type: 'active', duration: 4 },
  { type: 'pause', duration: 2 },
  { type: 'active', duration: 10 },
  { type: 'pause', duration: 4 },
  { type: 'active', duration: 15 },
  { type: 'pause', duration: 2 },
  { type: 'active', duration: 6 },
  { type: 'pause', duration: 1 }
];
const totalSequenceDuration = SEQUENCE.reduce((acc, step) => acc + step.duration, 0) * 60 * 1000;

// Drives a single session's announce loop. Extracted so it can be started both
// from /api/session/start and when restoring persisted sessions after a restart.
function startSessionLoop(session) {
  const sessionId = session.id;
  const interval = setInterval(async () => {
    const currentSession = activeSessions.get(sessionId);
    if (!currentSession || currentSession.status !== 'running') {
      clearInterval(interval);
      return;
    }

    // Calculate uploaded since last announce
    const now = Date.now();
    const elapsedSeconds = (now - currentSession.lastAnnounce) / 1000;

    // Add uploaded data based on the PREVIOUS currentUploadSpeed
    const uploadedDelta = Math.floor(elapsedSeconds * currentSession.currentUploadSpeed);
    currentSession.uploaded += uploadedDelta;
    adminStats.totalUploadedEver += uploadedDelta; // Track global stats
    auth.addUploaded(currentSession.username, uploadedDelta); // Track per-user stats

    currentSession.lastAnnounce = now;
    currentSession.nextAnnounce = now + 60000;

    let shouldStop = false;

    // Sequence Logic
    if (currentSession.leechers === 0) {
      if (currentSession.sequenceState !== 'safety_pause') {
        addLog(sessionId, `Safety Pause: 0 Leechers detected. Stopping upload.`, 'warning', currentSession.username);
      }
      currentSession.sequenceState = 'safety_pause';
      currentSession.currentUploadSpeed = 0;
    } else if (currentSession.useSequence) {
      const elapsedSinceStart = now - currentSession.startTime;
      const currentLoop = Math.floor(elapsedSinceStart / totalSequenceDuration);

      if (currentLoop >= currentSession.sequenceLoops) {
        shouldStop = true;
        addLog(sessionId, `Auto-stopping: Sequence loops reached.`, 'info', currentSession.username);
      } else {
        const timeInCurrentLoop = elapsedSinceStart % totalSequenceDuration;
        let accumulated = 0;
        let currentStep = SEQUENCE[0];
        for (const step of SEQUENCE) {
          accumulated += step.duration * 60 * 1000;
          if (timeInCurrentLoop < accumulated) {
            currentStep = step;
            break;
          }
        }

        if (currentSession.sequenceState !== currentStep.type) {
           addLog(sessionId, `Sequence changed to: ${currentStep.type.toUpperCase()}`, 'info', currentSession.username);
        }
        currentSession.sequenceState = currentStep.type;

        if (currentStep.type === 'active') {
          currentSession.currentUploadSpeed = fluctuate(currentSession.baseUploadSpeed);
        } else {
          currentSession.currentUploadSpeed = 0;
        }
      }
    } else {
      // Normal fluctuation
      currentSession.currentUploadSpeed = fluctuate(currentSession.baseUploadSpeed);
      currentSession.sequenceState = 'active';
    }

    // Auto-stop logic (Size/Time)
    if (currentSession.stopAtSize && currentSession.uploaded >= currentSession.stopAtSize) {
      shouldStop = true;
      addLog(sessionId, `Auto-stopping: Upload size limit reached.`, 'info', currentSession.username);
    }
    if (currentSession.stopAtTime && (now - currentSession.startTime) >= currentSession.stopAtTime) {
      shouldStop = true;
      addLog(sessionId, `Auto-stopping: Time limit reached.`, 'info', currentSession.username);
    }

    if (shouldStop) {
      currentSession.status = 'stopped';
      currentSession.currentUploadSpeed = 0;
      await announce(currentSession, 'stopped');
      clearInterval(interval);
      store.recordHistory(currentSession);
      store.deleteSavedSession(sessionId);
      broadcastAdmin();
      return;
    }

    store.saveSession(currentSession); // persist progress each announce
    await announce(currentSession, '');
    broadcastAdmin(); // push updated upload totals / speeds to admin dashboards
  }, 60000);

  session.intervalId = interval;
}

function fluctuate(baseSpeed) {
  const factor = 1 + (Math.random() * 0.3 - 0.15);
  return Math.floor(baseSpeed * factor);
}

app.get('/api/settings', (req, res) => {
  res.json({
    jellyfinUrl: store.getSetting(`jellyfinUrl_${req.user.username}`, ''),
    jellyfinApiKey: store.getSetting(`jellyfinApiKey_${req.user.username}`, ''),
    qbitProxyEnabled: store.getSetting(`qbitProxyEnabled_${req.user.username}`, false),
    qbitRealUrl: store.getSetting(`qbitRealUrl_${req.user.username}`, ''),
    qbitUsername: store.getSetting(`qbitUsername_${req.user.username}`, ''),
    qbitPassword: store.getSetting(`qbitPassword_${req.user.username}`, '')
  });
});

app.post('/api/settings', (req, res) => {
  const { jellyfinUrl, jellyfinApiKey, qbitProxyEnabled, qbitRealUrl, qbitUsername, qbitPassword } = req.body;
  if (jellyfinUrl !== undefined) store.setSetting(`jellyfinUrl_${req.user.username}`, jellyfinUrl);
  if (jellyfinApiKey !== undefined) store.setSetting(`jellyfinApiKey_${req.user.username}`, jellyfinApiKey);
  if (qbitProxyEnabled !== undefined) store.setSetting(`qbitProxyEnabled_${req.user.username}`, qbitProxyEnabled);
  if (qbitRealUrl !== undefined) store.setSetting(`qbitRealUrl_${req.user.username}`, qbitRealUrl);
  if (qbitUsername !== undefined) store.setSetting(`qbitUsername_${req.user.username}`, qbitUsername);
  if (qbitPassword !== undefined) store.setSetting(`qbitPassword_${req.user.username}`, qbitPassword);
  res.json({ success: true });
});

app.get('/api/jellyfin/search', async (req, res) => {
  const { query } = req.query;
  const jellyfinUrl = store.getSetting(`jellyfinUrl_${req.user.username}`, '');
  const jellyfinApiKey = store.getSetting(`jellyfinApiKey_${req.user.username}`, '');

  if (!jellyfinUrl || !jellyfinApiKey) {
    return res.status(400).json({ error: 'Jellyfin is not configured for your account' });
  }

  try {
    const url = new URL(jellyfinUrl);
    const baseUrl = url.origin + url.pathname.replace(/\/$/, '');
    const searchUrl = `${baseUrl}/Items?SearchTerm=${encodeURIComponent(query)}&IncludeItemTypes=Movie,Series&Recursive=true&Fields=PrimaryImageAspectRatio`;
    
    const response = await axios.get(searchUrl, {
      headers: {
        'Authorization': `MediaBrowser Token="${jellyfinApiKey}"`
      }
    });

    const items = response.data.Items.map(item => ({
      id: item.Id,
      name: item.Name,
      type: item.Type,
      productionYear: item.ProductionYear,
      posterUrl: item.ImageTags && item.ImageTags.Primary ? `${baseUrl}/Items/${item.Id}/Images/Primary` : null
    }));

    res.json({ results: items });
  } catch (err) {
    console.error('Error searching Jellyfin:', err.message);
    res.status(500).json({ error: 'Failed to search Jellyfin' });
  }
});

app.post('/api/session/start', async (req, res) => {
  const { infoHash, tracker, baseUploadSpeed, client = 'qBittorrent', stopAtSizeMB, stopAtTimeMins, name, useSequence, sequenceLoops, initialUploadedGB, initialDownloadedGB, posterUrl, jellyfinItemId } = req.body;

  if (!infoHash || !tracker) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Per-account quota enforcement
  const limits = auth.getLimits(req.user.username);
  const myRunning = Array.from(activeSessions.values())
    .filter(s => s.username === req.user.username && s.status === 'running').length;
  if (limits.maxSessions && myRunning >= limits.maxSessions) {
    return res.status(403).json({ error: `Session limit reached (max ${limits.maxSessions} concurrent sessions for your account)` });
  }

  let effectiveSpeed = parseInt(baseUploadSpeed, 10) || 1024 * 1024;
  if (limits.maxSpeed && effectiveSpeed > limits.maxSpeed) {
    effectiveSpeed = limits.maxSpeed; // silently cap to the account's max speed
  }

  const sessionId = crypto.randomUUID();
  const session = {
    id: sessionId,
    username: req.user.username,
    name: name || 'Unknown Torrent',
    infoHash,
    tracker,
    client,
    peerId: generatePeerId(client),
    key: generateKey(),
    port: Math.floor(Math.random() * (65535 - 1024 + 1)) + 1024,
    uploaded: 0,
    downloaded: 0,
    left: 0, // spoofing a seed
    baseUploadSpeed: effectiveSpeed,
    currentUploadSpeed: effectiveSpeed,
    stopAtSize: stopAtSizeMB ? parseInt(stopAtSizeMB, 10) * 1024 * 1024 : null,
    stopAtTime: stopAtTimeMins ? parseInt(stopAtTimeMins, 10) * 60 * 1000 : null,
    useSequence: !!useSequence,
    sequenceLoops: parseInt(sequenceLoops, 10) || 1,
    initialUploadedGB: initialUploadedGB ? parseFloat(initialUploadedGB) : 0,
    initialDownloadedGB: initialDownloadedGB ? parseFloat(initialDownloadedGB) : 0,
    startTime: Date.now(),
    status: 'running',
    sequenceState: 'active', // 'active' or 'pause'
    lastAnnounce: Date.now(),
    nextAnnounce: Date.now() + 60000,
    leechers: -1,
    seeders: -1,
    posterUrl: posterUrl || null,
    jellyfinItemId: jellyfinItemId || null
  };

  activeSessions.set(sessionId, session);
  adminStats.totalSessionsEver += 1; // Track global stats
  store.saveSession(session);

  // Send initial 'started' announce
  await announce(session, 'started');

  startSessionLoop(session);
  broadcastAdmin();

  res.json({ sessionId, session: { ...session, intervalId: undefined } });
});

app.post('/api/session/stop', async (req, res) => {
  const { sessionId } = req.body;
  const session = activeSessions.get(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  if (session.username !== req.user.username && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  session.status = 'stopped';
  session.currentUploadSpeed = 0;
  clearInterval(session.intervalId);
  addLog(sessionId, `Manual Stop requested.`, 'warning', session.username);
  await announce(session, 'stopped');
  store.recordHistory(session);
  store.saveSession(session); // keep the stopped card, but persisted as stopped
  broadcastAdmin();

  res.json({ success: true });
});

app.post('/api/session/remove', async (req, res) => {
  const { sessionId } = req.body;
  const session = activeSessions.get(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  if (session.username !== req.user.username && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  if (session.status === 'running') {
    clearInterval(session.intervalId);
    await announce(session, 'stopped');
    store.recordHistory(session);
  }

  activeSessions.delete(sessionId);
  store.deleteSavedSession(sessionId);
  addLog(sessionId, `Session removed.`, 'info', session.username);
  broadcastAdmin();
  res.json({ success: true });
});

app.post('/api/session/stop-all', async (req, res) => {
  const promises = [];
  const sessionsToRemove = [];
  for (const [sessionId, session] of activeSessions.entries()) {
    if (session.username === req.user.username) {
      session.status = 'stopped';
      clearInterval(session.intervalId);
      promises.push(announce(session, 'stopped'));
      store.recordHistory(session);
      sessionsToRemove.push(sessionId);
    }
  }

  await Promise.all(promises);
  sessionsToRemove.forEach(id => { activeSessions.delete(id); store.deleteSavedSession(id); });
  broadcastAdmin();

  res.json({ success: true });
});

app.get('/api/session/status/:sessionId', (req, res) => {
  const session = activeSessions.get(req.params.sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  if (session.username !== req.user.username && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  
  // Live calculation of uploaded
  const now = Date.now();
  const elapsedSeconds = (now - session.lastAnnounce) / 1000;
  const liveUploaded = session.status === 'running' 
    ? session.uploaded + Math.floor(elapsedSeconds * session.currentUploadSpeed)
    : session.uploaded;
  const liveNextAnnounce = session.status === 'running' ? Math.max(0, session.nextAnnounce - now) : 0;

  res.json({
    ...session,
    uploaded: liveUploaded,
    nextAnnounceInMs: liveNextAnnounce,
    intervalId: undefined
  });
});

app.get('/api/sessions', (req, res) => {
  const now = Date.now();
  const sessionsList = Array.from(activeSessions.values())
    .filter(session => session.username === req.user.username || req.user.role === 'admin')
    .map(session => {
      const elapsedSeconds = (now - session.lastAnnounce) / 1000;
      const liveUploaded = session.status === 'running' 
        ? session.uploaded + Math.floor(elapsedSeconds * session.currentUploadSpeed)
        : session.uploaded;
      const liveNextAnnounce = session.status === 'running' ? Math.max(0, session.nextAnnounce - now) : 0;
        
      return {
        ...session,
        uploaded: liveUploaded,
        nextAnnounceInMs: liveNextAnnounce,
        intervalId: undefined
      };
    });
  res.json(sessionsList);
});

app.post('/api/sessions/stop-all', async (req, res) => {
  addLog(null, `PANIC BUTTON PRESSED by ${req.user.username}: Stopping their sessions!`, 'warning', req.user.username);
  const sessions = Array.from(activeSessions.values())
    .filter(session => session.username === req.user.username);

  for (const session of sessions) {
    if (session.status === 'running') {
      session.status = 'stopped';
      session.currentUploadSpeed = 0;
      clearInterval(session.intervalId);
      await announce(session, 'stopped');
      store.recordHistory(session);
      store.saveSession(session);
    }
  }
  broadcastAdmin();
  res.json({ success: true });
});

app.get('/api/logs', (req, res) => {
  // Admins see all logs; clients only see logs tagged with their own username.
  if (req.user.role === 'admin') {
    return res.json(globalLogs);
  }
  res.json(globalLogs.filter(log => log.username === req.user.username));
});

app.get('/api/history', (req, res) => {
  res.json(store.getHistory(req.user.username, 50));
});

// Current user's own profile: stats + effective quota limits
app.get('/api/me', (req, res) => {
  const now = Date.now();
  const me = auth.listUsers().find(u => u.username === req.user.username);
  if (!me) return res.status(404).json({ error: 'User not found' });
  const running = Array.from(activeSessions.values())
    .filter(s => s.username === req.user.username && s.status === 'running');
  const liveDelta = running.reduce((acc, s) => acc + Math.floor(((now - s.lastAnnounce) / 1000) * s.currentUploadSpeed), 0);
  res.json({
    username: me.username,
    role: me.role,
    createdAt: me.createdAt,
    totalUploaded: me.totalUploaded + liveDelta,
    activeSessions: running.length,
    limits: auth.getLimits(req.user.username)
  });
});

app.post('/api/me/password', (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!auth.verifyUser(req.user.username, currentPassword || '')) {
    return res.status(400).json({ error: 'Current password is incorrect' });
  }
  const result = auth.changePassword(req.user.username, newPassword || '');
  if (result.error) return res.status(400).json({ error: result.error });
  addLog(null, `User ${req.user.username} changed their password`, 'info', req.user.username);
  res.json({ success: true });
});

// ---- Messages: users write to the admins, admins reply ----
app.post('/api/messages', (req, res) => {
  const body = typeof req.body.body === 'string' ? req.body.body.trim() : '';
  if (!body) return res.status(400).json({ error: 'Message cannot be empty' });
  if (body.length > 2000) return res.status(400).json({ error: 'Message is too long (max 2000 characters)' });
  const id = store.addMessage(req.user.username, body);
  addLog(null, `New message from ${req.user.username}`, 'info', req.user.username);
  broadcastAdmin(); // new message + unread badge should appear on admin dashboards instantly
  res.json({ success: true, id });
});

app.get('/api/messages', (req, res) => {
  res.json(store.getUserMessages(req.user.username));
});

app.get('/api/admin/messages', auth.isAdmin, (req, res) => {
  res.json({ messages: store.getAllMessages(), unread: store.countUnreadMessages() });
});

app.post('/api/admin/messages/:id/reply', auth.isAdmin, (req, res) => {
  const reply = typeof req.body.reply === 'string' ? req.body.reply.trim() : '';
  if (!reply) return res.status(400).json({ error: 'Reply cannot be empty' });
  if (!store.replyToMessage(parseInt(req.params.id, 10), reply)) {
    return res.status(404).json({ error: 'Message not found' });
  }
  broadcastAdmin();
  res.json({ success: true });
});

app.post('/api/admin/messages/:id/read', auth.isAdmin, (req, res) => {
  if (!store.markMessageRead(parseInt(req.params.id, 10))) {
    return res.status(404).json({ error: 'Message not found' });
  }
  broadcastAdmin();
  res.json({ success: true });
});

app.delete('/api/admin/messages/:id', auth.isAdmin, (req, res) => {
  if (!store.deleteMessage(parseInt(req.params.id, 10))) {
    return res.status(404).json({ error: 'Message not found' });
  }
  broadcastAdmin();
  res.json({ success: true });
});

let caffeinateProcess = null;
app.post('/api/caffeinate', (req, res) => {
  const { enable } = req.body;
  if (enable) {
    if (!caffeinateProcess) {
      caffeinateProcess = require('child_process').spawn('caffeinate', ['-dis']);
      console.log('Caffeinate started (System Keep Awake ON)');
    }
  } else {
    if (caffeinateProcess) {
      caffeinateProcess.kill();
      caffeinateProcess = null;
      console.log('Caffeinate stopped (System Keep Awake OFF)');
    }
  }
  res.json({ success: true, enabled: !!caffeinateProcess });
});

// Serve frontend static files
app.use(express.static(path.join(__dirname, '../frontend/dist')));

// Catch-all route to serve index.html for React Router
app.use((req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/dist/index.html'));
});

// Restore sessions that were live when the server was last shut down.
function restoreSessions() {
  const saved = store.loadSavedSessions();
  let restored = 0;
  for (const session of saved) {
    session.intervalId = undefined;
    activeSessions.set(session.id, session);
    if (session.status === 'running') {
      // Resume the announce clock from now so the first tick doesn't over-credit
      session.lastAnnounce = Date.now();
      session.nextAnnounce = Date.now() + 60000;
      startSessionLoop(session);
      announce(session, 'started').catch(() => {});
      restored++;
    }
  }
  if (saved.length > 0) {
    addLog(null, `Restored ${restored} running session(s) after restart (${saved.length} total persisted)`, 'info');
  }
}

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
  restoreSessions();
});
