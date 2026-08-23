const DATA_URL = "data/updates.json";

const SOURCE_TYPE_LABELS = {
  "peer-reviewed": "Peer-reviewed study",
  "news report": "News report",
  "press release": "Press release",
  "preprint": "Preprint",
};

const PAGE_SIZE = 12;

let allEntries = [];
let activeCategory = "all";
let searchQuery = "";
let visibleCount = PAGE_SIZE;

function categorySlug(category) {
  return category.replace(/\s+/g, "-");
}

function formatDate(isoDate) {
  const d = new Date(`${isoDate}T00:00:00`);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function matchesSearch(entry, query) {
  if (!query) return true;
  const haystack = `${entry.title} ${entry.summary} ${entry.source_name}`.toLowerCase();
  return haystack.includes(query);
}

function filteredEntries() {
  const query = searchQuery.trim().toLowerCase();
  // Archived (>1yr old, see update_feed.py) entries only surface via search — the default feed
  // is active items only. This is what "search past updates" means here: there's no separate
  // archive page, search is the archive view.
  return allEntries
    .filter((e) => e.status === "active" || query !== "")
    .filter((e) => activeCategory === "all" || e.category === activeCategory)
    .filter((e) => matchesSearch(e, query))
    .sort((a, b) => b.date_published.localeCompare(a.date_published));
}

function renderFeed() {
  const feed = document.getElementById("feed");
  const loadMoreBtn = document.getElementById("load-more-btn");
  const feedEnd = document.getElementById("feed-end");
  const matches = filteredEntries();
  const visible = matches.slice(0, visibleCount);

  if (visible.length === 0) {
    feed.innerHTML = `<p class="empty">${searchQuery.trim() ? "No matching updates found." : "No entries in this category yet."}</p>`;
    loadMoreBtn.hidden = true;
    feedEnd.hidden = true;
    return;
  }

  feed.innerHTML = visible.map(cardHtml).join("");

  const hasMore = matches.length > visible.length;
  loadMoreBtn.hidden = !hasMore;
  feedEnd.hidden = hasMore || searchQuery.trim() !== "";
}

function resetAndRender() {
  visibleCount = PAGE_SIZE;
  renderFeed();
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
    resetAndRender();
  });
}

function setupSearch() {
  const input = document.getElementById("search-input");
  input.addEventListener("input", () => {
    searchQuery = input.value;
    resetAndRender();
  });
}

function setupLoadMore() {
  document.getElementById("load-more-btn").addEventListener("click", () => {
    visibleCount += PAGE_SIZE;
    renderFeed();
  });
}

async function init() {
  setupFilters();
  setupSearch();
  setupLoadMore();
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
