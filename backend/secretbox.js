// Symmetric encryption for secrets stored at rest (qBittorrent password,
// Jellyfin API key). Uses AES-256-GCM with a key derived from the app secret.
//
// Backward compatible: decrypt() returns legacy plaintext values untouched, so
// existing rows keep working and get encrypted the next time they are saved.
const crypto = require('crypto');
const { ENCRYPTION_KEY } = require('./secret');

const PREFIX = 'enc:v1:';

function encrypt(plain) {
  if (typeof plain !== 'string' || plain.length === 0) return plain;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + [iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':');
}

function decrypt(stored) {
  if (typeof stored !== 'string' || !stored.startsWith(PREFIX)) return stored; // legacy plaintext
  try {
    const [ivB64, tagB64, ctB64] = stored.slice(PREFIX.length).split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return ''; // wrong key or tampered value — never expose ciphertext
  }
}

module.exports = { encrypt, decrypt };
