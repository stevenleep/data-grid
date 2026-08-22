import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';
import {
  createGrid,
  type GridEvent,
  type GridInstance,
  type GridOptions,
  type GridState,
} from '../core';

const GridContext = createContext<GridInstance<any> | null>(null);
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

function definitionKey<Row extends object>(options: GridOptions<Row>): string {
  return `${options.definition.id}:${String(options.definition.revision ?? 1)}`;
}

export function useGrid<Row extends object>(options: GridOptions<Row>): GridInstance<Row> {
  const key = definitionKey(options);
  const instance = useMemo(() => createGrid(options), [key]);

  useIsomorphicLayoutEffect(() => {
    instance.updateOptions(options);
  });

  useEffect(() => {
    void instance.start();
    return () => instance.stop();
  }, [instance]);

  return instance;
}

export interface GridProviderProps<Row extends object> {
  value: GridInstance<Row>;
  children: React.ReactNode;
}

export function GridProvider<Row extends object>({ value, children }: GridProviderProps<Row>) {
  return <GridContext.Provider value={value}>{children}</GridContext.Provider>;
}

export function useGridInstance<Row extends object>(): GridInstance<Row> {
  const instance = useContext(GridContext);
  if (!instance) throw new Error('Grid components must be rendered inside GridProvider.');
  return instance as GridInstance<Row>;
}

export function useGridSelector<Row extends object, Value>(
  selector: (state: GridState<Row>) => Value,
  isEqual: (previous: Value, next: Value) => boolean = Object.is,
): Value {
  const instance = useGridInstance<Row>();
  const selectorRef = useRef(selector);
  const equalityRef = useRef(isEqual);
  const cacheRef = useRef<{ state: GridState<Row>; value: Value } | undefined>(undefined);

  if (selectorRef.current !== selector || equalityRef.current !== isEqual) {
    selectorRef.current = selector;
    equalityRef.current = isEqual;
    cacheRef.current = undefined;
  }

  const getSnapshot = useCallback(() => {
    const state = instance.getState();
    const cached = cacheRef.current;
    if (cached?.state === state) return cached.value;
    const selected = selectorRef.current(state);
    const value = cached && equalityRef.current(cached.value, selected) ? cached.value : selected;
    cacheRef.current = { state, value };
    return value;
  }, [instance]);

  return useSyncExternalStore(instance.subscribe, getSnapshot, getSnapshot);
}

export function useGridEvent<Row extends object>(
  listener: (event: GridEvent, instance: GridInstance<Row>) => void,
): void {
  const instance = useGridInstance<Row>();
  const listenerRef = useRef(listener);
  listenerRef.current = listener;
  useEffect(
    () => instance.subscribeEvent((event) => listenerRef.current(event, instance)),
    [instance],
  );
}

/** @deprecated Use useGridInstance. */
export const useDataGrid = useGridInstance;
