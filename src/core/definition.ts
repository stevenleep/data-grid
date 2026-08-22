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
  GridResolvedColumn,
  GridResolvedDefinition,
  GridResolvedField,
  GridRowKey,
  GridRuntime,
  GridSchema,
  GridValueTypeDefinition,
} from './types';
import { getFilterOperatorValueKind, getPathValue, isEmptyValue, stableStringify } from './model';
import { compareExactNumeric } from './numeric';

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

const jsonCodec = {
  encode(value: unknown): GridJsonValue | undefined {
    if (value === undefined) return undefined;
    try {
      return JSON.parse(JSON.stringify(value)) as GridJsonValue;
    } catch {
      return String(value);
    }
  },
  decode(value: GridJsonValue | undefined): unknown {
    return value;
  },
};

function compareUnknown(left: unknown, right: unknown): number {
  const numericResult = compareExactNumeric(left, right);
  if (numericResult !== undefined) return numericResult;
  return String(left ?? '').localeCompare(String(right ?? ''), undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

export const builtinValueTypes: Record<string, GridValueTypeDefinition<object>> = {
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
  },
  multiSelect: {
    defaultColumn: { width: 180, align: 'left' },
    operators: multiOptionOperators,
    codec: jsonCodec,
  },
  status: {
    defaultColumn: { width: 120, align: 'left' },
    operators: optionOperators,
    codec: jsonCodec,
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
  user: { defaultColumn: { width: 152 }, operators: multiOptionOperators, codec: jsonCodec },
  relation: { defaultColumn: { width: 180 }, operators: multiOptionOperators, codec: jsonCodec },
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

export function createFieldHelper<Row extends object>() {
  return {
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
  valueTypes: Record<string, GridValueTypeDefinition<Row>>,
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
    options: field.options,
    description: field.description,
    getValue: (row) => normalize(getValue(row), row),
    normalize,
    equals: type.equals || Object.is,
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
  valueTypes: Record<string, GridValueTypeDefinition<Row>>,
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
  return value as string[];
}

export function isResolvedGridDefinition<Row extends object>(
  definition: GridDefinition<Row> | GridResolvedDefinition<Row>,
): definition is GridResolvedDefinition<Row> {
  return 'fieldMap' in definition && definition.fieldMap instanceof Map;
}

export function resolveGridDefinition<Row extends object>(
  definition: GridDefinition<Row> | GridResolvedDefinition<Row>,
): GridResolvedDefinition<Row> {
  if (isResolvedGridDefinition(definition)) return definition;
  if (!definition.id.trim()) throw new Error('Grid definition requires a stable id.');

  const valueTypes: Record<string, GridValueTypeDefinition<Row>> = {
    ...(builtinValueTypes as unknown as Record<string, GridValueTypeDefinition<Row>>),
    ...definition.valueTypes,
  };
  const fieldIds = new Set<string>();
  const fields = definition.fields.map((field) => {
    if (!field.id.trim()) throw new Error('Every grid field requires a stable id.');
    if (fieldIds.has(field.id)) throw new Error(`Duplicate grid field id: ${field.id}`);
    fieldIds.add(field.id);
    return resolveField(field, valueTypes);
  });
  const fieldMap = new Map(fields.map((field) => [field.id, field]));
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
  const columns = inputColumns.map((column) =>
    resolveColumn(column, fieldMap, fieldDefinitions, valueTypes),
  );
  const allColumns = flattenColumns(columns);
  const columnIds = new Set<string>();
  allColumns.forEach((column) => {
    if (columnIds.has(column.id)) throw new Error(`Duplicate grid column id: ${column.id}`);
    columnIds.add(column.id);
  });
  const columnMap = new Map(allColumns.map((column) => [column.id, column]));
  const actionIds = new Set<string>();
  definition.actions?.forEach((action) => {
    if (!action.id.trim()) throw new Error('Every grid action requires a stable id.');
    if (actionIds.has(action.id)) throw new Error(`Duplicate grid action id: ${action.id}`);
    actionIds.add(action.id);
  });

  const getRowKey = (row: Row): GridRowKey => {
    const key =
      typeof definition.rowKey === 'function'
        ? definition.rowKey(row)
        : getPathValue(
            row,
            Array.isArray(definition.rowKey) ? definition.rowKey : [definition.rowKey],
          );
    if (typeof key !== 'string' && typeof key !== 'number') {
      throw new Error('Grid rowKey must resolve to a string or number.');
    }
    return key;
  };

  return {
    ...definition,
    revision: definition.revision ?? 1,
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

export function bindGridSchema<Row extends object>(
  schema: GridSchema,
  runtime: GridRuntime<Row>,
  rowKey: GridDefinition<Row>['rowKey'],
): GridDefinition<Row> {
  if (schema.protocol !== 'huiyun.data-grid/v1') {
    throw new Error(`Unsupported grid protocol: ${String(schema.protocol)}`);
  }
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
  return stableStringify({
    id: definition.id,
    revision: definition.revision,
    fields: definition.fields.map((field) => field.id),
    columns: [...definition.columnMap.keys()],
    projection: definition.projection,
  });
}
