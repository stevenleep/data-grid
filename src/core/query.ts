import dayjs from 'dayjs';
import type {
  GridFilterCondition,
  GridFilterGroup,
  GridJsonValue,
  GridQuery,
  GridReadResult,
  GridRequestFilterGroup,
  GridRequestQuery,
  GridResolvedCapabilities,
  GridResolvedDefinition,
  GridResolvedField,
  GridSort,
} from './types';
import { countFilterConditions, getFilterDepth, isEmptyValue } from './model';
import { filterConditionIsComplete } from './model';

function text(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (record.label != null) return String(record.label).toLocaleLowerCase();
    if (record.name != null) return String(record.name).toLocaleLowerCase();
    if (record.title != null) return String(record.title).toLocaleLowerCase();
  }
  return String(value).toLocaleLowerCase();
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [value];
}

function primitiveEquals(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  return text(left) === text(right);
}

function numeric(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  if (value && typeof value === 'object' && 'amount' in value) {
    return numeric((value as { amount: unknown }).amount);
  }
  return undefined;
}

function comparable(value: unknown): string | number {
  const asNumber = numeric(value);
  if (asNumber !== undefined) return asNumber;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    const date = dayjs(value);
    if (date.isValid()) return date.valueOf();
  }
  return text(value);
}

function compareValues(left: unknown, right: unknown): number {
  const normalizedLeft = comparable(left);
  const normalizedRight = comparable(right);
  if (typeof normalizedLeft === 'number' && typeof normalizedRight === 'number') {
    return normalizedLeft - normalizedRight;
  }
  return String(normalizedLeft).localeCompare(String(normalizedRight), undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

function relativeDateMatches(value: unknown, operator: GridFilterCondition['operator']): boolean {
  const source = dayjs(value as string);
  if (!source.isValid()) return false;
  const today = dayjs();
  if (operator === 'today') return source.isSame(today, 'day');
  if (operator === 'yesterday') return source.isSame(today.subtract(1, 'day'), 'day');
  if (operator === 'tomorrow') return source.isSame(today.add(1, 'day'), 'day');
  if (operator === 'thisWeek') return source.isSame(today, 'week');
  if (operator === 'lastWeek') return source.isSame(today.subtract(1, 'week'), 'week');
  if (operator === 'thisMonth') return source.isSame(today, 'month');
  if (operator === 'lastMonth') return source.isSame(today.subtract(1, 'month'), 'month');
  if (operator === 'last7Days') {
    return !source.isBefore(today.subtract(6, 'day').startOf('day')) && !source.isAfter(today);
  }
  if (operator === 'last30Days') {
    return !source.isBefore(today.subtract(29, 'day').startOf('day')) && !source.isAfter(today);
  }
  return false;
}

export function matchesGridCondition<Row extends object>(
  row: Row,
  field: GridResolvedField<Row>,
  condition: GridFilterCondition,
): boolean {
  const value = field.getValue(row);
  const custom = field.filterPredicate?.(value, condition, row);
  if (custom !== undefined) return custom;

  const target = condition.value;
  const operator = condition.operator;
  if (operator === 'isEmpty') return field.isEmpty(value);
  if (operator === 'isNotEmpty') return !field.isEmpty(value);
  if (operator === 'isTrue') return value === true || value === 1 || value === '1';
  if (operator === 'isFalse') return value === false || value === 0 || value === '0';
  if (
    [
      'today',
      'yesterday',
      'tomorrow',
      'thisWeek',
      'lastWeek',
      'thisMonth',
      'lastMonth',
      'last7Days',
      'last30Days',
    ].includes(operator)
  ) {
    return relativeDateMatches(value, operator);
  }

  if (operator === 'contains') return text(value).includes(text(target));
  if (operator === 'notContains') return !text(value).includes(text(target));
  if (operator === 'startsWith') return text(value).startsWith(text(target));
  if (operator === 'endsWith') return text(value).endsWith(text(target));

  if (operator === 'equals' || operator === 'notEquals') {
    const matches = Array.isArray(value)
      ? Array.isArray(target)
        ? value.length === target.length &&
          target.every((item) => value.some((candidate) => primitiveEquals(candidate, item)))
        : value.some((item) => primitiveEquals(item, target))
      : primitiveEquals(value, target);
    return operator === 'equals' ? matches : !matches;
  }

  if (operator === 'in' || operator === 'notIn') {
    const targets = list(target);
    const values = list(value);
    const matches = values.some((item) =>
      targets.some((candidate) => primitiveEquals(item, candidate)),
    );
    return operator === 'in' ? matches : !matches;
  }

  if (operator === 'containsAny' || operator === 'containsAll' || operator === 'containsNone') {
    const targets = list(target);
    const values = list(value);
    const contains = (candidate: unknown) =>
      values.some((item) => primitiveEquals(item, candidate));
    if (operator === 'containsAll') return targets.every(contains);
    if (operator === 'containsNone') return targets.every((candidate) => !contains(candidate));
    return targets.some(contains);
  }

  if (operator === 'between' || operator === 'notBetween') {
    const [start, end] = Array.isArray(target) ? target : [];
    const matches = compareValues(value, start) >= 0 && compareValues(value, end) <= 0;
    return operator === 'between' ? matches : !matches;
  }

  const compared = compareValues(value, target);
  if (operator === 'greaterThan' || operator === 'after') return compared > 0;
  if (operator === 'greaterThanOrEqual' || operator === 'onOrAfter') return compared >= 0;
  if (operator === 'lessThan' || operator === 'before') return compared < 0;
  if (operator === 'lessThanOrEqual' || operator === 'onOrBefore') return compared <= 0;
  return false;
}

export function matchesGridFilters<Row extends object>(
  row: Row,
  group: GridFilterGroup,
  fieldMap: ReadonlyMap<string, GridResolvedField<Row>>,
): boolean {
  if (!group.children.length) return true;
  const matches = group.children.map((node) => {
    if (node.type === 'group') return matchesGridFilters(row, node, fieldMap);
    const field = fieldMap.get(node.fieldId);
    return field ? matchesGridCondition(row, field, node) : false;
  });
  const result = group.logic === 'and' ? matches.every(Boolean) : matches.some(Boolean);
  return group.negated ? !result : result;
}

function compareRows<Row extends object>(
  left: Row,
  right: Row,
  sorts: GridSort[],
  fieldMap: ReadonlyMap<string, GridResolvedField<Row>>,
): number {
  for (const sort of sorts) {
    const field = fieldMap.get(sort.fieldId);
    if (!field) continue;
    const leftValue = field.getValue(left);
    const rightValue = field.getValue(right);
    const leftEmpty = field.isEmpty(leftValue);
    const rightEmpty = field.isEmpty(rightValue);
    if (leftEmpty || rightEmpty) {
      if (leftEmpty && rightEmpty) continue;
      const emptyResult = leftEmpty ? -1 : 1;
      return sort.nulls === 'first' ? emptyResult : -emptyResult;
    }
    const compared = field.compare
      ? field.compare(leftValue, rightValue, left, right)
      : compareValues(leftValue, rightValue);
    if (compared !== 0) return sort.direction === 'asc' ? compared : -compared;
  }
  return 0;
}

export function applyLocalGridQuery<Row extends object>(
  rows: readonly Row[],
  query: GridQuery,
  definition: GridResolvedDefinition<Row>,
): GridReadResult<Row> {
  const keyword = query.keyword.trim().toLocaleLowerCase();
  let result = rows.filter((row) => matchesGridFilters(row, query.filters, definition.fieldMap));

  if (keyword) {
    result = result.filter((row) =>
      definition.fields.some((field) => {
        const value = field.getValue(row);
        return (field.searchText?.(value, row) || text(value))
          .toLocaleLowerCase()
          .includes(keyword);
      }),
    );
  }

  if (query.sorts.length) {
    result = [...result].sort((left, right) =>
      compareRows(left, right, query.sorts, definition.fieldMap),
    );
  }
  const total = result.length;
  if (query.pagination.type !== 'offset') {
    throw new Error('Local grid sources support offset pagination only.');
  }
  const start = (query.pagination.page - 1) * query.pagination.pageSize;
  result = result.slice(start, start + query.pagination.pageSize);

  return {
    rows: result,
    total: { value: total, accuracy: 'exact' },
    pageInfo: {
      hasPrevious: query.pagination.page > 1,
      hasNext: query.pagination.page * query.pagination.pageSize < total,
    },
  };
}

function compileFilterGroup<Row extends object>(
  group: GridFilterGroup,
  definition: GridResolvedDefinition<Row>,
): GridRequestFilterGroup {
  return {
    logic: group.logic,
    ...(group.negated ? { negated: true } : {}),
    children: group.children.map((node) => {
      if (node.type === 'group') return compileFilterGroup(node, definition);
      const field = definition.fieldMap.get(node.fieldId);
      if (!field) throw new Error(`Unknown filter field: ${node.fieldId}`);
      const encoded = field.transport.encodeFilter
        ? field.transport.encodeFilter(node.value, node.operator)
        : node.value;
      return {
        field: field.transport.filterKey,
        operator: node.operator,
        ...(encoded === undefined ? {} : { value: encoded }),
      };
    }),
  };
}

export function compileGridQuery<Row extends object>(
  query: GridQuery,
  definition: GridResolvedDefinition<Row>,
): GridRequestQuery {
  const select = query.projection
    ?.map((fieldId) => definition.fieldMap.get(fieldId)?.transport.selectKey)
    .filter((value): value is string => Boolean(value));
  return {
    pagination: { ...query.pagination },
    ...(query.keyword.trim() ? { keyword: query.keyword.trim() } : {}),
    ...(query.filters.children.length
      ? { filter: compileFilterGroup(query.filters, definition) }
      : {}),
    ...(query.sorts.length
      ? {
          sort: query.sorts.map((sort) => {
            const field = definition.fieldMap.get(sort.fieldId);
            if (!field) throw new Error(`Unknown sort field: ${sort.fieldId}`);
            return {
              field: field.transport.sortKey,
              direction: sort.direction,
              ...(sort.nulls ? { nulls: sort.nulls } : {}),
            };
          }),
        }
      : {}),
    ...(select?.length ? { select: [...new Set(select)] } : {}),
    ...(query.context ? { context: query.context } : {}),
  };
}

export function validateGridQuery<Row extends object>(
  query: GridQuery,
  definition: GridResolvedDefinition<Row>,
  capabilities: GridResolvedCapabilities,
): void {
  if (query.pagination.type !== capabilities.pagination) {
    throw new Error(`This data source requires ${capabilities.pagination} pagination.`);
  }
  if (
    !Number.isInteger(query.pagination.pageSize) ||
    query.pagination.pageSize < 1 ||
    (query.pagination.type === 'offset' &&
      (!Number.isInteger(query.pagination.page) || query.pagination.page < 1))
  ) {
    throw new Error('Grid pagination requires positive integer page and pageSize values.');
  }
  if (query.keyword.trim() && !capabilities.search) {
    throw new Error('This data source does not support keyword search.');
  }
  const count = countFilterConditions(query.filters);
  if (count > capabilities.filter.maxConditions) {
    throw new Error(
      `This data source supports at most ${capabilities.filter.maxConditions} filters.`,
    );
  }
  if (getFilterDepth(query.filters) > capabilities.filter.maxDepth) {
    throw new Error(`This data source supports filter depth ${capabilities.filter.maxDepth}.`);
  }
  if (capabilities.filter.logic === 'and' && query.filters.logic !== 'and') {
    throw new Error('This data source supports AND filters only.');
  }
  if (
    capabilities.filter.logic !== 'nested' &&
    query.filters.children.some((node) => node.type === 'group')
  ) {
    throw new Error('This data source does not support nested filters.');
  }

  const validateGroup = (group: GridFilterGroup) => {
    if (group.negated && !capabilities.filter.negation) {
      throw new Error('This data source does not support negated filters.');
    }
    group.children.forEach((node) => {
      if (node.type === 'group') return validateGroup(node);
      const field = definition.fieldMap.get(node.fieldId);
      if (!field?.filter) throw new Error(`Field "${node.fieldId}" is not filterable.`);
      if (!filterConditionIsComplete(node)) {
        throw new Error(`Filter condition for "${node.fieldId}" is incomplete.`);
      }
      if (field.filter.operators && !field.filter.operators.includes(node.operator)) {
        throw new Error(`Operator "${node.operator}" is not available for "${node.fieldId}".`);
      }
      if (capabilities.filter.operators && !capabilities.filter.operators.includes(node.operator)) {
        throw new Error(`The data source does not support operator "${node.operator}".`);
      }
    });
  };
  validateGroup(query.filters);

  if (query.sorts.length > capabilities.sort.max) {
    throw new Error(`This data source supports at most ${capabilities.sort.max} sorts.`);
  }
  const sortedFields = new Set<string>();
  query.sorts.forEach((sort) => {
    const field = definition.fieldMap.get(sort.fieldId);
    if (!field?.sort) throw new Error(`Field "${sort.fieldId}" is not sortable.`);
    if (sortedFields.has(sort.fieldId)) {
      throw new Error(`Field "${sort.fieldId}" cannot be sorted more than once.`);
    }
    sortedFields.add(sort.fieldId);
    if (sort.nulls && !capabilities.sort.nulls) {
      throw new Error('This data source does not support null placement.');
    }
    if (sort.nulls && field.sort.nulls === false) {
      throw new Error(`Field "${sort.fieldId}" does not support null placement.`);
    }
  });

  query.projection?.forEach((fieldId) => {
    if (!definition.fieldMap.has(fieldId)) {
      throw new Error(`Unknown projected field: ${fieldId}`);
    }
  });
}

export function serializeGridQuery(query: GridQuery): GridJsonValue {
  return query as unknown as GridJsonValue;
}

export function mapGridQueryFields<Row extends object>(
  query: GridQuery,
  definition: GridResolvedDefinition<Row>,
): GridRequestQuery {
  return compileGridQuery(query, definition);
}

export function isGridJsonValue(value: unknown): value is GridJsonValue {
  if (value == null || ['string', 'number', 'boolean'].includes(typeof value)) return true;
  if (Array.isArray(value)) return value.every(isGridJsonValue);
  if (typeof value === 'object') return Object.values(value).every(isGridJsonValue);
  return false;
}

export function normalizeFilterValue(value: unknown): GridJsonValue | undefined {
  return isGridJsonValue(value) ? value : isEmptyValue(value) ? undefined : String(value);
}
