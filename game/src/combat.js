// combat.js — gunfire, resolved the same way for the human and for every
// bot: a trigger pull is a handful of rays (one per pellet), each tested
// against the map's walls and against every enemy body, where a body is a
// stack of spheres — crown, chest, hips, knees — and the part a ray meets
// first decides what the hit is worth.
//
// Accuracy is a resource the player manages. Spread starts at the def's
// base value, grows with the shooter's speed by the def's moveSpread,
// balloons in the air, tightens in a crouch, and blooms a little with
// every shot until serviceWeapons lets it cool. Stopping to aim pays;
// the numbers are arranged so that it pays visibly.
import * as THREE from 'three';
import { currentSlot, falloff } from './weapons.js';
import { applyDamage, eyePos, facing } from './actors.js';

const _eye = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _end = new THREE.Vector3();

// Hit volumes up the body: [height above the feet, radius, part name].
// Two stacks, because a crouched fighter is a shorter, wider target.
// They are built once and shared — traceShot reads them on every pellet
// of every shot, and they are never mutated.
const STACK_STANDING = [[1.52, 0.21, 'head'], [1.36, 0.30, 'body'], [1.10, 0.30, 'body'], [0.84, 0.29, 'body'], [0.52, 0.26, 'legs'], [0.24, 0.25, 'legs']];
const STACK_CROUCHED = [[1.06, 0.21, 'head'], [0.94, 0.30, 'body'], [0.72, 0.30, 'body'], [0.50, 0.29, 'body'], [0.30, 0.26, 'legs'], [0.14, 0.25, 'legs']];

function bodyStack(crouched) {
  return crouched ? STACK_CROUCHED : STACK_STANDING;
}

export function spreadFor(actor, def) {
  const pace = Math.min(1, actor.speed2d / 4.6);
  let spread = def.spread * (1 + pace * (def.moveSpread - 1));
  if (!actor.grounded) spread *= 2.4;
  if (actor.crouchAmt > 0.5) spread *= 0.7;
  return spread * (1 + (actor.bloom || 0));
}

// Ray against one sphere, solved in the ray's own frame: project the
// centre onto the ray, measure the miss distance, step back by the
// half-chord. Returns the entry distance, or -1 for a miss / a sphere
// behind the muzzle / a hit no nearer than limit.
function rayVsSphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, radius, limit) {
  const relX = cx - ox; const relY = cy - oy; const relZ = cz - oz;
  const along = relX * dx + relY * dy + relZ * dz;
  if (along < 0) return -1;
  const missSq = relX * relX + relY * relY + relZ * relZ - along * along;
  const rSq = radius * radius;
  if (missSq > rSq) return -1;
  const entry = along - Math.sqrt(rSq - missSq);
  return entry > 0 && entry < limit ? entry : -1;
}

// The first thing a ray meets: scenery (a distance from the map) or the
// nearest sphere of the nearest enemy. Teammates are transparent to it.
export function traceShot(S, shooter, ox, oy, oz, dx, dy, dz, maxDist = 120) {
  let nearest = S.map.rayHit(ox, oy, oz, dx, dy, dz, maxDist);
  const wallDist = nearest;
  let victim = null;
  let partHit = null;
  for (const other of S.actors) {
    if (other === shooter || !other.alive || other.team === shooter.team) continue;
    for (const [h, r, part] of bodyStack(other.crouchAmt > 0.5)) {
      const t = rayVsSphere(ox, oy, oz, dx, dy, dz, other.pos.x, other.pos.y + h, other.pos.z, r, nearest);
      if (t > 0) {
        nearest = t;
        victim = other;
        partHit = part;
      }
    }
  }
  return { dist: nearest, actor: victim, part: partHit, wall: victim === null && wallDist < maxDist };
}

export function startReload(S, actor) {
  if (actor.loadout.slot === 'grenade') return false;
  const slot = currentSlot(actor.loadout);
  if (!slot) return false;
  const alreadyRunning = slot.reloadEndAt > S.time;
  if (alreadyRunning || slot.mag >= slot.def.mag || slot.reserve <= 0) return false;
  slot.reloadEndAt = S.time + slot.def.reload;
  S.events.push({ type: 'reload', actor });
  return true;
}

// Once a step for every fighter: let the bloom cool, and land any reload
// whose timer has run out, moving rounds from reserve into the magazine.
export function serviceWeapons(S, actor) {
  actor.bloom = Math.max(0, (actor.bloom || 0) - S.dt * 2.6);
  const slot = currentSlot(actor.loadout);
  if (!slot || !slot.reloadEndAt || S.time < slot.reloadEndAt) return;
  const moved = Math.min(slot.def.mag - slot.mag, slot.reserve);
  slot.mag += moved;
  slot.reserve -= moved;
  slot.reloadEndAt = 0;
}

// One trigger pull. True only if at least the mechanism cycled a live
// round out of the barrel; a dry click still costs the shooter time and
// starts the reload for them.
export function tryFire(S, actor) {
  if (actor.loadout.slot === 'grenade') return false;
  const slot = currentSlot(actor.loadout);
  if (!slot) return false;
  const def = slot.def;
  if (S.time < slot.nextShotAt || S.time < slot.boltUntil || slot.reloadEndAt > S.time) return false;
  if (slot.mag <= 0) {
    slot.nextShotAt = S.time + 0.3;
    S.events.push({ type: 'dry', actor });
    startReload(S, actor);
    return false;
  }

  slot.mag -= 1;
  slot.nextShotAt = S.time + 60 / def.rpm;
  if (def.bolt) slot.boltUntil = S.time + def.bolt;
  actor.bloom = Math.min(1.6, (actor.bloom || 0) + (def.auto ? 0.16 : 0.3));

  eyePos(actor, _eye);
  facing(actor, _aim);
  _muzzle.copy(_eye).addScaledVector(_aim, 0.55);
  _muzzle.y -= 0.14;
  S.noise.push({ x: actor.pos.x, z: actor.pos.z, r: 30, team: actor.team, at: S.time });

  const spread = spreadFor(actor, def);
  for (let pellet = 0; pellet < def.pellets; pellet += 1) {
    const px = _aim.x + (S.rng.next() * 2 - 1) * spread;
    const py = _aim.y + (S.rng.next() * 2 - 1) * spread;
    const pz = _aim.z + (S.rng.next() * 2 - 1) * spread;
    const len = Math.hypot(px, py, pz) || 1;
    const ux = px / len; const uy = py / len; const uz = pz / len;
    const hit = traceShot(S, actor, _eye.x, _eye.y, _eye.z, ux, uy, uz);
    _end.set(_eye.x + ux * hit.dist, _eye.y + uy * hit.dist, _eye.z + uz * hit.dist);
    if (pellet === 0 || hit.actor) {
      S.events.push({ type: 'tracer', from: _muzzle.clone(), to: _end.clone(), shooter: actor });
    }
    if (hit.actor) {
      const killed = applyDamage(S, hit.actor, def.damage * falloff(def, hit.dist), hit.part, actor);
      S.events.push({ type: 'hit', shooter: actor, victim: hit.actor, part: hit.part, killed });
    } else if (hit.wall) {
      S.events.push({ type: 'impact', at: _end.clone() });
    }
  }
  S.events.push({ type: 'shot', actor, def });
  actor.recoilKick = (actor.recoilKick || 0) + def.recoil;
  if (slot.mag === 0) startReload(S, actor);
  return true;
}
