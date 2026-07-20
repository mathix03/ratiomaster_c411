// Central source of truth for the JWT signing secret.
//
// Security: never ship a hard-coded fallback secret. A known secret in a public
// repo lets anyone forge a token like { username, role: 'admin' } and take over.
//
// Resolution order:
//   1. process.env.JWT_SECRET  (recommended for production; set it in your env)
//   2. a persistent, locally-generated random secret stored in backend/.jwt-secret
//      (gitignored, mode 0600) so tokens survive restarts without ever being guessable
//   3. an in-memory random secret (last resort; logs out everyone on each restart)
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SECRET_FILE = path.join(__dirname, '.jwt-secret');
const MIN_LENGTH = 32;

function loadOrCreateSecret() {
  const fromEnv = process.env.JWT_SECRET;
  if (fromEnv && fromEnv.length >= 16 && fromEnv !== 'fallback_secret_key_change_in_production') {
    return fromEnv;
  }

  try {
    if (fs.existsSync(SECRET_FILE)) {
      const stored = fs.readFileSync(SECRET_FILE, 'utf8').trim();
      if (stored.length >= MIN_LENGTH) return stored;
    }
  } catch { /* fall through and regenerate */ }

  const generated = crypto.randomBytes(48).toString('hex');
  try {
    fs.writeFileSync(SECRET_FILE, generated, { mode: 0o600 });
    console.warn('[security] JWT_SECRET not set — generated a persistent random secret (backend/.jwt-secret).');
  } catch (e) {
    console.warn('[security] Could not persist JWT secret, using an in-memory one (tokens reset on restart):', e.message);
  }
  return generated;
}

const JWT_SECRET = loadOrCreateSecret();

// A stable 32-byte key derived from the JWT secret, used to encrypt secrets at rest.
const ENCRYPTION_KEY = crypto.createHash('sha256').update(JWT_SECRET).digest();

module.exports = { JWT_SECRET, ENCRYPTION_KEY };
