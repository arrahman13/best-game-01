// match.js — the referee. Every rule of the contest lives here and nowhere
// else: the phase clock (buy, live, planted, round over, match over), the
// money, the breach charge from a carrier's back to a smoking crater, who
// stands where when a round begins, and how a round is won. Controllers
// (player.js, bots.js) only write commands; combat.js only reports events;
// this module reads both and decides what they mean.
import * as THREE from 'three';
import { SPAWNS } from './map.js';
import { makeActor } from './actors.js';
import { WEAPONS, GRENADES, ARMOR_PRICE, refill, buildWorldGun } from './weapons.js';
import { makeBrain, buildBotModel, BOT_NAMES } from './bots.js';

export const BUY_TIME = 12;
export const ROUND_TIME = 100;
export const CHARGE_TIME = 35;
export const PLANT_TIME = 3;
export const DEFUSE_TIME = 5;
export const WIN_SCORE = 7;
export const MAX_ROUNDS = 12;

const PURSE_CAP = 10000;
const KILL_PAY = 300;
const PLANT_PAY = 300;
const WIN_PAY = 2400;
const LOSS_PAY = 1900;
const ROUND_END_PAUSE = 4.5;

// Where each defending anchor watches from its post: node index → the
// ground point its eyes rest on between scans.
const POST_WATCH = { 12: [6, -13], 27: [14, -4], 19: [6, 13], 28: [14, 4], 14: [-12, 0], 10: [-6, -15], 18: [-6, 15] };
// The first attacker bot shepherds the carrier from one of these nodes;
// the rest of the push stages on the others.
const PLAN_NODES = { A: [10, 27, 9], B: [18, 28, 16] };
// After a plant, surviving attackers fan out over these cover nodes.
const COVER_NODES = { A: [27, 30, 10], B: [28, 31, 18] };
// Defender posts in assignment order: two per site, then the rotator.
const DEF_POSTS = [12, 27, 19, 28];

export function createState(scene, map, rng, camera) {
  const S = {
    scene, map, rng, camera,
    time: 0,
    dt: 0,
    phase: 'menu',
    timeLeft: 0,
    round: 0,
    scoreAtk: 0,
    scoreDef: 0,
    actors: [],
    player: null,
    events: [],
    noise: [],
    grenades: [],
    smokes: [],
    bomb: null,
    plan: { site: 'A' },
    teamInfo: { atk: null, def: null },
    hunt: { active: false, at: 0, x: 0, z: 0, idleSince: 0, lastX: 0, lastZ: 0, sampleAt: 0, pingAt: 0 },
    channel: null,
    lastRound: null,
    matchWinner: null,
    scoped: false,
    shake: 0,
  };
  return S;
}

// The charge's two physical forms: the pack on a carrier's back (or lying
// dropped) and the planted device with its tell-tale lamp.
function buildChargeMeshes(scene) {
  const pack = new THREE.Group();
  const packBody = new THREE.Mesh(
    new THREE.BoxGeometry(0.44, 0.3, 0.34),
    new THREE.MeshLambertMaterial({ color: '#3a3f45' }),
  );
  const packStripe = new THREE.Mesh(
    new THREE.BoxGeometry(0.46, 0.1, 0.36),
    new THREE.MeshLambertMaterial({ color: 0xf2a33c }),
  );
  pack.add(packBody, packStripe);
  pack.visible = false;
  scene.add(pack);

  const lampMaterial = new THREE.MeshBasicMaterial({ color: 0xff4444 });
  const device = new THREE.Group();
  const deviceBody = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.22, 0.38),
    new THREE.MeshLambertMaterial({ color: '#2c2f33' }),
  );
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), lampMaterial);
  lamp.position.set(0.15, 0.15, 0);
  device.add(deviceBody, lamp);
  device.visible = false;
  scene.add(device);

  return { pack, device, lampMaterial };
}

