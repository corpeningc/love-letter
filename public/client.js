'use strict';

// ---------- Card metadata (mirrors game.js) ----------

const CARDS = {
  0: { name: 'Spy',        icon: '🕵️', text: 'No effect. Sole Spy discarder gains a token at round end.' },
  1: { name: 'Guard',      icon: '🗡️', text: 'Guess another player\'s card (not Guard). Correct: they\'re out.' },
  2: { name: 'Priest',     icon: '🕯️', text: 'Look at another player\'s hand.' },
  3: { name: 'Baron',      icon: '⚖️', text: 'Compare hands. Lower card is out.' },
  4: { name: 'Handmaid',   icon: '🛡️', text: 'Protected until your next turn.' },
  5: { name: 'Prince',     icon: '🤴', text: 'A player (or you) discards their hand and draws.' },
  6: { name: 'Chancellor', icon: '📜', text: 'Draw 2, keep 1, return the rest to the deck.' },
  7: { name: 'King',       icon: '👑', text: 'Trade hands with another player.' },
  8: { name: 'Countess',   icon: '🌹', text: 'Must play if you hold King or Prince.' },
  9: { name: 'Princess',   icon: '👸', text: 'Play or discard this and you\'re out.' },
};

const $ = (id) => document.getElementById(id);

// ---------- Connection ----------

let ws = null;
let state = null;          // latest server state message
let intentionalLeave = false;

// Since render() rebuilds the DOM on every state message, track what was
// already on screen so only genuinely new cards / log lines animate.
const seen = { hand: [], discards: {}, logLen: 0, round: 0, chatLen: 0 };

// sessionStorage (not localStorage): per-tab, so two tabs on one machine
// hold separate seats instead of kicking each other off in a rejoin loop.
function session() {
  try { return JSON.parse(sessionStorage.getItem('loveletter-session')); } catch { return null; }
}
function saveSession(s) { sessionStorage.setItem('loveletter-session', JSON.stringify(s)); }
function clearSession() { sessionStorage.removeItem('loveletter-session'); }

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);

  ws.onopen = () => {
    $('conn-banner').classList.add('hidden');
    const s = session();
    if (s) send({ type: 'rejoin', ...s });
  };

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    switch (msg.type) {
      case 'joined':
        saveSession({ code: msg.code, playerId: msg.playerId, token: msg.token });
        break;
      case 'rejoinFailed':
        clearSession();
        showScreen('join');
        break;
      case 'state':
        state = msg;
        render();
        break;
      case 'error':
        toast(msg.message);
        break;
    }
  };

  ws.onclose = () => {
    if (intentionalLeave) return;
    if (session()) $('conn-banner').classList.remove('hidden');
    setTimeout(connect, 1500);
  };
}

function send(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

// ---------- UI helpers ----------

function showScreen(name) {
  for (const s of ['join', 'lobby', 'game']) {
    $(`screen-${s}`).classList.toggle('hidden', s !== name);
  }
}

let toastTimer = null;
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.remove('hidden');
  el.style.animation = 'none'; // restart slide-in even if already visible
  void el.offsetWidth;
  el.style.animation = '';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3500);
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function cardEl(value, { mini = false, hidden = false } = {}) {
  const div = document.createElement('div');
  div.className = 'card' + (mini ? ' mini' : '');
  if (hidden) {
    div.classList.add('back');
    div.innerHTML = `<span class="back-emblem">💌</span>`;
    return div;
  }
  const c = CARDS[value];
  div.innerHTML = `
    <span class="value">${value}</span>
    <span class="icon">${c.icon}</span>
    <span class="name">${c.name}</span>
    <span class="text">${esc(c.text)}</span>
    <span class="value flip">${value}</span>`;
  return div;
}

// Which entries of nowArr weren't in prevArr (handles duplicate values).
function newCardFlags(prevArr, nowArr) {
  const pool = [...prevArr];
  return nowArr.map(v => {
    const i = pool.indexOf(v);
    if (i !== -1) { pool.splice(i, 1); return false; }
    return true;
  });
}

