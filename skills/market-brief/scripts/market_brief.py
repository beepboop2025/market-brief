#!/usr/bin/env python3
"""A bounded, read-only projection and comparison of Financial Evidence packets."""

from __future__ import annotations

import argparse
import html
import importlib.util
import json
import math
import re
import subprocess
import sys
import time
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

sys.dont_write_bytecode = True

SCHEMA = "market-brief.v1"
PACKET_SCHEMA = "liquidity-lab.financial-evidence-packet.v1"
MAX_INPUT_BYTES = 4_194_304
MAX_SOURCE_BYTES = 1_048_576
MAX_OUTPUT_BYTES = 262_144
MAX_OBSERVATIONS = 96
MAX_MARKETS = 32
MAX_NODES = 250_000
MAX_DEPTH = 48
ROUTES = {
    "money-market": ("Seiche", "https://api.seiche.info/api/v2/money-markets"),
    "capital-market": (
        "Seiche",
        "https://api.seiche.info/api/v2/world-markets?section=capital_markets",
    ),
    "market-liquidity": ("Undertow", "https://api.seiche.info/undertow/x402/summary"),
}
GUARDRAILS = {
    "status_semantics": "transport_only",
    "evidence_status": "not_evaluated",
    "carrier_verification": "not_performed",
    "financial_authority": "none",
}
STATES = frozenset({
    "FRESH", "STALE", "DEAD", "AVAILABLE", "UNAVAILABLE", "RESTRICTED",
    "WITHHELD", "BLOCKED", "UNKNOWN", "PARTIAL", "NORMAL", "CALM",
    "EROSION", "STRESS", "CRISIS", "ELEVATED", "SEVERE", "WATCH",
    "STABLE", "LIVE_REFERENCE", "POLICY_ONLY", "DERIVED_CONTEXT",
    "DECLARED_UNAVAILABLE", "observed", "derived", "structural",
    "restricted", "unavailable", "partial", "complete", "not_reported",
})
RESTRICTED = frozenset({"restricted", "withheld", "blocked", "metadata_only", "derived_only"})
UNAVAILABLE = frozenset({"unavailable", "dead", "declared_unavailable"})
SEGMENTS = ("BSTOCK", "CN", "CRYPTO", "EQUITY", "ETF", "FX", "HY", "IG", "UST")
COVERAGE = {
    "declared_markets": "Declared money markets",
    "live_benchmarks": "Source-reported live benchmarks",
    "available_benchmarks": "Available benchmarks",
    "stale_benchmarks": "Stale benchmarks",
    "derived_context_benchmarks": "Derived-context benchmarks",
    "policy_only_markets": "Policy-only markets",
}
READINGS = frozenset({"plumbing leads price", "price leads plumbing", "in line", "aligned", "balanced"})
PUBLISHER_HOSTS = frozenset({
    "www.rba.gov.au", "data.ecb.europa.eu", "www.rbi.org.in",
    "www.stat-search.boj.or.jp", "eservices.mas.gov.sg", "fred.stlouisfed.org",
    "www.newyorkfed.org", "www.bankofengland.co.uk", "www.bankofcanada.ca",
    "www.cboe.com", "www.chinamoney.com.cn", "www.rbnz.govt.nz",
    "ecos.bok.or.kr", "www.hkma.gov.hk",
})
LIMITATIONS = [
    "Public research context only; no security recommendation, price forecast, causal price explanation, or trade execution.",
    "Source status, including FRESH, is publisher-reported and is not independently verified freshness or evidence eligibility.",
    "Transport success does not establish data rights, analytical validity, or Evidence Carrier verification.",
    "Only allowlisted fields are projected. Histories, restricted values, and arbitrary source prose are excluded.",
    "Snapshot generation and retrieval times are separate from observation times. Capital regime clocks can describe composite context; Undertow supplies a summary as-of date, not per-segment observation clocks.",
    "Comparisons cover two saved briefs, not a complete market history. Source-reported one-observation changes are separate from saved-brief changes.",
    "Public source fields retain their publication restrictions; an open-source software license does not relicense underlying data.",
    "Source hashes are retrieval receipts, not authenticated signatures. Offline packets and comparison baselines are caller-supplied evidence.",
]