export function setupMatch(S) {
  const meshes = buildChargeMeshes(S.scene);
  S.bomb = {
    state: 'carried',
    carrier: null,
    x: 0,
    z: 0,
    site: null,
    timer: 0,
    packMesh: meshes.pack,
    deviceMesh: meshes.device,
    lightMat: meshes.lampMaterial,
    beepAt: 0,
    dropAt(pos) {
      this.state = 'dropped';
      this.x = pos.x;
      this.z = pos.z;
      this.carrier = null;
    },
  };

  S.player = makeActor('You', 'atk', true);
  S.actors.push(S.player);
  for (let i = 0; i < 4; i += 1) S.actors.push(makeActor(BOT_NAMES.atk[i], 'atk', false));
  for (let i = 0; i < 5; i += 1) S.actors.push(makeActor(BOT_NAMES.def[i], 'def', false));

  for (const actor of S.actors) {
    actor.kills = 0;
    actor.deaths = 0;
    if (actor.isPlayer) continue;
    actor.brain = makeBrain('anchor');
    actor.model = buildBotModel(actor.team, 'pistol');
    S.scene.add(actor.model);
  }
}

export function startMatch(S) {
  S.scoreAtk = 0;
  S.scoreDef = 0;
  S.round = 0;
  S.matchWinner = null;
  for (const actor of S.actors) {
    actor.money = 800;
    actor.kills = 0;
    actor.deaths = 0;
    actor.loadout.primary = null;
    actor.loadout.armor = false;
    actor.loadout.helmet = false;
    actor.loadout.grenades = { frag: 0, flash: 0, smoke: 0 };
  }
  startRound(S);
}

// Yaw that faces from one ground point toward another, in the engine's
// convention (yaw 0 looks down -Z, growing yaw turns toward -X).
function headingBetween(fromX, fromZ, toX, toZ) {
  return Math.atan2(-(toX - fromX), -(toZ - fromZ));
}

function placeAtSpawn(S, actor, spot) {
  const [x, z] = spot;
  actor.pos.set(x, 0, z);
  actor.yaw = headingBetween(x, z, 0, 0);
}

function resetForRound(S, actor) {
  actor.alive = true;
  actor.health = 100;
  actor.vel.set(0, 0, 0);
  actor.pitch = 0;
  actor.bloom = 0;
  actor.blindUntil = 0;
  actor.hasCharge = false;
  if (actor.diedLastRound) {
    actor.loadout.primary = null;
    actor.loadout.armor = false;
    actor.loadout.helmet = false;
  }
  actor.diedLastRound = false;
  refill(actor.loadout);
  actor.loadout.slot = actor.loadout.primary ? 'primary' : 'sidearm';
  if (actor.model) {
    actor.model.visible = true;
    actor.model.userData.deathAt = 0;
  }
}

