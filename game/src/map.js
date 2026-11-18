// map.js — the Tidewall yard: one harbour, described once.
//
// The whole level is axis-aligned boxes. A single spec table below produces
// both the collision solids the simulation walks and shoots against and the
// meshes the renderer draws, so what a player sees is exactly what stops a
// bullet. Waypoints for the bots sit in hand-checked open ground; the graph
// edges between them are derived, never authored — a pair of nodes links
// only when the straight walk between them clears every solid, judged by
// the same overlap rule the character collision uses.
import * as THREE from 'three';
import { PALETTE, CONTAINER_PAINTS } from './palette.js';

export const BOUNDS = { x: 34, z: 24 };

export const SITES = {
  A: { x: 24, z: -15, r: 5.5, name: 'Fuel Farm' },
  B: { x: 24, z: 15, r: 5.5, name: 'Crane Pad' },
};

export const SPAWNS = {
  atk: [[-30, -4], [-31, -1.5], [-30, 1], [-31, 3.5], [-29, 5.5]],
  def: [[30, -4], [31, -1.5], [30, 1], [31, 3.5], [29, 5.5]],
};

// [x, z, tag] triples. Indices into this list are a cross-module contract:
// match.js sends defenders to nodes 12/27/19/28, the rotator to 14, and the
// attack plan walks 10/27/9 (site A) or 18/28/16 (site B).
const WAYPOINTS = [
  [-29, 0, 'spawnAtk'], [-21, 0, 'west'], [-20, -16, 'lane'], [-5, -13.5, 'lane'], [6, -15, 'lane'],
  [4, -3.5, 'link'], [-16, -7, 'mid'], [0, -7.5, 'mid'], [9, -7, 'mid'], [24, -5, 'approach'],
  [20.25, -11.3, 'siteA'], [24, -15, 'siteA'], [25.5, -17.5, 'holdA'], [29, 0, 'spawnDef'], [14, -1, 'east'],
  [9, 7, 'mid'], [24, 5, 'approach'], [24, 15, 'siteB'], [20, 13, 'siteB'], [27.5, 12.5, 'holdB'],
  [6, 15, 'lane'], [-5, 13.5, 'lane'], [-20, 16, 'lane'], [-16, 7, 'mid'], [6, 7, 'link'],
  [-9, 12, 'drop'], [-9, -12, 'drop'], [24, -8, 'siteA'], [24, 8, 'siteB'], [16, 4, 'east'],
  [20, -6, 'east'], [20, 6, 'east'], [-26, -11, 'gate'], [-26, 11, 'gate'], [13, -15, 'lane'], [13, 15, 'lane'],
];

