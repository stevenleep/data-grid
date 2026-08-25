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

interface GridRuntimeSubscription {
  getRuntimeRevision?: () => number;
  subscribeRuntime?: (listener: () => void) => () => void;
}

interface GridContextValue {
  instance: GridInstance<any>;
  runtimeRevision: number;
}

const emptyRuntimeSubscribe = () => () => undefined;
const zeroRuntimeRevision = () => 0;
const GridContext = createContext<GridContextValue | null>(null);
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

function definitionKey<Row extends object>(options: GridOptions<Row>): string {
  return `${options.definition.id}:${String(options.definition.revision ?? 1)}`;
}

export function useGrid<Row extends object>(options: GridOptions<Row>): GridInstance<Row> {
  const key = definitionKey(options);
  const instance = useMemo(() => createGrid(options), [key]);

  useIsomorphicLayoutEffect(() => {
    instance.updateOptions(options);
  }, [instance, options]);

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
  // Keep the provider runtime-tolerant of 0.1 instances and lightweight test
  // doubles. Library-created 0.2 instances always expose the observable.
  const runtime = value as GridInstance<Row> & GridRuntimeSubscription;
  const runtimeRevision = useSyncExternalStore(
    runtime.subscribeRuntime || emptyRuntimeSubscribe,
    runtime.getRuntimeRevision || zeroRuntimeRevision,
    runtime.getRuntimeRevision || zeroRuntimeRevision,
  );
  const context = useMemo<GridContextValue>(
    () => ({ instance: value, runtimeRevision }),
    [runtimeRevision, value],
  );
  return <GridContext.Provider value={context}>{children}</GridContext.Provider>;
}

export function useGridInstance<Row extends object>(): GridInstance<Row> {
  const context = useContext(GridContext);
  if (!context) throw new Error('Grid components must be rendered inside GridProvider.');
  return context.instance as GridInstance<Row>;
}

export function useGridSelector<Row extends object, Value>(
  selector: (state: GridState<Row>) => Value,
  isEqual: (previous: Value, next: Value) => boolean = Object.is,
): Value {
  const context = useContext(GridContext);
  if (!context) throw new Error('Grid components must be rendered inside GridProvider.');
  const instance = context.instance as GridInstance<Row>;
  const runtimeRevision = context.runtimeRevision;
  const selectorRef = useRef(selector);
  const equalityRef = useRef(isEqual);
  const cacheRef = useRef<
    { state: GridState<Row>; runtimeRevision: number; value: Value } | undefined
  >(undefined);

  if (selectorRef.current !== selector || equalityRef.current !== isEqual) {
    selectorRef.current = selector;
    equalityRef.current = isEqual;
    cacheRef.current = undefined;
  }

  const getSnapshot = useCallback(() => {
    const state = instance.getState();
    const cached = cacheRef.current;
    if (cached?.state === state && cached.runtimeRevision === runtimeRevision) return cached.value;
    const selected = selectorRef.current(state);
    const value = cached && equalityRef.current(cached.value, selected) ? cached.value : selected;
    cacheRef.current = { state, runtimeRevision, value };
    return value;
  }, [instance, runtimeRevision]);

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
