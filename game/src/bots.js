// bots.js — the nine harbour hands who are not you.
//
// Each bot is an ordinary actor with a brain record bolted on. The brain
// works in three beats: perceive (on a stagger, so nine brains never spike
// the same step), decide (a job from match.js's role assignment, or a fight
// when a target is live), and act (write the same cmd record the human's
// keyboard writes). Nothing here touches damage, speed or spread directly —
// bots shoot through combat.js and walk through actors.js, exactly like
// the player, which is what keeps them honest.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { buildWorldGun } from './weapons.js';
import { throwGrenade, smokeBlocks } from './grenades.js';
import { eyePos } from './actors.js';

export const BOT_NAMES = {
  atk: ['Rook', 'Bex', 'Tarn', 'Odo', 'Mire'],
  def: ['Kip', 'Vess', 'Hale', 'Juno', 'Pell'],
};

const scratchEye = new THREE.Vector3();
const scratchChest = new THREE.Vector3();
const unitBox = new THREE.BoxGeometry(1, 1, 1);

function addLimb(parent, material, x, y, z, sx, sy, sz) {
  const mesh = new THREE.Mesh(unitBox, material);
  mesh.position.set(x, y, z);
  mesh.scale.set(sx, sy, sz);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

// The visible bot: team-coloured work clothes over a dark frame, a helmet,
// and whatever gun the loadout says it carries. Built facing -Z so the
// group's rotation can simply be the actor's yaw. The legs are re-pivoted
// at the hip after placement so the walk cycle swings them naturally.
export function buildBotModel(team, weaponKind) {
  const cloth = new THREE.MeshLambertMaterial({ color: team === 'atk' ? PALETTE.atk : PALETTE.def });
  const darkCloth = new THREE.MeshLambertMaterial({ color: '#33302c' });
  const skinTone = new THREE.MeshLambertMaterial({ color: '#c9a186' });

  const rig = new THREE.Group();
  const legL = addLimb(rig, darkCloth, -0.11, 0.45, 0, 0.17, 0.9, 0.2);
  const legR = addLimb(rig, darkCloth, 0.11, 0.45, 0, 0.17, 0.9, 0.2);
  const torso = addLimb(rig, cloth, 0, 1.15, 0, 0.52, 0.62, 0.3);
  addLimb(rig, darkCloth, 0, 1.32, 0.14, 0.4, 0.34, 0.08);
  const head = addLimb(rig, skinTone, 0, 1.62, 0, 0.26, 0.28, 0.26);
  addLimb(rig, cloth, 0, 1.78, 0, 0.3, 0.1, 0.3);
  const armR = addLimb(rig, cloth, 0.33, 1.22, -0.1, 0.13, 0.5, 0.15);
  armR.rotation.x = -0.9;
  const armL = addLimb(rig, cloth, -0.33, 1.22, -0.05, 0.13, 0.45, 0.15);
  armL.rotation.x = -0.7;

  const gun = buildWorldGun(weaponKind);
  gun.position.set(0.3, 1.28, -0.25);
  rig.add(gun);

  for (const leg of [legL, legR]) {
    leg.position.y = 0.9;
    leg.translateY(-0.45);
  }

  const model = new THREE.Group();
  model.add(rig);
  model.userData = { rig, legL, legR, torso, head, gun, deathAt: 0 };
  return model;
}

// A brain starts knowing its role and nothing else. match.js fills in
// holdNode / holdYaw / crouchHold at every round start; the rest is memory
// the brain accumulates for itself (last sighting, noises heard, and the
// stuck-detector's snapshot of where it stood a moment ago).
export function makeBrain(role) {
  return {
    role,
    state: 'advance',
    destNode: -1,
    wpNode: -1,
    target: null,
    lastSeenAt: -99,
    lastSeenX: 0,
    lastSeenZ: 0,
    reactionAt: 0,
    burstLeft: 0,
    nextBurstAt: 0,
    nextPerceiveAt: 0,
    nextThinkAt: 0,
    holdYaw: 0,
    scanPhase: Math.random() * 6,
    strafeDir: 1,
    strafeUntil: 0,
    skill: 0.85 + Math.random() * 0.35,
    threwGrenade: false,
    investigateX: 0,
    investigateZ: 0,
    hasInvestigate: false,
    lastNoiseAt: 0,
    heardAt: -99,
    stuckT: undefined,
    stuckX: 0,
    stuckZ: 0,
  };
}

function wrapAngle(a) {
  let r = a;
  while (r > Math.PI) r -= Math.PI * 2;
  while (r < -Math.PI) r += Math.PI * 2;
  return r;
}

function bearingTo(from, x, z) {
  return Math.atan2(-(x - from.pos.x), -(z - from.pos.z));
}

// Rotate yaw/pitch toward a wish at a capped rate; returns the total
// angular error left over, which the fire control reads as "aimed yet?".
function steer(bot, wishYaw, wishPitch, rate, dt) {
  const dyaw = wrapAngle(wishYaw - bot.yaw);
  const dpitch = wishPitch - bot.pitch;
  const cap = rate * dt;
  bot.yaw += Math.max(-cap, Math.min(cap, dyaw));
  bot.pitch += Math.max(-cap, Math.min(cap, dpitch));
  return Math.abs(dyaw) + Math.abs(dpitch);
}

function dist2d(a, b) {
  return Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);
}

