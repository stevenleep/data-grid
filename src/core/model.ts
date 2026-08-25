import type {
  GridColumnState,
  GridEvent,
  GridEventReason,
  GridFieldDerivation,
  GridFilterCondition,
  GridFilterGroup,
  GridFilterOperatorValueKinds,
  GridFilterValueKind,
  GridJsonValue,
  GridPath,
  GridQuery,
  GridRequestQuery,
} from './types';

let idSequence = 0;

export function createGridId(prefix = 'grid'): string {
  idSequence += 1;
  return `${prefix}_${Date.now().toString(36)}_${idSequence.toString(36)}`;
}

export function createGridEvent(
  type: string,
  reason: GridEventReason = 'api',
  detail?: Record<string, unknown>,
): GridEvent {
  return { type, reason, timestamp: Date.now(), ...(detail ? { detail } : {}) };
}

export function createFilterGroup(
  logic: GridFilterGroup['logic'] = 'and',
  children: GridFilterGroup['children'] = [],
): GridFilterGroup {
  return { id: createGridId('group'), type: 'group', logic, children };
}

export function createFilterCondition(
  fieldId: string,
  operator: GridFilterCondition['operator'],
  value?: GridJsonValue,
): GridFilterCondition {
  return {
    id: createGridId('condition'),
    type: 'condition',
    fieldId,
    operator,
    ...(value === undefined ? {} : { value }),
  };
}

export function cloneJson<Value>(value: Value): Value {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as Value;
}

export function cloneFilterGroup(group: GridFilterGroup): GridFilterGroup {
  return cloneJson(group);
}

const operatorsWithoutValue = new Set([
  'isEmpty',
  'isNotEmpty',
  'isTrue',
  'isFalse',
  'today',
  'yesterday',
  'tomorrow',
  'thisWeek',
  'lastWeek',
  'thisMonth',
  'lastMonth',
  'last7Days',
  'last30Days',
]);

const operatorsWithRangeValue = new Set(['between', 'notBetween']);
const operatorsWithListValue = new Set([
  'in',
  'notIn',
  'containsAny',
  'containsAll',
  'containsNone',
]);

/** @deprecated Use GridFilterValueKind. */
export type GridFilterOperatorValueKind = GridFilterValueKind;

export function getFilterOperatorValueKind(
  operator: GridFilterCondition['operator'],
  overrides?: GridFilterOperatorValueKinds,
): GridFilterValueKind {
  const configured = overrides?.[operator];
  if (configured) return configured;
  if (operatorsWithoutValue.has(operator)) return 'none';
  if (operatorsWithRangeValue.has(operator)) return 'range';
  if (operatorsWithListValue.has(operator)) return 'multiple';
  return 'single';
}

export function isEmptyValue(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  );
}

export function filterConditionIsComplete(
  condition: GridFilterCondition,
  kind: GridFilterValueKind = getFilterOperatorValueKind(condition.operator),
): boolean {
  if (kind === 'none') return true;
  if (kind === 'range') {
    return (
      Array.isArray(condition.value) &&
      condition.value.length === 2 &&
      condition.value.every((value) => !isEmptyValue(value))
    );
  }
  if (kind === 'multiple') {
    return (
      Array.isArray(condition.value) &&
      condition.value.length > 0 &&
      condition.value.every((value) => !isEmptyValue(value))
    );
  }
  return !isEmptyValue(condition.value);
}

export type GridFilterValueKindResolver = (condition: GridFilterCondition) => GridFilterValueKind;

export function pruneFilterGroup(
  group: GridFilterGroup,
  resolveValueKind?: GridFilterValueKindResolver,
): GridFilterGroup {
  const children = group.children.flatMap<GridFilterGroup['children'][number]>((node) => {
    if (node.type === 'condition') {
      const kind = resolveValueKind?.(node);
      return filterConditionIsComplete(node, kind) ? [node] : [];
    }
    const nested = pruneFilterGroup(node, resolveValueKind);
    return nested.children.length ? [nested] : [];
  });
  return { ...group, children };
}

