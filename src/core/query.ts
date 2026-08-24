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
  GridTemporalContext,
} from './types';
import {
  countFilterConditions,
  filterConditionIsComplete,
  getFilterDepth,
  getFilterOperatorValueKind,
  isEmptyValue,
  pruneEmptyFilterGroups,
} from './model';
import { compareExactNumeric } from './numeric';

function text(value: unknown): string {
  if (value == null) return '';
  try {
    if (typeof value === 'object') {
      const record = value as Record<string, unknown>;
      if (record.label != null) return String(record.label).toLocaleLowerCase();
      if (record.name != null) return String(record.name).toLocaleLowerCase();
      if (record.title != null) return String(record.title).toLocaleLowerCase();
    }
    return String(value).toLocaleLowerCase();
  } catch {
    return '';
  }
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [value];
}

function comparable(value: unknown): string | number {
  if (value instanceof Date) return Number.isFinite(value.valueOf()) ? value.valueOf() : '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(?:[T\s]|$)/.test(value)) {
    const source = value.trim();
    const offsetlessDateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(source);
    const timestamp = Date.parse(offsetlessDateTime ? `${source}Z` : source);
    if (Number.isFinite(timestamp)) return timestamp;
  }
  if (value && typeof value === 'object') {
    try {
      const primitive = (value as { valueOf?: () => unknown }).valueOf?.();
      if (typeof primitive === 'number' && Number.isFinite(primitive)) return primitive;
    } catch {
      // Fall through to the safe semantic text representation.
    }
  }
  return text(value);
}

function compareValues(left: unknown, right: unknown): number {
  const numericResult = compareExactNumeric(left, right);
  if (numericResult !== undefined) return numericResult;
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

function arrayMultisetEquals(
  left: readonly unknown[],
  right: readonly unknown[],
  equals: (left: unknown, right: unknown) => boolean,
): boolean {
  if (left.length !== right.length) return false;
  const unmatched = [...right];
  return left.every((item) => {
    const index = unmatched.findIndex((candidate) => equals(item, candidate));
    if (index < 0) return false;
    unmatched.splice(index, 1);
    return true;
  });
}

const exactNumericValueTypes = new Set(['number', 'decimal', 'money', 'percent', 'duration']);

function fieldValueEquals<Row extends object>(
  field: GridResolvedField<Row>,
  left: unknown,
  right: unknown,
): boolean {
  if (exactNumericValueTypes.has(field.valueType)) {
    const result = compareExactNumeric(left, right);
    if (result !== undefined) return result === 0;
  }
  try {
    return field.equals(left as never, right as never);
  } catch {
    return false;
  }
}

const dayMilliseconds = 86_400_000;
const calendarFormatters = new Map<string, Intl.DateTimeFormat>();

interface CalendarDate {
  year: number;
  month: number;
  day: number;
  serial: number;
  dayOfWeek: number;
}

function calendarFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = calendarFormatters.get(timeZone);
  if (formatter) return formatter;
  formatter = new Intl.DateTimeFormat('en-US-u-ca-iso8601-nu-latn', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  calendarFormatters.set(timeZone, formatter);
  return formatter;
}

export function validateGridTemporalContext(temporal: GridTemporalContext | undefined): void {
  if (temporal === undefined) return;
  if (!temporal || typeof temporal !== 'object' || Array.isArray(temporal)) {
    throw new Error('Grid temporal context must be an object.');
  }
  const prototype = Object.getPrototypeOf(temporal);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error('Grid temporal context must be a plain object.');
  }
  if (
    temporal.timeZone !== undefined &&
    (typeof temporal.timeZone !== 'string' || !temporal.timeZone.trim())
  ) {
    throw new Error('Grid temporal timeZone must be a non-empty IANA timezone.');
  }
  try {
    calendarFormatter(temporal.timeZone || 'UTC');
  } catch {
    throw new Error(`Invalid grid temporal timeZone: ${String(temporal.timeZone)}`);
  }
  if (
    temporal.weekStartsOn !== undefined &&
    (!Number.isSafeInteger(temporal.weekStartsOn) ||
      temporal.weekStartsOn < 0 ||
      temporal.weekStartsOn > 6)
  ) {
    throw new Error('Grid temporal weekStartsOn must be an integer from 0 through 6.');
  }
  if (temporal.now !== undefined && typeof temporal.now !== 'function') {
    throw new Error('Grid temporal now must be a function.');
  }
}