// Vision test: in range, inside the facing cone (waived at point blank,
// where peripheral awareness takes over), an unobstructed map ray from eye
// to chest, and no smoke bank in the way. A flashed bot sees nothing.
function visionClear(S, bot, other) {
  if (S.time < bot.blindUntil) return false;
  const dx = other.pos.x - bot.pos.x;
  const dz = other.pos.z - bot.pos.z;
  const range = Math.hypot(dx, dz);
  if (range > 58) return false;
  if (range > 5) {
    const facingDot = (dx * -Math.sin(bot.yaw) + dz * -Math.cos(bot.yaw)) / (range || 1);
    if (facingDot < 0.42) return false;
  }
  eyePos(bot, scratchEye);
  scratchChest.set(other.pos.x, other.pos.y + 1.15, other.pos.z);
  if (!S.map.los(scratchEye.x, scratchEye.y, scratchEye.z, scratchChest.x, scratchChest.y, scratchChest.z)) return false;
  return !smokeBlocks(S, scratchEye.x, scratchEye.y, scratchEye.z, scratchChest.x, scratchChest.y, scratchChest.z);
}

// One perception beat. Sight first: the nearest visible enemy becomes the
// target and refreshes the last-seen memory. Losing sight for a while
// demotes the memory to an investigation point. Hearing and the sting of
// being shot feed the same investigation slot when nothing is visible.
function perceive(S, bot) {
  const brain = bot.brain;
  let seen = null;
  let seenDist = Infinity;
  for (const other of S.actors) {
    if (!other.alive || other.team === bot.team) continue;
    if (!visionClear(S, bot, other)) continue;
    const d = dist2d(bot, other);
    if (d < seenDist) { seenDist = d; seen = other; }
  }
  if (seen) {
    if (brain.target !== seen) {
      brain.reactionAt = S.time + 0.34 / brain.skill + S.rng.range(0, 0.14);
    }
    brain.target = seen;
    brain.lastSeenAt = S.time;
    brain.lastSeenX = seen.pos.x;
    brain.lastSeenZ = seen.pos.z;
    brain.hasInvestigate = false;
    return;
  }
  if (brain.target && S.time - brain.lastSeenAt > 2.2) {
    brain.investigateX = brain.lastSeenX;
    brain.investigateZ = brain.lastSeenZ;
    brain.hasInvestigate = true;
    brain.target = null;
  }
  for (const n of S.noise) {
    if (n.team === bot.team || n.at <= brain.lastNoiseAt) continue;
    if (Math.hypot(n.x - bot.pos.x, n.z - bot.pos.z) < n.r) {
      brain.investigateX = n.x;
      brain.investigateZ = n.z;
      brain.hasInvestigate = true;
      brain.heardAt = S.time;
      brain.lastNoiseAt = n.at;
    }
  }
  if (bot.lastHurtBy && S.time - bot.lastHurtAt < 0.4) {
    brain.investigateX = bot.lastHurtBy.pos.x;
    brain.investigateZ = bot.lastHurtBy.pos.z;
    brain.hasInvestigate = true;
  }
}

