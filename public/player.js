const els = {
  sessionCode: document.querySelector('#player-session-code'),
  playerTurn: document.querySelector('#player-turn'),
  playerStatus: document.querySelector('#player-status'),
  playerProfile: document.querySelector('#player-profile'),
  leaveButton: document.querySelector('#leave-session'),
  joinCard: document.querySelector('#join-card'),
  joinForm: document.querySelector('#join-form'),
  cards: document.querySelector('#player-common-cards'),
  cardRefresh: document.querySelector('#player-card-refresh'),
  notes: document.querySelector('#player-notes'),
  timerRing: document.querySelector('#player-timer-ring'),
  timerValue: document.querySelector('#player-timer-value'),
  timerStatus: document.querySelector('#player-timer-status'),
  timerProgress: document.querySelector('#player-timer-progress'),
  actionAccept: document.querySelector('#action-accept'),
  actionReject: document.querySelector('#action-reject'),
  actionLock: document.querySelector('#action-lock'),
  actionReady: document.querySelector('#action-ready'),
  journal: document.querySelector('#player-journal'),
  journalCount: document.querySelector('#player-journal-count'),
  team: document.querySelector('#player-team'),
  teamCount: document.querySelector('#player-team-count'),
  metricDecisions: document.querySelector('#metric-decisions'),
  metricIncome: document.querySelector('#metric-income'),
  metricExpense: document.querySelector('#metric-expense'),
  midgameBanner: document.querySelector('#player-midgame'),
  toastContainer: document.querySelector('#player-toasts'),
};

let socket = null;
let sessionCode = null;
let playerId = null;
let hostState = null;
let playerState = null;
let lastTimerTick = null;

function showToast(title, message) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `<strong>${title}</strong><p>${message}</p>`;
  els.toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(6px)';
  }, 3600);
  setTimeout(() => toast.remove(), 4400);
}

function formatDateTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatRelative(ts) {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  if (diff < 5000) return 'À l'instant';
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'Il y a quelques secondes';
  if (min === 1) return 'Il y a 1 min';
  if (min < 60) return `Il y a ${min} min`;
  return `Il y a ${Math.floor(min / 60)} h`;
}

function updateTimer(now, reminderAt, endsAt) {
  if (!reminderAt || !endsAt) {
    els.timerValue.textContent = '--:--';
    els.timerStatus.textContent = 'En attente du lancement';
    els.timerRing.style.setProperty('--timer-progress', '0%');
    els.timerProgress.style.setProperty('--progress', 0);
    return;
  }
  const start = reminderAt - (3 * 60 * 1000);
  const total = endsAt - start;
  const remaining = Math.max(0, endsAt - now);
  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000).toString().padStart(2, '0');
  els.timerValue.textContent = `${minutes}:${seconds}`;
  const progress = Math.min(1, Math.max(0, (now - start) / total));
  els.timerRing.style.setProperty('--timer-progress', `${progress * 100}%`);
  els.timerProgress.style.setProperty('--progress', progress);

  if (remaining <= 0) {
    els.timerStatus.textContent = 'Tour terminé';
    return;
  }
  if (now >= reminderAt) {
    els.timerStatus.textContent = 'Phase de grâce';
    els.timerRing.style.background = `conic-gradient(var(--danger) ${progress * 100}%, rgba(199,220,255,0.12) 0)`;
  } else {
    els.timerStatus.textContent = 'Tour en cours';
    els.timerRing.style.background = `conic-gradient(var(--navy-300) ${progress * 100}%, rgba(199,220,255,0.12) 0)`;
  }
}

function renderCommonCards(draw) {
  els.cards.innerHTML = '';
  if (!draw) {
    const empty = document.createElement('p');
    empty.textContent = 'En attente du prochain tirage.';
    els.cards.appendChild(empty);
    return;
  }
  Object.entries(draw).forEach(([type, card]) => {
    const node = document.createElement('article');
    node.className = 'common-card';
    node.dataset.type = type;
    const category = document.createElement('span');
    category.className = 'category';
    category.textContent = card.category || type;
    const title = document.createElement('h3');
    title.textContent = card.title;
    const slug = document.createElement('p');
    slug.className = 'slug';
    slug.textContent = card.slug || '';
    node.appendChild(category);
    node.appendChild(title);
    node.appendChild(slug);
    els.cards.appendChild(node);
  });
}

