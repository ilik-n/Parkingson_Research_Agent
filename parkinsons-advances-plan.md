# Plan: "Parkinson's Advances" — a lightweight, periodically-updating research feed

Status: draft plan for implementation. This is meant to be a starting point, not a locked spec —
flag disagreements, cut anything that seems like overkill, and adjust as the build reveals what
actually matters. Open decision points are marked with 🔧 throughout.

## 1. What this is

A small single-page site that shows a chronological feed of recent developments in Parkinson's
disease research, treatment, and clinical trials. Each entry is:

- A headline
- A 2–4 sentence plain-language summary (not just a re-quoted abstract)
- A category tag (Research / Treatment / Clinical Trial / Technology / Policy)
- The publication date and the date it was added to the feed
- A link to the original source article
- A source-type label (peer-reviewed study / news report / press release / preprint)

It is not a diagnosis tool, not medical advice, and should say so once, quietly, in the footer.

## 2. What "live" means here, realistically

There's no single clean real-time API for "Parkinson's news." So "live" = **periodically
refreshed, not continuously polling**. Two layers:

1. **Update layer (runs on a schedule):** a scheduled Claude agent searches the curated sources,
   drafts summaries for new items, and appends them to `data/updates.json` **on a new branch** —
   never directly to `main`.
2. **Review layer (human-in-the-loop, PR-based):** the branch is opened as a pull request. Since
   GitHub Pages only ever serves `main`, the PR branch's version of `updates.json` *is* the
   staging area — no separate staging file needed, and only one file to dedupe against, ever
   (avoids the same cross-file drift risk we ruled out for archiving in §7). Reviewing = reading
   the PR diff; merging the PR is the publish action. This is the guardrail that enforces the
   editorial rules in §5 — an unattended pipeline can't catch a hallucinated summary, a dead
   link, or hype language creeping in; a human reading the diff can.
3. **Display layer (static):** an HTML/CSS/JS page that reads `updates.json` and renders it.
   Hosted on GitHub Pages.

