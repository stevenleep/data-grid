import { Profiler, useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DataGrid,
  GridActionButton,
  GridActions,
  GridActiveFilters,
  GridColumnPanel,
  GridFilterPanel,
  GridFilterTrigger,
  GridSearch,
  GridSelectionSummary,
  GridSortPanel,
  GridSortTrigger,
  GridTable,
  GridViewPanel,
  createFilterCondition,
  createFilterGroup,
  createLocalSource,
  createRemoteSource,
  type GridAction,
  type GridDefinition,
  type GridFilterGroup,
  type GridResolvedColumn,
  type GridSelectionState,
  type GridSort,
  useGridInstance,
  useGridSelector,
} from '../src';

interface Row {
  id: number;
  name: string;
  status?: string;
  amount?: { amount: string | null; currency: string };
  percent?: number;
  owner?: unknown;
  timestamp?: string;
  editable?: boolean;
}

const ada: Row = { id: 1, name: 'Ada' };

function definition(id: string, fields: GridDefinition<Row>['fields']): GridDefinition<Row> {
  return { id, rowKey: 'id', fields };
}

function FilterPanelWithSubset({
  value,
  onApply,
  onChange = () => undefined,
}: {
  value: GridFilterGroup;
  onApply: (value: GridFilterGroup) => void;
  onChange?: (value: GridFilterGroup) => void;
}) {
  const instance = useGridInstance<Row>();
  return (
    <div data-testid="filter-panel">
      <GridFilterPanel<Row>
        value={value}
        onChange={onChange}
        fields={[instance.definition.fieldMap.get('name')!]}
        onApply={onApply}
      />
    </div>
  );
}

function SortPanelWithSubset({
  value,
  onApply,
  onChange = () => undefined,
}: {
  value: GridSort[];
  onApply: (value: GridSort[]) => void;
  onChange?: (value: GridSort[]) => void;
}) {
  const instance = useGridInstance<Row>();
  return (
    <div data-testid="sort-panel">
      <GridSortPanel<Row>
        value={value}
        onChange={onChange}
        fields={[instance.definition.fieldMap.get('name')!]}
        onApply={onApply}
      />
    </div>
  );
}

function TransientTable({ requiredFields }: { requiredFields?: readonly string[] } = {}) {
  const instance = useGridInstance<Row>();
  const source = instance.definition.columns[0]!;
  const columns: GridResolvedColumn<Row>[] = [{ ...source, id: 'transient-name' }];
  return <GridTable<Row> columns={columns} requiredFields={requiredFields} rowActions={false} />;
}

function SortState() {
  const sorts = useGridSelector<Row, GridSort[]>((state) => state.query.sorts);
  return <output aria-label="sort state">{sorts.map((sort) => sort.fieldId).join(',')}</output>;
}

function EditingState() {
  const active = useGridSelector<Row, boolean>((state) => Boolean(state.editing.active));
  return <output aria-label="editing state">{active ? 'active' : 'idle'}</output>;
}

function ChangeRowPermission() {
  const instance = useGridInstance<Row>();
  return (
    <button type="button" onClick={() => instance.data.patchRow(1, { editable: false })}>
      Revoke edit
    </button>
  );
}

function LowercaseName() {
  const instance = useGridInstance<Row>();
  return (
    <button type="button" onClick={() => instance.data.patchRow(1, { name: 'ada' })}>
      Lowercase name
    </button>
  );
}

function QueryRootState() {
  const filters = useGridSelector<Row, GridFilterGroup>((state) => state.query.filters);
  return (
    <output aria-label="filter root">
      {filters.logic}:{String(Boolean(filters.negated))}:{filters.children.length}
    </output>
  );
}

function QueryFilterIds() {
  const filters = useGridSelector<Row, GridFilterGroup>((state) => state.query.filters);
  const ids = filters.children.flatMap((node) => (node.type === 'condition' ? [node.fieldId] : []));
  return <output aria-label="filter fields">{ids.join(',')}</output>;
}

function SelectionKeyTypes() {
  const selection = useGridSelector<Row, GridSelectionState>((state) => state.selection);
  return (
    <output aria-label="selection key types">
      {selection.mode === 'explicit'
        ? selection.selectedKeys.map((key) => typeof key).join(',')
        : 'allMatching'}
    </output>
  );
}

function ActiveFiltersWithNameSubset() {
  const instance = useGridInstance<Row>();
  return <GridActiveFilters<Row> fields={[instance.definition.fieldMap.get('name')!]} />;
}

function ExternalKeywordButton() {
  const instance = useGridInstance<Row>();
  return (
    <button type="button" onClick={() => instance.query.setKeyword('hydrated', 'restore')}>
      Hydrate keyword
    </button>
  );
}

function ExternalSortButton() {
  const instance = useGridInstance<Row>();
  return (
    <button
      type="button"
      onClick={() =>
        instance.query.setSorts(
          [{ id: 'external-sort', fieldId: 'status', direction: 'desc' }],
          'restore',
        )
      }
    >
      Hydrate sorts
    </button>
  );
}

