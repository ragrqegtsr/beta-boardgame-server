// server/server.js
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');

const { loadAll } = require('./dataLoader');
const { SessionStore } = require('./sessionStore');
const { drawCommonCards } = require('./deckManager');
const Journal = require('./journal');
const { TimerService } = require('./timerService');

const PORT = process.env.PORT || 3000;
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || '').split(',').filter(Boolean);

(async function main() {
  const app = express();
  app.use(express.json());
  app.use(cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (!ALLOWED_ORIGINS.length || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      return cb(new Error('Not allowed by CORS'), false);
    },
  }));

  const decks = loadAll(process.env.DATA_DIR || 'data');
  const store = new SessionStore();
  const server = http.createServer(app);
  const io = new Server(server, { path: '/ws', cors: { origin: ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS : true } });

  const timer = new TimerService({
    io,
    store,
    onAdvanceTurn: (session, meta = {}) => {
      endTurnAndMaybeAdvance(session, meta);
    }
  });

  function broadcast(session, event = 'SESSION_UPDATED') {
    io.to(session.code).emit(event, sanitizeStateForHost(session));
    io.to(session.code).emit('TIMER_TICK', {
      now: Date.now(),
      reminderAt: session.timers.reminderAt,
      endsAt: session.timers.graceEndsAt,
    });
  }

  function sanitizeStateForHost(session) {
    return {
      code: session.code,
      lang: session.lang,
      mode: session.mode,
      totalTurns: session.totalTurns,
      turnIndex: session.turnIndex,
      phase: session.phase,
      players: session.players.map(p => ({
        id: p.id, profile: p.profile, ready: p.ready, decision: p.decision, locked: p.locked,
      })),
      commonDraw: session.commonDraw,
      timers: session.timers,
      journal: session.journal,
      midgameBreakDone: session.midgameBreakDone,
      hostControls: session.hostControls,
      lastUpdateAt: session.lastUpdateAt,
    };
  }

  function sanitizeStateForPlayer(session, playerId) {
    const me = session.players.find(p => p.id === playerId);
    return {
      you: me ? { id: me.id, profile: me.profile, ready: me.ready, decision: me.decision, locked: me.locked } : null,
      code: session.code,
      turnIndex: session.turnIndex,
      totalTurns: session.totalTurns,
      phase: session.phase,
      commonDraw: session.commonDraw,
      timers: session.timers,
      players: session.players.map(p => ({ id: p.id, ready: p.ready, locked: p.locked })),
      lastUpdateAt: session.lastUpdateAt,
    };
  }

  function allPlayersReady(session) {
    return session.players.length > 0 && session.players.every(p => p.ready === true);
  }

  function inManualHostPhase(session) {
    const t = session.turnIndex + 1;
    return (t <= session.hostControls.manualUntilTurn) ||
           (t >= session.hostControls.manualLastTurnsFrom);
  }

  function midgameTurn(session) {
    if (session.mode === 'blitz') return 6;
    return 21;
  }

  function startTurn(session, meta = {}) {
    drawCommonCards(session, decks);
    session.players.forEach(p => { p.ready = false; p.decision = null; p.locked = false; });
    Journal.append(session, { type: 'TURN_STARTED', turn: session.turnIndex + 1, meta, draw: session.commonDraw });

    if (!session.midgameBreakDone && (session.turnIndex + 1) === midgameTurn(session)) {
      io.to(session.code).emit('MIDGAME_BREAK', { turn: session.turnIndex + 1 });
      session.midgameBreakDone = true;
    }

    if (inManualHostPhase(session)) {
      timer.clear(session.code);
    } else {
      timer.startTurnCountdown(session);
    }

    broadcast(session, 'TURN_STARTED');
  }

  function endTurnAndMaybeAdvance(session, meta = {}) {
    session.players.forEach(p => { if (p.decision != null) p.locked = true; });

    Journal.append(session, { type: 'TURN_ENDED', turn: session.turnIndex + 1, meta, players: session.players.map(p => ({ id: p.id, decision: p.decision })) });
    io.to(session.code).emit('TURN_ENDED', { turn: session.turnIndex + 1 });

    if (session.turnIndex + 1 >= session.totalTurns) {
      session.phase = 'ENDED';
      Journal.append(session, { type: 'GAME_ENDED', reason: meta.reason || 'NORMAL' });
      broadcast(session);
      setTimeout(() => store.endSession(session.code), 60_000);
      return;
    }

    session.turnIndex += 1;
    startTurn(session, { reason: 'AUTO_NEXT', ...meta });
  }

  app.get('/health', (_, res) => res.status(200).send('OK'));

  app.post('/session', (req, res) => {
    try {
      const { lang = 'fr', mode = 'long' } = req.body || {};
      const s = store.createSession({ lang, mode });
      Journal.append(s, { type: 'SESSION_CREATED', lang, mode });
      res.json({ code: s.code });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post('/session/:code/join', (req, res) => {
    try {
      const s = store.get(req.params.code);
      if (!s) return res.status(404).json({ error: 'Session not found' });
      if (s.phase === 'ENDED') return res.status(400).json({ error: 'Game ended' });

      let profile = req.body?.profile || null;
      if (!profile) {
        const pick = decks.profiles[Math.floor(Math.random() * decks.profiles.length)];
        profile = { id: pick.id, key: pick.key, name: pick.name };
      }
      const p = store.addPlayer(s.code, { profile });
      Journal.append(s, { type: 'PLAYER_JOIN', playerId: p.id, profile });
      res.json({ playerId: p.id, profile });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get('/session/:code/state', (req, res) => {
    const s = store.get(req.params.code);
    if (!s) return res.status(404).json({ error: 'Session not found' });
    const role = (req.query.role || 'host').toString();
    if (role === 'player') {
      const pid = (req.query.playerId || '').toString();
      return res.json(sanitizeStateForPlayer(s, pid));
    }
    return res.json(sanitizeStateForHost(s));
  });

  io.on('connection', (socket) => {
    socket.on('JOIN_SESSION', ({ code }) => {
      const s = store.get(code);
      if (!s) return socket.emit('ERROR', { error: 'Session not found' });
      socket.join(code);
      socket.emit('SESSION_UPDATED', sanitizeStateForHost(s));
    });

    socket.on('HOST_START', ({ code }) => {
      const s = store.get(code);
      if (!s) return socket.emit('ERROR', { error: 'Session not found' });
      if (s.phase !== 'SETUP') return socket.emit('ERROR', { error: 'Already started' });
      s.phase = 'PLAY'; s.turnIndex = 0;
      Journal.append(s, { type: 'GAME_STARTED' });
      startTurn(s, { reason: 'HOST_START' });
    });

    socket.on('HOST_NEXT_TURN', ({ code }) => {
      const s = store.get(code);
      if (!s) return socket.emit('ERROR', { error: 'Session not found' });
      if (!inManualHostPhase(s)) return socket.emit('ERROR', { error: 'Not in manual phase' });
      timer.clear(code);
      endTurnAndMaybeAdvance(s, { reason: 'HOST_NEXT_TURN' });
    });

    socket.on('HOST_CORRECT_ACTION', ({ code, actionId, patch }) => {
      const s = store.get(code);
      if (!s) return socket.emit('ERROR', { error: 'Session not found' });
      Journal.hostCorrect(s, actionId, patch);
      broadcast(s);
    });

    socket.on('HOST_KICK', ({ code, playerId }) => {
      const s = store.get(code);
      if (!s) return socket.emit('ERROR', { error: 'Session not found' });
      s.players = s.players.filter(p => p.id !== playerId);
      Journal.append(s, { type: 'HOST_KICK', playerId });
      broadcast(s);
    });

    socket.on('PLAYER_READY', ({ code, playerId }) => {
      const s = store.get(code);
      if (!s) return socket.emit('ERROR', { error: 'Session not found' });
      const p = s.players.find(pp => pp.id === playerId);
      if (!p) return socket.emit('ERROR', { error: 'Player not found' });
      p.ready = true;
      Journal.append(s, { type: 'PLAYER_READY', playerId });
      if (!inManualHostPhase(s) && allPlayersReady(s)) {
        timer.clear(code);
        endTurnAndMaybeAdvance(s, { reason: 'ALL_READY' });
      } else {
        broadcast(s);
      }
    });

    socket.on('PLAYER_DECIDE_EVENT', ({ code, playerId, decision }) => {
      const s = store.get(code);
      if (!s) return socket.emit('ERROR', { error: 'Session not found' });
      const p = s.players.find(pp => pp.id === playerId);
      if (!p) return socket.emit('ERROR', { error: 'Player not found' });
      if (p.locked) return socket.emit('ERROR', { error: 'Decision locked' });

      const val = (decision === 'accept' || decision === 'reject') ? decision : null;
      if (!val) return socket.emit('ERROR', { error: 'Invalid decision' });
      p.decision = val;
      Journal.append(s, { type: 'PLAYER_DECISION_EVENT', playerId, decision: val });
      broadcast(s);
    });

    socket.on('PLAYER_LOCK', ({ code, playerId }) => {
      const s = store.get(code);
      if (!s) return socket.emit('ERROR', { error: 'Session not found' });
      const p = s.players.find(pp => pp.id === playerId);
      if (!p) return socket.emit('ERROR', { error: 'Player not found' });
      p.locked = true;
      Journal.append(s, { type: 'PLAYER_LOCK', playerId });
      p.ready = true;

      if (!inManualHostPhase(s) && allPlayersReady(s)) {
        timer.clear(code);
        endTurnAndMaybeAdvance(s, { reason: 'ALL_READY' });
      } else {
        broadcast(s);
      }
    });

    socket.on('disconnect', () => {});
  });

  server.listen(PORT, () => {
    console.log(`[server] listening on :${PORT}`);
  });
})();
