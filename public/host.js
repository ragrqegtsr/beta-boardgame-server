const els = {
  sessionCode: document.querySelector('#session-code'),
  sessionMode: document.querySelector('#session-mode'),
  sessionTurn: document.querySelector('#session-turn'),
  sessionPhase: document.querySelector('#session-phase'),
  copyCode: document.querySelector('#copy-code'),
  startGame: document.querySelector('#start-game'),
  nextTurn: document.querySelector('#next-turn'),
  configStatus: document.querySelector('#config-status'),
  playerCount: document.querySelector('#player-count'),
  playerList: document.querySelector('#player-list'),
  playerAnalytics: document.querySelector('#player-analytics'),
  sessionForm: document.querySelector('#session-form'),
  commonCards: document.querySelector('#common-cards'),
  drawHistory: document.querySelector('#draw-history'),
  journalCount: document.querySelector('#journal-count'),
  globalJournal: document.querySelector('#global-journal'),
  eventLog: document.querySelector('#event-log'),
  timerRing: document.querySelector('#timer-ring'),
  timerValue: document.querySelector('#timer-value'),
  timerStatus: document.querySelector('#timer-status'),
  timerProgress: document.querySelector('#timer-progress'),
  cardRefresh: document.querySelector('#card-refresh'),
  midgameBanner: document.querySelector('#midgame-banner'),
  toastContainer: document.querySelector('#toast-container'),
};

let sessionCode = null;
let socket = null;
let lastState = null;
let lastTimerTick = null;

function showToast(title, message) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `<strong>${title}</strong><p>${message}</p>`;
  els.toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(8px)';
  }, 3800);
  setTimeout(() => toast.remove(), 4600);
}

