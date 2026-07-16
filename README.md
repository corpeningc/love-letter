# 💌 Love Letter — LAN edition

A full digital implementation of the Love Letter card game (2019 edition, 2–6 players),
playable in a browser with coworkers on the same network. Nothing to install for
players — they just open a URL.

## Run it

```
npm start
```

The console prints two URLs:

- `http://localhost:3000` — you
- `http://<your-LAN-IP>:3000` — share this one with coworkers

One person clicks **Create a room** and shares the 4-letter room code; everyone
else joins with it. The host starts the game once 2–6 players are in, and can
end a game early from the header to return everyone to the lobby.

> **Firewall note:** the first time you run it, Windows may ask to allow Node.js
> through the firewall — allow it on private networks or coworkers won't be able
> to connect.

## Rules implemented

2019 edition 21-card deck: Spy ×2, Guard ×6, Priest ×2, Baron ×2, Handmaid ×2,
Prince ×2, Chancellor ×2, King, Countess, Princess.

- One card burned face down each round (+3 face up in 2-player games)
- Spy: no effect when played; if exactly one player still in the round played
  or discarded a Spy, they gain a bonus token at round end
- Chancellor: draw 2 cards, keep 1 of the 3, return the rest to the bottom of
  the deck in the order you choose
- Countess is forced if you hold her with the King or Prince
- Handmaid protection until your next turn; targeted cards fizzle if every
  opponent is protected (Prince then targets yourself)
- Prince on an empty deck draws the burned card
- Round ends at last-player-standing or deck exhaustion (highest card wins,
  ties broken by discard totals)
- Tokens to win: 6 (2p), 5 (3p), 4 (4p), 3 (5–6p); round winner leads the next
  round

## Nice-to-haves included

- Refresh-safe: reload mid-game and you're back in your seat
- Private info (Priest peeks, Baron comparisons, King trades) is only ever
  sent to the players entitled to see it — hands never leave the server
- Live event log, discard piles, protection/elimination badges
- Room chat in the lobby and at the table

## Development

```
npm test        # runs the engine test suite
```

- `game.js` — pure rules engine, no networking
- `server.js` — HTTP + WebSocket server, rooms, per-player state redaction
- `public/` — browser client
- `test.js` — engine tests