export function startRound(S) {
  S.round += 1;
  S.plan.site = S.rng.chance(0.52) ? 'A' : 'B';
  S.teamInfo.atk = null;
  S.teamInfo.def = null;
  Object.assign(S.hunt, { active: false, at: 0, idleSince: 0, sampleAt: 0, pingAt: 0 });
  S.channel = null;

  S.bomb.state = 'carried';
  S.bomb.site = null;
  S.bomb.timer = 0;
  S.bomb.packMesh.visible = false;
  S.bomb.deviceMesh.visible = false;
  for (const leftover of S.grenades) S.scene.remove(leftover.mesh);
  S.grenades.length = 0;
  for (const cloud of S.smokes) S.scene.remove(cloud.group);
  S.smokes.length = 0;

  const planNodes = PLAN_NODES[S.plan.site];
  let atkSeen = 0;
  let defSeen = 0;
  for (const actor of S.actors) {
    resetForRound(S, actor);
    if (actor.isPlayer) {
      placeAtSpawn(S, actor, SPAWNS.atk[0]);
      actor.hasCharge = true;
      S.bomb.carrier = actor;
      continue;
    }
    const brain = actor.brain;
    brain.threwGrenade = false;
    brain.target = null;
    if (actor.team === 'atk') {
      atkSeen += 1;
      placeAtSpawn(S, actor, SPAWNS.atk[atkSeen]);
      if (atkSeen === 1) {
        brain.role = 'escort';
        brain.holdNode = planNodes[0];
      } else {
        brain.role = 'rush';
        brain.holdNode = planNodes[(atkSeen - 2) % planNodes.length];
      }
      const node = S.map.nodes[brain.holdNode];
      brain.holdYaw = headingBetween(node.x, node.z, 30, S.plan.site === 'A' ? -15 : 15);
    } else {
      placeAtSpawn(S, actor, SPAWNS.def[defSeen]);
      defSeen += 1;
      if (defSeen <= 4) {
        brain.role = 'anchor';
        brain.holdNode = DEF_POSTS[defSeen - 1];
        brain.crouchHold = defSeen % 2 === 0;
      } else {
        brain.role = 'rotate';
        brain.holdNode = 14;
        brain.crouchHold = false;
      }
      const node = S.map.nodes[brain.holdNode];
      const watch = POST_WATCH[brain.holdNode] || [0, 0];
      brain.holdYaw = headingBetween(node.x, node.z, watch[0], watch[1]);
    }
    botBuy(S, actor);
    refreshBotGun(actor);
  }

  // The hunt sampler starts the round measuring drift from where the
  // carrier actually stands, not from wherever last round's carrier died.
  if (S.bomb.carrier) {
    S.hunt.lastX = S.bomb.carrier.pos.x;
    S.hunt.lastZ = S.bomb.carrier.pos.z;
  }

  S.phase = 'buy';
  S.timeLeft = BUY_TIME;
  S.events.push({ type: 'roundStart', round: S.round });
}

// A bot's shopping, in one ladder: a long gun first (keeping any it
// survived with), armour with what remains, a grenade with the change.
function botBuy(S, actor) {
  const purse = actor.money;
  if (!actor.loadout.primary) {
    if (purse >= WEAPONS.rifle.price + ARMOR_PRICE) buyItem(S, actor, 'rifle');
    else if (purse >= WEAPONS.rifle.price && S.rng.chance(0.6)) buyItem(S, actor, 'rifle');
    else if (purse >= WEAPONS.smg.price) buyItem(S, actor, S.rng.chance(0.7) ? 'smg' : 'shotgun');
  }
  if (!actor.loadout.armor && actor.money >= ARMOR_PRICE) buyItem(S, actor, 'armor');
  if (actor.money >= 300 && S.rng.chance(0.45)) buyItem(S, actor, 'frag');
  else if (actor.money >= 200 && S.rng.chance(0.2)) buyItem(S, actor, 'flash');
}

// Keep the model in a bot's hands the gun its loadout actually holds.
function refreshBotGun(actor) {
  if (!actor.model) return;
  const kind = actor.loadout.primary ? actor.loadout.primary.def.kind : 'pistol';
  const current = actor.model.userData.gun;
  if (current && current.userData.kind === kind) return;
  if (current) actor.model.userData.rig.remove(current);
  const gun = buildWorldGun(kind);
  gun.userData.kind = kind;
  gun.position.set(0.3, 1.28, -0.25);
  actor.model.userData.rig.add(gun);
  actor.model.userData.gun = gun;
}

// One purchase against the shop rules. Returns whether anything changed
// hands; a refusal (too poor, already owned, caps reached) costs nothing.
export function buyItem(S, actor, id) {
  const loadout = actor.loadout;
  const charge = (price) => {
    if (actor.money < price) return false;
    actor.money -= price;
    return true;
  };

  const weapon = WEAPONS[id];
  if (weapon && id !== 'pistol') {
    if (loadout.primary && loadout.primary.def.id === id) return false;
    if (!charge(weapon.price)) return false;
    loadout.primary = {
      def: weapon, mag: weapon.mag, reserve: weapon.reserve,
      nextShotAt: 0, reloadEndAt: 0, boltUntil: 0,
    };
    return true;
  }
  if (id === 'armor') {
    if (loadout.armor) return false;
    if (!charge(ARMOR_PRICE)) return false;
    loadout.armor = true;
    loadout.helmet = true;
    return true;
  }
  const grenade = GRENADES[id];
  if (grenade) {
    const carried = loadout.grenades.frag + loadout.grenades.flash + loadout.grenades.smoke;
    if (loadout.grenades[id] >= 2 || carried >= 4) return false;
    if (!charge(grenade.price)) return false;
    loadout.grenades[id] += 1;
    return true;
  }
  return false;
}