function formatDateTime(ts) {
  const d = new Date(ts);
  return `${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
}

function formatRelative(ts) {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  if (diff < 1000) return 'À l'instant';
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'Il y a quelques secondes';
  if (min === 1) return 'Il y a une minute';
  if (min < 60) return `Il y a ${min} min`;
  const h = Math.floor(min / 60);
  return `Il y a ${h} h`;
}

function computeManualPhase(state) {
  if (!state) return false;
  const turn = (state.turnIndex || 0) + 1;
  return turn <= state.hostControls.manualUntilTurn || turn >= state.hostControls.manualLastTurnsFrom;
}

function updateHeader(state) {
  els.sessionCode.textContent = state?.code ?? '—';
  els.sessionMode.textContent = state?.mode ?? '—';
  const turn = state ? `${state.turnIndex + 1} / ${state.totalTurns}` : '—';
  els.sessionTurn.textContent = turn;
  els.sessionPhase.textContent = state?.phase ?? '—';

  els.configStatus.textContent = state ? (state.phase === 'SETUP' ? 'Configuration' : 'En cours') : 'En attente';
  els.copyCode.disabled = !sessionCode;
  els.startGame.disabled = !sessionCode || !state || state.phase !== 'SETUP';
  els.nextTurn.disabled = !sessionCode || !state || state.phase !== 'PLAY' || !computeManualPhase(state);
}

function renderPlayers(players = []) {
  els.playerList.innerHTML = '';
  if (!players.length) {
    const empty = document.createElement('p');
    empty.textContent = 'Aucun joueur connecté pour le moment.';
    els.playerList.appendChild(empty);
  }

  players.forEach((player, idx) => {
    const card = document.createElement('div');
    card.className = 'player-card';

    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    const name = player.profile?.name || `Joueur ${idx + 1}`;
    avatar.textContent = (name || '').slice(0, 2).toUpperCase();

    const info = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = name;
    title.style.display = 'block';
    title.style.fontSize = '0.95rem';
    title.style.marginBottom = '4px';

    const badges = document.createElement('div');
    badges.className = 'badge-line';
    const decisionBadge = document.createElement('span');
    decisionBadge.className = 'badge';
    decisionBadge.textContent = player.decision ? `Décision: ${player.decision === 'accept' ? 'Accepte' : 'Refuse'}` : 'En réflexion';
    badges.appendChild(decisionBadge);

    const incomeBadge = document.createElement('span');
    incomeBadge.className = 'badge';
    incomeBadge.textContent = 'Revenus';
    if (player.decision === 'accept') incomeBadge.classList.add('active');
    badges.appendChild(incomeBadge);

    const expenseBadge = document.createElement('span');
    expenseBadge.className = 'badge';
    expenseBadge.textContent = 'Dépenses';
    if (player.decision === 'reject') expenseBadge.classList.add('active');
    badges.appendChild(expenseBadge);

    const ready = document.createElement('span');
    ready.className = `status-pill ${player.ready ? 'ready' : ''}`;
    ready.textContent = player.ready ? 'Prêt' : 'En cours';

    const locked = document.createElement('span');
    locked.className = `status-pill ${player.locked ? 'locked' : ''}`;
    locked.textContent = player.locked ? 'Verrouillé' : 'Ouvert';

    info.appendChild(title);
    info.appendChild(badges);

    const statusCol = document.createElement('div');
    statusCol.style.display = 'grid';
    statusCol.style.justifyItems = 'end';
    statusCol.style.gap = '6px';
    statusCol.appendChild(ready);
    statusCol.appendChild(locked);

    card.appendChild(avatar);
    card.appendChild(info);
    card.appendChild(statusCol);
    els.playerList.appendChild(card);
  });

  els.playerCount.textContent = `${players.length} ${players.length > 1 ? 'joueurs' : 'joueur'}`;
}

function buildPlayerTimeline(entries, playerId) {
  return entries.filter(e => e.playerId === playerId);
}

function drawSparkline(canvas, points) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(31, 111, 235, 0.85)';
  ctx.beginPath();
  const margin = 6;
  const width = canvas.width - margin * 2;
  const height = canvas.height - margin * 2;
  if (!points.length) {
    ctx.moveTo(margin, canvas.height / 2);
    ctx.lineTo(canvas.width - margin, canvas.height / 2);
  } else {
    points.forEach((val, idx) => {
      const x = margin + (idx / Math.max(points.length - 1, 1)) * width;
      const norm = (val + 1) / 2;
      const y = margin + (1 - norm) * height;
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
  }
  ctx.stroke();

  ctx.fillStyle = 'rgba(199, 220, 255, 0.5)';
  points.forEach((val, idx) => {
    const x = margin + (idx / Math.max(points.length - 1, 1)) * width;
    const norm = (val + 1) / 2;
    const y = margin + (1 - norm) * height;
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  });
}

function renderPlayerAnalytics(players = [], journal = []) {
  els.playerAnalytics.innerHTML = '';
  const decisionScores = new Map();
  journal.forEach(entry => {
    if (entry.type === 'PLAYER_DECISION_EVENT') {
      const score = decisionScores.get(entry.playerId) || [];
      score.push(entry.decision === 'accept' ? 1 : -1);
      decisionScores.set(entry.playerId, score);
    }
    if (entry.type === 'PLAYER_READY') {
      const score = decisionScores.get(entry.playerId) || [];
      score.push(0);
      decisionScores.set(entry.playerId, score);
    }
  });

  players.forEach((player, idx) => {
    const card = document.createElement('div');
    card.className = 'player-card';

    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    const name = player.profile?.name || `Joueur ${idx + 1}`;
    avatar.textContent = (name || '').slice(0, 2).toUpperCase();

    const info = document.createElement('div');
    info.className = 'player-analytics';

    const header = document.createElement('div');
    const strong = document.createElement('strong');
    strong.textContent = name;
    header.appendChild(strong);
    const subtitle = document.createElement('span');
    subtitle.style.color = 'rgba(199, 220, 255, 0.7)';
    subtitle.style.fontSize = '0.8rem';
    subtitle.textContent = player.profile?.key ? `Profil · ${player.profile.key}` : `ID ${player.id.slice(0, 4)}`;
    header.appendChild(document.createElement('br'));
    header.appendChild(subtitle);

    const badges = document.createElement('div');
    badges.className = 'badge-line';

    const childBadge = document.createElement('span');
    childBadge.className = 'badge';
    childBadge.textContent = '👶 Enfants';
    if (/enfant|famille/i.test(name)) childBadge.classList.add('active');
    badges.appendChild(childBadge);

    const financeBadge = document.createElement('span');
    financeBadge.className = 'badge';
    financeBadge.textContent = '💰 Revenus';
    if (player.decision === 'accept') financeBadge.classList.add('active');
    badges.appendChild(financeBadge);

    const expenseBadge = document.createElement('span');
    expenseBadge.className = 'badge';
    expenseBadge.textContent = '📉 Dépenses';
    if (player.decision === 'reject') expenseBadge.classList.add('active');
    badges.appendChild(expenseBadge);

    const timeline = buildPlayerTimeline(journal, player.id);
    const decisions = decisionScores.get(player.id) || [];

    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 50;
    canvas.className = 'sparkline';
    drawSparkline(canvas, decisions);

    const list = document.createElement('div');
    list.className = 'timeline-small';
    timeline.slice(-4).reverse().forEach(entry => {
      const item = document.createElement('div');
      item.className = 'item';
      const title = document.createElement('h4');
      title.textContent = `${entry.type.replace('PLAYER_', '')} · ${formatDateTime(entry.at)}`;
      const body = document.createElement('p');
      if (entry.type === 'PLAYER_DECISION_EVENT') {
        body.textContent = entry.decision === 'accept' ? 'Décision positive (revenus)' : 'Décision négative (dépenses)';
      } else if (entry.type === 'PLAYER_READY') {
        body.textContent = 'Statut changé en prêt';
      } else if (entry.type === 'PLAYER_LOCK') {
        body.textContent = 'Décision verrouillée';
      } else {
        body.textContent = JSON.stringify(entry);
      }
      item.appendChild(title);
      item.appendChild(body);
      list.appendChild(item);
    });

    info.appendChild(header);
    info.appendChild(badges);
    info.appendChild(canvas);
    info.appendChild(list);

    const statusCol = document.createElement('div');
    statusCol.style.display = 'grid';
    statusCol.style.gap = '6px';
    statusCol.style.justifyItems = 'end';

    const ready = document.createElement('span');
    ready.className = `status-pill ${player.ready ? 'ready' : ''}`;
    ready.textContent = player.ready ? 'Prêt' : 'En cours';
    const locked = document.createElement('span');
    locked.className = `status-pill ${player.locked ? 'locked' : ''}`;
    locked.textContent = player.locked ? 'Verrouillé' : 'Ouvert';
    statusCol.appendChild(ready);
    statusCol.appendChild(locked);

    card.appendChild(avatar);
    card.appendChild(info);
    card.appendChild(statusCol);
    els.playerAnalytics.appendChild(card);
  });
}

function renderCommonCards(draw) {
  els.commonCards.innerHTML = '';
  if (!draw) {
    const empty = document.createElement('p');
    empty.textContent = 'Les cartes apparaîtront dès le premier tour.';
    els.commonCards.appendChild(empty);
    return;
  }
  Object.entries(draw).forEach(([type, card]) => {
    const node = document.createElement('article');
    node.className = 'common-card';
    node.dataset.type = type;
    const title = document.createElement('h3');
    title.textContent = card.title;
    const category = document.createElement('span');
    category.className = 'category';
    category.textContent = card.category || type;
    const slug = document.createElement('p');
    slug.className = 'slug';
    slug.textContent = card.slug || '—';
    node.appendChild(category);
    node.appendChild(title);
    node.appendChild(slug);
    els.commonCards.appendChild(node);
  });
}

function describeEntry(entry) {
  switch (entry.type) {
    case 'SESSION_CREATED':
      return 'Session créée';
    case 'GAME_STARTED':
      return 'Partie démarrée';
    case 'TURN_STARTED':
      return `Tour ${entry.turn} démarré`;
    case 'TURN_ENDED':
      return `Tour ${entry.turn} terminé`;
    case 'PLAYER_READY':
      return `Joueur ${entry.playerId.slice(0, 4)} prêt`;
    case 'PLAYER_DECISION_EVENT':
      return `Joueur ${entry.playerId.slice(0, 4)} ${entry.decision === 'accept' ? 'accepte' : 'refuse'}`;
    case 'PLAYER_LOCK':
      return `Joueur ${entry.playerId.slice(0, 4)} verrouille sa décision`;
    case 'HOST_KICK':
      return `Joueur ${entry.playerId.slice(0, 4)} retiré`;
    case 'GAME_ENDED':
      return 'Partie terminée';
    case 'HOST_CORRECTION':
      return `Correction de l'action ${entry.targetActionId}`;
    default:
      return entry.type;
  }
}

