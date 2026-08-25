import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  CloseOutlined,
  FilterOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import {
  Alert,
  Button,
  Checkbox,
  DatePicker,
  Divider,
  Input,
  InputNumber,
  Popover,
  Select,
  Space,
  Tooltip,
} from 'antd';
import type { Dayjs } from 'dayjs';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  addFilterNode,
  cloneFilterGroup,
  countFilterConditions,
  createFilterCondition,
  createFilterGroup,
  filterConditionIsComplete,
  getFilterOperatorValueKind,
  getFilterDepth,
  moveFilterNode,
  normalizeFilterValue,
  pruneFilterGroup,
  removeFilterNode,
  updateFilterNode,
  type GridFilterCondition,
  type GridFilterGroup,
  type GridJsonValue,
  type GridFilterOperator,
  type GridResolvedCapabilities,
  type GridResolvedField,
} from '../core';
import { useGridInstance, useGridSelector } from '../react';
import { useGridUi } from './context';
import { getGridFieldValuesText } from './field-value';
import { useControllableOpen, useGridOptions } from './hooks';
import { gridDayjsValue } from './intl';
import { resolveGridLocale } from './locale';
import { gridNodeText, renderGridNode, safeGridText } from './render';

function allowedOperators<Row extends object>(
  field: GridResolvedField<Row>,
  sourceOperators: GridFilterOperator[] | undefined,
): GridFilterOperator[] {
  if (!field.filter) return [];
  const operators = field.filter.operators || ['equals'];
  return sourceOperators
    ? operators.filter((operator) => sourceOperators.includes(operator))
    : operators;
}

function defaultOperator<Row extends object>(
  field: GridResolvedField<Row>,
  sourceOperators: GridFilterOperator[] | undefined,
) {
  const operators = allowedOperators(field, sourceOperators);
  const configured = field.filter && field.filter.defaultOperator;
  return configured && operators.includes(configured) ? configured : operators[0] || 'equals';
}

function filterCapabilityConflict<Row extends object>(
  group: GridFilterGroup,
  fields: readonly GridResolvedField<Row>[],
  capabilities: GridResolvedCapabilities['filter'],
): boolean {
  const fieldMap = new Map(fields.map((field) => [field.id, field]));
  if (
    countFilterConditions(group) > capabilities.maxConditions ||
    getFilterDepth(group) > capabilities.maxDepth ||
    (group.children.length > 0 && capabilities.logic === 'and' && group.logic !== 'and') ||
    (capabilities.logic !== 'nested' && group.children.some((node) => node.type === 'group'))
  ) {
    return true;
  }
  let conflict = false;
  const visit = (current: GridFilterGroup) => {
    if (current.children.length > 0 && current.negated && !capabilities.negation) {
      conflict = true;
    }
    current.children.forEach((node) => {
      if (node.type === 'group') {
        visit(node);
        return;
      }
      const field = fieldMap.get(node.fieldId);
      if (
        !field?.filter ||
        !allowedOperators(field, capabilities.operators).includes(node.operator)
      ) {
        conflict = true;
        return;
      }
      const valueKind = getFilterOperatorValueKind(node.operator, field.filter.operatorValueKinds);
      if (
        !filterConditionIsComplete(node, valueKind) ||
        (valueKind === 'none' && node.value !== undefined)
      ) {
        conflict = true;
      }
    });
  };
  visit(group);
  return conflict;
}

function groupContainsProtectedCondition(
  group: GridFilterGroup,
  editableFieldIds: ReadonlySet<string>,
): boolean {
  return group.children.some((node) =>
    node.type === 'group'
      ? groupContainsProtectedCondition(node, editableFieldIds)
      : !editableFieldIds.has(node.fieldId),
  );
}

