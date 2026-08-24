import { describe, expect, it } from 'vitest';
import {
  createControlledSource,
  createRemoteSource,
  normalizeGridOptions,
  normalizeGridResult,
  resolveGridCapabilities,
} from '../src/core';

describe('grid result protocol', () => {
  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5])(
    'rejects invalid total value %s',
    (value) => {
      expect(() => normalizeGridResult({ rows: [], total: { value } })).toThrow(/total/);
    },
  );

  it('rejects malformed rows rather than converting them to an empty result', () => {
    expect(() => normalizeGridResult({ rows: null } as never)).toThrow(
      'Grid result rows must be an array',
    );
  });

  it.each([
    [{ rows: [], pageInfo: 'next' }, 'pageInfo'],
    [{ rows: [], summary: {} }, 'summary'],
    [{ rows: [], warnings: 'warning' }, 'warnings'],
    [{ rows: [], facets: [] }, 'facets'],
    [{ rows: [], facets: { status: {} } }, 'facet "status"'],
  ])('rejects malformed optional result sections', (result, message) => {
    expect(() => normalizeGridResult(result as never)).toThrow(message as string);
  });

  it.each([
    [{ rows: [], summary: [null] }, 'summary item 0'],
    [{ rows: [], summary: [{ id: '', label: 'Total', value: 1 }] }, 'non-empty id'],
    [
      {
        rows: [],
        summary: [
          { id: 'total', label: 'Total', value: 1 },
          { id: 'total', label: 'Again', value: 2 },
        ],
      },
      'Duplicate grid summary id',
    ],
    [
      { rows: [], summary: [{ id: 'total', label: 'Total', value: 1, scope: 'unknown' }] },
      'invalid scope',
    ],
    [{ rows: [], facets: { status: [null] } }, 'option 0 must be an object'],
    [{ rows: [], facets: { status: [{ label: 'Invalid', value: Number.NaN }] } }, 'invalid value'],
    [
      {
        rows: [],
        facets: {
          status: [
            { label: 'First', value: 'same' },
            { label: 'Second', value: 'same' },
          ],
        },
      },
      'duplicate option values',
    ],
    [{ rows: [], warnings: [null] }, 'warnings cannot contain null'],
    [{ rows: [], snapshotId: '' }, 'snapshotId must be a non-empty string'],
    [{ rows: [], meta: [] }, 'meta must be an object'],
  ])('deeply rejects malformed result content', (result, message) => {
    expect(() => normalizeGridResult(result as never)).toThrow(message as string);
  });

  it('accepts well-formed summary, facets, snapshot and metadata', () => {
    const result = normalizeGridResult({
      rows: [],
      summary: [{ id: 'total', label: 'Total', value: null, scope: 'query' }],
      facets: { status: [{ label: 'Active', value: 'active', disabled: false }] },
      warnings: ['Estimated'],
      snapshotId: 'snapshot-1',
      meta: { traceId: 'trace-1' },
    });
    expect(result.summary?.[0]?.value).toBeNull();
    expect(result.facets?.status?.[0]?.value).toBe('active');
  });

  it('normalizes cursor presence and rejects inconsistent cursor page info', () => {
    const pagination = { type: 'cursor', pageSize: 20 } as const;
    expect(
      normalizeGridResult({ rows: [], pageInfo: { nextCursor: 'next' } }, pagination).pageInfo,
    ).toEqual({ nextCursor: 'next', hasNext: true });
    expect(() =>
      normalizeGridResult({ rows: [], pageInfo: { hasNext: true } }, pagination),
    ).toThrow('requires nextCursor');
    expect(() =>
      normalizeGridResult(
        { rows: [], pageInfo: { hasNext: false, nextCursor: 'unexpected' } },
        pagination,
      ),
    ).toThrow('cannot provide nextCursor');
  });

  it('rejects nullable or duplicate options before they reach adapters', () => {
    expect(() => normalizeGridOptions([{ label: 'None', value: null }])).toThrow('invalid value');
    expect(() =>
      normalizeGridOptions([
        { label: 'One', value: 1 },
        { label: 'Again', value: 1 },
      ]),
    ).toThrow('duplicate option values');
    expect(normalizeGridOptions([{ label: 'False', value: false }])[0]?.value).toBe(false);
  });

  it('validates source contracts and cache policy at runtime', () => {
    expect(() =>
      resolveGridCapabilities(
        createRemoteSource(async () => ({ rows: [] }), {
          datasetKey: '',
        }),
      ),
    ).toThrow('datasetKey');
    expect(() =>
      resolveGridCapabilities(
        createRemoteSource(async () => ({ rows: [] }), {
          policy: { maxCacheEntries: 0 },
        }),
      ),
    ).toThrow('maxCacheEntries');
    expect(() =>
      resolveGridCapabilities(createControlledSource({ result: null as never })),
    ).toThrow('result object');
  });

  it('checks page size, lower-bound totals and exact offset page information', () => {
    const pagination = { type: 'offset', page: 2, pageSize: 2 } as const;
    expect(() =>
      normalizeGridResult({ rows: [{ id: 1 }, { id: 2 }, { id: 3 }] }, pagination),
    ).toThrow('pageSize');
    expect(() =>
      normalizeGridResult(
        { rows: [{ id: 3 }], total: { value: 1, accuracy: 'atLeast' } },
        pagination,
      ),
    ).toThrow('rows already observed');
    expect(() =>
      normalizeGridResult(
        {
          rows: [{ id: 3 }],
          total: { value: 3, accuracy: 'exact' },
          pageInfo: { hasPrevious: false, hasNext: false },
        },
        pagination,
      ),
    ).toThrow('hasPrevious');
  });
});