function aimAtNode(S, bot, nodeIdx) {
  const brain = bot.brain;
  if (brain.destNode === nodeIdx && brain.wpNode !== -1) return;
  brain.destNode = nodeIdx;
  brain.wpNode = S.map.nextHop[S.map.nearestNode(bot.pos.x, bot.pos.z)][nodeIdx];
}

// Walk the waypoint graph toward the brain's destination. Returns true
// when the bot is standing at the destination (or no route exists — better
// to hold still than to wander). A waypoint occasionally sits inside a
// crate's collision margin: visible, close, never quite reachable. The
// stuck watch notices a bot that has barely moved for 0.7 s while trying
// and counts the hop as done.
function walkRoute(S, bot, speed = 1) {
  const brain = bot.brain;
  const stop = () => { bot.cmd.mx = 0; bot.cmd.mz = 0; return true; };
  if (brain.destNode < 0) return true;
  const destNode = S.map.nodes[brain.destNode];
  if (brain.wpNode === brain.destNode && Math.hypot(destNode.x - bot.pos.x, destNode.z - bot.pos.z) < 1.0) return stop();
  if (brain.wpNode < 0 || brain.wpNode === undefined) {
    brain.wpNode = S.map.nextHop[S.map.nearestNode(bot.pos.x, bot.pos.z)][brain.destNode];
  }
  if (brain.wpNode < 0) return stop();

  if (brain.stuckT === undefined) {
    brain.stuckT = S.time;
    brain.stuckX = bot.pos.x;
    brain.stuckZ = bot.pos.z;
  } else if (S.time - brain.stuckT > 0.7) {
    const drift = Math.hypot(bot.pos.x - brain.stuckX, bot.pos.z - brain.stuckZ);
    brain.stuckT = S.time;
    brain.stuckX = bot.pos.x;
    brain.stuckZ = bot.pos.z;
    if (drift < 0.35) {
      if (brain.wpNode === brain.destNode) return stop();
      brain.wpNode = S.map.nextHop[brain.wpNode][brain.destNode];
    }
  }

  let wp = S.map.nodes[brain.wpNode];
  if (Math.hypot(wp.x - bot.pos.x, wp.z - bot.pos.z) < 1.05) {
    brain.wpNode = S.map.nextHop[S.map.nearestNode(bot.pos.x, bot.pos.z)][brain.destNode];
    wp = S.map.nodes[brain.wpNode];
    if (brain.wpNode === brain.destNode && Math.hypot(wp.x - bot.pos.x, wp.z - bot.pos.z) < 1.0) return stop();
  }
  const dx = wp.x - bot.pos.x;
  const dz = wp.z - bot.pos.z;
  const len = Math.hypot(dx, dz) || 1;
  bot.cmd.mx = (dx / len) * speed;
  bot.cmd.mz = (dz / len) * speed;
  steer(bot, Math.atan2(-dx, -dz), 0, 4.2, S.dt);
  return false;
}