function GridFilterValue<Row extends object>({
  field,
  condition,
  onChange,
  ariaLabel,
  readOnly = false,
}: {
  field: GridResolvedField<Row>;
  condition: GridFilterCondition;
  onChange: (value: GridJsonValue | undefined) => void;
  ariaLabel: string;
  readOnly?: boolean;
}) {
  const instance = useGridInstance<Row>();
  const ui = useGridUi<Row>();
  const locale = resolveGridLocale(ui.locale, ui.language);
  const [search, setSearch] = useState('');
  useEffect(() => setSearch(''), [field.id]);
  const valueKind = getFilterOperatorValueKind(
    condition.operator,
    field.filter ? field.filter.operatorValueKinds : undefined,
  );
  const optionLike = Boolean(
    field.options ||
    ['select', 'multiSelect', 'status', 'user', 'relation', 'boolean'].includes(field.valueType),
  );
  const options = useGridOptions(
    field,
    search,
    valueKind !== 'none' && optionLike && !field.filterEditor,
  );
  const range = valueKind === 'range';
  if (readOnly) {
    const value = getGridFieldValuesText(condition.value, options.options, field);
    return (
      <span className="hui-grid__filter-readonly-value" aria-label={ariaLabel}>
        {valueKind === 'none' ? locale.filterNoValue : value || '—'}
      </span>
    );
  }
  if (valueKind === 'none') {
    return <span className="hui-grid__filter-no-value">{locale.filterNoValue}</span>;
  }

  if (field.filterEditor) {
    return renderGridNode(
      field.filterEditor({
        field,
        operator: condition.operator,
        valueKind,
        value: condition.value,
        onChange,
        instance,
      }),
    );
  }

  const resolvedOptions =
    field.valueType === 'boolean'
      ? [
          { label: locale.yes, value: true },
          { label: locale.no, value: false },
        ]
      : options.options.map((option) => ({
          ...option,
          label: renderGridNode(option.label),
        }));

  if (valueKind === 'multiple') {
    return (
      <Tooltip title={options.error?.message} open={Boolean(options.error)} color="red">
        <Select
          size="small"
          allowClear
          showSearch
          mode={optionLike ? 'multiple' : 'tags'}
          aria-label={ariaLabel}
          loading={options.loading}
          notFoundContent={
            options.loading ? <span role="status">{locale.loadingOptions}</span> : undefined
          }
          filterOption={optionLike ? false : undefined}
          options={
            resolvedOptions as Array<{
              label: ReactNode;
              value: string | number | boolean;
            }>
          }
          value={condition.value as (string | number | boolean)[] | undefined}
          placeholder={field.filter ? field.filter.placeholder : undefined}
          onSearch={optionLike ? setSearch : undefined}
          onChange={(value) => onChange(normalizeFilterValue(value))}
        />
      </Tooltip>
    );
  }

  if (field.valueType === 'date' || field.valueType === 'dateTime') {
    const dateFormat = field.valueType === 'date' ? 'YYYY-MM-DD' : undefined;
    if (range) {
      const values = Array.isArray(condition.value) ? condition.value : [];
      const pickerValue: [Dayjs | null, Dayjs | null] | null = values.length
        ? [
            gridDayjsValue(values[0], field.valueType === 'dateTime', ui.timeZone),
            gridDayjsValue(values[1], field.valueType === 'dateTime', ui.timeZone),
          ]
        : null;
      return (
        <DatePicker.RangePicker
          size="small"
          showTime={field.valueType === 'dateTime'}
          aria-label={ariaLabel}
          value={pickerValue}
          onChange={(dates) =>
            onChange(
              dates?.map((date) =>
                date ? (dateFormat ? date.format(dateFormat) : date.toISOString()) : null,
              ) as GridJsonValue,
            )
          }
        />
      );
    }
    const current = gridDayjsValue(condition.value, field.valueType === 'dateTime', ui.timeZone);
    return (
      <DatePicker
        size="small"
        showTime={field.valueType === 'dateTime'}
        aria-label={ariaLabel}
        value={current?.isValid() ? current : null}
        onChange={(date) =>
          onChange(date ? (dateFormat ? date.format(dateFormat) : date.toISOString()) : undefined)
        }
      />
    );
  }

  if (['number', 'decimal', 'money', 'percent', 'duration'].includes(field.valueType)) {
    const stringMode = field.valueType === 'decimal' || field.valueType === 'money';
    const ratioPercent = field.valueType === 'percent' && field.meta?.percentScale === 'ratio';
    const inputValue = (value: unknown) => {
      if (!ratioPercent || value == null || value === '') return value;
      const number = Number(value);
      return Number.isFinite(number) ? number * 100 : value;
    };
    const filterValue = (value: number | string | null) => {
      if (!ratioPercent || value == null) return normalizeFilterValue(value);
      const number = Number(value);
      return normalizeFilterValue(Number.isFinite(number) ? number / 100 : value);
    };
    if (range) {
      const values = Array.isArray(condition.value) ? condition.value : [];
      return (
        <Space.Compact>
          <InputNumber
            size="small"
            stringMode={stringMode}
            placeholder={locale.minimum}
            aria-label={`${ariaLabel}: ${locale.minimum}`}
            value={inputValue(values[0]) as number | string | null | undefined}
            onChange={(value) => onChange([filterValue(value) ?? null, values[1] ?? null])}
          />
          <InputNumber
            size="small"
            stringMode={stringMode}
            placeholder={locale.maximum}
            aria-label={`${ariaLabel}: ${locale.maximum}`}
            value={inputValue(values[1]) as number | string | null | undefined}
            onChange={(value) => onChange([values[0] ?? null, filterValue(value) ?? null])}
          />
        </Space.Compact>
      );
    }
    return (
      <InputNumber
        size="small"
        stringMode={stringMode}
        aria-label={ariaLabel}
        value={inputValue(condition.value) as number | string | null | undefined}
        onChange={(value) => onChange(filterValue(value))}
      />
    );
  }

  if (optionLike) {
    if (range) {
      const values = Array.isArray(condition.value) ? condition.value : [];
      const selectOptions = resolvedOptions as Array<{
        label: ReactNode;
        value: string | number | boolean;
      }>;
      return (
        <Space.Compact>
          <Select
            size="small"
            allowClear
            showSearch
            loading={options.loading}
            aria-label={`${ariaLabel}: ${locale.minimum}`}
            filterOption={false}
            options={selectOptions}
            value={values[0] as string | number | boolean | undefined}
            onSearch={setSearch}
            onChange={(value) => onChange([normalizeFilterValue(value) ?? null, values[1] ?? null])}
          />
          <Select
            size="small"
            allowClear
            showSearch
            loading={options.loading}
            aria-label={`${ariaLabel}: ${locale.maximum}`}
            filterOption={false}
            options={selectOptions}
            value={values[1] as string | number | boolean | undefined}
            onSearch={setSearch}
            onChange={(value) => onChange([values[0] ?? null, normalizeFilterValue(value) ?? null])}
          />
        </Space.Compact>
      );
    }
    return (
      <Tooltip title={options.error?.message} open={Boolean(options.error)} color="red">
        <Select
          size="small"
          allowClear
          showSearch
          loading={options.loading}
          aria-label={ariaLabel}
          notFoundContent={
            options.loading ? <span role="status">{locale.loadingOptions}</span> : undefined
          }
          filterOption={false}
          options={resolvedOptions as Array<{ label: ReactNode; value: string | number | boolean }>}
          value={condition.value as string | number | boolean | undefined}
          placeholder={field.filter ? field.filter.placeholder : undefined}
          onSearch={setSearch}
          onChange={(value) => onChange(normalizeFilterValue(value))}
        />
      </Tooltip>
    );
  }

  if (range) {
    const values = Array.isArray(condition.value) ? condition.value : [];
    return (
      <Space.Compact>
        <Input
          size="small"
          allowClear
          value={values[0] == null ? '' : safeGridText(values[0])}
          aria-label={`${ariaLabel}: ${locale.minimum}`}
          onChange={(event) => onChange([event.target.value || null, values[1] ?? null])}
        />
        <Input
          size="small"
          allowClear
          value={values[1] == null ? '' : safeGridText(values[1])}
          aria-label={`${ariaLabel}: ${locale.maximum}`}
          onChange={(event) => onChange([values[0] ?? null, event.target.value || null])}
        />
      </Space.Compact>
    );
  }

  return (
    <Input
      size="small"
      allowClear
      value={condition.value == null ? '' : safeGridText(condition.value)}
      aria-label={ariaLabel}
      placeholder={field.filter ? field.filter.placeholder : undefined}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function GridFilterGroupEditor<Row extends object>({
  group,
  root,
  fields,
  editableFieldIds,
  depth,
  onChange,
}: {
  group: GridFilterGroup;
  root: GridFilterGroup;
  fields: GridResolvedField<Row>[];
  editableFieldIds: ReadonlySet<string>;
  depth: number;
  onChange: (filters: GridFilterGroup) => void;
}) {
  const instance = useGridInstance<Row>();
  const ui = useGridUi<Row>();
  const locale = resolveGridLocale(ui.locale, ui.language);
  const capabilities = instance.capabilities.filter;
  const canAdd = countFilterConditions(root) < capabilities.maxConditions;
  const groupProtected = groupContainsProtectedCondition(group, editableFieldIds);
  const addCondition = () => {
    const field = fields[0];
    if (!field || !canAdd) return;
    onChange(
      addFilterNode(
        root,
        group.id,
        createFilterCondition(
          field.id,
          defaultOperator(field, instance.capabilities.filter.operators),
        ),
      ),
    );
  };

  return (
    <div
      className={
        depth ? 'hui-grid__filter-group hui-grid__filter-group--nested' : 'hui-grid__filter-group'
      }
    >
      <div className="hui-grid__filter-group-header">
        <Select
          size="small"
          value={group.logic}
          aria-label={`${locale.filters}: ${depth + 1}`}
          disabled={groupProtected}
          options={[
            { label: locale.allConditions, value: 'and' },
            ...(capabilities.logic !== 'and' || group.logic === 'or'
              ? [
                  {
                    label: locale.anyCondition,
                    value: 'or' as const,
                    disabled: capabilities.logic === 'and',
                  },
                ]
              : []),
          ]}
          onChange={(logic) =>
            onChange(
              updateFilterNode(root, group.id, (node) => ({
                ...(node as GridFilterGroup),
                logic,
              })),
            )
          }
        />
        {(capabilities.negation || group.negated) && (
          <Checkbox
            checked={Boolean(group.negated)}
            disabled={groupProtected}
            onChange={(event) =>
              onChange(
                updateFilterNode(root, group.id, (node) => ({
                  ...(node as GridFilterGroup),
                  negated: event.target.checked || undefined,
                })),
              )
            }
          >
            {locale.not}
          </Checkbox>
        )}
      </div>

      <div className="hui-grid__filter-rules">
        {group.children.map((node, index) => {
          if (node.type === 'group') {
            return (
              <div className="hui-grid__filter-rule" key={node.id}>
                <GridFilterGroupEditor
                  group={node}
                  root={root}
                  fields={fields}
                  editableFieldIds={editableFieldIds}
                  depth={depth + 1}
                  onChange={onChange}
                />
                <Button
                  type="text"
                  size="small"
                  danger
                  disabled={groupContainsProtectedCondition(node, editableFieldIds)}
                  icon={<CloseOutlined />}
                  aria-label={locale.deleteCondition}
                  onClick={() => onChange(removeFilterNode(root, node.id))}
                />
              </div>
            );
          }
          const field =
            instance.definition.fieldMap.get(node.fieldId) ||
            fields.find((item) => item.id === node.fieldId);
          if (!field) {
            return (
              <div className="hui-grid__filter-rule" key={node.id}>
                <span>{node.fieldId}</span>
                <span>{locale.operatorLabel(node.operator)}</span>
                <span>{safeGridText(node.value, '—')}</span>
                <Button
                  type="text"
                  size="small"
                  danger
                  disabled
                  icon={<CloseOutlined />}
                  aria-label={`${locale.deleteCondition}: ${node.fieldId}`}
                />
              </div>
            );
          }
          const operators = allowedOperators(field, instance.capabilities.filter.operators);
          const readOnly = !editableFieldIds.has(node.fieldId);
          return (
            <div className="hui-grid__filter-rule" key={node.id}>
              <Space.Compact className="hui-grid__filter-rule-main">
                <Select
                  size="small"
                  value={node.fieldId}
                  disabled={readOnly}
                  aria-label={`${locale.fields} ${index + 1}`}
                  options={[
                    ...(!fields.some((item) => item.id === field.id)
                      ? [
                          {
                            label: renderGridNode(field.title),
                            value: field.id,
                            disabled: true,
                          },
                        ]
                      : []),
                    ...fields.map((item) => ({
                      label: renderGridNode(item.title),
                      value: item.id,
                    })),
                  ]}
                  onChange={(fieldId) => {
                    const nextField = fields.find((item) => item.id === fieldId);
                    if (!nextField) return;
                    onChange(
                      updateFilterNode(root, node.id, (current) => ({
                        ...(current as GridFilterCondition),
                        fieldId,
                        operator: defaultOperator(
                          nextField,
                          instance.capabilities.filter.operators,
                        ),
                        value: undefined,
                      })),
                    );
                  }}
                />
                <Select
                  size="small"
                  value={node.operator}
                  disabled={readOnly}
                  aria-label={`${gridNodeText(field.title) || field.id}: ${locale.filters}`}
                  options={[
                    ...(!operators.includes(node.operator)
                      ? [
                          {
                            label: locale.operatorLabel(node.operator),
                            value: node.operator,
                            disabled: true,
                          },
                        ]
                      : []),
                    ...operators.map((operator) => ({
                      label: locale.operatorLabel(operator),
                      value: operator,
                    })),
                  ]}
                  onChange={(operator) =>
                    onChange(
                      updateFilterNode(root, node.id, (current) => ({
                        ...(current as GridFilterCondition),
                        operator,
                        value: undefined,
                      })),
                    )
                  }
                />
              </Space.Compact>
              <div className="hui-grid__filter-value">
                <GridFilterValue
                  field={field}
                  condition={node}
                  readOnly={readOnly}
                  ariaLabel={`${gridNodeText(field.title) || field.id}: ${locale.operatorLabel(
                    node.operator,
                  )}`}
                  onChange={(value) =>
                    onChange(
                      updateFilterNode(root, node.id, (current) => ({
                        ...(current as GridFilterCondition),
                        value,
                      })),
                    )
                  }
                />
              </div>
              <Space.Compact>
                <Button
                  type="text"
                  size="small"
                  disabled={readOnly || index === 0}
                  icon={<ArrowUpOutlined />}
                  aria-label={`${locale.moveUp}: ${gridNodeText(field.title) || field.id}`}
                  onClick={() => onChange(moveFilterNode(root, group.id, index, index - 1))}
                />
                <Button
                  type="text"
                  size="small"
                  disabled={readOnly || index === group.children.length - 1}
                  icon={<ArrowDownOutlined />}
                  aria-label={`${locale.moveDown}: ${gridNodeText(field.title) || field.id}`}
                  onClick={() => onChange(moveFilterNode(root, group.id, index, index + 1))}
                />
                <Button
                  type="text"
                  size="small"
                  danger
                  disabled={readOnly}
                  icon={<CloseOutlined />}
                  aria-label={`${locale.deleteCondition}: ${gridNodeText(field.title) || field.id}`}
                  onClick={() => onChange(removeFilterNode(root, node.id))}
                />
              </Space.Compact>
            </div>
          );
        })}
        {!group.children.length && (
          <div className="hui-grid__panel-empty">{locale.noConditions}</div>
        )}
      </div>

      <Space size={4}>
        <Button
          type="text"
          size="small"
          disabled={!canAdd || !fields.length}
          icon={<PlusOutlined />}
          onClick={addCondition}
        >
          {locale.addCondition}
        </Button>
        {capabilities.logic === 'nested' && depth + 1 < capabilities.maxDepth && (
          <Button
            type="text"
            size="small"
            disabled={!canAdd || !fields.length}
            icon={<PlusOutlined />}
            onClick={() => onChange(addFilterNode(root, group.id, createFilterGroup()))}
          >
            {locale.addGroup}
          </Button>
        )}
      </Space>
    </div>
  );
}

export interface GridFilterBuilderProps<Row extends object> {
  value: GridFilterGroup;
  onChange: (value: GridFilterGroup) => void;
  fields?: GridResolvedField<Row>[];
}

export function GridFilterBuilder<Row extends object>({
  value,
  onChange,
  fields: supplied,
}: GridFilterBuilderProps<Row>) {
  const instance = useGridInstance<Row>();
  const fields = useMemo(
    () =>
      (supplied || instance.definition.fields).filter(
        (field) =>
          field.filter &&
          allowedOperators(field, instance.capabilities.filter.operators).length > 0,
      ),
    [instance, instance.capabilities.filter.operators, instance.definition.fields, supplied],
  );
  const editableFieldIds = useMemo(() => new Set(fields.map((field) => field.id)), [fields]);
  return (
    <GridFilterGroupEditor
      group={value}
      root={value}
      fields={fields}
      editableFieldIds={editableFieldIds}
      depth={0}
      onChange={onChange}
    />
  );
}

export interface GridFilterPanelProps<Row extends object> extends GridFilterBuilderProps<Row> {
  onApply?: (value: GridFilterGroup) => void;
  onClear?: () => void;
  onCancel?: () => void;
}

export function GridFilterPanel<Row extends object>({
  value,
  onChange,
  fields,
  onApply,
  onClear,
  onCancel,
}: GridFilterPanelProps<Row>) {
  const instance = useGridInstance<Row>();
  const ui = useGridUi<Row>();
  const locale = resolveGridLocale(ui.locale, ui.language);
  const candidate = pruneFilterGroup(value, (condition) => {
    const field = instance.definition.fieldMap.get(condition.fieldId);
    return getFilterOperatorValueKind(
      condition.operator,
      field?.filter ? field.filter.operatorValueKinds : undefined,
    );
  });
  const conflict = filterCapabilityConflict(
    candidate,
    instance.definition.fields,
    instance.capabilities.filter,
  );
  return (
    <div className="hui-grid__panel hui-grid__filter-panel">
      <GridFilterBuilder value={value} onChange={onChange} fields={fields} />
      {conflict && <Alert type="error" showIcon title={locale.filterCapabilityConflict} />}
      {(onCancel || onClear || onApply) && <Divider />}
      {(onCancel || onClear || onApply) && (
        <div className="hui-grid__panel-footer">
          {onCancel && (
            <Button size="small" onClick={onCancel}>
              {locale.cancel}
            </Button>
          )}
          {onClear && (
            <Button size="small" onClick={onClear}>
              {locale.clear}
            </Button>
          )}
          {onApply && (
            <Button
              size="small"
              type="primary"
              disabled={conflict}
              onClick={() => onApply(candidate)}
            >
              {locale.apply}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export interface GridFilterTriggerProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: ReactNode | ((context: { open: boolean; count: number }) => ReactNode);
  placement?: 'bottomLeft' | 'bottomRight' | 'topLeft' | 'topRight';
}

export function GridFilterTrigger<Row extends object>({
  open: controlled,
  defaultOpen = false,
  onOpenChange,
  trigger,
  placement = 'bottomLeft',
}: GridFilterTriggerProps = {}) {
  const instance = useGridInstance<Row>();
  const ui = useGridUi<Row>();
  const locale = resolveGridLocale(ui.locale, ui.language);
  const filters = useGridSelector<Row, GridFilterGroup>((state) => state.query.filters);
  const [open, setOpen] = useControllableOpen(controlled, defaultOpen, onOpenChange);
  const [draft, setDraft] = useState(() => cloneFilterGroup(filters));
  const draftDirtyRef = useRef(false);
  const wasOpenRef = useRef(false);
  const count = countFilterConditions(filters);
  useEffect(() => {
    const opening = open && !wasOpenRef.current;
    if (!open || opening || !draftDirtyRef.current) setDraft(cloneFilterGroup(filters));
    if (!open) draftDirtyRef.current = false;
    wasOpenRef.current = open;
  }, [filters, open]);

  const button =
    typeof trigger === 'function'
      ? trigger({ open, count })
      : (trigger ?? (
          <Button size="small" type={count ? 'default' : 'text'} icon={<FilterOutlined />}>
            {locale.filters}
            {count ? ` ${count}` : ''}
          </Button>
        ));
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger="click"
      placement={placement}
      destroyOnHidden
      content={
        <GridFilterPanel
          value={draft}
          onChange={(value) => {
            draftDirtyRef.current = true;
            setDraft(value);
          }}
          onCancel={() => {
            draftDirtyRef.current = false;
            setOpen(false);
          }}
          onClear={() => {
            draftDirtyRef.current = false;
            const empty = createFilterGroup();
            setDraft(empty);
            instance.query.setFilters(empty, 'user');
            setOpen(false);
          }}
          onApply={(value) => {
            draftDirtyRef.current = false;
            instance.query.setFilters(value, 'user');
            setOpen(false);
          }}
        />
      }
    >
      <span>{button}</span>
    </Popover>
  );
}
