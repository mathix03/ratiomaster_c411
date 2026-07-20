const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'database.sqlite');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// Full snapshot of live sessions, so they survive a server restart.
// The session object is stored as JSON in `data`.
db.exec(`
  CREATE TABLE IF NOT EXISTS saved_sessions (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    data TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS session_history (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    name TEXT NOT NULL,
    infoHash TEXT NOT NULL,
    tracker TEXT NOT NULL,
    client TEXT,
    baseUploadSpeed INTEGER,
    uploaded INTEGER DEFAULT 0,
    startTime INTEGER,
    endTime INTEGER,
    config TEXT
  );

  CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    body TEXT NOT NULL,
    createdAt INTEGER NOT NULL,
    reply TEXT,
    repliedAt INTEGER,
    readByAdmin INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// ---- Live session snapshots ----
const upsertSessionStmt = db.prepare(
  'INSERT INTO saved_sessions (id, username, data) VALUES (@id, @username, @data) ' +
  'ON CONFLICT(id) DO UPDATE SET username=@username, data=@data'
);

function saveSession(session) {
  // intervalId is a runtime handle, never persist it
  const { intervalId, ...rest } = session;
  upsertSessionStmt.run({ id: session.id, username: session.username, data: JSON.stringify(rest) });
}

function deleteSavedSession(id) {
  db.prepare('DELETE FROM saved_sessions WHERE id = ?').run(id);
}

function loadSavedSessions() {
  return db.prepare('SELECT data FROM saved_sessions').all().map(row => JSON.parse(row.data));
}

// ---- Completed session history ----
const insertHistoryStmt = db.prepare(
  'INSERT OR REPLACE INTO session_history ' +
  '(id, username, name, infoHash, tracker, client, baseUploadSpeed, uploaded, startTime, endTime, config) ' +
  'VALUES (@id, @username, @name, @infoHash, @tracker, @client, @baseUploadSpeed, @uploaded, @startTime, @endTime, @config)'
);

function recordHistory(session) {
  insertHistoryStmt.run({
    id: session.id,
    username: session.username,
    name: session.name,
    infoHash: session.infoHash,
    tracker: session.tracker,
    client: session.client || 'qBittorrent',
    baseUploadSpeed: session.baseUploadSpeed || 0,
    uploaded: session.uploaded || 0,
    startTime: session.startTime || null,
    endTime: Date.now(),
    config: JSON.stringify({
      useSequence: session.useSequence,
      sequenceLoops: session.sequenceLoops,
      stopAtSize: session.stopAtSize,
      stopAtTime: session.stopAtTime,
      initialUploadedGB: session.initialUploadedGB,
      initialDownloadedGB: session.initialDownloadedGB,
      posterUrl: session.posterUrl,
      jellyfinItemId: session.jellyfinItemId
    })
  });
}

function getHistory(username, limit = 50) {
  const rows = db.prepare(
    'SELECT * FROM session_history WHERE username = ? ORDER BY endTime DESC LIMIT ?'
  ).all(username, limit);
  return rows.map(r => ({ ...r, config: r.config ? JSON.parse(r.config) : {} }));
}

// ---- Key/value store (global admin stats) ----
function setKv(key, value) {
  db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, JSON.stringify(value));
}

function getKv(key, fallback = null) {
  const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key);
  return row ? JSON.parse(row.value) : fallback;
}

// ---- Settings (string key/value) ----
function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value);
}

function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

// ---- Messages (user → admin, with admin replies) ----
function addMessage(username, body) {
  const info = db.prepare('INSERT INTO messages (username, body, createdAt) VALUES (?, ?, ?)')
    .run(username, body, Date.now());
  return info.lastInsertRowid;
}

function getUserMessages(username) {
  return db.prepare('SELECT * FROM messages WHERE username = ? ORDER BY createdAt DESC LIMIT 100').all(username);
}

function getAllMessages() {
  return db.prepare('SELECT * FROM messages ORDER BY createdAt DESC LIMIT 200').all();
}

function replyToMessage(id, reply) {
  const info = db.prepare('UPDATE messages SET reply = ?, repliedAt = ?, readByAdmin = 1 WHERE id = ?')
    .run(reply, Date.now(), id);
  return info.changes > 0;
}

function markMessageRead(id) {
  return db.prepare('UPDATE messages SET readByAdmin = 1 WHERE id = ?').run(id).changes > 0;
}

function deleteMessage(id) {
  return db.prepare('DELETE FROM messages WHERE id = ?').run(id).changes > 0;
}

function countUnreadMessages() {
  return db.prepare('SELECT COUNT(*) AS n FROM messages WHERE readByAdmin = 0').get().n;
}

module.exports = {
  db,
  saveSession,
  deleteSavedSession,
  loadSavedSessions,
  recordHistory,
  getHistory,
  setKv,
  getKv,
  addMessage,
  getUserMessages,
  getAllMessages,
  replyToMessage,
  markMessageRead,
  deleteMessage,
  countUnreadMessages,
  setSetting,
  getSetting
};
