// rng.js — the match's dice, seeded so any run can be dealt again card for
// card: staged screenshots, soak tests and bug reports all lean on the same
// seed producing the same stream. Nothing in the game touches Math.random
// for gameplay; it all draws from one of these.
//
// The generator is mulberry32: a 32-bit state advanced by a fixed odd
// increment, then scrambled with two multiply-xorshift rounds. The exact
// constants are load-bearing — change them and every seed deals a
// different match.
export function createRng(seed) {
  const box = { state: seed | 0 };

  function draw() {
    box.state = (box.state + 0x6d2b79f5) | 0;
    let z = box.state;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  }

  return {
    next: draw,
    // A float somewhere in [lo, hi).
    range(lo, hi) { return lo + draw() * (hi - lo); },
    // A whole number in [lo, hi], both ends included.
    int(lo, hi) { return lo + Math.floor(draw() * (hi - lo + 1)); },
    pick(list) { return list[Math.floor(draw() * list.length)]; },
    chance(p) { return draw() < p; },
  };
}
