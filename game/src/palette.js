// palette.js — every colour TIDEWALL wears, named once and shared by the
// WebGL scene, the HUD stylesheet and the minimap, so the three can never
// disagree about what dusk on this harbour looks like: slate water and
// concrete, one sodium-amber accent, rust against steel blue.
//
// The table is kept as name/hex rows and zipped into the exported object;
// the hex values themselves are the contract — other modules read them by
// name and the page's CSS variables mirror them.
const COLOUR_ROWS = [
  ['canvas', '#232a33'], // the sky over the yard, and the page behind it
  ['surface', '#2e3742'], // warehouse walls and raised panels
  ['hairline', '#46525f'], // railing and container-frame trim
  ['ink', '#ece7db'], // lit concrete, and the colour of text
  ['muted', '#9aa5ad'], // far steel, secondary labels
  ['accent', '#f2a33c'], // sodium amber — spent sparingly, always means "look"
  ['atk', '#c65a2e'], // Breakers rust
  ['def', '#4a6b8a'], // Wardens blue
  ['danger', '#e5484d'],
  ['ok', '#57ab5a'],
];

export const PALETTE = Object.fromEntries(COLOUR_ROWS);

// Weathered paint for the yard's boxes, listed as one string and split so
// the family reads as a paint chart rather than code.
export const CONTAINER_PAINTS = '#a34d2d #33566e #5c6e46 #8a6d3b #4a5560 #7a3b3b'.split(' ');
