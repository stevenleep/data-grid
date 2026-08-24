import {
  Component,
  Fragment,
  isValidElement,
  type ErrorInfo,
  type ReactNode,
  type ReactPortal,
} from 'react';

function isReactPortal(value: unknown): value is ReactPortal {
  return Boolean(
    value &&
    typeof value === 'object' &&
    (value as { $$typeof?: symbol }).$$typeof === Symbol.for('react.portal'),
  );
}

function stringifyGridNode(value: object): string {
  try {
    if (value instanceof Date)
      return Number.isNaN(value.valueOf()) ? String(value) : value.toISOString();
    const serialized = JSON.stringify(value);
    if (serialized !== undefined) return serialized;
  } catch {
    // Fall through to a primitive-safe representation.
  }
  try {
    return String(value);
  } catch {
    return '[Unrenderable value]';
  }
}

export function safeGridText(value: unknown, fallback = ''): string {
  if (value == null) return fallback;
  if (typeof value === 'object') return stringifyGridNode(value);
  try {
    return String(value);
  } catch {
    return fallback;
  }
}

/** Converts protocol-level `unknown` nodes into values React can always render safely. */
export function renderGridNode(value: unknown): ReactNode {
  if (value == null || typeof value === 'boolean') return value;
  if (typeof value === 'string' || typeof value === 'number') return value;
  if (typeof value === 'bigint' || typeof value === 'symbol' || typeof value === 'function') {
    return String(value);
  }
  if (isValidElement(value) || isReactPortal(value)) return value;
  if (Array.isArray(value)) {
    return value.map((item, index) => <Fragment key={index}>{renderGridNode(item)}</Fragment>);
  }
  return stringifyGridNode(value as object);
}

export function gridNodeText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    return String(value);
  }
  if (isValidElement(value) || isReactPortal(value)) return '';
  if (Array.isArray(value)) return value.map(gridNodeText).filter(Boolean).join(' ');
  return stringifyGridNode(value as object);
}

export interface GridRenderErrorBoundaryProps {
  children: ReactNode;
  resetKey?: unknown;
  fallback: ReactNode | ((error: Error) => ReactNode);
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface GridRenderErrorBoundaryState {
  error?: Error;
}

/** Isolates client-side renderer failures. React does not support error boundaries during SSR. */
export class GridRenderErrorBoundary extends Component<
  GridRenderErrorBoundaryProps,
  GridRenderErrorBoundaryState
> {
  state: GridRenderErrorBoundaryState = {};

  static getDerivedStateFromError(error: unknown): GridRenderErrorBoundaryState {
    return {
      error: error instanceof Error ? error : new Error(safeGridText(error, 'Render failed')),
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.props.onError?.(error, info);
  }

  componentDidUpdate(previous: GridRenderErrorBoundaryProps) {
    if (this.state.error && previous.resetKey !== this.props.resetKey) {
      this.setState({ error: undefined });
    }
  }

  render() {
    const { error } = this.state;
    if (error) {
      return typeof this.props.fallback === 'function'
        ? this.props.fallback(error)
        : this.props.fallback;
    }
    return this.props.children;
  }
}
