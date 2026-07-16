'use strict';

const assert = require('assert');
const { Game, buildDeck } = require('./game');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok - ${name}`);
  } catch (err) {
    console.error(`  FAIL - ${name}`);
    console.error(err.stack.split('\n').slice(0, 4).map(l => '    ' + l).join('\n'));
    process.exitCode = 1;
  }
}

// Build a game and force a known mid-round position. hands[i] is player i's
// hand (the player whose turn it is holds 2 cards); deck is drawn from the end.
function rig(names, { hands, deck = [1, 1, 1], turn = 'p0', burned = 4 } = {}) {
  const g = new Game(names.map((n, i) => ({ id: 'p' + i, name: n })));
  g.startRound();
  g.players.forEach((p, i) => { p.hand = [...hands[i]]; p.discards = []; p.playedSpy = false; });
  g.deck = [...deck];
  g.burned = burned;
  g.turn = turn;
  return g;
}

console.log('deck & setup');

test('deck has 21 cards with correct counts (2019 edition)', () => {
  const deck = buildDeck();
  assert.strictEqual(deck.length, 21);
  const count = v => deck.filter(c => c === v).length;
  assert.deepStrictEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(count), [2, 6, 2, 2, 2, 2, 2, 1, 1, 1]);
});

test('3-player setup: burn 1, no face-up, first player draws to 2', () => {
  const g = new Game([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }]);
  g.startRound();
  assert.strictEqual(g.faceUp.length, 0);
  assert.notStrictEqual(g.burned, null);
  assert.strictEqual(g.player(g.turn).hand.length, 2);
  const inHands = g.players.reduce((n, p) => n + p.hand.length, 0);
  assert.strictEqual(g.deck.length + inHands + 1, 21);
});

test('2-player setup adds 3 face-up cards', () => {
  const g = new Game([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
  g.startRound();
  assert.strictEqual(g.faceUp.length, 3);
  const inHands = g.players.reduce((n, p) => n + p.hand.length, 0);
  assert.strictEqual(g.deck.length + inHands + 1 + 3, 21);
});

test('supports 6 players, rejects 1 and 7', () => {
  const six = new Game([1, 2, 3, 4, 5, 6].map(i => ({ id: 'p' + i, name: 'P' + i })));
  assert.strictEqual(six.tokensToWin, 3);
  assert.throws(() => new Game([{ id: 'a', name: 'A' }]));
  assert.throws(() => new Game([1, 2, 3, 4, 5, 6, 7].map(i => ({ id: 'p' + i, name: 'P' + i }))));
});

console.log('spy');

test('lone spy discarder gains a bonus token at round end', () => {
  const g = rig(['A', 'B'], { hands: [[0, 1], [9]], deck: [1, 1] });
  g.playCard('p0', 0, {});
  g.playCard('p1', 9, {}); // princess suicide — p0 is last standing
  assert.strictEqual(g.phase, 'roundEnd');
  assert.strictEqual(g.player('p0').tokens, 2); // round win + spy bonus
});

test('no spy bonus when two surviving players discarded spies', () => {
  const g = rig(['A', 'B', 'C'], { hands: [[0, 1], [0], [2]], deck: [1] });
  g.playCard('p0', 0, {});      // p1 draws the last card
  g.playCard('p1', 0, {});      // deck empty -> round ends by comparison
  assert.strictEqual(g.phase, 'roundEnd');
  assert.strictEqual(g.player('p0').tokens, 0);
  assert.strictEqual(g.player('p1').tokens, 0);
});

test('an eliminated spy player gets no bonus', () => {
  const g = rig(['A', 'B'], { hands: [[9], [1, 2]], deck: [1, 1], turn: 'p1' });
  g.player('p0').playedSpy = true;
  g.player('p0').discards = [0];
  g.playCard('p1', 1, { targetId: 'p0', guess: 9 }); // p0 out
  assert.strictEqual(g.player('p0').tokens, 0);
  assert.strictEqual(g.player('p1').tokens, 1);
});

console.log('guard');

test('correct guess eliminates the target', () => {
  const g = rig(['A', 'B', 'C'], { hands: [[1, 4], [9], [2]] });
  g.playCard('p0', 1, { targetId: 'p1', guess: 9 });
  assert.strictEqual(g.player('p1').alive, false);
  assert.deepStrictEqual(g.player('p1').discards, [9]);
});

test('wrong guess does nothing', () => {
  const g = rig(['A', 'B', 'C'], { hands: [[1, 4], [9], [2]] });
  g.playCard('p0', 1, { targetId: 'p1', guess: 5 });
  assert.strictEqual(g.player('p1').alive, true);
});

test('cannot guess Guard (1), can guess Spy (0)', () => {
  const g = rig(['A', 'B', 'C'], { hands: [[1, 4], [0], [2]] });
  assert.throws(() => g.playCard('p0', 1, { targetId: 'p1', guess: 1 }), /other than the Guard/);
  g.playCard('p0', 1, { targetId: 'p1', guess: 0 });
  assert.strictEqual(g.player('p1').alive, false);
});

console.log('priest');

test('peek is logged privately to the peeker only', () => {
  const g = rig(['A', 'B', 'C'], { hands: [[2, 4], [9], [3]] });
  g.playCard('p0', 2, { targetId: 'p1' });
  const mine = g.stateFor('p0').log.filter(e => e.private);
  const theirs = g.stateFor('p2').log.filter(e => e.private);
  assert.ok(mine.some(e => e.text.includes('Princess')));
  assert.strictEqual(theirs.length, 0);
});

console.log('baron');

test('lower hand is eliminated', () => {
  const g = rig(['A', 'B', 'C'], { hands: [[3, 9], [2], [4]] });
  g.playCard('p0', 3, { targetId: 'p1' });
  assert.strictEqual(g.player('p1').alive, false);
  assert.strictEqual(g.player('p0').alive, true);
});

test('baron can eliminate the player of the card', () => {
  const g = rig(['A', 'B', 'C'], { hands: [[3, 2], [9], [4]] });
  g.playCard('p0', 3, { targetId: 'p1' });
  assert.strictEqual(g.player('p0').alive, false);
  assert.strictEqual(g.player('p1').alive, true);
});

test('baron tie does nothing', () => {
  const g = rig(['A', 'B', 'C'], { hands: [[3, 5], [5], [4]] });
  g.playCard('p0', 3, { targetId: 'p1' });
  assert.ok(g.player('p0').alive && g.player('p1').alive);
});

console.log('handmaid');

test('protected players cannot be targeted, protection ends on their turn', () => {
  const g = rig(['A', 'B', 'C'], { hands: [[4, 1], [1, 5], [1]], deck: [1, 1, 1, 1] });
  g.playCard('p0', 4, {});
  assert.strictEqual(g.player('p0').protected, true);
  assert.strictEqual(g.turn, 'p1');
  // p1 cannot target protected p0
  assert.throws(() => g.playCard('p1', 1, { targetId: 'p0', guess: 5 }), /valid target/);
  g.playCard('p1', 1, { targetId: 'p2', guess: 9 }); // wrong on purpose
  g.playCard('p2', 1, { targetId: 'p1', guess: 9 }); // wrong on purpose
  // back to p0 — protection has ended
  assert.strictEqual(g.turn, 'p0');
  assert.strictEqual(g.player('p0').protected, false);
});

test('targeted card fizzles when all opponents are protected', () => {
  const g = rig(['A', 'B'], { hands: [[1, 7], [4]] });
  g.player('p1').protected = true;
  g.playCard('p0', 1, {}); // no target needed — fizzles
  assert.strictEqual(g.player('p1').alive, true);
  assert.deepStrictEqual(g.player('p0').discards, [1]);
});

console.log('prince');

test('target discards and draws a new card', () => {
  // target p2 so the turn passing to p1 (who draws) doesn't touch p2's hand
  const g = rig(['A', 'B', 'C'], { hands: [[5, 1], [3], [4]], deck: [7, 2, 2] });
  g.playCard('p0', 5, { targetId: 'p2' });
  assert.deepStrictEqual(g.player('p2').discards, [4]);
  assert.deepStrictEqual(g.player('p2').hand, [2]); // drew from end of deck
});

test('forcing a Princess discard eliminates', () => {
  const g = rig(['A', 'B', 'C'], { hands: [[5, 1], [9], [4]] });
  g.playCard('p0', 5, { targetId: 'p1' });
  assert.strictEqual(g.player('p1').alive, false);
});

test('prince with empty deck draws the burned card', () => {
  const g = rig(['A', 'B', 'C'], { hands: [[5, 1], [3], [4]], deck: [], burned: 7 });
  g.playCard('p0', 5, { targetId: 'p1' });
  assert.deepStrictEqual(g.player('p1').hand, [7]);
  // deck empty -> round ends by comparison: hands are 1, 7, 4 -> p1 wins
  assert.strictEqual(g.phase, 'roundEnd');
  assert.deepStrictEqual(g.roundResult.winnerIds, ['p1']);
});

test('prince can and must target self when everyone else is protected', () => {
  const g = rig(['A', 'B'], { hands: [[5, 9], [3]], deck: [2, 2] });
  g.player('p1').protected = true;
  assert.deepStrictEqual(g.validTargets('p0', 5), ['p0']);
  g.playCard('p0', 5, { targetId: 'p0' });
  assert.deepStrictEqual(g.player('p0').discards, [5, 9]);
  // discarding own Princess via Prince eliminates you
  assert.strictEqual(g.player('p0').alive, false);
  assert.strictEqual(g.phase, 'roundEnd');
});

console.log('chancellor');

test('chancellor draws 2, keeps 1, returns the rest to the bottom', () => {
  const g = rig(['A', 'B', 'C'], { hands: [[6, 1], [2], [3]], deck: [4, 5, 0, 9] });
  g.playCard('p0', 6, {});
  assert.strictEqual(g.pendingChancellor.playerId, 'p0');
  assert.strictEqual(g.player('p0').hand.length, 3); // held 1, drew 9 and 0
  assert.strictEqual(g.turn, 'p0'); // turn waits for the decision
  assert.throws(() => g.playCard('p0', 1, { targetId: 'p1', guess: 9 }), /Chancellor/);
  g.chancellorKeep('p0', 9);
  assert.deepStrictEqual(g.player('p0').hand, [9]);
  assert.strictEqual(g.pendingChancellor, null);
  assert.strictEqual(g.turn, 'p1');
  // 4 - 2 drawn + 2 returned - 1 drawn by p1's turn = 3
  assert.strictEqual(g.deck.length, 3);
});

test('chancellor return order is respected', () => {
  const g = rig(['A', 'B', 'C'], { hands: [[6, 1], [2], [3]], deck: [4, 5, 0, 9] });
  g.playCard('p0', 6, {}); // draws 9 and 0 → hand [1, 9, 0]
  g.chancellorKeep('p0', 1, [9, 0]); // 9 drawn before 0
  // deck bottom-to-top was [0, 9, 4, 5]; p1's turn drew the 5 off the top
  assert.deepStrictEqual(g.deck, [0, 9, 4]);
  assert.strictEqual(g.player('p1').hand[1], 5);
});

test('chancellor rejects a bogus return order', () => {
  const g = rig(['A', 'B', 'C'], { hands: [[6, 1], [2], [3]], deck: [4, 5, 0, 9] });
  g.playCard('p0', 6, {}); // hand [1, 9, 0]
  assert.throws(() => g.chancellorKeep('p0', 1, [9, 9]), /order/);
  assert.throws(() => g.chancellorKeep('p0', 1, [9]), /order/);
  // the failed attempts changed nothing
  assert.strictEqual(g.player('p0').hand.length, 3);
  assert.strictEqual(g.pendingChancellor.playerId, 'p0');
  g.chancellorKeep('p0', 1, [0, 9]);
  assert.deepStrictEqual(g.player('p0').hand, [1]);
});

test('chancellor keep must be a held card, and only when pending', () => {
  const g = rig(['A', 'B', 'C'], { hands: [[6, 1], [2], [3]], deck: [4, 5, 0, 9] });
  assert.throws(() => g.chancellorKeep('p0', 1), /no Chancellor decision/);
  g.playCard('p0', 6, {});
  assert.throws(() => g.chancellorKeep('p1', 2), /no Chancellor decision/);
  assert.throws(() => g.chancellorKeep('p0', 8), /do not hold/);
});

test('chancellor with an empty deck has no effect', () => {
  const g = rig(['A', 'B', 'C'], { hands: [[6, 1], [2], [3]], deck: [] });
  g.playCard('p0', 6, {});
  assert.strictEqual(g.pendingChancellor, null);
  // deck was empty -> round ends by comparison: 1 vs 2 vs 3 -> p2 wins
  assert.strictEqual(g.phase, 'roundEnd');
  assert.deepStrictEqual(g.roundResult.winnerIds, ['p2']);
});

test('chancellor with one card left draws it and returns one', () => {
  const g = rig(['A', 'B', 'C'], { hands: [[6, 1], [2], [3]], deck: [7] });
  g.playCard('p0', 6, {});
  assert.strictEqual(g.player('p0').hand.length, 2);
  g.chancellorKeep('p0', 7);
  assert.deepStrictEqual(g.player('p0').hand, [7]);
  // the returned card was drawn again on p1's turn; round continues
  assert.strictEqual(g.turn, 'p1');
  assert.strictEqual(g.player('p1').hand.length, 2);
});

console.log('king');

test('king swaps hands', () => {
  const g = rig(['A', 'B', 'C'], { hands: [[7, 2], [9], [4]] });
  g.playCard('p0', 7, { targetId: 'p1' });
  assert.deepStrictEqual(g.player('p0').hand, [9]);
  // p1 then drew a card at the start of their turn, so their hand is [2, drawn]
  assert.strictEqual(g.player('p1').hand[0], 2);
});

console.log('countess');

test('countess is forced with King or Prince', () => {
  const g = rig(['A', 'B', 'C'], { hands: [[8, 7], [1], [1]] });
  assert.throws(() => g.playCard('p0', 7, { targetId: 'p1' }), /Countess/);
  g.playCard('p0', 8, {});
  assert.deepStrictEqual(g.player('p0').discards, [8]);
});

test('countess is not forced with other cards', () => {
  const g = rig(['A', 'B', 'C'], { hands: [[8, 2], [1], [1]] });
  g.playCard('p0', 2, { targetId: 'p1' }); // allowed
  assert.deepStrictEqual(g.player('p0').discards, [2]);
});

console.log('princess');

test('playing the Princess eliminates you', () => {
  const g = rig(['A', 'B', 'C'], { hands: [[9, 2], [1], [1]] });
  g.playCard('p0', 9, {});
  assert.strictEqual(g.player('p0').alive, false);
});

console.log('turn rules');

test('cannot play out of turn or a card you do not hold', () => {
  const g = rig(['A', 'B', 'C'], { hands: [[1, 2], [3], [4]] });
  assert.throws(() => g.playCard('p1', 3, { targetId: 'p0' }), /Not your turn/);
  assert.throws(() => g.playCard('p0', 9, {}), /do not hold/);
});

test('eliminated players are skipped in turn order', () => {
  const g = rig(['A', 'B', 'C'], { hands: [[1, 4], [9], [2]], deck: [1, 1, 1] });
  g.playCard('p0', 1, { targetId: 'p1', guess: 9 }); // p1 out
  assert.strictEqual(g.turn, 'p2');
});

console.log('round & game end');

test('last player standing wins the round and starts the next', () => {
  const g = rig(['A', 'B'], { hands: [[1, 4], [9]], deck: [1, 1] });
  g.playCard('p0', 1, { targetId: 'p1', guess: 9 });
  assert.strictEqual(g.phase, 'roundEnd');
  assert.deepStrictEqual(g.roundResult.winnerIds, ['p0']);
  assert.strictEqual(g.player('p0').tokens, 1);
  g.startRound();
  assert.strictEqual(g.turn, 'p0');
});

test('deck exhaustion: highest card wins', () => {
  const g = rig(['A', 'B', 'C'], { hands: [[1, 2], [7], [5]], deck: [] });
  g.playCard('p0', 1, { targetId: 'p1', guess: 9 }); // wrong, deck now empty
  assert.strictEqual(g.phase, 'roundEnd');
  assert.deepStrictEqual(g.roundResult.winnerIds, ['p1']);
});

test('deck exhaustion tie broken by discard totals', () => {
  const g = rig(['A', 'B', 'C'], { hands: [[1, 5], [5], [2]], deck: [] });
  g.player('p1').discards = [4, 3]; // total 7
  // p0's total after playing the Guard will be 1
  g.playCard('p0', 1, { targetId: 'p1', guess: 9 });
  assert.deepStrictEqual(g.roundResult.winnerIds, ['p1']);
});

test('winning enough tokens ends the game', () => {
  const g = rig(['A', 'B'], { hands: [[1, 4], [9]], deck: [1, 1] });
  g.player('p0').tokens = 5; // 2-player game needs 6
  g.playCard('p0', 1, { targetId: 'p1', guess: 9 });
  assert.strictEqual(g.phase, 'gameOver');
  assert.strictEqual(g.gameWinnerId, 'p0');
  assert.throws(() => g.startRound(), /over/);
});

console.log('information hiding');

test('stateFor never exposes other players\' hands', () => {
  const g = rig(['A', 'B', 'C'], { hands: [[1, 2], [9], [5]] });
  const s = JSON.stringify(g.stateFor('p2').players.map(p => ({ ...p, discards: [] })));
  assert.ok(!s.includes('"hand"'));
  const view = g.stateFor('p2');
  assert.deepStrictEqual(view.you.hand, [5]);
});

test('a full random 6-player game runs to completion', () => {
  const g = new Game(['A', 'B', 'C', 'D', 'E', 'F'].map((n, i) => ({ id: 'p' + i, name: n })));
  let guard = 0;
  while (g.phase !== 'gameOver' && guard++ < 5000) {
    if (g.phase === 'roundEnd') { g.startRound(); continue; }
    const me = g.player(g.turn);
    // naive strategy: play the first legal card with the first legal options
    const options = [];
    for (const c of new Set(me.hand)) {
      if (g.mustPlayCountess(me) && c !== 8) continue;
      const targets = g.validTargets(g.turn, c);
      const needsTarget = [1, 2, 3, 5, 7].includes(c);
      if (!needsTarget || targets.length === 0) options.push([c, {}]);
      else options.push([c, { targetId: targets[0], guess: 9 }]);
    }
    const [card, opts] = options[0];
    const actor = g.turn;
    g.playCard(actor, card, opts);
    if (g.pendingChancellor) {
      g.chancellorKeep(actor, g.player(actor).hand[0]);
    }
  }
  assert.strictEqual(g.phase, 'gameOver');
  const champ = g.player(g.gameWinnerId);
  assert.ok(champ.tokens >= g.tokensToWin);
});

console.log(`\n${passed} tests passed${process.exitCode ? ' (with failures)' : ''}`);
