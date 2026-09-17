import Link from 'next/link';
import type { CorrectionEligibility } from '@roller-bay/shared/corrections';
import { shortId } from '@/lib/format';
export function Blockers({ items }: { items: CorrectionEligibility[] }) {
  return (
    <>
      {items.flatMap((item) =>
        item.blockers.map((blocker, i) => (
          <p className="notice" key={`${item.stockItemId}:${i}`}>
            <Link href={`/stock-items/${item.stockItemId}`}>
              {shortId(item.stockItemId)}
            </Link>
            : {blocker.message}{' '}
            {blocker.allocationIds.map((id) => (
              <Link key={id} href={`/allocations/${id}`}>
                Order {shortId(id)}{' '}
              </Link>
            ))}
            {blocker.stockItemIds.map((id) => (
              <Link key={id} href={`/stock-items/${id}`}>
                Stock {shortId(id)}{' '}
              </Link>
            ))}
          </p>
        )),
      )}
    </>
  );
}