// Box specs: [centreX, centreZ, width, depth, height] with an optional
// sixth element, the floor height y0 (only the crane beam floats). The list
// order matters beyond tidiness: scenery hands out container paints in
// sequence, so keep the yard's rows in the order they are written here.
function yardBoxes() {
  const specs = [];
  const row = (cx, cz, w, d, h, y0) => { specs.push(y0 === undefined ? [cx, cz, w, d, h] : [cx, cz, w, d, h, y0]); };
  // The fence line: container rows around the perimeter, spawns just inside.
  for (const side of [-1, 1]) {
    row(-26, side * 22, 14, 3, 2.6);
    row(-8, side * 22, 16, 3, 2.6);
    row(10, side * 22, 16, 3, 2.6);
    row(26, side * 22, 14, 3, 2.6);
  }
  // Walls splitting each lane, pierced by the drop and link gaps.
  for (const side of [-1, 1]) {
    row(-18, side * 11, 10, 2.6, 2.6);
    row(-2, side * 11, 8, 2.6, 2.6);
    row(12, side * 11, 10, 2.6, 2.6);
    row(-12, side * 16, 9, 2.6, 2.6);
  }
  // Mid-yard stacks and the approach cover east.
  row(-8, -5, 9, 2.6, 5.2);
  row(-8, 5, 9, 2.6, 2.6);
  row(10, 0, 2.6, 9, 2.6);
  row(18, -8, 8, 2.6, 2.6);
  row(18, 8, 8, 2.6, 2.6);
  row(28, -20, 10, 3, 5.2);
  // The dock at mid: a step up, then the deck itself.
  row(-4.75, 2, 2.5, 6, 0.45);
  row(1, 2, 8, 6, 0.9);
  // Loose crates — low cover, a couple stacked double.
  const crates = [
    [4, -7, 2, 1.1], [-3, 9, 2, 1.1], [14, -6, 2, 1.1], [14, 6, 2, 1.1], [-14, 2, 2, 2.2],
    [-16, -4, 3, 1.1], [16, -2, 2, 1.1], [2, -17, 2, 1.1], [2, 17, 2, 1.1], [-1, 2, 2, 1.1],
  ];
  for (const [x, z, w, h] of crates) row(x, z, w, w, h);
  // Fuel Farm dressing: drum clusters (boxes, so they stop movement honestly)
  // and two fence runs that leave the south-west entry genuinely open.
  for (const [x, z] of [[21, -18], [22.5, -18], [26, -12], [27.5, -12.5], [24, -19.5]]) row(x, z, 1.3, 1.3, 1.6);
  row(19, -17, 1, 4, 1.1);
  row(25, -10.3, 4, 1, 1.1);
  // Crane Pad: four legs, the beam overhead, crates beneath.
  for (const [x, z] of [[19.5, 10.5], [28.5, 10.5], [19.5, 19.5], [28.5, 19.5]]) row(x, z, 0.7, 0.7, 7);
  row(24, 15, 11, 1.4, 1, 6.8);
  row(22, 13, 2.4, 2.4, 1.1);
  row(26, 17.5, 2, 2, 2.2);
  row(29.3, 15, 1, 5, 1.1);
  // A wall behind each spawn, so a spawn rush is not a turkey shoot.
  row(-33, 0, 1.2, 10, 2.6);
  row(33, 0, 1.2, 10, 2.6);
  return specs;
}

function toSolid([cx, cz, w, d, h, y0 = 0]) {
  return { x0: cx - w / 2, x1: cx + w / 2, z0: cz - d / 2, z1: cz + d / 2, y0, y1: y0 + h };
}

// Would a walking actor's footprint centre at (x, z) clip this solid? Only
// boxes tall enough to matter and low enough to stand in the way count.
function footprintBlocked(solids, x, z) {
  for (const s of solids) {
    if (s.y1 - s.y0 <= 0.55 || s.y0 >= 1.2) continue;
    if (x > s.x0 - 0.36 && x < s.x1 + 0.36 && z > s.z0 - 0.36 && z < s.z1 + 0.36) return true;
  }
  return false;
}

function walkIsClear(solids, ax, az, bx, bz) {
  const length = Math.hypot(bx - ax, bz - az);
  const samples = Math.ceil(length / 0.3);
  for (let k = 1; k < samples; k += 1) {
    const t = k / samples;
    if (footprintBlocked(solids, ax + (bx - ax) * t, az + (bz - az) * t)) return false;
  }
  return true;
}

// Derive the waypoint graph and an all-pairs next-hop table (breadth-first
// from every node; 36 nodes, so this is a blink at boot and free forever).
function deriveGraph(solids) {
  const nodes = WAYPOINTS.map(([x, z, tag]) => ({ x, z, tag, edges: [] }));
  for (let a = 0; a < nodes.length; a += 1) {
    for (let b = a + 1; b < nodes.length; b += 1) {
      const A = nodes[a];
      const B = nodes[b];
      if (Math.hypot(B.x - A.x, B.z - A.z) > 19) continue;
      if (!walkIsClear(solids, A.x, A.z, B.x, B.z)) continue;
      A.edges.push(b);
      B.edges.push(a);
    }
  }
  const nextHop = nodes.map((_, origin) => {
    const hop = new Array(nodes.length).fill(-1);
    const visited = new Array(nodes.length).fill(false);
    visited[origin] = true;
    hop[origin] = origin;
    const queue = [origin];
    for (let head = 0; head < queue.length; head += 1) {
      const cur = queue[head];
      for (const nxt of nodes[cur].edges) {
        if (visited[nxt]) continue;
        visited[nxt] = true;
        hop[nxt] = cur === origin ? nxt : hop[cur];
        queue.push(nxt);
      }
    }
    return hop;
  });
  return { nodes, nextHop };
}

