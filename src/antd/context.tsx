import { createContext, useContext } from 'react';
import type { GridUiConfig } from './types';

const GridUiContext = createContext<GridUiConfig<any>>({});

export interface GridUiProviderProps<Row extends object> {
  value: GridUiConfig<Row>;
  children: React.ReactNode;
}

export function GridUiProvider<Row extends object>({ value, children }: GridUiProviderProps<Row>) {
  return <GridUiContext.Provider value={value}>{children}</GridUiContext.Provider>;
}

export function useGridUi<Row extends object>(): GridUiConfig<Row> {
  return useContext(GridUiContext) as GridUiConfig<Row>;
}
