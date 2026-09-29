# Spiral Paint

A paint program where, instead of pixels, you colour the regions formed by
crossing logarithmic spirals (`r = a·e^(bθ)`). Built with Bun and vanilla
TypeScript, rendered as SVG.

```bash
bun install
bun run dev        # http://localhost:3000 (hot reload)
bun run build      # static bundle in dist/
bun test           # geometry + model tests (incl. a raster oracle)
bun run e2e        # drives the real app in headless Chrome (needs Google Chrome installed)
bun run render     # headless PNG renders of sample images (out/renders)
bun run typecheck
```

## Using it

| | |
|---|---|
| Paint (P) | click or drag to colour regions |
| Fill (B / F) | flood-fill connected regions of the same colour |
| Pick (I, or Alt+click) | take a region's colour |
| Undo / Redo | ⌘/Ctrl+Z, ⌘/Ctrl+Shift+Z or Ctrl+Y |
| Zoom | mouse wheel, + / −, 0 to fit |
| Pan | Shift+drag or middle-drag |
| Spiral lines | L |
| Files | N / ⌘/Ctrl+N new, ⌘/Ctrl+O open, ⌘/Ctrl+S save `.spiral`, ⌘/Ctrl+E export PNG; SVG and 2× PNG in the toolbar |

The current image is autosaved in the browser and restored on reload.

## How it works

See [PLAN.md](PLAN.md). In short: in log-polar coordinates every spiral is a
straight line, so the regions are cells of a skewed lattice with exact integer
ids. Topology is derived, never discovered numerically; floating point is only
used to draw cells and clip them to the canvas.

## Deployment

Every push to `main` runs `.github/workflows/pages.yml`: typecheck, tests,
build, then deploy of `dist/` to GitHub Pages. Asset paths are relative, so the
app works under `https://<user>.github.io/spiral-paint/`.
One-time setup: repo **Settings → Pages → Source: GitHub Actions**.
