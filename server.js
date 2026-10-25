const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { OAuth2Client } = require('google-auth-library');
const { compute, rank, MAX_ATTEMPTS } = require('./scoring');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const USERNAME_LOGIN = process.env.ALLOW_USERNAME_LOGIN !== 'false';
const ADMINS = (process.env.ADMINS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
// ZONES: comma list of enabled zones ("low,high" by default; empty or "none" disables all).
const ZONES = (process.env.ZONES ?? 'low,high').split(',').map((s) => s.trim().toLowerCase()).filter((z) => z === 'low' || z === 'high');

fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = path.join(DATA_DIR, 'db.json');
const ROUTES_FILE = path.join(DATA_DIR, 'routes.json');
const SECRET_FILE = path.join(DATA_DIR, 'secret');

const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
function writeJson(f, v) {
  const tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(v));
  fs.renameSync(tmp, f);
}

let db = readJson(DB_FILE, { users: {} });
let routes = readJson(ROUTES_FILE, null);
if (!routes) {
  routes = readJson(path.join(__dirname, 'data', 'seed-routes.json'), []);
  writeJson(ROUTES_FILE, routes);
}
let secret = process.env.SESSION_SECRET;
if (!secret) {
  try { secret = fs.readFileSync(SECRET_FILE, 'utf8'); } catch {
    secret = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(SECRET_FILE, secret, { mode: 0o600 });
  }
}

// Permanently remove zone data for disabled zones (the attempt itself is kept).
let purged = 0;
for (const u of Object.values(db.users))
  for (const e of u.events || [])
    if ((e.result === 'low' || e.result === 'high') && !ZONES.includes(e.result)) { e.result = 'fail'; purged++; }
if (purged) { writeJson(DB_FILE, db); console.log(`Purged ${purged} disabled-zone entries`); }

const save = () => writeJson(DB_FILE, db);

const sign = (p) => { const b = Buffer.from(JSON.stringify(p)).toString('base64url'); return `${b}.${crypto.createHmac('sha256', secret).update(b).digest('base64url')}`; };
function verify(t) {
  if (!t) return null;
  const [b, sig] = t.split('.');
  if (!b || !sig) return null;
  const exp = crypto.createHmac('sha256', secret).update(b).digest('base64url');
  if (sig.length !== exp.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(exp))) return null;
  try { return JSON.parse(Buffer.from(b, 'base64url').toString()); } catch { return null; }
}
const cookieOf = (req, n) => (req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).find(([k]) => k === n)?.[1];
function setSession(res, id) {
  res.setHeader('Set-Cookie', `s=${sign({ id })}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
}

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/healthz', (_, res) => res.send('ok'));

function auth(req, res, next) {
  const s = verify(cookieOf(req, 's'));
  const user = s && db.users[s.id];
  if (!user) return res.status(401).json({ error: 'Not logged in' });
  req.uid = s.id; req.user = user; next();
}

const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);
const clean = (s, n) => String(s || '').replace(/[<>]/g, '').trim().slice(0, n);

app.get('/api/config', (_, res) => res.json({ googleClientId: GOOGLE_CLIENT_ID, usernameLogin: USERNAME_LOGIN, zones: ZONES, maxAttempts: MAX_ATTEMPTS }));

app.post('/api/login/google', async (req, res) => {
  if (!GOOGLE_CLIENT_ID) return res.status(400).json({ error: 'Google login not configured' });
  try {
    const t = await googleClient.verifyIdToken({ idToken: req.body.credential, audience: GOOGLE_CLIENT_ID });
    const p = t.getPayload();
    const id = `g:${p.sub}`;
    db.users[id] ||= { events: [], groups: [], created: Date.now() };
    Object.assign(db.users[id], { name: clean(p.name || p.email, 40), picture: p.picture, email: p.email });
    save(); setSession(res, id); res.json({ ok: true });
  } catch { res.status(401).json({ error: 'Invalid Google token' }); }
});

app.post('/api/login/username', (req, res) => {
  if (!USERNAME_LOGIN) return res.status(403).json({ error: 'Username login disabled' });
  const name = clean(req.body.username, 30);
  if (name.length < 2) return res.status(400).json({ error: 'Username must be at least 2 characters' });
  const id = `u:${name.toLowerCase()}`;
  db.users[id] ||= { name, events: [], groups: [], created: Date.now() };
  save(); setSession(res, id); res.json({ ok: true });
});

app.post('/api/logout', (_, res) => { res.setHeader('Set-Cookie', 's=; Path=/; Max-Age=0'); res.json({ ok: true }); });

const isAdmin = (u) => ADMINS.includes((u.email || '').toLowerCase());

app.get('/api/state', auth, (req, res) => {
  const { routes: info, climbers } = compute(routes, db.users, ZONES);
  const me = climbers[req.uid];
  const groupNames = [...new Set(Object.values(db.users).flatMap((u) => u.groups || []))].sort();
  const groups = groupNames.map((g) => {
    const members = Object.values(climbers).filter((c) => c.groups.includes(g));
    return { name: g, joined: me.groups.includes(g), members: members.length, leaderboard: rank(members) };
  });
  res.json({
    me: { id: req.uid, name: me.name, picture: me.picture, groups: me.groups, points: me.points, attemptsUsed: me.attemptsUsed, attemptsLeft: MAX_ATTEMPTS - me.attemptsUsed, admin: isAdmin(req.user) },
    zones: ZONES, maxAttempts: MAX_ATTEMPTS,
    routes: info.map((r) => ({ id: r.id, number: r.number, category: r.category, name: r.name, value: r.value, stats: r.stats, mine: me.perRoute[r.id] || null })),
    global: rank(Object.values(climbers)),
    groups,
  });
});

app.post('/api/log', auth, (req, res) => {
  const { routeId, result } = req.body;
  const allowed = ['fail', 'top', ...ZONES];
  if (!routes.some((r) => r.id === routeId)) return res.status(400).json({ error: 'Unknown route' });
  if (!allowed.includes(result)) return res.status(400).json({ error: 'Invalid result' });
  const ev = req.user.events;
  if (ev.length >= MAX_ATTEMPTS) return res.status(400).json({ error: 'No attempts left' });
  if (ev.some((e) => e.routeId === routeId && e.result === 'top')) return res.status(400).json({ error: 'Already topped' });
  ev.push({ routeId, result, t: Date.now() });
  save(); res.json({ ok: true });
});

app.post('/api/undo', auth, (req, res) => { req.user.events.pop(); save(); res.json({ ok: true }); });

app.post('/api/groups/join', auth, (req, res) => {
  const g = clean(req.body.name, 24).toLowerCase().replace(/\s+/g, '-');
  if (!g) return res.status(400).json({ error: 'Group name required' });
  if (!req.user.groups.includes(g)) req.user.groups.push(g);
  save(); res.json({ ok: true });
});
app.post('/api/groups/leave', auth, (req, res) => {
  req.user.groups = req.user.groups.filter((g) => g !== req.body.name);
  save(); res.json({ ok: true });
});

app.post('/api/admin/routes', auth, (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Admins only' });
  const list = req.body;
  if (!Array.isArray(list) || !list.every((r) => r.id && r.number != null && r.category)) return res.status(400).json({ error: 'Expected array of {id, number, category, name?}' });
  routes = list; writeJson(ROUTES_FILE, routes); res.json({ ok: true, count: routes.length });
});

if (require.main === module) app.listen(PORT, () => console.log(`Listening on :${PORT}, zones=[${ZONES}], data=${DATA_DIR}`));
module.exports = app;