// Renders a discard row, popping in only cards added since last render.
function renderDiscards(row, playerId, discards, roundChanged) {
  const prevCount = roundChanged ? 0 : (seen.discards[playerId] || 0);
  discards.forEach((c, i) => {
    const el = cardEl(c, { mini: true });
    if (i >= prevCount) el.classList.add('pop-in');
    row.appendChild(el);
  });
  seen.discards[playerId] = discards.length;
}

// ---------- Chat ----------

function setupChat(rootId) {
  const root = $(rootId);
  const input = root.querySelector('.chat-input');
  const submit = () => {
    const text = input.value.trim();
    if (!text) return;
    send({ type: 'chat', text });
    input.value = '';
    input.focus();
  };
  root.querySelector('.chat-send').onclick = submit;
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
}

function renderChat(rootId) {
  const box = $(rootId).querySelector('.chat-messages');
  const msgs = state.chat || [];
  const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 30;
  const animFrom = msgs.length > seen.chatLen ? seen.chatLen : msgs.length;
  box.innerHTML = '';
  msgs.forEach((m, i) => {
    const div = document.createElement('div');
    div.className = 'msg'
      + (!m.id ? ' system' : '')
      + (m.id === state.youId ? ' mine' : '')
      + (i >= animFrom ? ' new' : '');
    if (m.id) {
      const who = document.createElement('span');
      who.className = 'who';
      who.textContent = `${m.name}: `;
      div.appendChild(who);
    }
    div.appendChild(document.createTextNode(m.text));
    box.appendChild(div);
  });
  if (atBottom || animFrom < msgs.length) box.scrollTop = box.scrollHeight;
  seen.chatLen = msgs.length;
}

// ---------- Rendering ----------

function render() {
  if (!state) return;
  if (!state.game) {
    renderLobby();
    return;
  }
  renderGame();
}

function renderLobby() {
  showScreen('lobby');
  $('lobby-code').textContent = state.code;
  const ul = $('lobby-members');
  ul.innerHTML = '';
  for (const m of state.members) {
    const li = document.createElement('li');
    li.innerHTML = `<span>${esc(m.name)}${m.id === state.youId ? ' (you)' : ''}</span>` +
      (m.isHost ? '<span class="host-tag">host</span>' : '');
    ul.appendChild(li);
  }
  const isHost = state.youId === state.hostId;
  const enough = state.members.length >= 2;
  $('btn-start').classList.toggle('hidden', !isHost);
  $('btn-start').disabled = !enough;
  $('lobby-hint').textContent = enough
    ? (isHost ? `${state.members.length} players ready.` : 'Waiting for the host to start…')
    : 'Waiting for at least 2 players (max 6)…';
  renderChat('lobby-chat');
}

