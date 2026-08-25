import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  DataGridView,
  createGrid,
  createLocalSource,
  type GridDefinition,
  type GridInstance,
} from '../src';

interface Row {
  id: number;
  name: string;
}

const definition: GridDefinition<Row> = {
  id: 'view-users',
  rowKey: 'id',
  fields: [{ id: 'name', title: 'Name', search: true }],
};

async function createStartedGrid(id: string): Promise<GridInstance<Row>> {
  const grid = createGrid({
    definition: { ...definition, id },
    source: createLocalSource([{ id: 1, name: 'Ada' }]),
  });
  await grid.start();
  return grid;
}

describe('DataGridView', () => {
  it('renders an existing instance without taking over its lifecycle or options', async () => {
    const grid = await createStartedGrid('externally-owned');
    const start = vi.spyOn(grid, 'start');
    const stop = vi.spyOn(grid, 'stop');
    const updateOptions = vi.spyOn(grid, 'updateOptions');
    let renderedInstance: GridInstance<Row> | undefined;

    const view = render(
      <DataGridView<Row> grid={grid} toolbar={false} footer={false}>
        {(instance) => {
          renderedInstance = instance;
          return <output>{instance.getState().data.rows[0]?.name}</output>;
        }}
      </DataGridView>,
    );

    await waitFor(() => expect(screen.getByText('Ada')).toBeInTheDocument());
    expect(renderedInstance).toBe(grid);
    view.unmount();
    expect(start).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
    expect(updateOptions).not.toHaveBeenCalled();

    start.mockRestore();
    stop.mockRestore();
    updateOptions.mockRestore();
    grid.destroy();
  });

  it('composes or replaces every stable default-layout slot', async () => {
    const grid = await createStartedGrid('slotted-view');

    const view = render(
      <DataGridView<Row>
        grid={grid}
        slots={{
          toolbar: (defaultContent, instance) => (
            <div data-testid="toolbar-slot">
              <span>{instance.definition.id}</span>
              {defaultContent}
              <span>toolbar-after</span>
            </div>
          ),
          activeFilters: <div data-testid="filters-replacement">custom filters</div>,
          status: (defaultContent) => (
            <div data-testid="status-slot">
              {defaultContent}
              <span>status-after</span>
            </div>
          ),
          table: (defaultContent) => (
            <div data-testid="table-slot">
              <span>table-before</span>
              {defaultContent}
            </div>
          ),
          footer: <div data-testid="footer-replacement">custom footer</div>,
        }}
      />,
    );

    await waitFor(() => expect(screen.getByText('Ada')).toBeInTheDocument());
    expect(screen.getByTestId('toolbar-slot')).toHaveTextContent('slotted-view');
    expect(screen.getByTestId('toolbar-slot')).toHaveTextContent('toolbar-after');
    expect(screen.getByTestId('filters-replacement')).toHaveTextContent('custom filters');
    expect(screen.getByTestId('status-slot')).toHaveTextContent('status-after');
    expect(screen.getByTestId('table-slot')).toHaveTextContent('table-before');
    expect(screen.getByTestId('footer-replacement')).toHaveTextContent('custom footer');
    expect(screen.queryByText('共 1 条')).not.toBeInTheDocument();

    view.unmount();
    grid.destroy();
  });
});
