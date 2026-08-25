import type { GridOption, GridResolvedField } from '../core';
import { gridNodeText, safeGridText } from './render';

function readFieldProperty(value: unknown, property: string | undefined): unknown {
  if (!property || !value || typeof value !== 'object') return undefined;
  try {
    return (value as Record<string, unknown>)[property];
  } catch {
    return undefined;
  }
}

/** Resolves the semantic identity used by cells, editors and filter surfaces. */
export function getGridFieldValueIdentity<Row extends object>(
  value: unknown,
  field: GridResolvedField<Row>,
): unknown {
  if (value == null || typeof value !== 'object') return value;
  try {
    const identity = field.getIdentity?.(value as never);
    if (identity !== undefined) return identity;
  } catch {
    // Partial values can be outside a domain-specific resolver's accepted shape.
  }

  const relationIdentity = readFieldProperty(value, field.relation?.keyField);
  if (relationIdentity !== undefined) return relationIdentity;

  return (
    readFieldProperty(value, 'value') ??
    readFieldProperty(value, 'id') ??
    readFieldProperty(value, 'key') ??
    value
  );
}

export function gridFieldValueIdentityEquals<Row extends object>(
  left: unknown,
  right: unknown,
  field: GridResolvedField<Row>,
): boolean {
  if (Object.is(left, right)) return true;
  return Object.is(getGridFieldValueIdentity(left, field), getGridFieldValueIdentity(right, field));
}

export function findGridFieldOption<Row extends object>(
  value: unknown,
  options: readonly GridOption[] | undefined,
  field: GridResolvedField<Row>,
): GridOption | undefined {
  return options?.find((option) => gridFieldValueIdentityEquals(option.value, value, field));
}

/** Returns a declared relation label without silently replacing an intentionally empty value. */
export function getGridRelationValueLabel<Row extends object>(
  value: unknown,
  field: GridResolvedField<Row>,
): unknown {
  return readFieldProperty(value, field.relation?.labelField);
}

export function getGridFieldFallbackLabel<Row extends object>(
  value: unknown,
  field: GridResolvedField<Row>,
): string {
  if (value == null) return '';
  if (typeof value !== 'object') return safeGridText(value);

  return safeGridText(
    readFieldProperty(value, 'label') ??
      readFieldProperty(value, 'name') ??
      readFieldProperty(value, 'title') ??
      getGridFieldValueIdentity(value, field) ??
      value,
  );
}

/**
 * Resolves a display label using the same precedence everywhere:
 * declared relation label, matching option label, semantic value fallback.
 */
export function resolveGridFieldValueLabel<Row extends object>(
  value: unknown,
  options: readonly GridOption[] | undefined,
  field: GridResolvedField<Row>,
): unknown {
  const relationLabel = getGridRelationValueLabel(value, field);
  if (relationLabel !== undefined && relationLabel !== null) return relationLabel;
  const option = findGridFieldOption(value, options, field);
  if (option) return option.label;
  return getGridFieldFallbackLabel(value, field);
}

export function getGridFieldValueText<Row extends object>(
  value: unknown,
  options: readonly GridOption[] | undefined,
  field: GridResolvedField<Row>,
): string {
  const label = resolveGridFieldValueLabel(value, options, field);
  const text = gridNodeText(label);
  if (text || label === '') return text;
  if (label != null && typeof label !== 'object') return safeGridText(label);
  return getGridFieldFallbackLabel(value, field);
}

export function getGridFieldValuesText<Row extends object>(
  value: unknown,
  options: readonly GridOption[] | undefined,
  field: GridResolvedField<Row>,
): string {
  const values = Array.isArray(value) ? value : [value];
  return values.map((item) => getGridFieldValueText(item, options, field)).join(', ');
}