function calendarDate(year: number, month: number, day: number): CalendarDate | undefined {
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);
  if (
    !Number.isFinite(timestamp) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    return undefined;
  }
  return {
    year,
    month,
    day,
    serial: Math.floor(timestamp / dayMilliseconds),
    dayOfWeek: date.getUTCDay(),
  };
}

function temporalDate(value: unknown, timeZone: string): CalendarDate | undefined {
  if (typeof value === 'string') {
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (dateOnly)
      return calendarDate(Number(dateOnly[1]), Number(dateOnly[2]), Number(dateOnly[3]));
  }

  let date: Date;
  try {
    if (value instanceof Date) {
      date = value;
    } else if (
      value &&
      typeof value === 'object' &&
      typeof (value as { toDate?: unknown }).toDate === 'function'
    ) {
      date = (value as { toDate: () => Date }).toDate();
    } else {
      const source = typeof value === 'string' ? value.trim() : value;
      const offsetlessDateTime =
        typeof source === 'string' &&
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(source);
      date = new Date(offsetlessDateTime ? `${source}Z` : (source as string | number));
    }
  } catch {
    return undefined;
  }
  if (!(date instanceof Date) || !Number.isFinite(date.valueOf())) return undefined;

  try {
    const parts = calendarFormatter(timeZone).formatToParts(date);
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((candidate) => candidate.type === type)?.value);
    return calendarDate(part('year'), part('month'), part('day'));
  } catch {
    return undefined;
  }
}

function weekStart(date: CalendarDate, startsOn: number): number {
  return date.serial - ((date.dayOfWeek - startsOn + 7) % 7);
}

function relativeDateMatches(
  value: unknown,
  operator: GridFilterCondition['operator'],
  temporal: GridTemporalContext = {},
): boolean {
  validateGridTemporalContext(temporal);
  const timeZone = temporal.timeZone || 'UTC';
  let now: Date;
  try {
    now = temporal.now?.() ?? new Date();
  } catch {
    throw new Error('Grid temporal now function failed.');
  }
  if (!(now instanceof Date) || !Number.isFinite(now.valueOf())) {
    throw new Error('Grid temporal now must return a valid Date.');
  }
  const source = temporalDate(value, timeZone);
  const today = temporalDate(now, timeZone);
  if (!source || !today) return false;
  if (operator === 'today') return source.serial === today.serial;
  if (operator === 'yesterday') return source.serial === today.serial - 1;
  if (operator === 'tomorrow') return source.serial === today.serial + 1;

  const weekStartsOn = temporal.weekStartsOn ?? 1;
  const thisWeek = weekStart(today, weekStartsOn);
  if (operator === 'thisWeek') return weekStart(source, weekStartsOn) === thisWeek;
  if (operator === 'lastWeek') return weekStart(source, weekStartsOn) === thisWeek - 7;

  const sourceMonth = source.year * 12 + source.month;
  const currentMonth = today.year * 12 + today.month;
  if (operator === 'thisMonth') return sourceMonth === currentMonth;
  if (operator === 'lastMonth') return sourceMonth === currentMonth - 1;
  if (operator === 'last7Days') {
    return source.serial >= today.serial - 6 && source.serial <= today.serial;
  }
  if (operator === 'last30Days') {
    return source.serial >= today.serial - 29 && source.serial <= today.serial;
  }
  return false;
}

