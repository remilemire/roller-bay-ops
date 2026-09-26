import { useState } from 'react';
import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MeasurementField } from './measurement-field';

function Measurement({
  unit,
  initial = '',
}: {
  unit: 'in' | 'mm';
  initial?: string;
}) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <MeasurementField
        label={`Width (${unit})`}
        unit={unit}
        value={value}
        onChange={setValue}
      />
      <output>{value}</output>
    </>
  );
}

it('keeps an inch fraction beside the typed whole number', async () => {
  const user = userEvent.setup();
  render(<Measurement unit="in" initial="72 1/8" />);
  const input = screen.getByLabelText('Width (in)');
  expect(input).toHaveValue('72');

  await user.click(screen.getByRole('button', { name: 'Width fraction: 1/8' }));
  const grid = screen.getByRole('dialog', { name: 'Choose width fraction' });
  expect(screen.getByRole('button', { name: '1/8' })).toHaveFocus();
  await user.keyboard('{ArrowDown}{ArrowDown}');
  expect(screen.getByRole('button', { name: '5/8' })).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(grid).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('72 5/8');
  expect(
    screen.getByRole('button', { name: 'Width fraction: 5/8' }),
  ).toHaveFocus();

  await user.clear(input);
  await user.type(input, '36');
  expect(screen.getByRole('status')).toHaveTextContent('36 5/8');
  await user.click(screen.getByRole('button', { name: /Width fraction/ }));
  await user.click(screen.getByRole('button', { name: 'No fraction' }));
  expect(screen.getByRole('status')).toHaveTextContent(/^36$/);
});

it('drops the fraction while the number has a decimal point', async () => {
  const user = userEvent.setup();
  render(<Measurement unit="in" initial="72 5/8" />);
  const input = screen.getByLabelText('Width (in)');
  await user.type(input, '.5');
  expect(
    screen.queryByRole('button', { name: /Width fraction/ }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('72.5');
  await user.type(input, '{Backspace}{Backspace}');
  expect(
    screen.getByRole('button', { name: 'Width fraction' }),
  ).toBeInTheDocument();
});

it('moves a typed fraction beside the number once it is complete', async () => {
  const user = userEvent.setup();
  render(<Measurement unit="in" />);
  const input = screen.getByLabelText('Width (in)');
  await user.type(input, '5 1/8');
  expect(input).toHaveValue('5');
  expect(screen.getByRole('status')).toHaveTextContent('5 1/8');
  expect(input).toHaveFocus();

  // 1/1 and 1/3 could still become 1/16 and 1/32.
  await user.clear(input);
  await user.type(input, '54 1/16');
  expect(input).toHaveValue('54');
  expect(screen.getByRole('status')).toHaveTextContent('54 1/16');
  await user.clear(input);
  await user.type(input, '54 1/3');
  expect(input).toHaveValue('54 1/3');
  await user.type(input, '2');
  expect(input).toHaveValue('54');
  expect(screen.getByRole('status')).toHaveTextContent('54 1/32');

  // Any other fraction waits for the field to be left.
  await user.clear(input);
  await user.type(input, '54 6/10');
  expect(input).toHaveValue('54 6/10');
  await user.tab();
  expect(input).toHaveValue('54');
  expect(screen.getByRole('status')).toHaveTextContent('54 3/5');
});

it('blocks submitting text that is not a measurement', async () => {
  const user = userEvent.setup();
  render(<Measurement unit="mm" />);
  const input = screen.getByLabelText('Width (mm)');
  expect(
    screen.queryByRole('button', { name: /Width fraction/ }),
  ).not.toBeInTheDocument();
  await user.type(input, '12 1/');
  expect(input).not.toBeValid();
  await user.tab();
  expect(input).toHaveAccessibleDescription('Enter a number.');
  await user.type(input, '2');
  expect(input).toBeValid();
});
