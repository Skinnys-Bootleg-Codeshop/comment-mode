# comment-mode

A self-contained, copyable browser module: a reader taps a sentence on an agent-made HTML
page and leaves a comment anchored to that text, so agents can read structured feedback
instead of guessing from chat. Project facts only; how Charles's agents work is in the
control centre (`~/agentic-revolution/docs/how-we-work.md`).

## Where things are

- `comment-mode.js`: the whole module. No runtime dependencies, no build step.
- `README.md`: usage and the storage plug-in contract. `CONTEXT.md`: the vocabulary this repo
  uses; read it before naming anything.
- `docs/adr/`: the decisions behind its shape. Standalone, hosts bring their own storage, and
  it ships as copyable source rather than a package (ADR 0003).
- `test/` and `examples/`: Playwright browser tests, node storage tests and demo pages.
  `package.json` holds dev tooling only.

## Commands

- `npm test`: browser tests (`playwright test`) then node storage tests.
- `npm run serve`: runs test/serve.js, the static server the browser tests use.

## Conventions

- Work is tracked in Linear, team FOR: the spec is FOR-438 and its tickets are children.
- Keep `comment-mode.js` copyable: no imports, no package dependencies.