function renderJournal(journal = []) {
  els.journal.innerHTML = '';
  if (!journal.length) {
    const empty = document.createElement('p');
    empty.textContent = 'Vos actions apparaîtront ici.';
    els.journal.appendChild(empty);
  }
  journal.slice().reverse().forEach(entry => {
    const node = document.createElement('div');
    node.className = 'timeline-entry';
    const title = document.createElement('h4');
    title.textContent = `${formatDateTime(entry.at)} · ${entry.type.replace('PLAYER_', '')}`;
    const body = document.createElement('p');
    if (entry.type === 'PLAYER_DECISION_EVENT') {
      body.textContent = entry.decision === 'accept' ? 'Décision acceptée (revenus)' : 'Décision refusée (dépenses)';
    } else if (entry.type === 'PLAYER_READY') {
      body.textContent = 'Vous êtes prêt';
    } else if (entry.type === 'PLAYER_LOCK') {
      body.textContent = 'Décision verrouillée';
    } else {
      body.textContent = JSON.stringify(entry);
    }
    node.appendChild(title);
    node.appendChild(body);
    els.journal.appendChild(node);
  });
  els.journalCount.textContent = `${journal.length} entrée${journal.length > 1 ? 's' : ''}`;
}

function renderTeam(players = []) {
  els.team.innerHTML = '';
  if (!players.length) {
    const empty = document.createElement('p');
    empty.textContent = 'Aucun autre joueur connecté.';
    els.team.appendChild(empty);
  }
  players.forEach((p, idx) => {
    const card = document.createElement('div');
    card.className = 'player-card';
    if (p.id === playerId) {
      card.style.borderColor = 'rgba(31, 111, 235, 0.55)';
    }
    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.textContent = (p.profile?.name || `J${idx + 1}`).slice(0, 2).toUpperCase();
    const info = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = p.profile?.name || `Joueur ${idx + 1}`;
    name.style.display = 'block';
    name.style.marginBottom = '4px';
    const status = document.createElement('div');
    status.className = 'badge-line';
    const ready = document.createElement('span');
    ready.className = `status-pill ${p.ready ? 'ready' : ''}`;
    ready.textContent = p.ready ? 'Prêt' : 'En réflexion';
    const locked = document.createElement('span');
    locked.className = `status-pill ${p.locked ? 'locked' : ''}`;
    locked.textContent = p.locked ? 'Verrouillé' : 'Ouvert';
    status.appendChild(ready);
    status.appendChild(locked);
    info.appendChild(name);
    info.appendChild(status);
    const decision = document.createElement('span');
    decision.className = 'badge';
    decision.textContent = p.decision ? (p.decision === 'accept' ? 'Accepte' : 'Refuse') : '—';
    info.appendChild(decision);
    card.appendChild(avatar);
    card.appendChild(info);
    els.team.appendChild(card);
  });
  els.teamCount.textContent = `${players.length} joueur${players.length > 1 ? 's' : ''}`;
}

function updateMetrics(journal = []) {
  const decisions = journal.filter(e => e.type === 'PLAYER_DECISION_EVENT');
  const income = decisions.filter(e => e.decision === 'accept');
  const expense = decisions.filter(e => e.decision === 'reject');
  els.metricDecisions.textContent = decisions.length;
  els.metricIncome.textContent = income.length;
  els.metricExpense.textContent = expense.length;
}

function updateActions() {
  const phase = hostState?.phase;
  const you = playerState?.you;
  const playable = phase === 'PLAY' && you;
  els.actionAccept.disabled = !playable || you.locked;
  els.actionReject.disabled = !playable || you.locked;
  els.actionLock.disabled = !playable || you.locked || !you.decision;
  els.actionReady.disabled = !playable || you.ready;
  els.notes.disabled = !you;
  els.leaveButton.disabled = !you;
}

function updateHeader() {
  els.sessionCode.textContent = sessionCode || '—';
  if (!hostState) {
    els.playerTurn.textContent = '—';
  } else {
    els.playerTurn.textContent = `${hostState.turnIndex + 1} / ${hostState.totalTurns}`;
  }
  const you = playerState?.you;
  if (!you) {
    els.playerStatus.textContent = 'Hors ligne';
    return;
  }
  if (hostState?.phase === 'SETUP') {
    els.playerStatus.textContent = 'En préparation';
  } else if (you.locked) {
    els.playerStatus.textContent = 'Décision verrouillée';
  } else if (you.ready) {
    els.playerStatus.textContent = 'Prêt';
  } else {
    els.playerStatus.textContent = 'En réflexion';
  }
}

function updateProfile() {
  const name = playerState?.you?.profile?.name;
  const key = playerState?.you?.profile?.key;
  if (!name) {
    els.playerProfile.textContent = 'Profil non défini';
  } else {
    els.playerProfile.textContent = key ? `${name} · ${key}` : name;
  }
}

function render() {
  updateHeader();
  updateProfile();
  renderCommonCards(hostState?.commonDraw || null);
  const personalJournal = (hostState?.journal || []).filter(entry => entry.playerId === playerId);
  renderJournal(personalJournal);
  renderTeam(hostState?.players || []);
  updateMetrics(personalJournal);
  els.cardRefresh.textContent = hostState?.commonDraw ? `Mis à jour ${formatRelative(hostState.lastUpdateAt)}` : 'En attente';
  updateActions();
}

function persistContext() {
  if (sessionCode && playerId) {
    localStorage.setItem('bbg-player-context', JSON.stringify({ sessionCode, playerId }));
  }
}

