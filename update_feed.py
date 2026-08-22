#!/usr/bin/env python3
"""Mechanical utilities for maintaining data/updates.json: id hashing, schema validation,
dedup, and age-based retirement.

Drafting new entries — searching the curated sources below and writing the actual summaries —
is done by the scheduled Claude agent (see .github/workflows/update.yml and
.github/workflows/update-feed-prompt.md), not by this script. This script only owns the parts
that shouldn't depend on model judgment on a given run: an id either matches an existing entry
or it doesn't, a category is either in the allowed set or it isn't.
"""

import argparse
import hashlib
import json
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent
UPDATES_PATH = ROOT / "data" / "updates.json"

RETIREMENT_AGE_DAYS = 183  # ~6 months — see plan.md §7; tune once real volume is visible

ALLOWED_CATEGORIES = {"Research", "Treatment", "Clinical Trial", "Technology", "Policy"}
ALLOWED_SOURCE_TYPES = {"peer-reviewed", "news report", "press release", "preprint"}
ALLOWED_STATUSES = {"active", "archived"}
REQUIRED_FIELDS = {
    "id", "title", "category", "summary", "source_name", "source_url",
    "source_type", "date_published", "date_added", "status",
}
BANNED_WORDS = ("breakthrough", "cure", "miracle")

# Curated sources for the update agent to check each run — see plan.md §5.
SOURCES = [
    {"name": "Michael J. Fox Foundation research news", "url": "https://www.michaeljfox.org/research-news"},
    {"name": "Parkinson's Foundation newsroom", "url": "https://www.parkinson.org/newsroom"},
    {"name": "Parkinson's News Today", "url": "https://parkinsonsnewstoday.com/news/"},
    {"name": "ClinicalTrials.gov (Parkinson's disease)", "url": "https://clinicaltrials.gov/search?cond=Parkinson%27s+Disease"},
    {"name": "PubMed (Parkinson's disease)", "url": "https://pubmed.ncbi.nlm.nih.gov/?term=parkinson%27s+disease"},
]


def compute_id(source_url: str) -> str:
    return hashlib.sha1(source_url.encode("utf-8")).hexdigest()


def load_entries(path: Path = UPDATES_PATH) -> list:
    if not path.exists():
        return []
    return json.loads(path.read_text())


def save_entries(entries: list, path: Path = UPDATES_PATH) -> None:
    path.write_text(json.dumps(entries, indent=2) + "\n")


def existing_ids(entries: list) -> set:
    return {e["id"] for e in entries}


def validate_entry(entry: dict) -> list:
    """Return validation error strings; an empty list means the entry is well-formed."""
    errors = []
    missing = REQUIRED_FIELDS - entry.keys()
    if missing:
        errors.append(f"missing fields: {sorted(missing)}")
        return errors  # remaining checks assume the fields exist

    if entry["category"] not in ALLOWED_CATEGORIES:
        errors.append(f"unknown category: {entry['category']!r}")
    if entry["source_type"] not in ALLOWED_SOURCE_TYPES:
        errors.append(f"unknown source_type: {entry['source_type']!r}")
    if entry["status"] not in ALLOWED_STATUSES:
        errors.append(f"unknown status: {entry['status']!r}")

    expected_id = compute_id(entry["source_url"])
    if entry["id"] != expected_id:
        errors.append(f"id does not match sha1(source_url); expected {expected_id}")

    for date_field in ("date_published", "date_added"):
        try:
            datetime.strptime(entry[date_field], "%Y-%m-%d")
        except ValueError:
            errors.append(f"{date_field} is not YYYY-MM-DD: {entry[date_field]!r}")

    word_count = len(entry["summary"].split())
    if not (15 <= word_count <= 120):
        errors.append(f"summary looks too short/long ({word_count} words) — expected ~2-4 sentences")

    lowered = f"{entry['title']} {entry['summary']}".lower()
    for banned in BANNED_WORDS:
        if banned in lowered:
            errors.append(
                f"contains {banned!r} — only allowed if the source itself makes that exact "
                "claim carefully (plan.md §5); double-check before overriding this check"
            )

    return errors


def add_drafts(new_entries: list, path: Path = UPDATES_PATH) -> list:
    """Validate + dedupe (against active AND archived entries) + append. Returns what was added."""
    current = load_entries(path)
    known_ids = existing_ids(current)
    added = []

    for entry in new_entries:
        entry.setdefault("id", compute_id(entry["source_url"]))
        entry.setdefault("status", "active")
        entry.setdefault("date_added", date.today().isoformat())

        errors = validate_entry(entry)
        if errors:
            print(f"SKIP {entry.get('source_url', '?')}: {'; '.join(errors)}", file=sys.stderr)
            continue
        if entry["id"] in known_ids:
            print(f"SKIP {entry['source_url']}: duplicate of an existing entry", file=sys.stderr)
            continue

        current.append(entry)
        known_ids.add(entry["id"])
        added.append(entry)

    save_entries(current, path)
    return added


def retire_stale_entries(path: Path = UPDATES_PATH, max_age_days: int = RETIREMENT_AGE_DAYS) -> list:
    """Flip active entries older than max_age_days (by date_published) to archived."""
    entries = load_entries(path)
    cutoff = date.today() - timedelta(days=max_age_days)
    retired = []

    for entry in entries:
        if entry["status"] != "active":
            continue
        published = datetime.strptime(entry["date_published"], "%Y-%m-%d").date()
        if published < cutoff:
            entry["status"] = "archived"
            retired.append(entry)

    if retired:
        save_entries(entries, path)
    return retired


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("retire", help="Archive active entries older than the retirement age.")

    add_parser = sub.add_parser("add", help="Validate + dedupe + append drafts from a JSON file.")
    add_parser.add_argument("drafts_file", type=Path, help="Path to a JSON array of candidate entries.")

    sub.add_parser("validate", help="Validate every entry currently in data/updates.json.")

    args = parser.parse_args()

    if args.command == "retire":
        retired = retire_stale_entries()
        print(f"Retired {len(retired)} entr{'y' if len(retired) == 1 else 'ies'}.")

    elif args.command == "add":
        drafts = json.loads(args.drafts_file.read_text())
        added = add_drafts(drafts)
        print(f"Added {len(added)} of {len(drafts)} drafts.")

    elif args.command == "validate":
        entries = load_entries()
        bad = 0
        for entry in entries:
            errors = validate_entry(entry)
            if errors:
                bad += 1
                print(f"INVALID {entry.get('source_url', '?')}: {'; '.join(errors)}", file=sys.stderr)
        print(f"{len(entries) - bad}/{len(entries)} entries valid.")
        if bad:
            sys.exit(1)


if __name__ == "__main__":
    main()
