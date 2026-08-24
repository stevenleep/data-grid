import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DataGrid,
  GridActionButton,
  GridColumnPanel,
  GridFilterBuilder,
  GridPagination,
  GridSearch,
  GridSortPanel,
  GridTable,
  createFilterGroup,
  createLocalSource,
  createRemoteSource,
  type GridAction,
  type GridDefinition,
  type GridFilterGroup,
  type GridOption,
  type GridSelectionState,
  type GridSort,
  useGridInstance,
  useGridSelector,
} from '../src';
import { useGridOptions } from '../src/antd/hooks';

interface Row {
  id: number;
  name: string;
  website?: string;
  amount?: { amount: string; currency: string };
  picture?: { url: string; name: string };
  owner?: { id: string; name: string };
  tags?: string[];
  metadata?: unknown;
  country?: string;
  timestamp?: string;
  choice?: string | number;
  choices?: Array<string | number>;
}

const row: Row = { id: 1, name: 'Ada' };

const baseDefinition: GridDefinition<Row> = {
  id: 'antd-hardening',
  rowKey: 'id',
  fields: [{ id: 'name', title: 'Name', sort: true }],
};

function OptionsProbe() {
  const instance = useGridInstance<Row>();
  const [search, setSearch] = useState('');
  const [enabled, setEnabled] = useState(false);
  const result = useGridOptions(instance.definition.fieldMap.get('name'), search, enabled);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setSearch('alpha');
          setEnabled(true);
        }}
      >
        Load alpha
      </button>
      <button
        type="button"
        onClick={() => {
          setSearch('beta');
          setEnabled(true);
        }}
      >
        Load beta
      </button>
      <output>{result.options.map((option) => String(option.label)).join(',')}</output>
    </>
  );
}

function StaticOptionsProbe() {
  const instance = useGridInstance<Row>();
  const result = useGridOptions(instance.definition.fieldMap.get('name'), 'bet', true);
  return <output>{result.options.map((option) => String(option.label)).join(',')}</output>;
}

function DependentOptionsProbe() {
  const instance = useGridInstance<Row>();
  const result = useGridOptions(instance.definition.fieldMap.get('name'), '', true);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          const filters = instance.getState().query.filters;
          instance.query.setFilters(
            {
              ...filters,
              children: filters.children.map((node) =>
                node.type === 'group'
                  ? { ...node, logic: node.logic === 'and' ? 'or' : 'and' }
                  : node,
              ),
            },
            'user',
          );
        }}
      >
        Toggle dependent logic
      </button>
      <output aria-label="dependent options">
        {result.options.map((option) => String(option.label)).join(',')}
      </output>
    </>
  );
}

function SearchProbe({ onChange }: { onChange: (value: string) => void }) {
  const [, rerender] = useState(0);
  return (
    <GridSearch<Row>
      debounce={100}
      onChange={(value) => {
        onChange(value);
        rerender((count) => count + 1);
      }}
    />
  );
}

function SelectionProbe() {
  const selection = useGridSelector<Row, GridSelectionState>((state) => state.selection);
  return (
    <output aria-label="selection state">
      {selection.mode === 'explicit'
        ? `explicit:${selection.selectedKeys.join(',')}`
        : `allMatching:${selection.excludedKeys.join(',')}`}
    </output>
  );
}

function FilterProbe() {
  const [filters, setFilters] = useState<GridFilterGroup>(() => createFilterGroup());
  return (
    <>
      <GridFilterBuilder<Row> value={filters} onChange={setFilters} />
      <output aria-label="filter state">{JSON.stringify(filters)}</output>
    </>
  );
}

function SortProbe() {
  const sorts = useGridSelector<Row, GridSort[]>((state) => state.query.sorts);
  return (
    <output aria-label="sort state">
      {sorts.map((sort) => `${sort.fieldId}:${sort.direction}`).join(',')}
    </output>
  );
}

