"""Contract and adversarial checks for the standalone Market Brief engine."""

from __future__ import annotations

from contextlib import redirect_stderr, redirect_stdout
from copy import deepcopy
from importlib.util import module_from_spec, spec_from_file_location
from io import StringIO
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "skills" / "market-brief" / "scripts" / "market_brief.py"
SPEC = spec_from_file_location("market_brief", SCRIPT)
assert SPEC and SPEC.loader
brief = module_from_spec(SPEC)
sys.modules[SPEC.name] = brief
SPEC.loader.exec_module(brief)

EARLIER = "2026-09-05T08:00:00Z"
LATER = "2026-09-06T08:00:00Z"


def benchmark(market_id, identifier, value):
    return {
        "market_id": market_id,
        "jurisdiction_codes": [market_id[:2]],
        "status": "LIVE_REFERENCE",
        "benchmark": {
            "id": identifier, "label": "IGNORED NATIVE LABEL",
            "value": value, "unit": "%", "availability": "AVAILABLE",
            "redistribution_status": "allowed", "status": "FRESH",
            "asof": "2026-09-03", "event_time": "2026-09-03T00:00:00Z",
            "published_at": "2026-09-04T00:00:00Z",
            "knowledge_time": "2026-09-04T02:00:00Z",
            "source_url": "https://fred.stlouisfed.org/",
            "change_1_observation": 1, "change_unit": "bp",
            "history": [["2020-01-01", 99]],
        },
    }


def packet():
    documents = {
        "money-market": {
            "generated_at": EARLIER, "status": "PARTIAL",
            "coverage": {key: 2 for key in brief.COVERAGE},
            "markets": [benchmark("US-USD", "US.NYFED.SOFR", 3.66), benchmark("AU-AUD", "AU.RBA.AONIA", 4.35)],
            "plain_language": "ARBITRARY PROSE MUST NOT APPEAR",
        },
        "capital-market": {
            "generated_at": EARLIER, "status": "derived",
            "capital_markets": {"status": "derived", "risk_context": {
                "status": "derived", "as_of": "2026-09-03",
                "funding_stress": {"regime": "EROSION", "value": 44.9},
                "market_prices": {
                    "vix": {"status": "observed", "value": 14.32, "as_of": "2026-09-03"},
                    "high_yield_oas": {"status": "observed", "value": 2.65, "as_of": "2026-09-03"},
                },
                "market_vs_plumbing": {"asof": "2026-09-03", "reading": "plumbing leads price", "tell": 46.7},
            }},
        },
        "market-liquidity": {
            "asof": "2026-09-05", "funding_regime": "EROSION",
            "segments": {key: "NORMAL" for key in brief.SEGMENTS},
            "full_fidelity": "https://attacker.invalid/private",
        },
    }
    return {
        "schema": brief.PACKET_SCHEMA, "status": "complete", "transport_status": "complete",
        **{key: value for key, value in brief.GUARDRAILS.items() if key != "financial_authority"},
        "sources": [{
            "topic": topic, "product": route[0], "source_url": route[1],
            "ok": True, "retrieved_at": EARLIER, "document": documents[topic],
            "content_sha256": "sha256:" + "0" * 64,
        } for topic, route in brief.ROUTES.items()],
    }


def get_row(result, suffix):
    return next(row for row in result["observations"] if row["id"].endswith(suffix))


