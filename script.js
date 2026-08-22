const DATA_URL = "data/updates.json";

const SOURCE_TYPE_LABELS = {
  "peer-reviewed": "Peer-reviewed study",
  "news report": "News report",
  "press release": "Press release",
  "preprint": "Preprint",
};

let allEntries = [];
let activeCategory = "all";

function categorySlug(category) {
  return category.replace(/\s+/g, "-");
}

function formatDate(isoDate) {
  const d = new Date(`${isoDate}T00:00:00`);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function renderFeed() {
  const feed = document.getElementById("feed");
  const visible = allEntries
    .filter((e) => e.status === "active")
    .filter((e) => activeCategory === "all" || e.category === activeCategory)
    .sort((a, b) => b.date_published.localeCompare(a.date_published));

  if (visible.length === 0) {
    feed.innerHTML = `<p class="empty">No entries in this category yet.</p>`;
    return;
  }

  feed.innerHTML = visible.map(cardHtml).join("");
}

function cardHtml(entry) {
  const sourceTypeLabel = SOURCE_TYPE_LABELS[entry.source_type] || entry.source_type;
  return `
    <article class="card">
      <div class="card-top">
        <span class="badge ${categorySlug(entry.category)}">${escapeHtml(entry.category)}</span>
        <span class="source-type">${escapeHtml(sourceTypeLabel)}</span>
      </div>
      <h2><a href="${escapeAttr(entry.source_url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(entry.title)}</a></h2>
      <p class="summary">${escapeHtml(entry.summary)}</p>
      <div class="card-meta">
        <span>${escapeHtml(entry.source_name)} &middot; published ${formatDate(entry.date_published)}</span>
        <a href="${escapeAttr(entry.source_url)}" target="_blank" rel="noopener noreferrer">Read source &rarr;</a>
      </div>
    </article>
  `;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, "&quot;");
}

function setLastUpdated() {
  const active = allEntries.filter((e) => e.status === "active");
  if (active.length === 0) return;
  const newest = active.reduce((a, b) => (a.date_added > b.date_added ? a : b));
  document.getElementById("last-updated").textContent = `Last updated: ${formatDate(newest.date_added)}`;
}

function setupFilters() {
  const bar = document.getElementById("filter-bar");
  bar.addEventListener("click", (event) => {
    const btn = event.target.closest(".filter-btn");
    if (!btn) return;
    bar.querySelectorAll(".filter-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    activeCategory = btn.dataset.category;
    renderFeed();
  });
}

async function init() {
  setupFilters();
  try {
    const res = await fetch(DATA_URL);
    if (!res.ok) throw new Error(`Failed to load ${DATA_URL}: ${res.status}`);
    allEntries = await res.json();
    setLastUpdated();
    renderFeed();
  } catch (err) {
    document.getElementById("feed").innerHTML = `<p class="empty">Couldn't load updates right now.</p>`;
    console.error(err);
  }
}

init();
