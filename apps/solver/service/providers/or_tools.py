"""Maps the generic solver contract to OR-Tools CP-SAT and normalizes its results."""

from ortools.sat.python import cp_model

from service.contracts import (
    NoSolutionResult,
    SolutionResult,
    SolveRequest,
    SolveResult,
    Term,
)
from service.providers.base import SolverProvider


class OrToolsProvider(SolverProvider):
    def solve(self, request: SolveRequest) -> SolveResult:
        source = request.model
        model = cp_model.CpModel()
        variables = {
            item.name: model.new_int_var(item.lower_bound, item.upper_bound, item.name)
            for item in source.variables
        }

        def expression(terms: list[Term]):
            return sum(term.coefficient * variables[term.variable] for term in terms)

        for rule in source.constraints:
            expr = expression(rule.terms)
            if rule.operator == "<=":
                constraint = model.add(expr <= rule.rhs)
            elif rule.operator == ">=":
                constraint = model.add(expr >= rule.rhs)
            else:
                constraint = model.add(expr == rule.rhs)
            for literal in rule.only_enforce_if:
                variable = variables[literal.variable]
                constraint.only_enforce_if(~variable if literal.negated else variable)

        objective = source.objective
        if objective:
            if objective.direction == "minimize":
                model.minimize(expression(objective.terms))
            else:
                model.maximize(expression(objective.terms))

        if model.validate():
            return NoSolutionResult(status="model_invalid", wall_time_seconds=0)
        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = request.options.max_time_seconds
        solver.parameters.random_seed = request.options.random_seed
        # A single search worker avoids parallel race-dependent search ordering.
        solver.parameters.num_search_workers = 1
        solver.parameters.log_search_progress = False
        status = solver.solve(model)
        if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            values = {
                name: solver.value(variable) for name, variable in variables.items()
            }
            # Recompute the objective from integer values; the solver's reported
            # objective is floating point and is not the exact wire representation.
            return SolutionResult(
                status="optimal" if status == cp_model.OPTIMAL else "feasible",
                values=values,
                objective_value=sum(
                    term.coefficient * values[term.variable] for term in objective.terms
                )
                if objective
                else None,
                best_objective_bound=solver.best_objective_bound if objective else None,
                wall_time_seconds=solver.wall_time,
            )
        names = {
            cp_model.INFEASIBLE: "infeasible",
            cp_model.UNKNOWN: "unknown",
            cp_model.MODEL_INVALID: "model_invalid",
        }
        return NoSolutionResult(
            status=names[status], wall_time_seconds=solver.wall_time
        )
