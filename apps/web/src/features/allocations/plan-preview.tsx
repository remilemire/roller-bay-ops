import type {
  AllocationOptimization,
  AllocationValidation,
} from '@roller-bay/shared/allocations';
export function PlanPreview({
  result,
}: {
  result: AllocationOptimization | AllocationValidation;
}) {
  if ('valid' in result && !result.valid)
    return (
      <div className="notice notice-warning" role="alert">
        <div>
          <strong>Some cuts need attention</strong>
          <ul>
            {result.issues.map((issue, index) => (
              <li key={index}>
                {issue.message} <small>({issue.path})</small>
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  if ('status' in result && result.status !== 'feasible')
    return (
      <div className="notice notice-warning" role="status">
        {result.status === 'infeasible'
          ? 'No valid plan fits the current requirements and available stock.'
          : result.reason === 'model_limit'
            ? 'This order is too large to generate a plan for. Try a smaller order or build the plan by hand.'
            : 'The search ended without a complete plan. Try again or adjust the requirements.'}
      </div>
    );
  const summary = result.summary;
  return (
    <div className="notice notice-info" role="status">
      <div>
        <strong>Valid cutting plan</strong>
        <p>
          {summary.cutCount} cuts · {summary.stockItemCount} stock items ·{' '}
          {summary.newRollCount} new rolls ·{' '}
          {(Number(summary.wasteAreaMm2) / 1_000_000).toFixed(4)} m² waste
        </p>
        <small>
          Preview only. Stock is reserved on confirmation; availability may
          change before then.
        </small>
      </div>
    </div>
  );
}
