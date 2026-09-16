/** App-agnostic subset of integer constraint solving: bounded integers, conditional linear rules, and one objective. */
import { z } from 'zod';

const integer = z.number().int();
const name = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,99}$/);
const termSchema = z.strictObject({ variable: name, coefficient: integer });
const expressionSchema = z.array(termSchema).max(10000);
const variableSchema = z.strictObject({
  name,
  lowerBound: integer,
  upperBound: integer,
});

export const solverModelSchema = z
  .strictObject({
    variables: z.array(variableSchema).min(1).max(10000),
    constraints: z
      .array(
        z.strictObject({
          terms: expressionSchema,
          operator: z.enum(['<=', '==', '>=']),
          rhs: integer,
          onlyEnforceIf: z
            .array(
              z.strictObject({
                variable: name,
                negated: z.boolean().default(false),
              }),
            )
            .max(100)
            .optional(),
        }),
      )
      .max(20000),
    objective: z
      .strictObject({
        direction: z.enum(['minimize', 'maximize']),
        terms: expressionSchema,
      })
      .optional(),
  })
  .superRefine((model, context) => {
    const issue = (message: string) =>
      context.addIssue({ code: 'custom', message });
    const variables = new Map(
      model.variables.map((variable) => [variable.name, variable]),
    );
    if (variables.size !== model.variables.length)
      issue('Variable names must be unique.');
    for (const variable of model.variables)
      if (variable.lowerBound > variable.upperBound)
        issue(`Invalid bounds for ${variable.name}.`);
    const abs = (value: bigint) => (value < 0n ? -value : value);
    for (const expression of [
      ...model.constraints.map((constraint) => constraint.terms),
      ...(model.objective ? [model.objective.terms] : []),
    ]) {
      let maximumMagnitude = 0n;
      const seen = new Set<string>();
      for (const term of expression) {
        const variable = variables.get(term.variable);
        if (!variable) {
          issue(`Unknown variable ${term.variable}.`);
          continue;
        }
        if (seen.has(term.variable))
          issue(`Repeated term ${term.variable}; combine its coefficients.`);
        seen.add(term.variable);
        const lower = abs(BigInt(variable.lowerBound));
        const upper = abs(BigInt(variable.upperBound));
        maximumMagnitude +=
          abs(BigInt(term.coefficient)) * (lower > upper ? lower : upper);
      }
      if (maximumMagnitude > BigInt(Number.MAX_SAFE_INTEGER))
        issue('Expression can exceed exact JavaScript integer range.');
    }
    for (const constraint of model.constraints)
      for (const literal of constraint.onlyEnforceIf ?? []) {
        const variable = variables.get(literal.variable);
        if (!variable || variable.lowerBound < 0 || variable.upperBound > 1)
          issue(
            `Enforcement variable ${literal.variable} must have a Boolean domain.`,
          );
      }
  });

export const solveOptionsSchema = z.strictObject({
  maxTimeSeconds: z.number().positive().max(60).default(5),
  randomSeed: z.number().int().min(0).max(2147483647).default(0),
});

const statistics = { wallTimeSeconds: z.number().nonnegative().finite() };
export const solveResultSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('optimal'),
    values: z.record(z.string(), integer),
    objectiveValue: integer.nullable(),
    bestObjectiveBound: z.number().finite().nullable(),
    ...statistics,
  }),
  z.strictObject({
    status: z.literal('feasible'),
    values: z.record(z.string(), integer),
    objectiveValue: integer.nullable(),
    bestObjectiveBound: z.number().finite().nullable(),
    ...statistics,
  }),
  z.strictObject({ status: z.literal('infeasible'), ...statistics }),
  z.strictObject({ status: z.literal('unknown'), ...statistics }),
  z.strictObject({ status: z.literal('model_invalid'), ...statistics }),
]);

export type SolverModel = z.input<typeof solverModelSchema>;
export type ParsedSolverModel = z.output<typeof solverModelSchema>;
export type SolveOptions = z.input<typeof solveOptionsSchema> & {
  signal?: AbortSignal;
};
export type SolveResult = z.infer<typeof solveResultSchema>;
