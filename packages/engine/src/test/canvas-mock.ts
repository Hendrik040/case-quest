// Vitest setup: minimal canvas stubs for jsdom-environment tests.
//
// App.tsx rasterizes pixel-art sprites at module scope (gridToDataURL →
// canvas.getContext("2d") + toDataURL). jsdom implements neither without the
// native `canvas` package, so give it just enough surface for the sprite
// pipeline: a 2D context that accepts fillStyle/fillRect, and a toDataURL
// that returns a stable placeholder. Node-environment tests have no
// HTMLCanvasElement and skip this entirely.
if (typeof HTMLCanvasElement !== "undefined") {
  HTMLCanvasElement.prototype.getContext = function getContext() {
    return {
      fillStyle: "",
      fillRect: () => {},
    } as unknown as CanvasRenderingContext2D;
  } as unknown as typeof HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.toDataURL = () => "data:image/png;base64,stub";
}