function renderJournal(journal = []) {
  els.globalJournal.innerHTML = '';
  journal.slice().reverse().forEach(entry => {
    const node = document.createElement('div');
    node.className = 'timeline-entry';
    const title = document.createElement('h4');
    title.textContent = `${formatDateTime(entry.at)} · ${entry.type}`;
    const body = document.createElement('p');
    body.textContent = describeEntry(entry);
    node.appendChild(title);
    node.appendChild(body);
    els.globalJournal.appendChild(node);
  });
  els.journalCount.textContent = `${journal.length} entrée${journal.length > 1 ? 's' : ''}`;
}

function renderDrawHistory(journal = []) {
  els.drawHistory.innerHTML = '';
  const draws = journal.filter(e => e.type === 'TURN_STARTED' && e.draw);
  if (!draws.length) {
    const empty = document.createElement('p');
    empty.textContent = 'Pas encore d\'historique.';
    els.drawHistory.appendChild(empty);
    return;
  }
  draws.slice().reverse().forEach(entry => {
    const node = document.createElement('div');
    node.className = 'timeline-entry';
    const title = document.createElement('h4');
    title.textContent = `Tour ${entry.turn} · ${formatDateTime(entry.at)}`;
    const list = document.createElement('p');
    const cards = Object.entries(entry.draw).map(([key, card]) => `${key}: ${card.title}`);
    list.textContent = cards.join(' · ');
    node.appendChild(title);
    node.appendChild(list);
    els.drawHistory.appendChild(node);
  });
}

