'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { Game } = require('./game');

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---------- Static file server ----------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const httpServer = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(PUBLIC_DIR, urlPath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
});

// ---------- Rooms ----------

// room: { code, hostId, game, chat, members: Map<playerId, member> }
// member: { id, name, token, ws (nullable when disconnected) }
const rooms = new Map();

function newRoomCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O to avoid confusion
  let code;
  do {
    code = Array.from({ length: 4 }, () => letters[crypto.randomInt(letters.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function send(ws, msg) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function sendError(ws, message) {
  send(ws, { type: 'error', message });
}

// Push each member their personalized view of the room.
function broadcastState(room) {
  const memberList = [...room.members.values()].map(m => ({
    id: m.id,
    name: m.name,
    connected: !!m.ws,
    isHost: m.id === room.hostId,
  }));
  for (const m of room.members.values()) {
    send(m.ws, {
      type: 'state',
      code: room.code,
      youId: m.id,
      hostId: room.hostId,
      members: memberList,
      chat: room.chat,
      game: room.game ? room.game.stateFor(m.id) : null,
    });
  }
}

function leaveRoom(room, member) {
  room.members.delete(member.id);
  if (room.members.size === 0) {
    rooms.delete(room.code);
    return;
  }
  if (room.hostId === member.id) {
    room.hostId = room.members.keys().next().value;
  }
  broadcastState(room);
}

// ---------- WebSocket protocol ----------

const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws) => {
  // Per-connection identity, set by create/join/rejoin.
  let room = null;
  let member = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    try {
      handle(msg);
    } catch (err) {
      sendError(ws, err.message);
    }
  });

  function requireName(name) {
    const trimmed = String(name || '').trim().slice(0, 20);
    if (!trimmed) throw new Error('Please enter a name.');
    return trimmed;
  }

  function handle(msg) {
    switch (msg.type) {
      case 'create': {
        const name = requireName(msg.name);
        const code = newRoomCode();
        member = { id: crypto.randomUUID(), name, token: crypto.randomUUID(), ws };
        room = { code, hostId: member.id, game: null, chat: [], members: new Map([[member.id, member]]) };
        rooms.set(code, room);
        send(ws, { type: 'joined', code, playerId: member.id, token: member.token });
        broadcastState(room);
        break;
      }
      case 'join': {
        const name = requireName(msg.name);
        const code = String(msg.code || '').trim().toUpperCase();
        const r = rooms.get(code);
        if (!r) throw new Error(`No room with code ${code || '(blank)'}.`);
        if (r.game) throw new Error('That game has already started.');
        if (r.members.size >= 6) throw new Error('That room is full (6 players max).');
        if ([...r.members.values()].some(m => m.name.toLowerCase() === name.toLowerCase())) {
          throw new Error('Someone in that room already has that name.');
        }
        member = { id: crypto.randomUUID(), name, token: crypto.randomUUID(), ws };
        room = r;
        room.members.set(member.id, member);
        send(ws, { type: 'joined', code, playerId: member.id, token: member.token });
        broadcastState(room);
        break;
      }
      case 'rejoin': {
        const r = rooms.get(String(msg.code || '').toUpperCase());
        const m = r && r.members.get(msg.playerId);
        if (!m || m.token !== msg.token) {
          send(ws, { type: 'rejoinFailed' });
          return;
        }
        if (m.ws && m.ws !== ws) { try { m.ws.close(); } catch {} }
        m.ws = ws;
        room = r;
        member = m;
        send(ws, { type: 'joined', code: room.code, playerId: member.id, token: member.token });
        broadcastState(room);
        break;
      }
      case 'start': {
        requireRoom();
        if (member.id !== room.hostId) throw new Error('Only the host can start the game.');
        if (room.game && room.game.phase !== 'gameOver') throw new Error('Game already in progress.');
        if (room.members.size < 2) throw new Error('You need at least 2 players.');
        const seats = [...room.members.values()].map(m => ({ id: m.id, name: m.name }));
        room.game = new Game(seats);
        room.game.startRound();
        broadcastState(room);
        break;
      }
      case 'play': {
        requireGame();
        room.game.playCard(member.id, Number(msg.card), { targetId: msg.targetId, guess: msg.guess });
        broadcastState(room);
        break;
      }
      case 'chancellor': {
        requireGame();
        room.game.chancellorKeep(member.id, Number(msg.keep), msg.order);
        broadcastState(room);
        break;
      }
      case 'endGame': {
        requireGame();
        if (member.id !== room.hostId) throw new Error('Only the host can end the game.');
        room.game = null;
        room.chat.push({ id: null, name: '', text: `${member.name} ended the game — back to the lobby.` });
        if (room.chat.length > 200) room.chat.shift();
        broadcastState(room);
        break;
      }
      case 'nextRound': {
        requireGame();
        if (member.id !== room.hostId) throw new Error('Only the host can start the next round.');
        room.game.startRound();
        broadcastState(room);
        break;
      }
      case 'playAgain': {
        requireRoom();
        if (member.id !== room.hostId) throw new Error('Only the host can start a new game.');
        if (room.game && room.game.phase !== 'gameOver') throw new Error('The current game is not over.');
        room.game = null;
        broadcastState(room);
        break;
      }
      case 'chat': {
        requireRoom();
        const text = String(msg.text || '').trim().slice(0, 300);
        if (!text) return;
        room.chat.push({ id: member.id, name: member.name, text });
        if (room.chat.length > 200) room.chat.shift();
        broadcastState(room);
        break;
      }
      case 'leave': {
        if (room && member) {
          const r = room, m = member;
          room = null; member = null;
          leaveRoom(r, m);
        }
        break;
      }
      default:
        throw new Error(`Unknown message type: ${msg.type}`);
    }
  }

  function requireRoom() {
    if (!room || !member) throw new Error('You are not in a room.');
  }

  function requireGame() {
    requireRoom();
    if (!room.game) throw new Error('The game has not started.');
  }

  ws.on('close', () => {
    if (!room || !member) return;
    if (member.ws === ws) member.ws = null;
    if (!room.game) {
      // In the lobby, a disconnect just removes you.
      leaveRoom(room, member);
    } else {
      // Mid-game, keep the seat so they can reconnect.
      broadcastState(room);
    }
  });
});

// ---------- Start ----------

function lanAddresses() {
  const addrs = [];
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces || []) {
      if (iface.family === 'IPv4' && !iface.internal) addrs.push(iface.address);
    }
  }
  return addrs;
}

httpServer.listen(PORT, () => {
  console.log('Love Letter server running!');
  console.log(`  Local:   http://localhost:${PORT}`);
  for (const addr of lanAddresses()) {
    console.log(`  Network: http://${addr}:${PORT}   <-- share this with coworkers`);
  }
});