function renderGame() {
  showScreen('game');
  const g = state.game;
  const me = g.players.find(p => p.id === state.youId);
  const isHost = state.youId === state.hostId;
  const myTurn = g.phase === 'playing' && g.turn === state.youId;
  const chancellorPick = g.phase === 'playing' && g.you && g.you.chancellor;
  const connected = Object.fromEntries(state.members.map(m => [m.id, m.connected]));
  const roundChanged = g.round !== seen.round;

  $('btn-end').classList.toggle('hidden', state.youId !== state.hostId);

  // Header
  $('round-label').textContent = `Round ${g.round}`;
  $('deck-label').textContent = `Deck: ${g.deckCount} · First to ${g.tokensToWin} ❤`;
  $('room-label').textContent = `Room ${state.code}`;

  // Opponents
  const opps = $('opponents');
  opps.innerHTML = '';
  for (const p of g.players) {
    if (p.id === state.youId) continue;
    const div = document.createElement('div');
    div.className = 'opp'
      + (g.turn === p.id ? ' current' : '')
      + (!p.alive ? ' dead' : '');
    const badges = [
      p.protected ? '<span class="badge protected">protected</span>' : '',
      !p.alive ? '<span class="badge out">out</span>' : '',
      connected[p.id] === false ? '<span class="badge offline">offline</span>' : '',
    ].join('');
    div.innerHTML = `
      <div class="opp-name">${esc(p.name)} ${badges}</div>
      <div class="tokens">${'❤'.repeat(p.tokens) || '—'}</div>
      <div class="discard-row"></div>`;
    const row = div.querySelector('.discard-row');
    renderDiscards(row, p.id, p.discards, roundChanged);
    if (p.alive && p.handCount > 0) {
      for (let i = 0; i < p.handCount; i++) row.appendChild(cardEl(0, { mini: true, hidden: true }));
    }
    opps.appendChild(div);
  }

  // Face-up cards (2-player)
  $('faceup-area').classList.toggle('hidden', !g.faceUp.length);
  const fu = $('faceup-cards');
  fu.innerHTML = '';
  for (const c of g.faceUp) fu.appendChild(cardEl(c, { mini: true }));

  // Banner (round end / game over)
  const banner = $('banner');
  if (g.phase === 'roundEnd' || g.phase === 'gameOver') {
    const winners = g.roundResult
      ? g.roundResult.winnerIds.map(id => g.players.find(p => p.id === id).name).join(' & ')
      : '';
    let html = '';
    if (g.phase === 'gameOver') {
      const champ = g.players.find(p => p.id === g.gameWinnerId);
      html = `<span class="big">🏆 ${esc(champ.name)} wins the game!</span>`;
      if (g.roundResult) html += `${esc(winners)} took the final round — ${esc(g.roundResult.reason)}.`;
      if (isHost) html += `<br><button onclick="send({type:'playAgain'})" class="primary">Back to lobby</button>`;
      else html += `<br><em>Waiting for the host…</em>`;
    } else {
      html = `<span class="big">💘 ${esc(winners)} win${g.roundResult.winnerIds.length === 1 ? 's' : ''} the round!</span>`;
      html += esc(g.roundResult.reason) + '.';
      if (isHost) html += `<br><button onclick="send({type:'nextRound'})" class="primary">Start next round</button>`;
      else html += `<br><em>Waiting for the host to start the next round…</em>`;
    }
    banner.innerHTML = html;
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }

  // Log
  const log = $('log');
  const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 30;
  log.innerHTML = '';
  const animFrom = g.log.length > seen.logLen ? seen.logLen : g.log.length;
  g.log.forEach((e, i) => {
    const div = document.createElement('div');
    div.className = 'entry'
      + (e.private ? ' private' : '')
      + (e.text.startsWith('—') ? ' divider' : '')
      + (i >= animFrom ? ' new' : '');
    div.textContent = e.text;
    log.appendChild(div);
  });
  if (atBottom) log.scrollTop = log.scrollHeight;

  // Your area
  const meArea = $('me-area');
  meArea.classList.toggle('my-turn', myTurn);
  let info = `<strong>${esc(me.name)}</strong> <span class="tokens">${'❤'.repeat(me.tokens) || '—'}</span>`;
  if (!me.alive) info += ' <span class="badge out">out this round</span>';
  if (me.protected) info += ' <span class="badge protected">protected</span>';
  if (chancellorPick) info += ' <span class="turn-note">Chancellor: pick the card to keep — the rest go back under the deck</span>';
  else if (myTurn) info += ' <span class="turn-note">Your turn — play a card</span>';
  else if (g.phase === 'playing') {
    const cur = g.players.find(p => p.id === g.turn);
    info += ` <span style="color:var(--parchment-dim)">Waiting for ${esc(cur.name)}…</span>`;
  }
  $('me-info').innerHTML = info;

  const hand = $('hand');
  hand.innerHTML = '';
  const myHand = g.you ? g.you.hand : [];
  const isNew = newCardFlags(roundChanged ? [] : seen.hand, myHand);
  let dealDelay = 0;
  myHand.forEach((c, i) => {
    const locked = myTurn && !chancellorPick && g.you.mustPlayCountess && c !== 8;
    const el = cardEl(c);
    if (isNew[i]) {
      el.classList.add('deal-in');
      el.style.animationDelay = `${dealDelay}ms`;
      dealDelay += 120;
    }
    if (chancellorPick) {
      el.classList.add('playable');
      el.onclick = () => beginChancellorKeep(c);
    } else if (myTurn && !locked) {
      el.classList.add('playable');
      el.onclick = () => beginPlay(c);
    } else if (locked) {
      el.classList.add('locked');
      el.title = 'You must play the Countess (you hold the King or Prince).';
    }
    hand.appendChild(el);
  });

  const md = $('me-discards');
  md.innerHTML = '';
  renderDiscards(md, me.id, me.discards, roundChanged);

  renderChat('game-chat');

  seen.round = g.round;
  seen.hand = [...myHand];
  seen.logLen = g.log.length;
}