class ProjectionTests(unittest.TestCase):
    def test_projected_fields_preserve_provenance_and_exclude_history_and_prose(self):
        result = brief.build_brief(packet(), generated_at=EARLIER)
        row = get_row(result, "US.NYFED.SOFR")
        self.assertEqual(row["value"], 3.66)
        self.assertEqual(row["unit"], "%")
        self.assertEqual(row["source_reported_status"], "FRESH")
        self.assertEqual(row["rights_status"], "allowed")
        self.assertEqual(row["clocks"]["observed_at"], "2026-09-03T00:00:00Z")
        self.assertEqual(row["clocks"]["retrieved_at"], EARLIER)
        self.assertEqual(row["json_pointer"], "/markets/0/benchmark/value")
        self.assertEqual(row["original_publisher_url"], "https://fred.stlouisfed.org/")
        self.assertEqual(row["source_reported_change"]["period"], "one_observation")
        text = brief.serialize(result, "json")
        for excluded in ("ARBITRARY PROSE", "IGNORED NATIVE LABEL", '"history"', "attacker.invalid", '"tell"', "44.9", "46.7"):
            self.assertNotIn(excluded, text)
        for name, value in brief.GUARDRAILS.items():
            self.assertEqual(result[name], value)
        self.assertEqual(result["comparison"]["status"], "no_baseline")
        markdown = brief.serialize(result, "markdown")
        self.assertIn("Change vs prior source observation", markdown)
        self.assertIn("+1 bp (one observation)", markdown)

    def test_restricted_or_unknown_rights_omit_numeric_value_and_change(self):
        for status in ("restricted", "derived_only", "unknown", None):
            data = packet()
            item = data["sources"][0]["document"]["markets"][0]["benchmark"]
            item["redistribution_status"] = status
            result = brief.build_brief(data, generated_at=LATER)
            row = get_row(result, "US.NYFED.SOFR")
            self.assertEqual(row["availability"], "withheld")
            for field in ("value", "unit", "source_reported_change"):
                self.assertNotIn(field, row)

    def test_explicit_unavailable_has_no_value_even_if_upstream_leaks_one(self):
        data = packet()
        data["sources"][0]["document"]["markets"][0]["benchmark"]["availability"] = "UNAVAILABLE"
        row = get_row(brief.build_brief(data), "US.NYFED.SOFR")
        self.assertEqual(row["availability"], "unavailable")
        self.assertNotIn("value", row)

    def test_parent_restriction_withholds_capital_values(self):
        data = packet()
        data["sources"][1]["document"]["capital_markets"]["status"] = "restricted"
        result = brief.build_brief(data)
        for row in result["observations"]:
            if row["topic"] == "capital-market":
                self.assertEqual(row["availability"], "withheld")
                self.assertNotIn("value", row)

    def test_explicit_failed_source_evidence_or_unknown_rights_prevent_values(self):
        for field, value, expected in (("ok", False, "unavailable"), ("evidence_eligible", False, "unavailable"), ("redistribution_status", "unknown", "withheld")):
            data = packet()
            data["sources"][1]["document"][field] = value
            row = get_row(brief.build_brief(data), "capital-market:vix")
            self.assertEqual(row["availability"], expected)
            self.assertNotIn("value", row)

    def test_restricted_regime_is_not_a_reported_value(self):
        data = packet()
        data["sources"][2]["document"]["funding_regime"] = "RESTRICTED"
        row = get_row(brief.build_brief(data), "market-liquidity:funding-regime")
        self.assertEqual(row["availability"], "withheld")
        self.assertNotIn("value", row)

    def test_partial_transport_and_missing_document_remain_explicit(self):
        data = packet()
        data["sources"][1]["ok"] = False
        data["sources"][2].pop("document")
        result = brief.build_brief(data)
        self.assertEqual(result["transport_status"], "partial")
        self.assertEqual(result["sources"][1]["transport_status"], "unavailable")
        self.assertEqual(result["sources"][2]["transport_status"], "unavailable")
        self.assertNotIn("value", get_row(result, "capital-market:vix"))
        self.assertNotIn("value", get_row(result, "market-liquidity:segment:UST"))

    def test_missing_all_sources_is_unavailable_not_calm(self):
        data = packet()
        data["sources"] = []
        result = brief.build_brief(data)
        self.assertEqual(result["transport_status"], "unavailable")
        self.assertEqual(result["summary"]["reported"], 0)

    def test_duplicate_market_or_source_identity_rejected(self):
        for field in ("source", "market"):
            data = packet()
            if field == "source":
                data["sources"].append(deepcopy(data["sources"][0]))
            else:
                data["sources"][0]["document"]["markets"].append(deepcopy(data["sources"][0]["document"]["markets"][0]))
            with self.assertRaises(brief.BriefError):
                brief.build_brief(data)

    def test_arbitrary_source_url_and_hostile_identity_rejected(self):
        for attack in ("source", "identity"):
            data = packet()
            if attack == "source":
                data["sources"][0]["source_url"] = "http://127.0.0.1/secrets"
            else:
                data["sources"][0]["document"]["markets"][0]["market_id"] = "<script>alert(1)</script>"
            with self.assertRaises(brief.BriefError):
                brief.build_brief(data)

    def test_hostile_publisher_and_reading_are_never_output(self):
        data = packet()
        data["sources"][0]["document"]["markets"][0]["benchmark"]["source_url"] = "javascript:alert(123)"
        data["sources"][1]["document"]["capital_markets"]["risk_context"]["market_vs_plumbing"]["reading"] = "<script>alert(123)</script>"
        result = brief.build_brief(data)
        self.assertNotIn("original_publisher_url", get_row(result, "US.NYFED.SOFR"))
        self.assertNotIn("value", get_row(result, "capital-market:market-vs-plumbing"))
        self.assertNotIn("alert(123)", brief.serialize(result, "markdown"))


