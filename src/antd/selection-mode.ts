import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import type { GridInstance } from '../core';
import { useGridSelector } from '../react';

type GridSelectionMode = 'checkbox' | 'radio' | undefined;

interface SelectionModeStore {
  registrations: Map<object, GridSelectionMode>;
  listeners: Set<() => void>;
  value: GridSelectionMode;
}

const stores = new WeakMap<object, SelectionModeStore>();
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

function getStore(instance: object): SelectionModeStore {
  let store = stores.get(instance);
  if (!store) {
    store = { registrations: new Map(), listeners: new Set(), value: undefined };
    stores.set(instance, store);
  }
  return store;
}

function updateValue(store: SelectionModeStore): void {
  const values = [...store.registrations.values()];
  // A radio consumer is the strictest shared selection contract and must prevent
  // all-matching semantics even when another composed table exposes checkboxes.
  const next = values.includes('radio')
    ? 'radio'
    : values.includes('checkbox')
      ? 'checkbox'
      : undefined;
  if (next === store.value) return;
  store.value = next;
  store.listeners.forEach((listener) => listener());
}

export function usePublishGridSelectionMode<Row extends object>(
  instance: GridInstance<Row>,
  mode: GridSelectionMode,
): void {
  const token = useRef<object>({});
  useIsomorphicLayoutEffect(() => {
    const store = getStore(instance);
    store.registrations.set(token.current, mode);
    updateValue(store);
    return () => {
      store.registrations.delete(token.current);
      updateValue(store);
    };
  }, [instance, mode]);
}

export function useResolvedGridSelectionMode<Row extends object>(
  instance: GridInstance<Row>,
  fallback: GridSelectionMode,
): GridSelectionMode {
  const store = getStore(instance);
  const registered = useSyncExternalStore(
    (listener) => {
      store.listeners.add(listener);
      return () => store.listeners.delete(listener);
    },
    () => store.value,
    () => undefined,
  );
  return registered ?? fallback;
}

/**
 * Uses the Core selection scope check for all-matching selections. Reading the
 * count through a selector is intentional: a controlled all-matching slice can
 * keep the same object while query/columns/dataset changes invalidate its scope.
 */
export function useGridSelectionCount<Row extends object>(
  instance: GridInstance<Row>,
  mode: GridSelectionMode,
): number {
  return useGridSelector<Row, number>((state) => {
    if (mode === 'radio') {
      return state.selection.mode === 'explicit'
        ? Math.min(1, state.selection.selectedKeys.length)
        : 0;
    }
    return instance.selection.getCount();
  });
}
