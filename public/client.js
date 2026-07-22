'use strict';

// ---------- Card metadata (mirrors game.js) ----------

const CARDS = {
  0: { name: 'Spy',        icon: '🕵️', count: 2, text: 'No effect. If you are the only player left in the round who played or discarded a Spy, gain a token.' },
  1: { name: 'Guard',      icon: '🗡️', count: 6, text: 'Guess another player\'s card (not Guard). If correct, they are out.' },
  2: { name: 'Priest',     icon: '🕯️', count: 2, text: 'Look at another player\'s hand.' },
  3: { name: 'Baron',      icon: '⚖️', count: 2, text: 'Compare hands with another player. Lower card is out.' },
  4: { name: 'Handmaid',   icon: '🛡️', count: 2, text: 'You are protected until your next turn.' },
  5: { name: 'Prince',     icon: '🤴', count: 2, text: 'Choose a player (may be yourself) to discard their hand and draw a new card.' },
  6: { name: 'Chancellor', icon: '📜', count: 2, text: 'Draw 2 cards, keep 1 of the 3, return the rest to the bottom of the deck.' },
  7: { name: 'King',       icon: '👑', count: 1, text: 'Trade hands with another player.' },
  8: { name: 'Countess',   icon: '🌹', count: 1, text: 'Must be played if you also hold the King or Prince.' },
  9: { name: 'Princess',   icon: '👸', count: 1, text: 'If you play or discard this, you are out.' },
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

function escRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// One color per seat. Assigned by position in the roster, which the server
// builds in a single fixed order — so a given player gets the same color on
// every client's screen. Six colors: the max table size.
const PLAYER_COLORS = ['#d4a94e', '#e8738f', '#79c99a', '#74b3e6', '#c39ae8', '#e8a15c'];

// Ordered player list, valid in both lobby (members) and game (players); same
// order and ids across all clients.
function roster() {
  if (state && state.members && state.members.length) return state.members;
  if (state && state.game && state.game.players) return state.game.players;
  return [];
}

function playerColor(id) {
  const r = roster();
  const idx = r.findIndex(p => p.id === id);
  return PLAYER_COLORS[(idx < 0 ? 0 : idx) % PLAYER_COLORS.length];
}

// Wraps any player name found in a log line in a span tinted with that player's
// seat color. Longest names are matched first so one name can't clip a longer
// one it's a prefix of.
function colorizeNames(text) {
  const escaped = esc(text);
  const named = roster()
    .filter(p => p.name && p.name.trim())
    .slice()
    .sort((a, b) => b.name.length - a.name.length);
  if (!named.length) return escaped;
  const alt = named.map(p => escRegex(esc(p.name))).join('|');
  const re = new RegExp('(' + alt + ')', 'g');
  // Single pass: replaced markup is never rescanned, so no nested spans.
  return escaped.replace(re, (m) => {
    const p = named.find(pl => esc(pl.name) === m);
    return `<span class="player-name" style="color:${playerColor(p.id)}">${m}</span>`;
  });
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
  // Played (mini) cards expand on click to reveal their effect text.
  if (mini) {
    div.classList.add('expandable');
    div.title = 'Click to see what this card does';
    div.addEventListener('click', () => expandCard(value));
  }
  return div;
}

// ---------- Expanded (zoomed) card ----------

let closeExpandOnKey = null;

function expandCard(value) {
  closeExpandedCard();
  const backdrop = document.createElement('div');
  backdrop.id = 'card-zoom-backdrop';
  const card = cardEl(value); // full-size card, with its effect text visible
  card.classList.remove('expandable'); // already expanded — no title/re-click
  card.title = '';
  card.classList.add('zoomed');
  backdrop.appendChild(card);
  // Click anywhere outside the card closes it.
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeExpandedCard();
  });
  document.body.appendChild(backdrop);
  closeExpandOnKey = (e) => { if (e.key === 'Escape') closeExpandedCard(); };
  document.addEventListener('keydown', closeExpandOnKey);
}

function closeExpandedCard() {
  const existing = $('card-zoom-backdrop');
  if (existing) existing.remove();
  if (closeExpandOnKey) {
    document.removeEventListener('keydown', closeExpandOnKey);
    closeExpandOnKey = null;
  }
}

// ---------- Card rules reference ----------

let closeRulesOnKey = null;

function showRules() {
  closeRules();
  const backdrop = document.createElement('div');
  backdrop.id = 'rules-backdrop';

  const rows = Object.keys(CARDS)
    .map(Number)
    .sort((a, b) => b - a) // Princess (9) down to Spy (0), matching the rulebook
    .map(v => {
      const c = CARDS[v];
      return `
        <li class="rules-row">
          <span class="rules-value">${v}</span>
          <span class="rules-icon">${c.icon}</span>
          <span class="rules-name">${esc(c.name)} <span class="rules-count">×${c.count}</span></span>
          <span class="rules-text">${esc(c.text)}</span>
        </li>`;
    })
    .join('');

  const dialog = document.createElement('div');
  dialog.id = 'rules-dialog';
  dialog.innerHTML = `
    <h2>📖 Card Rules</h2>
    <ul class="rules-list">${rows}</ul>
    <button class="rules-close linkish">Close</button>`;
  backdrop.appendChild(dialog);

  // Click anywhere outside the dialog closes it.
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeRules();
  });
  dialog.querySelector('.rules-close').addEventListener('click', closeRules);

  document.body.appendChild(backdrop);
  closeRulesOnKey = (e) => { if (e.key === 'Escape') closeRules(); };
  document.addEventListener('keydown', closeRulesOnKey);
}

function closeRules() {
  const existing = $('rules-backdrop');
  if (existing) existing.remove();
  if (closeRulesOnKey) {
    document.removeEventListener('keydown', closeRulesOnKey);
    closeRulesOnKey = null;
  }
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
      who.style.color = playerColor(m.id); // same per-player color as the timeline
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
  const oldLen = Math.min(seen.logLen, g.log.length);
  const entries = g.log;
  let i = 0;
  while (i < entries.length) {
    const e = entries[i];
    let text = e.text;
    let morph = false;
    let consumedPlay = false;
    let pending = false;

    // Collapse "X's turn." into the "X plays the …" line so a turn is one row,
    // not two. When the play arrives after the turn row is already on screen,
    // that row updates in place with a subtle animation instead of a new line.
    // Until the play lands, the row shows an animated "…" waiting indicator.
    const turnMatch = /^(.+)'s turn\.$/.exec(e.text);
    if (turnMatch) {
      const name = turnMatch[1];
      const next = entries[i + 1];
      if (next && !next.private && next.text.startsWith(name + ' plays')) {
        text = next.text;
        consumedPlay = true;
        if (i < oldLen && i + 1 >= oldLen) morph = true; // turn was shown, play is new
      } else {
        pending = true;
        text = e.text.replace(/\.$/, ''); // drop the period; the dots take its place
      }
    }

    const div = document.createElement('div');
    div.className = 'entry'
      + (e.private ? ' private' : '')
      + (text.startsWith('—') ? ' divider' : '')
      + (morph ? ' morph' : (i >= oldLen ? ' new' : ''));
    div.innerHTML = colorizeNames(text)
      + (pending ? '<span class="loading-dots" aria-hidden="true"></span>' : '');
    log.appendChild(div);
    i += consumedPlay ? 2 : 1;
  }
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
$('btn-rules').onclick = showRules;
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