function clearContext() {
  localStorage.removeItem('bbg-player-context');
  sessionCode = null;
  playerId = null;
  hostState = null;
  playerState = null;
  render();
}

async function refreshPlayerState() {
  if (!sessionCode || !playerId) return;
  try {
    const res = await fetch(`/session/${sessionCode}/state?role=player&playerId=${playerId}`);
    if (!res.ok) return;
    playerState = await res.json();
    loadNotes();
    render();
  } catch (err) {
    console.error(err);
  }
}

function connectSocket() {
  if (!sessionCode) return;
  if (socket) socket.disconnect();
  socket = io({ path: '/ws' });
  socket.emit('JOIN_SESSION', { code: sessionCode });
  socket.on('SESSION_UPDATED', payload => {
    if (payload && payload.kind) {
      showToast('Info', payload.msg || payload.kind);
      return;
    }
    hostState = payload;
    render();
    refreshPlayerState();
  });
  socket.on('TIMER_TICK', data => {
    lastTimerTick = data;
    updateTimer(data.now, data.reminderAt, data.endsAt);
  });
  socket.on('TURN_STARTED', data => {
    showToast('Nouveau tour', `Tour ${data.turn} lancé`);
  });
  socket.on('TURN_ENDED', data => {
    showToast('Fin de tour', `Tour ${data.turn} terminé`);
  });
  socket.on('MIDGAME_BREAK', data => {
    els.midgameBanner.classList.add('active');
    showToast('Pause', `Tour ${data.turn}`);
  });
  socket.on('ERROR', data => {
    showToast('Erreur', data.error || 'Action impossible');
  });
}

function loadNotes() {
  if (!sessionCode || !playerId) return;
  const key = `bbg-notes-${sessionCode}-${playerId}`;
  els.notes.value = localStorage.getItem(key) || '';
}

function saveNotes() {
  if (!sessionCode || !playerId) return;
  const key = `bbg-notes-${sessionCode}-${playerId}`;
  localStorage.setItem(key, els.notes.value);
}

els.notes.addEventListener('input', saveNotes);

els.actionAccept.addEventListener('click', () => {
  if (!socket || !sessionCode || !playerId) return;
  socket.emit('PLAYER_DECIDE_EVENT', { code: sessionCode, playerId, decision: 'accept' });
  refreshPlayerState();
});

els.actionReject.addEventListener('click', () => {
  if (!socket || !sessionCode || !playerId) return;
  socket.emit('PLAYER_DECIDE_EVENT', { code: sessionCode, playerId, decision: 'reject' });
  refreshPlayerState();
});

els.actionLock.addEventListener('click', () => {
  if (!socket || !sessionCode || !playerId) return;
  socket.emit('PLAYER_LOCK', { code: sessionCode, playerId });
  refreshPlayerState();
});

els.actionReady.addEventListener('click', () => {
  if (!socket || !sessionCode || !playerId) return;
  socket.emit('PLAYER_READY', { code: sessionCode, playerId });
  refreshPlayerState();
});

els.leaveButton.addEventListener('click', () => {
  clearContext();
  els.joinCard.style.display = 'block';
  els.joinForm.reset();
  els.notes.value = '';
  if (socket) socket.disconnect();
  showToast('Session quittée', 'Vous pouvez rejoindre une nouvelle partie.');
});

els.joinForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const code = (form.get('code') || '').trim().toUpperCase();
  const name = (form.get('name') || '').trim();
  if (!code) return;
  try {
    const res = await fetch(`/session/${code}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile: name ? { name } : undefined }),
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      throw new Error(payload.error || 'Impossible de rejoindre la session');
    }
    const json = await res.json();
    sessionCode = code;
    playerId = json.playerId;
    persistContext();
    els.joinCard.style.display = 'none';
    connectSocket();
    await refreshPlayerState();
    showToast('Bienvenue', `Vous avez rejoint la session ${code}`);
  } catch (err) {
    showToast('Erreur', err.message);
  }
});

function tryRestoreContext() {
  try {
    const raw = localStorage.getItem('bbg-player-context');
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed.sessionCode && parsed.playerId) {
      sessionCode = parsed.sessionCode;
      playerId = parsed.playerId;
      els.joinCard.style.display = 'none';
      connectSocket();
      refreshPlayerState();
      showToast('Reconnecté', `Session ${sessionCode}`);
    }
  } catch (err) {
    console.warn('Unable to restore context', err);
  }
}

setInterval(() => {
  if (lastTimerTick) {
    updateTimer(Date.now(), lastTimerTick.reminderAt, lastTimerTick.endsAt);
  }
  if (hostState) {
    els.cardRefresh.textContent = hostState.commonDraw ? `Mis à jour ${formatRelative(hostState.lastUpdateAt)}` : 'En attente';
  }
}, 5000);

tryRestoreContext();
render();
