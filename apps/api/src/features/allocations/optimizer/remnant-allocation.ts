import { setImmediate } from 'node:timers/promises';
import { checkCancellation } from './optimization.errors.js';
import {
  fittingBlinds,
  type Blind,
  type Stock,
  type Cut,
} from './packing-search.js';

// Enumerate quantities from each requirement, starting with the narrowest.
// Every prefix must leave enough compatible blinds to reach the target.
function* remnantSelections(narrowestFirst: Blind[], target: number) {
  const quantities = new Map<Blind, number>();
  for (const blind of narrowestFirst)
    quantities.set(blind, (quantities.get(blind) ?? 0) + 1);
  const groups = [...quantities];
  const suffix = Array<number>(groups.length + 1).fill(0);
  for (let i = groups.length - 1; i >= 0; i--)
    suffix[i] = suffix[i + 1]! + groups[i]![1];
  const selected = new Map<Blind, number>();
  const stack = [{ remaining: target, next: Math.min(target, groups[0]![1]) }];
  while (stack.length) {
    const index = stack.length - 1;
    const frame = stack[index]!;
    const quantity = frame.next--;
    const remaining = frame.remaining - quantity;
    if (quantity < 0 || remaining > suffix[index + 1]!) {
      stack.pop();
      continue;
    }
    selected.set(groups[index]![0], quantity);
    if (index + 1 === groups.length) yield new Map(selected);
    else
      stack.push({
        remaining,
        next: Math.min(remaining, groups[index + 1]![1]),
      });
  }
}

// After proving the fresh-roll minimum, partition the order by stock class.
// Each layout induces one such partition. Cuts within each class are independent,
// so the first feasible partition at the highest coverage proves that maximum.
export async function preferRemnants(
  blinds: Blind[],
  stocks: Stock[],
  first: Cut[],
  slack: bigint,
  pack: (
    pieces: Blind[],
    stocks: Stock[],
    slack: bigint,
  ) => Promise<Cut[] | null>,
  signal: AbortSignal | undefined,
) {
  const remnants = stocks.filter((stock) => stock.isRemnant);
  if (!remnants.length) return first;
  const compatible = fittingBlinds(blinds, remnants).reverse();
  if (!compatible.length) return first;
  const covered = first.reduce(
    (sum, cut) => sum + (cut.stock.isRemnant ? cut.blinds.length : 0),
    0,
  );
  // Pool available widths over the possible cuts, and independently count
  // how many minimum-width pieces each cut can hold. Both relax geometry.
  const minWidth = compatible[0]!.width;
  const minDrop = compatible.reduce(
    (min, b) => (b.drop < min ? b.drop : min),
    compatible[0]!.drop,
  );
  let availableWidth = 0n,
    slots = 0n,
    remnantArea = 0n;
  for (const stock of remnants) {
    const cuts = stock.length / minDrop;
    availableWidth += stock.width * cuts;
    slots += (stock.width / minWidth) * cuts;
    remnantArea += stock.width * stock.length;
  }
  let maximum = 0;
  for (const blind of compatible) {
    if (blind.width > availableWidth || BigInt(maximum) >= slots) break;
    availableWidth -= blind.width;
    maximum++;
  }
  const rolls = stocks.filter((stock) => !stock.isRemnant);
  let probes = 0;
  for (let target = maximum; target > covered; target--) {
    for (const selection of remnantSelections(compatible, target)) {
      if (++probes % 64 === 0) {
        await setImmediate();
        checkCancellation(signal);
      }
      const onRemnants: Blind[] = [],
        onRolls: Blind[] = [];
      let remnantSlack = remnantArea;
      // Preserve decreasing drop within both searches. A repeated requirement
      // needs only one partition per quantity, irrespective of blind identity.
      for (const blind of blinds) {
        const quantity = selection.get(blind) ?? 0;
        if (quantity) {
          onRemnants.push(blind);
          selection.set(blind, quantity - 1);
          remnantSlack -= blind.width * blind.drop;
        } else onRolls.push(blind);
      }
      const rollSlack = slack - remnantSlack;
      if (remnantSlack < 0n || rollSlack < 0n) continue;
      if (fittingBlinds(onRolls, rolls).length !== onRolls.length) continue;
      const remnantCuts = await pack(onRemnants, remnants, remnantSlack);
      if (!remnantCuts) continue;
      if (!onRolls.length) return remnantCuts;
      const rollCuts = await pack(onRolls, rolls, rollSlack);
      if (rollCuts) return [...remnantCuts, ...rollCuts];
    }
  }
  return first;
}