class ComparisonTests(unittest.TestCase):
    def setUp(self):
        self.data = packet()
        self.previous = brief.build_brief(self.data, generated_at=EARLIER)

    def current(self):
        return brief.build_brief(self.data, self.previous, generated_at=LATER)

    def test_generation_retrieval_and_forward_observation_clocks_are_not_changes(self):
        for source in self.data["sources"]:
            source["retrieved_at"] = LATER
            source["document"]["generated_at"] = LATER
        self.data["sources"][0]["document"]["markets"][0]["benchmark"]["event_time"] = "2026-09-04T00:00:00Z"
        self.assertEqual(self.current()["comparison"]["changes"], [])

    def test_reordering_market_arrays_does_not_create_changes(self):
        self.data["sources"][0]["document"]["markets"].reverse()
        result = self.current()
        self.assertEqual(result["comparison"]["changes"], [])
        self.assertEqual(get_row(result, "US.NYFED.SOFR")["json_pointer"], "/markets/1/benchmark/value")

    def test_true_change_includes_previous_value_units_and_observation_interval(self):
        self.data["sources"][0]["document"]["markets"][0]["benchmark"]["value"] = 3.76
        result = self.current()
        changes = result["comparison"]["changes"]
        self.assertEqual(len(changes), 1)
        change = changes[0]
        self.assertEqual(change["kind"], "value_changed")
        self.assertEqual(change["delta"], 0.1)
        self.assertEqual(change["previous"]["value"], 3.66)
        self.assertEqual(change["current"]["unit"], "%")
        self.assertEqual(change["previous"]["observed_at"], "2026-09-03T00:00:00Z")
        self.assertEqual(result["comparison"]["previous_generated_at"], EARLIER)
        self.assertEqual(change["comparison_basis"], "same_observation_time")
        self.assertIn("same observation time: revised or corrected value", brief.serialize(result, "markdown"))

    def test_new_observation_period_is_explicit(self):
        item = self.data["sources"][0]["document"]["markets"][0]["benchmark"]
        item.update(event_time="2026-09-04T00:00:00Z", value=3.76)
        change = self.current()["comparison"]["changes"][0]
        self.assertEqual(change["comparison_basis"], "new_observation_time")

    def test_unit_changes_are_not_numerically_comparable(self):
        item = self.data["sources"][0]["document"]["markets"][0]["benchmark"]
        item.update(value=366, unit="bp")
        change = self.current()["comparison"]["changes"][0]
        self.assertEqual(change["kind"], "unit_changed")
        self.assertFalse(change["comparable"])
        self.assertNotIn("delta", change)

    def test_observation_clock_regression_is_flagged_and_not_compared(self):
        item = self.data["sources"][0]["document"]["markets"][0]["benchmark"]
        item.update(event_time="2026-09-02T00:00:00Z", value=4)
        change = self.current()["comparison"]["changes"][0]
        self.assertEqual(change["kind"], "clock_regression")
        self.assertFalse(change["comparable"])
        self.assertNotIn("delta", change)

    def test_unknown_observation_clock_does_not_enable_numeric_delta(self):
        item = self.data["sources"][0]["document"]["markets"][0]["benchmark"]
        item.update(event_time=None, asof=None, value=4)
        change = self.current()["comparison"]["changes"][0]
        self.assertEqual(change["kind"], "clock_unknown")
        self.assertNotIn("delta", change)

    def test_state_change_detected(self):
        self.data["sources"][2]["document"]["segments"]["UST"] = "PARTIAL"
        change = self.current()["comparison"]["changes"][0]
        self.assertEqual(change["current"]["value"], "PARTIAL")
        self.assertEqual(change["previous"]["value"], "NORMAL")
        self.assertEqual(change["kind"], "state_changed")
        self.assertFalse(change["comparable"])

    def test_missing_added_and_withheld_states_are_distinct(self):
        self.data["sources"][0]["document"]["markets"].pop()
        self.data["sources"][0]["document"]["markets"].append(benchmark("IN-INR", "IN.MARKET.CALL_WAR", 4.95))
        self.data["sources"][0]["document"]["markets"][0]["benchmark"]["availability"] = "RESTRICTED"
        changes = self.current()["comparison"]["changes"]
        self.assertEqual({item["kind"] for item in changes}, {"missing", "added", "withheld"})
        withheld = next(item for item in changes if item["kind"] == "withheld")
        self.assertNotIn("value", withheld["current"])
        self.assertNotIn("value", withheld["previous"])

    def test_malformed_duplicate_or_future_baselines_rejected(self):
        cases = []
        value = deepcopy(self.previous)
        value["schema"] = "other.v1"
        cases.append(value)
        value = deepcopy(self.previous)
        value["observations"].append(deepcopy(value["observations"][0]))
        cases.append(value)
        value = deepcopy(self.previous)
        value["generated_at"] = "2099-01-01T00:00:00Z"
        cases.append(value)
        value = deepcopy(self.previous)
        value["observations"][0]["clocks"]["observed_at"] = "invalid"
        cases.append(value)
        value = deepcopy(self.previous)
        value["observations"][0].update(availability="withheld", value=123)
        cases.append(value)
        for baseline in cases:
            with self.subTest(baseline=baseline.get("schema")):
                with self.assertRaises(brief.BriefError):
                    brief.build_brief(self.data, baseline, generated_at=LATER)


