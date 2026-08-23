// Parkinson's Advances email digest — Cloudflare Worker.
//
// Endpoints:
//   POST /subscribe    { email, categories: string[] }  -> sends a confirmation email
//   GET  /confirm       ?token=...                        -> flips pending -> confirmed
//   GET  /unsubscribe   ?token=...                        -> flips status -> unsubscribed
//   POST /send-digest   header X-Digest-Secret: <secret>  -> mails everyone new active entries
//                                                             since the last run
//
// See ../../README.md for the deploy runbook (D1 setup, Resend setup, secrets).

const ALLOWED_CATEGORIES = ["Research", "Treatment", "Clinical Trial", "Technology", "Policy"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return corsResponse(env, new Response(null, { status: 204 }));
    }

    try {
      if (url.pathname === "/subscribe" && request.method === "POST") {
        return corsResponse(env, await handleSubscribe(request, env));
      }
      if (url.pathname === "/confirm" && request.method === "GET") {
        return await handleConfirm(url, env);
      }
      if (url.pathname === "/unsubscribe" && request.method === "GET") {
        return await handleUnsubscribe(url, env);
      }
      if (url.pathname === "/send-digest" && request.method === "POST") {
        return await handleSendDigest(request, env);
      }
    } catch (err) {
      console.error(err);
      return jsonResponse({ error: "Internal error" }, 500);
    }

    return jsonResponse({ error: "Not found" }, 404);
  },
};

// ---- /subscribe ----

async function handleSubscribe(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const email = String(body.email || "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return jsonResponse({ error: "Enter a valid email address." }, 400);
  }

  const requested = Array.isArray(body.categories) ? body.categories : [];
  const valid = requested.filter((c) => ALLOWED_CATEGORIES.includes(c));
  const categories = valid.length === 0 ? "all" : valid.join(",");

  const confirmToken = crypto.randomUUID();
  const unsubscribeToken = crypto.randomUUID();

  // Upsert: re-subscribing (including after a previous unsubscribe) resets to pending with
  // fresh tokens and whatever category selection was just submitted.
  await env.DB.prepare(
    `INSERT INTO subscribers (email, categories, status, confirm_token, unsubscribe_token)
     VALUES (?1, ?2, 'pending', ?3, ?4)
     ON CONFLICT(email) DO UPDATE SET
       categories = excluded.categories,
       status = 'pending',
       confirm_token = excluded.confirm_token,
       unsubscribe_token = excluded.unsubscribe_token`
  )
    .bind(email, categories, confirmToken, unsubscribeToken)
    .run();

  const confirmUrl = `${workerOrigin(env)}/confirm?token=${confirmToken}`;
  await sendEmail(env, {
    to: email,
    subject: "Confirm your Parkinson's Advances subscription",
    html: `
      <p>One more step — confirm you want updates from Parkinson's Advances
      (${escapeHtml(categories === "all" ? "all categories" : categories)}).</p>
      <p><a href="${confirmUrl}">Confirm subscription</a></p>
      <p>If you didn't request this, you can ignore this email — you won't be subscribed
      unless you click the link above.</p>
    `,
  });

  // Same response whether or not the email already existed, to avoid leaking subscriber status.
  return jsonResponse({ ok: true, message: "Check your inbox to confirm." });
}

// ---- /confirm ----

async function handleConfirm(url, env) {
  const token = url.searchParams.get("token") || "";
  const result = await env.DB.prepare(
    `UPDATE subscribers SET status = 'confirmed' WHERE confirm_token = ?1 AND status != 'unsubscribed'`
  )
    .bind(token)
    .run();

  if (result.meta.changes === 0) {
    return htmlPage("That confirmation link is invalid or has already been used.");
  }
  return htmlPage("You're subscribed. You'll get an email when matching updates are published.");
}

// ---- /unsubscribe ----

async function handleUnsubscribe(url, env) {
  const token = url.searchParams.get("token") || "";
  const result = await env.DB.prepare(
    `UPDATE subscribers SET status = 'unsubscribed' WHERE unsubscribe_token = ?1`
  )
    .bind(token)
    .run();

  if (result.meta.changes === 0) {
    return htmlPage("That unsubscribe link is invalid.");
  }
  return htmlPage("You've been unsubscribed. Sorry to see you go.");
}

