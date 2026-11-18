// grenades.js — three answers to a held angle, all leaving the hand the
// same way. A Burst grenade hurts everything within its radius that it
// can see (walls are cover). A Flare blinds by geometry: the nearer a
// fighter is and the more squarely they face the pop, the longer their
// world is gone — for the player that is a white screen, for a bot a
// blindUntil timestamp its brain respects. A Fog grenade builds a
// breathing sphere of smoke that sight lines cannot cross but bullets
// can, which is the whole tactical point of it.
//
// In flight every grenade is a small sphere with gravity, bouncing off
// the ground and the map's solids with most of its energy spent on each
// impact, until its fuse — different per type — runs out wherever it lies.
import * as THREE from 'three';
import { applyDamage, eyePos, facing } from './actors.js';

const _eye = new THREE.Vector3();
const _dir = new THREE.Vector3();

const FUSE_SECONDS = { frag: 1.5, flash: 1.35, smoke: 1.1 };
const SHELL_COLOUR = { frag: 0x7a4a2e, flash: 0xd8d4c8, smoke: 0x5a6068 };
const FRAG_RADIUS = 5.6;
const FLASH_RADIUS = 24;

// The smoke puff sprite: a radial gradient blob painted once on a canvas
// and shared by every cloud the match ever makes.
const smokeTexture = paintSmokeTexture();
function paintSmokeTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const pen = canvas.getContext('2d');
  const grad = pen.createRadialGradient(64, 64, 6, 64, 64, 62);
  grad.addColorStop(0, 'rgba(168,172,176,0.85)');
  grad.addColorStop(0.6, 'rgba(150,154,158,0.5)');
  grad.addColorStop(1, 'rgba(150,154,158,0)');
  pen.fillStyle = grad;
  pen.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

export function throwGrenade(S, actor) {
  const type = actor.loadout.grenadeType;
  if (actor.loadout.grenades[type] <= 0) return false;
  if (S.time < (actor.nextThrowAt || 0)) return false;
  actor.loadout.grenades[type] -= 1;
  actor.nextThrowAt = S.time + 0.7;

  eyePos(actor, _eye);
  facing(actor, _dir);
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.07, 10, 8),
    new THREE.MeshLambertMaterial({ color: SHELL_COLOUR[type] }),
  );
  mesh.position.copy(_eye).addScaledVector(_dir, 0.3);
  S.scene.add(mesh);

  const flight = {
    type,
    thrower: actor,
    mesh,
    pos: mesh.position, // the mesh and the physics share one vector
    vel: new THREE.Vector3(
      _dir.x * 13 + actor.vel.x,
      _dir.y * 13 + 2.2 + actor.vel.y * 0.4,
      _dir.z * 13 + actor.vel.z,
    ),
    fuseAt: S.time + FUSE_SECONDS[type],
    bounces: 0,
  };
  S.grenades.push(flight);
  S.events.push({ type: 'throw', actor });
  return true;
}

// One physics step for a grenade in flight: gravity, then keep the sphere
// out of the solids (back out along whichever axis it entered by), then
// the ground, where a hard landing bounces and a soft one settles.
function integrateGrenade(S, n, dt) {
  n.vel.y -= 14 * dt;
  const p = n.pos;
  const beforeX = p.x;
  const beforeZ = p.z;
  p.addScaledVector(n.vel, dt);
  for (const s of S.map.solids) {
    const insideX = p.x > s.x0 - 0.07 && p.x < s.x1 + 0.07;
    const insideZ = p.z > s.z0 - 0.07 && p.z < s.z1 + 0.07;
    const insideY = p.y > s.y0 && p.y < s.y1 + 0.07;
    if (!insideX || !insideZ || !insideY) continue;
    if (beforeX <= s.x0 - 0.07 || beforeX >= s.x1 + 0.07) {
      p.x = beforeX;
      n.vel.x *= -0.4;
    } else if (beforeZ <= s.z0 - 0.07 || beforeZ >= s.z1 + 0.07) {
      p.z = beforeZ;
      n.vel.z *= -0.4;
    }
  }
  const floorY = S.map.groundAt(p.x, p.z, p.y) + 0.07;
  if (p.y >= floorY) return;
  p.y = floorY;
  if (Math.abs(n.vel.y) > 1.2) {
    n.vel.y *= -0.38;
    n.vel.x *= 0.7;
    n.vel.z *= 0.7;
    n.bounces += 1;
    S.events.push({ type: 'bounce', at: p });
  } else {
    n.vel.y = 0;
    n.vel.x *= 0.8;
    n.vel.z *= 0.8;
  }
}

