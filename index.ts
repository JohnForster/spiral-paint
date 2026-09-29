import index from "./src/index.html";

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  routes: { "/": index },
  development: { hmr: true, console: true },
});

console.log(`Spiral Paint running at ${server.url}`);