afterEach(() => {
  vi.useRealTimers();
  document.body.style.cursor = '';
});

describe('Ant Design adapter hardening', () => {
  it('flushes search on Enter without leaving a duplicate debounce callback', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render(
      <DataGrid<Row>
        definition={{ ...baseDefinition, id: 'search-hardening' }}
        source={createLocalSource([row])}
        toolbar={false}
        footer={false}
      >
        <SearchProbe onChange={onChange} />
      </DataGrid>,
    );

    const input = screen.getByPlaceholderText('搜索数据');
    fireEvent.change(input, { target: { value: '  Ada  ' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith('Ada');

    act(() => vi.advanceTimersByTime(200));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('renders protocol objects and high precision money without crashing or rounding', async () => {
    const definition: GridDefinition<Row> = {
      ...baseDefinition,
      id: 'safe-values',
      fields: [...baseDefinition.fields, { id: 'amount', title: 'Amount', valueType: 'money' }],
    };
    render(
      <DataGrid<Row>
        definition={definition}
        source={createRemoteSource<Row>(
          async () => ({
            rows: [
              {
                ...row,
                amount: { amount: '9007199254740993.1234567890123456789', currency: 'CNY' },
              },
            ],
            total: { value: 1, accuracy: 'exact' },
            summary: [
              {
                id: 'raw-summary',
                label: { kind: 'raw' },
                value: { amount: 10, currency: 'CNY' },
              },
            ],
          }),
          { capabilities: { summary: true } },
        )}
        toolbar={false}
      />,
    );

    expect(
      await screen.findByText('CNY 9,007,199,254,740,993.1234567890123456789'),
    ).toBeInTheDocument();
    expect(screen.getByText('{"kind":"raw"}')).toBeInTheDocument();
    expect(screen.getByText('{"amount":10,"currency":"CNY"}')).toBeInTheDocument();
  });

  it('keeps option identity and colors distinct for numeric and string values', async () => {
    render(
      <DataGrid<Row>
        definition={{
          ...baseDefinition,
          id: 'typed-option-identities',
          fields: [
            {
              id: 'choice',
              title: 'Choice',
              valueType: 'select',
              options: [
                { label: 'String one', value: '1', color: 'red' },
                { label: 'Numeric one', value: 1, color: 'green' },
              ],
            },
            {
              id: 'choices',
              title: 'Choices',
              valueType: 'multiSelect',
              options: [
                { label: 'Multi numeric', value: 1, color: 'green' },
                { label: 'Multi string', value: '1', color: 'red' },
              ],
            },
          ],
        }}
        source={createLocalSource([{ ...row, choice: 1, choices: [1, '1'] }])}
        toolbar={false}
        footer={false}
      />,
    );

    expect((await screen.findByText('Numeric one')).closest('.ant-tag')).toHaveClass(
      'ant-tag-green',
    );
    expect(screen.queryByText('String one')).not.toBeInTheDocument();
    expect(screen.getByText('Multi numeric').closest('.ant-tag')).toHaveClass('ant-tag-green');
    expect(screen.getByText('Multi string').closest('.ant-tag')).toHaveClass('ant-tag-red');
  });

  it('supports keyboard activation while ignoring interactive cell descendants', async () => {
    const onRowClick = vi.fn();
    const onCellClick = vi.fn();
    render(
      <DataGrid<Row>
        definition={{
          ...baseDefinition,
          id: 'keyboard-interactions',
          fields: [
            ...baseDefinition.fields,
            { id: 'website', title: 'Website', valueType: 'link' },
          ],
        }}
        source={createLocalSource([{ ...row, website: 'https://example.com' }])}
        toolbar={false}
        footer={false}
        onRowClick={onRowClick}
        onCellClick={onCellClick}
      />,
    );

    const name = await screen.findByText('Ada');
    const cell = name.closest('td');
    const tableRow = name.closest('tr');
    expect(cell).toHaveAttribute('tabindex', '0');
    expect(tableRow).toHaveAttribute('tabindex', '0');

    fireEvent.keyDown(cell!, { key: 'Enter', code: 'Enter' });
    expect(onCellClick).toHaveBeenCalledTimes(1);
    expect(onRowClick).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(tableRow!, { key: ' ', code: 'Space' });
    expect(onRowClick).toHaveBeenCalledTimes(2);

    const link = screen.getByRole('link', { name: /https:\/\/example\.com/ });
    link.addEventListener('click', (event) => event.preventDefault());
    fireEvent.click(link);
    expect(onCellClick).toHaveBeenCalledTimes(1);
    expect(onRowClick).toHaveBeenCalledTimes(2);
  });

  it('recomputes a standalone action when selection context changes', async () => {
    const action: GridAction<Row> = {
      id: 'selected-action',
      label: 'Selected action',
      visible: ({ selection }) =>
        selection.mode === 'explicit'
          ? selection.selectedKeys.length > 0
          : selection.total > selection.excludedKeys.length,
      run: vi.fn(),
    };
    render(
      <DataGrid<Row>
        definition={{ ...baseDefinition, id: 'standalone-action', actions: [action] }}
        source={createLocalSource([row])}
        toolbar={false}
        footer={false}
      >
        {(instance) => (
          <>
            <GridActionButton<Row> action={action} />
            <button type="button" onClick={() => instance.selection.set([row.id], [row])}>
              Select row
            </button>
          </>
        )}
      </DataGrid>,
    );

    expect(screen.queryByRole('button', { name: 'Selected action' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Select row' }));
    expect(await screen.findByRole('button', { name: 'Selected action' })).toBeInTheDocument();
  });

  it('removes unsupported null placement before applying a sort', () => {
    const onApply = vi.fn();
    const illegalSort: GridSort = {
      id: 'name-sort',
      fieldId: 'name',
      direction: 'asc',
      nulls: 'last',
    };
    render(
      <DataGrid<Row>
        definition={{
          ...baseDefinition,
          id: 'sort-null-placement',
          fields: [{ id: 'name', title: 'Name', sort: { nulls: false } }],
        }}
        source={createLocalSource([row])}
        toolbar={false}
        footer={false}
      >
        <GridSortPanel<Row> value={[illegalSort]} onChange={() => undefined} onApply={onApply} />
      </DataGrid>,
    );

    fireEvent.click(screen.getByRole('button', { name: /应\s*用/ }));
    expect(onApply).toHaveBeenCalledWith([{ id: 'name-sort', fieldId: 'name', direction: 'asc' }]);
  });

  it('disables unknown-total pagination after a short page', async () => {
    render(
      <DataGrid<Row>
        definition={{ ...baseDefinition, id: 'unknown-total' }}
        source={createRemoteSource(async () => ({ rows: [row] }))}
        toolbar={false}
        footer={false}
      >
        <>
          <GridTable<Row> rowActions={false} />
          <GridPagination<Row> />
        </>
      </DataGrid>,
    );

    await screen.findByText('Ada');
    expect(screen.getByRole('button', { name: '下一页' })).toBeDisabled();
  });

  it('chains supported selection callbacks and provides useful image alt text', async () => {
    const onSelect = vi.fn();
    render(
      <DataGrid<Row>
        definition={{
          ...baseDefinition,
          id: 'selection-and-image',
          fields: [
            ...baseDefinition.fields,
            { id: 'picture', title: 'Picture', valueType: 'image' },
          ],
        }}
        source={createLocalSource([
          { ...row, picture: { url: 'https://example.com/ada.png', name: 'Ada portrait' } },
        ])}
        selection={{ onSelect }}
        toolbar={false}
        footer={false}
      />,
    );

    await screen.findByText('Ada');
    expect(screen.getByRole('img', { name: 'Ada portrait' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select row 1' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('commits single, shift-range, and select-all changes once while chaining callbacks', async () => {
    const rows: Row[] = [
      { id: 1, name: 'Ada' },
      { id: 2, name: 'Grace' },
      { id: 3, name: 'Linus' },
    ];
    const onChange = vi.fn();
    const onSelect = vi.fn();
    const onSelectAll = vi.fn();
    const onSelectMultiple = vi.fn();
    const onEvent = vi.fn();

    const view = render(
      <DataGrid<Row>
        definition={{ ...baseDefinition, id: 'selection-change-entrypoint' }}
        source={createLocalSource(rows)}
        selection={{ selections: true, onChange, onSelect, onSelectAll, onSelectMultiple }}
        toolbar={false}
        footer={false}
        onEvent={onEvent}
      >
        <>
          <GridTable<Row> />
          <SelectionProbe />
        </>
      </DataGrid>,
    );

    await screen.findByText('Linus');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select row 1' }));
    expect(screen.getByRole('status', { name: 'selection state' })).toHaveTextContent('explicit:1');

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select row 3' }), {
      shiftKey: true,
    });
    expect(screen.getByRole('status', { name: 'selection state' })).toHaveTextContent(
      'explicit:1,2,3',
    );
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelectMultiple).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange.mock.calls[1]?.[2]).toEqual({ type: 'multiple' });

    fireEvent.click(screen.getByRole('checkbox', { name: 'Custom selection' }));
    expect(screen.getByRole('status', { name: 'selection state' })).toHaveTextContent('explicit:');
    expect(onSelectAll).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledTimes(3);

    fireEvent.mouseEnter(view.container.querySelector('.ant-dropdown-trigger')!);
    fireEvent.click(await screen.findByText('Select all data'));
    expect(screen.getByRole('status', { name: 'selection state' })).toHaveTextContent(
      'explicit:1,2,3',
    );
    expect(onChange).toHaveBeenCalledTimes(4);
    expect(onChange.mock.calls[3]?.[2]).toEqual({ type: 'all' });
    expect(onEvent.mock.calls.filter(([event]) => event.type === 'selection.change')).toHaveLength(
      4,
    );
  }, 10_000);

  it('preserves all-matching mode when Ant Design reports selected row keys', async () => {
    const rows: Row[] = [
      { id: 1, name: 'Ada' },
      { id: 2, name: 'Grace' },
    ];
    render(
      <DataGrid<Row>
        definition={{ ...baseDefinition, id: 'all-matching-selection-change' }}
        source={createRemoteSource(
          async () => ({ rows, total: { value: rows.length, accuracy: 'exact' } }),
          { capabilities: { selectAllMatching: true } },
        )}
        selection
        toolbar={false}
        footer={false}
      >
        {(instance) => (
          <>
            <GridTable<Row> />
            <button type="button" onClick={() => instance.selection.selectAllMatching()}>
              Select all matching
            </button>
            <SelectionProbe />
          </>
        )}
      </DataGrid>,
    );

    await screen.findByText('Grace');
    fireEvent.click(screen.getByRole('button', { name: 'Select all matching' }));
    expect(screen.getByRole('status', { name: 'selection state' })).toHaveTextContent(
      'allMatching:',
    );

    fireEvent.click(screen.getByRole('checkbox', { name: 'Row 1 selected' }));
    expect(screen.getByRole('status', { name: 'selection state' })).toHaveTextContent(
      'allMatching:1',
    );
  });

  it('restores the document cursor when unmounted during column resize', async () => {
    const view = render(
      <DataGrid<Row>
        definition={{ ...baseDefinition, id: 'resize-cleanup' }}
        source={createLocalSource([row])}
        toolbar={false}
        footer={false}
      />,
    );

    await screen.findByText('Ada');
    fireEvent.pointerDown(screen.getByRole('separator', { name: '调整 Name 列宽' }), {
      clientX: 100,
    });
    expect(document.body.style.cursor).toBe('col-resize');
    view.unmount();
    expect(document.body.style.cursor).toBe('');
  });

  it('aborts stale option consumers and only publishes the latest result', async () => {
    vi.useFakeTimers();
    const requests = new Map<
      string,
      { signal: AbortSignal; resolve: (options: GridOption[]) => void }
    >();
    const loader = vi.fn(
      ({ search, signal }: { search: string; signal: AbortSignal }) =>
        new Promise<GridOption[]>((resolve) => requests.set(search, { signal, resolve })),
    );
    render(
      <DataGrid<Row>
        definition={{
          ...baseDefinition,
          id: 'latest-options',
          fields: [{ id: 'name', title: 'Name', options: loader }],
        }}
        source={createLocalSource([row])}
        toolbar={false}
        footer={false}
      >
        <OptionsProbe />
      </DataGrid>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Load alpha' }));
    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    });
    expect(requests.has('alpha')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Load beta' }));
    expect(requests.get('alpha')?.signal.aborted).toBe(true);
    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    });

    await act(async () => {
      requests.get('beta')?.resolve([{ label: 'Beta', value: 'beta' }]);
      await Promise.resolve();
    });
    expect(screen.getByText('Beta')).toBeInTheDocument();

    await act(async () => {
      requests.get('alpha')?.resolve([{ label: 'Alpha', value: 'alpha' }]);
      await Promise.resolve();
    });
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });

  it('keeps search filtering for static options', async () => {
    render(
      <DataGrid<Row>
        definition={{
          ...baseDefinition,
          id: 'static-options-search',
          fields: [
            {
              id: 'name',
              title: 'Name',
              options: [
                { label: 'Alpha', value: 'alpha' },
                { label: 'Beta', value: 'beta' },
              ],
            },
          ],
        }}
        source={createLocalSource([row])}
        toolbar={false}
        footer={false}
      >
        <StaticOptionsProbe />
      </DataGrid>,
    );

    expect(await screen.findByText('Beta')).toBeInTheDocument();
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument();
  });

  it('reloads dependent options when a nested filter group changes logic', async () => {
    const loader = vi.fn(async () => [{ label: 'Dependent option', value: 'dependent' }]);
    const filters: GridFilterGroup = {
      id: 'root-filter',
      type: 'group',
      logic: 'and',
      children: [
        {
          id: 'nested-filter',
          type: 'group',
          logic: 'and',
          children: [
            {
              id: 'country-filter',
              type: 'condition',
              fieldId: 'country',
              operator: 'equals',
              value: 'CN',
            },
          ],
        },
      ],
    };
    render(
      <DataGrid<Row>
        definition={{
          ...baseDefinition,
          id: 'nested-dependent-options',
          fields: [
            { id: 'country', title: 'Country', filter: true },
            {
              id: 'name',
              title: 'Name',
              options: { dependsOn: ['country'], load: loader },
            },
          ],
        }}
        source={createLocalSource([{ ...row, country: 'CN' }])}
        defaultState={{ query: { filters } }}
        toolbar={false}
        footer={false}
      >
        <DependentOptionsProbe />
      </DataGrid>,
    );

    await waitFor(() => expect(loader).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Toggle dependent logic' }));
    await waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
  });

  it('uses the UI time zone for core relative-date filters unless temporal overrides it', async () => {
    const filters: GridFilterGroup = {
      id: 'root-date-filter',
      type: 'group',
      logic: 'and',
      children: [
        {
          id: 'today-filter',
          type: 'condition',
          fieldId: 'timestamp',
          operator: 'today',
        },
      ],
    };
    const definition: GridDefinition<Row> = {
      ...baseDefinition,
      id: 'ui-temporal-time-zone',
      fields: [
        { id: 'name', title: 'Name' },
        { id: 'timestamp', title: 'Timestamp', valueType: 'dateTime', filter: true },
      ],
    };
    const source = createLocalSource([{ ...row, timestamp: '2024-01-01T15:30:00.000Z' }]);
    const now = () => new Date('2024-01-01T16:30:00.000Z');

    const inherited = render(
      <DataGrid<Row>
        definition={definition}
        source={source}
        defaultState={{ query: { filters } }}
        timeZone="Asia/Shanghai"
        temporal={{ now }}
        toolbar={false}
        footer={false}
      />,
    );
    expect(await screen.findByText('没有符合条件的数据')).toBeInTheDocument();
    inherited.unmount();

    render(
      <DataGrid<Row>
        definition={definition}
        source={source}
        defaultState={{ query: { filters } }}
        timeZone="Asia/Shanghai"
        temporal={{ now, timeZone: 'UTC' }}
        toolbar={false}
        footer={false}
      />,
    );
    expect(await screen.findByText('Ada')).toBeInTheDocument();
  });

  it('translates built-in required and save errors through the active locale', async () => {
    render(
      <DataGrid<Row>
        definition={{
          ...baseDefinition,
          id: 'localized-editing-errors',
          fields: [{ id: 'name', title: 'Name', edit: { required: true } }],
          editing: {
            save: async () => {
              throw new Error('backend unavailable');
            },
          },
        }}
        source={createLocalSource([row])}
        toolbar={false}
        footer={false}
      />,
    );

    const editButton = await screen.findByRole('button', { name: '编辑 Name' });
    fireEvent.doubleClick(editButton);
    const input = screen.getByDisplayValue('Ada');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect(await screen.findByText('该字段不能为空')).toBeInTheDocument();

    fireEvent.change(input, { target: { value: 'Grace' } });
    fireEvent.blur(input);
    expect(await screen.findByText('保存失败')).toBeInTheDocument();
  });

  it('intersects field filter operators with source capabilities and chooses a legal default', () => {
    render(
      <DataGrid<Row>
        definition={{
          ...baseDefinition,
          id: 'source-filter-operators',
          fields: [
            {
              id: 'name',
              title: 'Name',
              filter: { operators: ['contains', 'equals'], defaultOperator: 'contains' },
            },
          ],
        }}
        source={createRemoteSource(async () => ({ rows: [row] }), {
          capabilities: { filter: { operators: ['equals'] } },
        })}
        toolbar={false}
        footer={false}
      >
        <FilterProbe />
      </DataGrid>,
    );

    fireEvent.click(screen.getByRole('button', { name: /添加条件/ }));
    expect(screen.getByRole('status', { name: 'filter state' })).toHaveTextContent(
      '"operator":"equals"',
    );
    expect(screen.queryByText('包含')).not.toBeInTheDocument();
  });

  it('rerenders custom cells when their renderer depends on another field', async () => {
    render(
      <DataGrid<Row>
        definition={{
          ...baseDefinition,
          id: 'custom-render-cross-field',
          fields: [
            {
              id: 'name',
              title: 'Name',
              render: ({ value, row: current }) => `${value}:${current.website || 'offline'}`,
            },
          ],
        }}
        source={createLocalSource([row])}
        toolbar={false}
        footer={false}
      >
        {(instance) => (
          <>
            <GridTable<Row> rowActions={false} />
            <button type="button" onClick={() => instance.data.patchRow(row.id, { website: 'on' })}>
              Change sibling field
            </button>
          </>
        )}
      </DataGrid>,
    );

    expect(await screen.findByText('Ada:offline')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Change sibling field' }));
    expect(await screen.findByText('Ada:on')).toBeInTheDocument();
  });

  it('preserves money object metadata when using the built-in editor', async () => {
    const save = vi.fn(async ({ row: current, value }) => ({ ...current, amount: value }));
    render(
      <DataGrid<Row>
        definition={{
          ...baseDefinition,
          id: 'money-object-editor',
          fields: [{ id: 'amount', title: 'Amount', valueType: 'money', edit: true }],
          editing: { save },
        }}
        source={createLocalSource([{ ...row, amount: { amount: '10.00', currency: 'USD' } }])}
        toolbar={false}
        footer={false}
      />,
    );

    fireEvent.doubleClick(await screen.findByRole('button', { name: '编辑 Amount' }));
    const input = screen.getByRole('spinbutton');
    fireEvent.change(input, { target: { value: '12.50' } });
    fireEvent.blur(input);
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0]?.[0].value).toEqual({ amount: '12.5', currency: 'USD' });
  });

  it('adapts relation option identities without discarding existing domain objects', async () => {
    const owners = {
      'user-1': { id: 'user-1', name: 'Domain user one' },
      'user-2': { id: 'user-2', name: 'Domain user two' },
    };
    const save = vi.fn(async ({ row: current, value }) => ({ ...current, owner: value }));
    render(
      <DataGrid<Row>
        definition={{
          ...baseDefinition,
          id: 'relation-object-editor',
          fields: [
            {
              id: 'owner',
              title: 'Owner',
              valueType: 'relation',
              edit: { placeholder: 'Choose an owner' },
              options: [
                { label: 'User option one', value: 'user-1' },
                { label: 'User option two', value: 'user-2' },
              ],
              normalize: (value) =>
                typeof value === 'string' ? owners[value as keyof typeof owners] : value,
            },
          ],
          editing: { save },
        }}
        source={createLocalSource([{ ...row, owner: owners['user-1'] }])}
        toolbar={false}
        footer={false}
      />,
    );

    fireEvent.doubleClick(await screen.findByRole('button', { name: '编辑 Owner' }));
    fireEvent.click(await screen.findByText('User option two'));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0]?.[0].value).toEqual(owners['user-2']);
  });

  it('keeps multi-select editing open until blur and commits the full array once', async () => {
    const save = vi.fn(async ({ row: current, value }) => ({ ...current, tags: value }));
    render(
      <DataGrid<Row>
        definition={{
          ...baseDefinition,
          id: 'multi-select-editor',
          fields: [
            {
              id: 'tags',
              title: 'Tags',
              valueType: 'multiSelect',
              edit: true,
              options: [
                { label: 'Tag Alpha', value: 'alpha' },
                { label: 'Tag Beta', value: 'beta' },
              ],
            },
          ],
          editing: { save },
        }}
        source={createLocalSource([{ ...row, tags: ['alpha'] }])}
        toolbar={false}
        footer={false}
      />,
    );

    fireEvent.doubleClick(await screen.findByRole('button', { name: '编辑 Tags' }));
    const input = screen.getByRole('combobox');
    fireEvent.click(await screen.findByText('Tag Beta'));
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    fireEvent.blur(input);
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0]?.[0].value).toEqual(['alpha', 'beta']);
  });

  it('parses JSON drafts and blocks invalid text from being committed', async () => {
    const save = vi.fn(async ({ row: current, value }) => ({ ...current, metadata: value }));
    render(
      <DataGrid<Row>
        definition={{
          ...baseDefinition,
          id: 'json-editor',
          fields: [
            {
              id: 'metadata',
              title: 'Metadata',
              valueType: 'json',
              edit: { placeholder: 'JSON payload' },
            },
          ],
          editing: { save },
        }}
        source={createLocalSource([{ ...row, metadata: { count: 1 } }])}
        toolbar={false}
        footer={false}
      />,
    );

    fireEvent.doubleClick(await screen.findByRole('button', { name: '编辑 Metadata' }));
    const textarea = screen.getByRole('textbox');
    expect(textarea.tagName).toBe('TEXTAREA');
    expect(textarea).toHaveAttribute('placeholder', 'JSON payload');
    fireEvent.change(textarea, { target: { value: '{broken' } });
    fireEvent.blur(textarea);
    expect(save).not.toHaveBeenCalled();
    expect(await screen.findByText('请输入有效的 JSON')).toBeInTheDocument();

    fireEvent.change(textarea, { target: { value: '{"count":2}' } });
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter', ctrlKey: true });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0]?.[0].value).toEqual({ count: 2 });
  });

  it('keeps grouped and non-reorderable column boundaries intact in the column panel', () => {
    render(
      <DataGrid<Row>
        definition={{
          ...baseDefinition,
          id: 'grouped-column-order',
          columns: [
            {
              id: 'identity',
              title: 'Identity',
              children: [
                { id: 'locked-name', fieldId: 'name', title: 'Locked', reorderable: false },
                { id: 'name-copy', fieldId: 'name', title: 'Name copy' },
              ],
            },
            { id: 'outside', fieldId: 'name', title: 'Outside' },
          ],
        }}
        source={createLocalSource([row])}
        toolbar={false}
        footer={false}
      >
        <GridColumnPanel<Row> />
      </DataGrid>,
    );

    const copyItem = screen.getByText('Name copy').closest<HTMLElement>('.hui-grid__column-item')!;
    expect(within(copyItem).getByRole('button', { name: '上移' })).toBeDisabled();
    expect(within(copyItem).getByRole('button', { name: '下移' })).toBeDisabled();
  });

  it('keeps multi-sort priority in the order users add fields', async () => {
    render(
      <DataGrid<Row>
        definition={{
          ...baseDefinition,
          id: 'stable-table-multi-sort',
          fields: [
            { id: 'name', title: 'Name', sort: true },
            { id: 'website', title: 'Website', sort: true },
          ],
        }}
        source={createRemoteSource<Row>(async () => ({ rows: [{ ...row, website: 'site' }] }), {
          capabilities: { sort: { max: 2 } },
        })}
        toolbar={false}
        footer={false}
      >
        <>
          <GridTable<Row> rowActions={false} />
          <SortProbe />
        </>
      </DataGrid>,
    );

    await screen.findByText('Ada');
    fireEvent.click(screen.getAllByText('Website')[0]!.closest('.ant-table-column-sorters')!);
    fireEvent.click(screen.getAllByText('Name')[0]!.closest('.ant-table-column-sorters')!);
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'sort state' })).toHaveTextContent(
        'website:asc,name:asc',
      ),
    );
  });

  it('isolates a failing custom cell renderer and exposes complete resize semantics', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <DataGrid<Row>
        definition={{
          ...baseDefinition,
          id: 'renderer-boundary-and-resize-a11y',
          fields: [
            {
              id: 'name',
              title: 'Name',
              column: { width: 120, minWidth: 90, maxWidth: 180 },
              render: () => {
                throw new Error('renderer exploded');
              },
            },
          ],
        }}
        source={createLocalSource([row])}
        toolbar={false}
        footer={false}
      />,
    );

    expect(await screen.findByTitle('内容渲染失败')).toHaveTextContent('—');
    const separator = screen.getByRole('separator', { name: '调整 Name 列宽' });
    expect(separator).toHaveAttribute('aria-valuemin', '90');
    expect(separator).toHaveAttribute('aria-valuemax', '180');
    expect(separator).toHaveAttribute('aria-valuenow', '120');
    consoleError.mockRestore();
  });

  it('never offers all-matching selection for radio tables', async () => {
    render(
      <DataGrid<Row>
        definition={{ ...baseDefinition, id: 'radio-no-all-matching' }}
        source={createRemoteSource(
          async () => ({
            rows: [row, { id: 2, name: 'Grace' }],
            total: { value: 2, accuracy: 'exact' },
          }),
          { capabilities: { selectAllMatching: true } },
        )}
        selection={{ type: 'radio' }}
        toolbar={false}
      />,
    );

    await screen.findByText('Grace');
    fireEvent.click(screen.getByRole('radio', { name: 'Select row 1' }));
    expect(screen.queryByRole('button', { name: '选择全部 2 项' })).not.toBeInTheDocument();
  });
});
