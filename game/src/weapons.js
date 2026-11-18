// weapons.js — the armoury. Five guns and three grenades, each described
// once in the tables below; the shop prices them from here, combat rolls
// their damage from here, the viewmodel is proportioned from here and the
// HUD prints their names from here, so no part of the game can disagree
// with another about what a gun is.
//
// The gun table is stored as rows under a shared field list and assembled
// into objects at load — read a row left to right the way the fields are
// declared. The design thread through all five: accuracy is earned by
// standing still. Base spread is tiny; the moveSpread multiplier is what
// punishes running and gunning.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const GUN_FIELDS = [
  'id', 'name', 'kind', 'price', 'damage', 'rpm', 'auto', 'mag', 'reserve',
  'reload', 'spread', 'moveSpread', 'recoil', 'pellets',
  'falloffFrom', 'falloffTo', 'falloffMin', 'zoom', 'draw', 'speed',
];

//            id         name              kind       price dmg  rpm  auto    mag  res  reload spread moveSpr recoil pellets fFrom fTo   fMin  zoom  draw  speed
const GUN_ROWS = [
  ['pistol', 'P9 Dockhand', 'pistol', 0, 26, 340, false, 12, 48, 1.4, 0.006, 3.2, 0.010, 1, 18, 46, 0.55, 1.25, 0.35, 1.0],
  ['smg', 'Kestrel-9', 'smg', 1100, 21, 850, true, 30, 90, 2.0, 0.016, 2.4, 0.007, 1, 12, 34, 0.5, 1.25, 0.45, 1.0],
  ['shotgun', 'Breakwater 12', 'shotgun', 1050, 9, 68, false, 6, 24, 2.8, 0.045, 1.8, 0.05, 8, 6, 20, 0.25, 1.15, 0.5, 0.97],
  ['rifle', 'Longshore AR', 'rifle', 2700, 33, 600, true, 25, 75, 2.2, 0.0075, 3.6, 0.013, 1, 30, 80, 0.72, 1.35, 0.55, 0.95],
  ['sniper', 'Cormorant', 'sniper', 3500, 97, 44, false, 5, 20, 3.0, 0.0012, 9, 0.06, 1, 40, 120, 0.9, 2.6, 0.6, 0.93],
];

function assembleGun(row) {
  const def = {};
  GUN_FIELDS.forEach((field, i) => { def[field] = row[i]; });
  return def;
}

export const WEAPONS = {};
for (const row of GUN_ROWS) WEAPONS[row[0]] = assembleGun(row);
// The Cormorant works a bolt between shots; no other gun carries the field.
WEAPONS.sniper.bolt = 1.35;

// Grenades are simpler citizens: a name and a price is all the shop needs;
// their behaviour lives in grenades.js.
export const GRENADES = Object.fromEntries(
  [['frag', 'Burst grenade', 300], ['flash', 'Flare grenade', 200], ['smoke', 'Fog grenade', 300]]
    .map(([id, name, price]) => [id, { id, name, price }]),
);
export const ARMOR_PRICE = 650;

// What one fighter carries. Slots hold live state (rounds left, timers);
// the defs above stay immutable and shared.
export function makeLoadout() {
  const loadout = {
    primary: null,
    sidearm: makeSlot(WEAPONS.pistol),
    grenades: { frag: 0, flash: 0, smoke: 0 },
    slot: 'sidearm',
    grenadeType: 'frag',
    armor: false,
    helmet: false,
  };
  return loadout;
}

export function makeSlot(def) {
  return {
    def,
    mag: def.mag,
    reserve: def.reserve,
    nextShotAt: 0,
    reloadEndAt: 0,
    boltUntil: 0,
  };
}

// Round start: every carried gun is topped up from the house, free.
export function refill(loadout) {
  for (const key of ['primary', 'sidearm']) {
    const slot = loadout[key];
    if (!slot) continue;
    slot.mag = slot.def.mag;
    slot.reserve = slot.def.reserve;
    slot.nextShotAt = 0;
    slot.reloadEndAt = 0;
    slot.boltUntil = 0;
  }
}

// The slot a trigger pull would use right now. On the grenade slot this
// still answers the sidearm — callers that care check the slot name first.
export function currentSlot(loadout) {
  return loadout.slot === 'primary' ? loadout.primary : loadout.sidearm;
}

// Damage multiplier at a distance: untouched out to falloffFrom, then a
// straight slide down to falloffMin at falloffTo, flat beyond.
export function falloff(def, dist) {
  if (dist <= def.falloffFrom) return 1;
  if (dist >= def.falloffTo) return def.falloffMin;
  const along = (dist - def.falloffFrom) / (def.falloffTo - def.falloffFrom);
  return 1 - along * (1 - def.falloffMin);
}

