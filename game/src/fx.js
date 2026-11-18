// fx.js — paint, and only paint. The simulation speaks in events
// (tracer, shot, impact, hit, explosion); this module listens and turns
// them into short-lived light and sprites. It owns no game state and
// changes none: delete it and the match plays identically, just uglier.
//
// Everything is pooled. Tracers are a ring of line segments whose vertex
// buffers are rewritten in place; dust, sparks and muzzle flashes are
// rings of sprites that grow and fade. Two point lights do all the drama:
// a small warm one that jumps to whoever fired nearby, and a big one
// reserved for explosions, plus an expanding ring for the blast itself.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { eyePos, facing } from './actors.js';

// A soft round sprite texture: bright core, transparent rim.
function radialTexture(inner, outer) {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const pen = canvas.getContext('2d');
  const grad = pen.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, outer);
  pen.fillStyle = grad;
  pen.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

export function createFx(scene) {
  const dustTex = radialTexture('rgba(190,180,160,0.8)', 'rgba(190,180,160,0)');
  const sparkTex = radialTexture('rgba(255,190,90,1)', 'rgba(255,120,40,0)');
  const flashTex = radialTexture('rgba(255,240,210,1)', 'rgba(255,180,80,0)');

  // Tracer pool: fixed line segments, recycled round-robin.
  const tracerMat = new THREE.LineBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.85 });
  const tracers = [];
  for (let i = 0; i < 28; i += 1) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geo, tracerMat);
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
  let tracerCursor = 0;

  // Sprite pools: each item remembers its full life so step() can work
  // out how far through its fade it is.
  function makePool(texture, count, baseScale) {
    const items = [];
    for (let i = 0; i < count; i += 1) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: texture, transparent: true, depthWrite: false,
      }));
      sprite.visible = false;
      sprite.userData.baseScale = baseScale;
      scene.add(sprite);
      items.push({ sprite, life: 0, span: 1, grow: 1 });
    }
    return { items, cursor: 0 };
  }
  const dust = makePool(dustTex, 20, 0.5);
  const sparks = makePool(sparkTex, 16, 0.4);
  const flashes = makePool(flashTex, 10, 0.55);

  function spawn(pool, at, life, grow = 1) {
    const item = pool.items[pool.cursor];
    pool.cursor = (pool.cursor + 1) % pool.items.length;
    item.sprite.position.copy(at);
    item.life = life;
    item.span = life;
    item.grow = grow;
    item.sprite.visible = true;
  }

  const shotLight = new THREE.PointLight(0xffb36b, 0, 16, 1.8);
  scene.add(shotLight);
  const blastLight = new THREE.PointLight(0xffc98a, 0, 42, 1.6);
  scene.add(blastLight);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1, 0.09, 8, 32),
    new THREE.MeshBasicMaterial({ color: 0xffc98a, transparent: true, opacity: 0 }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.visible = false;
  scene.add(ring);
  let ringLife = 0;
  let shake = 0;

  const _eye = new THREE.Vector3();
  const _dir = new THREE.Vector3();
  const _muzzle = new THREE.Vector3();

  function onTracer(ev) {
    const slot = tracers[tracerCursor];
    tracerCursor = (tracerCursor + 1) % tracers.length;
    const arr = slot.line.geometry.attributes.position.array;
    arr[0] = ev.from.x; arr[1] = ev.from.y; arr[2] = ev.from.z;
    arr[3] = ev.to.x; arr[4] = ev.to.y; arr[5] = ev.to.z;
    slot.line.geometry.attributes.position.needsUpdate = true;
    slot.line.visible = true;
    slot.life = 0.05;
  }

  function onShot(S, ev) {
    if (ev.actor.isPlayer) {
      shotLight.position.copy(S.camera.position);
      shotLight.intensity = 10;
      return;
    }
    eyePos(ev.actor, _eye);
    facing(ev.actor, _dir);
    _muzzle.copy(_eye).addScaledVector(_dir, 0.62);
    _muzzle.y -= 0.16;
    spawn(flashes, _muzzle, 0.06);
    if (_muzzle.distanceTo(S.player.pos) < 14) {
      shotLight.position.copy(_muzzle);
      shotLight.intensity = 26;
    }
  }

  function onExplosion(S, ev) {
    spawn(flashes, ev.at, 0.3, 6);
    spawn(dust, ev.at, 0.9, 7);
    blastLight.position.copy(ev.at);
    blastLight.position.y += 1;
    blastLight.intensity = ev.big ? 900 : 300;
    ring.position.copy(ev.at);
    ring.position.y += 0.4;
    ring.userData.big = ev.big;
    ring.visible = true;
    ringLife = 0.45;
    const d = Math.hypot(ev.at.x - S.player.pos.x, ev.at.z - S.player.pos.z);
    shake = Math.min(0.5, shake + (ev.big ? 10 : 5) / (6 + d));
  }

  function consume(S) {
    for (const ev of S.events) {
      switch (ev.type) {
        case 'tracer': onTracer(ev); break;
        case 'shot': onShot(S, ev); break;
        case 'impact': spawn(dust, ev.at, 0.34, 2.2); break;
        case 'hit':
          _eye.set(ev.victim.pos.x, ev.victim.pos.y + 1.2, ev.victim.pos.z);
          spawn(sparks, _eye, 0.16, 1.4);
          break;
        case 'explosion': onExplosion(S, ev); break;
        default: break;
      }
    }
  }

  function stepPool(pool, dt) {
    for (const item of pool.items) {
      if (item.life <= 0) continue;
      item.life -= dt;
      if (item.life <= 0) {
        item.sprite.visible = false;
        continue;
      }
      const through = 1 - item.life / item.span;
      const scale = item.sprite.userData.baseScale * (0.5 + through * item.grow);
      item.sprite.scale.set(scale, scale, 1);
      item.sprite.material.opacity = 1 - through;
    }
  }

  function step(dt) {
    for (const t of tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      if (t.life <= 0) t.line.visible = false;
    }
    stepPool(dust, dt);
    stepPool(sparks, dt);
    stepPool(flashes, dt);
    shotLight.intensity = Math.max(0, shotLight.intensity - dt * 320);
    blastLight.intensity = Math.max(0, blastLight.intensity - dt * 2600);
    if (ringLife > 0) {
      ringLife -= dt;
      const through = 1 - ringLife / 0.45;
      const reach = 1 + through * (ring.userData.big ? 26 : 12);
      ring.scale.set(reach, reach, reach);
      ring.material.opacity = 0.55 * (1 - through);
      if (ringLife <= 0) ring.visible = false;
    }
    shake = Math.max(0, shake - dt * 1.4);
    return shake;
  }

  return { consume, step };
}

export const FX_ACCENT = PALETTE.accent;