export function matchesGridCondition<Row extends object>(
  row: Row,
  field: GridResolvedField<Row>,
  condition: GridFilterCondition,
  temporal?: GridTemporalContext,
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
    return relativeDateMatches(value, operator, temporal);
  }

  if (operator === 'contains') return text(value).includes(text(target));
  if (operator === 'notContains') return !text(value).includes(text(target));
  if (operator === 'startsWith') return text(value).startsWith(text(target));
  if (operator === 'endsWith') return text(value).endsWith(text(target));

  if (operator === 'equals' || operator === 'notEquals') {
    const matches = Array.isArray(value)
      ? Array.isArray(target)
        ? arrayMultisetEquals(value, target, (left, right) => fieldValueEquals(field, left, right))
        : value.some((item) => fieldValueEquals(field, item, target))
      : fieldValueEquals(field, value, target);
    return operator === 'equals' ? matches : !matches;
  }

  if (operator === 'in' || operator === 'notIn') {
    const targets = list(target);
    const values = list(value);
    const matches = values.some((item) =>
      targets.some((candidate) => fieldValueEquals(field, item, candidate)),
    );
    return operator === 'in' ? matches : !matches;
  }

  if (operator === 'containsAny' || operator === 'containsAll' || operator === 'containsNone') {
    const targets = list(target);
    const values = list(value);
    const contains = (candidate: unknown) =>
      values.some((item) => fieldValueEquals(field, item, candidate));
    if (operator === 'containsAll') return targets.every(contains);
    if (operator === 'containsNone') return targets.every((candidate) => !contains(candidate));
    return targets.some(contains);
  }

  if (operator === 'between' || operator === 'notBetween') {
    if (!Array.isArray(target) || target.length !== 2) return false;
    const [start, end] = target;
    const compare = (candidate: unknown) =>
      field.compare
        ? field.compare(value, candidate as never, row, row)
        : compareValues(value, candidate);
    const matches = compare(start) >= 0 && compare(end) <= 0;
    return operator === 'between' ? matches : !matches;
  }

  const compared = field.compare
    ? field.compare(value, target as never, row, row)
    : compareValues(value, target);
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
  temporal?: GridTemporalContext,
): boolean {
  const children = group.children.filter(
    (node) => node.type === 'condition' || node.children.length > 0,
  );
  if (!children.length) return true;
  const matches = children.map((node) => {
    if (node.type === 'group') return matchesGridFilters(row, node, fieldMap, temporal);
    const field = fieldMap.get(node.fieldId);
    return field ? matchesGridCondition(row, field, node, temporal) : false;
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
  temporal?: GridTemporalContext,
): GridReadResult<Row> {
  validateGridTemporalContext(temporal);
  const rowKeys = new Set<string>();
  rows.forEach((row, index) => {
    const rowKey = definition.getRowKey(row);
    const signature = String(rowKey);
    if (rowKeys.has(signature)) {
      throw new Error(
        `Local grid row keys must be unique; duplicate "${signature}" at index ${index}.`,
      );
    }
    rowKeys.add(signature);
  });
  const keyword = query.keyword.trim().toLocaleLowerCase();
  const filters = pruneEmptyFilterGroups(query.filters);
  let result = rows.filter((row) =>
    matchesGridFilters(row, filters, definition.fieldMap, temporal),
  );

  if (keyword) {
    result = result.filter((row) =>
      definition.fields.some((field) => {
        const value = field.getValue(row);
        return text(field.searchText?.(value, row) ?? value).includes(keyword);
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
      const valueKind = getFilterOperatorValueKind(
        node.operator,
        field.filter ? field.filter.operatorValueKinds : undefined,
      );
      if (!filterConditionIsComplete(node, valueKind)) {
        throw new Error(`Filter condition for "${node.fieldId}" is incomplete.`);
      }
      if (valueKind === 'none' && node.value !== undefined) {
        throw new Error(`Operator "${node.operator}" does not accept a value.`);
      }
      const encoded = field.transport.encodeFilter
        ? field.transport.encodeFilter(node.value, node.operator)
        : node.value;
      if (encoded !== undefined && !isGridJsonValue(encoded)) {
        throw new Error(`Filter value for "${node.fieldId}" is not JSON-safe.`);
      }
      return {
        field: field.transport.filterKey,
        operator: node.operator,
        ...(encoded === undefined ? {} : { value: encoded }),
      };
    }),
  };
}

function samePath(
  left: readonly (string | number)[],
  right: readonly (string | number)[],
): boolean {
  return left.length === right.length && left.every((part, index) => part === right[index]);
}

function rowKeySelectKeys<Row extends object>(definition: GridResolvedDefinition<Row>): string[] {
  const configured = definition.projection?.rowKey;
  if (configured !== undefined) {
    const keys = typeof configured === 'string' ? [configured] : [...configured];
    if (!keys.length) throw new Error('Projection rowKey requires at least one transport key.');
    return keys;
  }

  const rowKey = definition.rowKey;
  if (typeof rowKey === 'function') {
    throw new Error(
      'Projection with a functional rowKey requires definition.projection.rowKey transport key(s).',
    );
  }
  if (typeof rowKey === 'string') {
    return [definition.fieldMap.get(rowKey)?.transport.selectKey || rowKey];
  }
  const matchingField = definition.fields.find((field) => samePath(field.path, rowKey));
  if (matchingField) return [matchingField.transport.selectKey];
  throw new Error(
    'Projection with an unmapped path rowKey requires definition.projection.rowKey transport key(s).',
  );
}

function compileProjection<Row extends object>(
  fieldIds: readonly string[] | undefined,
  definition: GridResolvedDefinition<Row>,
): string[] | undefined {
  if (fieldIds === undefined) return undefined;
  const selected = [...fieldIds, ...(definition.projection?.requiredFields || [])];
  const keys = [...rowKeySelectKeys(definition), ...(definition.projection?.requiredKeys || [])];
  selected.forEach((fieldId) => {
    const field = definition.fieldMap.get(fieldId);
    if (!field) throw new Error(`Unknown projected field: ${fieldId}`);
    keys.push(field.transport.selectKey, ...(field.transport.selectDependencies || []));
  });
  return [...new Set(keys)];
}

export function compileGridQuery<Row extends object>(
  query: GridQuery,
  definition: GridResolvedDefinition<Row>,
): GridRequestQuery {
  const filters = pruneEmptyFilterGroups(query.filters);
  const select = compileProjection(query.projection, definition);
  const pagination =
    query.pagination.type === 'offset'
      ? {
          type: 'offset' as const,
          page: query.pagination.page,
          pageSize: query.pagination.pageSize,
        }
      : {
          type: 'cursor' as const,
          pageSize: query.pagination.pageSize,
          ...(query.pagination.cursor === undefined ? {} : { cursor: query.pagination.cursor }),
          ...(query.pagination.direction === undefined
            ? {}
            : { direction: query.pagination.direction }),
        };
  const request: GridRequestQuery = {
    pagination,
    ...(query.keyword.trim() ? { keyword: query.keyword.trim() } : {}),
    ...(filters.children.length ? { filter: compileFilterGroup(filters, definition) } : {}),
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
    ...(select?.length ? { select } : {}),
    ...(query.context ? { context: query.context } : {}),
  };
  if (!isGridJsonValue(request)) {
    throw new Error('Compiled grid request must contain JSON-safe finite values.');
  }
  return request;
}

export function validateGridQuery<Row extends object>(
  query: GridQuery,
  definition: GridResolvedDefinition<Row>,
  capabilities: GridResolvedCapabilities,
): void {
  if (!query || typeof query !== 'object' || !query.pagination) {
    throw new Error('Grid query and pagination must be objects.');
  }
  if (query.pagination.type !== capabilities.pagination) {
    throw new Error(`This data source requires ${capabilities.pagination} pagination.`);
  }
  if (
    !Number.isSafeInteger(query.pagination.pageSize) ||
    query.pagination.pageSize < 1 ||
    (query.pagination.type === 'offset' &&
      (!Number.isSafeInteger(query.pagination.page) || query.pagination.page < 1))
  ) {
    throw new Error('Grid pagination requires positive integer page and pageSize values.');
  }
  if (
    query.pagination.type === 'cursor' &&
    ((query.pagination.cursor !== undefined &&
      (typeof query.pagination.cursor !== 'string' || !query.pagination.cursor)) ||
      (query.pagination.direction !== undefined &&
        query.pagination.direction !== 'forward' &&
        query.pagination.direction !== 'backward'))
  ) {
    throw new Error('Cursor pagination requires a non-empty cursor and a valid direction.');
  }
  if (typeof query.keyword !== 'string') {
    throw new Error('Grid query keyword must be a string.');
  }
  if (!Array.isArray(query.sorts)) {
    throw new Error('Grid query sorts must be an array.');
  }
  const filterIds = new Set<string>();
  const validateFilterNode = (node: unknown, root = false): node is GridFilterGroup => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      throw new Error('Grid query filters must contain filter objects.');
    }
    const candidate = node as Record<string, unknown>;
    if (typeof candidate.id !== 'string' || !candidate.id || filterIds.has(candidate.id)) {
      throw new Error('Grid query filter ids must be non-empty and unique.');
    }
    filterIds.add(candidate.id);
    if (candidate.type === 'condition') {
      if (root) throw new Error('Grid query filters must use a group at the root.');
      if (
        typeof candidate.fieldId !== 'string' ||
        !candidate.fieldId ||
        typeof candidate.operator !== 'string' ||
        !candidate.operator ||
        (candidate.value !== undefined && !isGridJsonValue(candidate.value))
      ) {
        throw new Error('Grid query contains an invalid filter condition.');
      }
      return false;
    }
    if (
      candidate.type !== 'group' ||
      (candidate.logic !== 'and' && candidate.logic !== 'or') ||
      (candidate.negated !== undefined && typeof candidate.negated !== 'boolean') ||
      !Array.isArray(candidate.children)
    ) {
      throw new Error('Grid query contains an invalid filter group.');
    }
    candidate.children.forEach((child) => validateFilterNode(child));
    return true;
  };
  if (!validateFilterNode(query.filters, true)) {
    throw new Error('Grid query filters must use a group at the root.');
  }
  if (query.keyword.trim() && !capabilities.search) {
    throw new Error('This data source does not support keyword search.');
  }
  const filters = pruneEmptyFilterGroups(query.filters);
  const count = countFilterConditions(filters);
  if (count > capabilities.filter.maxConditions) {
    throw new Error(
      `This data source supports at most ${capabilities.filter.maxConditions} filters.`,
    );
  }
  if (getFilterDepth(filters) > capabilities.filter.maxDepth) {
    throw new Error(`This data source supports filter depth ${capabilities.filter.maxDepth}.`);
  }
  if (
    filters.children.length > 0 &&
    capabilities.filter.logic === 'and' &&
    filters.logic !== 'and'
  ) {
    throw new Error('This data source supports AND filters only.');
  }
  if (
    capabilities.filter.logic !== 'nested' &&
    filters.children.some((node) => node.type === 'group')
  ) {
    throw new Error('This data source does not support nested filters.');
  }

  const validateGroup = (group: GridFilterGroup) => {
    if (!group.children.length) return;
    if (group.negated && !capabilities.filter.negation) {
      throw new Error('This data source does not support negated filters.');
    }
    group.children.forEach((node) => {
      if (node.type === 'group') return validateGroup(node);
      const field = definition.fieldMap.get(node.fieldId);
      if (!field?.filter) throw new Error(`Field "${node.fieldId}" is not filterable.`);
      const valueKind = getFilterOperatorValueKind(node.operator, field.filter.operatorValueKinds);
      if (!filterConditionIsComplete(node, valueKind)) {
        throw new Error(`Filter condition for "${node.fieldId}" is incomplete.`);
      }
      if (valueKind === 'none' && node.value !== undefined) {
        throw new Error(`Operator "${node.operator}" does not accept a value.`);
      }
      if (node.value !== undefined && !isGridJsonValue(node.value)) {
        throw new Error(`Filter value for "${node.fieldId}" is not JSON-safe.`);
      }
      if (field.filter.operators && !field.filter.operators.includes(node.operator)) {
        throw new Error(`Operator "${node.operator}" is not available for "${node.fieldId}".`);
      }
      if (capabilities.filter.operators && !capabilities.filter.operators.includes(node.operator)) {
        throw new Error(`The data source does not support operator "${node.operator}".`);
      }
    });
  };
  validateGroup(filters);

  if (query.sorts.length > capabilities.sort.max) {
    throw new Error(`This data source supports at most ${capabilities.sort.max} sorts.`);
  }
  const sortedFields = new Set<string>();
  const sortIds = new Set<string>();
  query.sorts.forEach((sort) => {
    if (
      !sort ||
      typeof sort !== 'object' ||
      typeof sort.id !== 'string' ||
      !sort.id ||
      typeof sort.fieldId !== 'string' ||
      !sort.fieldId ||
      (sort.direction !== 'asc' && sort.direction !== 'desc') ||
      (sort.nulls !== undefined && sort.nulls !== 'first' && sort.nulls !== 'last')
    ) {
      throw new Error('Grid query contains an invalid sort declaration.');
    }
    if (sortIds.has(sort.id)) {
      throw new Error(`Grid sort id "${sort.id}" cannot appear more than once.`);
    }
    sortIds.add(sort.id);
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

  if (query.projection !== undefined && !Array.isArray(query.projection)) {
    throw new Error('Grid query projection must be an array.');
  }
  query.projection?.forEach((fieldId) => {
    if (typeof fieldId !== 'string' || !fieldId) {
      throw new Error('Grid query projection contains an invalid field id.');
    }
    if (!definition.fieldMap.has(fieldId)) {
      throw new Error(`Unknown projected field: ${fieldId}`);
    }
  });
  if (
    query.context !== undefined &&
    (!query.context || Array.isArray(query.context) || !isGridJsonValue(query.context))
  ) {
    throw new Error('Grid query context must contain JSON-safe finite values.');
  }
}

export function serializeGridQuery(query: GridQuery): GridJsonValue {
  return toGridJsonValue(query, new WeakSet<object>()) as GridJsonValue;
}

export function mapGridQueryFields<Row extends object>(
  query: GridQuery,
  definition: GridResolvedDefinition<Row>,
): GridRequestQuery {
  return compileGridQuery(query, definition);
}

export function isGridJsonValue(value: unknown): value is GridJsonValue {
  const seen = new WeakSet<object>();
  const visit = (item: unknown): boolean => {
    if (item == null || typeof item === 'string' || typeof item === 'boolean') return true;
    if (typeof item === 'number') return Number.isFinite(item);
    if (!item || typeof item !== 'object') return false;
    if (seen.has(item)) return false;
    seen.add(item);
    let valid: boolean;
    try {
      if (Array.isArray(item)) {
        valid = Array.from({ length: item.length }, (_, index) => index).every(
          (index) => Object.prototype.hasOwnProperty.call(item, index) && visit(item[index]),
        );
      } else {
        const prototype = Object.getPrototypeOf(item);
        valid =
          (prototype === Object.prototype || prototype === null) &&
          Object.getOwnPropertySymbols(item).length === 0 &&
          Object.values(item as Record<string, unknown>).every(visit);
      }
    } catch {
      valid = false;
    }
    seen.delete(item);
    return valid;
  };
  return visit(value);
}

const omittedJsonProperty = Symbol('omitted-json-property');

function toGridJsonValue(
  value: unknown,
  seen: WeakSet<object>,
  allowOmit = false,
): GridJsonValue | typeof omittedJsonProperty {
  if (value === undefined) {
    if (allowOmit) return omittedJsonProperty;
    throw new Error('Grid query arrays cannot contain undefined values.');
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Grid query numbers must be finite.');
    return value;
  }
  if (!value || typeof value !== 'object') {
    throw new Error('Grid query must contain JSON-safe values.');
  }
  if (seen.has(value)) throw new Error('Grid query cannot contain cyclic values.');
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return Array.from({ length: value.length }, (_, index) => {
        if (!Object.prototype.hasOwnProperty.call(value, index)) {
          throw new Error('Grid query arrays cannot contain empty slots.');
        }
        const item = toGridJsonValue(value[index], seen);
        if (item === omittedJsonProperty) {
          throw new Error('Grid query arrays cannot contain undefined values.');
        }
        return item;
      });
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error('Grid query objects must be plain objects.');
    }
    if (Object.getOwnPropertySymbols(value).length) {
      throw new Error('Grid query objects cannot contain symbol keys.');
    }
    const result: Record<string, GridJsonValue> = {};
    Object.entries(value as Record<string, unknown>).forEach(([key, item]) => {
      const normalized = toGridJsonValue(item, seen, true);
      if (normalized !== omittedJsonProperty) result[key] = normalized;
    });
    return result;
  } finally {
    seen.delete(value);
  }
}

export function normalizeFilterValue(value: unknown): GridJsonValue | undefined {
  return isGridJsonValue(value) ? value : isEmptyValue(value) ? undefined : String(value);
}