// Who is working a channel right now? A carrier standing in a site during
// the live phase plants; a defender within arm's reach of a planted charge
// defuses. The channel needs a held use key and a near-still body, and it
// breaks the moment either stops being true.
function channelCandidate(S) {
  if (S.phase !== 'live' && S.phase !== 'planted') return null;
  for (const actor of S.actors) {
    if (!actor.alive || !actor.cmd.use || actor.speed2d > 0.6) continue;
    if (S.phase === 'live' && actor.hasCharge && actor.team === 'atk') {
      const site = S.map.siteAt(actor.pos.x, actor.pos.z);
      if (site) return { actor, kind: 'plant', need: PLANT_TIME, site };
    }
    if (S.phase === 'planted' && actor.team === 'def') {
      const gap = Math.hypot(actor.pos.x - S.bomb.x, actor.pos.z - S.bomb.z);
      if (gap < 2.3) return { actor, kind: 'defuse', need: DEFUSE_TIME, site: undefined };
    }
  }
  return null;
}

export function tickChannels(S) {
  const candidate = channelCandidate(S);
  if (!candidate) {
    S.channel = null;
    return;
  }
  const continuing = S.channel && S.channel.actor === candidate.actor && S.channel.kind === candidate.kind;
  if (continuing) {
    S.channel.progress += S.dt;
  } else {
    S.channel = {
      actor: candidate.actor, kind: candidate.kind, need: candidate.need,
      site: candidate.site, progress: 0,
    };
    S.events.push({ type: candidate.kind === 'plant' ? 'plantStart' : 'defuseStart', actor: candidate.actor });
  }
  if (S.channel.progress < S.channel.need) return;
  const finished = S.channel;
  S.channel = null;
  if (finished.kind === 'plant') plantCharge(S, finished.actor, finished.site);
  else endRound(S, 'def', 'defused');
}

function plantCharge(S, actor, site) {
  actor.hasCharge = false;
  S.bomb.state = 'planted';
  S.bomb.site = site;
  S.bomb.x = actor.pos.x;
  S.bomb.z = actor.pos.z;
  S.bomb.carrier = null;
  S.bomb.timer = CHARGE_TIME;
  S.bomb.beepAt = CHARGE_TIME;
  S.phase = 'planted';
  S.bomb.deviceMesh.visible = true;
  S.bomb.deviceMesh.position.set(actor.pos.x, actor.pos.y + 0.11, actor.pos.z);
  S.bomb.packMesh.visible = false;

  const payTeam = (team, amount) => {
    for (const a of S.actors) {
      if (a.team === team) a.money = Math.min(PURSE_CAP, a.money + amount);
    }
  };
  actor.money = Math.min(PURSE_CAP, actor.money + PLANT_PAY);
  payTeam('atk', PLANT_PAY);
  S.teamInfo.def = { x: actor.pos.x, z: actor.pos.z, at: S.time };

  const cover = COVER_NODES[site];
  let slot = 0;
  for (const a of S.actors) {
    if (a.isPlayer || a.team !== 'atk' || !a.alive) continue;
    a.brain.holdNode = cover[slot % cover.length];
    slot += 1;
  }
  S.events.push({ type: 'planted', site, x: actor.pos.x, z: actor.pos.z });
}

