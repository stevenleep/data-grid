import { useCallback, useEffect, useRef, useState } from 'react';
import { useGridInstance, useGridSelector } from '../react';
import {
  stableStringify,
  type GridFilterGroup,
  type GridOption,
  type GridResolvedField,
} from '../core';
import { gridNodeText, safeGridText } from './render';

function dependentFilterSignature(group: GridFilterGroup, fieldIds: readonly string[]): string {
  const fields = new Set(fieldIds);
  const project = (current: GridFilterGroup): unknown => {
    const children = current.children.flatMap((node) => {
      if (node.type === 'condition') {
        return fields.has(node.fieldId)
          ? [[node.fieldId, node.operator, node.value] as unknown]
          : [];
      }
      const nested = project(node) as { children: unknown[] } | undefined;
      return nested?.children.length ? [nested] : [];
    });
    return children.length
      ? { logic: current.logic, negated: Boolean(current.negated), children }
      : undefined;
  };
  return stableStringify(project(group));
}

function filterStaticOptions(options: GridOption[], search: string): GridOption[] {
  const normalized = search.trim().toLocaleLowerCase();
  if (!normalized) return options;
  return options.filter((option) =>
    `${gridNodeText(option.label)} ${safeGridText(option.value)}`
      .toLocaleLowerCase()
      .includes(normalized),
  );
}

export function useControllableOpen(
  controlled: boolean | undefined,
  defaultOpen: boolean,
  onChange: ((open: boolean) => void) | undefined,
) {
  const [internal, setInternal] = useState(defaultOpen);
  const open = controlled ?? internal;
  const setOpen = (value: boolean) => {
    if (controlled === undefined) setInternal(value);
    onChange?.(value);
  };
  return [open, setOpen] as const;
}

export interface GridFieldOptionsResult {
  options: GridOption[];
  loading: boolean;
  error?: Error;
  /** Retries the current lookup without changing its search or dependencies. */
  reload: () => void;
}

export function useGridFieldOptions<Row extends object>(
  field: GridResolvedField<Row> | undefined,
  search = '',
  enabled = true,
): GridFieldOptionsResult {
  const instance = useGridInstance<Row>();
  const provider =
    field?.options && !Array.isArray(field.options) && typeof field.options !== 'function'
      ? field.options
      : undefined;
  const queryDependency = useGridSelector<Row, unknown>((current) =>
    !enabled || !provider?.dependsOn
      ? undefined
      : provider.dependsOn === 'query'
        ? current.query
        : dependentFilterSignature(current.query.filters, provider.dependsOn),
  );
  const facet = useGridSelector<Row, GridOption[] | undefined>((current) =>
    enabled && field ? current.data.facets?.[field.id] : undefined,
  );
  const [state, setState] = useState<{
    options: GridOption[];
    loading: boolean;
    error?: Error;
  }>({
    options: field && Array.isArray(field.options) ? field.options : [],
    loading: false,
  });
  const requestRef = useRef(0);
  const [reloadToken, setReloadToken] = useState(0);
  const reload = useCallback(() => {
    if (field) instance.options.clear(field.id);
    setReloadToken((current) => current + 1);
  }, [field, instance]);

  useEffect(() => {
    const requestId = ++requestRef.current;
    if (!field || !enabled) {
      const options = field && Array.isArray(field.options) ? field.options : [];
      setState((current) =>
        !current.loading && !current.error && current.options === options
          ? current
          : { options, loading: false },
      );
      return;
    }
    if (Array.isArray(field.options)) {
      const options = filterStaticOptions(field.options, search);
      setState((current) =>
        !current.loading && !current.error && current.options === options
          ? current
          : { options, loading: false },
      );
      return;
    }
    const controller = new AbortController();
    setState((current) => ({ ...current, loading: true, error: undefined }));
    const timer = setTimeout(
      () => {
        void instance.options
          .load(field.id, search, { signal: controller.signal })
          .then((options) => {
            if (requestRef.current === requestId && !controller.signal.aborted) {
              setState({ options, loading: false });
            }
          })
          .catch((reason) => {
            if (requestRef.current !== requestId || controller.signal.aborted) return;
            const error =
              reason instanceof Error
                ? reason
                : new Error(safeGridText(reason, 'Unable to load options'));
            setState({ options: [], loading: false, error });
          });
      },
      search ? 200 : 0,
    );
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [enabled, facet, field, instance, queryDependency, reloadToken, search]);

  return { ...state, reload };
}

/** @deprecated Prefer the field-specific `useGridFieldOptions` name. */
export function useGridOptions<Row extends object>(
  field: GridResolvedField<Row> | undefined,
  search = '',
  enabled = true,
): GridFieldOptionsResult {
  return useGridFieldOptions(field, search, enabled);
}
