import { Fragment } from 'react';
import Link from 'next/link';
import type { CorrectionEligibility } from '@roller-bay/shared/corrections';
import { shortId } from '@/lib/format';
export function Blockers({ items }: { items: CorrectionEligibility[] }) {
  return (
    <>
      {items.flatMap((item) =>
        item.blockers.map((blocker, i) => (
          <p className="notice notice-warning" key={`${item.stockItemId}:${i}`}>
            {/* One span, so the notice's flex gap does not split the sentence. */}
            <span>
              <Link href={`/stock-items/${item.stockItemId}`}>
                {shortId(item.stockItemId)}
              </Link>
              : {blocker.message}
              {blocker.allocationIds.map((id) => (
                <Fragment key={id}>
                  {' '}
                  <Link href={`/allocations/${id}`}>
                    Allocation {shortId(id)}
                  </Link>
                </Fragment>
              ))}
              {blocker.stockItemIds.map((id) => (
                <Fragment key={id}>
                  {' '}
                  <Link href={`/stock-items/${id}`}>Stock {shortId(id)}</Link>
                </Fragment>
              ))}
            </span>
          </p>
        )),
      )}
    </>
  );
}
