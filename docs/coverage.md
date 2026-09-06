# Coverage of Market Brief 0.1.0

This release covers three fixed public JSON routes. It does not claim every
security, jurisdiction, venue, publisher, or observation is covered.

| Topic | Product | Public source | Use |
|---|---|---|---|
| Funding | Seiche | https://api.seiche.info/api/v2/money-markets | Selected native overnight benchmarks and declared coverage |
| Capital context | Seiche | https://api.seiche.info/api/v2/world-markets?section=capital_markets | Selected observations and product-derived market/funding comparison |
| Liquidity | Undertow | https://api.seiche.info/undertow/x402/summary | Public segment states and reported funding regime |

The Python helper preserves stable identities, per-observation source clocks,
units, original publisher links where provided, and explicit data gaps. It can
compare a previous compact brief. Browser comparisons use a smaller set of
the same source fields, stored only with the user's local remember option.
Browser and Python baselines are separate formats and are not interchangeable.

Source-reported `FRESH`, `NORMAL`, `PARTIAL`, or similar labels belong to their
publisher. They are not Market Brief's verification or a trading instruction.
Generated and retrieved dates do not replace observation dates. A weekend or
publication holiday is not itself proof a daily benchmark is stale; neither
does a recent retrieval establish that an observation is still valid.

No new paid data access, brokerage connection, ticker-level news coverage,
earnings calendar, backtest, order authorisation, or real-money execution is
included. A macro association does not explain a particular asset's move.

Public upstream responses may be partial, delayed, restricted, or unavailable.
Their publishers retain their rights. This client does not verify Carrier
signatures, grant redistribution rights, or turn transport into evidence
eligibility.
