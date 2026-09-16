"""Strict, app-agnostic wire model; mirrors the backend's integer constraint solving contract."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic.alias_generators import to_camel

SAFE = 2**53 - 1
Integer = Annotated[int, Field(strict=True, ge=-SAFE, le=SAFE)]
Name = Annotated[str, Field(pattern=r"^[A-Za-z][A-Za-z0-9_]{0,99}$")]


class StrictModel(BaseModel):
    model_config = ConfigDict(
        extra="forbid", alias_generator=to_camel, validate_by_name=True
    )


class Variable(StrictModel):
    name: Name
    lower_bound: Integer
    upper_bound: Integer


class Term(StrictModel):
    variable: Name
    coefficient: Integer


class LiteralCondition(StrictModel):
    variable: Name
    negated: Annotated[bool, Field(strict=True)] = False


class Constraint(StrictModel):
    terms: list[Term] = Field(max_length=10000)
    operator: Literal["<=", "==", ">="]
    rhs: Integer
    only_enforce_if: list[LiteralCondition] = Field(
        default_factory=list, max_length=100
    )


class Objective(StrictModel):
    direction: Literal["minimize", "maximize"]
    terms: list[Term] = Field(max_length=10000)


class SolverModel(StrictModel):
    variables: list[Variable] = Field(min_length=1, max_length=10000)
    constraints: list[Constraint] = Field(max_length=20000)
    objective: Objective | None = None

    @model_validator(mode="after")
    def validate_model(self):
        variables = {item.name: item for item in self.variables}
        if len(variables) != len(self.variables):
            raise ValueError("Variable names must be unique")
        if any(item.lower_bound > item.upper_bound for item in self.variables):
            raise ValueError("Invalid variable bounds")
        expressions = [item.terms for item in self.constraints]
        if self.objective:
            expressions.append(self.objective.terms)
        for terms in expressions:
            seen = set()
            magnitude = 0
            for term in terms:
                if term.variable not in variables or term.variable in seen:
                    raise ValueError("Unknown or repeated expression variable")
                seen.add(term.variable)
                variable = variables[term.variable]
                magnitude += abs(term.coefficient) * max(
                    abs(variable.lower_bound), abs(variable.upper_bound)
                )
            if magnitude > SAFE:
                raise ValueError("Expression exceeds safe integer range")
        for rule in self.constraints:
            for condition in rule.only_enforce_if:
                variable = variables.get(condition.variable)
                if not variable or variable.lower_bound < 0 or variable.upper_bound > 1:
                    raise ValueError("Enforcement requires a Boolean domain")
        return self


class Options(StrictModel):
    max_time_seconds: Annotated[
        float, Field(strict=True, gt=0, le=60, allow_inf_nan=False)
    ] = 5
    random_seed: Annotated[int, Field(strict=True, ge=0, le=2147483647)] = 0


class SolveRequest(StrictModel):
    model: SolverModel
    options: Options = Field(default_factory=Options)


class SolutionResult(StrictModel):
    status: Literal["optimal", "feasible"]
    values: dict[str, Integer]
    objective_value: Integer | None
    best_objective_bound: Annotated[float, Field(allow_inf_nan=False)] | None
    wall_time_seconds: Annotated[float, Field(ge=0, allow_inf_nan=False)]


class NoSolutionResult(StrictModel):
    status: Literal["infeasible", "unknown", "model_invalid"]
    wall_time_seconds: Annotated[float, Field(ge=0, allow_inf_nan=False)]


type SolveResult = SolutionResult | NoSolutionResult