class BoundsAndCliTests(unittest.TestCase):
    def test_strict_json_rejects_nan_infinity_duplicate_keys_and_oversize(self):
        for raw in (b'{"a":NaN}', b'{"a":Infinity}', b'{"a":1e999}', b'{"a":1e-999}', b'{"a":' + b'1' * 101 + b'}', b'{"a":1,"a":2}', b'{"a":'):
            with self.assertRaises(brief.BriefError):
                brief.load_json_bytes(raw)
        with self.assertRaises(brief.BriefError):
            brief.load_json_bytes(b'{"a":1}', limit=2)

    def test_excessive_depth_and_market_records_rejected(self):
        with self.assertRaises(brief.BriefError):
            brief.load_json_bytes(b'{"a":' + b'[' * 60 + b'0' + b']' * 60 + b'}')
        data = packet()
        data["sources"][0]["document"]["markets"] *= 20
        with self.assertRaises(brief.BriefError):
            brief.build_brief(data)

    def test_nonfinite_in_memory_packet_is_rejected(self):
        data = packet()
        data["sources"][0]["document"]["markets"][0]["benchmark"]["value"] = float("nan")
        with self.assertRaises(brief.BriefError):
            brief.build_brief(data)

    def test_output_cap_fails_before_emitting_truncated_output(self):
        result = brief.build_brief(packet())
        for output_format in ("json", "markdown"):
            with self.assertRaises(brief.BriefError):
                brief.serialize(result, output_format, max_output_bytes=100)

    def test_offline_cli_does_not_fetch_or_implicitly_store(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "packet.json"
            path.write_text(json.dumps(packet()))
            output = StringIO()
            with patch.object(brief, "fetch_packet", side_effect=AssertionError("network")), redirect_stdout(output):
                result = brief.main(["--input", str(path)])
            self.assertEqual(result, 0)
            self.assertEqual(json.loads(output.getvalue())["schema"], brief.SCHEMA)
            self.assertEqual(sorted(item.name for item in Path(directory).iterdir()), ["packet.json"])

    def test_cli_explicit_output_and_overwrite_input_protection(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "packet.json"
            path.write_text(json.dumps(packet()))
            destination = Path(directory) / "brief.md"
            self.assertEqual(brief.main(["--input", str(path), "--output", str(destination), "--format", "markdown"]), 0)
            self.assertIn("No comparison baseline", destination.read_text())
            before = path.read_bytes()
            with redirect_stderr(StringIO()):
                self.assertEqual(brief.main(["--input", str(path), "--output", str(path)]), 2)
            self.assertEqual(path.read_bytes(), before)

    def test_unavailable_cli_still_emits_honest_brief(self):
        data = packet()
        data["sources"] = []
        output = StringIO()
        with patch.object(brief, "fetch_packet", return_value=data), redirect_stdout(output):
            self.assertEqual(brief.main([]), 2)
        self.assertEqual(json.loads(output.getvalue())["transport_status"], "unavailable")

    def test_deadline_and_byte_arguments_reject_nonfinite_or_unbounded_values(self):
        for argv in (["--deadline", "nan"], ["--deadline", "inf"], ["--deadline", "31"], ["--max-bytes", "1048577"]):
            with patch.object(brief, "fetch_packet", side_effect=AssertionError("network")), redirect_stderr(StringIO()):
                self.assertEqual(brief.main(argv), 2)

    def test_deadline_kills_stalled_children_and_returns_partial_packet(self):
        class Child:
            def __init__(self, command, **kwargs):
                self.topic = command[command.index("--_fetch-source") + 1]
                self.returncode = None
                self.killed = False

            def communicate(self, timeout=None):
                if self.topic == "money-market" and not self.killed:
                    raise subprocess.TimeoutExpired("test", timeout)
                self.returncode = -9 if self.killed else 0
                item = next(source for source in packet()["sources"] if source["topic"] == self.topic)
                return json.dumps(item).encode(), b""

            def kill(self):
                self.killed = True

            def poll(self):
                return self.returncode

        children = []

        def make_child(*args, **kwargs):
            child = Child(*args, **kwargs)
            children.append(child)
            return child

        with patch.object(brief.subprocess, "Popen", side_effect=make_child):
            result = brief.fetch_packet(deadline=0.05)
        self.assertEqual(result["transport_status"], "partial")
        self.assertTrue(children[0].killed)
        self.assertFalse(result["sources"][0]["ok"])

    def test_vendored_helper_hash_and_attribution(self):
        path = SCRIPT.with_name("financial_evidence_fetch.py")
        expected = "4b21c4a14179efdbac585811d11b22026e5c73999c0428d850fcbd5bc227e598"
        self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), expected)
        notice = (ROOT / "THIRD_PARTY_NOTICES.md").read_text()
        self.assertEqual(SCRIPT.with_name("THIRD_PARTY_NOTICES.md").read_text(), notice)
        self.assertIn(expected, notice)
        self.assertIn("Copyright (c) 2026 Liquidity Lab contributors", notice)
        self.assertIn("Permission is hereby granted", notice)


if __name__ == "__main__":
    unittest.main()
