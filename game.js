'use strict';

// Love Letter game engine (21-card 2019 edition deck, 2-6 players).
// Pure logic — no networking. The server owns instances of Game.

const CARDS = {
  0: { name: 'Spy',        count: 2, text: 'No effect. If you are the only player left in the round who played or discarded a Spy, gain a token.' },
  1: { name: 'Guard',      count: 6, text: 'Guess another player\'s card (not Guard). If correct, they are out.' },
  2: { name: 'Priest',     count: 2, text: 'Look at another player\'s hand.' },
  3: { name: 'Baron',      count: 2, text: 'Compare hands with another player. Lower card is out.' },
  4: { name: 'Handmaid',   count: 2, text: 'You are protected until your next turn.' },
  5: { name: 'Prince',     count: 2, text: 'Choose a player (may be yourself) to discard their hand and draw a new card.' },
  6: { name: 'Chancellor', count: 2, text: 'Draw 2 cards, keep 1 of the 3, return the rest to the bottom of the deck.' },
  7: { name: 'King',       count: 1, text: 'Trade hands with another player.' },
  8: { name: 'Countess',   count: 1, text: 'Must be played if you also hold the King or Prince.' },
  9: { name: 'Princess',   count: 1, text: 'If you play or discard this, you are out.' },
};

const TOKENS_TO_WIN = { 2: 6, 3: 5, 4: 4, 5: 3, 6: 3 };

function cardName(v) {
  return CARDS[v].name;
}

function buildDeck() {
  const deck = [];
  for (const [value, def] of Object.entries(CARDS)) {
    for (let i = 0; i < def.count; i++) deck.push(Number(value));
  }
  return deck;
}

