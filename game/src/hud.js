// hud.js — everything flat on the glass: bars, numbers, the minimap, and
// the transient layer (killfeed, hitmarker, banners, the shop). The DOM is
// declared in index.html; this module only reads game state and events and
// writes what changed. Text writes go through a small cache so a steady
// frame performs no DOM writes at all.
import { WEAPONS, GRENADES, ARMOR_PRICE, currentSlot } from './weapons.js';
import { SITES } from './map.js';

const byId = (id) => document.getElementById(id);

const ENDING_WORDS = {
  elimination: 'team eliminated',
  detonation: 'the charge went off',
  defused: 'the charge was defused',
  time: 'time ran out',
};

// The shop's eight rows, in display order, each with its hotkey.
const SHOP_ROWS = [
  ['smg', '1'], ['shotgun', '2'], ['rifle', '3'], ['sniper', '4'],
  ['armor', '5'], ['frag', '6'], ['flash', '7'], ['smoke', '8'],
];

export function createHud(S, callbacks) {
  const nodes = {
    hud: byId('hud'),
    health: byId('health'),
    armor: byId('armor'),
    ammo: byId('ammo'),
    reserve: byId('reserve'),
    weapon: byId('weapon-name'),
    money: byId('money'),
    timer: byId('timer'),
    score: byId('score'),
    pips: byId('pips'),
    crosshair: byId('crosshair'),
    hitmarker: byId('hitmarker'),
    killfeed: byId('killfeed'),
    banner: byId('banner'),
    bannerTitle: byId('banner-title'),
    bannerSub: byId('banner-sub'),
    channel: byId('channel'),
    channelFill: byId('channel-fill'),
    channelLabel: byId('channel-label'),
    vignette: byId('vignette'),
    dmgdir: byId('dmgdir'),
    flash: byId('flash-overlay'),
    scope: byId('scope'),
    chargeTag: byId('charge-tag'),
    minimap: byId('minimap'),
    hint: byId('hint'),
    buy: byId('buy'),
    buyTitle: byId('buy-title'),
    buyItems: byId('buy-items'),
    buyMoney: byId('buy-money'),
    scoreboard: byId('scoreboard'),
  };

  const written = new Map();
  const writeText = (node, key, value) => {
    if (written.get(key) === value) return;
    written.set(key, value);
    node.textContent = value;
  };

  let hitmarkUntil = 0;
  let bannerUntil = 0;
  let shopOpen = false;
  const feedEntries = [];

  // Banners and the shop are both translucent layers over the same patch
  // of screen; a round banner left glowing behind the shop rows looks like
  // a rendering bug (it did, once). The two never show together: opening
  // the shop kills the banner, and no banner starts while shopping.
  function showBanner(title, sub, seconds) {
    if (shopOpen) return;
    nodes.bannerTitle.textContent = title;
    nodes.bannerSub.textContent = sub || '';
    nodes.banner.style.opacity = '1';
    bannerUntil = S.time + seconds;
  }

  function pushFeed(html, color) {
    const line = document.createElement('div');
    line.className = 'feed-line';
    line.style.color = color;
    line.innerHTML = html;
    nodes.killfeed.appendChild(line);
    feedEntries.push({ line, until: S.time + 6 });
    while (nodes.killfeed.children.length > 5) nodes.killfeed.removeChild(nodes.killfeed.firstChild);
  }

  function feedColourFor(victim) {
    if (victim === S.player) return '#ff7a5c';
    return victim.team === 'def' ? '#9fc3e8' : '#ffb38a';
  }

  // The event-driven half of the HUD: what happened this step, shown once.
  function consume() {
    for (const ev of S.events) {
      switch (ev.type) {
        case 'hit':
          if (ev.shooter === S.player) {
            hitmarkUntil = S.time + 0.14;
            nodes.hitmarker.className = ev.killed ? 'show kill' : 'show';
          }
          break;
        case 'kill': {
          const killerName = ev.attacker ? ev.attacker.name : 'the charge';
          pushFeed(`${killerName} ▸ ${ev.victim.name}${ev.part === 'head' ? ' ⌖' : ''}`, feedColourFor(ev.victim));
          if (ev.victim === S.player) {
            showBanner('You are down', 'Your team fights on — watch the round out.', 3);
          }
          break;
        }
        case 'roundStart':
          showBanner(
            `Round ${S.round}`,
            S.player.hasCharge ? 'You carry the breach charge. Plant it at A or B.' : 'Buy phase — press B to shop.',
            2.6,
          );
          break;
        case 'roundLive':
          showBanner('Round live', `Plant site ${S.plan.site} is the call — or improvise.`, 1.6);
          break;
        case 'hunt':
          showBanner('Wardens are hunting the charge', 'They know where you are — move or plant.', 2.6);
          break;
        case 'planted':
          showBanner('Charge planted', `Site ${ev.site} — hold it for 35 seconds.`, 2.4);
          break;
        case 'roundEnd': {
          const playerWon = (ev.winner === 'atk') === (S.player.team === 'atk');
          showBanner(playerWon ? 'Round won' : 'Round lost', ENDING_WORDS[ev.reason] || '', 3.6);
          break;
        }
        case 'matchEnd': {
          const playerWon = ev.winner === S.player.team;
          const title = ev.winner === 'draw' ? 'Match drawn' : playerWon ? 'Match won' : 'Match lost';
          showBanner(title, `Final score — Breakers ${S.scoreAtk} : ${S.scoreDef} Wardens`, 30);
          break;
        }
        case 'damage':
          if (ev.victim === S.player && ev.attacker) {
            const shotFrom = Math.atan2(
              -(ev.attacker.pos.x - S.player.pos.x),
              -(ev.attacker.pos.z - S.player.pos.z),
            );
            const deg = ((S.player.yaw - shotFrom) * 180 / Math.PI + 360) % 360;
            nodes.dmgdir.style.transform = `rotate(${deg}deg)`;
            nodes.dmgdir.style.opacity = '1';
            nodes.dmgdir.dataset.until = String(S.time + 0.9);
          }
          break;
        default:
          break;
      }
    }
  }

  // --- the shop -------------------------------------------------------------
  function shopName(id) {
    if (id === 'armor') return 'Armour + helmet';
    if (WEAPONS[id]) return WEAPONS[id].name;
    return GRENADES[id].name;
  }

  function shopPrice(id) {
    if (id === 'armor') return ARMOR_PRICE;
    if (WEAPONS[id]) return WEAPONS[id].price;
    return GRENADES[id].price;
  }

  function shopOwned(id) {
    const loadout = S.player.loadout;
    if (id === 'armor') return loadout.armor;
    if (WEAPONS[id]) return Boolean(loadout.primary && loadout.primary.def.id === id);
    return loadout.grenades[id] >= 2;
  }

  function renderShop() {
    // The header carries the round and the called site, so a shopper never
    // needs the (suppressed) round banner to know where they stand.
    writeText(nodes.buyTitle, 'buy-title', `EQUIPMENT — ROUND ${S.round} · SITE ${S.plan.site}`);
    writeText(nodes.buyMoney, 'buy-money', `$${S.player.money}`);
    nodes.buyItems.innerHTML = '';
    for (const [id, key] of SHOP_ROWS) {
      const owned = shopOwned(id);
      const price = shopPrice(id);
      const row = document.createElement('button');
      row.className = 'buy-row';
      row.disabled = owned || S.player.money < price;
      row.innerHTML = `<span class="buy-key">${key}</span><span class="buy-name">${shopName(id)}</span><span class="buy-price">${owned ? 'owned' : `$${price}`}</span>`;
      row.addEventListener('click', () => {
        callbacks.buy(id);
        renderShop();
      });
      nodes.buyItems.appendChild(row);
    }
  }

  function setBuy(open) {
    shopOpen = Boolean(open) && S.phase === 'buy';
    nodes.buy.style.display = shopOpen ? 'block' : 'none';
    if (shopOpen) {
      nodes.banner.style.opacity = '0';
      bannerUntil = 0;
      renderShop();
    }
  }

  window.addEventListener('keydown', (e) => {
    if (!shopOpen) return;
    const hit = SHOP_ROWS.find(([, key]) => key === e.key);
    if (hit) {
      callbacks.buy(hit[0]);
      renderShop();
    }
    if (e.key === 'Escape') setBuy(false);
  });

  // --- the minimap ------------------------------------------------------------
  const mapCtx = nodes.minimap.getContext('2d');
  const MAP_PX = 168;
  const project = (x, z) => [((x + 34) / 68) * MAP_PX, ((z + 24) / 48) * MAP_PX];

  function paintMinimap() {
    mapCtx.fillStyle = 'rgba(16,20,25,0.82)';
    mapCtx.fillRect(0, 0, MAP_PX, MAP_PX);
    mapCtx.fillStyle = 'rgba(120,135,150,0.5)';
    for (const s of S.map.solids) {
      if (s.y1 - s.y0 < 1.2) continue;
      const [x0, z0] = project(s.x0, s.z0);
      const [x1, z1] = project(s.x1, s.z1);
      mapCtx.fillRect(x0, z0, x1 - x0, z1 - z0);
    }
    for (const key of ['A', 'B']) {
      const site = SITES[key];
      const [cx, cy] = project(site.x, site.z);
      mapCtx.strokeStyle = '#f2a33c';
      mapCtx.beginPath();
      mapCtx.arc(cx, cy, site.r / 68 * MAP_PX, 0, 7);
      mapCtx.stroke();
      mapCtx.fillStyle = '#f2a33c';
      mapCtx.fillText(key, cx - 3, cy + 3);
    }
    if (S.bomb.state !== 'carried') {
      const [bx, by] = project(S.bomb.x, S.bomb.z);
      mapCtx.fillStyle = '#ff5544';
      mapCtx.fillRect(bx - 2, by - 2, 4, 4);
    }
    for (const actor of S.actors) {
      if (!actor.alive) continue;
      const [ax, ay] = project(actor.pos.x, actor.pos.z);
      if (actor === S.player) {
        mapCtx.save();
        mapCtx.translate(ax, ay);
        mapCtx.rotate(-actor.yaw);
        mapCtx.fillStyle = '#ece7db';
        mapCtx.beginPath();
        mapCtx.moveTo(0, -5);
        mapCtx.lineTo(3.5, 4);
        mapCtx.lineTo(-3.5, 4);
        mapCtx.closePath();
        mapCtx.fill();
        mapCtx.restore();
      } else if (actor.team === S.player.team) {
        mapCtx.fillStyle = '#e8873a';
        mapCtx.beginPath();
        mapCtx.arc(ax, ay, 2.4, 0, 7);
        mapCtx.fill();
      }
    }
    // Enemy noise the player could plausibly have heard, fading out.
    for (const n of S.noise) {
      if (n.team === S.player.team) continue;
      const age = S.time - n.at;
      if (age > 1.1) continue;
      const [nx, ny] = project(n.x, n.z);
      mapCtx.fillStyle = `rgba(255,90,70,${0.75 * (1 - age / 1.1)})`;
      mapCtx.beginPath();
      mapCtx.arc(nx, ny, 3, 0, 7);
      mapCtx.fill();
    }
  }

  // --- the scoreboard ---------------------------------------------------------
  function paintScoreboard() {
    const me = S.player;
    const ranked = [...S.actors].sort((a, b) => b.kills - a.kills);
    const rows = ranked.map((a) => (
      `<tr class="${a.team}"><td>${a.name}${a === me ? ' (you)' : ''}</td><td>${a.kills}</td><td>${a.deaths}</td><td>$${a.money}</td></tr>`
    )).join('');
    nodes.scoreboard.innerHTML = `<table><tr><th>TIDEWALL — first to 7</th><th>K</th><th>D</th><th>$</th></tr>${rows}</table>`;
  }

  function clockText() {
    const seconds = Math.max(0, Math.ceil(S.phase === 'planted' ? S.bomb.timer : S.timeLeft));
    return { seconds, text: `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` };
  }

  function teamPips(team) {
    const alive = S.actors.filter((a) => a.alive && a.team === team).length;
    return `${'●'.repeat(alive)}${'○'.repeat(5 - alive)}`;
  }

  function refreshChannel(p) {
    const mine = S.channel && S.channel.actor === p;
    if (mine) {
      nodes.channel.style.display = 'block';
      const pct = Math.min(100, (S.channel.progress / S.channel.need) * 100);
      nodes.channelFill.style.width = `${pct}%`;
      writeText(nodes.channelLabel, 'chan', S.channel.kind === 'plant' ? 'PLANTING THE CHARGE…' : 'DEFUSING…');
      return;
    }
    if (S.phase === 'live' && p.hasCharge && S.map.siteAt(p.pos.x, p.pos.z)) {
      nodes.channel.style.display = 'block';
      nodes.channelFill.style.width = '0%';
      writeText(nodes.channelLabel, 'chan', 'Hold E to plant the charge');
      return;
    }
    nodes.channel.style.display = 'none';
  }

  function hintText(p) {
    if (S.phase === 'buy') return 'B — buy menu · weapons refill every round';
    if (S.phase === 'live' && p.hasCharge && S.hunt && S.hunt.active) {
      return '⚠ Wardens have your position — move or plant!';
    }
    return '';
  }

  // The state-driven half of the HUD: everything true right now, redrawn
  // each frame but written only where it changed.
  function refresh() {
    const p = S.player;
    const inGame = S.phase !== 'menu';
    nodes.hud.style.display = inGame ? 'block' : 'none';
    if (!inGame) return;

    writeText(nodes.health, 'hp', `${Math.max(0, Math.ceil(p.health))}`);
    nodes.health.style.color = p.health <= 30 ? '#ff7a5c' : '';
    writeText(nodes.armor, 'arm', p.loadout.armor ? '▣ ARMOUR' : '');

    if (p.loadout.slot === 'grenade') {
      writeText(nodes.weapon, 'wpn', GRENADES[p.loadout.grenadeType].name);
      writeText(nodes.ammo, 'ammo', `${p.loadout.grenades[p.loadout.grenadeType]}`);
      writeText(nodes.reserve, 'res', '');
    } else {
      const slot = currentSlot(p.loadout);
      if (slot) {
        writeText(nodes.weapon, 'wpn', slot.def.name);
        writeText(nodes.ammo, 'ammo', slot.reloadEndAt > S.time ? '——' : `${slot.mag}`);
        writeText(nodes.reserve, 'res', `/ ${slot.reserve}`);
      }
    }
    writeText(nodes.money, 'money', `$${p.money}`);

    const clock = clockText();
    writeText(nodes.timer, 'timer', clock.text);
    nodes.timer.style.color = clock.seconds <= 10 ? '#ff7a5c' : '';
    writeText(nodes.score, 'score', `BREAKERS ${S.scoreAtk} — ${S.scoreDef} WARDENS · ROUND ${S.round}`);
    writeText(nodes.pips, 'pips', `${teamPips('atk')}   ${teamPips('def')}`);
    nodes.chargeTag.style.display = p.hasCharge ? 'block' : 'none';

    const gap = 6 + (p.bloom || 0) * 260 + p.speed2d * 2.2;
    nodes.crosshair.style.setProperty('--gap', `${gap.toFixed(1)}px`);
    nodes.crosshair.style.opacity = p.alive && !S.scoped ? '1' : '0';
    if (S.time >= hitmarkUntil) nodes.hitmarker.className = '';
    if (S.time > bannerUntil) nodes.banner.style.opacity = '0';

    for (let i = feedEntries.length - 1; i >= 0; i -= 1) {
      if (S.time > feedEntries[i].until) {
        feedEntries[i].line.remove();
        feedEntries.splice(i, 1);
      }
    }
    if (nodes.dmgdir.dataset.until && S.time > Number(nodes.dmgdir.dataset.until)) {
      nodes.dmgdir.style.opacity = '0';
    }
    nodes.vignette.style.opacity = p.health < 100 && p.alive ? String(0.55 * (1 - p.health / 100)) : '0';
    const blindLeft = Math.max(0, p.blindUntil - S.time);
    nodes.flash.style.opacity = blindLeft > 0 ? String(Math.min(1, blindLeft / 1.2)) : '0';
    nodes.scope.style.display = S.scoped && p.alive ? 'block' : 'none';

    refreshChannel(p);
    writeText(nodes.hint, 'hint', hintText(p));
    if (shopOpen && S.phase !== 'buy') setBuy(false);
    if (shopOpen) writeText(nodes.buyMoney, 'buy-money', `$${p.money}`);
    paintMinimap();
    if (nodes.scoreboard.style.display === 'block') paintScoreboard();
  }

  return { consume, refresh, setBuy, isBuyOpen: () => shopOpen, showBanner };
}
