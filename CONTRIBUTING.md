# Contributing

The dataset is only useful if it is accurate and sourced.

**Reporting a rule change:** open an issue with
1. firm and program,
2. the official URL (firm help center, rules or terms page; not a review site),
3. the exact quoted text, and the date you read it.

**Pull requests:** edit `data/firms.json`, set `lastVerified` to the date you checked, keep `sources` pointing at
official pages, then run `node scripts/rules-table.mjs` and paste the output into the README table. If a value comes
from a secondary source, set `verified: false` or add the field to `unverifiedFields`. Run the tests:

```bash
node --test js/test/ && python3 -m unittest discover -s python/tests
```

No affiliate links, referral codes or firm rankings, please.