function updateTimer(now, reminderAt, endsAt) {
  if (!reminderAt || !endsAt) {
    els.timerValue.textContent = '--:--';
    els.timerStatus.textContent = 'Timer en attente';
    els.timerRing.style.setProperty('--timer-progress', '0%');
    els.timerProgress.style.setProperty('--progress', 0);
    return;
  }
  const start = reminderAt - (3 * 60 * 1000);
  const total = endsAt - start;
  const remaining = Math.max(0, endsAt - now);
  const mins = Math.floor(remaining / 60000);
  const secs = Math.floor((remaining % 60000) / 1000).toString().padStart(2, '0');
  els.timerValue.textContent = `${mins}:${secs}`;

  const progress = Math.min(1, Math.max(0, (now - start) / total));
  els.timerRing.style.setProperty('--timer-progress', `${progress * 100}%`);
  els.timerProgress.style.setProperty('--progress', progress);

  if (remaining <= 0) {
    els.timerStatus.textContent = 'Tour terminé automatiquement';
    els.timerRing.style.setProperty('--timer-progress', '100%');
    els.timerProgress.style.setProperty('--progress', 1);
    return;
  }

  if (now >= reminderAt) {
    els.timerStatus.textContent = 'Phase de grâce';
    els.timerRing.style.setProperty('--timer-progress', `${progress * 100}%`);
    els.timerRing.style.background = `conic-gradient(var(--danger) ${progress * 100}%, rgba(199,220,255,0.12) 0)`;
  } else {
    els.timerStatus.textContent = 'Tour en cours';
    els.timerRing.style.background = `conic-gradient(var(--navy-300) ${progress * 100}%, rgba(199,220,255,0.12) 0)`;
  }
}

