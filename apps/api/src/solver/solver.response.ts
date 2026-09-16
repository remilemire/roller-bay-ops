/** Checks the worker protocol and verifies any incumbent against the submitted model. */
import {
  solveResultSchema,
  type SolveResult,
  type ParsedSolverModel,
} from './solver.contracts.js';
import { SolverError } from './solver.errors.js';

export function parseSolverResult(
  raw: string,
  model: ParsedSolverModel,
): SolveResult {
  let result: SolveResult;
  try {
    result = solveResultSchema.parse(JSON.parse(raw));
  } catch {
    throw new SolverError('protocol_error', 'Invalid Solver response.');
  }
  if (result.status !== 'optimal' && result.status !== 'feasible')
    return result;
  const fail = () => {
    throw new SolverError(
      'protocol_error',
      'Solver returned an inconsistent solution.',
    );
  };
  if (Object.keys(result.values).length !== model.variables.length) fail();
  for (const variable of model.variables) {
    const value = result.values[variable.name];
    if (
      !Object.hasOwn(result.values, variable.name) ||
      value === undefined ||
      value < variable.lowerBound ||
      value > variable.upperBound
    )
      fail();
  }
  const values = result.values;
  // Verify with exact arithmetic; a well-formed response can still violate the
  // submitted model, independently of the domain validator's later checks.
  const evaluate = (terms: ParsedSolverModel['constraints'][number]['terms']) =>
    terms.reduce(
      (sum, term) =>
        sum + BigInt(term.coefficient) * BigInt(values[term.variable]!),
      0n,
    );
  for (const constraint of model.constraints) {
    if (
      !(constraint.onlyEnforceIf ?? []).every(
        (literal) => values[literal.variable] === (literal.negated ? 0 : 1),
      )
    )
      continue;
    const actual = evaluate(constraint.terms);
    const rhs = BigInt(constraint.rhs);
    if (
      constraint.operator === '=='
        ? actual !== rhs
        : constraint.operator === '<='
          ? actual > rhs
          : actual < rhs
    )
      fail();
  }
  if (model.objective) {
    if (
      result.objectiveValue === null ||
      result.bestObjectiveBound === null ||
      evaluate(model.objective.terms) !== BigInt(result.objectiveValue)
    )
      fail();
  } else if (
    result.objectiveValue !== null ||
    result.bestObjectiveBound !== null
  )
    fail();
  return result;
}
