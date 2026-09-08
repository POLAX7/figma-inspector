# figctx

`figctx` turns a locally exported Figma `.fig` file into a stable context
bundle for coding agents. It never calls the Figma API or uploads the design.

Requires Node.js 20 or newer.

```sh
npx -y figctx@0.1.0 extract design.fig --out .figctx/design
npx -y --package figctx@0.1.0 figctx-mcp --root "$PWD/.figctx/design"
```

For a global installation:

```sh
npm install --global figctx
figctx --help
figctx-mcp --help
```

See the [project README](https://github.com/symonbaikov/figma-free-mcp#readme)
for the bundle contract, MCP configuration, privacy guarantees, and examples.