// Fight the current target. Manners borrowed from tactical shooters: close
// the distance when it is too far for the gun to matter, back off when
// crowded, strafe in pulses between those, and stand still for the moment
// a burst actually leaves the barrel. Aim error shrinks the longer the
// target has been tracked and is worse on the move.
function fightTarget(S, bot) {
  const brain = bot.brain;
  const foe = brain.target;
  const dx = foe.pos.x - bot.pos.x;
  const dz = foe.pos.z - bot.pos.z;
  const range = Math.hypot(dx, dz);

  const trackedFor = Math.min(1, (S.time - brain.reactionAt + 0.4) * 1.4);
  let wobble = (1 - trackedFor * 0.7) * 0.034 / brain.skill;
  if (bot.speed2d > 0.5) wobble += 0.014;
  const wishYaw = Math.atan2(-dx, -dz) + Math.sin(S.time * 2.1 + bot.id * 7) * wobble;
  const chestHeight = foe.pos.y + (foe.crouchAmt > 0.5 ? 0.95 : 1.28);
  const wishPitch = Math.atan2(chestHeight - (bot.pos.y + 1.55), range) + Math.cos(S.time * 1.7 + bot.id) * wobble * 0.5;
  const aimError = steer(bot, wishYaw, wishPitch, 3.4, S.dt);

  const burstFiring = S.time < brain.nextBurstAt + 0.12 && brain.burstLeft > 0;
  bot.cmd.mx = 0;
  bot.cmd.mz = 0;
  if (range > 15) {
    bot.cmd.mx = dx / range;
    bot.cmd.mz = dz / range;
  } else if (!burstFiring) {
    if (range < 6) {
      bot.cmd.mx = (-dx / range) * 0.7;
      bot.cmd.mz = (-dz / range) * 0.7;
    } else {
      if (S.time > brain.strafeUntil) {
        brain.strafeDir = S.rng.chance(0.5) ? 1 : -1;
        brain.strafeUntil = S.time + S.rng.range(0.4, 0.9);
      }
      bot.cmd.mx = (-dz / range) * brain.strafeDir * 0.8;
      bot.cmd.mz = (dx / range) * brain.strafeDir * 0.8;
    }
  }
  bot.cmd.crouch = range > 20 && S.rng.chance(0.002);

  bot.cmd.fire = false;
  if (S.time >= brain.reactionAt && aimError < 0.09) {
    if (brain.burstLeft > 0) {
      bot.cmd.fire = true;
      brain.burstLeft -= S.dt * 12;
    } else if (S.time >= brain.nextBurstAt) {
      const held = bot.loadout.slot === 'primary' ? bot.loadout.primary : bot.loadout.sidearm;
      brain.burstLeft = held && held.def.auto ? S.rng.int(2, 5) : 1;
      brain.nextBurstAt = S.time + S.rng.range(0.3, 0.55) / brain.skill;
      bot.cmd.fire = true;
    }
  }

  // A target gone to ground behind cover earns a frag, once per round.
  const unseenFor = S.time - brain.lastSeenAt;
  if (!brain.threwGrenade && bot.loadout.grenades.frag > 0 && unseenFor > 0.8 && range < 19 && S.rng.chance(0.01)) {
    brain.threwGrenade = true;
    bot.loadout.slot = 'grenade';
    bot.loadout.grenadeType = 'frag';
    bot.pitch = 0.42;
    throwGrenade(S, bot);
    bot.loadout.slot = bot.loadout.primary ? 'primary' : 'sidearm';
  }
}

const SITE_CENTRES = { A: { x: 24, z: -15 }, B: { x: 24, z: 15 } };

