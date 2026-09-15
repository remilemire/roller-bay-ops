# Roll measurement

## Confirmed workflow

- A received roll starts with the known length/yardage on the purchase order.
- After its first cut, record that individual roll's tube diameter for future calculations. It remains constant during the roll's life.
- `is_used` records whether this stock item has been used; no first-use date is required. Unused rolls must have null tube diameter and depth. Used rolls require their tube diameter, even if a current depth reading is cleared as an admin correction. All remnants must have null tube diameter and depth regardless of usage.
- When first recording a roll's use, set `isUsed: true` and its tube diameter together, then reuse that diameter for later measurements.
- The fabric catalog supplies thickness by color.
- Cutters record a roll-depth measurement on the order's paper form. The app calculates the remaining length when the form is entered.

**Confirmed convention:** Depth is the one-sided distance from the outside of the tube to the outside of the fabric: `(roll outside diameter − tube outside diameter) / 2`.

## Geometry

Let `D` be the complete roll's outside diameter, `C` the tube's outside diameter where the fabric starts, and `t` the fabric thickness. The geometric length estimate is:

```text
L = π × (D² − C²) / (4 × t)
```

This is the roll cross-sectional area divided by fabric thickness, rearranging the winding equation documented by equipment manufacturer [Elite Cameron](https://www.elitecameron.com/calculators/roll-diameter-calculator). `C` is the outside of the tube, not the diameter of its hollow bore. The form should explicitly label this measurement as tube outside diameter.

For the confirmed one-sided radial depth `d`, substitute `D = C + 2d`:

```text
d = (D − C) / 2
L = π × d × (C + d) / t
```

Label the form field as radial depth, with its unit. Do not treat the reading as the full diameter difference.

Use a common length unit for all inputs before calculating; the result is in that same unit. For example, inputs in millimetres yield millimetres of fabric, which must then be converted to the stock length unit. Require positive thickness and tube diameter and nonnegative depth; missing measurements must not be treated as zero.

## Recording and validation recommendations

Store each calculation's raw reading, depth convention, units, tube diameter, thickness used, result, and recording context. Preserve the received length separately. Changing the catalog thickness later must not silently rewrite past balances.

The geometry assumes uniform effective thickness and winding. Material compression, winding tightness, and gaps can affect the result; validate it against known-length rolls before establishing a business tolerance. [Elite Cameron explains these limitations](https://www.elitecameron.com/calculators/roll-diameter-calculator).

Record a fully consumed roll explicitly as consumed. Flat scraps and remnants need separate measurement rules; this formula applies to material wound on a tube.
