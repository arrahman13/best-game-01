// actors.js — the bodies. The player and the nine bots are built from one
// mould and pushed by one integrator, because a strafe that obeys
// different physics depending on who strafes would be felt instantly.
// Controllers never move a body directly: each fixed step they leave a
// command (wish direction, crouch, jump, fire…) in actor.cmd, and
// stepActor turns that wish into motion — ground acceleration and
// friction, feeble air control, gravity, and sliding collision against
// the map's boxes, with steps up onto crates handled by the ground query.
import * as THREE from 'three';
import { makeLoadout } from './weapons.js';

export const EYE_STAND = 1.62;
export const EYE_CROUCH = 1.12;
export const RADIUS = 0.35;

let idCounter = 1;

export function makeActor(name, team, isPlayer) {
  const actor = {
    id: idCounter,
    name,
    team,
    isPlayer,
    alive: true,
    pos: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    crouchAmt: 0,
    grounded: true,
    speed2d: 0,
    health: 100,
    money: 800,
    loadout: makeLoadout(),
    hasCharge: false,
    lastHurtBy: null,
    lastHurtAt: -99,
    blindUntil: 0, // flare grenades write here; brains and aim read it
    brain: null, // bots hang their state off this
    model: null,
    stepPhase: 0,
    nextStepAt: 0,
    nextThrowAt: 0, // earliest time the next grenade may leave the hand
    switchAt: -9, // last weapon swap, drives the viewmodel's draw dip
  };
  idCounter += 1;
  actor.cmd = {
    mx: 0, mz: 0, jump: false, crouch: false,
    fire: false, aim: false, use: false, reload: false,
  };
  return actor;
}

export function eyeHeight(actor) {
  return EYE_STAND + (EYE_CROUCH - EYE_STAND) * actor.crouchAmt;
}

export function eyePos(actor, out) {
  out.set(actor.pos.x, actor.pos.y + eyeHeight(actor), actor.pos.z);
  return out;
}

// Where the nose points: yaw 0 faces -Z, positive pitch looks up.
export function facing(actor, out) {
  const cosPitch = Math.cos(actor.pitch);
  out.set(
    -Math.sin(actor.yaw) * cosPitch,
    Math.sin(actor.pitch),
    -Math.cos(actor.yaw) * cosPitch,
  );
  return out;
}

// The weapon definition governing this body's pace, or null on the grenade
// slot (a fighter holding a grenade moves at the plain base speed).
function paceDef(actor) {
  if (actor.loadout.slot === 'grenade') return null;
  const slot = actor.loadout.slot === 'primary' ? actor.loadout.primary : actor.loadout.sidearm;
  return slot ? slot.def : null;
}

export function stepActor(actor, dt, map, now) {
  void now; // the integrator is time-free; callers keep the signature honest
  const cmd = actor.cmd;
  const def = paceDef(actor);

  let topSpeed = 4.6 * (def ? def.speed : 1);
  if (cmd.crouch) topSpeed *= 0.36;
  if (cmd.walk) topSpeed *= 0.55; // quiet feet carry less noise to bot ears
  if (cmd.aim && def) topSpeed *= 0.55;
  actor.crouchAmt += ((cmd.crouch ? 1 : 0) - actor.crouchAmt) * Math.min(1, dt * 9);

  // Wish velocity: the command's direction, capped so diagonals are not
  // faster than straights, scaled to the current top speed.
  const wishLen = Math.hypot(cmd.mx, cmd.mz);
  const denom = Math.max(1, wishLen);
  const wantX = wishLen > 0 ? (cmd.mx / denom) * topSpeed : 0;
  const wantZ = wishLen > 0 ? (cmd.mz / denom) * topSpeed : 0;
  const blend = Math.min(1, (actor.grounded ? 11 : 1.4) * dt);
  actor.vel.x += (wantX - actor.vel.x) * blend;
  actor.vel.z += (wantZ - actor.vel.z) * blend;

  if (actor.grounded && cmd.jump) {
    actor.vel.y = 6.0;
    actor.grounded = false;
  }
  if (!actor.grounded) actor.vel.y -= 17 * dt;

  actor.pos.x += actor.vel.x * dt;
  actor.pos.z += actor.vel.z * dt;
  actor.pos.y += actor.vel.y * dt;

  const floor = map.groundAt(actor.pos.x, actor.pos.z, actor.pos.y);
  if (actor.pos.y <= floor) {
    actor.pos.y = floor;
    if (actor.vel.y < 0) actor.vel.y = 0;
    actor.grounded = true;
  } else if (actor.pos.y > floor + 0.05) {
    actor.grounded = false;
  }
  map.collide(actor.pos, RADIUS, actor.crouchAmt > 0.5 ? 1.25 : 1.8);

  actor.speed2d = Math.hypot(actor.vel.x, actor.vel.z);
  if (actor.grounded && actor.speed2d > 0.6) {
    actor.stepPhase += dt * actor.speed2d * 1.6;
  }
}

// The damage rules of the house: a headshot counts four, legs three
// quarters. Armour halves anything that reaches the body; a helmet takes
// a smaller bite out of headshots instead. Nothing lands once the round
// or the match is decided, and the dead stay dead.
export function applyDamage(S, victim, raw, part, attacker) {
  if (!victim.alive) return false;
  if (S.phase === 'roundover' || S.phase === 'matchover') return false;

  let dmg = raw;
  if (part === 'head') dmg *= 4;
  else if (part === 'legs') dmg *= 0.75;
  if (part === 'head') {
    if (victim.loadout.helmet) dmg *= 0.85;
  } else if (victim.loadout.armor) {
    dmg *= 0.5;
  }
  dmg = Math.max(1, Math.round(dmg));

  victim.health -= dmg;
  victim.lastHurtBy = attacker;
  victim.lastHurtAt = S.time;
  S.events.push({ type: 'damage', victim, attacker, dmg, part });

  if (victim.health > 0) return false;
  victim.health = 0;
  victim.alive = false;
  S.events.push({ type: 'kill', victim, attacker, part });
  if (victim.hasCharge) {
    victim.hasCharge = false;
    S.bomb.dropAt(victim.pos); // the charge falls where its carrier did
  }
  return true;
}
