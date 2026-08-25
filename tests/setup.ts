import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Node 26 exposes an experimental global localStorage getter that warns unless
// started with a file flag. Install a deterministic in-memory browser contract
// without touching that getter first.
const storageEntries = new Map<string, string>();
const testLocalStorage: Storage = {
  get length() {
    return storageEntries.size;
  },
  clear: () => storageEntries.clear(),
  getItem: (key) => storageEntries.get(String(key)) ?? null,
  key: (index) => [...storageEntries.keys()][index] ?? null,
  removeItem: (key) => storageEntries.delete(String(key)),
  setItem: (key, value) => storageEntries.set(String(key), String(value)),
};
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: testLocalStorage,
});

afterEach(() => {
  cleanup();
  testLocalStorage.clear();
});

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }),
});

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver = ResizeObserverMock;

type TestVirtualConsole = {
  listeners: (eventName: string) => Array<(...arguments_: unknown[]) => void>;
  on: (eventName: string, listener: (...arguments_: unknown[]) => void) => void;
  removeAllListeners: (eventName: string) => void;
};

const virtualConsole = (
  globalThis as typeof globalThis & {
    jsdom?: { virtualConsole?: TestVirtualConsole };
  }
).jsdom?.virtualConsole;

if (virtualConsole) {
  const jsdomErrorListeners = virtualConsole.listeners('jsdomError');
  virtualConsole.removeAllListeners('jsdomError');
  virtualConsole.on('jsdomError', (error: unknown) => {
    // Ant Design's CSS-in-JS output is valid in supported browsers but can use
    // rules jsdom's CSS parser does not implement. Preserve every other jsdom
    // failure while keeping this known parser mismatch out of clean test runs.
    if (
      typeof error === 'object' &&
      error !== null &&
      'type' in error &&
      error.type === 'css-parsing'
    ) {
      return;
    }
    for (const listener of jsdomErrorListeners) listener(error);
  });
}

const getComputedStyle = window.getComputedStyle.bind(window);
window.getComputedStyle = (element: Element) => {
  const style = getComputedStyle(element);
  // jsdom leaves these values empty when CSS-in-JS rules are not measurable.
  // rc-input's textarea autosizer parses them as numbers, so supply the same
  // zero-width fallback a browser layout engine effectively provides.
  for (const property of [
    'padding-top',
    'padding-bottom',
    'border-top-width',
    'border-bottom-width',
  ]) {
    if (!style.getPropertyValue(property)) style.setProperty(property, '0px');
  }
  return style;
};
