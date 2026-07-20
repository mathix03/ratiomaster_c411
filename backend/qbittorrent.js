const express = require('express');
const axios = require('axios');
const multer = require('multer');
const FormData = require('form-data');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const auth = require('./auth');
const store = require('./database');
const { decrypt } = require('./secretbox');
const { JWT_SECRET } = require('./secret');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

const proxyLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many login attempts. Please wait a few minutes.'
});

const realQbitCookies = {};

const authenticateProxy = (req, res, next) => {
  const cookies = req.headers.cookie;
  if (!cookies) return res.status(403).send('Forbidden');
  
  const sidMatch = cookies.match(/SID=([^;]+)/);
  if (!sidMatch) return res.status(403).send('Forbidden');
  
  const token = sidMatch[1];
  try {
    const user = jwt.verify(token, JWT_SECRET);
    if (auth.isBlocked(user.username)) {
      return res.status(403).send('Forbidden');
    }
    req.user = user;
    next();
  } catch (err) {
    return res.status(403).send('Forbidden');
  }
};

const getRealQbitCookie = async (username) => {
  const enabled = store.getSetting(`qbitProxyEnabled_${username}`, false);
  if (!enabled) return null;

  const url = store.getSetting(`qbitRealUrl_${username}`, '');
  const user = store.getSetting(`qbitUsername_${username}`, '');
  const pass = decrypt(store.getSetting(`qbitPassword_${username}`, ''));

  if (!url) return null;

  const baseUrl = url.endsWith('/') ? url.slice(0, -1) : url;

  if (realQbitCookies[username]) {
    return { baseUrl, cookie: realQbitCookies[username] };
  }

  try {
    const response = await axios.post(`${baseUrl}/api/v2/auth/login`, `username=${encodeURIComponent(user)}&password=${encodeURIComponent(pass)}`, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      maxRedirects: 0,
      validateStatus: (status) => status >= 200 && status < 400
    });
    
    const setCookie = response.headers['set-cookie'];
    if (setCookie && setCookie.length > 0) {
      const realSidMatch = setCookie[0].match(/SID=([^;]+)/);
      if (realSidMatch) {
        realQbitCookies[username] = `SID=${realSidMatch[1]}`;
        return { baseUrl, cookie: realQbitCookies[username] };
      }
    }
    return null;
  } catch (error) {
    console.error('Failed to login to real qBittorrent:', error.message);
    return null;
  }
};

router.post('/auth/login', proxyLoginLimiter, express.urlencoded({ extended: true }), (req, res) => {
  const { username, password } = req.body;

  if (auth.verifyUser(username, password) && !auth.isBlocked(username)) {
    const token = auth.generateToken(username);
    res.cookie('SID', token, { httpOnly: true, sameSite: 'lax', secure: req.secure });
    return res.send('Ok.');
  }

  res.status(403).send('Fails.');
});

router.post('/torrents/add', authenticateProxy, upload.any(), async (req, res) => {
  const username = req.user.username;
  const proxyEnabled = store.getSetting(`qbitProxyEnabled_${username}`, false);
  
  if (req.files && req.files.length > 0) {
    for (const file of req.files) {
      if (file.fieldname === 'torrents') {
        try {
          const { default: parseTorrent } = await import('parse-torrent');
          const parsed = await parseTorrent(file.buffer);
          const sessionId = crypto.randomUUID();
          const newSession = {
            id: sessionId,
            userId: username,
            name: parsed.name || 'Unknown',
            infoHash: parsed.infoHash,
            status: 'seeding',
            downloaded: 0,
            uploaded: 0,
            uploadSpeed: 5 * 1024 * 1024,
            downloadSpeed: 0,
            peers: Math.floor(Math.random() * 20) + 5,
            progress: 1.0,
            startedAt: new Date().toISOString(),
            jellyfinPoster: null,
            clientName: 'qBittorrent/4.3.9'
          };
         
          store.addSession(newSession);
        } catch (err) {
          console.error('[Proxy] Failed to parse torrent for GhostSeed:', err.message);
        }
      }
    }
  }

  if (proxyEnabled) {
    const qbit = await getRealQbitCookie(username);
    if (qbit) {
      try {
        const form = new FormData();
        for (const key in req.body) {
          form.append(key, req.body[key]);
        }
        
        if (req.files) {
          for (const file of req.files) {
            form.append(file.fieldname, file.buffer, {
              filename: file.originalname,
              contentType: file.mimetype
            });
          }
        }
         
        await axios.post(`${qbit.baseUrl}/api/v2/torrents/add`, form, {
          headers: {
            ...form.getHeaders(),
            'Cookie': qbit.cookie
          }
        });
      } catch (err) {
        console.error('[Proxy] Failed to forward to real qBittorrent:', err.message);
      }
    }
  }

  return res.send('Ok.');
});

// 3. Transparent Proxy for all other requests (Utilisation de router.use compatible Express récent)
router.use(authenticateProxy, express.urlencoded({ extended: true }), async (req, res) => {
  const username = req.user.username;
  const proxyEnabled = store.getSetting(`qbitProxyEnabled_${username}`, false);
  
  if (!proxyEnabled) {
    if (req.path === '/app/webapiVersion') return res.send('2.9.2');
    if (req.path === '/sync/maindata') return res.json({ categories: {}, torrents: {} });
    if (req.path === '/torrents/info') return res.json([]);
    return res.send('Ok.');
  }

  let qbit = await getRealQbitCookie(username);
  if (!qbit) return res.status(500).send('Real qBittorrent not configured or offline');

  const forwardRequest = async (cookie) => {
    let data = req.body;
    if (req.headers['content-type'] && req.headers['content-type'].includes('application/x-www-form-urlencoded')) {
      data = new URLSearchParams(req.body).toString();
    }

    return axios({
      method: req.method,
      url: `${qbit.baseUrl}/api/v2${req.path}`,
      params: req.query,
      data: req.method === 'GET' ? undefined : data,
      headers: {
        'Cookie': cookie,
        ...(req.headers['content-type'] ? { 'Content-Type': req.headers['content-type'] } : {})
      },
      responseType: 'arraybuffer',
      validateStatus: () => true
    });
  };

  try {
    let response = await forwardRequest(qbit.cookie);
    
    if (response.status === 403) {
      delete realQbitCookies[username];
      qbit = await getRealQbitCookie(username);
      if (qbit) {
        response = await forwardRequest(qbit.cookie);
      }
    }

    for (const [key, value] of Object.entries(response.headers)) {
      if (key.toLowerCase() !== 'set-cookie' && key.toLowerCase() !== 'transfer-encoding') {
        res.setHeader(key, value);
      }
    }
    
    res.status(response.status).send(response.data);
  } catch (err) {
    console.error(`[Proxy] Error forwarding ${req.path}:`, err.message);
    res.status(500).send('Proxy Error');
  }
});

module.exports = router;