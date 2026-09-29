# Spiral Paint

A paint program where, instead of pixels, you colour the regions formed by
crossing curves: groups of logarithmic spirals (`r = e^(bθ)`) around any number
of centres, plus straight lines and segments. Built with Bun and vanilla
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
| Scene (E) | edit the spiral groups and lines; colours carry over, and the edit can be undone |
| Files | N new (with layout presets), ⌘/Ctrl+O open, ⌘/Ctrl+S save `.spiral`, ⌘/Ctrl+E export PNG; SVG and 2× PNG in the toolbar |

The current image is autosaved in the browser and restored on reload.

## How it works

See [PLAN.md](PLAN.md). In short: every element is sampled into polylines
(within 0.02 px of the true curve), and the regions are the faces of an exact
planar arrangement of those polylines — crossings decided with exact
orientation predicates, faces traced from a half-edge graph, sub-pixel faces
merged into their neighbours. Single-centre scenes are checked against an
analytic engine in which every spiral is a straight line in log-polar space.

## Deployment

Every push to `main` runs `.github/workflows/pages.yml`: typecheck, tests,
build, then deploy of `dist/` to GitHub Pages. Asset paths are relative, so the
app works under `https://<user>.github.io/spiral-paint/`.
One-time setup: repo **Settings → Pages → Source: GitHub Actions**.
