# Weekly Parkinson's Advances update — agent instructions

You are running the scheduled research pass for the "Parkinson's Advances" feed. Full context
and rationale live in `parkinsons-advances-plan.md` at the repo root — skim it if anything below
is ambiguous.

## What to do, in order

1. Read `update_feed.py` for the current curated `SOURCES` list, the data schema, and the
   editorial validation rules in `validate_entry()` — treat those as binding, not advisory.
2. Check each source in `SOURCES` for items published since the newest `date_published` already
   present in `data/updates.json`. This is a weekly incremental pass, not a backfill — skip
   anything older than what's already in the feed.
3. For each genuinely new, relevant item, draft an entry matching the schema used in
   `data/updates.json`:
   - `title`: short, plain-language headline (rewrite clickbait, don't copy it)
   - `category`: exactly one of Research / Treatment / Clinical Trial / Technology / Policy
   - `summary`: 2–4 sentences, plain language, no hype (see guardrails below)
   - `source_name`, `source_url` (the original piece, not a secondhand aggregator)
   - `source_type`: peer-reviewed / news report / press release / preprint — pick the one that
     honestly describes the source, not the one that sounds most credible
   - `date_published` (the source's date, not today's), `date_added` (today), `status: "active"`
4. Write the drafted entries to a scratch JSON file (a plain array of entry objects — `id` is
   optional, `update_feed.py` fills it in from `source_url`), then run:
   ```
   python update_feed.py add <scratch-file>
   ```
   This validates each entry and dedupes against every entry already in `data/updates.json`
   (active *and* archived) — never hand-edit `data/updates.json` directly.
5. If `add` skipped anything, read why on stderr. A validation failure almost always means the
   draft needs fixing (summary too long/short, a banned word slipped in) — don't treat the check
   itself as the thing to work around.
6. If zero entries were added, stop here. Do not open a PR for an empty diff.
7. Otherwise: create a branch named `feed-update-YYYY-MM-DD` (today's date), commit the change to
   `data/updates.json`, push, and open a pull request. In the PR description, list each new
   entry's title and source, and separately note how many entries were archived by the
   `retire` step that already ran earlier in this workflow (see `update.yml`) — that step is
   deterministic (age-based) and doesn't need your judgment, just mention the count.

## Editorial guardrails (binding — see plan.md §5)

- No "breakthrough" / "cure" / "miracle" language unless the source itself makes that exact
  claim carefully — and even then, reflect the actual claim, not an amplified version of it.
  (`update_feed.py` will hard-block these words; that's a backstop, not the only bar to clear —
  plenty of hype doesn't need those specific words.)
- Note trial phase (Phase I/II/III) and sample size for clinical trial entries.
- If a claim comes from a press release rather than peer review, `source_type` must say so —
  don't round a press release up to "news report" because it reads more credibly.
- One link per entry, to the original piece — never a secondhand aggregator when the primary
  source is findable.
- If you're not confident a summary is accurate to the source, leave the item out rather than
  guess. A missed item next week is cheap; a wrong medical claim published to the feed is not.
