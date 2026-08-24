import type {
  GridAnyFieldDefinition,
  GridAnyResolvedField,
  GridColumnDefinition,
  GridColumnSchema,
  GridDefinition,
  GridFieldDefinition,
  GridFieldFilter,
  GridFieldRuntime,
  GridFieldSchema,
  GridFilterOperator,
  GridFilterOperatorValueKinds,
  GridFilterValueKind,
  GridJsonValue,
  GridOptionValue,
  GridResolvedColumn,
  GridResolvedDefinition,
  GridResolvedField,
  GridRowKey,
  GridRuntime,
  GridSchema,
  GridValueTypeRegistry,
  GridValueTypeDefinition,
} from './types';
import { getFilterOperatorValueKind, getPathValue, isEmptyValue, stableStringify } from './model';
import { compareExactNumeric } from './numeric';
import { normalizeGridOptions } from './source';

const textOperators: GridFilterOperator[] = [
  'contains',
  'notContains',
  'equals',
  'notEquals',
  'startsWith',
  'endsWith',
  'isEmpty',
  'isNotEmpty',
];

const numberOperators: GridFilterOperator[] = [
  'equals',
  'notEquals',
  'greaterThan',
  'greaterThanOrEqual',
  'lessThan',
  'lessThanOrEqual',
  'between',
  'notBetween',
  'isEmpty',
  'isNotEmpty',
];

const optionOperators: GridFilterOperator[] = ['in', 'notIn', 'isEmpty', 'isNotEmpty'];
const multiOptionOperators: GridFilterOperator[] = [
  'containsAny',
  'containsAll',
  'containsNone',
  'isEmpty',
  'isNotEmpty',
];

const dateOperators: GridFilterOperator[] = [
  'equals',
  'notEquals',
  'before',
  'after',
  'onOrBefore',
  'onOrAfter',
  'between',
  'today',
  'yesterday',
  'tomorrow',
  'thisWeek',
  'lastWeek',
  'thisMonth',
  'lastMonth',
  'last7Days',
  'last30Days',
  'isEmpty',
  'isNotEmpty',
];

function encodeJsonValue(value: unknown, seen = new WeakSet<object>()): GridJsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Grid codecs cannot encode non-finite numbers.');
    return value;
  }
  if (value instanceof Date) {
    if (!Number.isFinite(value.valueOf()))
      throw new Error('Grid codecs cannot encode invalid dates.');
    return value.toISOString();
  }
  if (!value || typeof value !== 'object') {
    throw new Error('Grid codecs require JSON-safe values or a custom field codec.');
  }
  if (seen.has(value)) throw new Error('Grid codecs cannot encode cyclic values.');
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return Array.from({ length: value.length }, (_, index) => {
        if (!Object.prototype.hasOwnProperty.call(value, index) || value[index] === undefined) {
          throw new Error('Grid codecs cannot encode sparse arrays or undefined array values.');
        }
        return encodeJsonValue(value[index], seen);
      });
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error('Grid codecs require plain objects or a custom field codec.');
    }
    if (Object.getOwnPropertySymbols(value).length) {
      throw new Error('Grid codecs cannot encode symbol keys.');
    }
    const result: Record<string, GridJsonValue> = {};
    Object.entries(value as Record<string, unknown>).forEach(([key, item]) => {
      if (item === undefined) {
        throw new Error(`Grid codecs cannot encode undefined property "${key}".`);
      }
      result[key] = encodeJsonValue(item, seen);
    });
    return result;
  } finally {
    seen.delete(value);
  }
}

const jsonCodec = {
  encode(value: unknown): GridJsonValue | undefined {
    return value === undefined ? undefined : encodeJsonValue(value);
  },
  decode(value: GridJsonValue | undefined): unknown {
    return value;
  },
};

function defaultValueEquals(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== typeof right) return false;
  if (typeof left === 'string' && typeof right === 'string') {
    return left.toLocaleLowerCase() === right.toLocaleLowerCase();
  }
  if (left && right && typeof left === 'object' && typeof right === 'object') {
    try {
      const leftPrimitive = (left as { valueOf?: () => unknown }).valueOf?.();
      const rightPrimitive = (right as { valueOf?: () => unknown }).valueOf?.();
      if (leftPrimitive !== left || rightPrimitive !== right) {
        return defaultValueEquals(leftPrimitive, rightPrimitive);
      }
      const leftPrototype = Object.getPrototypeOf(left);
      const rightPrototype = Object.getPrototypeOf(right);
      if (
        leftPrototype !== rightPrototype ||
        (leftPrototype !== Object.prototype && leftPrototype !== null && !Array.isArray(left))
      ) {
        return false;
      }
      return stableStringify(encodeJsonValue(left)) === stableStringify(encodeJsonValue(right));
    } catch {
      return false;
    }
  }
  return false;
}

function entityIdentity(value: unknown): GridOptionValue | undefined {
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (!value || typeof value !== 'object') return undefined;
  try {
    const record = value as Record<string, unknown>;
    const candidate = record.id ?? record.value ?? record.key;
    if (typeof candidate === 'string' || typeof candidate === 'boolean') return candidate;
    return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : undefined;
  } catch {
    return undefined;
  }
}

function entityEquals(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  const leftIdentity = entityIdentity(left);
  const rightIdentity = entityIdentity(right);
  return leftIdentity !== undefined && Object.is(leftIdentity, rightIdentity);
}

function entityCollectionEquals(left: unknown, right: unknown): boolean {
  if (!Array.isArray(left) || !Array.isArray(right)) return entityEquals(left, right);
  if (left.length !== right.length) return false;
  const unmatched = [...right];
  return left.every((item) => {
    const index = unmatched.findIndex((candidate) => entityEquals(item, candidate));
    if (index < 0) return false;
    unmatched.splice(index, 1);
    return true;
  });
}

