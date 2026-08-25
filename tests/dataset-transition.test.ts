import { describe, expect, it, vi } from 'vitest';
import {
  createFilterCondition,
  createFilterGroup,
  createGrid,
  createLocalSource,
  createRemoteSource,
  type GridDefinition,
  type GridQuery,
  type GridReadResult,
} from '../src/core';

interface Row {
  id: number;
  name: string;
}

const definition: GridDefinition<Row> = {
  id: 'dataset-transition',
  rowKey: 'id',
  fields: [{ id: 'name', title: 'Name', filter: true, sort: true }],
  defaults: { pageSize: 5, selection: true, views: true },
};

const tenantA = Array.from({ length: 20 }, (_, index) => ({
  id: index + 1,
  name: `Tenant A ${index + 1}`,
}));
const tenantB = [{ id: 2, name: 'Tenant B' }];

function queryWithTenantState(): GridQuery {
  return {
    pagination: { type: 'offset', page: 4, pageSize: 5 },
    keyword: 'tenant-a-secret',
    filters: createFilterGroup('and', [createFilterCondition('name', 'contains', 'Tenant A')]),
    sorts: [{ id: 'name-sort', fieldId: 'name', direction: 'desc' }],
    context: { accountId: 'tenant-a' },
    projection: ['name'],
  };
}

describe('dataset transition boundaries', () => {
  it('clears dataset-specific query, view and entity state while preserving column preferences', async () => {
    const grid = createGrid<Row>({
      definition,
      source: createLocalSource(tenantA, undefined, 'tenant-a'),
    });
    await grid.start();
    grid.query.set(queryWithTenantState());
    grid.columns.setWidth('name', 248);
    grid.views.create('Tenant A private view');
    grid.selection.selectPage();

    grid.updateOptions({
      definition,
      source: createLocalSource(tenantB, undefined, 'tenant-b'),
    });

    expect(grid.getState()).toMatchObject({
      query: {
        pagination: { type: 'offset', page: 1, pageSize: 5 },
        keyword: '',
        filters: { type: 'group', children: [] },
        sorts: [],
      },
      views: { items: [], dirty: false },
      selection: { mode: 'explicit', selectedKeys: [] },
      columns: { widths: { name: 248 } },
    });
    expect(grid.getState().query.context).toBeUndefined();
    expect(grid.getState().query.projection).toBeUndefined();
    expect(grid.getState().views.activeId).toBeUndefined();
    expect(grid.getState().data.rows).toEqual(tenantB);
    grid.destroy();
  });

  it('preserves only explicitly opted-in query domains and detaches retained views', async () => {
    const grid = createGrid<Row>({
      definition,
      source: createLocalSource(tenantA, undefined, 'tenant-a'),
    });
    await grid.start();
    grid.query.set(queryWithTenantState());
    grid.views.create('Reusable view');

    grid.updateOptions({
      definition,
      source: createLocalSource(tenantB, undefined, 'tenant-b'),
      datasetTransition: {
        preserveQuery: ['keyword', 'context'],
        preserveViews: true,
      },
    });

    expect(grid.getState().query).toMatchObject({
      pagination: { type: 'offset', page: 1, pageSize: 5 },
      keyword: 'tenant-a-secret',
      filters: { type: 'group', children: [] },
      sorts: [],
      context: { accountId: 'tenant-a' },
    });
    expect(grid.getState().query.projection).toBeUndefined();
    expect(grid.getState().views.items).toHaveLength(1);
    expect(grid.getState().views.activeId).toBeUndefined();
    expect(grid.getState().views.dirty).toBe(false);
    grid.destroy();
  });

  it('never sends tenant A query state to the tenant B reader by default', async () => {
    const readsA: GridQuery[] = [];
    const readsB: GridQuery[] = [];
    const source = (datasetKey: string, reads: GridQuery[], rows: Row[]) =>
      createRemoteSource<Row>(
        async ({ query }): Promise<GridReadResult<Row>> => {
          reads.push(query);
          return { rows, total: { value: rows.length, accuracy: 'exact' } };
        },
        { datasetKey },
      );
    const grid = createGrid<Row>({ definition, source: source('tenant-a', readsA, tenantA) });
    await grid.start();
    grid.query.set(queryWithTenantState());
    await vi.waitFor(() => expect(readsA).toHaveLength(2));

    grid.updateOptions({ definition, source: source('tenant-b', readsB, tenantB) });
    await vi.waitFor(() => expect(readsB).toHaveLength(1));

    expect(readsB[0]).toMatchObject({
      pagination: { type: 'offset', page: 1, pageSize: 5 },
      keyword: '',
      filters: { children: [] },
      sorts: [],
    });
    expect(readsB[0]?.context).toBeUndefined();
    expect(readsB[0]?.projection).toBeUndefined();
    expect(grid.getState().data.rows).toEqual(tenantB);
    grid.destroy();
  });

  it('masks controlled query state until its stateDatasetKey acknowledges the new dataset', async () => {
    const onStateChange = vi.fn();
    const tenantAQuery = queryWithTenantState();
    const grid = createGrid<Row>({
      definition,
      source: createLocalSource(tenantA, undefined, 'tenant-a'),
      state: { query: tenantAQuery },
      stateDatasetKey: 'tenant-a',
      onStateChange,
    });
    await grid.start();
    onStateChange.mockClear();

    grid.updateOptions({
      definition,
      source: createLocalSource(tenantB, undefined, 'tenant-b'),
      state: { query: { ...tenantAQuery, filters: { ...tenantAQuery.filters } } },
      stateDatasetKey: 'tenant-a',
      onStateChange,
    });

    expect(grid.getState().query.keyword).toBe('');
    expect(grid.getState().query.context).toBeUndefined();
    expect(
      onStateChange.mock.calls.some((call) => call[1]?.type === 'dataset.controlled.reset'),
    ).toBe(true);

    const acknowledged: GridQuery = {
      ...grid.getState().query,
      keyword: 'tenant-b-query',
      context: { accountId: 'tenant-b' },
    };
    grid.updateOptions({
      definition,
      source: createLocalSource(tenantB, undefined, 'tenant-b'),
      state: { query: acknowledged },
      stateDatasetKey: 'tenant-b',
      onStateChange,
    });
    expect(grid.getState().query).toBe(acknowledged);
    grid.destroy();
  });

  it('rejects malformed dataset transition policies at the protocol boundary', () => {
    expect(() =>
      createGrid<Row>({
        definition,
        source: createLocalSource(tenantA, undefined, 'tenant-a'),
        datasetTransition: { preserveQuery: ['keyword', 'keyword'] },
      }),
    ).toThrow('unique query-slice array');
  });

  it('requires provenance for every dataset-sensitive controlled state slice', () => {
    expect(() =>
      createGrid<Row>({
        definition,
        source: createLocalSource(tenantA, undefined, 'tenant-a'),
        state: { query: queryWithTenantState() },
      }),
    ).toThrow('requires stateDatasetKey');

    expect(() =>
      createGrid<Row>({
        definition,
        source: createLocalSource(tenantA, undefined, 'tenant-a'),
        state: {
          columns: {
            order: ['name'],
            hidden: [],
            widths: { name: 160 },
            pinned: { name: null },
            density: 'compact',
          },
        },
      }),
    ).not.toThrow();
  });
});
