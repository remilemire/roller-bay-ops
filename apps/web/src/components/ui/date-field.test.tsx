import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { monthWeeks, mondayOf, nextWeekday } from '@/lib/calendar-dates';
import { DateField } from './date-field';

vi.mock('@/lib/calendar-dates', async (original) => ({
  ...(await original<typeof import('@/lib/calendar-dates')>()),
  // A Saturday, so the weekday-only calendar has to start on the Monday.
  today: () => '2026-10-03',
}));
function Harness({ initial = '', weekdaysOnly = true }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <DateField
        label="Ship date"
        value={value}
        onChange={setValue}
        weekdaysOnly={weekdaysOnly}
      />
      <output>{value}</output>
    </>
  );
}

it('lays a month out in whole weeks and drops weeks with no shown day in it', () => {
  // August 2026 starts on a Saturday and ends on a Monday.
  const workWeeks = monthWeeks('2026-08', true);
  expect(workWeeks[0]).toEqual([
    '2026-08-03',
    '2026-08-04',
    '2026-08-05',
    '2026-08-06',
    '2026-08-07',
  ]);
  expect(workWeeks.at(-1)![0]).toBe('2026-08-31');
  expect(monthWeeks('2026-08', false)[0]![0]).toBe('2026-07-27');
  expect(mondayOf('2026-10-04')).toBe('2026-09-28');
  expect(nextWeekday('2026-10-04')).toBe('2026-10-05');
  expect(nextWeekday('2026-10-02')).toBe('2026-10-02');
});

it('picks a weekday from the calendar and shows it as a readable date', async () => {
  const user = userEvent.setup();
  render(<Harness />);
  const trigger = screen.getByRole('button', { name: 'Ship date' });
  expect(trigger).toHaveTextContent('Choose a date');
  await user.click(trigger);
  expect(screen.getByRole('grid', { name: 'October 2026' })).toBeVisible();
  // Saturday and Sunday are not offered at all.
  expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(
    ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
  );
  expect(screen.queryByRole('button', { name: 'Sat, Oct 3, 2026' })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Next month' }));
  await user.click(screen.getByRole('button', { name: 'Fri, Nov 6, 2026' }));
  expect(screen.getByRole('status')).toHaveTextContent('2026-11-06');
  expect(trigger).toHaveTextContent('Fri, Nov 6, 2026');
  expect(screen.queryByRole('grid')).toBeNull();
  expect(trigger).toHaveFocus();
});

it('moves through days with the keyboard, skipping the weekend', async () => {
  const user = userEvent.setup();
  render(<Harness initial="2026-10-09" />);
  const trigger = screen.getByRole('button', { name: 'Ship date' });
  trigger.focus();
  await user.keyboard('{ArrowDown}');
  expect(
    screen.getByRole('button', { name: 'Fri, Oct 9, 2026' }),
  ).toHaveFocus();
  await user.keyboard('{ArrowRight}');
  expect(
    screen.getByRole('button', { name: 'Mon, Oct 12, 2026' }),
  ).toHaveFocus();
  await user.keyboard('{ArrowLeft}{ArrowLeft}{ArrowUp}{End}');
  expect(
    screen.getByRole('button', { name: 'Fri, Oct 2, 2026' }),
  ).toHaveFocus();
  // Paging lands in another month and brings its grid with it.
  await user.keyboard('{PageDown}');
  expect(screen.getByRole('grid', { name: 'October 2026' })).toBeVisible();
  await user.keyboard('{PageDown}');
  expect(screen.getByRole('grid', { name: 'November 2026' })).toBeVisible();
  await user.keyboard('{Enter}');
  expect(screen.getByRole('status')).toHaveTextContent('2026-11-27');
  await user.keyboard('{ArrowDown}{Escape}');
  expect(screen.queryByRole('grid')).toBeNull();
  expect(trigger).toHaveFocus();
  expect(screen.getByRole('status')).toHaveTextContent('2026-11-27');
});

it('offers all seven days when weekends are allowed', async () => {
  const user = userEvent.setup();
  render(<Harness weekdaysOnly={false} />);
  await user.click(screen.getByRole('button', { name: 'Ship date' }));
  expect(screen.getAllByRole('columnheader')).toHaveLength(7);
  expect(
    screen.getByRole('button', { name: 'Sat, Oct 3, 2026' }),
  ).toHaveAttribute('aria-current', 'date');
});
