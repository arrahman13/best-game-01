// player.js — the human being, in two halves. controlPlayer translates
// the recorded input into the player actor's command once per fixed step
// (and, just as importantly, refuses to when the round is not live, so a
// corpse or a buy-phase shopper never shuffles). createPlayerView owns
// everything the camera and the held weapon do between steps: the look,
// the recoil that partly stays in the aim and partly recovers, the
// aim-down-sights blend, the walk bob, the reload dip, the draw raise.
//
// The simulation downstream only ever sees the actor. This module is the
// puppeteer; it keeps no game state of its own.
import * as THREE from 'three';
import { buildViewmodel, buildGrenadeModel, currentSlot } from './weapons.js';
import { eyeHeight } from './actors.js';

const GRENADE_ORDER = ['frag', 'flash', 'smoke'];

export function controlPlayer(S, input) {
  const p = S.player;
  const cmd = p.cmd;
  // One-shot and held fire states are rewritten from scratch every step.
  cmd.mx = 0; cmd.mz = 0;
  cmd.fire = false; cmd.reload = false;
  cmd.jump = false; cmd.use = false; cmd.aim = false;
  const roundLive = S.phase === 'live' || S.phase === 'planted';
  if (!p.alive || !roundLive) {
    input.clearPressed();
    return;
  }

  const down = (code) => input.keys.has(code);
  // Heading basis on the ground plane: forward and right, from yaw alone.
  const fwd = { x: -Math.sin(p.yaw), z: -Math.cos(p.yaw) };
  const right = { x: Math.cos(p.yaw), z: -Math.sin(p.yaw) };
  let wishX = 0;
  let wishZ = 0;
  if (down('KeyW')) { wishX += fwd.x; wishZ += fwd.z; }
  if (down('KeyS')) { wishX -= fwd.x; wishZ -= fwd.z; }
  if (down('KeyD')) { wishX += right.x; wishZ += right.z; }
  if (down('KeyA')) { wishX -= right.x; wishZ -= right.z; }
  cmd.mx = wishX;
  cmd.mz = wishZ;
  cmd.crouch = down('ControlLeft') || down('KeyC');
  cmd.walk = down('ShiftLeft');
  cmd.jump = down('Space');
  cmd.use = down('KeyE');
  cmd.aim = input.aiming;
  cmd.fire = input.firing;
  if (input.takePressed('KeyR')) cmd.reload = true;

  // Selection keys: 1 and 2 draw the guns, 3 draws a grenade — and 3
  // again, with a grenade already in hand, cycles to the next type held.
  // Q swaps between the two guns.
  if (input.takePressed('Digit1')) selectSlot(S, p, 'primary');
  if (input.takePressed('Digit2')) selectSlot(S, p, 'sidearm');
  if (input.takePressed('Digit3')) {
    if (p.loadout.slot === 'grenade') cycleGrenadeType(p);
    else selectSlot(S, p, 'grenade');
  }
  if (input.takePressed('KeyQ')) {
    selectSlot(S, p, p.loadout.slot === 'primary' ? 'sidearm' : 'primary');
  }
  input.clearPressed();
}

function selectSlot(S, p, slot) {
  if (slot === 'primary' && !p.loadout.primary) return;
  if (slot === 'grenade' && totalGrenades(p.loadout) === 0) return;
  if (p.loadout.slot === slot) return;
  p.loadout.slot = slot;
  const drawn = currentSlot(p.loadout);
  if (drawn) drawn.nextShotAt = Math.max(drawn.nextShotAt, S.time + drawn.def.draw);
  p.switchAt = S.time;
}

function totalGrenades(loadout) {
  return loadout.grenades.frag + loadout.grenades.flash + loadout.grenades.smoke;
}

function cycleGrenadeType(p) {
  let i = GRENADE_ORDER.indexOf(p.loadout.grenadeType);
  for (let step = 0; step < GRENADE_ORDER.length; step += 1) {
    i = (i + 1) % GRENADE_ORDER.length;
    if (p.loadout.grenades[GRENADE_ORDER[i]] > 0) {
      p.loadout.grenadeType = GRENADE_ORDER[i];
      return;
    }
  }
}

