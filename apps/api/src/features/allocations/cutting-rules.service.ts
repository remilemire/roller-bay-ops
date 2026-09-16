import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  AllocationDraftData,
  CreateAllocation,
  CuttingContext,
} from '@roller-bay/shared/allocations';
import type { Environment } from '../../config/environment.js';

type SavedRules = {
  settings: AllocationDraftData['settings'] | null;
  requirements: { id: string; lengthAllowanceMm: number | string | null }[];
};
export type ConfiguredAllocationPlan = Omit<CreateAllocation, 'requirements'> &
  Pick<CuttingContext, 'requirements'> & {
    settings: CuttingContext['settings'] & { dropAllowanceMm: number };
  };

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
