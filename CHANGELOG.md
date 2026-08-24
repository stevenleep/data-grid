# Changelog

## 0.2.0 - Unreleased

### Breaking changes since 0.1.0

- `GridOption.value` and schema option values no longer accept `null`; use an omitted filter value for “unset” and a string/number/boolean option identity for selectable values.
- Grid-owned row selection now rejects platform `selectedRowKeys`, `defaultSelectedRowKeys`, and `preserveSelectedRowKeys`. Observe Ant Design selection callbacks if needed, but keep selected-key ownership in the Grid instance.
- Invalid schema, query, result, persistence, projection, temporal, codec, and option payloads now fail at their documented protocol boundary instead of being silently accepted. Adapters that previously relied on coercion must normalize before crossing that boundary.

These changes were originally prepared under `0.1.1`, but the public `v0.1.0` contract already exists. They are therefore released as the pre-1.0 minor `0.2.0`; this repository does not ship breaking public API changes in patch versions.

### Added and changed

- Harden projection requests so row identity, required fields, raw transport keys, and field dependencies are always selected; ambiguous functional and path row keys now fail fast.
- Preserve decimal and money precision in local comparison, filtering, sorting, and Ant Design rendering.
- Validate and normalize built-in and custom filter value kinds, empty groups, JSON values, totals, rows, summary/facet elements, warnings, and cursor page metadata.
- Remove controlled-query callback echoes and add independently cancellable, shared async option loading.
- Harden Ant Design composition with safe protocol-node rendering, reactive standalone actions, explicit selection ownership, keyboard activation, accessible labels, pagination guards, and resize cleanup.
- Add V8 coverage gates; optional UI peers with a Core-only consumer; React 18/19, TypeScript 5.4/7, Node 20/26, and packed Vite compatibility checks; and a Demo gzip budget.
- Split npm Trusted Publishing into an unprivileged verified-artifact job and a minimal digest-checking OIDC publish job; add pinned Actions, Dependabot, a security policy, deterministic Vercel configuration, and first-publish guidance.
- Freeze all four public entrypoints with committed API reports; verify exact lower-bound React type packages, npm installs, client mount/hydration, React Server Components boundaries, and a packed Chromium consumer before publishing.
- Isolate controlled data, results, selection, editing and action state across repeated dataset changes; reset persistence preference domains before hydrating a new identity; serialize saves and expose `flushPersistence()`.
- Reject capability contractions and incompatible view applications transactionally instead of silently dropping filters or sorts; keep queued events paired with their committed state snapshot.
- Make definition, capability and runtime projection changes observable without mutating `GridState`; protect pending search/filter/sort drafts from late hydration and align every Ant Design selection surface with Core request scope.
- Keep every subpath declaration self-contained with no forgotten exports; expose the root protocol aliases `GridPaginationState` and `GridTotalValue` beside the same-named AntD components, and type the CSS entry as side-effect-only.

## 0.1.0

- Headless TypeScript core, React bindings, and Ant Design 6 renderer with independent package subpaths.
- Semantic field and presentation column definitions, including grouped columns and JSON schema/runtime binding.
- Local, remote, and controlled sources with capability validation, cancellation, latest-wins requests, cache policy, projection, facets, summaries, and page correction.
- Nested filters, ordered sorting, search, offset/cursor pagination, cross-page selection, and all-matching selection.
- Slice-controlled state, named views, versioned persistence, async actions, centralized editing, validation, optimistic updates, and rollback.
- Fully composable toolbar, panel, table, cell, status, summary, and pagination primitives plus an official default recipe.
