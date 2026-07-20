const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { JWT_SECRET } = require('./secret');

const USERS_FILE = path.join(__dirname, 'users.json');

// Initialize default admin user if file doesn't exist.
// Security: never ship fixed default credentials (admin/admin). Generate a
// strong random password and print it once so the operator can log in and
// change it. It is never stored in plaintext.
if (!fs.existsSync(USERS_FILE)) {
  const defaultPassword = crypto.randomBytes(9).toString('base64url'); // ~12 chars
  const hash = bcrypt.hashSync(defaultPassword, 10);

  const initialUsers = {
    admin: {
      passwordHash: hash,
      role: 'admin',
      createdAt: new Date().toISOString()
    }
  };
  fs.writeFileSync(USERS_FILE, JSON.stringify(initialUsers, null, 2));
  console.log('==================================================================');
  console.log('  Created default admin account');
  console.log(`  username: admin   password: ${defaultPassword}`);
  console.log('  ^ Log in and change this password immediately.');
  console.log('==================================================================');
}

function readUsers() {
  if (!fs.existsSync(USERS_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch (e) {
    console.error('Error reading users file:', e);
    return {};
  }
}

function writeUsers(users) {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
    return true;
  } catch (e) {
    console.error('Error writing users file:', e);
    return false;
  }
}

function verifyUser(username, password) {
  const users = readUsers();
  if (users[username]) {
    return bcrypt.compareSync(password, users[username].passwordHash);
  }
  return false;
}

function registerUser(username, password) {
  if (typeof username !== 'string' || typeof password !== 'string') {
    return { error: 'Username and password are required' };
  }

  username = username.trim();

  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) {
    return { error: 'Username must be 3-32 characters (letters, numbers, _ . -)' };
  }
  if (password.length < 6) {
    return { error: 'Password must be at least 6 characters' };
  }

  const users = readUsers();
  const exists = Object.keys(users).some(u => u.toLowerCase() === username.toLowerCase());
  if (exists) {
    return { error: 'This username is already taken' };
  }

  users[username] = {
    passwordHash: bcrypt.hashSync(password, 10),
    role: 'client', // new users are clients
    createdAt: new Date().toISOString(),
    blocked: false,
    totalUploaded: 0
  };

  if (!writeUsers(users)) {
    return { error: 'Failed to save user' };
  }

  return { success: true, username };
}

function isBlocked(username) {
  const users = readUsers();
  return !!(users[username] && users[username].blocked);
}

function listUsers() {
  const users = readUsers();
  return Object.entries(users).map(([username, data]) => ({
    username,
    role: data.role || 'client',
    createdAt: data.createdAt || null,
    blocked: !!data.blocked,
    totalUploaded: data.totalUploaded || 0,
    limits: {
      maxSpeed: (data.limits && data.limits.maxSpeed) || 0,
      maxSessions: (data.limits && data.limits.maxSessions) || 0
    }
  }));
}

function setBlocked(username, blocked) {
  const users = readUsers();
  if (!users[username]) return { error: 'User not found' };
  users[username].blocked = !!blocked;
  if (!writeUsers(users)) return { error: 'Failed to save user' };
  return { success: true };
}

function deleteUser(username) {
  const users = readUsers();
  if (!users[username]) return { error: 'User not found' };
  delete users[username];
  if (!writeUsers(users)) return { error: 'Failed to save user' };
  return { success: true };
}

function resetPassword(username) {
  const users = readUsers();
  if (!users[username]) return { error: 'User not found' };
  const tempPassword = crypto.randomBytes(5).toString('hex'); // 10 chars
  users[username].passwordHash = bcrypt.hashSync(tempPassword, 10);
  if (!writeUsers(users)) return { error: 'Failed to save user' };
  return { success: true, tempPassword };
}

function addUploaded(username, bytes) {
  if (!bytes || bytes <= 0) return;
  const users = readUsers();
  if (!users[username]) return;
  users[username].totalUploaded = (users[username].totalUploaded || 0) + bytes;
  writeUsers(users);
}

// Per-account quota limits. maxSpeed in bytes/s, maxSessions a count; 0 = unlimited.
function getLimits(username) {
  const users = readUsers();
  const l = (users[username] && users[username].limits) || {};
  return { maxSpeed: l.maxSpeed || 0, maxSessions: l.maxSessions || 0 };
}

function setLimits(username, limits) {
  const users = readUsers();
  if (!users[username]) return { error: 'User not found' };
  users[username].limits = {
    maxSpeed: Math.max(0, parseInt(limits.maxSpeed, 10) || 0),
    maxSessions: Math.max(0, parseInt(limits.maxSessions, 10) || 0)
  };
  if (!writeUsers(users)) return { error: 'Failed to save user' };
  return { success: true, limits: users[username].limits };
}

function changePassword(username, newPassword) {
  if (typeof newPassword !== 'string' || newPassword.length < 6) {
    return { error: 'Password must be at least 6 characters' };
  }
  const users = readUsers();
  if (!users[username]) return { error: 'User not found' };
  users[username].passwordHash = bcrypt.hashSync(newPassword, 10);
  if (!writeUsers(users)) return { error: 'Failed to save user' };
  return { success: true };
}

function generateToken(username) {
  const users = readUsers();
  const role = users[username] ? (users[username].role || 'client') : 'client';
  return jwt.sign({ username, role }, JWT_SECRET, { expiresIn: '24h' });
}

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (token == null) return res.sendStatus(401);

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    if (isBlocked(user.username)) {
      return res.status(403).json({ error: 'This account has been blocked' });
    }
    req.user = user;
    next();
  });
}

function isAdmin(req, res, next) {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({ error: 'Admin access required' });
  }
}

function getUserCount() {
  return Object.keys(readUsers()).length;
}

module.exports = {
  verifyUser,
  registerUser,
  generateToken,
  authenticateToken,
  isAdmin,
  getUserCount,
  isBlocked,
  listUsers,
  setBlocked,
  deleteUser,
  resetPassword,
  addUploaded,
  getLimits,
  setLimits,
  changePassword
};
