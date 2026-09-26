'use client';
import Link from 'next/link';
import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Layers3, Plus } from 'lucide-react';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Button } from '@/components/ui/button';
import {
  Empty,
  ErrorNotice,
  Loading,
  PageHeading,
  Pagination,
  Status,
} from '@/components/ui/feedback';
import { SearchToolbar } from '@/components/ui/search-toolbar';
import { useListParams } from '@/lib/use-list-params';
import { useRememberedParam } from '@/lib/use-remembered-param';
import { shortId } from '@/lib/format';
import { fieldLabel } from '@/lib/measurements';
import { useCanManage } from '@/features/auth';
import { useMeasurementUnits } from '@/features/users';
import { stockList } from './stock-items.api';
import { StockEditor } from './stock-editor';
const tabs = [
  { value: 'on-hand', label: 'On hand' },
  { value: 'remnant', label: 'Remnants' },
  { value: 'consumed', label: 'Consumed' },
  { value: 'voided', label: 'Voided' },
] as const;
export function StockScreen() {
  const params = useListParams();
  const units = useMeasurementUnits();
  const { value: state } = useRememberedParam(
    'state',
    'roller-bay-stock-state',
    tabs.map((tab) => tab.value),
    'on-hand',
  );
  const query = useQuery({
    ...stockList({
      search: params.search,
      page: params.page,
      isConsumed: state === 'consumed',
      isVoided: state === 'voided',
      // Remnants on hand: consumed and voided remnants sit under those tabs.
      isRemnant: state === 'remnant' || undefined,
    }),
    enabled: !!state,
    // Keep the rows on screen while a search typed or a page turned loads.
    placeholderData: keepPreviousData,
  });
  const canManage = useCanManage();
  const [adding, setAdding] = useState(false);
  return (
    <>
      <PageHeading title="Fabric stock">
        {canManage && (
          <Button onClick={() => setAdding(true)}>
            <Plus size={17} />
            Add opening stock
          </Button>
        )}
      </PageHeading>
      <SearchToolbar
        search={params.search}
        onSearch={(search) => params.set({ search })}
        placeholder="Search color code, material or ID…"
      >
        <SegmentedControl
          label="Stock status"
          value={state ?? ''}
          options={tabs}
          onChange={(value) => params.set({ state: value })}
        />
      </SearchToolbar>
      <section className="panel">
        {query.isPending ? (
          <Loading />
        ) : query.error ? (
          <ErrorNotice error={query.error} retry={() => void query.refetch()} />
        ) : query.data.items.length === 0 ? (
          <Empty title="No fabric found">
            Try another search, or receive your first delivery.
          </Empty>
        ) : (
          <div className="data-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Fabric / ID</th>
                  <th>Width</th>
                  <th>Remaining</th>
                  <th>Location</th>
                  <th>Type</th>
                </tr>
              </thead>
              <tbody>
                {query.data.items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <Link
                        className="cell-leading"
                        href={`/stock-items/${item.id}`}
                      >
                        <span className="cell-icon">
                          <Layers3 size={17} />
                        </span>
                        <span>
                          <strong>{item.fabricColorCode}</strong>
                          <small>
                            {shortId(item.id)} · {item.materialName}
                          </small>
                        </span>
                      </Link>
                    </td>
                    <td>{fieldLabel(units, 'rollWidth', item.widthMm)}</td>
                    <td>
                      {fieldLabel(units, 'rollLength', item.remainingLengthMm)}
                    </td>
                    <td>
                      {item.zoneName}
                      <small>
                        {item.sectionLabel} / {item.locationLabel}
                      </small>
                    </td>
                    <td>
                      <Status
                        value={
                          item.voidedAt
                            ? 'voided'
                            : item.consumedAt
                              ? 'consumed'
                              : item.isRemnant
                                ? 'remnant'
                                : item.isUsed
                                  ? 'used-roll'
                                  : 'new-roll'
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {query.data && (
          <Pagination
            page={params.page}
            total={query.data.total}
            onPage={(page) => params.set({ page })}
          />
        )}
      </section>
      {adding && <StockEditor close={() => setAdding(false)} />}
    </>
  );
}