class BriefError(ValueError):
    """A bounded input or output did not satisfy the public brief contract."""


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _clock(value: Any) -> str | None:
    if not isinstance(value, str) or len(value) > 40:
        return None
    try:
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
            datetime.strptime(value, "%Y-%m-%d")
            return value
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})", value):
            return None
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.utcoffset() is None:
            return None
        return value
    except (ValueError, OverflowError):
        return None


def _instant(value: Any) -> datetime | None:
    clock = _clock(value)
    if clock is None:
        return None
    parsed = datetime.fromisoformat(clock.replace("Z", "+00:00"))
    return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed


def _number(value: Any) -> bool:
    return type(value) in (int, float) and math.isfinite(value) and abs(value) <= 1e15


def _state(value: Any) -> str:
    return value if isinstance(value, str) and value in STATES else "not_reported"


def _mapping(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _restriction(*objects: dict[str, Any]) -> str | None:
    found = []
    for obj in objects:
        if "redistribution_status" in obj and obj["redistribution_status"] not in ("allowed", None):
            found.append("restricted")
        if obj.get("ok") is False or obj.get("evidence_eligible") is False:
            found.append("unavailable")
        for key in ("status", "availability", "evidence_status", "redistribution_status"):
            value = obj.get(key)
            if isinstance(value, str):
                found.append(value.lower())
    if any(value in RESTRICTED for value in found):
        return "withheld"
    if any(value in UNAVAILABLE for value in found):
        return "unavailable"
    return None


def _rights(*objects: dict[str, Any]) -> str:
    values = [obj["redistribution_status"] for obj in objects if "redistribution_status" in obj]
    for status in ("blocked", "restricted", "derived_only", "unknown"):
        if status in values:
            return status
    if values and any(value != "allowed" for value in values):
        return "unknown"
    return "allowed" if values else "not_reported"


def _token(value: Any, name: str, *, length: int = 96) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0," + str(length - 1) + "}", value):
        raise BriefError(f"invalid {name}")
    return value


def _unit(value: Any) -> str | None:
    return value if value in ("%", "bp", "basis_points", "pts", "count", "index_points") else None


def _publisher_url(value: Any) -> str | None:
    if not isinstance(value, str) or len(value) > 400 or re.search(r"[\s<>\"'()\\]", value):
        return None
    try:
        parsed = urlparse(value)
        if (parsed.scheme == "https" and parsed.hostname in PUBLISHER_HOSTS
                and parsed.port in (None, 443) and parsed.username is None
                and parsed.password is None and not parsed.fragment):
            return value
    except ValueError:
        pass
    return None


def _bounded_tree(value: Any) -> None:
    stack = [(value, 0)]
    count = 0
    while stack:
        item, depth = stack.pop()
        count += 1
        if count > MAX_NODES or depth > MAX_DEPTH:
            raise BriefError("input structure exceeds bounds")
        if isinstance(item, dict):
            if any(not isinstance(key, str) for key in item):
                raise BriefError("JSON object keys must be strings")
            stack.extend((child, depth + 1) for child in item.values())
        elif isinstance(item, list):
            stack.extend((child, depth + 1) for child in item)
        elif isinstance(item, float) and not math.isfinite(item):
            raise BriefError("non-finite numbers are not accepted")
        elif type(item) is int and abs(item) > 1e100:
            raise BriefError("integer exceeds bounds")
        elif item is not None and not isinstance(item, (str, int, float, bool)):
            raise BriefError("input is not JSON data")


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result = {}
    for key, value in pairs:
        if key in result:
            raise BriefError("duplicate JSON object key")
        result[key] = value
    return result


def _parse_integer(value: str) -> int:
    if len(value) > 100:
        raise BriefError("integer literal exceeds bounds")
    return int(value)


def _parse_decimal(value: str) -> float:
    if len(value) > 100:
        raise BriefError("decimal literal exceeds bounds")
    result = float(value)
    if not math.isfinite(result) or result == 0 and Decimal(value) != 0:
        raise BriefError("decimal is outside supported finite precision")
    return result