// ---- meshes ---------------------------------------------------------------
// All three builders share one unit cube, scaled per part — cheap geometry,
// and the proportions below are the game's whole modelling department.
const MAT_STEEL = new THREE.MeshLambertMaterial({ color: '#2b2f36' });
const MAT_STEEL_LIGHT = new THREE.MeshLambertMaterial({ color: PALETTE.hairline });
const MAT_WOOD = new THREE.MeshLambertMaterial({ color: '#4c3a28' });
const MAT_AMBER = new THREE.MeshLambertMaterial({ color: PALETTE.accent });
const UNIT_CUBE = new THREE.BoxGeometry(1, 1, 1);

function addPart(parent, material, size, at, tiltX = 0) {
  const mesh = new THREE.Mesh(UNIT_CUBE, material);
  mesh.scale.set(size[0], size[1], size[2]);
  mesh.position.set(at[0], at[1], at[2]);
  mesh.rotation.x = tiltX;
  parent.add(mesh);
  return mesh;
}

const VIEWMODEL_LENGTH = { sniper: 0.86, rifle: 0.72, shotgun: 0.7, smg: 0.52 };

// The gun in the player's own hands, built around the origin and pointing
// down -Z. player.js poses the group; the muzzle marker it finds in
// userData is where the flash and the tracer origin hang from.
export function buildViewmodel(def) {
  const kind = def.kind;
  const len = VIEWMODEL_LENGTH[kind] || 0.34;
  const g = new THREE.Group();
  addPart(g, MAT_STEEL, [0.075, 0.11, len], [0, 0, -len / 2]); // receiver
  addPart(g, MAT_STEEL_LIGHT, [0.045, 0.045, 0.22], [0, 0.045, -len + 0.05]); // barrel
  addPart(g, MAT_WOOD, [0.06, 0.13, 0.07], [0, -0.1, 0.03], 0.35); // grip
  if (kind !== 'pistol') {
    addPart(g, MAT_STEEL, [0.05, 0.14, 0.08], [0, -0.11, -len * 0.45], 0.12); // magazine
  }
  if (kind === 'sniper') {
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.2, 10), MAT_STEEL);
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 0.1, -0.3);
    g.add(scope);
    addPart(g, MAT_AMBER, [0.03, 0.03, 0.012], [0, 0.1, -0.41]); // lit front lens
  } else {
    addPart(g, MAT_STEEL_LIGHT, [0.014, 0.05, 0.014], [0, 0.1, -len + 0.12]); // front post
    addPart(g, MAT_STEEL, [0.05, 0.03, 0.02], [0, 0.095, -0.06]); // rear sight
  }
  if (kind === 'shotgun') addPart(g, MAT_WOOD, [0.055, 0.06, 0.16], [0, -0.03, -0.42]); // pump
  if (kind === 'smg') addPart(g, MAT_STEEL_LIGHT, [0.05, 0.05, 0.08], [0, 0, -len - 0.03]); // suppressor
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.045, -len - 0.06);
  g.add(muzzle);
  g.userData.muzzle = muzzle;
  return g;
}

const WORLD_GUN_LENGTH = { pistol: 0.26, sniper: 0.95, smg: 0.5 };

// The silhouette a bot carries: at bot-watching distance a dark long box
// and a magazine are all the eye can honestly resolve.
export function buildWorldGun(kind) {
  const len = WORLD_GUN_LENGTH[kind] || 0.75;
  const g = new THREE.Group();
  addPart(g, MAT_STEEL, [0.06, 0.09, len], [0, 0, -len / 2]);
  addPart(g, MAT_STEEL, [0.04, 0.1, 0.06], [0, -0.08, -0.18]);
  return g;
}

// A grenade in the fist: a steel canister with one painted band whose
// colour is the whole user interface — red bursts, pale flares, grey fogs.
export function buildGrenadeModel(type) {
  const bandColour = type === 'frag' ? PALETTE.danger : type === 'flash' ? PALETTE.ink : PALETTE.muted;
  const g = new THREE.Group();
  const canister = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045, 0.045, 0.13, 10),
    MAT_STEEL,
  );
  const band = new THREE.Mesh(
    new THREE.CylinderGeometry(0.047, 0.047, 0.03, 10),
    new THREE.MeshLambertMaterial({ color: bandColour }),
  );
  band.position.y = 0.02;
  g.add(canister, band);
  return g;
}
