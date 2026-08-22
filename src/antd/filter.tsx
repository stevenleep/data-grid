import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  CloseOutlined,
  FilterOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import {
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
import dayjs, { type Dayjs } from 'dayjs';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  addFilterNode,
  cloneFilterGroup,
  countFilterConditions,
  createFilterCondition,
  createFilterGroup,
  getFilterOperatorValueKind,
  moveFilterNode,
  normalizeFilterValue,
  pruneFilterGroup,
  removeFilterNode,
  updateFilterNode,
  type GridFilterCondition,
  type GridFilterGroup,
  type GridJsonValue,
  type GridResolvedField,
} from '../core';
import { useGridInstance, useGridSelector } from '../react';
import { useGridUi } from './context';
import { useControllableOpen, useGridOptions } from './hooks';
import { resolveGridLocale } from './locale';
import { operatorLabel } from './operators';
import { renderGridNode } from './render';

function defaultOperator<Row extends object>(field: GridResolvedField<Row>) {
  return field.filter
    ? field.filter.defaultOperator || field.filter.operators?.[0] || 'equals'
    : 'equals';
}

function GridFilterValue<Row extends object>({
  field,
  condition,
  onChange,
}: {
  field: GridResolvedField<Row>;
  condition: GridFilterCondition;
  onChange: (value: GridJsonValue | undefined) => void;
}) {
  const instance = useGridInstance<Row>();
  const ui = useGridUi<Row>();
  const locale = resolveGridLocale(ui.locale, ui.language);
  const [search, setSearch] = useState('');
  const options = useGridOptions(field, search);
  const valueKind = getFilterOperatorValueKind(
    condition.operator,
    field.filter ? field.filter.operatorValueKinds : undefined,
  );
  const range = valueKind === 'range';
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

  const optionLike = Boolean(
    field.options ||
    ['select', 'multiSelect', 'status', 'user', 'relation', 'boolean'].includes(field.valueType),
  );
  const resolvedOptions =
    field.valueType === 'boolean'
      ? [
          { label: ui.language?.startsWith('en') ? 'Yes' : '是', value: true },
          { label: ui.language?.startsWith('en') ? 'No' : '否', value: false },
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
        ? [values[0] ? dayjs(String(values[0])) : null, values[1] ? dayjs(String(values[1])) : null]
        : null;
      return (
        <DatePicker.RangePicker
          size="small"
          showTime={field.valueType === 'dateTime'}
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
    const current = condition.value ? dayjs(String(condition.value)) : null;
    return (
      <DatePicker
        size="small"
        showTime={field.valueType === 'dateTime'}
        value={current?.isValid() ? current : null}
        onChange={(date) =>
          onChange(date ? (dateFormat ? date.format(dateFormat) : date.toISOString()) : undefined)
        }
      />
    );
  }

  if (['number', 'decimal', 'money', 'percent', 'duration'].includes(field.valueType)) {
    const stringMode = field.valueType === 'decimal' || field.valueType === 'money';
    if (range) {
      const values = Array.isArray(condition.value) ? condition.value : [];
      return (
        <Space.Compact>
          <InputNumber
            size="small"
            stringMode={stringMode}
            placeholder="Min"
            value={values[0] as number | string | null | undefined}
            onChange={(value) => onChange([normalizeFilterValue(value) ?? null, values[1] ?? null])}
          />
          <InputNumber
            size="small"
            stringMode={stringMode}
            placeholder="Max"
            value={values[1] as number | string | null | undefined}
            onChange={(value) => onChange([values[0] ?? null, normalizeFilterValue(value) ?? null])}
          />
        </Space.Compact>
      );
    }
    return (
      <InputNumber
        size="small"
        stringMode={stringMode}
        value={condition.value as number | string | null | undefined}
        onChange={(value) => onChange(normalizeFilterValue(value))}
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
          value={values[0] == null ? '' : String(values[0])}
          onChange={(event) => onChange([event.target.value || null, values[1] ?? null])}
        />
        <Input
          size="small"
          allowClear
          value={values[1] == null ? '' : String(values[1])}
          onChange={(event) => onChange([values[0] ?? null, event.target.value || null])}
        />
      </Space.Compact>
    );
  }

  return (
    <Input
      size="small"
      allowClear
      value={condition.value == null ? '' : String(condition.value)}
      placeholder={field.filter ? field.filter.placeholder : undefined}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function GridFilterGroupEditor<Row extends object>({
  group,
  root,
  fields,
  depth,
  onChange,
}: {
  group: GridFilterGroup;
  root: GridFilterGroup;
  fields: GridResolvedField<Row>[];
  depth: number;
  onChange: (filters: GridFilterGroup) => void;
}) {
  const instance = useGridInstance<Row>();
  const ui = useGridUi<Row>();
  const locale = resolveGridLocale(ui.locale, ui.language);
  const capabilities = instance.capabilities.filter;
  const canAdd = countFilterConditions(root) < capabilities.maxConditions;
  const addCondition = () => {
    const field = fields[0];
    if (!field || !canAdd) return;
    onChange(
      addFilterNode(root, group.id, createFilterCondition(field.id, defaultOperator(field))),
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
          disabled={capabilities.logic === 'and'}
          options={[
            { label: locale.allConditions, value: 'and' },
            { label: locale.anyCondition, value: 'or' },
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
        {capabilities.negation && (
          <Checkbox
            checked={Boolean(group.negated)}
            onChange={(event) =>
              onChange(
                updateFilterNode(root, group.id, (node) => ({
                  ...(node as GridFilterGroup),
                  negated: event.target.checked || undefined,
                })),
              )
            }
          >
            NOT
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
                  depth={depth + 1}
                  onChange={onChange}
                />
                <Button
                  type="text"
                  size="small"
                  danger
                  icon={<CloseOutlined />}
                  aria-label={locale.deleteCondition}
                  onClick={() => onChange(removeFilterNode(root, node.id))}
                />
              </div>
            );
          }
          const field = fields.find((item) => item.id === node.fieldId) || fields[0];
          if (!field) return null;
          const operators = field.filter ? field.filter.operators || ['equals'] : ['equals'];
          return (
            <div className="hui-grid__filter-rule" key={node.id}>
              <Space.Compact className="hui-grid__filter-rule-main">
                <Select
                  size="small"
                  value={node.fieldId}
                  options={fields.map((item) => ({
                    label: renderGridNode(item.title),
                    value: item.id,
                  }))}
                  onChange={(fieldId) => {
                    const nextField = fields.find((item) => item.id === fieldId);
                    if (!nextField) return;
                    onChange(
                      updateFilterNode(root, node.id, (current) => ({
                        ...(current as GridFilterCondition),
                        fieldId,
                        operator: defaultOperator(nextField),
                        value: undefined,
                      })),
                    );
                  }}
                />
                <Select
                  size="small"
                  value={node.operator}
                  options={operators.map((operator) => ({
                    label: operatorLabel(operator, ui.language),
                    value: operator,
                  }))}
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
                  disabled={index === 0}
                  icon={<ArrowUpOutlined />}
                  aria-label={locale.moveUp}
                  onClick={() => onChange(moveFilterNode(root, group.id, index, index - 1))}
                />
                <Button
                  type="text"
                  size="small"
                  disabled={index === group.children.length - 1}
                  icon={<ArrowDownOutlined />}
                  aria-label={locale.moveDown}
                  onClick={() => onChange(moveFilterNode(root, group.id, index, index + 1))}
                />
                <Button
                  type="text"
                  size="small"
                  danger
                  icon={<CloseOutlined />}
                  aria-label={locale.deleteCondition}
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
          disabled={!canAdd}
          icon={<PlusOutlined />}
          onClick={addCondition}
        >
          {locale.addCondition}
        </Button>
        {capabilities.logic === 'nested' && depth + 1 < capabilities.maxDepth && (
          <Button
            type="text"
            size="small"
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
    () => supplied || instance.definition.fields.filter((field) => field.filter),
    [instance, supplied],
  );
  return (
    <GridFilterGroupEditor
      group={value}
      root={value}
      fields={fields}
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
  const resolveValueKind = (condition: GridFilterCondition) => {
    const field =
      fields?.find((item) => item.id === condition.fieldId) ||
      instance.definition.fieldMap.get(condition.fieldId);
    return getFilterOperatorValueKind(
      condition.operator,
      field?.filter ? field.filter.operatorValueKinds : undefined,
    );
  };
  return (
    <div className="hui-grid__panel hui-grid__filter-panel">
      <GridFilterBuilder value={value} onChange={onChange} fields={fields} />
      <Divider />
      <div className="hui-grid__panel-footer">
        {onCancel && (
          <Button size="small" onClick={onCancel}>
            {locale.cancel}
          </Button>
        )}
        <Button size="small" onClick={onClear}>
          {locale.clear}
        </Button>
        <Button
          size="small"
          type="primary"
          onClick={() => onApply?.(pruneFilterGroup(value, resolveValueKind))}
        >
          {locale.apply}
        </Button>
      </div>
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
  const count = countFilterConditions(filters);
  useEffect(() => {
    if (open) setDraft(cloneFilterGroup(filters));
  }, [filters, open]);

  const button =
    typeof trigger === 'function'
      ? trigger({ open, count })
      : trigger || (
          <Button size="small" type={count ? 'default' : 'text'} icon={<FilterOutlined />}>
            {locale.filters}
            {count ? ` ${count}` : ''}
          </Button>
        );
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
          onChange={setDraft}
          onCancel={() => setOpen(false)}
          onClear={() => {
            const empty = createFilterGroup();
            setDraft(empty);
            instance.query.setFilters(empty, 'user');
            setOpen(false);
          }}
          onApply={(value) => {
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