def load_json_bytes(raw: bytes, *, limit: int = MAX_INPUT_BYTES) -> dict[str, Any]:
    if len(raw) > limit:
        raise BriefError("input exceeds byte limit")
    try:
        value = json.loads(raw.decode("utf-8"), object_pairs_hook=_unique_object,
                           parse_int=_parse_integer, parse_float=_parse_decimal,
                           parse_constant=lambda _: (_ for _ in ()).throw(BriefError("non-finite number")))
    except (UnicodeError, json.JSONDecodeError, RecursionError, ValueError) as exc:
        raise BriefError("input is not bounded, strict JSON") from exc
    if not isinstance(value, dict):
        raise BriefError("input root must be an object")
    _bounded_tree(value)
    return value


def read_json(path: str, *, limit: int = MAX_INPUT_BYTES) -> dict[str, Any]:
    with Path(path).open("rb") as stream:
        return load_json_bytes(stream.read(limit + 1), limit=limit)


def _observation(topic: str, identifier: str, label: str, pointer: str,
                 source: dict[str, Any], document: dict[str, Any], *,
                 observed_at: Any = None, published_at: Any = None,
                 knowledge_at: Any = None, status: Any = None,
                 evidence_class: str = "structural", rights: str = "not_reported") -> dict[str, Any]:
    return {
        "id": identifier, "topic": topic, "product": ROUTES[topic][0], "label": label,
        "availability": "unavailable", "evidence_class": evidence_class,
        "source_reported_status": _state(status), "source_url": ROUTES[topic][1],
        "json_pointer": pointer, "financial_authority": "none", "rights_status": rights,
        "clocks": {
            "observed_at": _clock(observed_at),
            "source_generated_at": _clock(document.get("generated_at")),
            "published_at": _clock(published_at), "knowledge_at": _clock(knowledge_at),
            "retrieved_at": _clock(source.get("retrieved_at")),
        },
    }


def _set_value(row: dict[str, Any], value: Any, unit: str | None = None,
               *, restriction: str | None = None, allowed: bool = True) -> None:
    if restriction:
        row["availability"] = restriction
    elif allowed and (_number(value) or isinstance(value, str)):
        row["availability"] = "reported"
        row["value"] = value
        if unit:
            row["unit"] = unit


def _money(source: dict[str, Any], document: dict[str, Any]) -> list[dict[str, Any]]:
    topic = "money-market"
    result = []
    coverage = _mapping(document.get("coverage"))
    for key, label in COVERAGE.items():
        row = _observation(topic, f"{topic}:coverage:{key}", label, f"/coverage/{key}",
                           source, document, status=document.get("status"), rights=_rights(document, coverage))
        value = coverage.get(key)
        _set_value(row, value, "count", restriction=_restriction(document, coverage),
                   allowed=type(value) is int and 0 <= value <= 1_000_000)
        result.append(row)
    markets = document.get("markets", [])
    if not isinstance(markets, list) or len(markets) > MAX_MARKETS:
        raise BriefError("money-market records exceed bounds or are malformed")
    seen = set()
    for index, market in enumerate(markets):
        if not isinstance(market, dict):
            raise BriefError("money-market entry must be an object")
        market_id = _token(market.get("market_id"), "market identity", length=32)
        if market_id in seen:
            raise BriefError("duplicate money-market identity")
        seen.add(market_id)
        benchmark = _mapping(market.get("benchmark"))
        benchmark_id = _token(benchmark["id"], "benchmark identity") if benchmark.get("id") else "unavailable"
        label = f"{benchmark_id} ({market_id})" if benchmark_id != "unavailable" else f"{market_id} benchmark"
        rights = benchmark.get("redistribution_status")
        rights = rights if rights in ("allowed", "restricted", "derived_only", "blocked", "unknown") else "not_reported"
        row = _observation(topic, f"{topic}:benchmark:{market_id}:{benchmark_id}", label,
                           f"/markets/{index}/benchmark/value", source, document,
                           observed_at=benchmark.get("event_time") or benchmark.get("asof"),
                           published_at=benchmark.get("published_at"), knowledge_at=benchmark.get("knowledge_time"),
                           status=benchmark.get("status") or market.get("status"),
                           evidence_class="observed", rights=rights)
        if benchmark_id != "unavailable":
            row["benchmark_id"] = benchmark_id
        codes = market.get("jurisdiction_codes", [])
        if not isinstance(codes, list) or len(codes) > 32 or any(not isinstance(code, str) or not re.fullmatch("[A-Z]{2}", code) for code in codes):
            raise BriefError("invalid jurisdiction codes")
        row["jurisdiction_codes"] = sorted(set(codes))
        publisher = _publisher_url(benchmark.get("source_url"))
        if publisher:
            row["original_publisher_url"] = publisher
        restriction = _restriction(document, market, benchmark)
        if benchmark and rights != "allowed":
            restriction = restriction or "withheld"
        unit = _unit(benchmark.get("unit"))
        _set_value(row, benchmark.get("value"), unit, restriction=restriction,
                   allowed=benchmark.get("availability") == "AVAILABLE" and unit is not None and _number(benchmark.get("value")))
        if row["availability"] == "reported" and _number(benchmark.get("change_1_observation")):
            change_unit = _unit(benchmark.get("change_unit"))
            if change_unit:
                row["source_reported_change"] = {
                    "value": benchmark["change_1_observation"], "unit": change_unit,
                    "period": "one_observation", "json_pointer": f"/markets/{index}/benchmark/change_1_observation",
                }
        result.append(row)
    return result