// One axis of the slab test: clip the ray's [near, far] interval against a
// box face pair. Returns null when the ray can never enter on this axis.
function clipAxis(origin, dir, lo, hi, near, far) {
  if (Math.abs(dir) < 1e-8) return (origin < lo || origin > hi) ? null : [near, far];
  let enter = (lo - origin) / dir;
  let exit = (hi - origin) / dir;
  if (enter > exit) { const swap = enter; enter = exit; exit = swap; }
  return [Math.max(near, enter), Math.min(far, exit)];
}

export function createMap(scene) {
  const solids = yardBoxes().map(toSolid);
  const graph = deriveGraph(solids);

  // Distance along the ray to the first surface: the ground plane or the
  // nearest box face, whichever comes first within maxDist.
  function rayHit(ox, oy, oz, dx, dy, dz, maxDist) {
    let best = maxDist;
    if (dy < -1e-6) {
      const tGround = -oy / dy;
      if (tGround > 0 && tGround < best) best = tGround;
    }
    for (const s of solids) {
      let span = clipAxis(ox, dx, s.x0, s.x1, 0, best);
      if (span === null || span[0] > span[1]) continue;
      span = clipAxis(oy, dy, s.y0, s.y1, span[0], span[1]);
      if (span === null || span[0] > span[1]) continue;
      span = clipAxis(oz, dz, s.z0, s.z1, span[0], span[1]);
      if (span === null || span[0] > span[1]) continue;
      if (span[0] > 0 && span[0] < best) best = span[0];
    }
    return best;
  }

  function los(ax, ay, az, bx, by, bz) {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return true;
    const reach = len - 0.05;
    return rayHit(ax, ay, az, dx / len, dy / len, dz / len, reach) >= reach;
  }

  // The floor under a point: the top of the highest box whose top is within
  // a step's reach of the feet, or the yard's concrete at 0.
  function groundAt(x, z, feetY) {
    let floor = 0;
    for (const s of solids) {
      if (x < s.x0 || x > s.x1 || z < s.z0 || z > s.z1) continue;
      if (s.y1 <= feetY + 0.55 && s.y1 > floor) floor = s.y1;
    }
    return floor;
  }

  // Resolve a vertical cylinder against every box it overlaps, twice over
  // (one pass can push the cylinder into a second box). Boxes the actor
  // stands on or walks under are skipped by the height tests.
  function collide(pos, radius, height) {
    for (let pass = 0; pass < 2; pass += 1) {
      for (const s of solids) {
        if (s.y1 <= pos.y + 0.3 || s.y0 >= pos.y + height) continue;
        const nearX = Math.max(s.x0, Math.min(pos.x, s.x1));
        const nearZ = Math.max(s.z0, Math.min(pos.z, s.z1));
        let pushX = pos.x - nearX;
        let pushZ = pos.z - nearZ;
        const distSq = pushX * pushX + pushZ * pushZ;
        if (distSq >= radius * radius) continue;
        if (distSq < 1e-8) {
          // Centre inside the box: exit through whichever face is nearest.
          const gaps = [
            [pos.x - s.x0, 'west'], [s.x1 - pos.x, 'east'],
            [pos.z - s.z0, 'north'], [s.z1 - pos.z, 'south'],
          ];
          gaps.sort((p, q) => p[0] - q[0]);
          const face = gaps[0][1];
          if (face === 'west') pos.x = s.x0 - radius;
          else if (face === 'east') pos.x = s.x1 + radius;
          else if (face === 'north') pos.z = s.z0 - radius;
          else pos.z = s.z1 + radius;
          continue;
        }
        const dist = Math.sqrt(distSq);
        pushX /= dist;
        pushZ /= dist;
        pos.x = nearX + pushX * radius;
        pos.z = nearZ + pushZ * radius;
      }
    }
    pos.x = Math.max(-BOUNDS.x + radius, Math.min(BOUNDS.x - radius, pos.x));
    pos.z = Math.max(-BOUNDS.z + radius, Math.min(BOUNDS.z - radius, pos.z));
  }

  function nearestNode(x, z) {
    let winner = 0;
    let bestSq = Infinity;
    for (let i = 0; i < graph.nodes.length; i += 1) {
      const n = graph.nodes[i];
      const dSq = (n.x - x) * (n.x - x) + (n.z - z) * (n.z - z);
      if (dSq < bestSq) { bestSq = dSq; winner = i; }
    }
    return winner;
  }

  function siteAt(x, z) {
    for (const key of ['A', 'B']) {
      const s = SITES[key];
      if ((x - s.x) * (x - s.x) + (z - s.z) * (z - s.z) <= s.r * s.r) return key;
    }
    return null;
  }

  dressYard(scene, solids);
  return { solids, rayHit, los, groundAt, collide, nearestNode, siteAt, nodes: graph.nodes, nextHop: graph.nextHop };
}