// ---------- Playing a card ----------

function beginPlay(card) {
  const g = state.game;
  const targets = g.you.validTargets[card] || [];
  const needsTarget = [1, 2, 3, 5, 7].includes(card);

  if (!needsTarget || targets.length === 0) {
    // Spy/Handmaid/Chancellor/Countess/Princess, or a targeted card with nobody to target.
    if (card === 9 && !confirm('Play the Princess? You will be out of the round!')) return;
    if (needsTarget) toast('No valid targets — the card is played with no effect.');
    send({ type: 'play', card });
    return;
  }

  pickTarget(card, targets);
}

function beginChancellorKeep(keep) {
  const rest = [...state.game.you.hand];
  rest.splice(rest.indexOf(keep), 1);
  if (rest.length < 2 || rest[0] === rest[1]) {
    // Only one card returns, or both are identical — no order to choose.
    send({ type: 'chancellor', keep });
    return;
  }
  openModal(
    `Keeping the ${CARDS[keep].name}. Which card goes back on top of the other (drawn sooner)?`,
    rest.map((v, i) => ({
      label: `${v} · ${CARDS[v].name}`,
      onPick: () => {
        closeModal();
        send({ type: 'chancellor', keep, order: [v, rest[1 - i]] });
      },
    }))
  );
}

function pickTarget(card, targets) {
  const g = state.game;
  openModal(
    `Play the ${CARDS[card].name} on…`,
    targets.map(id => {
      const p = g.players.find(pl => pl.id === id);
      const label = id === state.youId ? `${p.name} (yourself)` : p.name;
      return { label, onPick: () => {
        if (card === 1) pickGuess(id, p.name);
        else { closeModal(); send({ type: 'play', card, targetId: id }); }
      }};
    })
  );
}

function pickGuess(targetId, targetName) {
  openModal(
    `Guess ${targetName}'s card`,
    [0, 2, 3, 4, 5, 6, 7, 8, 9].map(v => ({
      label: `${v} · ${CARDS[v].name}`,
      onPick: () => { closeModal(); send({ type: 'play', card: 1, targetId, guess: v }); },
    }))
  );
}

function openModal(title, options) {
  $('modal-title').textContent = title;
  const box = $('modal-options');
  box.innerHTML = '';
  for (const opt of options) {
    const b = document.createElement('button');
    b.textContent = opt.label;
    b.onclick = opt.onPick;
    box.appendChild(b);
  }
  $('modal-backdrop').classList.remove('hidden');
}

function closeModal() {
  $('modal-backdrop').classList.add('hidden');
}

// ---------- Wiring ----------

$('btn-create').onclick = () => {
  const name = $('name-input').value.trim();
  if (!name) return toast('Enter a name first.');
  send({ type: 'create', name });
};
$('btn-join').onclick = () => {
  const name = $('name-input').value.trim();
  const code = $('code-input').value.trim().toUpperCase();
  if (!name) return toast('Enter a name first.');
  if (code.length !== 4) return toast('Room codes are 4 letters.');
  send({ type: 'join', name, code });
};
$('code-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-join').click(); });
$('name-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-create').click(); });
$('btn-start').onclick = () => send({ type: 'start' });
$('btn-leave').onclick = () => {
  intentionalLeave = true;
  send({ type: 'leave' });
  clearSession();
  location.reload();
};
$('btn-end').onclick = () => {
  if (confirm('End the game for everyone and return to the lobby?')) send({ type: 'endGame' });
};
setupChat('lobby-chat');
setupChat('game-chat');
$('modal-cancel').onclick = closeModal;
$('modal-backdrop').addEventListener('click', (e) => {
  if (e.target === $('modal-backdrop')) closeModal();
});

const saved = localStorage.getItem('loveletter-name');
if (saved) $('name-input').value = saved;
$('name-input').addEventListener('change', () => localStorage.setItem('loveletter-name', $('name-input').value));

showScreen('join');
connect();
