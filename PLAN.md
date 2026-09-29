# Spiral Paint — Implementation Plan

Status: **Part 2 implemented** (multiple centres, lines, spirals to the centre). Part 1's engine now lives in `tests/analytic/` as an oracle. See §9 and §14 for deviations.
Spike code: `spike/` (throwaway, but the maths in it is what this plan formalises).

---

## 1. Decisions (from the grilling session)

| # | Decision |
|---|----------|
| Stack | Bun only: `Bun.serve` + HTML import for dev, `bun build` for a static bundle, vanilla TS, SVG rendering, `bun test`. No Vite, no framework. |
| Spirals | `r = a·e^(bθ)`, θ ≥ 0. `n ∈ [2,12]`. Spiral `k` has offset `2πk/n`, direction `+1` (CW) for even k, `−1` (CCW) for odd k. Odd n ⇒ unequal families (lopsided, accepted). |
| Extent | No "turns" parameter. Every spiral runs past the farthest canvas corner. |
| Config | width, height, n, start radius `a`, growth rate `b`, centre model. Fixed for the life of an image. New Image dialog has a live preview + region count. |
| Region | A connected component of (canvas rectangle) − (spiral curves). The canvas edge is a boundary; a cell cut into several pieces by the edge becomes several regions. Loose spiral ends ("slits") do not split a region. |
| Centre | Two interchangeable centre models (see §3.5): **startRadius** (default; spirals start at `a`, one star-shaped centre region) and **origin** (spirals come from the centre; sub-pixel cells merged into one blob). |
| Tools | Paint (click/drag, drag path interpolated), Bucket (4-neighbour: shares an edge, same current colour), Eyedropper, colour picker + small palette. |
| History | Undo/redo, one step per stroke / fill. Not persisted. |
| View | Wheel zoom about cursor, pan with Shift-drag or middle-drag, toggle spiral lines. |
| Files | `.spiral` JSON (`version`, config, colours), open, PNG export, SVG export. |
| Extras | Keyboard shortcuts, localStorage autosave. |
| Testing | Chrome automation unavailable on this machine → headless checks (resvg rasterisation read back as images); a handoff doc for interactive browser testing on another machine. |

---

## 2. Why this is hard, and why earlier attempts failed

The obvious approaches are all subtly broken:

* **Pixel flood fill** on a rasterised drawing: anti-aliasing and line thickness leak or seal cells, tiny cells near the centre vanish, speckle components appear at crossings (the spike's raster oracle produces exactly these single-pixel artefacts), and output is resolution-dependent.
* **Generic planar arrangement** of sampled polylines (find all intersections, build a DCEL, trace faces): numerically fragile — near-tangent crossings close to the centre, duplicated vertices, missed intersections between sample segments, faces that don't close.
* **Assuming a simple grid in screen space**: the cells are curved, wrap around the centre, cells can be pinched (n=2), the canvas edge cuts cells into several pieces, and the centre is a special region full of loose spiral ends.

This plan avoids all three by never *discovering* the topology numerically: the topology is derived exactly from a change of coordinates, and floating-point geometry is only used to *draw* and *clip* already-known cells.

---

## 3. The mathematics

### 3.1 Log-polar coordinates turn spirals into straight lines

Let the centre be `c = (W/2, H/2)` in SVG coordinates (y down; increasing φ is visually clockwise). For a point at polar `(r, φ)` define `u = ln r`. Work on the *universal cover*: `φ ∈ ℝ` (not wrapped), with the identification `φ ~ φ + 2π`.

Spiral k: `r = a e^(bθ)`, `φ = o_k + d_k θ`, θ ≥ 0, so `u = u₀ + bθ` with `u₀ = ln a`.

* CW (d = +1): `θ = φ − o_k` ⇒ `u − bφ = u₀ − b·o_k`. Define **`s = u − bφ`**. Each CW spiral is a line `s = const`.
* CCW (d = −1): `θ = o_k − φ` ⇒ `u + bφ = u₀ + b·o_k`. Define **`t = u + bφ`**. Each CCW spiral is a line `t = const`.

Inverse: `u = (s + t)/2`, `φ = (t − s)/(2b)`.

On the cover, each spiral lifts to infinitely many parallel lines (one per turn) — the whole family is periodic with period **`P = 2πb`**:

* CW lines: `S = { σ_k + mP }` with `σ_k = u₀ − b·o_k` for even k, m ∈ ℤ.
* CCW lines: `T = { τ_k + mP }` with `τ_k = u₀ + b·o_k` for odd k.

Consequences (all exact, no numerics):

1. **Same-family spirals never intersect** (parallel lines). All crossings are CW×CCW.
2. **Every CW line crosses every CCW line exactly once** (on the cover) — crossings are lattice vertices `(s_i, t_j)`.
3. The plane is tiled by **parallelograms** `cell(i,j) = { s_i < s < s_{i+1}, t_j < t < t_{j+1} }`, where `s_i`, `t_j` are the sorted line positions. Spacing may be uneven (odd n), which is fine.
4. Going once around the centre (`φ → φ + 2π`) maps `(s,t) → (s − P, t + P)`, i.e. **`(i, j) ~ (i − n_cw, j + n_ccw)`**. Canonical ID: shift `i` into `[0, n_cw)`: `q = ⌊i / n_cw⌋`, `id = (i − q·n_cw, j + q·n_ccw)`.
5. The map `(φ mod 2π, u) → (x, y)` is a bijection from the cylinder onto the punctured plane, so a cell that is simple on the cylinder is a simple polygon on screen. A cell's φ-width is `(Δs + Δt)/(2b) ≤ 2π`, with equality only when `n_cw = n_ccw = 1` (n = 2) — then the cell is **pinched** (touches itself at one vertex). Handled; tested.

Line positions are stored as sorted base arrays `sBase` (length `n_cw = ⌈n/2⌉`), `tBase` (length `n_ccw = ⌊n/2⌋`) reduced mod P; `s_i = sBase[i mod n_cw] + ⌊i/n_cw⌋·P`. Index lookup `sIndex(x)` = largest i with `s_i ≤ x`.

### 3.2 Which cells are closed

Spiral segments exist only for `u ≥ u₀` (θ ≥ 0), and extend to +∞.
All four edges of `cell(i,j)` lie at or above its bottom vertex `u_bot = (s_i + t_j)/2`, so:

> **cell(i,j) is closed ⇔ s_i + t_j ≥ 2u₀.**

(Equality would require a CW and a CCW spiral to start at the same point, i.e. equal offsets — impossible. So there is no boundary case.)

Cells with `s_i + t_j < 2u₀` are **open**: part of their boundary is missing below `u₀`, and every such cell reaches the disc `u < u₀` (which contains no curves). All open cells and the disc therefore form **one connected region: the centre region**. Loose spiral ends inside it are slits and do not split it.

### 3.3 The centre region is `{ u < g(φ) }` — a staircase

Moving straight outward (φ fixed, u increasing) increases both s and t, so `i`, `j`, and hence `u_bot`, are non-decreasing. So closedness is monotone along every ray, and the centre region is star-shaped w.r.t. the centre: `{ (φ,u) : u < g(φ) }`.

In (s,t) space its boundary is a staircase. For column i let
`j*(i) = min { j : t_j ≥ 2u₀ − s_i }` (first closed cell in column i). The boundary polygon, over one period `i = 0 … n_cw − 1`, visits the vertices
`(s_i, t_{j*(i−1)}) → (s_i, t_{j*(i)}) → (s_{i+1}, t_{j*(i)}) → …`
alternating CW segments (along `s = s_i`) and CCW segments (along `t = t_{j*(i)}`), skipping zero-length ones. Closure after one period follows from `j*(i + n_cw) = j*(i) − n_ccw`.

Closed cells in column i are exactly `j ≥ j*(i)`, which is also how cells are enumerated.

### 3.4 Clipping to the canvas

Let `R = |c − corner|` (distance to the farthest corner), `u_R = ln R`. Enumerate canonical cells `i ∈ [0, n_cw)`, `j = j*(i), j*(i)+1, …` while `u_bot < u_R`. Any cell with `u_bot ≥ u_R` lies wholly outside the canvas.

For each cell (and the centre region):

1. Build its polygon by sampling its 4 edges (§3.6).
2. Bounding box fully inside canvas → keep as is (the vast majority; no clipper call).
3. Bounding box disjoint from canvas → drop.
4. Otherwise → intersect with the canvas rectangle using **`polyclip-ts`** (maintained successor of `polygon-clipping`). Each resulting polygon is a separate **piece** → separate region. Drop pieces with area < 1e-6 px² (float slivers).

The centre region ∩ rectangle is star-shaped ∩ convex-containing-centre ⇒ always exactly one piece.

The clipper is hidden behind a one-function interface (`clipToRect(ring) → ring[][]`) so it can be swapped (`clipper2-js` is the fallback).

### 3.5 Centre models (pluggable)

The lattice needs two numbers from the centre model:

* `uPhase` — where the lines are (always `ln a`; it sets line positions σ_k, τ_k).
* `uInner` — the cutoff used in the closed-cell test (`s_i + t_j ≥ 2·uInner`) and where spiral *lines* start being drawn.

| model | `uInner` | notes |
|-------|----------|-------|
| `startRadius` (default) | `ln a` | Exactly §3.2–3.3. |
| `origin` | `ln r_cut` with `r_cut = cutoffPx / min(Δu_min, Δφ_min)` | Spirals extend to θ → −∞ (reach the centre). Cells smaller than ~`cutoffPx` (default 1.5 px) are merged into one centre blob using the *same staircase code*. In this model `a` only rotates the pattern (`a·e^(bθ)` over all θ ∈ ℝ is a rotation of `e^(bθ)`), so the dialog hides it. |

Because both models reduce to "lattice + `uInner`", everything downstream (enumeration, staircase, lookup, adjacency, rendering) is shared. Switching model is a config field; region IDs are only meaningful together with the config, which is always saved alongside.

### 3.6 Sampling edges (drawing curves as polygons)

An edge is a piece of one lattice line between two u-values. Sample uniformly in u with a count chosen so the chord error ("sagitta") stays under ε:
curvature of a log spiral at radius r is `1/(r·√(1+b²))`, so `Δθ = √(8ε / (r_max·√(1+b²)))`, `Δu = b·Δθ`.
`ε = 0.02` canvas px (max zoom 32× ⇒ ≤ 0.64 screen px error).

**Shared edges must be byte-identical in both neighbouring cells.** Passing "the same inputs" is *not* enough: across the 2π seam, cell (0, j)'s left neighbour canonicalises to (n_cw−1, j+n_ccw), whose right edge lies on `s_{n_cw} = s_0 + P` — the same curve with different numbers (≈1e-13 px apart). So edges are **keyed canonically and cached**: an edge is `(family, lineIndex, fromCrossIndex)` reduced by the deck transformation so `lineIndex ∈ [0, n_family)`; it's sampled once (low u → high u) and both cells reuse the same array (reversed where needed). This also halves sampling work.

### 3.7 Point lookup (hit testing) — analytic

`locate(x, y)`:
outside rect → `null`; `r = 0` → centre; else `u = ln r`, `φ = atan2`, `s`, `t`, `i = sIndex(s)`, `j = tIndex(t)`; if `s_i + t_j < 2·uInner` → centre; else canonicalise `(i,j)`; if the cell has one piece → it; if several → point-in-polygon over the pieces, falling back to the nearest piece (a point can sit in the ≤ε gap between the true curve and its chord).

Used by paint, drag, bucket, eyedropper. Exact, O(log n), independent of the DOM and of the zoom level. SVG `pointer-events` are **not** used for hit testing.

### 3.8 Adjacency (for the bucket fill)

Two regions are adjacent if they share a boundary of positive length inside the canvas (corner contact and canvas-edge contact don't count).

Algorithm: for every closed cell, for each of its 4 edges, take probe points along the edge (the edge's own sample points, restricted to those strictly inside the canvas by a margin), step a tiny amount to each side **in (s,t) space** (`±η` perpendicular to the line family, η = 1e-7·P — exact sides, no normals), `locate` both sides, and record the pair if they differ. Edges bordering open cells naturally yield centre adjacency. This handles cells split by the canvas edge and edges that lie entirely outside the canvas (no probes ⇒ no adjacency) without special cases.

Cost: ≈ number of edge sample points (~10–35k) × 2 lookups — tens of ms, done once per config.

### 3.9 Region IDs

* Centre: `"c"`.
* Cell piece: `"i,j:p"` with canonical (i,j) and p = piece index, pieces sorted by (minX, minY) of their bounding box so IDs are deterministic across runs and library versions.

---

## 4. Evidence gathered during planning (spike)

`spike/check.ts` compares the analytic model against an **independent oracle**: rasterise the spirals at 4× supersampling, 4-connected flood fill, and for every raster component collect the analytic `locate()` of every pixel. Configs: n = 2, 3, 5, 6, 8, 12; start radius from tiny to large; square and wide canvases; b from 0.15 to 1.2.

| check | result |
|-------|--------|
| Σ area of all clipped region pieces vs W·H | 0.0000% error on every config (no gaps, no overlaps) |
| raster components containing >1 analytic ID ("impure") | **0** on every config |
| pieces per cell: clipper vs raster (both directions) | 0 mismatches |
| extra raster components | all 1-pixel crossing artefacts of the raster method, not real regions |
| performance (`spike/perf.ts`) | 1200×800 n=12: 396 cells, 55 ms. 1920×1080 n=12 b=0.08: 906 cells, 77 ms |
| visual | `spike/sample-render.png` — cells correct, edge clipping correct |

---

## 5. Architecture

```
index.ts                     Bun.serve dev server (HTML import, HMR)
build.ts                     bun build src/index.html → dist/
src/
  index.html, styles.css, main.ts
  geometry/                  pure, no DOM — fully unit-tested
    config.ts                SpiralConfig type, defaults, validation, limits
    lattice.ts               line families, sIndex/tIndex, canonical ids, (s,t)↔(x,y)
    centreModel.ts           startRadius | origin → { uPhase, uInner, lineStartU }
    sample.ts                edge sampler (ε), spiral polyline sampler
    clip.ts                  clipToRect() — the only file importing polyclip-ts
    regions.ts               buildRegions(config) → RegionSet {regions, byId, locate, neighbours}
    adjacency.ts
    polygon.ts               area, bbox, point-in-polygon, nearest
  model/                     pure, no DOM — unit-tested
    document.ts              {config, colours: Map<id, hex>}; default colour white
    history.ts               Command = Map<id,{before,after}>; undo/redo stacks
    tools.ts                 paintStroke (interpolated segment → ids), bucketFill (BFS), pick
    fileFormat.ts            serialise / parse / validate .spiral
  render/
    svg.ts                   region paths + spiral line paths; exportSvg(doc, opts) → string
    png.ts                   SVG string → <img> → <canvas> → PNG blob
  ui/
    app.ts                   wiring, state, re-render on change
    viewport.ts              viewBox zoom/pan, screen↔canvas coords
    toolbar.ts, palette.ts, newImageDialog.ts (live preview + count), shortcuts.ts, autosave.ts, download.ts
tests/                       bun test: geometry oracle, adjacency, tools, history, file format
scripts/render.ts            headless: config → export SVG → PNG via @resvg/resvg-js (dev dep) for visual checks
```

Key rule: **geometry and model never touch the DOM**. The UI is a thin layer; the SVG is a view of `RegionSet` + `Document`.

### Rendering details

* One `<path>` per region piece (fill = colour, `fill-rule="evenodd"`), stored in a `Map<id, SVGPathElement>` for O(1) recolouring.
* **Seams**: adjacent anti-aliased paths show hairline gaps. Each region path is also stroked in its own fill colour at 0.75 px with `vector-effect: non-scaling-stroke`, so the cover stays constant at any zoom.
* Spiral lines: a separate `<g>` with `pointer-events: none`, `non-scaling-stroke`, drawn from `lineStartU` to beyond `u_R`, clipped by a `<clipPath>` of the canvas rect. Visibility toggle = `display` on that group.
* Zoom/pan by rewriting the root `viewBox` (zoom 0.1×–32×, about the cursor).
* Export builds a **fresh** SVG string from the model (not a DOM clone): canvas-size viewBox, regions, optionally lines (follows the current toggle).
* PNG export: 1× and 2× (menu entries).
* Export SVG must not rely on `vector-effect` (support in rasterisers/other viewers is patchy): at export time stroke widths are written as plain values for the export scale.

### Interaction details

* Pointer → canvas coords via `svg.getScreenCTM().inverse()`.
* Paint drag: on each pointermove, walk the segment from the previous point in steps of 0.5 screen px (converted to canvas units) and `locate` each step — fast drags don't skip regions. The whole drag becomes one Command.
* Bucket: BFS over adjacency among regions whose colour equals the clicked region's colour; no-op if already the target colour.
* Eyedropper: sets current colour; `Alt`-click with paint/bucket does the same temporarily.
* Pan: Shift+left drag or middle drag (`preventDefault` on middle `pointerdown` to suppress autoscroll).
* Shortcuts: `P` paint, `B`/`F` bucket, `I` eyedropper, `L` lines, `0` fit view, `+`/`-` zoom, `⌘/Ctrl+Z` undo, `⇧⌘Z`/`Ctrl+Y` redo, `⌘/Ctrl+S` save, `⌘/Ctrl+O` open, `⌘/Ctrl+N` new, `⌘/Ctrl+E` export PNG.
* Autosave: debounced 500 ms after each command, localStorage key `spiral-paint:autosave` = the `.spiral` JSON; restored on load; all access wrapped in try/catch.

### File format (`.spiral`, version 1)

```json
{
  "format": "spiral-paint",
  "version": 1,
  "config": { "width": 1200, "height": 800, "spiralCount": 8, "startRadius": 10,
              "growthRate": 0.25, "centreModel": "startRadius" },
  "colours": { "c": "#ffcc00", "3,7:0": "#3366ff" }
}
```
Parser validates types and ranges, rejects unknown `format`/newer `version` with a message, ignores (and counts) colour entries whose IDs don't exist in the rebuilt geometry. Colours are normalised to lowercase `#rrggbb`.

### Config limits

`width, height ∈ [100, 4096]`; `n ∈ [2, 12]`; `a ∈ (0, min(W,H)/2)` (else the centre region would cover everything); `b ∈ [0.02, 2]`. Region count ≈ `n_cw·n_ccw·(u_R − uInner)/(πb)`; the dialog shows the exact count from the real build and refuses configs over 20 000 regions. Defaults: 1200×800, n = 8, a = 10, b = 0.25.

---

## 6. Test strategy

Geometry (`tests/geometry.test.ts`), run over a config matrix (n = 2…12 incl. odd, tiny/huge a, small/large b, square/wide/tall canvases, both centre models):

1. **Area partition**: Σ piece areas = W·H (relative error < 1e-6).
2. **Raster oracle** (ported from spike, reduced resolution for speed): 0 impure components; pieces-per-cell agree both ways for components ≥ 4 px.
3. **Locate ↔ polygons**: random points (away from edges by > 2ε) — `locate` returns exactly the piece whose polygon contains the point, and exactly one piece contains it.
4. **Canonical IDs**: `canon(i + k·n_cw, j − k·n_ccw) = canon(i,j)`; lookup of points at φ = ±π agrees across the seam.
5. **Staircase**: `j*(i + n_cw) = j*(i) − n_ccw`; centre polygon closes; centre contains the canvas centre.
6. **Adjacency**: symmetric; every unclipped cell has exactly its 4 lattice neighbours (open ones mapped to `c`); independent check by probing along the raw spiral polylines (different sampling) gives the same edge set.
7. **Shared-edge identity**: for each closed cell, its edge arrays equal the reversed arrays of the neighbour's shared edge.
8. **Pinched n=2** and **odd n** cases explicitly.

Model: bucket fill (connected same-colour only, stops at other colours, corner contact doesn't leak), stroke interpolation, undo/redo sequences, file round-trip and rejection cases.

Visual: `scripts/render.ts` renders a set of configs (random colours, lines on/off, both centre models) to PNG with resvg; I inspect them.

Interactive (needs Chrome, other machine): handoff doc with a checklist — paint/drag, fast drag, bucket, eyedropper, zoom/pan, toggle, save/open round-trip, exports, autosave reload, shortcuts.

---

## 7. Phases

0. **Scaffold** — tsconfig (DOM lib), `src/`, dev server, build script, `bun test` running. Verify `bun build` with an HTML entry works on Bun 1.2.22.
1. **Geometry core** — config, lattice, centre models, sampler, clip, regions, locate. Tests 1–5, 7, 8. Gate: all green on the full matrix.
2. **Adjacency** — test 6.
3. **Model** — document, history, tools, file format + tests.
4. **Render + viewport** — SVG view, zoom/pan, lines toggle, seam handling. Headless visual check of export SVG.
5. **UI** — toolbar, palette, colour picker, tools wired, new-image dialog with live preview + count.
6. **Files & export** — save/open, SVG/PNG export, autosave, shortcuts.
7. **Verification** — full test run, headless renders, write `HANDOFF.md` for interactive Chrome testing on the other machine.

---

## 8. Self-critique — risks and how they're handled

| Risk / doubt | Assessment |
|--------------|------------|
| "The lattice is too simple a model" — the thing that sank earlier attempts. | The model is derived, not assumed (§3.1–3.3), and the spike checks it against an independent raster oracle on 7 varied configs with zero disagreement. The oracle becomes a permanent test. |
| Direction convention (CW vs CCW in y-down SVG). | Cosmetic only: swapping it mirrors the image. Test: a point on spiral 0 at θ = π/2 is at φ = +π/2, i.e. visually clockwise from φ = 0 in SVG coordinates. |
| Odd n / uneven spacing. | Lattice handles arbitrary sorted line positions; n = 3 and 5 are in the spike. |
| n = 2 pinched cells break the clipper or PIP. | Passed in spike (area exact). Explicit test. |
| Canvas edge splitting cells into multiple pieces. | Clipper returns a multipolygon; pieces are separate regions with deterministic IDs. Oracle confirms piece counts. |
| Float slivers from the clipper when a cell vertex lies on the canvas edge. | Drop pieces < 1e-6 px²; area-partition test catches loss. |
| Rendered chord vs true curve disagreement (click lands in one colour, analytic says the neighbour). | ε = 0.02 px ⇒ disagreement band < 0.64 screen px even at 32× zoom. Acceptable; documented. |
| Huge region counts (tiny b, tiny a, origin model). | Exact count shown in dialog; hard limit 20 000. Sub-pixel cells in startRadius mode near the centre are real regions and reachable by zooming. |
| Seams between same-coloured neighbours when lines hidden. | Self-coloured non-scaling stroke. Checked in headless render. |
| Performance of 20k `<path>` elements. | Recolouring is O(1) per region via id map; initial build ~100–300 ms at the limit. Acceptable for a config-change-only cost. |
| Saved IDs depending on clipper output order. | IDs derived from lattice indices + sorted piece order, not output order. |
| The origin model's cutoff is heuristic. | Deliberately isolated in `centreModel.ts`; it's the experimental option the user asked to compare. |
| Bun HTML-import build quirks. | Verified first, in phase 0, before anything depends on it. |
| Shared edges not identical across the 2π seam (found in plan review). | Canonical edge keys + edge cache (§3.6); test 7 compares cached arrays. |
| Main-thread stall building ~20k regions + adjacency (est. up to ~1 s). | Measure in phase 1 at the limit; if > 300 ms, move `buildRegions` into a Worker (it's pure, so this is mechanical). |
| White vs "unpainted". | White is the default; painting white deletes the map entry, so files and undo stay canonical. |
| Things I can't verify here (real pointer interaction). | Explicit handoff checklist rather than claiming it works. |

Open items deliberately deferred: editing config after creation (colours can't map cleanly), persisted history, eraser.

---

## 9. Implementation notes (what changed during the build)

| Plan said | What happened | Why |
|-----------|---------------|-----|
| Adjacency probes the midpoint of each sample segment (§3.8). | Probes the midpoint of the part of each chord **inside the canvas** (Liang–Barsky). | The independent raw-spiral test found cells clipped by the canvas edge into ~0.7 px slivers that got no neighbours, so bucket fill would stall there. |
| Seams hidden by a 0.75 px self-coloured stroke per region. | Regions are drawn **one path per colour** (rings oriented consistently, nonzero fill), over a 1 px same-colour outline underlay. | Measured with resvg: per-region strokes still left ~12k faint seam pixels. Grouping makes shared edges cancel exactly in the rasteriser (0 seam pixels — possible only because shared edges are bit-identical, §3.6); the underlay stops the background showing through between *different* colours. |
| Uniform-in-u edge sampling. | Uniform in w = e^(u/2). | Keeps the chord error at exactly ε at every radius (fewer points far out, enough near the centre). |
| Worker if build > 300 ms. | Not needed. | Default config 46 ms; 4096×4096, n=12, b=0.03 (3 047 regions) 307 ms + 46 ms adjacency, only on New/Open. |
| Origin-model raster oracle at 4×. | Runs at 16× on a smaller canvas. | The origin centre blob is ~7 px across; at 4× the raster's line thickness splits it. Confirmed single component at 16×. |
| Interactive checks via a handoff to another machine. | `scripts/e2e.ts` drives the real app in **headless Google Chrome via Playwright** (no extension/login needed): click, fast drag, undo/redo, eyedropper, lines, wheel zoom anchoring, shift/middle pan, save/open, SVG/PNG/2× export, autosave reload, bucket fill, New dialog validation, max-zoom clicks on a 1.7 px² centre cell and a 1 px² edge sliver. | Headless Chrome works on this machine even though Claude in Chrome doesn't. |

Not verified automatically: real trackpad pinch-zoom feel, Safari/Firefox, and very long painting sessions.

---

# Part 2 — Multiple centres, straight lines, spirals to the centre

## 10. Decisions (grilling round, all defaults accepted)

| # | Decision |
|---|----------|
| Elements | **Spiral groups** (centre, count, growth, rotation, direction pattern alternate/cw/ccw — all per group) and **lines** (infinite or segment). Sampler-per-type so circles etc. can follow. |
| Placement | New/Edit Scene dialog: element list + numeric fields + presets (single, 2×2 square, row of 3, …) + live preview. Drag-to-place later. |
| Editing | Scene is editable after painting. Colours carry over best-effort via each old region's interior point; the edit is one undo step. |
| Centres | Start-radius model removed. Spirals run into the centre; each group is cut at a radius where its arms are ~1.5 px apart, and the (tiny) area inside is merged into one centre region. Centres may be off-canvas. |
| Tiny regions | Regions < 1 px² are merged into the neighbour sharing the longest border. |
| Files | `.spiral` v2; v1 files are rejected with a clear message. |

## 11. Why the Part 1 engine can't be extended, and what replaces it

The lattice trick needs one shared centre. With several centres (or lines), curves
aren't straight in any common coordinate system, so the topology can't be written
down; it must be computed. That is the approach that sank earlier attempts, so the
design is driven by robustness.

**Rejected: thin-strip subtraction with Clipper2** (canvas minus very thin strips around every curve). Spiked: the JS port took 2.7 s (2×2 scene) to 6.5 s, and returned wrong offset areas and a failed polytree on a trivial case. Too slow and untrustworthy.

**Chosen: an exact planar arrangement of the sampled polylines** (`src/geometry/arrangement.ts`).

The *model* is the arrangement of the ε-accurate polylines (not of the ideal curves). Everything — rendering, hit testing, adjacency — uses that same model, so it's self-consistent by construction.

1. **Sample** each element to polylines (ε = 0.02 px). Spiral groups: r from r_cut to past the farthest canvas corner.
2. **Jitter** every input vertex by a deterministic ~1e-7 px. This removes accidental exact degeneracies (duplicate lines, a line exactly on the canvas edge, three curves through one point) with probability 1; what they'd produce instead is sub-pixel slivers, which step 8 merges.
3. **Clip** polylines to the canvas. Entry/exit points are snapped exactly onto the border and given a perimeter coordinate. This is the one *intended* degeneracy, and it's handled by construction, never by predicate.
4. **Find crossings** between segments of different pieces with a uniform grid, decided by **exact `orient2d`** (`robust-predicates`): proper crossing ⇔ strict sign changes both ways. The crossing's position (float) is only used for drawing.
5. **Build a half-edge graph**: nodes are crossings, dangling ends (spiral starts, segment ends), border points and canvas corners; each edge carries its polyline. Outgoing edges are sorted by angle at each node using the **parent segment's direction**, not the approximate crossing coordinates. Dangling ends make slits (the edge's two sides belong to the same face) — exactly the "slit doesn't split a region" rule.
6. **Trace faces** (`next` = next clockwise from twin). Positive cycles are faces; the cycle outside the canvas is dropped; negative cycles of components that don't touch the border (a floating segment) become holes of the smallest face containing them.
7. **Adjacency** comes from twin half-edges (shared border length is summed per pair). No probing; corner contact is never adjacency.
8. **Merge tiny faces** (< 1 px²) into the neighbour with the longest shared border, smallest first (union-find).
9. **Locate** by a uniform grid over face bounding boxes + point-in-polygon; a point exactly on an edge falls back to the nearest face.

Neighbouring faces share the same node and edge-polyline coordinates, so the seamless "one path per colour" rendering from Part 1 keeps working.

### Spiral cutoff radius
Arms of the same direction are `Δφ = 2π / (number of arms in that direction)` apart; at radius r they're `r·b·Δφ/√(1+b²)` px apart. `r_cut = 1.5·√(1+b²)/(b·Δφ)` — the same formula as Part 1's origin model, so the analytic engine is a valid oracle for single-group scenes.

## 12. Verification

* **Analytic oracle**: the Part 1 lattice engine moves to `tests/` and stays as an oracle. For single-group scenes (a = 1, origin model) every analytic region must correspond to exactly one face with matching area, and adjacency must match.
* **Raster oracle** (generalised to any scene): 0 impure components, piece counts agree.
* **Structural invariants**: every half-edge in exactly one cycle, twins symmetric, Σ face areas = W·H, adjacency symmetric.
* **Degenerate scenes**: duplicate elements, line along the canvas edge, line through a spiral centre, floating segment (hole), centre off-canvas, centre on a corner, two groups on the same centre, parallel lines.
* **e2e** updated for the scene editor and scene edits with colour carry-over.
* **Performance budget**: typical 2×2 scene rebuild < 300 ms; move to a Worker if exceeded.

## 13. Model and file changes

* `Scene { width, height, elements[] }` replaces `SpiralConfig`.
* Region ids are runtime-only (`r0…`, deterministic order). Files store colours as `{x, y, colour}` at an interior point of each painted region (pole of inaccessibility), so saved images survive engine changes; loading = `locate` each point.
* Scene edits: History gains a "scene" command holding the before/after documents; colours are re-attached by interior point.

## 14. Part 2 implementation notes

| Finding | Resolution |
|---------|------------|
| Performance: 2×2 preset (1 351 regions) builds in ~28 ms, dense 2×2 (12 arms, b = 0.15; 6 605 regions) in ~73 ms. | No Worker needed; the scene dialog rebuilds live on every edit. |
| The cutoff formula assumed arms of one direction are evenly spaced; with odd alternating counts they aren't (n = 7: gaps of 4π/7 and 2π/7). Caught by the analytic-oracle match. | Use the smallest actual angular gap within a direction. |
| Raster oracle at 4× misses slivers < ~0.65 px thick and pinches narrow necks; even 40× pinched a region with a genuine 0.097 px neck (a far spiral passing near without crossing). | Per-scene raster check asserts impurity + visible regions only; a 16× exact check runs on one multi-centre scene with neck-aware piece checks; and a **brute-force crossing sweep** (no grid, no robust predicates) must find exactly the engine's crossings in every scene — the direct check that no crossing is ever missed. |
| `<dialog>` fires `close` asynchronously; reopening immediately after Cancel let the stale event tear down the new session (buttons went dead). Found by e2e. | The close handler ignores events while the dialog is open again. |
| Duplicate elements, a line on the canvas edge, lines through centres, near-parallel lines, centres off-canvas or on a corner. | All produce zero degenerate predicate cases thanks to the jitter; slivers are merged. Covered in the test matrix. |
