/**
 * Compiles pattern counts, stock selection, and conditional remnant-tail waste
 * into linear integer constraints. Length and area coefficients are reduced by
 * exact common factors before crossing the solver's safe-integer boundary.
 */
import type { CuttingContext } from '@roller-bay/shared/allocations';
import type { SolverModel } from '../../../solver/solver.contracts.js';
import { toLengthUnits } from '../cutting-plan/cutting-dimensions.js';
import type {
  PatternAssignment,
  PatternCandidates,
} from './pattern-generation.js';
import { CuttingOptimizationError } from './optimization.errors.js';

type Terms = NonNullable<SolverModel['objective']>['terms'];
type BigTerm = { variable: string; coefficient: bigint };
type Rule = SolverModel['constraints'][number];

export interface ModeledAssignment extends PatternAssignment {
  variable: string;
}
export interface CuttingModel {
  model: SolverModel;
  assignments: ModeledAssignment[];
  objectives: readonly [Terms, Terms, Terms, Terms];
  wasteUnit: bigint;
  complete: boolean;
}

const abs = (value: bigint) => (value < 0n ? -value : value);
function gcd(a: bigint, b: bigint): bigint {
  a = abs(a);
  b = abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
}
function safe(value: bigint): number {
  if (abs(value) > BigInt(Number.MAX_SAFE_INTEGER))
    throw new CuttingOptimizationError(
      'numeric_range',
      'Cutting model exceeds exact solver integer range.',
    );
  return Number(value);
}

class ModelLimit extends Error {}

class LinearModel {
  readonly model: SolverModel = { variables: [], constraints: [] };
  private readonly upperBounds = new Map<string, bigint>();

  variable(name: string, maximum: bigint): string {
    if (this.model.variables.length >= 10000) throw new ModelLimit();
    this.model.variables.push({
      name,
      lowerBound: 0,
      upperBound: safe(maximum),
    });
    this.upperBounds.set(name, maximum);
    return name;
  }

  terms(terms: BigTerm[], divisor = 1n): Terms {
    const result = terms
      .filter((term) => term.coefficient !== 0n)
      .map((term) => ({
        variable: term.variable,
        coefficient: safe(term.coefficient / divisor),
      }));
    // Individually safe coefficients can still produce an unsafe expression sum.
    safe(
      result.reduce(
        (sum, term) =>
          sum +
          abs(BigInt(term.coefficient)) * this.upperBounds.get(term.variable)!,
        0n,
      ),
    );
    return result;
  }

  rule(
    terms: BigTerm[],
    operator: Rule['operator'],
    rhs: bigint,
    onlyEnforceIf?: Rule['onlyEnforceIf'],
  ): void {
    if (this.model.constraints.length >= 20000) throw new ModelLimit();
    const divisor =
      terms.reduce((value, term) => gcd(value, term.coefficient), abs(rhs)) ||
      1n;
    this.model.constraints.push({
      terms: this.terms(terms, divisor),
      operator,
      rhs: safe(rhs / divisor),
      ...(onlyEnforceIf ? { onlyEnforceIf } : {}),
    });
  }
}

