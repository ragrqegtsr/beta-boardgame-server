// server/timerService.js
class TimerService {
  constructor({ io, store, onAdvanceTurn }) {
    this.io = io;
    this.store = store;
    this.onAdvanceTurn = onAdvanceTurn;
    this.handles = new Map();
    this._reminderSent = {};
  }

  clear(code) {
    const h = this.handles.get(code);
    if (h) {
      clearInterval(h.tick);
      this.handles.delete(code);
    }
    const s = this.store.get(code);
    if (s) {
      s.timers.running = false;
      s.timers.endsAt = s.timers.reminderAt = s.timers.graceEndsAt = null;
    }
    this._reminderSent[code] = false;
  }

  startTurnCountdown(session) {
    this.clear(session.code);
    const now = Date.now();
    const threeMin = 3 * 60 * 1000;
    const oneMin = 60 * 1000;

    session.timers.running = true;
    session.timers.reminderAt = now + threeMin;
    session.timers.graceEndsAt = now + threeMin + oneMin;
    session.timers.endsAt = session.timers.graceEndsAt;

    const tick = setInterval(() => {
      const tnow = Date.now();
      const msToReminder = session.timers.reminderAt - tnow;
      const msToEnd = session.timers.graceEndsAt - tnow;

      this.io.to(session.code).emit('TIMER_TICK', {
        now: tnow,
        reminderAt: session.timers.reminderAt,
        endsAt: session.timers.graceEndsAt,
      });

      if (!this._reminderSent[session.code] && msToReminder <= 0) {
        this._reminderSent[session.code] = true;
        this.io.to(session.code).emit('SESSION_UPDATED', { kind: 'REMINDER', msg: 'Merci de rentrer vos décisions (rappel) !' });
      }

      if (msToEnd <= 0) {
        this.clear(session.code);
        for (const p of session.players) {
          if (p.decision == null) {
            p.decision = Math.random() < 0.5 ? 'accept' : 'reject';
          }
        }
        this.onAdvanceTurn(session, { reason: 'TIMER_EXPIRED' });
      }
    }, 1000);

    this.handles.set(session.code, { tick });
  }
}

module.exports = { TimerService };
