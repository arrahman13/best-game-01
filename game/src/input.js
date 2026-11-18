// input.js — ears and hands. This module only *records*: which keys are
// down, which went down since the simulation last asked, how far the mouse
// travelled, whether the trigger and the aim button are held. The player
// controller polls it once per fixed step, so nothing about the game's
// timing depends on when the browser happened to deliver an event.
//
// Two kinds of key state are kept apart on purpose. `keys` is the level
// (is it down right now?) for movement; `tapped` is the edge (did it go
// down since I last looked?) for one-shot actions like reloading or
// swapping weapons, consumed through takePressed.
export function createInput(canvas, onLockChange) {
  const held = new Set();
  const tapped = new Set();
  const look = { x: 0, y: 0 };
  const state = { locked: false, firing: false, aiming: false };

  function releaseButtons() {
    state.firing = false;
    state.aiming = false;
  }

  window.addEventListener('keydown', (ev) => {
    if (ev.repeat) return; // auto-repeat is not a fresh press
    held.add(ev.code);
    tapped.add(ev.code);
    if (ev.code === 'Space') ev.preventDefault(); // keep the page from scrolling
  });
  window.addEventListener('keyup', (ev) => held.delete(ev.code));
  window.addEventListener('blur', () => {
    held.clear();
    releaseButtons();
  });

  canvas.addEventListener('mousedown', (ev) => {
    if (!state.locked) return; // clicks before lock belong to the menus
    if (ev.button === 0) state.firing = true;
    else if (ev.button === 2) state.aiming = true;
  });
  window.addEventListener('mouseup', (ev) => {
    if (ev.button === 0) state.firing = false;
    else if (ev.button === 2) state.aiming = false;
  });
  canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());

  window.addEventListener('mousemove', (ev) => {
    if (!state.locked) return;
    look.x += ev.movementX || 0;
    look.y += ev.movementY || 0;
  });

  document.addEventListener('pointerlockchange', () => {
    state.locked = document.pointerLockElement === canvas;
    if (!state.locked) releaseButtons();
    onLockChange(state.locked);
  });

  return {
    keys: held,
    get locked() { return state.locked; },
    get firing() { return state.firing; },
    get aiming() { return state.aiming; },
    // True exactly once per physical press of `code`.
    takePressed(code) {
      if (!tapped.has(code)) return false;
      tapped.delete(code);
      return true;
    },
    clearPressed() { tapped.clear(); },
    // Hand over the mouse travel since the last step and zero the slate.
    takeLook() {
      const out = { x: look.x, y: look.y };
      look.x = 0;
      look.y = 0;
      return out;
    },
    requestLock() { canvas.requestPointerLock(); },
    releaseLock() { if (state.locked) document.exitPointerLock(); },
  };
}
