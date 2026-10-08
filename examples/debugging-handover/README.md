# Debugging handover exercise

This is an intentionally failing JavaScript fixture, separate from application tests.

## Participant brief

An order preview sometimes shows `NaN`. Small orders work. The API normally supplies decimal price strings, but an imported record has a display-formatted price. The contract accepts finite nonnegative numeric prices and plain decimal strings; display formatting must produce a clear validation error. Quantities in this exercise are valid positive integers.

Run from the repository root:

```sh
node --test examples/debugging-handover/order-total.test.mjs
```

Initial expected result: three tests pass and one fails. Work on a copy of the fixture so the exercise remains repeatable.

Prior attempts to give the helper:

- Refreshing the preview did not change the outcome.
- The numeric-price and small decimal-string examples pass.
- Changing the displayed currency label did not affect the result.

The person requesting help shares the code, failing output, and this context using their normal workflow. A helper investigates and explains a fix. Record the handover measurements in `docs/phase-0/VALIDATION.md`.

## Facilitator notes — disclose after the exercise

Multiplication implicitly converts strings to numbers. `'1,200.00'` becomes `NaN`; the function neither validates nor rejects it. A fix should explicitly validate the agreed input contract and reject malformed prices. Blindly stripping commas or calling `parseFloat` can hide invalid input.

Ask the helper to add cases for empty strings, negative values, non-finite numbers, and trailing junk. Completion requires preserved valid totals, explicit invalid-input errors, and an explanation tied to passing tests. This is a bounded teaching fixture, not a production currency-arithmetic design.
