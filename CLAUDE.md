# Spiral Paint

A paint app where users colour the regions formed by crossing logarithmic
spirals instead of pixels. Vanilla TypeScript, SVG rendering, Bun for
everything (no Vite, no UI framework). `PLAN.md` holds the maths and design
rationale; read it before changing anything in `src/geometry/`.

## The core idea (don't lose this)

In log-polar coordinates (u = ln r, φ unwrapped) each spiral is a straight
line: CW spirals are `s = u − bφ = const`, CCW are `t = u + bφ = const`. So the
regions are cells of a skewed lattice with exact integer ids, plus one centre
region. Topology is **derived analytically, never discovered numerically**:
don't introduce pixel flood fill, generic intersection finding or DOM hit
testing. Earlier attempts at this project failed exactly that way. Floating
point is only used to draw cells and clip them to the canvas.

## Layout

- `src/geometry/`: pure, no DOM. Lattice, centre models (`startRadius` |
  `origin`, pluggable via `centreModel.ts`), edge sampling, clipping
  (`clip.ts` is the only file that knows about `polyclip-ts`), regions,
  analytic `locate()`, adjacency.
- `src/model/`: pure, no DOM. Document colours, undo history, paint and fill
  tools, `.spiral` file format.
- `src/render/`: SVG and PNG export, built from the model, not the DOM.
- `src/ui/`: thin DOM layer (app controller, canvas view, viewport, dialog).
- `tests/`: `bun test`, including a raster-oracle check of the geometry.
- `scripts/`: `e2e.ts` (headless Chrome via Playwright) and `render.ts`
  (headless PNGs via resvg) for visual checks.

## Invariants worth protecting

- Neighbouring cells must share **bit-identical** edge points (edges are cached
  under canonical keys). Seamless rendering depends on this: all regions of one
  colour are drawn as a single path so shared edges cancel.
- Region ids (`"c"` for the centre, `"i,j:piece"` for cells) are only meaningful
  together with the config, which is always saved alongside them.
- Geometry changes must keep the area-partition, raster-oracle and adjacency
  tests green across the whole config matrix.

## Verifying changes

`bun test`, `bun run typecheck`, `bun run e2e` for anything touching
interaction, and `bun run render` then look at the PNGs for visual changes.
Claude in Chrome is unavailable on this machine; headless Chrome through
Playwright (`channel: "chrome"`) works.

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
