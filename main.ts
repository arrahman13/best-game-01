// TIDEWALL — a best-game-01 entry (Node 22, standard library only).
//
// The entry is the game/ folder beside this file: a round-based 5v5
// tactical FPS that runs offline in a desktop browser from plain static
// files (three.js vendored under game/vendor/, wired up by an import map
// in game/index.html). Breakers plant a breach charge at one of two sites
// on a dusk container harbour; Wardens defend and defuse. A buy-phase
// economy, five weapons, three grenades and role-driven bots fill out the
// match, first to 7 rounds.
//
// This program is the courier, not the game. It copies game/ and
// screenshots/ into the output directory and writes dossier.json there —
// the packet the judge reads — using buildDossier from the kit's vendored
// library (vendor/makefun-game.ts, kept byte-identical to the kit's copy
// because the gate rebuilds the dossier with its own and compares).
//
// Run it the way the grader does:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// MAKEFUN_OUTPUT_DIR stands in for /output outside the grader's container.
// Serve the game itself with `node serve.ts` (http://localhost:8080).

import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

// The gate's limits, as the kit's starter names them. Only text_max_bytes
// shapes the dossier's bytes; the rest make buildDossier refuse anything
// the gate would refuse anyway (too many or too-large screenshots, a game/
// tree over its file or byte caps, an over-long path).
const GATE = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};

const root = fileURLToPath(new URL('.', import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Copy one of the entry's trees into the output directory. Screenshots are
// optional in the layout (a game could ship none), game/ is not.
function handOver(name: string, required: boolean): boolean {
  const from = join(root, name);
  if (!existsSync(from)) {
    if (required) throw new Error(`entry is missing its ${name}/ folder`);
    return false;
  }
  cpSync(from, join(outDir, name), { recursive: true });
  return true;
}

mkdirSync(outDir, { recursive: true });
handOver('game', true);
mkdirSync(join(outDir, 'screenshots'), { recursive: true });
handOver('screenshots', false);

const dossier = buildDossier(outDir, GATE);
writeFileSync(join(outDir, 'dossier.json'), dossier);

// Audit what was just handed in, so a silent shortfall fails here instead
// of at the gate. The dossier's text is capped: once the game's sources
// outgrow it, buildDossier leaves the tail out without a word, and an
// entry could hand in a dossier that no longer holds the game's defining
// code. The markers below are this game's signatures — its title and the
// charge-hunt and staged-screenshot machinery — and the handoff is only
// honest while all of them survive into the text whole.
function treeStats(dir: string): { entries: number; bytes: number } {
  let entries = 0;
  let bytes = 0;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stats = statSync(path);
    entries += 1;
    if (stats.isDirectory()) {
      const inner = treeStats(path);
      entries += inner.entries;
      bytes += inner.bytes;
    } else {
      bytes += stats.size;
    }
  }
  return { entries, bytes };
}

const game = treeStats(join(outDir, 'game'));
const shots = treeStats(join(outDir, 'screenshots'));
if (game.entries > GATE.game_max_files || game.bytes > GATE.game_max_bytes) {
  throw new Error(`game/ is over the gate's caps: ${game.entries} entries, ${game.bytes} bytes`);
}
if (shots.entries > GATE.screenshots.max) {
  throw new Error(`screenshots/ holds ${shots.entries} files, over the gate's ${GATE.screenshots.max}`);
}

const packet = JSON.parse(new TextDecoder().decode(dossier)) as { text?: string };
const text = packet.text ?? '';
for (const marker of ['TIDEWALL', 'tickHunt', 'stageShot']) {
  if (!text.includes(marker)) throw new Error(`dossier text lost the game's marker: ${marker}`);
}
const textBytes = new TextEncoder().encode(text).length;

console.log(
  `TIDEWALL handed in: game/ (${game.entries} entries, ${game.bytes} bytes) and ` +
  `${shots.entries} screenshots copied to ${outDir}; dossier.json is ${dossier.length} bytes ` +
  `(text ${textBytes} of ${GATE.text_max_bytes}), all markers present.`,
);