// After the plant the round narrows to one patch of ground: defenders
// converge on the device and the closest pair of hands works it while the
// rest watch the angles; attackers settle onto their cover nodes.
function jobAfterPlant(S, bot) {
  const brain = bot.brain;
  const centre = SITE_CENTRES[S.bomb.site];
  if (bot.team === 'atk') {
    aimAtNode(S, bot, brain.holdNode >= 0 ? brain.holdNode : S.map.nearestNode(centre.x, centre.z));
    if (walkRoute(S, bot, 0.9)) {
      steer(bot, brain.holdYaw + Math.sin(S.time * 0.4 + bot.id * 3) * 0.7, 0, 2, S.dt);
    }
    return;
  }
  aimAtNode(S, bot, S.map.nearestNode(centre.x, centre.z));
  const arrived = walkRoute(S, bot, 1);
  if (!arrived && Math.hypot(centre.x - bot.pos.x, centre.z - bot.pos.z) >= 3.4) return;
  bot.cmd.mx = 0;
  bot.cmd.mz = 0;
  let closest = null;
  let closestDist = Infinity;
  for (const mate of S.actors) {
    if (!mate.alive || mate.team !== 'def') continue;
    const d = Math.hypot(mate.pos.x - centre.x, mate.pos.z - centre.z);
    if (d < closestDist) { closestDist = d; closest = mate; }
  }
  if (closest === bot) {
    bot.cmd.use = true;
    steer(bot, bearingTo(bot, centre.x, centre.z), -0.4, 4, S.dt);
  } else {
    steer(bot, brain.holdYaw + Math.sin(S.time * 0.5 + bot.id) * 0.6, 0, 2, S.dt);
  }
}

// The standing jobs. Roles arrive from match.js at round start along with
// the team's called site; the situation (charge carried, dropped, hunted)
// outranks the role whenever it applies.
function doJob(S, bot) {
  const brain = bot.brain;
  const cmd = bot.cmd;
  cmd.fire = false;
  cmd.use = false;

  if (S.bomb.state === 'planted') { jobAfterPlant(S, bot); return; }

  if (bot.hasCharge) {
    const centre = SITE_CENTRES[S.plan.site];
    aimAtNode(S, bot, S.map.nearestNode(centre.x, centre.z));
    if (walkRoute(S, bot, 1)) {
      cmd.use = true;
      steer(bot, bearingTo(bot, centre.x, centre.z), -0.5, 4, S.dt);
    }
    return;
  }

  if (S.bomb.state === 'dropped' && bot.team === 'atk') {
    aimAtNode(S, bot, S.map.nearestNode(S.bomb.x, S.bomb.z));
    walkRoute(S, bot, 1);
    return;
  }

  const scanFromHold = (speed, sway, rate) => {
    aimAtNode(S, bot, brain.holdNode);
    if (walkRoute(S, bot, speed)) {
      steer(bot, brain.holdYaw + Math.sin(S.time * 0.4 + brain.scanPhase) * sway, 0, rate, S.dt);
    }
  };

  switch (brain.role) {
    case 'anchor': {
      // The charge hunt: match.js flags a carrier who has sat still too
      // long, and while that fix is fresh the anchors abandon their angles
      // and converge on it. The round then resolves as a fight at the
      // carrier instead of expiring on the clock.
      if (S.hunt && S.hunt.active && S.time - S.hunt.at < 5) {
        aimAtNode(S, bot, S.map.nearestNode(S.hunt.x, S.hunt.z));
        walkRoute(S, bot, 1);
        break;
      }
      aimAtNode(S, bot, brain.holdNode);
      if (walkRoute(S, bot, 0.95)) {
        cmd.crouch = brain.crouchHold;
        steer(bot, brain.holdYaw + Math.sin(S.time * 0.45 + brain.scanPhase) * 0.55, 0, 1.8, S.dt);
      }
      break;
    }
    case 'rotate': {
      const info = S.teamInfo[bot.team];
      if (info && S.time - info.at < 6) {
        aimAtNode(S, bot, S.map.nearestNode(info.x, info.z));
        walkRoute(S, bot, 1);
      } else {
        scanFromHold(0.9, 0.8, 1.8);
      }
      break;
    }
    case 'rush':
      scanFromHold(1, 0.7, 1.8);
      break;
    case 'escort': {
      const carrier = S.actors.find((a) => a.alive && a.hasCharge);
      if (carrier && carrier !== bot && dist2d(bot, carrier) > 7) {
        aimAtNode(S, bot, S.map.nearestNode(carrier.pos.x, carrier.pos.z));
        walkRoute(S, bot, 1);
      } else if (carrier && carrier !== bot) {
        cmd.mx = 0;
        cmd.mz = 0;
        steer(bot, brain.holdYaw + Math.sin(S.time * 0.5 + brain.scanPhase) * 0.9, 0, 1.8, S.dt);
      } else {
        aimAtNode(S, bot, brain.holdNode);
        walkRoute(S, bot, 1);
      }
      break;
    }
    default:
      aimAtNode(S, bot, brain.holdNode);
      walkRoute(S, bot, 0.9);
  }

  // A fresh noise is worth a glance even in the middle of a job.
  if (brain.hasInvestigate && S.time - brain.heardAt < 3) {
    steer(bot, bearingTo(bot, brain.investigateX, brain.investigateZ), 0, 2.4, S.dt);
  }
}

