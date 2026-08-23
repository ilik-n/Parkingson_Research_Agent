# Parkinson's Advances

**Live site: https://ilik-n.github.io/Parkingson_Research_Agent/**

A lightweight, periodically-updated feed of recent developments in Parkinson's disease research,
treatment, and clinical trials — plain-language summaries, not re-quoted abstracts, each linked
back to its original source.

This is a curated summary feed for general information only. It is not a diagnosis tool and does
not provide medical advice.

## How it works

- **Display layer** (`index.html`, `styles.css`, `script.js`): a static page that reads
  [`data/updates.json`](data/updates.json) and renders it client-side — card feed, category
  filter, search (including archived/retired entries), and "load more" pagination. Hosted on
  GitHub Pages, served from `main`.
- **Update layer**: a scheduled agent ([`.github/workflows/update.yml`](.github/workflows/update.yml),
  Mondays 13:00 UTC + manual `workflow_dispatch`) checks the curated sources in
  [`update_feed.py`](update_feed.py), drafts new entries, and opens a **pull request** — it never
  pushes drafts straight to `main`.
- **Review layer**: merging that PR is the publish step. A human reads the diff before anything
  goes live — the guardrail against a hallucinated summary, a dead link, or hype language is a
  person reading the change, not just the agent's own judgment.
- Entries older than a year are automatically flipped to `"status": "archived"` (still in the
  data file, just excluded from the default feed — searchable, not deleted).

Full design rationale and open questions live in
[`parkinsons-advances-plan.md`](parkinsons-advances-plan.md).

## Repo layout

```
index.html                        # page shell + layout
styles.css                        # visual design
script.js                         # fetches updates.json, renders + filters + searches client-side
data/updates.json                 # the feed content (active + archived) — source of truth
update_feed.py                    # validate / dedupe+add / retire — mechanical utilities only
.github/workflows/
  update.yml                      # weekly cron (+ manual dispatch) — runs the agent, opens a PR
  update-feed-prompt.md           # agent instructions: sources, schema, editorial guardrails
```

## Running locally

It's a static site with no build step:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## Updating the feed manually

```bash
python update_feed.py validate   # check data/updates.json is well-formed
python update_feed.py retire     # archive entries older than a year
python update_feed.py add drafts.json   # validate + dedupe + append a JSON array of new entries
```

## Email digest (optional, not deployed yet)

There's a signup form on the site for an email digest, by category. It's built but inert until
deployed — see [`email/README.md`](email/README.md) for the runbook (a Cloudflare Worker + D1
for storage, Resend for sending, both free at this project's scale).

## One-time setup for the scheduled agent

The weekly workflow authenticates with a Claude Pro/Max subscription (OAuth token), not a paid
API key:

1. Install the [Claude GitHub App](https://github.com/apps/claude) on this repo.
2. Run `claude setup-token` (while logged into your subscription) to generate a 1-year token.
3. Add it as a repo secret named `CLAUDE_CODE_OAUTH_TOKEN` (Settings → Secrets and variables →
   Actions).

See the comments in `update.yml` for known rough edges (token expiry/refresh on GitHub Actions).
