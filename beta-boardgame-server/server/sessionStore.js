// server/sessionStore.js
const { randomBytes } = require('crypto');

function code4() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWX123456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

class SessionStore {
  constructor() {
    this.sessionsByCode = new Map();
  }

  createSession({ lang = 'fr', mode = 'long' }) {
    const totalTurns = mode === 'blitz' ? 10 : 42;
    const code = code4();
    const session = {
      code,
      lang,
      mode,
      totalTurns,
      turnIndex: 0,
      phase: 'SETUP',
      players: [],
      commonDraw: null,
      exclusions: {
        eventIds: new Set(),
        miscBonusIds: new Set(),
        miscContrainteIds: new Set(),
      },
      timers: {
        running: false,
        endsAt: null,
        reminderAt: null,
        graceEndsAt: null,
      },
      journal: [],
      midgameBreakDone: false,
      createdAt: Date.now(),
      lastUpdateAt: Date.now(),
      hostControls: {
        manualUntilTurn: 5,
        manualLastTurnsFrom: (totalTurns - 5) + 1,
      },
    };
    this.sessionsByCode.set(code, session);
    return session;
  }

  get(code) {
    return this.sessionsByCode.get(code) || null;
  }

  endSession(code) {
    this.sessionsByCode.delete(code);
  }

  addPlayer(code, { profile }) {
    const s = this.get(code);
    if (!s) throw new Error('Session not found');
    const id = randomBytes(6).toString('hex');
    const p = { id, profile: profile || null, ready: false, decision: null, locked: false, joinedAt: Date.now() };
    s.players.push(p);
    s.lastUpdateAt = Date.now();
    return p;
  }

  markDirty(session) {
    session.lastUpdateAt = Date.now();
  }
}

module.exports = { SessionStore };