function applyState(state) {
  lastState = state;
  updateHeader(state);
  renderPlayers(state.players);
  renderPlayerAnalytics(state.players, state.journal || []);
  renderCommonCards(state.commonDraw);
  renderJournal(state.journal || []);
  renderDrawHistory(state.journal || []);
  els.cardRefresh.textContent = state.commonDraw ? `Mis à jour ${formatRelative(state.lastUpdateAt)}` : 'En attente de tirage';
}

function connectSocket(code) {
  if (socket) {
    socket.disconnect();
  }
  socket = io({ path: '/ws' });
  socket.emit('JOIN_SESSION', { code });

  socket.on('SESSION_UPDATED', payload => {
    if (payload && payload.kind) {
      showToast('Notification', payload.msg || 'Mise à jour');
      const log = document.createElement('div');
      log.className = 'timeline-entry';
      const title = document.createElement('h4');
      title.textContent = `${new Date().toLocaleTimeString()} · ${payload.kind}`;
      const body = document.createElement('p');
      body.textContent = payload.msg || '';
      log.appendChild(title);
      log.appendChild(body);
      els.eventLog.prepend(log);
      return;
    }
    applyState(payload);
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
    showToast('Pause recommandée', `Tour ${data.turn}`);
  });

  socket.on('ERROR', data => {
    showToast('Erreur', data.error || 'Action impossible');
  });
}

async function fetchState(code) {
  const res = await fetch(`/session/${code}/state`);
  if (!res.ok) {
    throw new Error('Session introuvable');
  }
  const json = await res.json();
  applyState(json);
}

function setSession(code) {
  sessionCode = code;
  els.sessionCode.textContent = code;
  els.copyCode.disabled = !code;
  if (code) {
    connectSocket(code);
    fetchState(code).catch(err => showToast('Erreur', err.message));
  }
}

els.copyCode.addEventListener('click', async () => {
  if (!sessionCode) return;
  try {
    await navigator.clipboard.writeText(sessionCode);
    showToast('Copié', 'Le code a été copié dans le presse-papiers.');
  } catch (err) {
    showToast('Impossible de copier', sessionCode);
  }
});

els.startGame.addEventListener('click', () => {
  if (!sessionCode || !socket) return;
  socket.emit('HOST_START', { code: sessionCode });
});

els.nextTurn.addEventListener('click', () => {
  if (!sessionCode || !socket) return;
  socket.emit('HOST_NEXT_TURN', { code: sessionCode });
});

els.sessionForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const mode = form.get('mode');
  const lang = form.get('lang');
  const manualCode = (form.get('code') || '').trim().toUpperCase();
  if (manualCode) {
    setSession(manualCode);
    return;
  }
  try {
    const res = await fetch('/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, lang }),
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      throw new Error(payload.error || 'Création impossible');
    }
    const json = await res.json();
    setSession(json.code);
    showToast('Session créée', `Code ${json.code}`);
  } catch (err) {
    showToast('Erreur', err.message);
  }
});

setInterval(() => {
  if (lastState) {
    els.cardRefresh.textContent = lastState.commonDraw ? `Mis à jour ${formatRelative(lastState.lastUpdateAt)}` : 'En attente de tirage';
  }
  if (lastTimerTick) {
    updateTimer(Date.now(), lastTimerTick.reminderAt, lastTimerTick.endsAt);
  }
}, 5000);