export function stepGrenades(S, dt) {
  for (let i = S.grenades.length - 1; i >= 0; i -= 1) {
    const n = S.grenades[i];
    integrateGrenade(S, n, dt);
    if (S.time < n.fuseAt) continue;
    S.grenades.splice(i, 1);
    S.scene.remove(n.mesh);
    detonate(S, n);
  }
  // Live smoke breathes: each puff in a cloud sways on its own phase.
  for (let i = S.smokes.length - 1; i >= 0; i -= 1) {
    const cloud = S.smokes[i];
    cloud.group.children.forEach((sprite, k) => {
      sprite.position.y = cloud.y + Math.sin(S.time * 0.7 + k * 1.7) * 0.16;
    });
    if (S.time >= cloud.until) {
      S.scene.remove(cloud.group);
      S.smokes.splice(i, 1);
    }
  }
}

function detonate(S, n) {
  const p = n.pos;
  S.noise.push({ x: p.x, z: p.z, r: 34, team: n.thrower.team, at: S.time });
  if (n.type === 'frag') burstFrag(S, n);
  else if (n.type === 'flash') popFlash(S, n);
  else openSmoke(S, n);
}

function burstFrag(S, n) {
  const p = n.pos;
  S.events.push({ type: 'explosion', at: p.clone(), big: false });
  for (const actor of S.actors) {
    if (!actor.alive) continue;
    const d = Math.hypot(actor.pos.x - p.x, actor.pos.z - p.z);
    if (d > FRAG_RADIUS) continue;
    const seen = S.map.los(p.x, p.y + 0.4, p.z, actor.pos.x, actor.pos.y + 0.9, actor.pos.z);
    if (!seen) continue;
    applyDamage(S, actor, 95 * Math.pow(1 - d / FRAG_RADIUS, 1.15), 'body', n.thrower);
  }
}

function popFlash(S, n) {
  const p = n.pos;
  S.events.push({ type: 'flashbang', at: p.clone() });
  for (const actor of S.actors) {
    if (!actor.alive) continue;
    const dx = actor.pos.x - p.x;
    const dz = actor.pos.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d > FLASH_RADIUS) continue;
    const seen = S.map.los(p.x, p.y + 0.3, p.z, actor.pos.x, actor.pos.y + 1.5, actor.pos.z);
    if (!seen) continue;
    facing(actor, _dir);
    // The dot of the actor's gaze against the direction *to* the pop:
    // staring straight at it scores highest, back turned scores negative.
    const dot = d < 0.01 ? 1 : (-dx * _dir.x - dz * _dir.z) / d;
    let dur = 0.5;
    if (dot > 0.55) dur = 3.0;
    else if (dot > 0) dur = 1.7;
    dur *= Math.max(0.25, 1 - d / 26);
    actor.blindUntil = Math.max(actor.blindUntil, S.time + dur);
    if (actor.isPlayer) S.events.push({ type: 'playerFlashed', dur });
  }
}

function openSmoke(S, n) {
  const p = n.pos;
  const group = new THREE.Group();
  const puffMaterial = (opacity) => new THREE.SpriteMaterial({
    map: smokeTexture, transparent: true, opacity, depthWrite: false,
  });
  for (let k = 0; k < 9; k += 1) {
    const sprite = new THREE.Sprite(puffMaterial(0.55));
    const angle = (k / 9) * Math.PI * 2;
    sprite.position.set(
      p.x + Math.cos(angle) * 1.6,
      p.y + 1 + (k % 3) * 0.7,
      p.z + Math.sin(angle) * 1.6,
    );
    sprite.scale.set(3.6, 3.0, 1);
    group.add(sprite);
  }
  const heart = new THREE.Sprite(puffMaterial(0.75));
  heart.position.set(p.x, p.y + 1.4, p.z);
  heart.scale.set(4.6, 3.8, 1);
  group.add(heart);
  S.scene.add(group);
  S.smokes.push({ x: p.x, y: p.y, z: p.z, r: 3.1, until: S.time + 14, group });
  S.events.push({ type: 'smokePop', at: p.clone() });
}

// Would the sight line a→b pass through any live cloud? Bullets never ask
// this question; eyes (human crosshair logic and bot perception) do.
export function smokeBlocks(S, ax, ay, az, bx, by, bz) {
  for (const cloud of S.smokes) {
    if (segmentPassesNear(ax, ay, az, bx, by, bz, cloud.x, cloud.y + 1.3, cloud.z, cloud.r)) return true;
  }
  return false;
}

// Closest approach of the segment a→b to a point, against a radius made a
// little forgiving (a line that grazes the cloud's edge still loses the
// picture behind it).
function segmentPassesNear(ax, ay, az, bx, by, bz, cx, cy, cz, r) {
  const abx = bx - ax; const aby = by - ay; const abz = bz - az;
  const lenSq = abx * abx + aby * aby + abz * abz;
  let t = 0;
  if (lenSq > 0) t = ((cx - ax) * abx + (cy - ay) * aby + (cz - az) * abz) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const offX = ax + abx * t - cx;
  const offY = ay + aby * t - cy;
  const offZ = az + abz * t - cz;
  return offX * offX + offY * offY + offZ * offZ < r * r * 0.85;
}
