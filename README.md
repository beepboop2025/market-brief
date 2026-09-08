# Market Brief

**What changed in funding and liquidity — with the sources still attached.**

Free early access for people researching markets and the AI copilots they use.
Build a short brief, compare it with your previous check, and see missing or
withheld evidence alongside the reported observations. No account, broker
connection, API key, or LLM subscription is needed for the Python helper or web app.

[Open the free brief](https://beepboop2025.github.io/market-brief/) ·
[Explore a copilot scenario](https://beepboop2025.github.io/market-brief/copilot.html) ·
[Source and coverage](docs/coverage.md) ·
[Distribution status](https://beepboop2025.github.io/market-brief/submissions.html) ·
[Browser release verification](https://beepboop2025.github.io/market-brief/browser-release.json)

## Try it

Open the web app and select **Build my brief**. It reads three public sources
when you ask. Remembering a comparison baseline is optional and stays in your
browser. There is no background polling.

For a terminal or agent, Python 3.10+ is enough:

```bash
git clone --branch v0.1.0 --depth 1 https://github.com/beepboop2025/market-brief.git
cd market-brief
python3 skills/market-brief/scripts/market_brief.py --format markdown
```

## Explore a copilot decision

The [scenario explorer](https://beepboop2025.github.io/market-brief/copilot.html)
shows six synthetic examples from the published trading copilot strategy:
an entry candidate, a reduction, old inputs, a daily loss halt, stressed funding,
and a residual below the minimum order size. Inspect invented inputs, reported
metrics, reasons, and the evidence and operator checks still required.

These are precomputed Python outputs with a fixed synthetic clock in the year
2000. The browser verifies the published pack's byte hash; it does not run an
AI model, fetch market data, assess evidence eligibility, or authorize orders.
The strategy source, dataset and pack hashes are visible for reproduction.

Copy the explained example, download Markdown, or share a scenario link. Links
open the current published example. They contain a known scenario name only;
they are not archived market records. Optional local demo counts use the
existing activity consent and remain separate from research checks.

## Keep a focused research routine

In the browser, **Watch observation** adds a benchmark, capital-market reading,
or liquidity segment to a watchboard of up to 12 observations. **My watchboard**,
**Changes**, and **Evidence gaps** help you review a smaller set. A watched item
that disappears stays visible as unavailable; an old value is never carried
forward as current. Changes require the existing saved comparison, and gaps
include stale, undated, withheld and incomparable evidence.

Watch choices stay in the current tab until you enable **Remember my watchboard
on this device**. That option stores observation IDs only, separately from the
optional comparison baseline and activity log. Clear watchboard removes them.

Choose **Prepare AI research handoff** to review the current filtered view with
its source links, three kinds of timestamps, valid comparisons and evidence
gaps. Copy it to your chosen assistant or download Markdown. The packet asks
for an explanation, a countercase and verification questions; Market Brief
does not contact an AI service. Your assistant's terms apply if you submit it.

Continue with the existing [LiquiLens bank example](https://liquilens.in/start/?task=bank),
[Seiche funding question](https://liquilens.in/start/?task=funding), or
[Undertow exit example](https://liquilens.in/start/?task=exit). Bank evidence is
additional research: it is not fetched or assessed by the three-source brief.

Save a baseline only when you want a later comparison:

```bash
python3 skills/market-brief/scripts/market_brief.py --output previous.json
python3 skills/market-brief/scripts/market_brief.py --previous previous.json --format markdown
```

An existing Financial Evidence packet can also be summarized offline:

```bash
python3 skills/market-brief/scripts/market_brief.py --input packet.json --format markdown
```

## Share and reuse a brief

After building a brief, choose **Share this brief** to review up to three
selected observations with their dates and source links. Copy the preview,
save a dated PNG, or open your device’s sharing menu or Telegram. Shared links
select a topic and invite the reader to check the latest source responses;
they are not historical permalinks. Saved comparison history is excluded.

[Publisher kit](https://beepboop2025.github.io/market-brief/partners.html)
includes a website embed, newsletter link and Python/skill examples. The embed
fetches only when its reader clicks and does not record activity or send
messages to its parent page.

Under **Help improve Market Brief**, an optional device-local log records use
days and action counts for up to 35 days. It starts only after consent and is
separate from the saved comparison. You can inspect/export it for voluntary
feedback; nothing is automatically uploaded. These self-reported device
counts do not establish aggregate users or retention.

## Install in your AI assistant

Use the open Agent Skill in a compatible assistant:

```bash
npx skills add https://github.com/beepboop2025/market-brief/tree/v0.1.0 --skill market-brief
```

Claude Code, through our owner-maintained marketplace:

```bash
claude plugin marketplace add beepboop2025/market-brief
claude plugin install market-brief@market-brief
```

Codex, through the same repository's marketplace:

```bash
codex plugin marketplace add beepboop2025/market-brief --ref v0.1.0
codex plugin add market-brief@market-brief
```

The plugin includes an optional connection to Financial Evidence's existing
public MCP server. Its three tools retrieve context; the new brief workflow
runs locally in the skill. This release does not add a fourth hosted MCP tool.
Compatible assistants can use the Python helper without an MCP connection.

Try: **“Use Market Brief to show the latest funding and liquidity context.
Keep source dates, missing evidence, and a countercase in the answer.”**

These are self-installable packages in an owner-maintained marketplace. They
are not an assertion of acceptance by OpenAI or Anthropic's reviewed directories.
The Claude marketplace command follows the repository default branch; the
versioned skill and Codex commands above pin the release. Host AI subscriptions
may cost money even while Market Brief itself is free.

## What the first release covers

- Selected public overnight funding benchmarks and their reported changes.
- Capital-market context, including source-reported funding regime, VIX and
  high-yield spread observations, and a clearly labeled derived comparison.
- Undertow's public liquidity segment states and reported funding regime.

The Python tool compares stable observation identities. It distinguishes
value changes, source-state changes, withheld/missing observations, and
incomparable units or clocks. A new retrieval timestamp alone is not a market
change. The browser has a smaller matching projection for a quick first use.

Coverage is curated and partial. This is market research context, not a
ticker-news service, earnings calendar, portfolio recommendation, execution
quote, credit rating, or order-entry system. Source-reported state is preserved;
transport success does not verify freshness, rights, correctness, or safety.
The helper performs no Evidence Carrier verification. Upstream licensing and
redistribution terms continue to apply.

## Free launch

No billing, card collection, paid upsell, or automatic conversion is enabled.
We are keeping this release free while learning whether people return for it.
The MIT code remains open source. Hosted availability depends on the public
data services; future hosted terms, if introduced, will be announced explicitly.
There is no guarantee of unlimited capacity or permanent hosted service.

## Development

```bash
python3 -m unittest discover -s tests -v
node --test web-tests/*.test.mjs
python3 -m http.server 8096 --directory docs
```

The helper vendors the fixed-route Financial Evidence v0.1.5 client. See
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). It uses Python's standard
library; the browser app uses native JavaScript with no third-party scripts.

To update the explorer, export the pack from an exact published Carrier source
checkout with `python3 -S -B -m liquilens_trading_copilot.demo --all --source-ref`
and the full commit SHA, using the Python path shown in the explorer's source
section. Independently verify the published source bytes and exported SHA-256,
then run `node scripts/sync_copilot_demo.mjs PACK_JSON EXPECTED_SHA256` here.
This preserves the original Python JSON bytes and pins their hash in the web
release; the browser does not duplicate the strategy logic. Run the unit suites
above and `scripts/check_copilot.mjs` with a local docs server and Playwright
available (`PLAYWRIGHT_MODULE`, `PLAYWRIGHT_CHANNEL`, `MARKET_BRIEF_URL` and
`MARKET_BRIEF_ARTIFACTS` can select the runner, browser, URL and output directory).

[Privacy](https://beepboop2025.github.io/market-brief/privacy.html) ·
[Terms](https://beepboop2025.github.io/market-brief/terms.html) ·
[Report an issue](https://github.com/beepboop2025/market-brief/issues)
