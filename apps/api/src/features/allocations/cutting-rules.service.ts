import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  AllocationDraftData,
  CreateAllocation,
  CuttingContext,
  CuttingPlanInput,
} from '@roller-bay/shared/allocations';
import type { Environment } from '../../config/environment.js';

type SavedRules = {
  settings: AllocationDraftData['settings'] | null;
  requirements: { id: string; lengthAllowanceMm: number | string | null }[];
};
type AssignedCut = { items: readonly { requirementId: string }[] };
type PlannedCuts<C> = { cuts: (C & { lengthMm: number | null })[] };
export type ConfiguredAllocationPlan = Omit<
  CreateAllocation,
  'requirements' | 'plan'
> &
  Pick<CuttingContext, 'requirements'> & {
    settings: CuttingContext['settings'] & { dropAllowanceMm: number };
    plan: PlannedCuts<CuttingPlanInput['cuts'][number]>;
  };

/**
 * Cut length is never entered. Each full-width cut is as long as its longest
 * assigned finished drop plus that blind's allowance, so it stays consistent
 * with the requirements it serves. A cut with no assignments, or with a draft
 * blind whose drop is still missing, has no length yet.
 */
export function planCutLengths<C extends AssignedCut>(
  requirements: readonly {
    id: string;
    lengthMm: number | null;
    lengthAllowanceMm: number;
  }[],
  plan: { cuts: readonly C[] },
): PlannedCuts<C> {
  const lengths = new Map(
    requirements.map((item) => [
      item.id,
      item.lengthMm === null
        ? null
        : Math.round((item.lengthMm + item.lengthAllowanceMm) * 1000) / 1000,
    ]),
  );
  return {
    cuts: plan.cuts.map((cut) => {
      let lengthMm: number | null = null;
      for (const item of cut.items) {
        const length = lengths.get(item.requirementId);
        if (length == null) return { ...cut, lengthMm: null };
        if (lengthMm === null || length > lengthMm) lengthMm = length;
      }
      return { ...cut, lengthMm };
    }),
  };
}

@Injectable()
export class CuttingRulesService {
  constructor(private readonly config: ConfigService<Environment, true>) {}

  // Configuration seeds new plans. Revisions reuse their stored rules, including
  // historical per-blind allowances, so deployment changes cannot alter a cut.
  apply<T extends { id: string }>(requirements: T[], saved?: SavedRules) {
    const settings = {
      edgeTrimMm:
        saved?.settings?.edgeTrimMm ??
        this.config.getOrThrow('CUTTING_EDGE_TRIM_MM', { infer: true }),
      minimumRemnantWidthMm:
        saved?.settings?.minimumRemnantWidthMm ??
        this.config.getOrThrow('CUTTING_MINIMUM_REMNANT_WIDTH_MM', {
          infer: true,
        }),
      minimumRemnantLengthMm:
        saved?.settings?.minimumRemnantLengthMm ??
        this.config.getOrThrow('CUTTING_MINIMUM_REMNANT_LENGTH_MM', {
          infer: true,
        }),
      dropAllowanceMm:
        saved?.settings?.dropAllowanceMm ??
        this.config.getOrThrow('CUTTING_DROP_ALLOWANCE_MM', { infer: true }),
    };
    const allowances = new Map(
      saved?.requirements.map((item) => [item.id, item.lengthAllowanceMm]),
    );
    return {
      settings,
      requirements: requirements.map((item) => ({
        ...item,
        lengthAllowanceMm: Number(
          allowances.get(item.id) ?? settings.dropAllowanceMm,
        ),
      })),
    };
  }
}