export function endRound(S, winner, reason) {
  if (S.phase === 'roundover' || S.phase === 'matchover') return;
  S.phase = 'roundover';
  S.timeLeft = ROUND_END_PAUSE;
  S.channel = null;
  if (winner === 'atk') S.scoreAtk += 1;
  else S.scoreDef += 1;
  for (const actor of S.actors) {
    if (!actor.alive) actor.diedLastRound = true;
    const pay = actor.team === winner ? WIN_PAY : LOSS_PAY;
    actor.money = Math.min(PURSE_CAP, actor.money + pay);
  }
  S.lastRound = { winner, reason };
  S.events.push({ type: 'roundEnd', winner, reason });
  if (S.scoreAtk >= WIN_SCORE || S.scoreDef >= WIN_SCORE || S.round >= MAX_ROUNDS) {
    S.matchWinner = S.scoreAtk === S.scoreDef ? 'draw' : (S.scoreAtk > S.scoreDef ? 'atk' : 'def');
  }
}

// Settle the step's events into money and information: a kill pays its
// maker, and a team that takes fire learns where the fire came from.
export function handleEvents(S) {
  for (const ev of S.events) {
    if (ev.type === 'kill') {
      if (ev.attacker && ev.attacker.team !== ev.victim.team) {
        ev.attacker.money = Math.min(PURSE_CAP, ev.attacker.money + KILL_PAY);
        ev.attacker.kills += 1;
      }
      ev.victim.deaths += 1;
      if (ev.attacker) {
        S.teamInfo[ev.victim.team] = { x: ev.attacker.pos.x, z: ev.attacker.pos.z, at: S.time };
      }
    } else if (ev.type === 'damage' && ev.attacker) {
      S.teamInfo[ev.victim.team] = { x: ev.attacker.pos.x, z: ev.attacker.pos.z, at: S.time };
    }
  }
}

// --- the charge hunt ---------------------------------------------------------
// Nothing in the round rules forces a passive carrier to move, so a holder
// who finds a quiet corner can stall the whole contest to the clock. The
// hunt answers with pressure instead of a rule change: once the carrier
// has barely stirred for HUNT_IDLE seconds, the Wardens receive a live fix
// on the charge, refreshed every HUNT_PING seconds, and their anchors
// converge on it (bots.js answers the flag). The stall ends in a fight at
// the carrier, a dropped charge someone pushes, or a plant under duress.
const HUNT_IDLE = 10;
const HUNT_PING = 4;
const HUNT_SAMPLE = 1;
const HUNT_STILL_RADIUS = 1.5;

function tickHunt(S) {
  const hunt = S.hunt;
  const carrier = S.bomb.carrier;
  const huntable = S.phase === 'live' && S.bomb.state === 'carried' && carrier && carrier.alive;
  if (!huntable) {
    hunt.active = false;
    hunt.idleSince = 0;
    hunt.sampleAt = 0;
    return;
  }
  if (S.time >= hunt.sampleAt) {
    const drift = Math.hypot(carrier.pos.x - hunt.lastX, carrier.pos.z - hunt.lastZ);
    if (drift < HUNT_STILL_RADIUS) {
      if (!hunt.idleSince) hunt.idleSince = S.time;
    } else {
      hunt.idleSince = 0;
      hunt.active = false;
    }
    hunt.lastX = carrier.pos.x;
    hunt.lastZ = carrier.pos.z;
    hunt.sampleAt = S.time + HUNT_SAMPLE;
  }
  if (!hunt.idleSince || S.time - hunt.idleSince < HUNT_IDLE) return;
  if (!hunt.active) {
    hunt.active = true;
    S.events.push({ type: 'hunt', x: carrier.pos.x, z: carrier.pos.z });
  }
  if (S.time >= hunt.pingAt) {
    hunt.at = S.time;
    hunt.x = carrier.pos.x;
    hunt.z = carrier.pos.z;
    S.teamInfo.def = { x: carrier.pos.x, z: carrier.pos.z, at: S.time };
    hunt.pingAt = S.time + HUNT_PING;
  }
}

function teamStanding(S, team) {
  return S.actors.some((a) => a.alive && a.team === team);
}

