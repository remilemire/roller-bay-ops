import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { PurchaseOrderField } from './purchase-order-field';

function Harness({ initial = [] }: { initial?: string[] }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <PurchaseOrderField value={value} onChange={setValue} />
      <output>{value.join(' ')}</output>
    </>
  );
}
const numbers = () => screen.getByRole('status').textContent;

it('turns each finished number into a chip that can be removed', async () => {
  const user = userEvent.setup();
  render(<Harness />);
  const box = screen.getByLabelText('PO numbers');
  expect(box).toHaveAttribute('aria-required', 'true');
  await user.type(box, '43142x43150');
  expect(numbers()).toBe('43142 43150');
  expect(box).toHaveValue('');
  // The same number twice is one purchase order.
  await user.type(box, '43142');
  expect(numbers()).toBe('43142 43150');
  await user.click(screen.getByRole('button', { name: 'Remove PO 43142' }));
  expect(numbers()).toBe('43150');
  expect(box).toHaveFocus();
  await user.keyboard('{Backspace}');
  expect(numbers()).toBe('');
});

it('adds a pasted list, and keeps a short number rather than dropping it', async () => {
  const user = userEvent.setup();
  render(<Harness />);
  const box = screen.getByLabelText('PO numbers');
  await user.click(box);
  await user.paste('43142, 43150\n4319');
  expect(numbers()).toBe('43142 43150');
  expect(box).toHaveValue('4319');
  // Enter keeps it instead of submitting a form, marked as invalid.
  await user.keyboard('{Enter}');
  expect(numbers()).toBe('43142 43150 4319');
  expect(screen.getByText('4319')).toHaveAttribute('data-invalid');
  await user.type(box, '43');
  await user.tab();
  expect(numbers()).toBe('43142 43150 4319 43');
});