def _capital(source: dict[str, Any], document: dict[str, Any]) -> list[dict[str, Any]]:
    topic = "capital-market"
    capital = _mapping(document.get("capital_markets"))
    risk = _mapping(capital.get("risk_context"))
    inherited = _restriction(document, capital, risk)
    result = []
    funding = _mapping(risk.get("funding_stress"))
    row = _observation(topic, f"{topic}:funding-regime", "Seiche funding regime",
                       "/capital_markets/risk_context/funding_stress/regime", source, document,
                       observed_at=risk.get("as_of"), status=risk.get("status"), evidence_class="derived",
                       rights=_rights(document, capital, risk, funding))
    regime = _state(funding.get("regime"))
    _set_value(row, regime, restriction=inherited or _restriction(funding, {"status": regime}), allowed=regime != "not_reported")
    result.append(row)
    prices = _mapping(risk.get("market_prices"))
    for key, identifier, label, default_unit in (
        ("vix", "vix", "VIX", "pts"), ("high_yield_oas", "high-yield-oas", "High-yield option-adjusted spread", "%"),
    ):
        item = _mapping(prices.get(key))
        row = _observation(topic, f"{topic}:{identifier}", label,
                           f"/capital_markets/risk_context/market_prices/{key}/value", source, document,
                           observed_at=item.get("as_of"), status=item.get("status"), evidence_class="observed",
                           rights=_rights(document, capital, risk, prices, item))
        # Units are part of this endpoint's explicit adapter, never borrowed from other values.
        unit = _unit(item.get("unit", default_unit))
        _set_value(row, item.get("value"), unit,
                   restriction=inherited or _restriction(prices, item),
                   allowed=item.get("status") == "observed" and unit is not None and _number(item.get("value")))
        publisher = _publisher_url(item.get("source_url"))
        if publisher:
            row["original_publisher_url"] = publisher
        result.append(row)
    context = _mapping(risk.get("market_vs_plumbing"))
    row = _observation(topic, f"{topic}:market-vs-plumbing", "Seiche market-versus-plumbing reading",
                       "/capital_markets/risk_context/market_vs_plumbing/reading", source, document,
                       observed_at=context.get("asof"), status=risk.get("status"), evidence_class="derived",
                       rights=_rights(document, capital, risk, context))
    reading = context.get("reading")
    _set_value(row, reading, restriction=inherited or _restriction(context), allowed=isinstance(reading, str) and reading in READINGS)
    result.append(row)
    return result


def _liquidity(source: dict[str, Any], document: dict[str, Any]) -> list[dict[str, Any]]:
    topic = "market-liquidity"
    result = []
    regime = _state(document.get("funding_regime"))
    row = _observation(topic, f"{topic}:funding-regime", "Undertow funding regime", "/funding_regime",
                       source, document, observed_at=document.get("asof"), status=regime, evidence_class="derived", rights=_rights(document))
    _set_value(row, regime, restriction=_restriction(document, {"status": regime}), allowed=regime != "not_reported")
    result.append(row)
    segments = _mapping(document.get("segments"))
    for key in SEGMENTS:
        status = _state(segments.get(key))
        row = _observation(topic, f"{topic}:segment:{key}", f"{key} liquidity state", f"/segments/{key}",
                           source, document, observed_at=document.get("asof"), status=status, evidence_class="derived", rights=_rights(document))
        _set_value(row, status, restriction=_restriction(document, {"status": status}), allowed=status != "not_reported")
        result.append(row)
    return result