// Detonation: everyone near the device takes blast damage by distance,
// and the round belongs to the Breakers whatever the blast leaves standing.
function detonateCharge(S) {
  S.bomb.state = 'detonated';
  S.bomb.deviceMesh.visible = false;
  S.events.push({ type: 'explosion', at: new THREE.Vector3(S.bomb.x, 0.6, S.bomb.z), big: true });
  for (const actor of S.actors) {
    if (!actor.alive) continue;
    const gap = Math.hypot(actor.pos.x - S.bomb.x, actor.pos.z - S.bomb.z);
    if (gap >= 9) continue;
    const dmg = gap < 4 ? 500 : 130 - gap * 10;
    if (dmg <= 0) continue;
    actor.health -= dmg;
    if (actor.health <= 0) {
      actor.alive = false;
      S.events.push({ type: 'kill', victim: actor, attacker: null, part: 'body' });
    }
  }
  endRound(S, 'atk', 'detonation');
}

export function tickPhase(S) {
  const dt = S.dt;
  tickHunt(S);

  // The dropped pack lies where it fell; a carried one stays hidden.
  if (S.bomb.state === 'dropped') {
    S.bomb.packMesh.visible = true;
    S.bomb.packMesh.position.set(S.bomb.x, S.map.groundAt(S.bomb.x, S.bomb.z, 4) + 0.16, S.bomb.z);
  } else if (S.bomb.state === 'carried') {
    S.bomb.packMesh.visible = false;
  }
  if (S.bomb.state === 'planted') {
    const urgent = S.bomb.timer < 5;
    const on = urgent ? (S.time * 6) % 1 < 0.5 : (S.time * 2) % 1 < 0.5;
    S.bomb.lightMat.color.setHex(on ? 0xff4444 : 0x661111);
  }

  // Noise is short-lived: ears forget after a second or so.
  for (let i = S.noise.length - 1; i >= 0; i -= 1) {
    if (S.time - S.noise[i].at > 1.2) S.noise.splice(i, 1);
  }

  if (S.phase === 'buy') {
    S.timeLeft -= dt;
    if (S.timeLeft <= 0) {
      S.phase = 'live';
      S.timeLeft = ROUND_TIME;
      S.events.push({ type: 'roundLive' });
    }
    return;
  }

  if (S.phase === 'live') {
    S.timeLeft -= dt;
    if (S.bomb.state === 'dropped') {
      for (const actor of S.actors) {
        if (!actor.alive || actor.team !== 'atk') continue;
        const gap = Math.hypot(actor.pos.x - S.bomb.x, actor.pos.z - S.bomb.z);
        if (gap >= 1.15) continue;
        actor.hasCharge = true;
        S.bomb.state = 'carried';
        S.bomb.carrier = actor;
        S.events.push({ type: 'pickup', actor });
        break;
      }
    }
    if (!teamStanding(S, 'def')) return endRound(S, 'atk', 'elimination');
    if (!teamStanding(S, 'atk')) return endRound(S, 'def', 'elimination');
    if (S.timeLeft <= 0) return endRound(S, 'def', 'time');
    return;
  }

  if (S.phase === 'planted') {
    S.bomb.timer -= dt;
    if (S.bomb.timer <= S.bomb.beepAt) {
      S.events.push({ type: 'beep', final: S.bomb.timer < 4 });
      const interval = S.bomb.timer > 10 ? 1 : S.bomb.timer > 4 ? 0.5 : 0.22;
      S.bomb.beepAt = S.bomb.timer - interval;
    }
    if (!teamStanding(S, 'def')) return endRound(S, 'atk', 'elimination');
    if (S.bomb.timer <= 0) detonateCharge(S);
    return;
  }

  if (S.phase === 'roundover') {
    S.timeLeft -= dt;
    if (S.timeLeft > 0) return;
    if (S.matchWinner) {
      S.phase = 'matchover';
      S.events.push({ type: 'matchEnd', winner: S.matchWinner });
    } else {
      startRound(S);
    }
  }
}
