import { useEffect, useState } from 'react';
import { useGridInstance, useGridSelector } from '../react';
import type { GridOption, GridResolvedField } from '../core';

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

export function useGridOptions<Row extends object>(
  field: GridResolvedField<Row> | undefined,
  search = '',
  enabled = true,
) {
  const instance = useGridInstance<Row>();
  const dependsOnQuery = Boolean(
    field?.options &&
    !Array.isArray(field.options) &&
    typeof field.options !== 'function' &&
    field.options.dependsOn,
  );
  const queryDependency = useGridSelector<Row, unknown>((current) =>
    enabled && dependsOnQuery ? current.query : undefined,
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

  useEffect(() => {
    if (!field || !enabled) {
      setState({
        options: field && Array.isArray(field.options) ? field.options : [],
        loading: false,
      });
      return;
    }
    let active = true;
    const controller = new AbortController();
    setState((current) => ({ ...current, loading: true, error: undefined }));
    const timer = setTimeout(
      () => {
        void instance.options
          .load(field.id, search)
          .then((options) => {
            if (active && !controller.signal.aborted) setState({ options, loading: false });
          })
          .catch((reason) => {
            if (!active || controller.signal.aborted) return;
            const error = reason instanceof Error ? reason : new Error(String(reason));
            setState({ options: [], loading: false, error });
          });
      },
      search ? 200 : 0,
    );
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [enabled, facet, field, instance, queryDependency, search]);

  return state;
}