def _validate_packet(packet: dict[str, Any]) -> dict[str, dict[str, Any]]:
    _bounded_tree(packet)
    if packet.get("schema") != PACKET_SCHEMA or any(packet.get(key) != value for key, value in GUARDRAILS.items() if key != "financial_authority"):
        raise BriefError("input must be a Financial Evidence v0.1.5 packet with semantic guardrails")
    if packet.get("status") not in ("complete", "partial", "unavailable") or packet.get("status") != packet.get("transport_status"):
        raise BriefError("packet transport status is invalid")
    sources = packet.get("sources")
    if not isinstance(sources, list) or len(sources) > 6:
        raise BriefError("packet source count exceeds bounds")
    result = {}
    for source in sources:
        if not isinstance(source, dict):
            raise BriefError("source must be an object")
        topic = source.get("topic")
        if topic not in ROUTES:
            # The all-topics FE packet may also carry China or bank evidence; never project it.
            if topic in ("china-economy", "bank-risk"):
                continue
            raise BriefError("unsupported source topic")
        if topic in result:
            raise BriefError("duplicate source identity")
        if source.get("source_url") != ROUTES[topic][1] or source.get("product") != ROUTES[topic][0]:
            raise BriefError("source identity is outside fixed routes")
        if type(source.get("ok")) is not bool:
            raise BriefError("source transport marker must be boolean")
        if source.get("financial_authority", "none") != "none":
            raise BriefError("financial authority is outside the research contract")
        if source["ok"] and not isinstance(source.get("document"), dict):
            # A truncated remote response cannot silently become a successful empty brief.
            source = {**source, "ok": False}
        result[topic] = source
    return result


def _context(row: dict[str, Any] | None, *, suppress_value: bool = False) -> dict[str, Any] | None:
    if row is None:
        return None
    context = {key: row[key] for key in ("availability", "source_reported_status", "rights_status")}
    context["observed_at"] = row["clocks"]["observed_at"]
    if not suppress_value and row["availability"] == "reported":
        for key in ("value", "unit"):
            if key in row:
                context[key] = row[key]
    return context


def _validate_previous(previous: dict[str, Any]) -> None:
    _bounded_tree(previous)
    if previous.get("schema") != SCHEMA or any(previous.get(key) != value for key, value in GUARDRAILS.items()):
        raise BriefError("comparison baseline has a different schema or authority")
    if _instant(previous.get("generated_at")) is None:
        raise BriefError("comparison baseline needs a valid generation clock")
    rows = previous.get("observations")
    if not isinstance(rows, list) or len(rows) > MAX_OBSERVATIONS:
        raise BriefError("baseline observation count exceeds bounds")
    seen = set()
    for row in rows:
        if not isinstance(row, dict):
            raise BriefError("baseline observation must be an object")
        identifier = _token(row.get("id"), "baseline observation identity", length=192)
        if identifier in seen:
            raise BriefError("duplicate baseline identity")
        seen.add(identifier)
        topic = row.get("topic")
        if topic not in ROUTES or not identifier.startswith(topic + ":") or row.get("source_url") != ROUTES[topic][1] or row.get("product") != ROUTES[topic][0]:
            raise BriefError("baseline source identity is outside fixed routes")
        if row.get("financial_authority") != "none" or row.get("availability") not in ("reported", "withheld", "unavailable"):
            raise BriefError("invalid baseline availability or authority")
        if row.get("source_reported_status") not in STATES or row.get("rights_status") not in ("allowed", "restricted", "derived_only", "blocked", "unknown", "not_reported"):
            raise BriefError("invalid baseline state or rights")
        clocks = row.get("clocks")
        if not isinstance(clocks, dict) or "observed_at" not in clocks or any(value is not None and _clock(value) is None for value in clocks.values()):
            raise BriefError("invalid baseline observation clocks")
        if row["availability"] != "reported" and ("value" in row or "unit" in row):
            raise BriefError("baseline exposes an unavailable value")
        if row["availability"] == "reported":
            value = row.get("value")
            if not (_number(value) or isinstance(value, str) and (value in STATES or value in READINGS)):
                raise BriefError("invalid baseline value")
            if "unit" in row and _unit(row["unit"]) is None:
                raise BriefError("invalid baseline unit")
            if row["rights_status"] in RESTRICTED or row["rights_status"] == "unknown":
                raise BriefError("baseline exposes a restricted value")
            if ":benchmark:" in identifier and row["rights_status"] != "allowed":
                raise BriefError("baseline benchmark lacks source-reported permission")


