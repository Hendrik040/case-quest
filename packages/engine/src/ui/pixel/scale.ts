// Integer nearest-neighbor zoom factor for the 240x160 logical canvas
// (Gen-3 GBA idiom: whole-pixel scaling only, no smoothing). Memoized on
// first call so every consumer (Phaser's game config, CSS via --px) agrees
// on one factor for the life of the page; a resize will not rescale a
// running session, matching the fixed-viewport handheld feel.
let cached: number | null = null;

export function zoom(): number {
  if (cached !== null) return cached;
  const z = Math.max(2, Math.min(Math.floor(window.innerWidth / 240), Math.floor(window.innerHeight / 160)));
  document.documentElement.style.setProperty("--px", `${z}px`);
  cached = z;
  return z;
}
