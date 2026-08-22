import { StrictMode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  DataGrid,
  GridFooter,
  GridSearch,
  GridTable,
  GridToolbar,
  GridTotal,
  createLocalSource,
  createRemoteSource,
  type GridDefinition,
} from '../src';

interface Row {
  id: number;
  name: string;
  status: string;
}

const definition: GridDefinition<Row> = {
  id: 'users',
  revision: 1,
  rowKey: 'id',
  fields: [
    { id: 'name', title: 'Name', filter: true, sort: true },
    {
      id: 'status',
      title: 'Status',
      valueType: 'status',
      filter: true,
      options: [
        { label: 'Active', value: 'active', color: 'green' },
        { label: 'Disabled', value: 'disabled' },
      ],
    },
  ],
};

describe('DataGrid', () => {
  it('renders the official toolbar, table and footer recipe', async () => {
    render(
      <DataGrid<Row>
        definition={definition}
        source={createLocalSource([{ id: 1, name: 'Ada', status: 'active' }])}
      />,
    );

    await waitFor(() => expect(screen.getByText('Ada')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /字段/ })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('搜索数据')).toBeInTheDocument();
    expect(screen.getByText('共 1 条')).toBeInTheDocument();
  });

  it('supports a fully custom composition while reusing the same instance', async () => {
    render(
      <DataGrid<Row>
        definition={{ ...definition, id: 'custom-users' }}
        source={createLocalSource([{ id: 1, name: 'Grace', status: 'active' }])}
      >
        {() => (
          <div data-testid="custom-grid">
            <GridToolbar
              start={<GridSearch<Row> debounce={0} />}
              end={<span>Custom action</span>}
            />
            <GridTable<Row> rowActions={false} />
            <GridFooter end={<GridTotal<Row> />} />
          </div>
        )}
      </DataGrid>,
    );

    await waitFor(() => expect(screen.getByText('Grace')).toBeInTheDocument());
    expect(screen.getByTestId('custom-grid')).toBeInTheDocument();
    expect(screen.getByText('Custom action')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /字段/ })).not.toBeInTheDocument();
  });

  it('does not duplicate the initial read during the StrictMode effect replay', async () => {
    const read = vi.fn(async () => ({
      rows: [{ id: 1, name: 'Lin', status: 'active' }],
      total: { value: 1, accuracy: 'exact' as const },
    }));
    render(
      <StrictMode>
        <DataGrid<Row>
          definition={{ ...definition, id: 'strict-users' }}
          source={createRemoteSource(read)}
        />
      </StrictMode>,
    );

    await waitFor(() => expect(screen.getByText('Lin')).toBeInTheDocument());
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('exposes semantic row and cell click contexts without treating controls as row clicks', async () => {
    const onRowClick = vi.fn();
    const onCellClick = vi.fn();
    const runAction = vi.fn();
    render(
      <DataGrid<Row>
        definition={{
          ...definition,
          id: 'interactive-users',
          actions: [
            {
              id: 'inspect',
              label: 'Inspect',
              placement: 'row',
              run: runAction,
            },
          ],
        }}
        source={createLocalSource([{ id: 1, name: 'Ada', status: 'active' }])}
        selection
        onRowClick={onRowClick}
        onCellClick={onCellClick}
        isCellClickable={({ field }) => field?.id === 'name'}
      />,
    );

    const name = await screen.findByText('Ada');
    fireEvent.click(name);
    expect(onCellClick).toHaveBeenCalledTimes(1);
    expect(onCellClick.mock.calls[0]?.[0]).toMatchObject({
      row: { id: 1, name: 'Ada', status: 'active' },
      rowIndex: 0,
      field: { id: 'name' },
      value: 'Ada',
    });
    expect(onRowClick).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select row 1' }));
    expect(onRowClick).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Inspect' }));
    await waitFor(() => expect(runAction).toHaveBeenCalledTimes(1));
    expect(onRowClick).toHaveBeenCalledTimes(1);
  });
});
