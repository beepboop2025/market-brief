# Market Brief

**What changed in funding and liquidity — with the sources still attached.**

Free early access for people researching markets and the AI copilots they use.
Build a short brief, compare it with your previous check, and see missing or
withheld evidence alongside the reported observations. No account, broker
connection, API key, or LLM subscription is needed for the Python helper or web app.

[Open the free brief](https://beepboop2025.github.io/market-brief/) ·
[Source and coverage](docs/coverage.md) · [Distribution status](docs/distribution.json)

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

Save a baseline only when you want a later comparison:

```bash
python3 skills/market-brief/scripts/market_brief.py --output previous.json
python3 skills/market-brief/scripts/market_brief.py --previous previous.json --format markdown
```

An existing Financial Evidence packet can also be summarized offline:

```bash
python3 skills/market-brief/scripts/market_brief.py --input packet.json --format markdown
```

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

[Privacy](https://beepboop2025.github.io/market-brief/privacy.html) ·
[Terms](https://beepboop2025.github.io/market-brief/terms.html) ·
[Report an issue](https://github.com/beepboop2025/market-brief/issues)
