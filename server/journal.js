// server/journal.js
function append(session, entry) {
  const id = `${session.journal.length + 1}`;
  const rec = { id, at: Date.now(), ...entry };
  session.journal.push(rec);
  session.lastUpdateAt = Date.now();
  return rec;
}

function hostCorrect(session, actionId, patch) {
  const original = session.journal.find(j => j.id === String(actionId));
  const corr = {
    type: 'HOST_CORRECTION',
    targetActionId: String(actionId),
    patch,
    originalSnapshot: original ? JSON.parse(JSON.stringify(original)) : null,
  };
  return append(session, corr);
}

module.exports = { append, hostCorrect };