def compare(observations: list[dict[str, Any]], previous: dict[str, Any] | None, generated_at: str) -> dict[str, Any]:
    result = {"status": "no_baseline", "previous_generated_at": None,
              "current_generated_at": generated_at, "changes": []}
    if previous is None:
        return result
    _validate_previous(previous)
    if _instant(previous["generated_at"]) > _instant(generated_at):
        raise BriefError("comparison baseline was generated after the current brief")
    result.update(status="compared", previous_generated_at=previous["generated_at"])
    before = {row["id"]: row for row in previous["observations"]}
    after = {row["id"]: row for row in observations}
    for identifier in sorted(before.keys() | after.keys()):
        old, new = before.get(identifier), after.get(identifier)
        comparable = False
        kind = None
        if old is None:
            kind = "added"
        elif new is None:
            kind = "missing"
        elif new["availability"] != old["availability"]:
            kind = "withheld" if new["availability"] == "withheld" else "missing" if new["availability"] == "unavailable" else "state_changed"
        elif old.get("unit") != new.get("unit"):
            kind = "unit_changed"
        else:
            old_clock = _instant(old["clocks"]["observed_at"])
            new_clock = _instant(new["clocks"]["observed_at"])
            value_changed = old.get("value") != new.get("value")
            state_changed = old["source_reported_status"] != new["source_reported_status"] or old["rights_status"] != new["rights_status"]
            if old_clock is not None and new_clock is not None and new_clock < old_clock:
                kind = "clock_regression"
            elif value_changed:
                kind = "state_changed" if isinstance(new.get("value"), str) else "value_changed" if old_clock is not None and new_clock is not None else "clock_unknown"
                comparable = kind == "value_changed" and old["availability"] == new["availability"] == "reported"
            elif state_changed:
                kind = "state_changed"
        if kind is None:
            continue
        # Labels come from the current adapter, never arbitrary baseline prose.
        label = new["label"] if new else identifier
        change = {"id": identifier, "label": label, "kind": kind, "comparable": comparable,
                  "previous": _context(old, suppress_value=new is not None and new["availability"] == "withheld"),
                  "current": _context(new)}
        if comparable and _number(old.get("value")) and _number(new.get("value")):
            change["delta"] = round(new["value"] - old["value"], 12)
            change["comparison_basis"] = (
                "same_observation_time" if _instant(old["clocks"]["observed_at"]) == _instant(new["clocks"]["observed_at"])
                else "new_observation_time"
            )
        result["changes"].append(change)
    return result


def build_brief(packet: dict[str, Any], previous: dict[str, Any] | None = None,
                *, generated_at: str | None = None) -> dict[str, Any]:
    generated_at = generated_at or utc_now()
    if _instant(generated_at) is None:
        raise BriefError("generation clock is invalid")
    source_map = _validate_packet(packet)
    sources, observations = [], []
    projectors = {"money-market": _money, "capital-market": _capital, "market-liquidity": _liquidity}
    for topic, (product, url) in ROUTES.items():
        source = source_map.get(topic, {"ok": False})
        receipt = {"topic": topic, "product": product, "source_url": url,
                   "transport_status": "retrieved" if source["ok"] else "unavailable",
                   "retrieved_at": _clock(source.get("retrieved_at"))}
        digest = source.get("content_sha256")
        if isinstance(digest, str) and re.fullmatch(r"sha256:[0-9a-f]{64}", digest):
            receipt["content_sha256"] = digest
        sources.append(receipt)
        document = source["document"] if source["ok"] else {}
        observations.extend(projectors[topic](source, document))
    if len(observations) > MAX_OBSERVATIONS:
        raise BriefError("observation output exceeds bounds")
    observations.sort(key=lambda row: row["id"])
    if len({row["id"] for row in observations}) != len(observations):
        raise BriefError("duplicate observation identity")
    succeeded = sum(source["transport_status"] == "retrieved" for source in sources)
    comparison = compare(observations, previous, generated_at)
    brief = {
        "schema": SCHEMA, "generated_at": generated_at,
        "transport_status": "complete" if succeeded == len(ROUTES) else "partial" if succeeded else "unavailable",
        **GUARDRAILS, "sources": sources, "observations": observations, "comparison": comparison,
        "summary": {"observations": len(observations),
                    **{state: sum(row["availability"] == state for row in observations) for state in ("reported", "withheld", "unavailable")},
                    "changes": len(comparison["changes"])},
        "limitations": list(LIMITATIONS),
    }
    if len(json.dumps(brief, ensure_ascii=False, allow_nan=False).encode("utf-8")) > MAX_OUTPUT_BYTES:
        raise BriefError("brief exceeds output byte limit")
    return brief