// ---- the visible yard, raised from the same solids -------------------------

// A deterministic little random source for the ground speckle, so renders
// used for screenshots do not change their concrete between runs.
function speckleRandom(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function paintContainerSide(paint, label) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const g = canvas.getContext('2d');
  g.fillStyle = paint;
  g.fillRect(0, 0, 256, 128);
  g.fillStyle = 'rgba(0,0,0,0.16)';
  for (let x = 8; x < 256; x += 18) g.fillRect(x, 6, 7, 116);
  g.fillStyle = 'rgba(255,255,255,0.10)';
  g.fillRect(0, 0, 256, 8);
  g.fillRect(0, 120, 256, 8);
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.font = 'bold 26px monospace';
  g.fillText(label, 22, 52);
  g.font = '13px monospace';
  g.fillText('TIDEWALL LINES', 22, 76);
  g.fillText('MAX 30480 KG', 22, 96);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function paintGround() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 720;
  const g = canvas.getContext('2d');
  const rand = speckleRandom(20261115);
  const px = (x) => ((x + 40) / 80) * 1024;
  const pz = (z) => ((z + 28) / 56) * 720;
  g.fillStyle = '#6f6a61';
  g.fillRect(0, 0, 1024, 720);
  for (let i = 0; i < 9000; i += 1) {
    g.fillStyle = rand() < 0.5 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.04)';
    g.fillRect(rand() * 1024, rand() * 720, 2, 2);
  }
  g.fillStyle = 'rgba(0,0,0,0.10)';
  g.fillRect(px(-24), pz(-21), px(34) - px(-24), pz(-12.5) - pz(-21));
  g.fillRect(px(-24), pz(12.5), px(34) - px(-24), pz(21) - pz(12.5));
  g.strokeStyle = 'rgba(236,231,219,0.5)';
  g.lineWidth = 2;
  g.setLineDash([14, 12]);
  g.beginPath(); g.moveTo(px(-24), pz(-16)); g.lineTo(px(17), pz(-16)); g.stroke();
  g.beginPath(); g.moveTo(px(-24), pz(16)); g.lineTo(px(17), pz(16)); g.stroke();
  g.setLineDash([]);
  for (const key of ['A', 'B']) {
    const site = SITES[key];
    g.strokeStyle = PALETTE.accent;
    g.lineWidth = 5;
    g.beginPath();
    g.arc(px(site.x), pz(site.z), (site.r / 80) * 1024, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = PALETTE.accent;
    g.font = 'bold 64px system-ui';
    g.textAlign = 'center';
    g.fillText(key, px(site.x), pz(site.z) + 22);
  }
  g.fillStyle = 'rgba(242,163,60,0.85)';
  for (let i = 0; i < 8; i += 1) g.fillRect(px(19.5) + i * 14, pz(-20.5), 7, 10);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function dressYard(scene, solids) {
  const lambert = (opts) => new THREE.MeshLambertMaterial(opts);
  const unitBox = new THREE.BoxGeometry(1, 1, 1);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 56), lambert({ map: paintGround() }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const containerMats = CONTAINER_PAINTS.map((paint, i) => lambert({ map: paintContainerSide(paint, `LT-${2100 + i * 137}`) }));
  const steelMat = lambert({ color: PALETTE.hairline });
  const darkSteelMat = lambert({ color: '#232a31' });
  const crateMat = lambert({ color: '#8a6f47' });
  const drumMat = lambert({ color: '#b3542e' });

  // Pick a finish per box from its shape: long tall rows get shipping
  // paint, small ground boxes become crates or drums, tall thin ones steel.
  let paintCursor = 0;
  for (const s of solids) {
    const w = s.x1 - s.x0;
    const d = s.z1 - s.z0;
    const h = s.y1 - s.y0;
    if (s.y0 > 3) continue; // the crane beam is modelled separately below
    let mat = steelMat;
    if (h >= 2.2 && (w >= 7.5 || d >= 7.5)) {
      mat = containerMats[paintCursor % containerMats.length];
      paintCursor += 1;
    } else if (h <= 1.7 && w <= 3.2 && d <= 3.2 && s.y0 === 0) {
      mat = (w <= 1.4 && h >= 1.5) ? drumMat : crateMat;
    } else if (h >= 6) {
      mat = darkSteelMat;
    }
    const mesh = new THREE.Mesh(unitBox, mat);
    mesh.position.set((s.x0 + s.x1) / 2, s.y0 + h / 2, (s.z0 + s.z1) / 2);
    mesh.scale.set(w, h, d);
    mesh.castShadow = h > 1;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // The gantry crane above the Crane Pad: beam, cable, hook block.
  const crane = new THREE.Group();
  const beamMesh = new THREE.Mesh(unitBox, darkSteelMat);
  beamMesh.scale.set(11.5, 1, 1.6);
  beamMesh.position.set(24, 7.3, 15);
  beamMesh.castShadow = true;
  const cableMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.4), darkSteelMat);
  cableMesh.position.set(26, 5.2, 15);
  const hookMesh = new THREE.Mesh(unitBox, lambert({ color: PALETTE.accent }));
  hookMesh.scale.set(0.9, 0.9, 0.9);
  hookMesh.position.set(26, 3.3, 15);
  hookMesh.castShadow = true;
  crane.add(beamMesh, cableMesh, hookMesh);
  scene.add(crane);

  // A horizontal fuel tank resting by the Fuel Farm.
  const tankMesh = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 6, 14), drumMat);
  tankMesh.rotation.z = Math.PI / 2;
  tankMesh.position.set(24, 1.5, -20.6);
  tankMesh.castShadow = true;
  scene.add(tankMesh);

  // Yard lamps: pole and head in steel, a real point light, and a fake
  // translucent glow cone so the pool of light reads at a distance.
  const lampHeadMat = lambert({ color: PALETTE.accent, emissive: '#f2a33c', emissiveIntensity: 1.4 });
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xf2a33c, transparent: true, opacity: 0.07, depthWrite: false });
  for (const [x, z] of [[-20, -8], [0, 10], [16, -12], [16, 12], [-14, 0]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 5.4), darkSteelMat);
    pole.position.set(x, 2.7, z);
    const head = new THREE.Mesh(unitBox, lampHeadMat);
    head.scale.set(0.7, 0.18, 0.4);
    head.position.set(x, 5.45, z);
    const glow = new THREE.Mesh(new THREE.ConeGeometry(2.6, 5.2, 12, 1, true), glowMat);
    glow.position.set(x, 2.8, z);
    const light = new THREE.PointLight(0xffa64d, 60, 20, 1.8);
    light.position.set(x, 5.2, z);
    scene.add(pole, head, glow, light);
  }

  // Far silhouettes on the skyline: crane legs, a jib, a ship's hull.
  const silhouetteMat = lambert({ color: '#1b2129' });
  const skyline = [[-52, -30, 4, 26], [-44, -30, 18, 3], [54, 26, 4, 22], [46, 26, 16, 3], [0, -44, 90, 7], [-58, 8, 26, 9]];
  for (const [x, z, w, h] of skyline) {
    const m = new THREE.Mesh(unitBox, silhouetteMat);
    m.scale.set(w, h, 3);
    m.position.set(x, h / 2, z);
    scene.add(m);
  }
}
