import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { receipt, user } from '../../../tests/fixtures';
import { ReceiptCorrectionEditor } from './receipt-correction-editor';
import { defaultMeasurementUnits } from '@roller-bay/shared/users';
vi.mock('@/features/auth/auth-boundary', () => ({
  useCurrentUser: () => ({
    ...user,
    measurementUnits: defaultMeasurementUnits,
  }),
  useCanManage: () => true,
}));
vi.mock('@/components/ui/lookup', () => ({
  Lookup: ({
    label,
    value,
    onChange,
  }: {
    label: string;
    value: string;
    onChange: (value: string) => void;
  }) => (
    <label>
      {label}
      <input value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  ),
}));
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function TestProvider({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}
beforeEach(() => sessionStorage.clear());
afterEach(() => vi.unstubAllGlobals());
it('shows legacy receipt restrictions without removing the paperwork correction', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      response({ record: receipt, baselineAvailable: false, eligibility: [] }),
    ),
  );
  render(<ReceiptCorrectionEditor id={receipt.id} close={vi.fn()} />, {
    wrapper: wrapper(),
  });
  expect(await screen.findByText(/This older receipt can have/)).toBeVisible();
  expect(screen.getByLabelText('Purchase order number')).toHaveValue(
    receipt.purchaseOrderNumber,
  );
  expect(
    screen.queryByRole('button', { name: 'Add missing line' }),
  ).not.toBeInTheDocument();
});