def _vendor():
    path = Path(__file__).with_name("financial_evidence_fetch.py")
    spec = importlib.util.spec_from_file_location("_market_brief_fe_015", path)
    if spec is None or spec.loader is None:
        raise BriefError("vendored Financial Evidence helper is unavailable")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def fetch_packet(*, deadline: float = 20.0, max_bytes: int = MAX_SOURCE_BYTES) -> dict[str, Any]:
    """Fetch three fixed sources in killable subprocesses under one wall deadline."""
    if not math.isfinite(deadline) or not 0 < deadline <= 30 or type(max_bytes) is not int or not 1 <= max_bytes <= MAX_SOURCE_BYTES:
        raise BriefError("deadline or source byte limit is outside bounds")
    end = time.monotonic() + deadline
    processes = {}
    sources = []
    try:
        for topic in ROUTES:
            processes[topic] = subprocess.Popen(
                [sys.executable, "-I", str(Path(__file__).resolve()), "--_fetch-source", topic,
                 "--max-bytes", str(max_bytes), "--deadline", str(deadline)],
                stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            )
        for topic, process in processes.items():
            source = {"topic": topic, "product": ROUTES[topic][0], "source_url": ROUTES[topic][1],
                      "retrieved_at": utc_now(), "ok": False}
            try:
                raw, _ = process.communicate(timeout=max(0.001, end - time.monotonic()))
                if process.returncode == 0:
                    source = {**load_json_bytes(raw, limit=MAX_INPUT_BYTES), "topic": topic}
            except (subprocess.TimeoutExpired, BriefError):
                process.kill()
                process.communicate()
            sources.append(source)
    finally:
        for process in processes.values():
            if process.poll() is None:
                process.kill()
                process.communicate()
    succeeded = sum(source.get("ok") is True for source in sources)
    status = "complete" if succeeded == len(ROUTES) else "partial" if succeeded else "unavailable"
    return {"schema": PACKET_SCHEMA, "status": status, "transport_status": status,
            **{key: value for key, value in GUARDRAILS.items() if key != "financial_authority"},
            "sources": sources}


def _md(value: Any) -> str:
    return html.escape(str(value), quote=True).replace("\\", "\\\\").replace("|", "\\|").replace("\n", " ").replace("`", "\\`")


