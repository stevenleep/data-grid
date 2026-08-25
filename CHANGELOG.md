# Changelog

## 0.2.0 - Unreleased

### Breaking changes since 0.1.0

- The distributed package now uses the `@stevenleep/data-grid` npm scope. Update package dependencies and all root/subpath/style imports from `@huiyun/data-grid`. The existing `huiyun.data-grid/v1`, `huiyun.data-grid/preferences/v1`, and default persistence key namespace remain unchanged so wire payloads and saved user preferences stay compatible.
- `GridOption.value` and schema option values no longer accept `null`; use an omitted filter value for “unset” and a string/number/boolean option identity for selectable values.
- Grid-owned row selection now rejects platform `selectedRowKeys`, `defaultSelectedRowKeys`, and `preserveSelectedRowKeys`. Observe Ant Design selection callbacks if needed, but keep selected-key ownership in the Grid instance.
- Invalid schema, query, result, persistence, projection, temporal, codec, and option payloads now fail at their documented protocol boundary instead of being silently accepted. Adapters that previously relied on coercion must normalize before crossing that boundary.
- `GridInstance` now exposes the required `getRuntimeRevision()` and `subscribeRuntime()` observable so definition, capability, and projection-runtime changes can update React consumers without fabricating data-state changes. Custom `GridInstance` implementations and typed test doubles must add these methods; prefer instances returned by `createGrid()`. `GridProvider` remains runtime-tolerant of 0.1 instances during migration.
- The supported runtime floor is Node.js 20.19. UI entrypoint consumers must explicitly install matching peers in the validated ranges: React/React DOM 18–19 and Ant Design/Ant Design Icons 6.x. Core-only consumers can omit all UI peers because they are now optional package peers.
- Controlled sources that declare `datasetKey` must now identify the dataset that produced each result with `resultDatasetKey`. Applications controlling entity-bound `state.data`, `state.selection`, `state.editing`, or `state.actions` must also pass `stateDatasetKey`. Keep external cache keys dataset-aware and update each payload with its provenance key; mismatched data is intentionally masked across tenant/project boundaries.

These changes were originally prepared under `0.1.1`, but the public `v0.1.0` contract already exists. They are therefore released as the pre-1.0 minor `0.2.0`; this repository does not ship breaking public API changes in patch versions.

### Added and changed

- Add explicit field capability resolution, relation cardinality metadata, and source/runtime-bound formula, lookup and rollup provenance with validated dependency graphs and correct projection expansion.
- Add `DataGridView`, stable default-layout slots, hook-safe AntD renderer/editor registries, explicit default-editor support checks, and reloadable field-option hooks.
- Separate logical `datasetKey` from remote `driverKey`; attribute dynamic Controlled results and errors with request provenance so retained or cloned rows cannot leak stale totals, cursors, summaries, facets, snapshots, or failures into a newer query.
- Capture all-matching snapshot revisions, invalidate selection across snapshot changes, and re-run current queries when hot-swapped transport or local execution callbacks alter semantics.
- Harden projection requests so row identity, required fields, raw transport keys, and field dependencies are always selected; ambiguous functional and path row keys now fail fast.
- Preserve decimal and money precision in local comparison, filtering, sorting, and Ant Design rendering.
- Give `date` calendar-day semantics and `dateTime` instant semantics across `Date`, Unix-millisecond and ISO representations; offsetless ISO values are UTC and Local query timezones no longer depend on the browser timezone.
- Validate and normalize built-in and custom filter value kinds, empty groups, JSON values, totals, rows, summary/facet elements, warnings, and cursor page metadata.
- Remove controlled-query callback echoes and add independently cancellable, shared async option loading.
- Harden Ant Design composition with safe protocol-node rendering, reactive standalone actions, explicit selection ownership, keyboard activation, accessible labels, pagination guards, and resize cleanup.
- Add V8 coverage gates; optional UI peers with a Core-only consumer; React 18/19, TypeScript 5.4/7, Node 20/26, and packed Vite compatibility checks; and a Demo gzip budget.
- Split npm Trusted Publishing into an unprivileged verified-artifact job and a minimal digest-checking OIDC publish job; add pinned Actions, Dependabot, a security policy, deterministic Vercel configuration, and first-publish guidance.
- Freeze all four public entrypoints with committed API reports; verify exact lower-bound React type packages, npm installs, client mount/hydration, React Server Components boundaries, and a packed Chromium consumer before publishing.
- Isolate controlled data, results, selection, editing and action state across repeated dataset changes; reset persistence preference domains before hydrating a new identity; serialize saves and expose `flushPersistence()`.
- Reset dataset-specific query and view state by default, require provenance for controlled query/view slices, and add an explicit `datasetTransition` policy for narrowly approved cross-dataset reuse while retaining column preferences.
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
