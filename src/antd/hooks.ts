import { useEffect, useRef, useState } from 'react';
import { useGridInstance, useGridSelector } from '../react';
import type { GridFilterGroup, GridOption, GridResolvedField } from '../core';
import { gridNodeText } from './render';

function dependentFilterSignature(group: GridFilterGroup, fieldIds: readonly string[]): string {
  const fields = new Set(fieldIds);
  const values: unknown[] = [];
  const visit = (current: GridFilterGroup) => {
    current.children.forEach((node) => {
      if (node.type === 'group') visit(node);
      else if (fields.has(node.fieldId)) values.push([node.fieldId, node.operator, node.value]);
    });
  };
  visit(group);
  return JSON.stringify(values);
}

function filterStaticOptions(options: GridOption[], search: string): GridOption[] {
  const normalized = search.trim().toLocaleLowerCase();
  if (!normalized) return options;
  return options.filter((option) =>
    `${gridNodeText(option.label)} ${String(option.value)}`
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

export function useGridOptions<Row extends object>(
  field: GridResolvedField<Row> | undefined,
  search = '',
  enabled = true,
) {
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
            const error = reason instanceof Error ? reason : new Error(String(reason));
            setState({ options: [], loading: false, error });
          });
      },
      search ? 200 : 0,
    );
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [enabled, facet, field, instance, queryDependency, search]);

  return state;
}
