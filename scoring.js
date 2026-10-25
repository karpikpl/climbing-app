// Route value + leaderboard computation. Everything is derived from the raw
// attempt events, so values update live as the competition progresses.
const CATEGORY_BASE = { U11: 100, U13: 140, U15: 180, U17: 220, U19: 260, OPEN: 300 };
const MAX_ATTEMPTS = 25;
const ZONE_FRACTION = { low: 0.25, high: 0.5 };

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

function baseFor(route) {
  if (route.base) return route.base;
  return CATEGORY_BASE[String(route.category || 'OPEN').toUpperCase()] || CATEGORY_BASE.OPEN;
}

// Drops zone results for disabled zones (they degrade to a plain failed attempt).
function normalizeEvents(events, zones) {
  return events.map((e) => (e.result === 'low' || e.result === 'high') && !zones.includes(e.result) ? { ...e, result: 'fail' } : e);
}

function routeStats(routeId, usersEvents) {
  const s = { climbers: 0, tops: 0, attempts: 0, topAttempts: 0, low: 0, high: 0 };
  for (const events of usersEvents) {
    const mine = events.filter((e) => e.routeId === routeId);
    if (!mine.length) continue;
    s.climbers++;
    s.attempts += mine.length;
    if (mine.some((e) => e.result === 'low' || e.result === 'high')) s.low++;
    if (mine.some((e) => e.result === 'high')) s.high++;
    if (mine.some((e) => e.result === 'top')) { s.tops++; s.topAttempts += mine.length; }
  }
  return s;
}

function routeValue(route, s) {
  const base = baseFor(route);
  // Smoothed success rate (prior: 50% over 2 virtual climbers) -> harder routes are worth more.
  const success = (s.tops + 1) / (s.climbers + 2);
  const difficulty = 0.8 + 0.5 * (1 - success); // 0.8 .. 1.3
  // Smoothed attempts needed per top (prior: 2 attempts over 2 virtual tops).
  const avgAtt = (s.topAttempts + 4) / (s.tops + 2);
  const effort = clamp(1 + 0.05 * (avgAtt - 2), 0.9, 1.2);
  // Once more than 2 people topped it, it loses value for each additional top.
  const crowd = s.tops > 2 ? Math.max(0.35, Math.pow(0.92, s.tops - 2)) : 1;
  return Math.round(base * difficulty * effort * crowd);
}

function topMultiplier(attemptsToTop) {
  return Math.max(0.5, 1 - 0.05 * (attemptsToTop - 1));
}

function compute(routes, usersById, zones) {
  const evs = {};
  for (const [id, u] of Object.entries(usersById)) evs[id] = normalizeEvents(u.events || [], zones);
  const all = Object.values(evs);
  const routeInfo = routes.map((r) => {
    const stats = routeStats(r.id, all);
    return { ...r, stats, value: routeValue(r, stats) };
  });
  const valueOf = Object.fromEntries(routeInfo.map((r) => [r.id, r.value]));

  const climbers = {};
  for (const [id, u] of Object.entries(usersById)) {
    const events = evs[id];
    const perRoute = {};
    for (const e of events) {
      const p = (perRoute[e.routeId] ||= { attempts: 0, low: false, high: false, top: false, topAttempts: 0 });
      if (p.top) continue;
      p.attempts++;
      if (e.result === 'low') p.low = true;
      if (e.result === 'high') { p.low = true; p.high = true; }
      if (e.result === 'top') { p.top = true; p.topAttempts = p.attempts; }
    }
    let points = 0, tops = 0, zonesCount = 0;
    for (const [rid, p] of Object.entries(perRoute)) {
      const v = valueOf[rid] ?? 0;
      if (p.top) { points += v * topMultiplier(p.topAttempts); tops++; }
      else if (p.high) { points += v * ZONE_FRACTION.high; zonesCount++; }
      else if (p.low) { points += v * ZONE_FRACTION.low; zonesCount++; }
    }
    climbers[id] = {
      id, name: u.name, picture: u.picture || null, groups: u.groups || [],
      points: Math.round(points), tops, zones: zonesCount,
      attemptsUsed: events.length, perRoute,
    };
  }
  return { routes: routeInfo, climbers };
}

function rank(list) {
  return [...list]
    .sort((a, b) => b.points - a.points || b.tops - a.tops || a.attemptsUsed - b.attemptsUsed || a.name.localeCompare(b.name))
    .map((c, i) => ({ rank: i + 1, id: c.id, name: c.name, picture: c.picture, points: c.points, tops: c.tops, zones: c.zones, attemptsUsed: c.attemptsUsed }));
}

module.exports = { compute, rank, MAX_ATTEMPTS, CATEGORY_BASE };
