import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  DataGrid,
  GridFilterPanel,
  createFilterCondition,
  createFilterGroup,
  createLocalSource,
  type GridDefinition,
  type GridFilterGroup,
} from '../src';

interface Row {
  id: string;
  code: string;
}

describe('custom filter operator value kinds', () => {
  it('passes resolved valueKind to custom editors and prunes with the same protocol', () => {
    const onApply = vi.fn<(filters: GridFilterGroup) => void>();
    const filters = createFilterGroup('and', [
      createFilterCondition('code', 'isAssigned'),
      createFilterCondition('code', 'oneOfCodes'),
    ]);
    const definition: GridDefinition<Row> = {
      id: 'filter-value-kind-ui',
      rowKey: 'id',
      valueTypes: {
        code: {
          operators: ['isAssigned', 'oneOfCodes'],
          operatorValueKinds: { isAssigned: 'none', oneOfCodes: 'multiple' },
        },
      },
      fields: [
        {
          id: 'code',
          title: 'Code',
          valueType: 'code',
          filter: true,
          filterEditor: ({ valueKind }) => `kind:${valueKind}`,
        },
      ],
    };

    render(
      <DataGrid<Row> definition={definition} source={createLocalSource([{ id: '1', code: 'A' }])}>
        {() => (
          <GridFilterPanel<Row> value={filters} onChange={() => undefined} onApply={onApply} />
        )}
      </DataGrid>,
    );

    expect(screen.getByText('kind:multiple')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /应\s*用/ }));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0]?.[0].children).toHaveLength(1);
    expect(onApply.mock.calls[0]?.[0].children[0]).toMatchObject({ operator: 'isAssigned' });
  });
});
