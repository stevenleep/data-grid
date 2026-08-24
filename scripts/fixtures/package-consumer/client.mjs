import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM(
  '<!doctype html><html><body><div id="mount"></div><div id="hydrate"></div></body></html>',
  {
    url: 'http://localhost/',
  },
);

const exposedGlobals = {
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  Element: dom.window.Element,
  HTMLElement: dom.window.HTMLElement,
  SVGElement: dom.window.SVGElement,
  Node: dom.window.Node,
  MutationObserver: dom.window.MutationObserver,
  ShadowRoot: dom.window.ShadowRoot,
  getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
};

for (const [name, value] of Object.entries(exposedGlobals)) {
  Object.defineProperty(globalThis, name, { configurable: true, value, writable: true });
}

const matchMedia = (query) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener() {},
  removeListener() {},
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {
    return false;
  },
});
Object.defineProperty(dom.window, 'matchMedia', { configurable: true, value: matchMedia });
Object.defineProperty(globalThis, 'matchMedia', { configurable: true, value: matchMedia });

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverMock;
dom.window.ResizeObserver = ResizeObserverMock;
globalThis.requestAnimationFrame = (callback) => setTimeout(() => callback(Date.now()), 0);
globalThis.cancelAnimationFrame = (handle) => clearTimeout(handle);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const React = await import('react');
const { createRoot, hydrateRoot } = await import('react-dom/client');
const { renderToString } = await import('react-dom/server');
const reactDomTestUtils = await import('react-dom/test-utils');
const { DataGrid, createLocalSource, defineGrid } = await import('@huiyun/data-grid');
const act = React.act ?? reactDomTestUtils.act;

const rows = [{ id: 'row-1', name: 'Client and hydration smoke' }];
const definition = defineGrid({
  id: 'client-runtime-smoke',
  rowKey: 'id',
  fields: [{ id: 'name', title: 'Name' }],
});
const initialData = {
  status: 'success',
  fetching: false,
  rows,
  total: { value: rows.length, accuracy: 'exact' },
  summary: [],
  facets: {},
  warnings: [],
};

function element(onRowClick) {
  return React.createElement(DataGrid, {
    definition,
    source: createLocalSource(rows),
    defaultState: { data: initialData },
    toolbar: false,
    footer: false,
    onRowClick,
  });
}

const mountContainer = document.getElementById('mount');
let rowClicks = 0;
const root = createRoot(mountContainer);
await act(async () => {
  root.render(element(() => (rowClicks += 1)));
  await Promise.resolve();
});
assert.match(mountContainer.textContent, /Client and hydration smoke/);
const row = mountContainer.querySelector('tr.ant-table-row');
assert.ok(row, 'Client mount emitted no Ant Design data row.');
await act(async () => {
  row.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
});
assert.equal(rowClicks, 1, 'Mounted DataGrid did not deliver the row interaction.');
await act(async () => root.unmount());

const hydrateContainer = document.getElementById('hydrate');
const hydrateElement = element();
const originalConsoleError = console.error;
try {
  // React 18 warns for library useLayoutEffect calls during this synthetic SSR pass. The
  // entry is a declared Client Component; hydration mismatches remain fatal below.
  console.error = (...arguments_) => {
    if (String(arguments_[0]).includes('useLayoutEffect does nothing on the server')) return;
    originalConsoleError(...arguments_);
  };
  hydrateContainer.innerHTML = renderToString(hydrateElement);
} finally {
  console.error = originalConsoleError;
}
const recoverableErrors = [];
let hydrationRoot;
await act(async () => {
  hydrationRoot = hydrateRoot(hydrateContainer, hydrateElement, {
    onRecoverableError: (error) => recoverableErrors.push(error),
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
});
assert.match(hydrateContainer.textContent, /Client and hydration smoke/);
assert.deepEqual(
  recoverableErrors,
  [],
  `Hydration reported recoverable errors: ${recoverableErrors.map(String).join('; ')}`,
);
await act(async () => hydrationRoot.unmount());

dom.window.close();
