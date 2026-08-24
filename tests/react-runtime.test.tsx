import { useLayoutEffect, useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  createControlledSource,
  createGrid,
  createLocalSource,
  type GridDefinition,
  type GridInstance,
} from '../src/core';
import { GridProvider, useGrid, useGridInstance } from '../src/react';

interface Row {
  id: number;
  name: string;
  secret?: string;
}

const localRows = [{ id: 1, name: 'One' }];
const localSource = createLocalSource(localRows);
const capabilityResult = { rows: localRows };
const capabilityDefinition: GridDefinition<Row> = {
  id: 'react-runtime-capability',
  rowKey: 'id',
  fields: [{ id: 'name', title: 'Name' }],
};

function RuntimeActionLabel() {
  const instance = useGridInstance<Row>();
  return <span>{String(instance.definition.actions?.[0]?.label)}</span>;
}

function DefinitionHarness() {
  const [second, setSecond] = useState(false);
  const definition: GridDefinition<Row> = {
    id: 'react-runtime-definition',
    revision: 1,
    rowKey: 'id',
    fields: [{ id: 'name', title: 'Name' }],
    actions: [
      {
        id: 'runtime',
        label: second ? 'Second runtime' : 'First runtime',
        run: () => undefined,
      },
    ],
  };
  const instance = useGrid({ definition, source: localSource });
  return (
    <>
      <button type="button" onClick={() => setSecond(true)}>
        Replace runtime
      </button>
      <GridProvider value={instance}>
        <RuntimeActionLabel />
      </GridProvider>
    </>
  );
}

function ProjectionRequirement() {
  const instance = useGridInstance<Row>();
  useLayoutEffect(() => instance.projection.register(['secret']), [instance]);
  return null;
}

function RequestProjection() {
  const instance = useGridInstance<Row>();
  return (
    <span data-testid="request-projection">
      {instance.actions.getContext().request.select?.join(',') || 'none'}
    </span>
  );
}

function ProjectionHarness({ instance }: { instance: GridInstance<Row> }) {
  const [required, setRequired] = useState(true);
  return (
    <GridProvider value={instance}>
      <button type="button" onClick={() => setRequired(false)}>
        Remove requirement
      </button>
      <RequestProjection />
      {required && <ProjectionRequirement />}
    </GridProvider>
  );
}

function CapabilityValue() {
  const instance = useGridInstance<Row>();
  return <span>{instance.capabilities.projection ? 'projection-on' : 'projection-off'}</span>;
}

function CapabilityHarness() {
  const [projection, setProjection] = useState(false);
  const instance = useGrid({
    definition: capabilityDefinition,
    source: createControlledSource({
      datasetKey: 'same-result',
      result: capabilityResult,
      capabilities: { projection },
    }),
  });
  return (
    <>
      <button type="button" onClick={() => setProjection(true)}>
        Enable projection
      </button>
      <GridProvider value={instance}>
        <CapabilityValue />
      </GridProvider>
    </>
  );
}

describe('React grid runtime updates', () => {
  it('rerenders consumers after a same-revision definition runtime replacement', async () => {
    render(<DefinitionHarness />);
    expect(screen.getByText('First runtime')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Replace runtime' }));
    expect(await screen.findByText('Second runtime')).toBeInTheDocument();
  });

  it('observes projection requirement registration and cleanup without a data commit', async () => {
    const definition: GridDefinition<Row> = {
      id: 'react-runtime-projection',
      rowKey: 'id',
      fields: [
        { id: 'name', title: 'Name' },
        { id: 'secret', title: 'Secret', column: false },
      ],
    };
    const instance = createGrid<Row>({
      definition,
      source: createControlledSource({
        result: { rows: [{ id: 1, name: 'One', secret: 'S' }] },
        capabilities: { projection: true },
      }),
    });
    const rendered = render(<ProjectionHarness instance={instance} />);
    await waitFor(() =>
      expect(screen.getByTestId('request-projection')).toHaveTextContent('secret'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove requirement' }));
    await waitFor(() =>
      expect(screen.getByTestId('request-projection')).not.toHaveTextContent('secret'),
    );
    rendered.unmount();
    instance.destroy();
  });

  it('rerenders when controlled source capabilities change with no result commit', async () => {
    render(<CapabilityHarness />);
    expect(screen.getByText('projection-off')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Enable projection' }));
    expect(await screen.findByText('projection-on')).toBeInTheDocument();
  });
});