// The camera rig. sync runs once per rendered frame (not per step): the
// view is allowed to be smoother than the simulation it watches.
export function createPlayerView(camera) {
  const holder = new THREE.Group();
  holder.position.set(0.24, -0.22, -0.45);
  camera.add(holder);

  let heldModel = null;
  let heldKey = '';
  let recoil = 0; // the part of the kick shown as camera punch, recovering
  let adsBlend = 0; // 0 at the hip, 1 fully down the sights
  let bobClock = 0;
  const HOME_FOV = 74;

  function swapHeldModel(p) {
    const slot = currentSlot(p.loadout);
    const key = p.loadout.slot === 'grenade'
      ? `n:${p.loadout.grenadeType}`
      : slot ? `g:${slot.def.id}` : 'none';
    if (key === heldKey) return;
    heldKey = key;
    if (heldModel) holder.remove(heldModel);
    heldModel = p.loadout.slot === 'grenade'
      ? buildGrenadeModel(p.loadout.grenadeType)
      : slot ? buildViewmodel(slot.def) : null;
    if (heldModel) holder.add(heldModel);
  }

  return {
    holder,
    applyLook(actor, dx, dy) {
      actor.yaw -= dx * 0.0021;
      actor.pitch = Math.max(-1.45, Math.min(1.45, actor.pitch - dy * 0.0021));
    },
    sync(S, dt) {
      const p = S.player;
      // Recoil arrives as a lump in actor.recoilKick: a third of it stays
      // in the aim for good (until the player pulls down), the rest is
      // punch that the camera shrugs off over the next frames.
      if (p.recoilKick) {
        recoil += p.recoilKick * 0.9;
        p.pitch += p.recoilKick * 0.35;
        p.recoilKick = 0;
      }
      recoil *= Math.exp(-8.5 * dt);
      const drop = p.alive ? 0 : 1.1; // a dead player's camera sinks
      camera.position.set(p.pos.x, p.pos.y + eyeHeight(p) - drop, p.pos.z);
      camera.rotation.set(p.pitch + recoil, p.yaw, 0, 'YXZ');

      const slot = currentSlot(p.loadout);
      const wantsAds = p.cmd.aim && p.alive && p.loadout.slot !== 'grenade' && slot;
      adsBlend += ((wantsAds ? 1 : 0) - adsBlend) * Math.min(1, dt * 11);
      const zoom = slot ? slot.def.zoom : 1;
      const fov = HOME_FOV / (1 + (zoom - 1) * adsBlend);
      if (Math.abs(fov - camera.fov) > 0.05) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
      }
      S.scoped = slot ? (slot.def.kind === 'sniper' && adsBlend > 0.65) : false;

      swapHeldModel(p);
      if (!heldModel) return;

      // Pose the held weapon: hip corner, or centred down the sights;
      // a bob that follows the feet; a dip while the reload runs; a
      // rise while a freshly drawn weapon settles.
      bobClock += dt * p.speed2d * 1.7;
      const pace = Math.min(1, p.speed2d / 4);
      const swayX = Math.sin(bobClock) * 0.011 * pace * (1 - adsBlend);
      const swayY = -Math.abs(Math.cos(bobClock)) * 0.009 * pace * (1 - adsBlend);
      holder.position.set(
        0.24 - 0.24 * adsBlend + swayX,
        -0.22 + 0.072 * adsBlend + swayY,
        -0.45 + 0.1 * adsBlend,
      );
      let dip = 0;
      if (slot && slot.reloadEndAt > S.time) {
        const through = 1 - (slot.reloadEndAt - S.time) / slot.def.reload;
        dip = Math.sin(Math.min(1, through) * Math.PI) * 0.5;
      }
      const drawn = Math.min(1, (S.time - (p.switchAt || 0)) / 0.3);
      holder.position.y -= (1 - drawn) * 0.16;
      holder.rotation.set(dip * 0.7, 0, dip * 0.15);
      heldModel.visible = S.scoped !== true;
    },
  };
}
