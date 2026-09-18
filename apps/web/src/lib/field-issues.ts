/**
 * Places validation issues beside the form fields that fix them. Each form
 * supplies the mapping from an issue to its own field name; issues it cannot
 * place stay in the form's ErrorNotice through the same mapping.
 */
import type { FieldPath, FieldValues, UseFormReturn } from 'react-hook-form';
import type { ErrorIssue } from '@roller-bay/shared/errors';
import { describeFieldIssue, errorIssues } from './errors';

/** The first message for every field that `fieldName` can place. */
export function fieldIssues<Name extends string>(
  source: unknown,
  fieldName: (issue: ErrorIssue) => Name | null,
): Partial<Record<Name, string>> {
  const issues = Array.isArray(source)
    ? (source as ErrorIssue[])
    : errorIssues(source);
  const placed: Partial<Record<Name, string>> = {};
  for (const issue of issues) {
    const name = fieldName(issue);
    if (name && !(name in placed)) placed[name] = describeFieldIssue(issue);
  }
  return placed;
}

/** Replaces a React Hook Form's errors with the issues it can place. */
export function showFieldIssues<Form extends FieldValues>(
  form: UseFormReturn<Form>,
  source: unknown,
  fieldName: (issue: ErrorIssue) => FieldPath<Form> | null,
) {
  form.clearErrors();
  const placed = fieldIssues(source, fieldName);
  for (const name of Object.keys(placed) as FieldPath<Form>[])
    form.setError(name, { message: placed[name] });
}