function shuffle(arr, rng = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

class Game {
  // players: [{ id, name }] in seating order. rng is injectable for tests.
  constructor(players, rng = Math.random) {
    if (players.length < 2 || players.length > 6) {
      throw new Error('Love Letter supports 2-6 players.');
    }
    this.rng = rng;
    this.players = players.map(p => ({
      id: p.id,
      name: p.name,
      tokens: 0,
      hand: [],
      discards: [],
      alive: true,
      protected: false,
      playedSpy: false,
    }));
    this.tokensToWin = TOKENS_TO_WIN[players.length];
    this.phase = 'roundEnd'; // startRound() moves to 'playing'
    this.round = 0;
    this.deck = [];
    this.burned = null;      // face-down set-aside card
    this.faceUp = [];        // 2-player: three face-up cards
    this.turn = null;        // player id whose turn it is
    this.pendingChancellor = null; // { playerId } while a keep decision is due
    this.log = [];           // { text, private?: playerId }
    this.roundResult = null; // { winnerIds, reason }
    this.gameWinnerId = null;
    this.nextStarterId = this.players[0].id;
  }

  player(id) {
    return this.players.find(p => p.id === id);
  }

  alivePlayers() {
    return this.players.filter(p => p.alive);
  }

  addLog(text, privateTo = null) {
    this.log.push(privateTo ? { text, private: privateTo } : { text });
  }

  startRound() {
    if (this.phase === 'playing') throw new Error('Round already in progress.');
    if (this.phase === 'gameOver') throw new Error('Game is over.');
    this.round++;
    this.deck = shuffle(buildDeck(), this.rng);
    this.burned = this.deck.pop();
    this.faceUp = [];
    if (this.players.length === 2) {
      for (let i = 0; i < 3; i++) this.faceUp.push(this.deck.pop());
    }
    for (const p of this.players) {
      p.hand = [this.deck.pop()];
      p.discards = [];
      p.alive = true;
      p.protected = false;
      p.playedSpy = false;
    }
    this.phase = 'playing';
    this.pendingChancellor = null;
    this.roundResult = null;
    this.turn = this.nextStarterId;
    this.addLog(`— Round ${this.round} —`);
    if (this.faceUp.length) {
      this.addLog(`Set aside face up: ${this.faceUp.map(cardName).join(', ')}.`);
    }
    this.beginTurn();
  }

  beginTurn() {
    const p = this.player(this.turn);
    p.protected = false; // Handmaid protection ends at the start of your own turn
    p.hand.push(this.deck.pop());
    this.addLog(`${p.name}'s turn.`);
  }

  // Moves a card to a player's discard pile (the only way cards should get there,
  // so the Spy's "played or discarded" bonus is tracked in one place).
  discardCard(player, card) {
    player.discards.push(card);
    if (card === 0) player.playedSpy = true;
  }

  // Returns list of ids the given player may target with a card, per the rules.
  validTargets(playerId, card) {
    const others = this.alivePlayers().filter(p => p.id !== playerId && !p.protected);
    switch (card) {
      case 1: case 2: case 3: case 7:
        return others.map(p => p.id);
      case 5: {
        const ids = others.map(p => p.id);
        ids.push(playerId); // Prince may always target self
        return ids;
      }
      default:
        return [];
    }
  }

  mustPlayCountess(player) {
    return player.hand.includes(8) && (player.hand.includes(7) || player.hand.includes(5));
  }

  // Play `card` from the current player's hand. opts: { targetId, guess }.
  // Throws on illegal input; mutates state and advances the game otherwise.
  playCard(playerId, card, opts = {}) {
    if (this.phase !== 'playing') throw new Error('No round in progress.');
    if (this.pendingChancellor) throw new Error('Waiting for the Chancellor decision.');
    if (this.turn !== playerId) throw new Error('Not your turn.');
    const me = this.player(playerId);
    if (!me.hand.includes(card)) throw new Error('You do not hold that card.');
    if (this.mustPlayCountess(me) && card !== 8) {
      throw new Error('You hold the Countess with the King or Prince — you must play the Countess.');
    }

    const targets = this.validTargets(playerId, card);
    const needsTarget = [1, 2, 3, 5, 7].includes(card);
    let target = null;
    if (needsTarget && targets.length > 0) {
      if (!opts.targetId || !targets.includes(opts.targetId)) {
        throw new Error('You must choose a valid target.');
      }
      target = this.player(opts.targetId);
    }
    let guess = null;
    if (card === 1 && target) {
      guess = Number(opts.guess);
      if (!Number.isInteger(guess) || guess < 0 || guess > 9 || guess === 1) {
        throw new Error('Guard guess must be any card value other than the Guard (1).');
      }
    }

    // Remove the played card from hand and discard it.
    me.hand.splice(me.hand.indexOf(card), 1);
    this.discardCard(me, card);

    if (needsTarget && !target) {
      this.addLog(`${me.name} plays the ${cardName(card)}, but there are no valid targets — no effect.`);
    } else {
      this.resolveCard(me, card, target, guess);
    }

    if (this.pendingChancellor) return; // turn finishes after the keep decision
    this.afterPlay();
  }

  resolveCard(me, card, target, guess) {
    switch (card) {
      case 0: {
        this.addLog(`${me.name} plays the Spy.`);
        break;
      }
      case 1: {
        this.addLog(`${me.name} plays the Guard and guesses ${target.name} holds the ${cardName(guess)}.`);
        if (target.hand[0] === guess) {
          this.addLog(`Correct! ${target.name} is out of the round.`);
          this.eliminate(target);
        } else {
          this.addLog(`Wrong guess — nothing happens.`);
        }
        break;
      }
      case 2: {
        this.addLog(`${me.name} plays the Priest and looks at ${target.name}'s hand.`);
        this.addLog(`${target.name} is holding the ${cardName(target.hand[0])}.`, me.id);
        break;
      }
      case 3: {
        this.addLog(`${me.name} plays the Baron and compares hands with ${target.name}.`);
        const mine = me.hand[0];
        const theirs = target.hand[0];
        this.addLog(`You have the ${cardName(mine)}; ${target.name} has the ${cardName(theirs)}.`, me.id);
        this.addLog(`${me.name} has the ${cardName(mine)}; you have the ${cardName(theirs)}.`, target.id);
        if (mine > theirs) {
          this.addLog(`${target.name} has the lower card and is out of the round.`);
          this.eliminate(target);
        } else if (theirs > mine) {
          this.addLog(`${me.name} has the lower card and is out of the round.`);
          this.eliminate(me);
        } else {
          this.addLog('The hands are tied — nothing happens.');
        }
        break;
      }
      case 4: {
        this.addLog(`${me.name} plays the Handmaid and is protected until their next turn.`);
        me.protected = true;
        break;
      }
      case 5: {
        this.addLog(`${me.name} plays the Prince on ${target.name}.`);
        const discarded = target.hand.pop();
        this.discardCard(target, discarded);
        this.addLog(`${target.name} discards the ${cardName(discarded)}.`);
        if (discarded === 9) {
          this.addLog(`${target.name} discarded the Princess and is out of the round!`);
          target.alive = false;
        } else if (target.alive) {
          if (this.deck.length > 0) {
            target.hand.push(this.deck.pop());
          } else {
            target.hand.push(this.burned);
            this.burned = null;
            this.addLog(`The deck is empty — ${target.name} draws the set-aside card.`);
          }
        }
        break;
      }
      case 6: {
        const drawn = [];
        while (drawn.length < 2 && this.deck.length > 0) drawn.push(this.deck.pop());
        if (drawn.length === 0) {
          this.addLog(`${me.name} plays the Chancellor, but the deck is empty — no effect.`);
          break;
        }
        me.hand.push(...drawn);
        this.pendingChancellor = { playerId: me.id };
        this.addLog(`${me.name} plays the Chancellor and draws ${drawn.length} card${drawn.length > 1 ? 's' : ''}.`);
        break;
      }
      case 7: {
        this.addLog(`${me.name} plays the King and trades hands with ${target.name}.`);
        [me.hand, target.hand] = [target.hand, me.hand];
        this.addLog(`You received the ${cardName(me.hand[0])}.`, me.id);
        this.addLog(`You received the ${cardName(target.hand[0])}.`, target.id);
        break;
      }
      case 8: {
        this.addLog(`${me.name} plays the Countess.`);
        break;
      }
      case 9: {
        this.addLog(`${me.name} plays the Princess and is out of the round!`);
        this.eliminate(me);
        break;
      }
    }
  }

  // The Chancellor player keeps `keep` and returns the rest to the bottom of
  // the deck. `order` (optional) lists the returned cards top-first — the
  // order they would be drawn if the deck runs that low.
  chancellorKeep(playerId, keep, order = null) {
    if (!this.pendingChancellor || this.pendingChancellor.playerId !== playerId) {
      throw new Error('You have no Chancellor decision to make.');
    }
    const me = this.player(playerId);
    if (!me.hand.includes(keep)) throw new Error('You do not hold that card.');
    const rest = [...me.hand];
    rest.splice(rest.indexOf(keep), 1);
    let returned = rest;
    if (order != null) {
      const o = (Array.isArray(order) ? order : [order]).map(Number);
      const same = o.length === rest.length &&
        [...o].sort((a, b) => a - b).join() === [...rest].sort((a, b) => a - b).join();
      if (!same) throw new Error('Return order must use exactly the cards you are returning.');
      returned = o;
    }
    me.hand = [keep];
    this.deck.unshift(...[...returned].reverse()); // deck draws from the end, so unshift = bottom
    this.addLog(`${me.name} keeps a card and returns ${returned.length} to the bottom of the deck.`);
    this.pendingChancellor = null;
    this.afterPlay();
  }

  eliminate(player) {
    player.alive = false;
    // An eliminated player discards their hand face up (no effect).
    while (player.hand.length) {
      const c = player.hand.pop();
      this.discardCard(player, c);
      this.addLog(`${player.name} reveals and discards the ${cardName(c)}.`);
    }
  }

  afterPlay() {
    const alive = this.alivePlayers();
    if (alive.length === 1) {
      this.endRound([alive[0]], `${alive[0].name} is the last player standing`);
      return;
    }
    if (this.deck.length === 0) {
      // Deck exhausted: compare hands; ties broken by discard totals.
      const best = Math.max(...alive.map(p => p.hand[0]));
      let contenders = alive.filter(p => p.hand[0] === best);
      let reason = `highest card (${cardName(best)}) when the deck ran out`;
      for (const p of alive) {
        this.addLog(`${p.name} reveals the ${cardName(p.hand[0])}.`);
      }
      if (contenders.length > 1) {
        const bestSum = Math.max(...contenders.map(p => p.discards.reduce((a, b) => a + b, 0)));
        contenders = contenders.filter(p => p.discards.reduce((a, b) => a + b, 0) === bestSum);
        reason += contenders.length > 1
          ? ' (tied even on discard totals — shared win)'
          : ' (tie broken by discard totals)';
      }
      this.endRound(contenders, reason);
      return;
    }
    this.turn = this.nextAliveAfter(this.turn);
    this.beginTurn();
  }

  nextAliveAfter(id) {
    const order = this.players.map(p => p.id);
    let i = order.indexOf(id);
    for (let step = 0; step < order.length; step++) {
      i = (i + 1) % order.length;
      if (this.player(order[i]).alive) return order[i];
    }
    throw new Error('No alive players.');
  }

  endRound(winners, reason) {
    this.phase = 'roundEnd';
    this.turn = null;
    for (const w of winners) w.tokens++;
    const names = winners.map(w => w.name).join(' and ');
    this.addLog(`${names} win${winners.length === 1 ? 's' : ''} the round — ${reason}.`);
    // Spy bonus: exactly one player still in the round with a Spy in their discards.
    const spies = this.players.filter(p => p.alive && p.playedSpy);
    if (spies.length === 1) {
      spies[0].tokens++;
      this.addLog(`${spies[0].name} gains a token of affection for the Spy.`);
    }
    this.roundResult = { winnerIds: winners.map(w => w.id), reason };
    this.nextStarterId = winners[0].id;

    const champion = this.players.find(p => p.tokens >= this.tokensToWin);
    if (champion) {
      this.phase = 'gameOver';
      this.gameWinnerId = champion.id;
      this.addLog(`${champion.name} has ${champion.tokens} tokens of affection and wins the game!`);
    }
  }

  // Personalized view of the game for one player. Never leaks other hands.
  stateFor(playerId) {
    const me = this.player(playerId);
    const acting = this.phase === 'playing' && this.turn === playerId && !this.pendingChancellor;
    return {
      phase: this.phase,
      round: this.round,
      tokensToWin: this.tokensToWin,
      deckCount: this.deck.length,
      faceUp: this.faceUp,
      turn: this.turn,
      players: this.players.map(p => ({
        id: p.id,
        name: p.name,
        tokens: p.tokens,
        alive: p.alive,
        protected: p.protected,
        handCount: p.hand.length,
        discards: p.discards,
      })),
      you: me ? {
        id: me.id,
        hand: me.hand,
        chancellor: !!(this.pendingChancellor && this.pendingChancellor.playerId === playerId),
        mustPlayCountess: acting && this.mustPlayCountess(me),
        validTargets: acting
          ? Object.fromEntries(me.hand.map(c => [c, this.validTargets(playerId, c)]))
          : {},
      } : null,
      log: this.log
        .filter(e => !e.private || e.private === playerId)
        .map(e => ({ text: e.text, private: !!e.private })),
      roundResult: this.roundResult,
      gameWinnerId: this.gameWinnerId,
    };
  }
}

module.exports = { Game, CARDS, TOKENS_TO_WIN, cardName, buildDeck, shuffle };