function compareUnknown(left: unknown, right: unknown): number {
  const numericResult = compareExactNumeric(left, right);
  if (numericResult !== undefined) return numericResult;
  return String(left ?? '').localeCompare(String(right ?? ''), undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

export const builtinValueTypes: GridValueTypeRegistry<object> = {
  text: {
    defaultColumn: { width: 160, align: 'left' },
    operators: textOperators,
    codec: jsonCodec,
  },
  longText: {
    defaultColumn: { width: 240, align: 'left', ellipsis: true },
    operators: textOperators,
    codec: jsonCodec,
  },
  number: {
    defaultColumn: { width: 120, align: 'right' },
    operators: numberOperators,
    codec: jsonCodec,
    compare: compareUnknown,
  },
  decimal: {
    defaultColumn: { width: 128, align: 'right' },
    operators: numberOperators,
    codec: jsonCodec,
    normalize: (value) => (value == null || value === '' ? value : String(value)),
    compare: compareUnknown,
  },
  money: {
    defaultColumn: { width: 136, align: 'right' },
    operators: numberOperators,
    codec: jsonCodec,
    compare: compareUnknown,
  },
  percent: {
    defaultColumn: { width: 112, align: 'right' },
    operators: numberOperators,
    codec: jsonCodec,
    compare: compareUnknown,
  },
  boolean: {
    defaultColumn: { width: 96, align: 'center' },
    operators: ['isTrue', 'isFalse', 'isEmpty', 'isNotEmpty'],
    codec: jsonCodec,
  },
  select: {
    defaultColumn: { width: 136, align: 'left' },
    operators: optionOperators,
    codec: jsonCodec,
    equals: entityEquals,
    getIdentity: entityIdentity,
  },
  multiSelect: {
    defaultColumn: { width: 180, align: 'left' },
    operators: multiOptionOperators,
    codec: jsonCodec,
    equals: entityCollectionEquals,
    getIdentity: entityIdentity,
  },
  status: {
    defaultColumn: { width: 120, align: 'left' },
    operators: optionOperators,
    codec: jsonCodec,
    equals: entityEquals,
    getIdentity: entityIdentity,
  },
  date: {
    defaultColumn: { width: 128, align: 'left' },
    operators: dateOperators,
    codec: jsonCodec,
  },
  dateTime: {
    defaultColumn: { width: 176, align: 'left' },
    operators: dateOperators,
    codec: jsonCodec,
  },
  duration: {
    defaultColumn: { width: 112, align: 'right' },
    operators: numberOperators,
    codec: jsonCodec,
    compare: compareUnknown,
  },
  link: { defaultColumn: { width: 180 }, operators: textOperators, codec: jsonCodec },
  email: { defaultColumn: { width: 190 }, operators: textOperators, codec: jsonCodec },
  phone: { defaultColumn: { width: 144 }, operators: textOperators, codec: jsonCodec },
  user: {
    defaultColumn: { width: 152 },
    operators: multiOptionOperators,
    codec: jsonCodec,
    equals: entityCollectionEquals,
    getIdentity: entityIdentity,
  },
  relation: {
    defaultColumn: { width: 180 },
    operators: multiOptionOperators,
    codec: jsonCodec,
    equals: entityCollectionEquals,
    getIdentity: entityIdentity,
  },
  image: {
    defaultColumn: { width: 96, align: 'center' },
    operators: ['isEmpty', 'isNotEmpty'],
    codec: jsonCodec,
  },
  file: {
    defaultColumn: { width: 180 },
    operators: ['isEmpty', 'isNotEmpty'],
    codec: jsonCodec,
  },
  json: {
    defaultColumn: { width: 240 },
    operators: ['isEmpty', 'isNotEmpty'],
    codec: jsonCodec,
  },
};

export function defineGrid<Row extends object>(
  definition: GridDefinition<Row>,
): GridDefinition<Row> {
  return definition;
}

export function defineGridSchema<const Schema extends GridSchema>(schema: Schema): Schema {
  return schema;
}

export function defineGridRuntime<Row extends object>(runtime: GridRuntime<Row>): GridRuntime<Row> {
  return runtime;
}

export function defineGridFields<Row extends object>(
  fields: readonly GridAnyFieldDefinition<Row>[],
): readonly GridAnyFieldDefinition<Row>[] {
  return fields;
}

export function defineGridValueType<Row extends object, Value>(
  valueType: GridValueTypeDefinition<Row, Value>,
): GridValueTypeDefinition<Row, Value> {
  return valueType;
}

export function createFieldHelper<Row extends object>() {
  return {
    property<Key extends Extract<keyof Row, string>>(
      key: Key,
      options: Omit<GridFieldDefinition<Row, Row[Key]>, 'id' | 'path' | 'accessor'>,
    ): GridFieldDefinition<Row, Row[Key]> {
      return { ...options, id: key, path: [key] };
    },
    accessor<Value>(
      id: string,
      accessor: (row: Row) => Value,
      options: Omit<GridFieldDefinition<Row, Value>, 'id' | 'accessor'>,
    ): GridFieldDefinition<Row, Value> {
      return { ...options, id, accessor };
    },
    path<Value = unknown>(
      id: string,
      path: readonly (string | number)[],
      options: Omit<GridFieldDefinition<Row, Value>, 'id' | 'path'>,
    ): GridFieldDefinition<Row, Value> {
      return { ...options, id, path };
    },
    display(
      id: string,
      options: Omit<GridColumnDefinition<Row>, 'id' | 'fieldId'>,
    ): GridColumnDefinition<Row> {
      return { ...options, id };
    },
  };
}

function normalizeFeature<Value extends { enabled?: boolean }>(
  value: boolean | Value | undefined,
  defaults: Omit<Value, 'enabled'> = {} as Omit<Value, 'enabled'>,
): false | (Value & { enabled: true }) {
  if (!value || (typeof value === 'object' && value.enabled === false)) return false;
  return { ...defaults, ...(value === true ? {} : value), enabled: true } as Value & {
    enabled: true;
  };
}

const filterValueKinds = new Set<GridFilterValueKind>(['none', 'single', 'multiple', 'range']);

function checkedOperatorValueKinds(
  value: GridFilterOperatorValueKinds | undefined,
  label: string,
): GridFilterOperatorValueKinds {
  if (value === undefined) return {};
  const prototype = value && typeof value === 'object' ? Object.getPrototypeOf(value) : undefined;
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (prototype !== Object.prototype && prototype !== null) ||
    Object.getOwnPropertySymbols(value).length > 0
  ) {
    throw new Error(`${label} must be an operator-to-value-kind object.`);
  }
  Object.entries(value).forEach(([operator, kind]) => {
    if (!operator.trim() || !filterValueKinds.has(kind as GridFilterValueKind)) {
      throw new Error(`${label} contains an invalid declaration for "${operator}".`);
    }
  });
  return value;
}

function resolveField<Row extends object>(
  field: GridAnyFieldDefinition<Row>,
  valueTypes: GridValueTypeRegistry<Row>,
): GridAnyResolvedField<Row> {
  const valueType = field.valueType || 'text';
  const type = valueTypes[valueType];
  if (!type) {
    throw new Error(
      `Unknown value type "${valueType}" for field "${field.id}". Register it in valueTypes.`,
    );
  }
  const path = field.path || [field.id];
  const getValue = field.accessor || ((row: Row) => getPathValue(row, path));
  const normalize = field.normalize || type.normalize || ((value: unknown) => value);
  const transport = field.transport || {};
  const codec = type.codec || (jsonCodec as GridValueTypeDefinition<Row>['codec'])!;
  let filter = normalizeFeature(field.filter, {
    operators: type.operators,
    defaultOperator: type.operators?.[0] || 'equals',
  });
  if (filter) {
    const operators = [...new Set(filter.operators || ['equals'])];
    if (!operators.length || operators.some((operator) => !operator.trim())) {
      throw new Error(`Filter operators for field "${field.id}" must be non-empty strings.`);
    }
    const fieldFilter = typeof field.filter === 'object' ? field.filter : undefined;
    const defaultOperator =
      fieldFilter?.defaultOperator ||
      (fieldFilter?.operators ? operators[0] : filter.defaultOperator) ||
      operators[0]!;
    if (!operators.includes(defaultOperator)) {
      throw new Error(
        `Default filter operator "${defaultOperator}" is not available for field "${field.id}".`,
      );
    }
    const typeKinds = checkedOperatorValueKinds(
      type.operatorValueKinds,
      `Operator value kinds for value type "${valueType}"`,
    );
    const fieldKinds = checkedOperatorValueKinds(
      fieldFilter?.operatorValueKinds,
      `Operator value kinds for field "${field.id}"`,
    );
    Object.keys(fieldKinds).forEach((operator) => {
      if (!operators.includes(operator)) {
        throw new Error(
          `Operator value kind for "${operator}" is declared but the operator is not available for field "${field.id}".`,
        );
      }
    });
    const configuredKinds = { ...typeKinds, ...fieldKinds };
    const operatorValueKinds = Object.fromEntries(
      operators.map((operator) => [
        operator,
        getFilterOperatorValueKind(operator, configuredKinds),
      ]),
    ) as GridFieldFilter['operatorValueKinds'];
    filter = { ...filter, operators, defaultOperator, operatorValueKinds };
  }
  const sort = normalizeFeature(field.sort);
  const edit = normalizeFeature(field.edit);

  return {
    id: field.id,
    title: field.title,
    valueType,
    path,
    transport: {
      ...transport,
      filterKey: transport.filterKey || field.id,
      sortKey: transport.sortKey || transport.filterKey || field.id,
      selectKey: transport.selectKey || field.id,
    },
    filter,
    sort,
    edit,
    options: Array.isArray(field.options)
      ? normalizeGridOptions(field.options, `Options for field "${field.id}"`)
      : field.options,
    description: field.description,
    codec,
    getValue: (row) => normalize(getValue(row), row),
    normalize,
    encodeValue: transport.encodeValue || codec.encode,
    decodeValue: codec.decode,
    equals: field.equals || type.equals || defaultValueEquals,
    getIdentity: field.getIdentity || type.getIdentity,
    isEmpty: type.isEmpty || isEmptyValue,
    compare: field.compare || type.compare,
    searchText: field.searchText || type.searchText,
    filterPredicate: field.filterPredicate || type.filterPredicate,
    validate: field.validate,
    render: field.render || type.cell,
    editor: field.editor || type.editor,
    filterEditor: field.filterEditor || type.filterEditor,
    meta: field.meta,
  };
}

function resolveColumn<Row extends object>(
  column: GridColumnDefinition<Row>,
  fieldMap: ReadonlyMap<string, GridAnyResolvedField<Row>>,
  fieldDefinitions: ReadonlyMap<string, GridAnyFieldDefinition<Row>>,
  valueTypes: GridValueTypeRegistry<Row>,
): GridResolvedColumn<Row> {
  if (column.fieldId && column.children?.length) {
    throw new Error(`Column "${column.id}" cannot reference a field and contain child columns.`);
  }
  const field = column.fieldId ? fieldMap.get(column.fieldId) : undefined;
  if (column.fieldId && !field) {
    throw new Error(`Column "${column.id}" references unknown field "${column.fieldId}".`);
  }
  const definition = field ? fieldDefinitions.get(field.id) : undefined;
  const typeDefaults = field ? valueTypes[field.valueType]?.defaultColumn : undefined;
  const fieldColumn = definition?.column === false ? {} : definition?.column || {};
  return {
    ...typeDefaults,
    ...fieldColumn,
    ...column,
    id: column.id,
    fieldId: column.fieldId,
    title: column.title ?? field?.title ?? column.id,
    description: column.description ?? field?.description,
    children: column.children?.map((child) =>
      resolveColumn(child, fieldMap, fieldDefinitions, valueTypes),
    ),
  };
}

function flattenColumns<Row extends object>(
  columns: readonly GridResolvedColumn<Row>[],
): GridResolvedColumn<Row>[] {
  return columns.flatMap((column) => [
    column,
    ...(column.children ? flattenColumns(column.children) : []),
  ]);
}

function validateNonEmptyStrings(value: unknown, label: string): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${label} must be an array of strings.`);
  value.forEach((item) => {
    if (typeof item !== 'string' || !item.trim()) {
      throw new Error(`${label} must contain non-empty strings.`);
    }
  });
  if (new Set(value).size !== value.length) {
    throw new Error(`${label} cannot contain duplicates.`);
  }
  return value as string[];
}

function validatePath(
  value: unknown,
  label: string,
): asserts value is readonly (string | number)[] {
  if (!Array.isArray(value) || !value.length) throw new Error(`${label} must be a non-empty path.`);
  value.forEach((segment) => {
    if (!(
      (typeof segment === 'string' && segment.length > 0) ||
      (typeof segment === 'number' && Number.isSafeInteger(segment))
    )) {
      throw new Error(`${label} contains an invalid path segment.`);
    }
  });
}

function validateColumnDisplay(value: GridColumnDefinition<object>, label: string): void {
  for (const key of ['width', 'minWidth', 'maxWidth'] as const) {
    const width = value[key];
    if (width !== undefined && (!Number.isFinite(width) || width <= 0)) {
      throw new Error(`${label} ${key} must be a positive finite number.`);
    }
  }
  if (
    value.minWidth !== undefined &&
    value.maxWidth !== undefined &&
    value.minWidth > value.maxWidth
  ) {
    throw new Error(`${label} minWidth cannot exceed maxWidth.`);
  }
  if (value.width !== undefined && value.minWidth !== undefined && value.width < value.minWidth) {
    throw new Error(`${label} width cannot be smaller than minWidth.`);
  }
  if (value.width !== undefined && value.maxWidth !== undefined && value.width > value.maxWidth) {
    throw new Error(`${label} width cannot exceed maxWidth.`);
  }
  if (value.align !== undefined && !['left', 'center', 'right'].includes(value.align)) {
    throw new Error(`${label} align is invalid.`);
  }
  if (value.fixed !== undefined && value.fixed !== 'left' && value.fixed !== 'right') {
    throw new Error(`${label} fixed position is invalid.`);
  }
  for (const key of [
    'hidden',
    'hideable',
    'reorderable',
    'resizable',
    'pinnable',
    'ellipsis',
    'wrap',
  ] as const) {
    if (value[key] !== undefined && typeof value[key] !== 'boolean') {
      throw new Error(`${label} ${key} must be a boolean.`);
    }
  }
}

export function isResolvedGridDefinition<Row extends object>(
  definition: GridDefinition<Row> | GridResolvedDefinition<Row>,
): definition is GridResolvedDefinition<Row> {
  return (
    Boolean(definition) &&
    'fieldMap' in definition &&
    definition.fieldMap instanceof Map &&
    'columnMap' in definition &&
    definition.columnMap instanceof Map &&
    typeof (definition as GridResolvedDefinition<Row>).getRowKey === 'function'
  );
}

function validateResolvedDefinition<Row extends object>(
  definition: GridResolvedDefinition<Row>,
): void {
  if (typeof definition.id !== 'string' || !definition.id.trim()) {
    throw new Error('Resolved grid definition requires a stable id.');
  }
  if (!(
    (typeof definition.revision === 'string' && definition.revision.trim()) ||
    (typeof definition.revision === 'number' && Number.isSafeInteger(definition.revision))
  )) {
    throw new Error('Resolved grid definition has an invalid revision.');
  }
  if (!Array.isArray(definition.fields) || !Array.isArray(definition.columns)) {
    throw new Error('Resolved grid definition fields and columns must be arrays.');
  }
  if (
    definition.rowKeyIdentity !== undefined &&
    !(
      (typeof definition.rowKeyIdentity === 'string' && definition.rowKeyIdentity.trim()) ||
      (typeof definition.rowKeyIdentity === 'number' &&
        Number.isSafeInteger(definition.rowKeyIdentity))
    )
  ) {
    throw new Error('Resolved grid definition has an invalid rowKeyIdentity.');
  }
  const fieldIds = new Set<string>();
  definition.fields.forEach((field) => {
    if (
      !field ||
      typeof field.id !== 'string' ||
      !field.id ||
      fieldIds.has(field.id) ||
      definition.fieldMap.get(field.id) !== field ||
      typeof field.getValue !== 'function' ||
      typeof field.normalize !== 'function' ||
      typeof field.encodeValue !== 'function' ||
      typeof field.decodeValue !== 'function' ||
      typeof field.equals !== 'function' ||
      typeof field.isEmpty !== 'function' ||
      !field.codec ||
      typeof field.codec.encode !== 'function' ||
      typeof field.codec.decode !== 'function'
    ) {
      throw new Error('Resolved grid definition contains an invalid field or fieldMap entry.');
    }
    validateSchemaFieldFeatures(
      field as unknown as Record<string, unknown>,
      `Grid field "${field.id}"`,
    );
    fieldIds.add(field.id);
  });
  if (definition.fieldMap.size !== fieldIds.size) {
    throw new Error('Resolved grid definition fieldMap is inconsistent with fields.');
  }
  const columns = flattenColumns(definition.columns);
  const columnIds = new Set<string>();
  columns.forEach((column) => {
    if (
      !column ||
      typeof column.id !== 'string' ||
      !column.id ||
      columnIds.has(column.id) ||
      definition.columnMap.get(column.id) !== column ||
      (column.fieldId !== undefined && !fieldIds.has(column.fieldId))
    ) {
      throw new Error('Resolved grid definition contains an invalid column or columnMap entry.');
    }
    columnIds.add(column.id);
  });
  if (definition.columnMap.size !== columnIds.size) {
    throw new Error('Resolved grid definition columnMap is inconsistent with columns.');
  }
}

export function resolveGridDefinition<Row extends object>(
  definition: GridDefinition<Row> | GridResolvedDefinition<Row>,
): GridResolvedDefinition<Row> {
  if (isResolvedGridDefinition(definition)) {
    validateResolvedDefinition(definition);
    return definition;
  }
  if (!definition || typeof definition !== 'object')
    throw new Error('Grid definition is required.');
  if (typeof definition.id !== 'string' || !definition.id.trim()) {
    throw new Error('Grid definition requires a stable id.');
  }
  const revision = definition.revision ?? 1;
  if (!(
    (typeof revision === 'string' && revision.trim()) ||
    (typeof revision === 'number' && Number.isSafeInteger(revision))
  )) {
    throw new Error('Grid definition revision must be a non-empty string or safe integer.');
  }
  if (!Array.isArray(definition.fields))
    throw new Error('Grid definition fields must be an array.');
  if (definition.columns !== undefined && !Array.isArray(definition.columns)) {
    throw new Error('Grid definition columns must be an array.');
  }
  if (definition.actions !== undefined && !Array.isArray(definition.actions)) {
    throw new Error('Grid definition actions must be an array.');
  }
  if (definition.valueTypes !== undefined && !isPlainRecord(definition.valueTypes)) {
    throw new Error('Grid definition valueTypes must be an object.');
  }
  if (definition.defaults !== undefined && !isPlainRecord(definition.defaults)) {
    throw new Error('Grid definition defaults must be an object.');
  }
  if (definition.projection !== undefined && !isPlainRecord(definition.projection)) {
    throw new Error('Grid definition projection must be an object.');
  }
  if (definition.meta !== undefined && !isPlainRecord(definition.meta)) {
    throw new Error('Grid definition meta must be an object.');
  }
  if (definition.editing !== undefined) {
    if (!isPlainRecord(definition.editing) || typeof definition.editing.save !== 'function') {
      throw new Error('Grid editing requires an object with a save function.');
    }
    for (const key of ['canEdit', 'apply'] as const) {
      if (definition.editing[key] !== undefined && typeof definition.editing[key] !== 'function') {
        throw new Error(`Grid editing.${key} must be a function.`);
      }
    }
    for (const key of ['reloadOnSave', 'optimistic'] as const) {
      if (definition.editing[key] !== undefined && typeof definition.editing[key] !== 'boolean') {
        throw new Error(`Grid editing.${key} must be a boolean.`);
      }
    }
  }
  if (!(
    typeof definition.rowKey === 'function' ||
    (typeof definition.rowKey === 'string' && definition.rowKey.trim()) ||
    Array.isArray(definition.rowKey)
  )) {
    throw new Error('Grid definition requires a valid rowKey.');
  }
  if (Array.isArray(definition.rowKey)) validatePath(definition.rowKey, 'Grid rowKey');
  if (
    definition.rowKeyIdentity !== undefined &&
    !(
      (typeof definition.rowKeyIdentity === 'string' && definition.rowKeyIdentity.trim()) ||
      (typeof definition.rowKeyIdentity === 'number' &&
        Number.isSafeInteger(definition.rowKeyIdentity))
    )
  ) {
    throw new Error('Grid rowKeyIdentity must be a non-empty string or safe integer.');
  }
  const defaults = definition.defaults as GridDefinition<Row>['defaults'];
  if (
    defaults?.pageSize !== undefined &&
    (!Number.isSafeInteger(defaults.pageSize) || defaults.pageSize < 1)
  ) {
    throw new Error('Grid default pageSize must be a positive safe integer.');
  }
  if (
    defaults?.density !== undefined &&
    !['compact', 'default', 'comfortable'].includes(defaults.density)
  ) {
    throw new Error('Grid default density is invalid.');
  }
  for (const key of ['selection', 'views'] as const) {
    if (defaults?.[key] !== undefined && typeof defaults[key] !== 'boolean') {
      throw new Error(`Grid default ${key} must be a boolean.`);
    }
  }

  const valueTypes: GridValueTypeRegistry<Row> = {
    ...(builtinValueTypes as unknown as GridValueTypeRegistry<Row>),
    ...definition.valueTypes,
  };
  Object.entries(definition.valueTypes || {}).forEach(([id, valueType]) => {
    if (!id.trim() || !isPlainRecord(valueType)) {
      throw new Error('Custom grid value types require a non-empty id and object definition.');
    }
    const checkedValueType = valueType as unknown as GridValueTypeDefinition<Row>;
    validateNonEmptyStrings(checkedValueType.operators, `Operators for value type "${id}"`);
    checkedOperatorValueKinds(
      checkedValueType.operatorValueKinds,
      `Operator value kinds for value type "${id}"`,
    );
    if (checkedValueType.codec !== undefined) {
      if (
        !isPlainRecord(checkedValueType.codec) ||
        typeof checkedValueType.codec.encode !== 'function' ||
        typeof checkedValueType.codec.decode !== 'function'
      ) {
        throw new Error(`Codec for value type "${id}" requires encode and decode functions.`);
      }
    }
    for (const callback of [
      'normalize',
      'equals',
      'getIdentity',
      'isEmpty',
      'compare',
      'searchText',
      'filterPredicate',
      'cell',
      'editor',
      'filterEditor',
    ] as const) {
      if (
        checkedValueType[callback] !== undefined &&
        typeof checkedValueType[callback] !== 'function'
      ) {
        throw new Error(`Value type "${id}" ${callback} must be a function.`);
      }
    }
    if (checkedValueType.defaultColumn !== undefined) {
      if (!isPlainRecord(checkedValueType.defaultColumn)) {
        throw new Error(`Default column for value type "${id}" must be an object.`);
      }
      validateColumnDisplay(
        checkedValueType.defaultColumn as unknown as GridColumnDefinition<object>,
        `Default column for value type "${id}"`,
      );
    }
  });
  const fieldIds = new Set<string>();
  const fields = definition.fields.map((field) => {
    if (!isPlainRecord(field)) throw new Error('Every grid field must be a plain object.');
    if (typeof field.id !== 'string' || !field.id.trim()) {
      throw new Error('Every grid field requires a stable id.');
    }
    if (field.title === undefined || field.title === null) {
      throw new Error(`Grid field "${field.id}" requires a title.`);
    }
    if (
      field.valueType !== undefined &&
      (typeof field.valueType !== 'string' || !field.valueType)
    ) {
      throw new Error(`Grid field "${field.id}" has an invalid valueType.`);
    }
    if (fieldIds.has(field.id)) throw new Error(`Duplicate grid field id: ${field.id}`);
    fieldIds.add(field.id);
    if (field.path !== undefined) validatePath(field.path, `Path for field "${field.id}"`);
    validateSchemaFieldFeatures(field, `Grid field "${field.id}"`);
    for (const callback of [
      'accessor',
      'normalize',
      'equals',
      'getIdentity',
      'compare',
      'searchText',
      'filterPredicate',
      'validate',
      'render',
      'editor',
      'filterEditor',
    ] as const) {
      if (field[callback] !== undefined && typeof field[callback] !== 'function') {
        throw new Error(`Grid field "${field.id}" ${callback} must be a function.`);
      }
    }
    if (field.transport !== undefined) {
      if (!isPlainRecord(field.transport)) {
        throw new Error(`Transport for field "${field.id}" must be an object.`);
      }
      const transport = field.transport as unknown as NonNullable<
        GridAnyFieldDefinition<Row>['transport']
      >;
      (['filterKey', 'sortKey', 'selectKey'] as const).forEach((key) => {
        const value = transport[key];
        if (value !== undefined && (typeof value !== 'string' || !value.trim())) {
          throw new Error(`Transport ${key} for field "${field.id}" must be a non-empty string.`);
        }
      });
      validateNonEmptyStrings(
        transport.selectDependencies,
        `Projection dependency keys for field "${field.id}"`,
      );
      for (const callback of ['encodeFilter', 'encodeValue'] as const) {
        if (transport[callback] !== undefined && typeof transport[callback] !== 'function') {
          throw new Error(`Transport ${callback} for field "${field.id}" must be a function.`);
        }
      }
    }
    if (field.column !== undefined && field.column !== false) {
      if (!isPlainRecord(field.column)) {
        throw new Error(`Column defaults for field "${field.id}" must be an object.`);
      }
      validateColumnDisplay(
        field.column as unknown as GridColumnDefinition<object>,
        `Column defaults for field "${field.id}"`,
      );
    }
    if (field.meta !== undefined && !isPlainRecord(field.meta)) {
      throw new Error(`Meta for field "${field.id}" must be an object.`);
    }
    return resolveField(field as unknown as GridAnyFieldDefinition<Row>, valueTypes);
  });
  const fieldMap = new Map(fields.map((field) => [field.id, field]));
  fields.forEach((field) => {
    if (!field.options || Array.isArray(field.options) || typeof field.options === 'function')
      return;
    if (typeof field.options.load !== 'function') {
      throw new Error(`Option provider for field "${field.id}" requires a load function.`);
    }
    if (
      field.options.cacheTime !== undefined &&
      (!Number.isFinite(field.options.cacheTime) || field.options.cacheTime < 0)
    ) {
      throw new Error(`Option cacheTime for field "${field.id}" must be non-negative.`);
    }
    if (field.options.dependsOn !== undefined && field.options.dependsOn !== 'query') {
      const dependencies = validateNonEmptyStrings(
        field.options.dependsOn,
        `Option dependencies for field "${field.id}"`,
      );
      dependencies.forEach((dependency) => {
        if (!fieldMap.has(dependency)) {
          throw new Error(
            `Option provider for field "${field.id}" depends on unknown field "${dependency}".`,
          );
        }
      });
    }
  });
  const requiredFields = validateNonEmptyStrings(
    definition.projection?.requiredFields,
    'Projection requiredFields',
  );
  requiredFields.forEach((fieldId) => {
    if (!fieldMap.has(fieldId)) {
      throw new Error(`Projection references unknown required field "${fieldId}".`);
    }
  });
  const configuredRowKey = definition.projection?.rowKey;
  if (typeof configuredRowKey === 'string') {
    if (!configuredRowKey.trim()) {
      throw new Error('Projection rowKey must be a non-empty transport key.');
    }
  } else {
    const keys = validateNonEmptyStrings(configuredRowKey, 'Projection rowKey');
    if (configuredRowKey !== undefined && keys.length === 0) {
      throw new Error('Projection rowKey must contain at least one transport key.');
    }
  }
  validateNonEmptyStrings(definition.projection?.requiredKeys, 'Projection requiredKeys');
  fields.forEach((field) => {
    validateNonEmptyStrings(
      field.transport.selectDependencies,
      `Projection dependency keys for field "${field.id}"`,
    );
  });
  const fieldDefinitions = new Map(definition.fields.map((field) => [field.id, field]));
  const inputColumns =
    definition.columns ||
    definition.fields
      .filter((field) => field.column !== false)
      .map((field) => ({ id: field.id, fieldId: field.id }) satisfies GridColumnDefinition<Row>);
  const validateInputColumn = (column: GridColumnDefinition<Row>, label: string): void => {
    if (!isPlainRecord(column)) throw new Error(`${label} must be a plain object.`);
    if (typeof column.id !== 'string' || !column.id.trim()) {
      throw new Error(`${label} requires a stable id.`);
    }
    if (column.fieldId !== undefined && (typeof column.fieldId !== 'string' || !column.fieldId)) {
      throw new Error(`${label} has an invalid fieldId.`);
    }
    if (column.children !== undefined && !Array.isArray(column.children)) {
      throw new Error(`${label} children must be an array.`);
    }
    for (const callback of ['render', 'header'] as const) {
      if (column[callback] !== undefined && typeof column[callback] !== 'function') {
        throw new Error(`${label} ${callback} must be a function.`);
      }
    }
    if (column.meta !== undefined && !isPlainRecord(column.meta)) {
      throw new Error(`${label} meta must be an object.`);
    }
    validateColumnDisplay(column as unknown as GridColumnDefinition<object>, label);
    column.children?.forEach((child, index) =>
      validateInputColumn(child, `${label} child ${index}`),
    );
  };
  inputColumns.forEach((column, index) => validateInputColumn(column, `Grid column ${index}`));
  const columns = inputColumns.map((column) =>
    resolveColumn(column, fieldMap, fieldDefinitions, valueTypes),
  );
  const allColumns = flattenColumns(columns);
  const columnIds = new Set<string>();
  allColumns.forEach((column) => {
    if (typeof column.id !== 'string' || !column.id.trim()) {
      throw new Error('Every grid column requires a stable id.');
    }
    validateColumnDisplay(
      column as unknown as GridColumnDefinition<object>,
      `Grid column "${column.id}"`,
    );
    if (columnIds.has(column.id)) throw new Error(`Duplicate grid column id: ${column.id}`);
    columnIds.add(column.id);
  });
  const columnMap = new Map(allColumns.map((column) => [column.id, column]));
  const actionIds = new Set<string>();
  definition.actions?.forEach((action) => {
    if (!isPlainRecord(action)) throw new Error('Every grid action must be a plain object.');
    if (typeof action.id !== 'string' || !action.id.trim()) {
      throw new Error('Every grid action requires a stable id.');
    }
    if (actionIds.has(action.id)) throw new Error(`Duplicate grid action id: ${action.id}`);
    actionIds.add(action.id);
    if (typeof action.run !== 'function') {
      throw new Error(`Grid action "${action.id}" requires a run handler.`);
    }
    if (action.label === undefined || action.label === null) {
      throw new Error(`Grid action "${action.id}" requires a label.`);
    }
    if (
      action.placement !== undefined &&
      (typeof action.placement !== 'string' ||
        !['toolbar', 'row', 'bulk', 'cell'].includes(action.placement))
    ) {
      throw new Error(`Grid action "${action.id}" has an invalid placement.`);
    }
    if (
      action.intent !== undefined &&
      (typeof action.intent !== 'string' ||
        !['default', 'primary', 'danger'].includes(action.intent))
    ) {
      throw new Error(`Grid action "${action.id}" has an invalid intent.`);
    }
    if (action.order !== undefined && !Number.isFinite(action.order)) {
      throw new Error(`Grid action "${action.id}" has an invalid order.`);
    }
    if (action.group !== undefined && (typeof action.group !== 'string' || !action.group.trim())) {
      throw new Error(`Grid action "${action.id}" has an invalid group.`);
    }
    if (action.refresh !== undefined && typeof action.refresh !== 'boolean') {
      throw new Error(`Grid action "${action.id}" refresh must be a boolean.`);
    }
    if (action.getConfirmation !== undefined && typeof action.getConfirmation !== 'function') {
      throw new Error(`Grid action "${action.id}" getConfirmation must be a function.`);
    }
    for (const property of ['visible', 'disabled'] as const) {
      if (
        action[property] !== undefined &&
        typeof action[property] !== 'boolean' &&
        typeof action[property] !== 'function'
      ) {
        throw new Error(`Grid action "${action.id}" ${property} must be a boolean or function.`);
      }
    }
  });

  const getRowKey = (row: Row): GridRowKey => {
    const key =
      typeof definition.rowKey === 'function'
        ? definition.rowKey(row)
        : getPathValue(
            row,
            Array.isArray(definition.rowKey) ? definition.rowKey : [definition.rowKey],
          );
    if (!(
      (typeof key === 'string' && key.length > 0) ||
      (typeof key === 'number' && Number.isSafeInteger(key))
    )) {
      throw new Error('Grid rowKey must resolve to a non-empty string or safe integer.');
    }
    return key;
  };

  return {
    ...definition,
    revision,
    fields,
    columns,
    fieldMap,
    columnMap,
    getRowKey,
  };
}

function bindField<Row extends object>(
  schema: GridFieldSchema,
  runtimeField: GridFieldRuntime<Row>,
  runtime: GridRuntime<Row>,
): GridAnyFieldDefinition<Row> {
  let options: GridAnyFieldDefinition<Row>['options'];
  if (runtimeField.options) options = runtimeField.options;
  else if (schema.options?.type === 'static') options = schema.options.items;
  else if (schema.options?.type === 'runtime') {
    const load = runtime.optionLoaders?.[schema.options.loader];
    if (!load)
      throw new Error(`Missing option loader "${schema.options.loader}" for field "${schema.id}".`);
    options = {
      load,
      cacheTime: schema.options.cacheTime,
      dependsOn: schema.options.dependsOn,
    };
  }
  const render =
    runtimeField.render || (schema.renderer ? runtime.renderers?.[schema.renderer] : undefined);
  const editor =
    runtimeField.editor || (schema.editor ? runtime.editors?.[schema.editor] : undefined);
  const filterEditor =
    runtimeField.filterEditor ||
    (schema.filterEditor ? runtime.filterEditors?.[schema.filterEditor] : undefined);
  if (schema.renderer && !render) {
    throw new Error(`Missing renderer "${schema.renderer}" for field "${schema.id}".`);
  }
  if (schema.editor && !editor) {
    throw new Error(`Missing editor "${schema.editor}" for field "${schema.id}".`);
  }
  if (schema.filterEditor && !filterEditor) {
    throw new Error(`Missing filter editor "${schema.filterEditor}" for field "${schema.id}".`);
  }
  return {
    id: schema.id,
    title: runtimeField.title ?? schema.title,
    valueType: schema.valueType,
    path: schema.path,
    accessor: runtimeField.accessor,
    normalize: runtimeField.normalize,
    transport: { ...schema.transport, ...runtimeField.transport },
    filter: schema.filter,
    sort: schema.sort,
    edit: schema.edit,
    options,
    description: schema.description,
    column: schema.column,
    equals: runtimeField.equals,
    getIdentity: runtimeField.getIdentity,
    compare: runtimeField.compare,
    searchText: runtimeField.searchText,
    filterPredicate: runtimeField.filterPredicate,
    validate: runtimeField.validate,
    render,
    editor,
    filterEditor,
    meta: schema.meta,
  };
}

function bindColumn<Row extends object>(
  schema: GridColumnSchema,
  runtime: GridRuntime<Row>,
): GridColumnDefinition<Row> {
  const render = schema.renderer ? runtime.columnRenderers?.[schema.renderer] : undefined;
  const header = schema.header ? runtime.columnHeaders?.[schema.header] : undefined;
  if (schema.renderer && !render) {
    throw new Error(`Missing column renderer "${schema.renderer}" for column "${schema.id}".`);
  }
  if (schema.header && !header) {
    throw new Error(`Missing column header "${schema.header}" for column "${schema.id}".`);
  }
  return {
    id: schema.id,
    fieldId: schema.fieldId,
    title: schema.title,
    description: schema.description,
    width: schema.width,
    minWidth: schema.minWidth,
    maxWidth: schema.maxWidth,
    align: schema.align,
    fixed: schema.fixed,
    hidden: schema.hidden,
    hideable: schema.hideable,
    reorderable: schema.reorderable,
    resizable: schema.resizable,
    pinnable: schema.pinnable,
    ellipsis: schema.ellipsis,
    wrap: schema.wrap,
    render,
    header,
    meta: schema.meta,
    children: schema.children?.map((child) => bindColumn(child, runtime)),
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return (
    (prototype === Object.prototype || prototype === null) &&
    Object.getOwnPropertySymbols(value).length === 0
  );
}

function isSchemaJsonValue(value: unknown, seen = new WeakSet<object>()): boolean {
  if (value == null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (!value || typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  const valid = Array.isArray(value)
    ? value.every((item) => isSchemaJsonValue(item, seen))
    : isPlainRecord(value) && Object.values(value).every((item) => isSchemaJsonValue(item, seen));
  seen.delete(value);
  return valid;
}

function requireSchemaString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim())
    throw new Error(`${label} must be a non-empty string.`);
}

function validateSchemaFeature(value: unknown, label: string): void {
  if (value === undefined || typeof value === 'boolean') return;
  if (!isPlainRecord(value)) throw new Error(`${label} must be a boolean or object.`);
}

function validateSchemaFieldFeatures(field: Record<string, unknown>, label: string): void {
  validateSchemaFeature(field.filter, `${label}.filter`);
  if (isPlainRecord(field.filter)) {
    if (field.filter.enabled !== undefined && typeof field.filter.enabled !== 'boolean') {
      throw new Error(`${label}.filter.enabled must be a boolean.`);
    }
    const operators = validateNonEmptyStrings(field.filter.operators, `${label}.filter.operators`);
    if (field.filter.defaultOperator !== undefined) {
      requireSchemaString(field.filter.defaultOperator, `${label}.filter.defaultOperator`);
      if (operators.length && !operators.includes(field.filter.defaultOperator)) {
        throw new Error(`${label}.filter.defaultOperator must be included in operators.`);
      }
    }
    checkedOperatorValueKinds(
      field.filter.operatorValueKinds as GridFilterOperatorValueKinds | undefined,
      `${label}.filter.operatorValueKinds`,
    );
    if (field.filter.placeholder !== undefined && typeof field.filter.placeholder !== 'string') {
      throw new Error(`${label}.filter.placeholder must be a string.`);
    }
  }

  validateSchemaFeature(field.sort, `${label}.sort`);
  if (isPlainRecord(field.sort)) {
    if (field.sort.enabled !== undefined && typeof field.sort.enabled !== 'boolean') {
      throw new Error(`${label}.sort.enabled must be a boolean.`);
    }
    if (
      field.sort.defaultDirection !== undefined &&
      field.sort.defaultDirection !== 'asc' &&
      field.sort.defaultDirection !== 'desc'
    ) {
      throw new Error(`${label}.sort.defaultDirection is invalid.`);
    }
    if (field.sort.nulls !== undefined && typeof field.sort.nulls !== 'boolean') {
      throw new Error(`${label}.sort.nulls must be a boolean.`);
    }
  }

  validateSchemaFeature(field.edit, `${label}.edit`);
  if (isPlainRecord(field.edit)) {
    for (const property of ['enabled', 'required', 'multiple'] as const) {
      if (field.edit[property] !== undefined && typeof field.edit[property] !== 'boolean') {
        throw new Error(`${label}.edit.${property} must be a boolean.`);
      }
    }
    if (
      field.edit.numericMode !== undefined &&
      field.edit.numericMode !== 'number' &&
      field.edit.numericMode !== 'string'
    ) {
      throw new Error(`${label}.edit.numericMode must be number or string.`);
    }
    for (const property of ['editor', 'placeholder'] as const) {
      if (field.edit[property] !== undefined && typeof field.edit[property] !== 'string') {
        throw new Error(`${label}.edit.${property} must be a string.`);
      }
    }
  }
}

function validateSchemaColumn(column: unknown, label: string): asserts column is GridColumnSchema {
  if (!isPlainRecord(column)) throw new Error(`${label} must be an object.`);
  requireSchemaString(column.id, `${label}.id`);
  if (column.fieldId !== undefined) requireSchemaString(column.fieldId, `${label}.fieldId`);
  if (column.title !== undefined && typeof column.title !== 'string') {
    throw new Error(`${label}.title must be a string.`);
  }
  if (column.description !== undefined && typeof column.description !== 'string') {
    throw new Error(`${label}.description must be a string.`);
  }
  if (column.renderer !== undefined) requireSchemaString(column.renderer, `${label}.renderer`);
  if (column.header !== undefined) requireSchemaString(column.header, `${label}.header`);
  validateColumnDisplay(column as unknown as GridColumnDefinition<object>, label);
  if (
    column.meta !== undefined &&
    (!isPlainRecord(column.meta) || !isSchemaJsonValue(column.meta))
  ) {
    throw new Error(`${label}.meta must be a JSON-safe object.`);
  }
  if (column.children !== undefined) {
    if (!Array.isArray(column.children)) throw new Error(`${label}.children must be an array.`);
  }
}

/** Parses untrusted server JSON before it is combined with trusted runtime callbacks. */
export function parseGridSchema(input: unknown): GridSchema {
  if (!isPlainRecord(input)) throw new Error('Grid schema must be a plain object.');
  if (input.protocol !== 'huiyun.data-grid/v1') {
    throw new Error(`Unsupported grid protocol: ${String(input.protocol)}`);
  }
  requireSchemaString(input.id, 'Grid schema id');
  if (!(
    (typeof input.revision === 'string' && input.revision.trim()) ||
    (typeof input.revision === 'number' && Number.isSafeInteger(input.revision))
  )) {
    throw new Error('Grid schema revision must be a non-empty string or safe integer.');
  }
  if (!Array.isArray(input.fields)) throw new Error('Grid schema fields must be an array.');
  const fieldIds = new Set<string>();
  input.fields.forEach((value, index) => {
    const label = `Grid schema field[${index}]`;
    if (!isPlainRecord(value)) throw new Error(`${label} must be an object.`);
    requireSchemaString(value.id, `${label}.id`);
    if (fieldIds.has(value.id)) throw new Error(`Duplicate grid schema field id: ${value.id}`);
    fieldIds.add(value.id);
    if (typeof value.title !== 'string') throw new Error(`${label}.title must be a string.`);
    if (value.valueType !== undefined) requireSchemaString(value.valueType, `${label}.valueType`);
    if (value.path !== undefined) validatePath(value.path, `${label}.path`);
    if (value.description !== undefined && typeof value.description !== 'string') {
      throw new Error(`${label}.description must be a string.`);
    }
    validateSchemaFieldFeatures(value, label);
    if (value.column !== undefined && value.column !== false) {
      if (!isPlainRecord(value.column))
        throw new Error(`${label}.column must be false or an object.`);
      validateColumnDisplay(
        value.column as unknown as GridColumnDefinition<object>,
        `${label}.column`,
      );
    }
    if (value.transport !== undefined) {
      if (!isPlainRecord(value.transport)) throw new Error(`${label}.transport must be an object.`);
      ['filterKey', 'sortKey', 'selectKey'].forEach((key) => {
        if (value.transport && (value.transport as Record<string, unknown>)[key] !== undefined) {
          requireSchemaString(
            (value.transport as Record<string, unknown>)[key],
            `${label}.transport.${key}`,
          );
        }
      });
      if ((value.transport as Record<string, unknown>).selectDependencies !== undefined) {
        validateNonEmptyStrings(
          (value.transport as Record<string, unknown>).selectDependencies,
          `${label}.transport.selectDependencies`,
        );
      }
    }
    for (const key of ['renderer', 'editor', 'filterEditor'] as const) {
      if (value[key] !== undefined) requireSchemaString(value[key], `${label}.${key}`);
    }
    if (value.options !== undefined) {
      if (!isPlainRecord(value.options)) throw new Error(`${label}.options must be an object.`);
      if (value.options.type === 'static') {
        normalizeGridOptions(value.options.items, `${label}.options.items`);
        (value.options.items as unknown[]).forEach((option, optionIndex) => {
          const optionLabel = `${label}.options.items[${optionIndex}]`;
          if (!isPlainRecord(option) || typeof option.label !== 'string') {
            throw new Error(`${optionLabel}.label must be a string.`);
          }
          if (option.description !== undefined && typeof option.description !== 'string') {
            throw new Error(`${optionLabel}.description must be a string.`);
          }
          if (
            option.meta !== undefined &&
            (!isPlainRecord(option.meta) || !isSchemaJsonValue(option.meta))
          ) {
            throw new Error(`${optionLabel}.meta must be a JSON-safe object.`);
          }
        });
      } else if (value.options.type === 'runtime') {
        requireSchemaString(value.options.loader, `${label}.options.loader`);
        if (
          value.options.cacheTime !== undefined &&
          (!Number.isFinite(value.options.cacheTime) || (value.options.cacheTime as number) < 0)
        ) {
          throw new Error(`${label}.options.cacheTime must be non-negative.`);
        }
        if (value.options.dependsOn !== undefined && value.options.dependsOn !== 'query') {
          validateNonEmptyStrings(value.options.dependsOn, `${label}.options.dependsOn`);
        }
      } else {
        throw new Error(`${label}.options has an unknown type.`);
      }
    }
    if (
      value.meta !== undefined &&
      (!isPlainRecord(value.meta) || !isSchemaJsonValue(value.meta))
    ) {
      throw new Error(`${label}.meta must be a JSON-safe object.`);
    }
  });
  if (input.columns !== undefined) {
    if (!Array.isArray(input.columns)) throw new Error('Grid schema columns must be an array.');
    const columnIds = new Set<string>();
    const visitColumn = (column: unknown, label: string): void => {
      validateSchemaColumn(column, label);
      if (columnIds.has(column.id))
        throw new Error(`Duplicate grid schema column id: ${column.id}`);
      columnIds.add(column.id);
      if (column.fieldId && !fieldIds.has(column.fieldId)) {
        throw new Error(`${label} references unknown field "${column.fieldId}".`);
      }
      column.children?.forEach((child, index) => visitColumn(child, `${label}.children[${index}]`));
    };
    input.columns.forEach((column, index) => visitColumn(column, `Grid schema column[${index}]`));
  }
  if (input.actions !== undefined) {
    if (!Array.isArray(input.actions)) throw new Error('Grid schema actions must be an array.');
    const actionIds = new Set<string>();
    input.actions.forEach((value, index) => {
      const label = `Grid schema action[${index}]`;
      if (!isPlainRecord(value)) throw new Error(`${label} must be an object.`);
      for (const key of ['id', 'label', 'handler'] as const)
        requireSchemaString(value[key], `${label}.${key}`);
      if (actionIds.has(value.id as string))
        throw new Error(`Duplicate grid schema action id: ${String(value.id)}`);
      actionIds.add(value.id as string);
      if (
        value.placement !== undefined &&
        !['toolbar', 'row', 'bulk', 'cell'].includes(String(value.placement))
      ) {
        throw new Error(`${label}.placement is invalid.`);
      }
      if (
        value.intent !== undefined &&
        !['default', 'primary', 'danger'].includes(String(value.intent))
      ) {
        throw new Error(`${label}.intent is invalid.`);
      }
      if (value.confirm !== undefined && typeof value.confirm !== 'string') {
        throw new Error(`${label}.confirm must be a string.`);
      }
      if (value.refresh !== undefined && typeof value.refresh !== 'boolean') {
        throw new Error(`${label}.refresh must be a boolean.`);
      }
      if (
        value.order !== undefined &&
        (typeof value.order !== 'number' || !Number.isFinite(value.order))
      ) {
        throw new Error(`${label}.order must be a finite number.`);
      }
      if (value.group !== undefined && (typeof value.group !== 'string' || !value.group.trim())) {
        throw new Error(`${label}.group must be a non-empty string.`);
      }
    });
  }
  if (input.projection !== undefined) {
    if (!isPlainRecord(input.projection))
      throw new Error('Grid schema projection must be an object.');
    const rowKey = input.projection.rowKey;
    if (typeof rowKey === 'string') requireSchemaString(rowKey, 'Grid schema projection.rowKey');
    else if (rowKey !== undefined) {
      const keys = validateNonEmptyStrings(rowKey, 'Grid schema projection.rowKey');
      if (!keys.length) throw new Error('Grid schema projection.rowKey cannot be empty.');
    }
    validateNonEmptyStrings(
      input.projection.requiredFields,
      'Grid schema projection.requiredFields',
    ).forEach((fieldId) => {
      if (!fieldIds.has(fieldId)) {
        throw new Error(`Grid schema projection references unknown field "${fieldId}".`);
      }
    });
    validateNonEmptyStrings(input.projection.requiredKeys, 'Grid schema projection.requiredKeys');
  }
  if (input.defaults !== undefined) {
    if (!isPlainRecord(input.defaults)) throw new Error('Grid schema defaults must be an object.');
    if (
      input.defaults.pageSize !== undefined &&
      (!Number.isSafeInteger(input.defaults.pageSize) || (input.defaults.pageSize as number) < 1)
    ) {
      throw new Error('Grid schema defaults.pageSize must be a positive safe integer.');
    }
    if (
      input.defaults.density !== undefined &&
      !['compact', 'default', 'comfortable'].includes(String(input.defaults.density))
    ) {
      throw new Error('Grid schema defaults.density is invalid.');
    }
    for (const property of ['selection', 'views'] as const) {
      if (input.defaults[property] !== undefined && typeof input.defaults[property] !== 'boolean') {
        throw new Error(`Grid schema defaults.${property} must be a boolean.`);
      }
    }
  }
  if (input.meta !== undefined && (!isPlainRecord(input.meta) || !isSchemaJsonValue(input.meta))) {
    throw new Error('Grid schema meta must be a JSON-safe object.');
  }
  return input as unknown as GridSchema;
}

export function bindGridSchema<Row extends object>(
  schema: GridSchema,
  runtime: GridRuntime<Row>,
  rowKey: GridDefinition<Row>['rowKey'],
): GridDefinition<Row> {
  schema = parseGridSchema(schema);
  return {
    id: schema.id,
    revision: schema.revision,
    rowKey,
    projection: schema.projection,
    fields: schema.fields.map((field) =>
      bindField(field, runtime.fields?.[field.id] || {}, runtime),
    ),
    columns: schema.columns?.map((column) => bindColumn(column, runtime)),
    actions: schema.actions?.map((action) => {
      const actionRuntime = runtime.actions?.[action.id];
      const run = actionRuntime?.run || runtime.actionHandlers?.[action.handler];
      if (!run)
        throw new Error(`Missing action handler "${action.handler}" for action "${action.id}".`);
      return {
        ...actionRuntime,
        id: action.id,
        label: actionRuntime?.label ?? action.label,
        placement: actionRuntime?.placement ?? action.placement,
        intent: actionRuntime?.intent ?? action.intent,
        confirm: actionRuntime?.confirm ?? action.confirm,
        refresh: actionRuntime?.refresh ?? action.refresh,
        order: actionRuntime?.order ?? action.order,
        group: actionRuntime?.group ?? action.group,
        run,
      };
    }),
    editing: runtime.editing,
    defaults: schema.defaults,
    valueTypes: runtime.valueTypes,
    meta: schema.meta,
  };
}

export function definitionSignature<Row extends object>(
  definition: GridResolvedDefinition<Row>,
): string {
  const columns = (items: readonly GridResolvedColumn<Row>[]): unknown[] =>
    items.map((column) => ({
      id: column.id,
      fieldId: column.fieldId,
      width: column.width,
      minWidth: column.minWidth,
      maxWidth: column.maxWidth,
      align: column.align,
      fixed: column.fixed,
      hidden: column.hidden,
      hideable: column.hideable,
      reorderable: column.reorderable,
      resizable: column.resizable,
      pinnable: column.pinnable,
      ellipsis: column.ellipsis,
      wrap: column.wrap,
      children: column.children ? columns(column.children) : undefined,
    }));
  return stableStringify({
    id: definition.id,
    revision: definition.revision,
    rowKey:
      typeof definition.rowKey === 'function'
        ? { type: 'function', identity: definition.rowKeyIdentity }
        : { type: 'path', value: definition.rowKey },
    fields: definition.fields.map((field) => ({
      id: field.id,
      valueType: field.valueType,
      path: field.path,
      transport: {
        filterKey: field.transport.filterKey,
        sortKey: field.transport.sortKey,
        selectKey: field.transport.selectKey,
        selectDependencies: field.transport.selectDependencies,
      },
      filter: field.filter,
      sort: field.sort,
      edit: field.edit,
    })),
    columns: columns(definition.columns),
    actions: definition.actions?.map(({ id, placement, intent, order, group, refresh }) => ({
      id,
      placement,
      intent,
      order,
      group,
      refresh,
    })),
    projection: definition.projection,
    defaults: definition.defaults,
  });
}
