# Email digest signup — deploy runbook

Optional add-on: lets visitors subscribe (by category, or "all") to an email digest sent
whenever new entries land in `data/updates.json`. Everything here is designed to run inside free
tiers at this project's scale.

This is **not deployed yet**. The frontend signup form on the site is inert (shows "signup is
temporarily unavailable") until you complete the steps below and update one config value.

Run all of this yourself, in your own terminal — none of it should go through an AI assistant,
same reasoning as `claude setup-token` in the main README: these are live credentials tied to
your own Cloudflare and Resend accounts.

## What this needs from you

- A free [Cloudflare](https://dash.cloudflare.com/sign-up) account (Workers + D1)
- A free [Resend](https://resend.com) account (email sending)
- Node/npm locally (for the `wrangler` CLI, via `npx`)

## Steps

1. **Log in to Cloudflare:**
   ```bash
   cd email/worker
   npx wrangler login
   ```

2. **Create the D1 database:**
   ```bash
   npx wrangler d1 create parkinsons-advances-subscribers
   ```
   Copy the `database_id` it prints into `wrangler.toml`'s `database_id` field (replacing the
   `REPLACE_WITH_ID_FROM_WRANGLER_D1_CREATE` placeholder).

3. **Apply the schema:**
   ```bash
   npx wrangler d1 execute parkinsons-advances-subscribers --file=schema.sql --remote
   ```

4. **Sign up for Resend** at [resend.com](https://resend.com) and create an API key.

   **Read this before expecting real subscribers to receive anything:** without verifying your
   own domain (SPF/DKIM DNS records — you need a domain you control), Resend's sandbox only
   delivers to the email address you signed up with. `github.io` doesn't give you DNS control, so
   if you want this to work for real subscribers, you need a domain of your own pointed at
   Resend's verification records. Until then, this is fine for testing signup → confirm →
   digest end-to-end with your own inbox, just not for the public.

5. **Set secrets:**
   ```bash
   npx wrangler secret put RESEND_API_KEY
   # paste the key from step 4 when prompted

   openssl rand -hex 32
   # copy the output, then:
   npx wrangler secret put DIGEST_SECRET
   # paste that same random string when prompted
   ```
   Save the `DIGEST_SECRET` value — you'll need it again in step 8.

6. **Deploy:**
   ```bash
   npx wrangler deploy
   ```
   Note the `https://parkinsons-advances-digest.<your-subdomain>.workers.dev` URL it prints.

7. **Wire the deployed URL into both places that need it:**
   - `wrangler.toml`: set `WORKER_ORIGIN` to that URL, then `npx wrangler deploy` again (this
     value is baked into confirm/unsubscribe links in emails).
   - `script.js` at the repo root: set `SUBSCRIBE_API_BASE` (near the top of the file) to that
     same URL. This is what turns the signup form on the live site from inert to working.
   Commit and push the `script.js` change.

8. **Set the two GitHub Actions secrets** the publish workflow needs to trigger a digest send
   whenever `data/updates.json` changes on `main`:
   ```bash
   gh secret set DIGEST_WORKER_URL --body "https://parkinsons-advances-digest.<your-subdomain>.workers.dev"
   gh secret set DIGEST_SECRET --body "<the same random string from step 5>"
   ```

9. **Test end-to-end:** submit the form on the live site with your own email, confirm via the
   email you get, then either wait for the next feed publish or trigger one manually:
   ```bash
   curl -X POST "https://parkinsons-advances-digest.<your-subdomain>.workers.dev/send-digest" \
     -H "X-Digest-Secret: <your DIGEST_SECRET>"
   ```

## What's deliberately out of scope for now

- **Per-trial subscriptions** (as opposed to per-category) — `data/updates.json` entries don't
  carry a stable identifier tying multiple future updates about the *same* trial together. Doing
  this properly needs a `trial_id` field added to the schema and backfilled going forward, which
  is a bigger change than the email plumbing itself. See `parkinsons-advances-plan.md` §10.
- **Rate limiting / abuse protection** on `/subscribe` — fine for low traffic, worth revisiting
  if this gets linked somewhere with real reach.
- **A privacy policy** — you're now storing email addresses. Worth a short page/paragraph before
  pointing real traffic at this, not just the "not medical advice" disclaimer already on the site.