// One think pass over every bot. Commands are zeroed first so a bot never
// repeats yesterday's orders; outside the live phases bots simply stand.
// A carrier with a distant target ignores it and keeps pushing the charge
// — the objective outranks a long-range duel it would probably lose.
export function thinkBots(S, dt) {
  void dt;
  for (const bot of S.actors) {
    if (bot.isPlayer || !bot.alive) continue;
    const brain = bot.brain;
    const cmd = bot.cmd;
    cmd.mx = 0;
    cmd.mz = 0;
    cmd.fire = false;
    cmd.use = false;
    cmd.jump = false;
    if (S.phase !== 'live' && S.phase !== 'planted') continue;

    if (S.time >= brain.nextPerceiveAt) {
      brain.nextPerceiveAt = S.time + 0.12;
      perceive(S, bot);
    }
    if (S.time < bot.blindUntil) {
      cmd.crouch = true;
      continue;
    }

    const targetFar = brain.target
      ? Math.hypot(brain.target.pos.x - bot.pos.x, brain.target.pos.z - bot.pos.z)
      : 0;
    const carrierPushing = bot.hasCharge && brain.target && targetFar > 12;
    const targetLive = brain.target && brain.target.alive && S.time - brain.lastSeenAt < 0.35;
    if (targetLive && !carrierPushing) {
      fightTarget(S, bot);
    } else {
      if (!carrierPushing) brain.target = null;
      doJob(S, bot);
    }

    // Standing in the site with the charge means plant, whatever else the
    // brain was doing — the channel only needs a held key and a still body.
    if (bot.hasCharge && S.phase === 'live' && S.map.siteAt(bot.pos.x, bot.pos.z)) {
      cmd.mx = 0;
      cmd.mz = 0;
      cmd.use = true;
    }

    const held = bot.loadout.slot === 'primary' ? bot.loadout.primary : bot.loadout.sidearm;
    cmd.reload = Boolean(held && held.mag === 0);
  }
}

// Pose a bot's model for the renderer: position and yaw from the actor,
// legs swinging with the step cycle, a crouch dip, and the slow topple
// after death. Render-side only — reads state, never writes it.
export function syncBotModel(bot, now) {
  const model = bot.model;
  if (!model) return;
  const parts = model.userData;
  model.position.copy(bot.pos);
  model.rotation.y = bot.yaw;
  if (!bot.alive) {
    if (!parts.deathAt) parts.deathAt = now;
    const fallen = Math.min(1, (now - parts.deathAt) / 0.4);
    parts.rig.rotation.x = (-Math.PI / 2) * fallen;
    parts.rig.position.y = -0.34 * bot.crouchAmt + 0.1 * fallen;
    parts.legL.rotation.x = 0.2;
    parts.legR.rotation.x = -0.15;
    return;
  }
  parts.deathAt = 0;
  const swing = Math.sin(bot.stepPhase * Math.PI) * 0.5 * Math.min(1, bot.speed2d / 3);
  parts.legL.rotation.x = swing;
  parts.legR.rotation.x = -swing;
  parts.rig.position.y = -0.34 * bot.crouchAmt;
  parts.rig.rotation.x = 0;
}