// ---- /send-digest ----

async function handleSendDigest(request, env) {
  const secret = request.headers.get("X-Digest-Secret") || "";
  if (!env.DIGEST_SECRET || secret !== env.DIGEST_SECRET) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const res = await fetch(env.UPDATES_JSON_URL, { cf: { cacheTtl: 0 } });
  if (!res.ok) {
    return jsonResponse({ error: `Failed to fetch updates.json: ${res.status}` }, 502);
  }
  const entries = await res.json();

  const state = await env.DB.prepare(`SELECT last_date_added FROM digest_state WHERE id = 1`).first();
  const lastDateAdded = state?.last_date_added || "1970-01-01";

  const newEntries = entries
    .filter((e) => e.status === "active" && e.date_added > lastDateAdded)
    .sort((a, b) => a.date_published.localeCompare(b.date_published));

  if (newEntries.length === 0) {
    return jsonResponse({ sent: 0, new_entries: 0, message: "Nothing new since last digest." });
  }

  const { results: subscribers } = await env.DB.prepare(
    `SELECT email, categories, unsubscribe_token FROM subscribers WHERE status = 'confirmed'`
  ).all();

  let sent = 0;
  for (const sub of subscribers) {
    const wantsAll = sub.categories === "all";
    const wanted = wantsAll ? null : sub.categories.split(",");
    const matching = wantsAll ? newEntries : newEntries.filter((e) => wanted.includes(e.category));
    if (matching.length === 0) continue;

    await sendEmail(env, {
      to: sub.email,
      subject: `Parkinson's Advances: ${matching.length} new update${matching.length === 1 ? "" : "s"}`,
      html: digestHtml(matching, sub.unsubscribe_token, env),
    });
    sent++;
  }

  const newestDateAdded = newEntries.reduce((max, e) => (e.date_added > max ? e.date_added : max), lastDateAdded);
  await env.DB.prepare(`UPDATE digest_state SET last_date_added = ?1 WHERE id = 1`)
    .bind(newestDateAdded)
    .run();

  return jsonResponse({ sent, new_entries: newEntries.length });
}

function digestHtml(entries, unsubscribeToken, env) {
  const items = entries
    .map(
      (e) => `
      <li style="margin-bottom:1.25em;">
        <div style="font-size:0.75em;text-transform:uppercase;color:#6b6862;">${escapeHtml(e.category)}</div>
        <a href="${escapeAttr(e.source_url)}" style="font-weight:600;">${escapeHtml(e.title)}</a>
        <p style="margin:0.3em 0 0;">${escapeHtml(e.summary)}</p>
      </li>`
    )
    .join("");
  const unsubscribeUrl = `${workerOrigin(env)}/unsubscribe?token=${unsubscribeToken}`;
  return `
    <ul style="list-style:none;padding:0;">${items}</ul>
    <p style="font-size:0.8em;color:#6b6862;">
      Curated summary feed, not medical advice.
      <a href="${unsubscribeUrl}">Unsubscribe</a>
    </p>
  `;
}

// ---- shared helpers ----

async function sendEmail(env, { to, subject, html }) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: env.RESEND_FROM_EMAIL, to, subject, html }),
  });
  if (!res.ok) {
    console.error(`Resend send to ${to} failed: ${res.status} ${await res.text()}`);
  }
}

function workerOrigin(env) {
  return env.WORKER_ORIGIN;
}

function corsResponse(env, response) {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", env.SITE_ORIGIN);
  headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  return new Response(response.body, { status: response.status, headers });
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function htmlPage(message) {
  return new Response(
    `<!doctype html><html><body style="font-family:sans-serif;max-width:32em;margin:4em auto;padding:0 1em;">
      <p>${escapeHtml(message)}</p>
    </body></html>`,
    { headers: { "Content-Type": "text/html" } }
  );
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(str) {
  return escapeHtml(str);
}
