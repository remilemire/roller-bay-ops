/**
 * Public results use millimetres and decimal-string areas. Resolved plan types
 * carry known references and integer 0.001 mm dimensions shared by all rule checks.
 * Resolution establishes reference validity, not compliance with cutting rules.
 */
import type { CuttingContext } from '@roller-bay/shared/allocations';

export interface CuttingPlanIssue {
  code: string;
  path: string;
  message: string;
}

export interface CuttingLeftover {
  stockItemId: string;
  dropIndex: number | null;
  kind: 'left-edge' | 'right-edge' | 'shortening' | 'remnant-tail';
  widthMm: number;
  lengthMm: number;
  quantity: number;
  reusable: boolean;
}

export interface CuttingPlanSummary {
  leftovers: CuttingLeftover[];
  reservations: { stockItemId: string; reservedLengthMm: number }[];
  // Decimal strings preserve exact area even beyond Number.MAX_SAFE_INTEGER.
  inputAreaMm2: string;
  requiredAreaMm2: string;
  reusableAreaMm2: string;
  wasteAreaMm2: string;
  dropCount: number;
  stockItemCount: number;
  newRollCount: number;
}

export type CuttingPlanValidation =
  | { valid: false; issues: CuttingPlanIssue[] }
  | { valid: true; summary: CuttingPlanSummary };

export type Requirement = CuttingContext['requirements'][number];
export type Stock = CuttingContext['stockItems'][number];
export type CuttingSettings = CuttingContext['settings'];

export interface ResolvedAssignment {
  readonly requirement: Requirement;
  readonly quantity: number;
  readonly width: bigint;
  readonly length: bigint;
}

export interface ResolvedDrop {
  readonly index: number;
  readonly stock: Stock;
  readonly length: bigint;
  readonly assignments: readonly ResolvedAssignment[];
}

export interface PlannedStockUsage {
  readonly stock: Stock;
  readonly plannedLength: bigint;
}

export interface ResolvedCuttingPlan {
  readonly requirements: readonly Requirement[];
  readonly settings: CuttingSettings;
  readonly drops: readonly ResolvedDrop[];
  readonly stockUsage: readonly PlannedStockUsage[];
}

export type CuttingPlanResolution =
  | { valid: false; issues: CuttingPlanIssue[] }
  | { valid: true; plan: ResolvedCuttingPlan };
