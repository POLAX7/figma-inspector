# Figma Inspector Fixtures

Fixtures in this directory must be synthetic data or authorized, redacted exports. They are not evidence of current Figma production behavior unless provenance is recorded.

Each fixture or sidecar metadata must record:

- `sourceType`: `synthetic`, `local-export`, or `api-response`
- `sourceSha256` when the source bundle or response input is available
- `schemaVersion` used to produce the expected output
- `nodeId` and whether the ID was redacted
- acquisition date and the test command consuming the fixture
- authorization and redaction status

Never include access tokens, Authorization headers, private image references, or unapproved design content. Synthetic fixtures must be named accordingly, for example `alert-shaped.synthetic.json`.

Real API contract fixtures are opt-in and must not run in the default unit-test command. They require explicit authorization and a report stating whether an API quota was consumed.

## Validation classification

The default test command reports static/unit, synthetic/mock contract, and local `.figctx` runtime evidence separately. Real Figma API QA is not implied by a passing default run and requires an authorized opt-in fixture. Visual parity is manual QA until a stable renderer and an explainable screenshot-diff tolerance are available; no pixel-perfect claim should be made from AST tests alone.