/** Removes structurally empty nested groups without discarding incomplete editor drafts. */
export function pruneEmptyFilterGroups(group: GridFilterGroup): GridFilterGroup {
  const children = group.children.flatMap<GridFilterGroup['children'][number]>((node) => {
    if (node.type === 'condition') return [node];
    const nested = pruneEmptyFilterGroups(node);
    return nested.children.length ? [nested] : [];
  });
  return { ...group, children };
}

export function countFilterConditions(group: GridFilterGroup): number {
  return group.children.reduce(
    (count, node) => count + (node.type === 'condition' ? 1 : countFilterConditions(node)),
    0,
  );
}

export function getFilterDepth(group: GridFilterGroup): number {
  return group.children.reduce(
    (depth, node) => Math.max(depth, node.type === 'group' ? 1 + getFilterDepth(node) : 1),
    0,
  );
}

export function updateFilterNode(
  group: GridFilterGroup,
  nodeId: string,
  update: (node: GridFilterGroup | GridFilterCondition) => GridFilterGroup | GridFilterCondition,
): GridFilterGroup {
  if (group.id === nodeId) return update(group) as GridFilterGroup;
  return {
    ...group,
    children: group.children.map((node) => {
      if (node.id === nodeId) return update(node);
      return node.type === 'group' ? updateFilterNode(node, nodeId, update) : node;
    }),
  };
}

export function removeFilterNode(group: GridFilterGroup, nodeId: string): GridFilterGroup {
  return pruneEmptyFilterGroups({
    ...group,
    children: group.children
      .filter((node) => node.id !== nodeId)
      .map((node) => (node.type === 'group' ? removeFilterNode(node, nodeId) : node)),
  });
}

export function addFilterNode(
  group: GridFilterGroup,
  parentId: string,
  node: GridFilterGroup | GridFilterCondition,
): GridFilterGroup {
  return updateFilterNode(group, parentId, (parent) =>
    parent.type === 'group' ? { ...parent, children: [...parent.children, node] } : parent,
  ) as GridFilterGroup;
}

export function moveFilterNode(
  group: GridFilterGroup,
  parentId: string,
  from: number,
  to: number,
): GridFilterGroup {
  return updateFilterNode(group, parentId, (parent) => {
    if (parent.type !== 'group' || from === to || from < 0 || to < 0) return parent;
    if (from >= parent.children.length || to >= parent.children.length) return parent;
    const children = [...parent.children];
    const [item] = children.splice(from, 1);
    if (!item) return parent;
    children.splice(to, 0, item);
    return { ...parent, children };
  }) as GridFilterGroup;
}

export function getPathValue(value: unknown, path: GridPath): unknown {
  return path.reduce<unknown>((current, segment) => {
    if (current == null || typeof current !== 'object') return undefined;
    return (current as Record<string | number, unknown>)[segment];
  }, value);
}

export function normalizeError(error: unknown, fallback = 'Unable to load data'): Error {
  if (error instanceof Error) return error;
  if (typeof error === 'string' && error) return new Error(error);
  return new Error(fallback);
}

export function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/** Returns normalized local semantic dependencies for a derived field. */
export function getGridFieldDependencies(derivation: GridFieldDerivation | undefined): string[] {
  if (!derivation) return [];
  const dependencies = [...(derivation.dependencies || [])];
  if (derivation.kind === 'lookup' || derivation.kind === 'rollup') {
    dependencies.unshift(derivation.relationField);
  }
  return uniqueStrings(dependencies);
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

export function getRequestSignature(request: GridRequestQuery): string {
  return stableStringify(request);
}

export function getRequestScopeSignature(request: GridRequestQuery): string {
  return stableStringify({
    keyword: request.keyword,
    filter: request.filter,
    sort: request.sort,
    context: request.context,
  });
}

export function queryWithoutPagination(query: GridQuery): Omit<GridQuery, 'pagination'> {
  const { pagination: _pagination, ...rest } = query;
  return cloneJson(rest);
}

export function cloneColumnState(columns: GridColumnState): GridColumnState {
  return cloneJson(columns);
}

export function shallowArrayEqual<Value>(left: readonly Value[], right: readonly Value[]): boolean {
  return (
    left === right ||
    (left.length === right.length && left.every((value, index) => Object.is(value, right[index])))
  );
}