function compile(
  context: CuttingContext,
  candidates: PatternCandidates,
): CuttingModel {
  const builder = new LinearModel();
  const assignments = candidates.assignments.map(
    (assignment, i): ModeledAssignment => ({
      ...assignment,
      variable: builder.variable(`x${i}`, BigInt(assignment.maximum)),
    }),
  );
  for (const requirement of context.requirements) {
    const terms = assignments.flatMap((assignment) => {
      const item = assignment.pattern.items.find(
        (item) => item.requirement.id === requirement.id,
      );
      return item
        ? [
            {
              variable: assignment.variable,
              coefficient: BigInt(item.quantity),
            },
          ]
        : [];
    });
    builder.rule(terms, '==', BigInt(requirement.quantity));
  }
  const stockGroups = new Map<string, ModeledAssignment[]>();
  for (const assignment of assignments) {
    const group = stockGroups.get(assignment.stock.id) ?? [];
    group.push(assignment);
    stockGroups.set(assignment.stock.id, group);
  }
  const waste: BigTerm[] = assignments.map((assignment) => ({
    variable: assignment.variable,
    coefficient: assignment.pattern.waste,
  }));
  const opened: BigTerm[] = [];
  const selected: BigTerm[] = [];
  const minWidth = toLengthUnits(context.settings.minimumRemnantWidthMm);
  const minLength = toLengthUnits(context.settings.minimumRemnantLengthMm);
  for (const [index, group] of [...stockGroups.values()].entries()) {
    const stock = group[0]!.stock;
    const used = builder.variable(`s${index}`, 1n);
    selected.push({ variable: used, coefficient: 1n });
    if (!stock.isRemnant && !stock.isUsed)
      opened.push({ variable: used, coefficient: 1n });
    const counts = group.map((item) => ({
      variable: item.variable,
      coefficient: 1n,
    }));
    // Stock is selected exactly when at least one of its patterns is cut.
    builder.rule([...counts, { variable: used, coefficient: -1n }], '>=', 0n);
    builder.rule([...counts, { variable: used, coefficient: -100n }], '<=', 0n);
    const available =
      toLengthUnits(stock.remainingLengthMm) -
      toLengthUnits(stock.reservedLengthMm);
    const lengthUnit = group.reduce(
      (unit, item) => gcd(unit, item.pattern.length),
      available,
    );
    const capacity = available / lengthUnit;
    const lengths = group.map((item) => ({
      variable: item.variable,
      coefficient: item.pattern.length / lengthUnit,
    }));
    if (!stock.isRemnant) {
      builder.rule(lengths, '<=', capacity);
      continue;
    }
    // Unselected remnants have zero modeled tail; selected ones account for the whole piece.
    const tail = builder.variable(`t${index}`, capacity);
    builder.rule(
      [
        ...lengths,
        { variable: tail, coefficient: 1n },
        { variable: used, coefficient: -capacity },
      ],
      '==',
      0n,
    );
    let discarded = tail;
    if (toLengthUnits(stock.widthMm) >= minWidth && available >= minLength) {
      const reusable = builder.variable(`r${index}`, 1n);
      discarded = builder.variable(`w${index}`, capacity);
      // Round the threshold upward in scaled integer units so equality remains
      // reusable without admitting a tail below the physical minimum.
      const threshold = (minLength + lengthUnit - 1n) / lengthUnit;
      builder.rule(
        [
          { variable: reusable, coefficient: 1n },
          { variable: used, coefficient: -1n },
        ],
        '<=',
        0n,
      );
      builder.rule([{ variable: tail, coefficient: 1n }], '>=', threshold, [
        { variable: reusable },
      ]);
      builder.rule(
        [{ variable: tail, coefficient: 1n }],
        '<=',
        threshold - 1n,
        [{ variable: used }, { variable: reusable, negated: true }],
      );
      builder.rule([{ variable: discarded, coefficient: 1n }], '==', 0n, [
        { variable: reusable },
      ]);
      builder.rule(
        [
          { variable: discarded, coefficient: 1n },
          { variable: tail, coefficient: -1n },
        ],
        '==',
        0n,
        [{ variable: reusable, negated: true }],
      );
    }
    waste.push({
      variable: discarded,
      coefficient: toLengthUnits(stock.widthMm) * lengthUnit,
    });
  }
  const wasteUnit =
    waste.reduce((unit, item) => gcd(unit, item.coefficient), 0n) || 1n;
  const objectives: CuttingModel['objectives'] = [
    builder.terms(waste, wasteUnit),
    builder.terms(opened),
    builder.terms(
      assignments.map((item) => ({ variable: item.variable, coefficient: 1n })),
    ),
    builder.terms(selected),
  ];
  return {
    model: builder.model,
    assignments,
    objectives,
    wasteUnit,
    complete: candidates.complete,
  };
}

export function buildCuttingModel(
  context: CuttingContext,
  candidates: PatternCandidates,
): CuttingModel | null {
  if (!candidates.assignments.length) return null;
  try {
    return compile(context, candidates);
  } catch (error) {
    if (error instanceof ModelLimit) return null;
    throw error;
  }
}

export function modelFitsTransport(
  model: SolverModel,
  maxTimeSeconds: number,
): boolean {
  return (
    model.variables.length <= 10000 &&
    model.constraints.length <= 20000 &&
    Buffer.byteLength(
      JSON.stringify({ model, options: { maxTimeSeconds, randomSeed: 0 } }),
    ) <=
      4 * 1024 * 1024
  );
}
