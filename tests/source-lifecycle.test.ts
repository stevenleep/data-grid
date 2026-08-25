import { describe, expect, it, vi } from 'vitest';
import {
  createControlledSource,
  createFilterCondition,
  createFilterGroup,
  createGrid,
  createLocalSource,
  createRemoteSource,
  getRequestSignature,
  type GridDefinition,
  type GridReadInput,
  type GridReadResult,
  type GridRequestQuery,
} from '../src/core';

interface Row {
  id: number;
  name: string;
}

const definition: GridDefinition<Row> = {
  id: 'source-lifecycle',
  rowKey: 'id',
  fields: [{ id: 'name', title: 'Name' }],
};

describe('source lifecycle identity', () => {
  it('updates a reader closure without reloading a stable dataset', async () => {
    const firstRead = vi.fn(async (): Promise<GridReadResult<Row>> => ({
      rows: [{ id: 1, name: 'First reader' }],
    }));
    const secondRead = vi.fn(async (): Promise<GridReadResult<Row>> => ({
      rows: [{ id: 2, name: 'Latest reader' }],
    }));
    const source = (read: typeof firstRead | typeof secondRead) =>
      createRemoteSource(read, { datasetKey: 'tenant-a:orders' });
    const grid = createGrid({ definition, source: source(firstRead) });

    await grid.start();
    expect(firstRead).toHaveBeenCalledOnce();

    grid.updateOptions({ definition, source: source(secondRead) });
    await Promise.resolve();
    expect(secondRead).not.toHaveBeenCalled();
    expect(grid.getState().data.rows[0]?.name).toBe('First reader');

    grid.query.setKeyword('latest');
    await vi.waitFor(() => expect(secondRead).toHaveBeenCalledOnce());
    expect(grid.getState().data.rows[0]?.name).toBe('Latest reader');
    grid.destroy();
  });

  it('reloads a changed driver without resetting the logical dataset state', async () => {
    const firstRead = vi.fn(async (): Promise<GridReadResult<Row>> => ({
      rows: [{ id: 1, name: 'First driver' }],
      total: { value: 1, accuracy: 'exact' },
    }));
    const secondRead = vi.fn(async (): Promise<GridReadResult<Row>> => ({
      rows: [{ id: 1, name: 'Second driver' }],
      total: { value: 1, accuracy: 'exact' },
    }));
    const source = (read: typeof firstRead | typeof secondRead, driverKey: string) =>
      createRemoteSource(read, {
        datasetKey: 'tenant-a:orders',
        driverKey,
      });
    const grid = createGrid({ definition, source: source(firstRead, 'orders-api:v1') });

    await grid.start();
    grid.query.setKeyword('preserved');
    await vi.waitFor(() => expect(firstRead).toHaveBeenCalledTimes(2));
    grid.selection.toggle(1, grid.getState().data.rows[0]!);

    grid.updateOptions({ definition, source: source(secondRead, 'orders-api:v2') });
    expect(grid.getState().query.keyword).toBe('preserved');
    expect(grid.getState().selection).toEqual({ mode: 'explicit', selectedKeys: [1] });
    expect(grid.getState().data.placeholder).toBe(true);
    expect(grid.getState().data.total).toBeUndefined();
    await vi.waitFor(() => expect(secondRead).toHaveBeenCalledOnce());
    expect(grid.getState().data.rows[0]?.name).toBe('Second driver');
    expect(grid.getState().data.placeholder).toBe(false);
    expect(grid.getState().selection).toEqual({ mode: 'explicit', selectedKeys: [1] });
    grid.destroy();
  });

  it('keeps attributed controlled results as placeholders until the current request arrives', async () => {
    const requests: GridRequestQuery[] = [];
    const initialResult: GridReadResult<Row> = {
      rows: [{ id: 1, name: 'Initial' }],
      total: { value: 8, accuracy: 'exact' },
      pageInfo: { hasNext: false },
      summary: [{ id: 'count', label: 'Count', value: 8 }],
      facets: { name: [{ label: 'Initial', value: 'initial' }] },
      warnings: ['Initial warning'],
      snapshotId: 'snapshot:initial',
      meta: { request: 'initial' },
    };
    const initialSource = createControlledSource<Row>({
      datasetKey: 'tenant-a:orders',
      resultDatasetKey: 'tenant-a:orders',
      result: initialResult,
      onQueryChange: (_query, request) => requests.push(request),
    });
    const grid = createGrid({ definition, source: initialSource });

    await grid.start();
    const initialSignature = getRequestSignature(requests[0]!);
    grid.updateOptions({
      definition,
      source: { ...initialSource, resultRequestSignature: initialSignature },
    });
    expect(grid.getState().data.requestSignature).toBe(initialSignature);

    grid.query.setKeyword('new request');
    const nextSignature = getRequestSignature(requests.at(-1)!);
    expect(nextSignature).not.toBe(initialSignature);
    expect(grid.getState().data.rows).toEqual(initialResult.rows);
    expect(grid.getState().data.placeholder).toBe(true);
    expect(grid.getState().data.fetching).toBe(true);
    expect(grid.getState().data.total).toBeUndefined();
    expect(grid.getState().data.pageInfo).toBeUndefined();
    expect(grid.getState().data.summary).toEqual([]);
    expect(grid.getState().data.facets).toEqual({});
    expect(grid.getState().data.warnings).toEqual([]);
    expect(grid.getState().data.snapshotId).toBeUndefined();
    expect(grid.getState().data.meta).toBeUndefined();

    grid.updateOptions({
      definition,
      source: createControlledSource<Row>({
        datasetKey: 'tenant-a:orders',
        resultDatasetKey: 'tenant-a:orders',
        result: initialResult,
        resultRequestSignature: initialSignature,
        error: {
          value: new Error('Old request failed'),
          datasetKey: 'tenant-a:orders',
          requestSignature: initialSignature,
        },
        onQueryChange: initialSource.onQueryChange,
      }),
    });
    expect(grid.getState().data.status).toBe('success');
    expect(grid.getState().data.fetching).toBe(true);
    expect(grid.getState().data.error).toBeUndefined();

    grid.updateOptions({
      definition,
      source: createControlledSource<Row>({
        datasetKey: 'tenant-a:orders',
        resultDatasetKey: 'tenant-a:orders',
        result: initialResult,
        resultRequestSignature: initialSignature,
        error: {
          value: new Error('Other dataset failed'),
          datasetKey: 'tenant-b:orders',
          requestSignature: nextSignature,
        },
        onQueryChange: initialSource.onQueryChange,
      }),
    });
    expect(grid.getState().data.status).toBe('success');
    expect(grid.getState().data.fetching).toBe(true);
    expect(grid.getState().data.error).toBeUndefined();

    grid.updateOptions({
      definition,
      source: createControlledSource<Row>({
        datasetKey: 'tenant-a:orders',
        resultDatasetKey: 'tenant-a:orders',
        result: initialResult,
        resultRequestSignature: initialSignature,
        error: {
          value: new Error('Current request failed'),
          datasetKey: 'tenant-a:orders',
          requestSignature: nextSignature,
        },
        onQueryChange: initialSource.onQueryChange,
      }),
    });
    expect(grid.getState().data.rows).toEqual(initialResult.rows);
    expect(grid.getState().data.placeholder).toBe(true);
    expect(grid.getState().data.status).toBe('error');
    expect(grid.getState().data.fetching).toBe(false);
    expect(grid.getState().data.error?.message).toBe('Current request failed');

    grid.updateOptions({
      definition,
      source: createControlledSource<Row>({
        datasetKey: 'tenant-a:orders',
        resultDatasetKey: 'tenant-a:orders',
        resultRequestSignature: nextSignature,
        result: {
          rows: [{ id: 2, name: 'Current' }],
          total: { value: 1, accuracy: 'exact' },
          snapshotId: 'snapshot:current',
        },
        onQueryChange: initialSource.onQueryChange,
      }),
    });
    expect(grid.getState().data.rows[0]?.name).toBe('Current');
    expect(grid.getState().data.total?.value).toBe(1);
    expect(grid.getState().data.snapshotId).toBe('snapshot:current');
    expect(grid.getState().data.requestSignature).toBe(nextSignature);
    expect(grid.getState().data.placeholder).toBe(false);
    expect(grid.getState().data.fetching).toBe(false);
    grid.destroy();
  });

  it('accepts one unattributed bootstrap result but never relabels later retained or cloned results', async () => {
    const requests: GridRequestQuery[] = [];
    const previousResult: GridReadResult<Row> = {
      rows: [{ id: 1, name: 'Previous' }],
      total: { value: 12, accuracy: 'exact' },
      summary: [{ id: 'count', label: 'Count', value: 12 }],
      facets: { name: [{ label: 'Previous', value: 'previous' }] },
    };
    const onQueryChange = (_query: unknown, request: GridRequestQuery) => requests.push(request);
    const source = (
      result: GridReadResult<Row>,
      loading = false,
      resultRequestSignature?: string,
    ) =>
      createControlledSource<Row>({
        datasetKey: 'controlled-fallback',
        resultDatasetKey: 'controlled-fallback',
        result,
        loading,
        resultRequestSignature,
        onQueryChange,
      });
    const grid = createGrid({ definition, source: source(previousResult) });

    await grid.start();
    const previousSignature = grid.getState().data.requestSignature;
    grid.query.setKeyword('next');
    expect(grid.getState().data.placeholder).toBe(true);
    expect(grid.getState().data.total).toBeUndefined();

    grid.updateOptions({ definition, source: source(previousResult, true) });
    expect(grid.getState().data.rows).toBe(previousResult.rows);
    expect(grid.getState().data.requestSignature).toBe(previousSignature);
    expect(grid.getState().data.placeholder).toBe(true);
    expect(grid.getState().data.fetching).toBe(true);
    expect(grid.getState().data.total).toBeUndefined();
    expect(grid.getState().data.summary).toEqual([]);
    expect(grid.getState().data.facets).toEqual({});

    const clonedPreviousResult: GridReadResult<Row> = {
      ...previousResult,
      rows: [...previousResult.rows],
    };
    grid.updateOptions({ definition, source: source(clonedPreviousResult, true) });
    expect(grid.getState().data.rows).toBe(previousResult.rows);
    expect(grid.getState().data.requestSignature).toBe(previousSignature);
    expect(grid.getState().data.placeholder).toBe(true);
    expect(grid.getState().data.total).toBeUndefined();

    const currentResult: GridReadResult<Row> = {
      rows: [{ id: 2, name: 'Current' }],
      total: { value: 1, accuracy: 'exact' },
    };
    grid.updateOptions({ definition, source: source(currentResult) });
    expect(grid.getState().data.rows).toBe(previousResult.rows);
    expect(grid.getState().data.requestSignature).toBe(previousSignature);
    expect(grid.getState().data.placeholder).toBe(true);
    expect(grid.getState().data.total).toBeUndefined();

    const currentSignature = getRequestSignature(requests.at(-1)!);
    grid.updateOptions({ definition, source: source(currentResult, false, currentSignature) });
    expect(grid.getState().data.rows).toBe(currentResult.rows);
    expect(grid.getState().data.requestSignature).toBe(currentSignature);
    expect(grid.getState().data.placeholder).toBe(false);
    expect(grid.getState().data.total?.value).toBe(1);
    grid.destroy();
  });

  it('never accepts a retained result from another dataset even when its wrapper and request signature look current', async () => {
    const tenantAResult: GridReadResult<Row> = {
      rows: [{ id: 1, name: 'Tenant A' }],
      total: { value: 9, accuracy: 'exact' },
      snapshotId: 'tenant-a:snapshot',
    };
    const tenantASource = createControlledSource<Row>({
      datasetKey: 'tenant-a',
      resultDatasetKey: 'tenant-a',
      result: tenantAResult,
    });
    const grid = createGrid({ definition, source: tenantASource });
    const requestSignature = getRequestSignature(grid.query.compile());
    grid.updateOptions({
      definition,
      source: { ...tenantASource, resultRequestSignature: requestSignature },
    });
    await grid.start();

    grid.updateOptions({
      definition,
      source: createControlledSource<Row>({
        datasetKey: 'tenant-b',
        resultDatasetKey: 'tenant-a',
        // A new wrapper defeats reference-based stale-result detection; the
        // explicit dataset provenance must still keep these rows isolated.
        result: { ...tenantAResult, rows: [...tenantAResult.rows] },
        resultRequestSignature: requestSignature,
      }),
    });
    expect(grid.getState().data.rows).toEqual([]);
    expect(grid.getState().data.total).toBeUndefined();
    expect(grid.getState().data.snapshotId).toBeUndefined();
    expect(grid.getState().data.requestSignature).toBeUndefined();
    expect(grid.getState().data.placeholder).toBe(false);
    expect(grid.getState().data.status).toBe('loading');

    const tenantBResult: GridReadResult<Row> = {
      rows: [{ id: 1, name: 'Tenant B' }],
      total: { value: 1, accuracy: 'exact' },
      snapshotId: 'tenant-b:snapshot',
    };
    grid.updateOptions({
      definition,
      source: createControlledSource<Row>({
        datasetKey: 'tenant-b',
        resultDatasetKey: 'tenant-b',
        result: tenantBResult,
        resultRequestSignature: requestSignature,
      }),
    });
    expect(grid.getState().data.rows).toEqual(tenantBResult.rows);
    expect(grid.getState().data.total?.value).toBe(1);
    expect(grid.getState().data.snapshotId).toBe('tenant-b:snapshot');
    expect(grid.getState().data.requestSignature).toBe(requestSignature);
    expect(grid.getState().data.placeholder).toBe(false);
    grid.destroy();
  });

  it('rejects invalid source attribution identities', () => {
    expect(() =>
      createGrid({
        definition,
        source: createRemoteSource<Row>(async () => ({ rows: [] }), { driverKey: '' }),
      }),
    ).toThrow('driverKey');
    expect(() =>
      createGrid({
        definition,
        source: createControlledSource<Row>({
          result: { rows: [] as Row[] },
          resultRequestSignature: ' ',
        }),
      }),
    ).toThrow('resultRequestSignature');
    expect(() =>
      createGrid({
        definition,
        source: createControlledSource<Row>({
          datasetKey: 'tenant-a',
          result: { rows: [] as Row[] },
        } as never),
      }),
    ).toThrow('resultDatasetKey');
    expect(() =>
      createGrid({
        definition,
        source: createControlledSource<Row>({
          resultDatasetKey: 'tenant-a',
          result: { rows: [] as Row[] },
        } as never),
      }),
    ).toThrow('resultDatasetKey requires datasetKey');
    expect(() =>
      createGrid({
        definition,
        source: createControlledSource<Row>({
          result: { rows: [] as Row[] },
          error: new Error('missing provenance'),
        } as never),
      }),
    ).toThrow('provenance envelope');
    expect(() =>
      createGrid({
        definition,
        source: createControlledSource<Row>({
          result: { rows: [] as Row[] },
          error: { value: new Error('invalid signature'), requestSignature: ' ' },
        }),
      }),
    ).toThrow('error.requestSignature');
    expect(() =>
      createGrid({
        definition,
        source: createControlledSource<Row>({
          datasetKey: 'tenant-a',
          resultDatasetKey: 'tenant-a',
          result: { rows: [] as Row[] },
          error: { value: new Error('missing dataset'), requestSignature: 'request' },
        } as never),
      }),
    ).toThrow('error.datasetKey provenance');
    expect(() =>
      createGrid({
        definition,
        source: createControlledSource<Row>({
          result: { rows: [] as Row[] },
          error: {
            value: new Error('unexpected dataset'),
            requestSignature: 'request',
            datasetKey: 'tenant-a',
          },
        } as never),
      }),
    ).toThrow('error.datasetKey requires source.datasetKey');
    expect(() =>
      createGrid({
        definition,
        source: createLocalSource<Row>([], undefined, 'tenant-a'),
        stateDatasetKey: '',
      }),
    ).toThrow('stateDatasetKey');
    expect(() =>
      createGrid({
        definition,
        source: createLocalSource<Row>([]),
        stateDatasetKey: 'tenant-a',
      }),
    ).toThrow('stateDatasetKey requires source.datasetKey');
  });

  it('reloads when a hot-swapped transport callback changes the compiled request', async () => {
    const read = vi.fn(async (_input: GridReadInput<Row>): Promise<GridReadResult<Row>> => ({
      rows: [],
    }));
    const withEncoder = (
      encodeFilter: (value: string | undefined) => string | undefined,
    ): GridDefinition<Row> => ({
      id: 'hot-transport',
      revision: 1,
      rowKey: 'id',
      fields: [
        {
          id: 'name',
          title: 'Name',
          filter: true,
          transport: {
            encodeFilter: (value) => encodeFilter(typeof value === 'string' ? value : undefined),
          },
        },
      ],
    });
    const upper = withEncoder((value) => value?.toUpperCase());
    const lower = withEncoder((value) => value?.toLowerCase());
    const source = createRemoteSource<Row>(read, { datasetKey: 'hot-transport' });
    const grid = createGrid({ definition: upper, source });

    await grid.start();
    grid.query.setFilters(
      createFilterGroup('and', [createFilterCondition('name', 'equals', 'MiXeD')]),
    );
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    expect(read.mock.calls.at(-1)?.[0].request.filter).toMatchObject({
      children: [{ value: 'MIXED' }],
    });

    grid.updateOptions({ definition: lower, source });
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(3));
    expect(read.mock.calls.at(-1)?.[0].request.filter).toMatchObject({
      children: [{ value: 'mixed' }],
    });
    grid.destroy();
  });

  it('re-evaluates a local query when field execution callbacks change', async () => {
    const localRows: Row[] = [
      { id: 1, name: 'One' },
      { id: 2, name: 'Two' },
    ];
    const withSearchText = (
      searchText: (value: string, row: Row) => string,
    ): GridDefinition<Row> => ({
      id: 'hot-local-runtime',
      revision: 1,
      rowKey: 'id',
      fields: [{ id: 'name', title: 'Name', searchText }],
    });
    const source = createLocalSource(localRows);
    const first = withSearchText((_value, row) => (row.id === 1 ? 'match' : ''));
    const second = withSearchText((_value, row) => (row.id === 2 ? 'match' : ''));
    const grid = createGrid({ definition: first, source });

    await grid.start();
    grid.query.setKeyword('match');
    expect(grid.getState().data.rows.map((row) => row.id)).toEqual([1]);

    grid.updateOptions({ definition: second, source });
    expect(grid.getState().data.rows.map((row) => row.id)).toEqual([2]);
    grid.destroy();
  });
});