function ExternalFilterButton() {
  const instance = useGridInstance<Row>();
  return (
    <button
      type="button"
      onClick={() =>
        instance.query.setFilters(
          createFilterGroup('and', [createFilterCondition('status', 'equals', 'external')]),
          'restore',
        )
      }
    >
      Hydrate filters
    </button>
  );
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('AntD composition regressions', () => {
  it('blocks structurally unsupported filters without silently dropping conditions', () => {
    const onApply = vi.fn();
    const value = createFilterGroup('or', [
      createFilterCondition('name', 'equals', 'Ada'),
      createFilterCondition('status', 'equals', 'active'),
    ]);
    value.negated = true;
    render(
      <DataGrid<Row>
        definition={definition('filter-capability-ui', [
          { id: 'name', title: 'Name', filter: true },
          { id: 'status', title: 'Status', filter: true },
        ])}
        source={createRemoteSource<Row>(async () => ({ rows: [] }), {
          capabilities: {
            filter: { logic: 'and', negation: false, maxDepth: 1, maxConditions: 1 },
          },
        })}
        toolbar={false}
        footer={false}
      >
        <GridFilterPanel<Row> value={value} onChange={() => undefined} onApply={onApply} />
      </DataGrid>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('当前筛选条件与数据源能力不兼容');
    const apply = screen.getByRole('button', { name: /应\s*用/ });
    expect(apply).toBeDisabled();
    fireEvent.click(apply);
    expect(onApply).not.toHaveBeenCalled();
    expect(value.logic).toBe('or');
    expect(value.negated).toBe(true);
    expect(value.children).toHaveLength(2);
  });

  it('preserves filters and sorts outside a supplied field subset', () => {
    const onFilterApply = vi.fn();
    const onSortApply = vi.fn();
    const onFilterChange = vi.fn();
    const onSortChange = vi.fn();
    const filters = createFilterGroup('and', [
      createFilterCondition('name', 'equals', 'Ada'),
      createFilterCondition('status', 'equals', 'active'),
    ]);
    const sorts: GridSort[] = [
      { id: 'name-sort', fieldId: 'name', direction: 'asc' },
      { id: 'status-sort', fieldId: 'status', direction: 'desc' },
    ];
    render(
      <DataGrid<Row>
        definition={definition('subset-preservation-ui', [
          { id: 'name', title: 'Name', filter: true, sort: true },
          { id: 'status', title: 'Status', filter: true, sort: true },
        ])}
        source={createLocalSource([ada])}
        toolbar={false}
        footer={false}
      >
        <>
          <FilterPanelWithSubset
            value={filters}
            onApply={onFilterApply}
            onChange={onFilterChange}
          />
          <SortPanelWithSubset value={sorts} onApply={onSortApply} onChange={onSortChange} />
        </>
      </DataGrid>,
    );

    const filterPanel = within(screen.getByTestId('filter-panel'));
    const sortPanel = within(screen.getByTestId('sort-panel'));
    const protectedFilterDelete = filterPanel.getByRole('button', {
      name: '删除条件: Status',
    });
    const protectedSortDelete = sortPanel.getByRole('button', { name: '删除: Status' });
    expect(protectedFilterDelete).toBeDisabled();
    expect(protectedSortDelete).toBeDisabled();
    expect(sortPanel.getByRole('button', { name: '下移: Name' })).toBeDisabled();
    fireEvent.click(protectedFilterDelete);
    fireEvent.click(protectedSortDelete);
    expect(onFilterChange).not.toHaveBeenCalled();
    expect(onSortChange).not.toHaveBeenCalled();

    fireEvent.click(filterPanel.getByRole('button', { name: /应\s*用/ }));
    fireEvent.click(sortPanel.getByRole('button', { name: /应\s*用/ }));
    expect((onFilterApply.mock.calls[0]?.[0] as GridFilterGroup).children).toHaveLength(2);
    expect(onSortApply).toHaveBeenCalledWith(sorts);
  });

  it('prunes only an incomplete draft rule when filters are applied', () => {
    const onApply = vi.fn();
    const filters = createFilterGroup('and', [
      createFilterCondition('name', 'equals'),
      createFilterCondition('status', 'equals', 'active'),
    ]);
    render(
      <DataGrid<Row>
        definition={definition('blank-filter-draft', [
          { id: 'name', title: 'Name', filter: true },
          { id: 'status', title: 'Status', filter: true },
        ])}
        source={createLocalSource([ada])}
        toolbar={false}
        footer={false}
      >
        <GridFilterPanel<Row> value={filters} onChange={() => undefined} onApply={onApply} />
      </DataGrid>,
    );

    fireEvent.click(screen.getByRole('button', { name: /应\s*用/ }));
    const applied = onApply.mock.calls[0]?.[0] as GridFilterGroup;
    expect(applied.children).toHaveLength(1);
    expect((applied.children[0] as { fieldId: string }).fieldId).toBe('status');
  });

  it('blocks sort lists above the source maximum without truncating them', () => {
    const onApply = vi.fn();
    const sorts: GridSort[] = [
      { id: 'name-sort', fieldId: 'name', direction: 'asc' },
      { id: 'status-sort', fieldId: 'status', direction: 'desc' },
    ];
    render(
      <DataGrid<Row>
        definition={definition('sort-limit-conflict', [
          { id: 'name', title: 'Name', sort: true },
          { id: 'status', title: 'Status', sort: true },
        ])}
        source={createRemoteSource<Row>(async () => ({ rows: [] }), {
          capabilities: { sort: { max: 1 } },
        })}
        toolbar={false}
        footer={false}
      >
        <GridSortPanel<Row> value={sorts} onChange={() => undefined} onApply={onApply} />
      </DataGrid>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('当前排序规则与数据源能力不兼容');
    const apply = screen.getByRole('button', { name: /应\s*用/ });
    expect(apply).toBeDisabled();
    fireEvent.click(apply);
    expect(onApply).not.toHaveBeenCalled();
    expect(sorts).toHaveLength(2);
  });

  it('keeps money object editing high precision after clearing', async () => {
    const save = vi.fn(async ({ row: current, value }) => ({ ...current, amount: value }));
    render(
      <DataGrid<Row>
        definition={{
          ...definition('money-clear-high-precision', [
            { id: 'amount', title: 'Amount', valueType: 'money', edit: true },
          ]),
          editing: { save },
        }}
        source={createLocalSource([
          { ...ada, amount: { amount: '9007199254740993', currency: 'USD' } },
        ])}
        toolbar={false}
        footer={false}
      />,
    );

    fireEvent.doubleClick(await screen.findByRole('button', { name: '编辑 Amount' }));
    const input = screen.getByRole('spinbutton');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.change(input, { target: { value: '9007199254740995' } });
    fireEvent.blur(input);
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0]?.[0].value).toEqual({
      amount: '9007199254740995',
      currency: 'USD',
    });
  });

  it('keeps the first high-precision money value lossless when the amount starts empty', async () => {
    const save = vi.fn(async ({ row: current, value }) => ({ ...current, amount: value }));
    render(
      <DataGrid<Row>
        definition={{
          ...definition('empty-money-high-precision', [
            { id: 'amount', title: 'Amount', valueType: 'money', edit: true },
          ]),
          editing: { save },
        }}
        source={createLocalSource([{ ...ada, amount: { amount: null, currency: 'USD' } }])}
        toolbar={false}
        footer={false}
      />,
    );

    fireEvent.doubleClick(await screen.findByRole('button', { name: '编辑 Amount' }));
    const input = screen.getByRole('spinbutton');
    fireEvent.change(input, { target: { value: '9007199254740995' } });
    fireEvent.blur(input);
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0]?.[0].value).toEqual({
      amount: '9007199254740995',
      currency: 'USD',
    });
  });

  it('round-trips ratio percentages through their displayed percent value', async () => {
    const save = vi.fn(async ({ row: current, value }) => ({ ...current, percent: value }));
    render(
      <DataGrid<Row>
        definition={{
          ...definition('ratio-percent-editor', [
            {
              id: 'percent',
              title: 'Completion',
              valueType: 'percent',
              meta: { percentScale: 'ratio' },
              edit: true,
            },
          ]),
          editing: { save },
        }}
        source={createLocalSource([{ ...ada, percent: 0.15 }])}
        language="en-US"
        toolbar={false}
        footer={false}
      />,
    );

    expect(await screen.findByText('15%')).toBeInTheDocument();
    fireEvent.doubleClick(screen.getByRole('button', { name: 'Edit Completion' }));
    const input = screen.getByRole('spinbutton');
    expect(input).toHaveValue('15');
    fireEvent.change(input, { target: { value: '20' } });
    fireEvent.blur(input);
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0]?.[0].value).toBe(0.2);
  });

  it('uses displayed percent units for ratio percentage filters', () => {
    const onChange = vi.fn();
    const filters = createFilterGroup('and', [createFilterCondition('percent', 'equals', 0.15)]);
    render(
      <DataGrid<Row>
        definition={definition('ratio-percent-filter', [
          {
            id: 'percent',
            title: 'Completion',
            valueType: 'percent',
            meta: { percentScale: 'ratio' },
            filter: true,
          },
        ])}
        source={createLocalSource([{ ...ada, percent: 0.15 }])}
        language="en-US"
        toolbar={false}
        footer={false}
      >
        <GridFilterPanel<Row> value={filters} onChange={onChange} />
      </DataGrid>,
    );

    const input = screen.getByRole('spinbutton', { name: 'Completion: Equals' });
    expect(input).toHaveValue('15');
    fireEvent.change(input, { target: { value: '20' } });
    const changed = onChange.mock.calls.at(-1)?.[0] as GridFilterGroup;
    expect((changed.children[0] as { value: number }).value).toBe(0.2);
  });

  it('does not begin editing from interactive renderer descendants', async () => {
    const nestedKeyDown = vi.fn();
    render(
      <DataGrid<Row>
        definition={{
          ...definition('editable-descendant-events', [
            {
              id: 'name',
              title: 'Name',
              edit: true,
              render: () => (
                <button type="button" onKeyDown={nestedKeyDown}>
                  Business action
                </button>
              ),
            },
          ]),
          editing: { save: async () => undefined },
        }}
        source={createLocalSource([ada])}
        toolbar={false}
        footer={false}
      >
        <>
          <GridTable<Row> rowActions={false} />
          <EditingState />
        </>
      </DataGrid>,
    );

    const action = await screen.findByRole('button', { name: 'Business action' });
    fireEvent.keyDown(action, { key: 'Enter' });
    fireEvent.doubleClick(action);
    expect(nestedKeyDown).toHaveBeenCalled();
    expect(screen.getByRole('status', { name: 'editing state' })).toHaveTextContent('idle');
  });

  it('begins keyboard editing exactly once through the synthetic click path', async () => {
    const onEvent = vi.fn();
    render(
      <DataGrid<Row>
        definition={{
          ...definition('single-keyboard-edit-begin', [{ id: 'name', title: 'Name', edit: true }]),
          editing: { save: async () => undefined },
        }}
        source={createLocalSource([ada])}
        onEvent={onEvent}
        toolbar={false}
        footer={false}
      />,
    );

    const target = await screen.findByRole('button', { name: '编辑 Name' });
    fireEvent.keyDown(target, { key: 'Enter' });
    expect(onEvent.mock.calls.filter(([event]) => event.type === 'editing.begin')).toHaveLength(1);
  });

  it('uses temporal.timeZone for AntD date-time display', async () => {
    render(
      <DataGrid<Row>
        definition={definition('temporal-display-zone', [
          { id: 'timestamp', title: 'When', valueType: 'dateTime' },
        ])}
        source={createLocalSource([{ ...ada, timestamp: '2024-01-01T00:00:00.000Z' }])}
        temporal={{ timeZone: 'Asia/Shanghai' }}
        language="en-US"
        toolbar={false}
        footer={false}
      />,
    );

    expect(await screen.findByText(/8:00 AM/)).toBeInTheDocument();
  });

  it('sorts transient supplied columns through the effective column map', async () => {
    render(
      <DataGrid<Row>
        definition={definition('transient-column-sort', [
          { id: 'name', title: 'Name', sort: true },
        ])}
        source={createLocalSource([ada])}
        toolbar={false}
        footer={false}
      >
        <>
          <TransientTable />
          <SortState />
        </>
      </DataGrid>,
    );

    await screen.findByText('Ada');
    fireEvent.click(screen.getAllByText('Name')[0]!.closest('.ant-table-column-sorters')!);
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'sort state' })).toHaveTextContent('name'),
    );
  });

  it('updates a default cell when only string casing changes', async () => {
    render(
      <DataGrid<Row>
        definition={definition('case-sensitive-cell-update', [{ id: 'name', title: 'Name' }])}
        source={createLocalSource([ada])}
        toolbar={false}
        footer={false}
      >
        <>
          <GridTable<Row> rowActions={false} />
          <LowercaseName />
        </>
      </DataGrid>,
    );

    await screen.findByText('Ada');
    fireEvent.click(screen.getByRole('button', { name: 'Lowercase name' }));
    expect(await screen.findByText('ada')).toBeInTheDocument();
    expect(screen.queryByText('Ada')).not.toBeInTheDocument();
  });

  it('registers supplied-column dependencies in the active request projection', async () => {
    const read = vi.fn(async (_input: { request: { select?: string[] } }) => ({
      rows: [{ ...ada, status: 'active' }],
    }));
    render(
      <DataGrid<Row>
        definition={definition('supplied-column-projection', [
          { id: 'name', title: 'Name' },
          { id: 'status', title: 'Status', column: false },
        ])}
        source={createRemoteSource<Row>(read, {
          capabilities: { projection: true },
        })}
        toolbar={false}
        footer={false}
      >
        <TransientTable requiredFields={['status']} />
      </DataGrid>,
    );

    await waitFor(() => expect(read).toHaveBeenCalled());
    const request = read.mock.calls.at(-1)?.[0]?.request;
    expect(request?.select).toEqual(expect.arrayContaining(['name', 'status']));
  });

  it('registers projection dependencies when a runtime source enables projection', async () => {
    const plainRead = vi.fn(async () => ({ rows: [ada] }));
    const projectedRead = vi.fn(async (_input: { request: { select?: string[] } }) => ({
      rows: [ada],
    }));
    const plainSource = createRemoteSource<Row>(plainRead);
    const projectedSource = createRemoteSource<Row>(projectedRead, {
      capabilities: { projection: true },
    });
    function Harness() {
      const [projected, setProjected] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setProjected(true)}>
            Enable projection
          </button>
          <DataGrid<Row>
            definition={definition('dynamic-projection-capability', [
              { id: 'name', title: 'Name' },
              { id: 'status', title: 'Status', column: false },
            ])}
            source={projected ? projectedSource : plainSource}
            toolbar={false}
            footer={false}
          >
            <TransientTable requiredFields={['status']} />
          </DataGrid>
        </>
      );
    }
    render(<Harness />);

    await waitFor(() => expect(plainRead).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Enable projection' }));
    await waitFor(() => expect(projectedRead).toHaveBeenCalled());
    expect(projectedRead.mock.calls.at(-1)?.[0]?.request.select).toEqual(
      expect.arrayContaining(['name', 'status']),
    );
  });

  it('refreshes dynamic action context when UI projection requirements change', async () => {
    const action: GridAction<Row> = {
      id: 'projection-aware-action',
      label: 'Projection ready',
      visible: ({ request }) => Boolean(request.select?.includes('status')),
      run: () => undefined,
    };
    render(
      <DataGrid<Row>
        definition={definition('projection-aware-action-grid', [
          { id: 'name', title: 'Name' },
          { id: 'status', title: 'Status', column: false },
        ])}
        source={createRemoteSource<Row>(async () => ({ rows: [ada] }), {
          capabilities: { projection: true },
        })}
        toolbar={false}
        footer={false}
      >
        <>
          <GridActionButton<Row> action={action} />
          <TransientTable requiredFields={['status']} />
        </>
      </DataGrid>,
    );

    expect(await screen.findByRole('button', { name: 'Projection ready' })).toBeInTheDocument();
  });

  it('removes native AntD filter controls that cannot update the grid protocol', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    render(
      <DataGrid<Row>
        definition={{
          ...definition('native-filter-stripped', [{ id: 'name', title: 'Name' }]),
          columns: [
            {
              id: 'name',
              fieldId: 'name',
              platform: {
                filters: [{ text: 'Ada', value: 'Ada' }],
                onFilter: (value: unknown, current: Row) => current.name === value,
              },
            },
          ],
        }}
        source={createLocalSource([ada])}
        toolbar={false}
        footer={false}
      />,
    );

    await screen.findByText('Ada');
    expect(document.querySelector('.ant-table-filter-trigger')).not.toBeInTheDocument();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('native column filters'));
  });

  it('shares a local radio selection mode with a composed selection summary', async () => {
    render(
      <DataGrid<Row>
        definition={definition('composed-radio-mode', [{ id: 'name', title: 'Name' }])}
        source={createRemoteSource(
          async () => ({ rows: [ada, { id: 2, name: 'Grace' }], total: { value: 2 } }),
          { capabilities: { selectAllMatching: true } },
        )}
        selection={false}
        toolbar={false}
        footer={false}
      >
        <>
          <GridTable<Row> selection={{ type: 'radio' }} rowActions={false} />
          <GridSelectionSummary<Row> />
        </>
      </DataGrid>,
    );

    await screen.findByText('Grace');
    fireEvent.click(screen.getByRole('radio', { name: 'Select row 1' }));
    expect(screen.queryByRole('button', { name: '选择全部 2 项' })).not.toBeInTheDocument();
  });

  it('applies canonical row keys to all-matching selection exclusions', async () => {
    function ExcludeNumericOneWithStringKey() {
      const instance = useGridInstance<Row>();
      return (
        <button
          type="button"
          onClick={() => {
            instance.selection.selectAllMatching();
            instance.selection.toggle('1', ada, false);
          }}
        >
          Exclude one
        </button>
      );
    }
    render(
      <DataGrid<Row>
        definition={definition('canonical-selection-exclusion', [{ id: 'name', title: 'Name' }])}
        source={createLocalSource([ada, { id: 2, name: 'Grace' }])}
        selection
        toolbar={false}
        footer={false}
      >
        <>
          <GridTable<Row> rowActions={false} />
          <ExcludeNumericOneWithStringKey />
        </>
      </DataGrid>,
    );

    await screen.findByText('Grace');
    fireEvent.click(screen.getByRole('button', { name: 'Exclude one' }));
    expect(screen.getByRole('checkbox', { name: 'Select row 1' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /row 2/i })).toBeChecked();
  });

  it('resets a root render failure through the built-in retry control and reports it', async () => {
    const onError = vi.fn();
    const onRenderError = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let fail = true;
    function Thrower() {
      if (fail) throw new Error('temporary render failure');
      return <span>Recovered renderer</span>;
    }
    function Harness() {
      return (
        <>
          <button type="button" onClick={() => (fail = false)}>
            Repair renderer
          </button>
          <DataGrid<Row>
            definition={definition('retry-render-boundary', [{ id: 'name', title: 'Name' }])}
            source={createLocalSource([ada])}
            onError={onError}
            onRenderError={onRenderError}
            toolbar={false}
            footer={false}
          >
            <Thrower />
          </DataGrid>
        </>
      );
    }
    render(<Harness />);

    expect(await screen.findByRole('alert')).toHaveTextContent('内容渲染失败');
    fireEvent.click(screen.getByRole('button', { name: 'Repair renderer' }));
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByText('Recovered renderer')).toBeInTheDocument();
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'temporary render failure' }),
      expect.objectContaining({ type: 'render.error' }),
    );
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onRenderError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'temporary render failure' }),
      expect.objectContaining({ componentStack: expect.any(String) }),
    );
    expect(onRenderError).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });

  it('enforces controlled search and keeps observer-only column panels uncontrolled', async () => {
    vi.useFakeTimers();
    const onSearch = vi.fn();
    const onColumnsChange = vi.fn();
    render(
      <DataGrid<Row>
        definition={definition('controlled-composition', [{ id: 'name', title: 'Name' }])}
        source={createLocalSource([ada])}
        toolbar={false}
        footer={false}
      >
        <>
          <GridSearch<Row> value="" onChange={onSearch} debounce={10} />
          <GridColumnPanel<Row> onChange={onColumnsChange} />
        </>
      </DataGrid>,
    );

    const search = screen.getByPlaceholderText('搜索数据');
    fireEvent.change(search, { target: { value: 'Ada' } });
    act(() => vi.advanceTimersByTime(20));
    expect(onSearch).toHaveBeenCalledWith('Ada');
    expect(search).toHaveValue('');

    const checkbox = screen.getByRole('checkbox', { name: '隐藏字段: Name' });
    fireEvent.click(checkbox);
    expect(checkbox).not.toBeChecked();
    expect(onColumnsChange).toHaveBeenCalledWith(expect.objectContaining({ hidden: ['name'] }));
  });

  it('does not mutate an unsupported grid search merely because an observer is supplied', () => {
    render(
      <DataGrid<Row>
        definition={definition('unsupported-search-observer', [{ id: 'name', title: 'Name' }])}
        source={createRemoteSource<Row>(async () => ({ rows: [ada] }), {
          capabilities: { search: false },
        })}
        toolbar={false}
        footer={false}
      >
        <GridSearch<Row> onChange={() => undefined} />
      </DataGrid>,
    );

    expect(screen.getByPlaceholderText('搜索数据')).toBeDisabled();
  });

  it('cancels an active edit when dynamic permission is revoked', async () => {
    render(
      <DataGrid<Row>
        definition={{
          ...definition('dynamic-edit-permission', [{ id: 'name', title: 'Name', edit: true }]),
          editing: {
            canEdit: (current) => current.editable !== false,
            save: async () => undefined,
          },
        }}
        source={createLocalSource([{ ...ada, editable: true }])}
        toolbar={false}
        footer={false}
      >
        <>
          <GridTable<Row> rowActions={false} />
          <ChangeRowPermission />
          <EditingState />
        </>
      </DataGrid>,
    );

    fireEvent.doubleClick(await screen.findByRole('button', { name: '编辑 Name' }));
    expect(screen.getByRole('status', { name: 'editing state' })).toHaveTextContent('active');
    fireEvent.click(screen.getByRole('button', { name: 'Revoke edit' }));
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'editing state' })).toHaveTextContent('idle'),
    );
  });

  it('uses the formal relation multiple edit protocol for an empty value', async () => {
    render(
      <DataGrid<Row>
        definition={{
          ...definition('empty-multi-relation', [
            {
              id: 'owner',
              title: 'Owners',
              valueType: 'relation',
              edit: { multiple: true },
              options: [{ label: 'Ada', value: 'ada' }],
            },
          ]),
          editing: { save: async () => undefined },
        }}
        source={createLocalSource([{ ...ada, owner: null }])}
        toolbar={false}
        footer={false}
      />,
    );

    fireEvent.doubleClick(await screen.findByRole('button', { name: '编辑 Owners' }));
    expect(screen.getByRole('combobox').closest('.ant-select')).toHaveClass('ant-select-multiple');
  });

  it('shows overflow action failures instead of swallowing them', async () => {
    const action: GridAction<Row> = {
      id: 'failing-action',
      label: 'Failing action',
      run: async () => {
        throw new Error('Action exploded');
      },
    };
    render(
      <DataGrid<Row>
        definition={definition('overflow-action-error', [{ id: 'name', title: 'Name' }])}
        source={createLocalSource([ada])}
        toolbar={false}
        footer={false}
      >
        <GridActions<Row> placement="toolbar" actions={[action]} maxVisible={0} />
      </DataGrid>,
    );

    fireEvent.click(screen.getByRole('button', { name: '更多' }));
    fireEvent.click(await screen.findByText('Failing action'));
    expect(await screen.findByText('Action exploded')).toBeInTheDocument();
  });

  it('honors falsy literal and computed action confirmations', async () => {
    const literalRun = vi.fn();
    const computedRun = vi.fn();
    const literal: GridAction<Row> = {
      id: 'literal-confirmation',
      label: 'Literal confirmation',
      confirm: 0,
      run: literalRun,
    };
    const computed: GridAction<Row> = {
      id: 'computed-confirmation',
      label: 'Computed confirmation',
      getConfirmation: () => '',
      run: computedRun,
    };
    render(
      <DataGrid<Row>
        definition={definition('falsy-confirmations', [{ id: 'name', title: 'Name' }])}
        source={createLocalSource([ada])}
        toolbar={false}
        footer={false}
      >
        <div>
          <GridActionButton<Row> action={literal} />
          <GridActions<Row> placement="toolbar" actions={[computed]} maxVisible={0} />
        </div>
      </DataGrid>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Literal confirmation' }));
    expect(literalRun).not.toHaveBeenCalled();
    expect(await screen.findByText('0')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /OK|确\s*定/ }));
    await waitFor(() => expect(literalRun).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole('button', { name: '更多' }));
    fireEvent.click(await screen.findByText('Computed confirmation'));
    expect(computedRun).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /OK|确\s*定/ }));
    await waitFor(() => expect(computedRun).toHaveBeenCalledOnce());
  });

  it('resolves action rows with the canonical row-key signature', async () => {
    const run = vi.fn();
    const action: GridAction<Row> = {
      id: 'canonical-row-action',
      label: 'Canonical row action',
      visible: (context) => context.row?.name === 'Ada',
      run: (context) => run(context.row),
    };
    const stale = { id: '1', name: 'Stale' } as unknown as Row;
    render(
      <DataGrid<Row>
        definition={definition('canonical-action-row', [{ id: 'name', title: 'Name' }])}
        source={createLocalSource([ada])}
        toolbar={false}
        footer={false}
      >
        <GridActionButton<Row> action={action} row={stale} />
      </DataGrid>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Canonical row action' }));
    await waitFor(() => expect(run).toHaveBeenCalledWith(ada));
  });

  it('renders readonly view operations with duplicate but without a no-op save', async () => {
    function DirtyView() {
      const instance = useGridInstance<Row>();
      return (
        <>
          <button type="button" onClick={() => instance.query.setKeyword('changed', 'user')}>
            Dirty view
          </button>
          <GridViewPanel<Row> />
        </>
      );
    }
    render(
      <DataGrid<Row>
        definition={definition('readonly-view-ui', [{ id: 'name', title: 'Name' }])}
        source={createLocalSource([ada])}
        defaultState={{
          views: {
            activeId: 'system-view',
            dirty: false,
            items: [
              {
                id: 'system-view',
                name: 'System view',
                scope: 'system',
                readonly: true,
                query: { keyword: '', filters: createFilterGroup(), sorts: [] },
                columns: {
                  order: ['name'],
                  hidden: [],
                  widths: { name: 160 },
                  pinned: {},
                  density: 'default',
                },
                createdAt: '2024-01-01T00:00:00.000Z',
                updatedAt: '2024-01-01T00:00:00.000Z',
              },
            ],
          },
        }}
        toolbar={false}
        footer={false}
      >
        <DirtyView />
      </DataGrid>,
    );

    expect(screen.getByRole('button', { name: '复制: System view' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dirty view' }));
    expect(screen.queryByRole('button', { name: '保存' })).not.toBeInTheDocument();
  });

  it('subscribes onEvent before the initial load starts', async () => {
    const onEvent = vi.fn();
    render(
      <DataGrid<Row>
        definition={definition('initial-event-listener', [{ id: 'name', title: 'Name' }])}
        source={createRemoteSource(async () => ({ rows: [ada] }))}
        onEvent={onEvent}
        toolbar={false}
        footer={false}
      />,
    );

    await screen.findByText('Ada');
    expect(onEvent.mock.calls.map(([event]) => event.type)).toContain('data.load.start');
  });

  it('shows filter group semantics, option labels and resets root logic on clear', async () => {
    const filters = createFilterGroup('or', [createFilterCondition('status', 'equals', 'active')]);
    filters.negated = true;
    render(
      <DataGrid<Row>
        definition={definition('active-filter-semantics', [
          {
            id: 'status',
            title: 'Status',
            filter: true,
            options: [{ label: 'Active label', value: 'active' }],
          },
        ])}
        source={createLocalSource([{ ...ada, status: 'active' }])}
        defaultState={{ query: { filters } }}
        toolbar={false}
        footer={false}
      >
        <>
          <GridActiveFilters<Row> />
          <QueryRootState />
        </>
      </DataGrid>,
    );

    expect(screen.getByText(/\u975e \u4efb\u610f\u6761\u4ef6/)).toBeInTheDocument();
    expect(screen.getByText(/Active label/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '清除' }));
    expect(screen.getByRole('status', { name: 'filter root' })).toHaveTextContent('and:false:0');
  });

  it('uses relation identity and label metadata in active and readonly filter surfaces', () => {
    const filters = createFilterGroup('and', [
      createFilterCondition('owner', 'containsAny', [
        { customerCode: 'C7', legacyKey: 'legacy-7', displayName: 'Ada CRM' },
        { customerCode: 'C8', legacyKey: 'wrong-key' },
        { legacyKey: 'C9' },
      ]),
    ]);
    const { container } = render(
      <DataGrid<Row>
        definition={definition('relation-filter-labels', [
          { id: 'name', title: 'Name', filter: true },
          {
            id: 'owner',
            title: 'Owner',
            relation: {
              target: 'crm.customer',
              cardinality: 'many',
              keyField: 'legacyKey',
              labelField: 'displayName',
            },
            getIdentity: (value) => {
              if (!value || typeof value !== 'object') return undefined;
              const customerCode = (value as { customerCode?: unknown }).customerCode;
              return typeof customerCode === 'string' ? customerCode : undefined;
            },
            filter: true,
            options: [
              { label: 'Customer Seven', value: 'C7' },
              { label: 'Customer Eight', value: 'C8' },
              { label: 'Customer Nine', value: 'C9' },
            ],
          },
        ])}
        source={createLocalSource([{ ...ada, owner: [] }])}
        defaultState={{ query: { filters } }}
        toolbar={false}
        footer={false}
      >
        <>
          <GridActiveFilters<Row> />
          <FilterPanelWithSubset value={filters} onApply={() => undefined} />
        </>
      </DataGrid>,
    );

    expect(container.querySelector('.hui-grid__active-filters .ant-tag')).toHaveTextContent(
      'Ada CRM, Customer Eight, Customer Nine',
    );
    expect(container.querySelector('.hui-grid__filter-readonly-value')).toHaveTextContent(
      'Ada CRM, Customer Eight, Customer Nine',
    );
  });

  it('keeps out-of-subset active filters readonly when removing or clearing chips', () => {
    const filters = createFilterGroup('and', [
      createFilterCondition('name', 'equals', 'Ada'),
      createFilterCondition('status', 'equals', 'protected'),
    ]);
    render(
      <DataGrid<Row>
        definition={definition('active-filter-subset', [
          { id: 'name', title: 'Name', filter: true },
          { id: 'status', title: 'Status', filter: true },
        ])}
        source={createLocalSource([{ ...ada, status: 'protected' }])}
        defaultState={{ query: { filters } }}
        toolbar={false}
        footer={false}
      >
        <>
          <ActiveFiltersWithNameSubset />
          <QueryFilterIds />
        </>
      </DataGrid>,
    );

    const nameTag = screen.getByText(/Name/).closest('.ant-tag');
    const protectedTag = screen.getByText(/Status/).closest('.ant-tag');
    expect(nameTag?.querySelector('.ant-tag-close-icon')).not.toBeNull();
    expect(protectedTag?.querySelector('.ant-tag-close-icon')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '清除' }));
    expect(screen.getByRole('status', { name: 'filter fields' })).toHaveTextContent('status');
  });

  it('does not show a stale all-matching selection outside its Core request scope', async () => {
    render(
      <DataGrid<Row>
        definition={definition('stale-all-matching-ui', [{ id: 'name', title: 'Name' }])}
        source={createLocalSource([ada], undefined, 'current-dataset')}
        state={{
          selection: {
            mode: 'allMatching',
            querySignature: 'stale-request-scope',
            total: 9,
            excludedKeys: [],
          },
        }}
        stateDatasetKey="current-dataset"
        selection
        toolbar={false}
        footer={false}
      >
        <>
          <GridSelectionSummary<Row> />
          <GridTable<Row> rowActions={false} />
        </>
      </DataGrid>,
    );

    expect(screen.queryByText(/已选择 9/)).not.toBeInTheDocument();
    await screen.findByText('Ada');
    expect(screen.getByRole('checkbox', { name: 'Select row 1' })).not.toBeChecked();
  });

  it('uses canonical string table keys while preserving the definition key type in Core', async () => {
    const onChange = vi.fn();
    render(
      <DataGrid<Row>
        definition={definition('canonical-antd-row-key', [{ id: 'name', title: 'Name' }])}
        source={createLocalSource([ada])}
        toolbar={false}
        footer={false}
      >
        <>
          <GridTable<Row> selection={{ onChange }} rowActions={false} />
          <SelectionKeyTypes />
        </>
      </DataGrid>,
    );

    await screen.findByText('Ada');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select row 1' }));
    expect(onChange.mock.calls.at(-1)?.[0]).toEqual(['1']);
    expect(screen.getByRole('status', { name: 'selection key types' })).toHaveTextContent('number');
  });

  it('keeps a pending search draft when an external query update arrives', () => {
    render(
      <DataGrid<Row>
        definition={definition('search-draft-hydrate', [{ id: 'name', title: 'Name' }])}
        source={createLocalSource([ada])}
        toolbar={false}
        footer={false}
      >
        <>
          <GridSearch<Row> debounce={10_000} />
          <ExternalKeywordButton />
        </>
      </DataGrid>,
    );

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'local draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Hydrate keyword' }));
    expect(input).toHaveValue('local draft');
  });

  it('keeps an edited sort session when external sorts hydrate', () => {
    render(
      <DataGrid<Row>
        definition={definition('sort-draft-hydrate', [
          { id: 'name', title: 'Name', sort: true },
          { id: 'status', title: 'Status', sort: true },
        ])}
        source={createLocalSource([ada])}
        toolbar={false}
        footer={false}
      >
        <>
          <GridSortTrigger<Row> open />
          <ExternalSortButton />
        </>
      </DataGrid>,
    );

    fireEvent.click(screen.getByRole('button', { name: /添加排序/ }));
    const field = screen.getByRole('combobox', { name: '字段 1' });
    expect(field.closest('.ant-select')).toHaveTextContent('Name');
    fireEvent.click(screen.getByRole('button', { name: 'Hydrate sorts' }));
    expect(field.closest('.ant-select')).toHaveTextContent('Name');
  });

  it('keeps an edited filter session when external filters hydrate', () => {
    render(
      <DataGrid<Row>
        definition={definition('filter-draft-hydrate', [
          { id: 'name', title: 'Name', filter: true },
          { id: 'status', title: 'Status', filter: true },
        ])}
        source={createLocalSource([ada])}
        toolbar={false}
        footer={false}
      >
        <>
          <GridFilterTrigger<Row> open />
          <ExternalFilterButton />
        </>
      </DataGrid>,
    );

    fireEvent.click(screen.getByRole('button', { name: /添加条件$/ }));
    const field = screen.getByRole('combobox', { name: '字段 1' });
    expect(field.closest('.ant-select')).toHaveTextContent('Name');
    fireEvent.click(screen.getByRole('button', { name: 'Hydrate filters' }));
    expect(field.closest('.ant-select')).toHaveTextContent('Name');
  });

  it('limits default row and editable tab stops to the first row', async () => {
    render(
      <DataGrid<Row>
        definition={{
          ...definition('table-roving-focus', [{ id: 'name', title: 'Name', edit: true }]),
          editing: { save: async () => undefined },
        }}
        source={createLocalSource([ada, { id: 2, name: 'Grace' }])}
        onRowClick={() => undefined}
        toolbar={false}
        footer={false}
      />,
    );

    await screen.findByText('Grace');
    const editTargets = screen.getAllByRole('button', { name: '编辑 Name' });
    expect(editTargets[0]).toHaveAttribute('tabindex', '0');
    expect(editTargets[1]).toHaveAttribute('tabindex', '-1');
    const rows = document.querySelectorAll('.hui-grid__row--clickable');
    expect(rows[0]).toHaveAttribute('tabindex', '0');
    expect(rows[1]).toHaveAttribute('tabindex', '-1');
  });

  it('does not rerender static action buttons for selection-only state changes', async () => {
    const onRender = vi.fn();
    const action: GridAction<Row> = { id: 'static', label: 'Static', run: () => undefined };
    function Harness() {
      const instance = useGridInstance<Row>();
      return (
        <>
          <button type="button" onClick={() => instance.selection.set([1], [ada])}>
            Select
          </button>
          <Profiler id="static-action" onRender={onRender}>
            <GridActionButton<Row> action={action} />
          </Profiler>
        </>
      );
    }
    render(
      <DataGrid<Row>
        definition={definition('static-action-subscription', [{ id: 'name', title: 'Name' }])}
        source={createLocalSource([ada])}
        toolbar={false}
        footer={false}
      >
        <Harness />
      </DataGrid>,
    );

    await screen.findByRole('button', { name: 'Static' });
    const initial = onRender.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Select' }));
    expect(onRender).toHaveBeenCalledTimes(initial);
  });

  it('rerenders a custom action renderer when selection context changes', async () => {
    const renderAction = vi.fn(() => <button type="button">Custom action</button>);
    const action: GridAction<Row> = { id: 'custom', label: 'Custom', run: () => undefined };
    function Harness() {
      const instance = useGridInstance<Row>();
      return (
        <>
          <button type="button" onClick={() => instance.selection.set([1], [ada])}>
            Select custom
          </button>
          <GridActionButton<Row> action={action} render={renderAction} />
        </>
      );
    }
    render(
      <DataGrid<Row>
        definition={definition('custom-action-subscription', [{ id: 'name', title: 'Name' }])}
        source={createLocalSource([ada])}
        toolbar={false}
        footer={false}
      >
        <Harness />
      </DataGrid>,
    );

    await screen.findByRole('button', { name: 'Custom action' });
    const initial = renderAction.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Select custom' }));
    expect(renderAction.mock.calls.length).toBeGreaterThan(initial);
  });

  it('respects toolbar action disabling in the selected-row bar', async () => {
    const bulkAction: GridAction<Row> = {
      id: 'bulk',
      label: 'Bulk action',
      placement: 'bulk',
      run: () => undefined,
    };
    render(
      <DataGrid<Row>
        definition={{
          ...definition('disabled-bulk-toolbar', [{ id: 'name', title: 'Name' }]),
          actions: [bulkAction],
        }}
        source={createLocalSource([ada])}
        selection
        toolbar={{ actions: false }}
        footer={false}
      />,
    );

    await screen.findByText('Ada');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select row 1' }));
    expect(screen.queryByRole('button', { name: 'Bulk action' })).not.toBeInTheDocument();
  });

  it('hides inert panel actions and treats falsy children as an explicit composition', () => {
    const filters = createFilterGroup();
    const { rerender } = render(
      <DataGrid<Row>
        definition={definition('panel-actions-hidden', [
          { id: 'name', title: 'Name', filter: true },
        ])}
        source={createLocalSource([ada])}
        toolbar={false}
        footer={false}
      >
        <GridFilterPanel<Row> value={filters} onChange={() => undefined} />
      </DataGrid>,
    );
    expect(screen.queryByRole('button', { name: '应用' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '清除' })).not.toBeInTheDocument();

    rerender(
      <DataGrid<Row>
        definition={definition('falsy-child-content', [{ id: 'name', title: 'Name' }])}
        source={createLocalSource([ada])}
        toolbar={false}
        footer={false}
      >
        {false}
      </DataGrid>,
    );
    expect(document.querySelector('.ant-table')).not.toBeInTheDocument();
  });

  it('accounts for pixel-string selection widths in horizontal scrolling', async () => {
    render(
      <DataGrid<Row>
        definition={definition('selection-string-width', [
          { id: 'name', title: 'Name', column: { width: 160 } },
        ])}
        source={createLocalSource([ada])}
        selection={{ columnWidth: '64px' }}
        toolbar={false}
        footer={false}
      />,
    );

    await screen.findByText('Ada');
    expect(document.querySelector('.ant-table-body table')).toHaveStyle({ width: '224px' });
  });
});