**Decision (resolved):** approval is PR-based, single-file (`updates.json` on a feature branch),
no separate staging file. Implementation: `update_feed.py` (validation/dedup/retirement
utilities) + `.github/workflows/update.yml` (weekly cron via `anthropics/claude-code-action@v1`,
plus manual `workflow_dispatch` for on-demand runs) + `.github/workflows/update-feed-prompt.md`
(the agent's instructions — sources, schema, guardrails, PR steps).

**Auth (resolved):** the workflow authenticates with a Claude Pro subscription OAuth token
(`claude setup-token` → `CLAUDE_CODE_OAUTH_TOKEN` repo secret), not a paid Anthropic API key —
no separate API budget needed. A Google API key was also available and considered (a Gemini-based
script instead of Claude Code Action), but rejected in favor of staying on the already-built
agent design, which follows the editorial guardrails via its own judgment rather than a scripted
prompt. Tradeoff accepted: Pro/Max OAuth tokens for GitHub Actions have open upstream issues
around expiry/refresh — this isn't fully zero-maintenance; if the weekly run starts failing on
auth, re-running `claude setup-token` and updating the secret is the first thing to check.

**Hosting cost note:** the GitHub repo is public, so GitHub Actions minutes are free/unlimited
there — no need to route any of this through Firebase Cloud Functions (which was considered,
given limited Firebase allocation, but adds a second cloud provider for no benefit here).

**Decision (resolved):** scheduled Claude Code agent (weekly cron) drafts into staging;
approval is a manual step before publish. Fully unattended auto-publish was considered and
rejected — for health-adjacent content, the review step is worth the loss of "hands-off."

## 3. Files

```
parkinsons-advances/
├── index.html                        # page shell + layout
├── styles.css                         # visual design
├── script.js                           # fetches updates.json, renders + filters cards client-side
├── data/
│   └── updates.json                    # the actual feed content (active + archived) — source of truth
├── update_feed.py                       # validate / dedupe+add / retire — mechanical utilities, no drafting logic
└── .github/
    └── workflows/
        ├── update.yml                    # weekly cron (+ manual on-demand) — runs the agent, opens a PR
        └── update-feed-prompt.md          # agent instructions: sources, schema, editorial guardrails
```

Drafting itself (searching sources, writing summaries) is done by the Claude agent at run time,
following `update-feed-prompt.md` — `update_feed.py` only handles the parts that shouldn't
depend on model judgment: id hashing, schema/category validation, dedup, and age-based
retirement. Hosted on GitHub Pages.

## 4. Data schema (`updates.json`)

```json
[
  {
    "id": "sha1-of-source-url",
    "title": "Short, plain headline",
    "category": "Research",
    "summary": "2–4 sentences, plain language, no hype.",
    "source_name": "Journal of Neurology",
    "source_url": "https://...",
    "source_type": "peer-reviewed",
    "date_published": "2026-08-15",
    "date_added": "2026-08-22",
    "status": "active"
  }
]
```

`id` = hash of the source URL, used for dedup so re-running the update script doesn't create
duplicate entries — the script checks `id`s across **all** statuses (active and archived), so a
retired item can never silently reappear.

`status` = `"active"` or `"archived"`. One file, one array, filtered client-side and by the
update script — no separate archive file, no risk of the two drifting out of sync (see §7).
There's no separate staging file either: draft entries are appended to this same file on a PR
branch, and only become visible on the live site once that PR is merged to `main` (see §2).

## 5. Sourcing strategy

🔧 **Decision point:** curated list vs. open web search each time. Recommendation: start with a
short curated list of reputable, checkable sources, and only fall back to general web search if
those come up dry:

- Michael J. Fox Foundation research news
- Parkinson's Foundation news
- Parkinson's News Today
- ClinicalTrials.gov (filtered to Parkinson's disease, for trial-status entries)
- PubMed (for peer-reviewed studies — flagged as "peer-reviewed" type)

**Editorial guardrails** for the update script/Claude when drafting summaries:
- No "breakthrough"/"cure" language unless the source itself makes that claim carefully — and
  even then, reflect the actual claim, not an amplified version of it.
- Note trial phase (Phase I/II/III) and sample size when the source is a clinical trial.
- If a claim comes from a press release rather than peer review, the `source_type` tag must say so.
- One link per entry, always to the original piece — never a secondhand aggregator if the
  primary source is findable.

## 6. Update cadence

**Decision (resolved):** weekly cron (GitHub Actions), on-demand override always available by
running the agent manually. Drafts always land in `staging.json` first regardless of trigger —
cadence only affects how often drafts appear for review, not what gets published.

## 7. Feed size / retention — soft retirement

- Retirement is **age-based, not count-based**: an entry older than **1 year**
  (`RETIREMENT_AGE_DAYS = 365`, tuned up from an initial 6-month default once the feed had real
  entries) flips from `"status": "active"` to `"archived"`. Pure count-based retention ("keep
  newest 30–50") was rejected — it's fragile in both directions: a quiet stretch pushes out
  still-relevant recent items just because few new ones arrived, and a sudden burst leaves stale
  items sitting well past when they should've rotated out.
- **Decision (resolved):** no separate display cap — `script.js` paginates the active set with a
  "Load more" button (12 at a time) instead of either rendering everything at once or hard-capping
  what's reachable. This replaces the earlier "~30–50 visible items" placeholder.
- Archived entries stay in `updates.json` (see §4) — nothing is ever deleted. The **search box**
  (see §8) is the archive view: searching reveals matching archived entries regardless of the
  1-year cutoff; the default (no search) feed is active-only. See §10.

## 8. Page design (kept simple)

- Card-based feed, newest first
- Category shown as a small colored badge, not a wall of text
- Client-side filter by category (no reload needed — just JS array filtering)
- Client-side **search box** over title/summary/source name — active entries only by default;
  typing a query also searches archived (>1 year) entries, serving as the archive view (§7, §10)
- **"Load more"** button below the feed, 12 entries per page, instead of rendering everything or
  hard-capping what's reachable
- "Last updated: [date]" shown near the top, pulled from the newest `date_added`
- Small, honest disclaimer in the footer: this is a curated summary feed, not medical advice
- Mobile-responsive, plain typography, no dependency on external UI frameworks

## 9. First implementation pass (suggested order for Claude CLI)

1. Build `index.html` + `styles.css` + `script.js` against a small hand-written `updates.json`
   (5–8 entries) so the display layer can be checked visually first.
2. Write `update_feed.py`: search the curated sources, draft 3–5 real entries, write them into
   `updates.json` in the schema above, with dedup logic.
3. Run it once, check the output reads well and isn't overhyped.
4. Only then decide on scheduling (see §6).

## 10. Open questions for the team to settle along the way

- Should entries ever be manually editable/removable if a summary turns out wrong after it's
  already live (not just during staging review)?
- Is a "peer-reviewed only" toggle worth adding for someone who wants to filter out press
  releases entirely?
- Any specific sub-topics to prioritize (e.g., deep brain stimulation, gene therapy, wearables)
  or keep it broad?
- ~~Is a visible "archive/history" page worth building now~~ — **resolved**: the search box
  doubles as the archive view (§7, §8) instead of a separate page.
- Email digest signup — under research as of 2026-08-23; see conversation/commit history for the
  options considered (ESP + RSS-to-email vs. custom backend) and why per-trial-level subscriptions
  need a schema change (a `trial_id` field) that per-category subscriptions don't.
