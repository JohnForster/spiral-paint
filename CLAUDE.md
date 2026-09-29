# Spiral Paint

A paint app where users colour the regions formed by crossing curves (groups of
logarithmic spirals around any number of centres, plus straight lines) instead
of pixels. Vanilla TypeScript, SVG rendering, Bun for everything (no Vite, no UI
framework). `PLAN.md` holds the design rationale (Part 1: single-centre
analytic engine, Part 2: the current general engine); read it before changing
anything in `src/geometry/`.

## The core idea (don't lose this)

Regions are the faces of an **exact planar arrangement of the sampled
polylines** (`src/geometry/arrangement.ts`). Crossings are decided with exact
`orient2d` predicates, edge order around nodes uses parent segment directions,
and a tiny deterministic jitter removes accidental degeneracies. The polylines
*are* the model: rendering, hit testing and adjacency all use the same faces,
so they can't disagree. Don't introduce pixel flood fill, DOM hit testing, or
thin-strip/offset tricks (Clipper2 was tried and rejected, see PLAN.md §11).
Earlier attempts at this project failed on exactly this part.

## Layout

- `src/geometry/`: pure, no DOM. Scene model and presets, element samplers
  (`elements.ts`: spirals are cut near their centre, lines/segments),
  the arrangement, regions (tiny-face merging, `locate`, adjacency, interior
  points).
- `src/model/`: pure, no DOM. Document colours, undo history (colour steps and
  whole-document scene steps), paint and fill tools, `.spiral` v2 file format.
- `src/render/`: SVG and PNG export, built from the model, not the DOM.
- `src/ui/`: thin DOM layer (app controller, canvas view, viewport, scene dialog).
- `tests/`: `bun test`. `tests/analytic/` is the Part 1 lattice engine kept
  **only as an oracle**: single-centre scenes must match it region for region.
  `tests/oracle.ts` is a raster flood-fill oracle usable with either engine.
- `scripts/`: `e2e.ts` (headless Chrome via Playwright) and `render.ts`
  (headless PNGs via resvg) for visual checks.

## Invariants worth protecting

- Neighbouring faces share **bit-identical** edge points and outer rings share
  one orientation. Seamless rendering depends on this: all regions of one colour
  are drawn as a single nonzero path so shared edges cancel.
- Region ids (`r0`, `r1`, …) are runtime-only. Files and scene edits carry
  colours by an interior point per region, never by id.
- Geometry changes must keep green: area partition, the brute-force crossing
  sweep, the raster oracle, and the analytic-engine match.

## Verifying changes

`bun test`, `bun run typecheck`, `bun run e2e` for anything touching
interaction, and `bun run render` then look at the PNGs for visual changes
(the `*-flat.png` renders must be a single colour). Claude in Chrome is
unavailable on this machine; headless Chrome through Playwright
(`channel: "chrome"`) works.

## Bun

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or
  `pnpm run <script>`
- Bun automatically loads .env, so don't use dotenv.

### APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

### Testing

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

### Frontend

Use HTML imports with `Bun.serve()`. Don't use `vite`. HTML imports fully
support React, CSS, Tailwind.

Server:

```ts#index.ts
import index from "./index.html"

Bun.serve({
  routes: {
    "/": index,
    "/api/users/:id": {
      GET: (req) => {
        return new Response(JSON.stringify({ id: req.params.id }));
      },
    },
  },
  // optional websocket support
  websocket: {
    open: (ws) => {
      ws.send("Hello, world!");
    },
    message: (ws, message) => {
      ws.send(message);
    },
    close: (ws) => {
      // handle close
    }
  },
  development: {
    hmr: true,
    console: true,
  }
})
```

HTML files can import .tsx, .jsx or .js files directly and Bun's bundler will
transpile & bundle automatically. `<link>` tags can point to stylesheets and
Bun's CSS bundler will bundle.

```html#index.html
<html>
  <body>
    <h1>Hello, world!</h1>
    <script type="module" src="./frontend.tsx"></script>
  </body>
</html>
```

With the following `frontend.tsx`:

```tsx#frontend.tsx
import React from "react";

// import .css files directly and it works
import './index.css';

import { createRoot } from "react-dom/client";

const root = createRoot(document.body);

export default function Frontend() {
  return <h1>Hello, world!</h1>;
}

root.render(<Frontend />);
```

Then, run index.ts

```sh
bun --hot ./index.ts
```

For more information, read the Bun API docs in
`node_modules/bun-types/docs/**.md`.