def render_markdown(brief: dict[str, Any]) -> str:
    lines = ["# Market Brief", "", f"Generated: {_md(brief['generated_at'])}", "",
             f"{brief['summary']['reported']} reported observations; {brief['summary']['withheld']} withheld; {brief['summary']['unavailable']} unavailable.", "",
             "Source-reported context; public research, not a trade recommendation.", "", "## What changed", ""]
    comparison = brief["comparison"]
    if comparison["status"] == "no_baseline":
        lines.append("No comparison baseline. Save this JSON brief and supply it with --previous on the next check.")
    else:
        lines.append(f"Saved brief interval: {_md(comparison['previous_generated_at'])} to {_md(comparison['current_generated_at'])}.")
        if not comparison["changes"]:
            lines.append("No value or state changes in the selected observations. Refreshed timestamps alone are not changes.")
        for change in comparison["changes"]:
            old, new = change["previous"] or {}, change["current"] or {}
            before = str(old.get("value", old.get("availability", "absent"))) + (" " + old["unit"] if "unit" in old else "")
            after = str(new.get("value", new.get("availability", "absent"))) + (" " + new["unit"] if "unit" in new else "")
            basis = "; same observation time: revised or corrected value" if change.get("comparison_basis") == "same_observation_time" else ""
            lines.append(f"- {_md(change['label'])}: {_md(before)} → {_md(after)} ({_md(change['kind'])}{basis}); observation clocks {_md(old.get('observed_at') or 'not reported')} → {_md(new.get('observed_at') or 'not reported')}.")
    for topic in ROUTES:
        lines.extend(["", f"## {topic.replace('-', ' ').title()}", "", "| Observation | Reported value/state | Change vs prior source observation | Source status | Observation clock |", "|---|---|---|---|---|"])
        for row in brief["observations"]:
            if row["topic"] != topic:
                continue
            value = str(row.get("value", row["availability"])) + (" " + row["unit"] if "unit" in row else "")
            native_change = row.get("source_reported_change")
            native_text = f"{native_change['value']:+g} {native_change['unit']} (one observation)" if native_change else "not reported"
            lines.append(f"| {_md(row['label'])} | {_md(value)} | {_md(native_text)} | {_md(row['source_reported_status'])} | {_md(row['clocks']['observed_at'] or 'not reported')} |")
        lines.extend(["", f"[Source JSON]({ROUTES[topic][1]})"])
    lines.extend(["", "## Limits", ""] + [f"- {item}" for item in brief["limitations"]])
    return "\n".join(lines) + "\n"


def serialize(brief: dict[str, Any], output_format: str, *, max_output_bytes: int = MAX_OUTPUT_BYTES) -> str:
    if output_format == "json":
        text = json.dumps(brief, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + "\n"
    elif output_format == "markdown":
        text = render_markdown(brief)
    else:
        raise BriefError("unsupported output format")
    if len(text.encode("utf-8")) > max_output_bytes:
        raise BriefError("rendered brief exceeds output byte limit")
    return text


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", help="read a Financial Evidence packet locally instead of fetching")
    parser.add_argument("--previous", help="compare with a saved market-brief.v1 JSON brief")
    parser.add_argument("--format", choices=("json", "markdown"), default="json")
    parser.add_argument("--output", help="write the brief to this explicit local file")
    parser.add_argument("--deadline", type=float, default=20.0, help="overall fetch wall deadline, at most 30 seconds")
    parser.add_argument("--max-bytes", type=int, default=MAX_SOURCE_BYTES, help="maximum bytes per fetched source, at most 1048576")
    parser.add_argument("--_fetch-source", choices=tuple(ROUTES), help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    try:
        if not math.isfinite(args.deadline) or not 0 < args.deadline <= 30 or not 1 <= args.max_bytes <= MAX_SOURCE_BYTES:
            raise BriefError("deadline or source byte limit is outside bounds")
        if args._fetch_source:
            vendor = _vendor()
            source = vendor.ROUTES[args._fetch_source][0]
            if source.url != ROUTES[args._fetch_source][1]:
                raise BriefError("vendored route changed")
            result = vendor.fetch_source(source, max_bytes=args.max_bytes, timeout=min(args.deadline, 10))
            sys.stdout.write(json.dumps(result, ensure_ascii=False, allow_nan=False))
            return 0
        if args.output and any(Path(args.output).resolve() == Path(path).resolve() for path in (args.input, args.previous) if path):
            raise BriefError("output must not overwrite an input or comparison baseline")
        previous = read_json(args.previous, limit=MAX_OUTPUT_BYTES) if args.previous else None
        if previous is not None:
            _validate_previous(previous)
        packet = read_json(args.input) if args.input else fetch_packet(deadline=args.deadline, max_bytes=args.max_bytes)
        brief = build_brief(packet, previous)
        rendered = serialize(brief, args.format)
        if args.output:
            Path(args.output).write_text(rendered, encoding="utf-8")
        else:
            sys.stdout.write(rendered)
        return {"complete": 0, "partial": 1, "unavailable": 2}[brief["transport_status"]]
    except (BriefError, OSError, ValueError, TypeError, RecursionError) as exc:
        # No raw source values, local paths, or arbitrary exception text enter output.
        message = str(exc) if isinstance(exc, BriefError) else "input, output, or retrieval failed"
        print(f"market-brief: {message}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
