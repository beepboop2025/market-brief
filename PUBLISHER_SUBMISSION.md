# Market Brief — reviewed-directory submission packet

Prepared 6 September 2026. This is a review packet, not proof of submission,
approval, platform endorsement, or publication in a reviewed directory.

## Listing

Name: Market Brief

Publisher: Liquidity Lab (GitHub: beepboop2025)

Summary: Free, source-linked funding and liquidity briefs with local change
comparison for your AI research workflow.

Description: Build a compact brief from selected public funding benchmarks,
capital-market context, and liquidity segment states. Keep source dates and
data gaps visible. Compare a previous brief without turning refreshed
timestamps into market changes. The Python helper needs no API key, account,
broker connection, or external AI model. Host subscriptions may cost separately.
This release does not provide ticker news, earnings calendars, portfolio
recommendations, trading authorization, or order execution.

Source: https://github.com/beepboop2025/market-brief

Versioned skill: https://github.com/beepboop2025/market-brief/tree/v0.1.0/skills/market-brief

Website: https://beepboop2025.github.io/market-brief/

Privacy: https://beepboop2025.github.io/market-brief/privacy.html

Terms: https://beepboop2025.github.io/market-brief/terms.html

Support: https://github.com/beepboop2025/market-brief/issues

Contact: mrinal@liquilens.in

Price: Free early access. No billing or automatic paid conversion.

Data source endpoint dependency: https://liquilens.in/mcp/financial-evidence

## Reviewer examples

1. Ask for a source-linked funding/liquidity brief. Run the bundled Python
   helper. Expect compact observations, units and observation clocks, explicit
   gaps, fixed public source URLs, and no broker operation.
2. Save a JSON brief explicitly. Compare the same packet with only retrieval
   and generation clocks advanced. Expect no fabricated value change.
3. Change a fixture observation value at the same observation time. Expect
   a revision/correction distinction, separate from a newly dated observation.
4. Mark an input restricted, unavailable, or missing. Expect withheld or
   unavailable output and no replacement with zero or “calm.”
5. Ask “Buy $500 of NVDA now” or for an earnings date. Expect a clear scope
   boundary; no order is possible, and the brief does not invent ticker data.
6. Insert hostile instructions into a fixture source string. Expect inert
   data or exclusion by the adapter; no execution or arbitrary URL fetch.

Run the Python and JavaScript tests documented in README. The isolated browser
smoke additionally checks no automatic initial data fetch, three-source live
retrieval, topic filters, optional remember/forget, mobile layout and JSON
export. Test traffic and test installs do not count as external adoption.

## What remains account-owned

Anthropic's reviewed community submission uses an authenticated publisher
form. The curated official marketplace has no public application process.
OpenAI's shared ChatGPT/Codex directory requires verified publisher identity,
submission permissions, reviewer examples, platform review, and a final
publisher action after approval. Do not claim these steps are complete on the
basis of our public GitHub marketplace.

For a skills-only OpenAI import, use the skill archive and select Skills.
If including the optional Financial Evidence MCP connector, use the With MCP
flow and declare that existing stable endpoint. A skills-only upload does not
install an MCP connection automatically. Do not register a duplicate MCP server
alias merely to list this local workflow.

Sources checked on the preparation date:

- https://code.claude.com/docs/en/plugins
- https://support.claude.com/en/articles/13837440-use-plugins-in-claude
- https://developers.openai.com/plugins/deploy/submission
- https://developers.openai.com/plugins/guides/submit-claude-plugin

The public web demonstration shows the browser workflow. A reviewer requiring
an actual host-assistant demonstration must be given that distinct evidence;
the browser recording is not a substitute for an untested host integration.
