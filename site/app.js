(function () {
  "use strict";
  const D = window.CardTraderData;
  const $ = id => document.getElementById(id);
  const money = new Intl.NumberFormat(undefined, { style: "currency", currency: "EUR" });
  const dates = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
  const shortDate = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
  const preferencesKey = "cardtrader.repository.v1";
  const state = {
    client: null, prices: null, settings: D.emptySettings(), selected: null, visible: [],
    filters: { search: "", expansion: "", ownership: "all", watched: false, sort: "name" },
    drafts: new Map(), busy: false, loading: false, session: 0, pendingClient: null, connecting: false
  };
  let imageCardId = null;
  let chartPoints = [];

  const formatMoney = amount => money.format(amount / 100);
  const formatDate = at => at ? dates.format(new Date(at)) : "Never";
  const targetText = amount => amount === null ? "" : (amount / 100).toFixed(2);
  const canEdit = () => Boolean(state.client?.canEdit) && !state.loading && !state.busy;
  const hasDrafts = () => state.drafts.size > 0;

  function icon(name) {
    const element = document.createElement("img");
    element.src = `icons/${name}.svg`;
    element.alt = "";
    element.className = "icon";
    return element;
  }

  function notice(message, type) {
    $("notice").hidden = !message;
    $("notice").className = `notice ${type || ""}`;
    $("notice-text").textContent = message || "";
    $("notice").setAttribute("role", type === "error" ? "alert" : "status");
    $("notice-icon").src = `icons/${type === "error" ? "circle-alert" : "info"}.svg`;
  }

  function discardDrafts(action) {
    if (hasDrafts() && !window.confirm(`Discard unsaved watch prices and ${action}?`)) return false;
    state.drafts.clear();
    return true;
  }

  function updateControls() {
    $("refresh-button").disabled = !state.client || state.loading || state.busy;
    $("export-button").disabled = !state.prices || state.loading || state.busy;
    $("connect-button").disabled = state.loading || state.busy;
    $("disconnect-button").hidden = !state.client;
    $("connect-label").textContent = state.client ? "Repository" : "Connect repository";
    $("access-badge").hidden = !state.client;
    $("access-badge").textContent = state.client?.canEdit ? "Editable" : "Read only";
    $("connection-dot").classList.toggle("connected", Boolean(state.client));
    $("refresh-icon").classList.toggle("spinning", state.loading);
    $("collection").setAttribute("aria-busy", String(state.loading));
    $("sync-status").textContent = state.busy ? "Saving settings..." : state.loading ? "Refreshing..." :
      hasDrafts() ? `${state.drafts.size} unsaved watch ${state.drafts.size === 1 ? "price" : "prices"}` :
        state.client ? "Settings synced" : "Disconnected";
  }

  function renderMetrics() {
    const cards = state.prices?.cards || [];
    let missing = 0, watched = 0, atTarget = 0;
    for (const card of cards) {
      const saved = D.setting(state.settings, card.id);
      if (!saved.acquired) missing += 1;
      if (saved.notificationPriceCents !== null) {
        watched += 1;
        if (!saved.acquired && card.available && card.currentPriceCents < saved.notificationPriceCents) atTarget += 1;
      }
    }
    $("metric-total").textContent = cards.length.toLocaleString();
    $("metric-missing").textContent = missing.toLocaleString();
    $("metric-watched").textContent = watched.toLocaleString();
    $("metric-target").textContent = atTarget.toLocaleString();
  }

  function renderExpansions() {
    const expansions = new Map((state.prices?.cards || []).map(card => [String(card.expansionId), card.expansion]));
    $("expansion").replaceChildren(new Option("All expansions", ""));
    [...expansions].sort((a, b) => a[1].localeCompare(b[1])).forEach(([id, name]) => $("expansion").add(new Option(name, id)));
    if (!expansions.has(state.filters.expansion)) state.filters.expansion = "";
    $("expansion").value = state.filters.expansion;
  }

  function renderEmpty() {
    const connected = Boolean(state.client);
    const noData = !state.prices?.cards.length;
    $("empty-state").hidden = state.visible.length > 0;
    $("empty-title").textContent = !connected ? "Your collection starts here" : noData ? "No cards in this snapshot" : "No matching cards";
    $("empty-description").textContent = !connected ? "No repository connected." : noData ?
      "Waiting for the worker's first card snapshot." : "No cards match the current search and filters.";
    $("empty-action").replaceChildren(icon(!connected ? "github" : noData ? "refresh-cw" : "x"), document.createTextNode(!connected ? "Connect repository" : noData ? "Refresh" : "Clear filters"));
    $("empty-action").disabled = state.loading || state.busy;
  }

  function renderTable() {
    state.visible = state.prices ? D.filterCards(state.prices, state.settings, state.filters) : [];
    if (state.selected && !state.visible.some(card => card.id === state.selected)) state.selected = null;
    const fragment = document.createDocumentFragment();
    for (const card of state.visible) {
      const saved = D.setting(state.settings, card.id);
      const row = document.createElement("tr");
      row.className = "card-row" + (state.selected === card.id ? " selected" : "");
      row.dataset.cardId = card.id;
      const acquired = document.createElement("td");
      acquired.className = "acquired-cell";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = saved.acquired;
      checkbox.disabled = !canEdit();
      checkbox.setAttribute("aria-label", `Acquired: ${card.name}, ${card.expansion}, ${card.isFoil ? "foil" : "normal"}`);
      checkbox.addEventListener("change", () => saveCard(card.id, { acquired: checkbox.checked }));
      acquired.append(checkbox);
      const titleCell = document.createElement("td");
      const title = document.createElement("button");
      title.type = "button";
      title.className = "card-title";
      title.textContent = card.name;
      title.setAttribute("aria-expanded", String(state.selected === card.id));
      title.setAttribute("aria-controls", "detail-pane");
      title.addEventListener("click", () => selectCard(card.id, true));
      const metadata = document.createElement("span");
      metadata.className = "card-meta";
      metadata.textContent = `${card.expansion} / #${card.collectorNumber}${card.isFoil ? " / Foil" : ""}`;
      titleCell.append(title, metadata);
      const price = document.createElement("td");
      price.className = "numeric price" + (card.available ? "" : " unavailable");
      price.textContent = card.available ? formatMoney(card.currentPriceCents) : "Unavailable";
      if (!card.available) price.title = `Last seen ${formatDate(card.lastSeenAt)} at ${formatMoney(card.currentPriceCents)}`;
      const drop = D.change24h(card, state.prices.lastCheckedAt);
      const dropCell = document.createElement("td");
      dropCell.className = "numeric change-column " + (!drop || drop.dropCents === 0 ? "muted" : drop.dropCents > 0 ? "positive" : "negative");
      dropCell.textContent = drop ? `${drop.dropCents > 0 ? "-" : drop.dropCents < 0 ? "+" : ""}${formatMoney(Math.abs(drop.dropCents))}` : "\u2014";
      dropCell.title = drop ? `Compared with ${formatMoney(drop.baselineCents)} at least 24 hours before last seen` : "No 24-hour baseline available";
      const watch = document.createElement("td");
      watch.className = "numeric watch-target";
      if (saved.notificationPriceCents === null) { watch.textContent = "\u2014"; watch.classList.add("muted"); }
      else {
        watch.textContent = formatMoney(saved.notificationPriceCents);
        watch.classList.toggle("at-target", card.available && !saved.acquired && card.currentPriceCents < saved.notificationPriceCents);
      }
      row.append(acquired, titleCell, price, dropCell, watch);
      fragment.append(row);
    }
    $("cards-body").replaceChildren(fragment);
    $("result-count").textContent = `${state.visible.length.toLocaleString()} ${state.visible.length === 1 ? "card" : "cards"}`;
    $("table-summary").textContent = state.prices ? `${state.visible.length.toLocaleString()} of ${state.prices.cards.length.toLocaleString()} cards` : "No snapshot loaded";
    $("clear-search").hidden = !state.filters.search;
    renderEmpty();
  }

  function selectCard(id, focus) {
    state.selected = id;
    renderTable();
    renderDetail();
    if (focus && window.matchMedia("(max-width: 850px)").matches) {
      $("detail-pane").scrollIntoView({ block: "start", behavior: "instant" });
      $("detail-pane").focus({ preventScroll: true });
    }
  }

  function renderImage(card) {
    if (imageCardId === card.id) return;
    imageCardId = card.id;
    const image = $("card-image");
    image.loading = "eager";
    const sources = D.imageSources(card);
    let index = 0;
    image.hidden = true;
    $("image-unavailable").hidden = false;
    image.alt = `${card.name} card image`;
    image.onload = () => { if (imageCardId === card.id) { image.hidden = false; $("image-unavailable").hidden = true; } };
    image.onerror = () => {
      if (imageCardId !== card.id) return;
      if (++index < sources.length) image.src = sources[index];
      else { image.hidden = true; $("image-unavailable").hidden = false; }
    };
    image.src = sources[0];
  }

  function renderHistory(card) {
    chartPoints = [...card.history].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    $("history-range").textContent = `${chartPoints.length} ${chartPoints.length === 1 ? "point" : "points"}`;
    $("chart-start").textContent = chartPoints.length ? shortDate.format(new Date(chartPoints[0].at)) : "";
    $("chart-end").textContent = chartPoints.length ? shortDate.format(new Date(chartPoints[chartPoints.length - 1].at)) : "";
    $("chart-empty").hidden = chartPoints.length > 0;
    const historyBody = document.createDocumentFragment();
    for (const point of chartPoints.slice(-100).reverse()) {
      const row = document.createElement("tr");
      const at = document.createElement("td");
      at.textContent = formatDate(point.at);
      const amount = document.createElement("td");
      amount.className = "numeric";
      amount.textContent = formatMoney(point.priceCents);
      row.append(at, amount);
      historyBody.append(row);
    }
    $("history-body").replaceChildren(historyBody);
    $("history-chart").setAttribute("aria-label", chartPoints.length ?
      `${card.name} price history: ${chartPoints.length} points, ${formatMoney(chartPoints[0].priceCents)} to ${formatMoney(chartPoints[chartPoints.length - 1].priceCents)}. History data follows.` : "No price history available");
    requestAnimationFrame(drawChart);
  }

  function drawChart() {
    const canvas = $("history-chart");
    if (!state.selected || $("detail-content").hidden) return;
    const width = canvas.clientWidth;
    if (!width) return;
    const height = 130;
    const ratio = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.round(width * ratio);
    canvas.height = height * ratio;
    const ctx = canvas.getContext("2d");
    ctx.scale(ratio, ratio);
    const left = 4, right = width - 5, top = 22, bottom = 121;
    ctx.strokeStyle = "#dfe7e1";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 2; i += 1) { const y = top + (bottom - top) * i / 2; ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke(); }
    if (!chartPoints.length) return;
    let low = Infinity, high = -Infinity;
    for (const point of chartPoints) { low = Math.min(low, point.priceCents); high = Math.max(high, point.priceCents); }
    const padding = Math.max((high - low) * .15, high * .025, 1);
    const min = Math.max(0, low - padding), max = high + padding;
    const first = Date.parse(chartPoints[0].at), last = Date.parse(chartPoints[chartPoints.length - 1].at);
    const x = point => first === last ? (left + right) / 2 : left + (Date.parse(point.at) - first) / (last - first) * (right - left);
    const y = point => bottom - (point.priceCents - min) / (max - min) * (bottom - top);
    ctx.beginPath();
    chartPoints.forEach((point, index) => index ? ctx.lineTo(x(point), y(point)) : ctx.moveTo(x(point), y(point)));
    ctx.strokeStyle = "#087b57";
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.stroke();
    const final = chartPoints[chartPoints.length - 1];
    ctx.beginPath(); ctx.arc(x(final), y(final), 3, 0, Math.PI * 2); ctx.fillStyle = "#087b57"; ctx.fill();
    ctx.font = "10px Segoe UI, sans-serif";
    ctx.fillStyle = "#718078";
    ctx.textAlign = "left";
    ctx.fillText(formatMoney(high), left, 11);
  }

  function renderTarget(card) {
    const saved = D.setting(state.settings, card.id);
    $("target-price").value = state.drafts.has(card.id) ? state.drafts.get(card.id) : targetText(saved.notificationPriceCents);
    $("target-price").disabled = !canEdit();
    $("target-error").hidden = true;
    $("draft-status").textContent = state.drafts.has(card.id) ? "Unsaved" : "";
    $("save-target").disabled = !canEdit() || !state.drafts.has(card.id);
    $("clear-target").disabled = !canEdit() || (saved.notificationPriceCents === null && !state.drafts.has(card.id));
  }

  function renderDetail() {
    const card = state.prices?.cards.find(item => item.id === state.selected);
    $("detail-empty").hidden = Boolean(card);
    $("detail-content").hidden = !card;
    if (!card) {
      imageCardId = null;
      $("card-image").removeAttribute("src");
      return;
    }
    const saved = D.setting(state.settings, card.id);
    const drop = D.change24h(card, state.prices.lastCheckedAt);
    $("detail-name").textContent = card.name;
    $("detail-expansion").textContent = `${card.expansion} / #${card.collectorNumber}`;
    $("detail-rarity").textContent = card.rarity || "Unknown rarity";
    $("detail-finish").textContent = card.isFoil ? "Foil" : "Normal";
    $("detail-blueprint").textContent = `ID ${card.blueprintId}`;
    $("detail-price").textContent = card.available ? formatMoney(card.currentPriceCents) : "Unavailable";
    $("detail-price").className = card.available ? "" : "unavailable";
    $("detail-drop").textContent = drop ? `${drop.dropCents > 0 ? "-" : drop.dropCents < 0 ? "+" : ""}${formatMoney(Math.abs(drop.dropCents))}` : "\u2014";
    $("detail-drop").className = !drop || drop.dropCents === 0 ? "muted" : drop.dropCents > 0 ? "positive" : "negative";
    $("detail-drop").title = drop ? "Compared with a point at least 24 hours before last seen" : "No 24-hour baseline available";
    $("detail-acquired").checked = saved.acquired;
    $("detail-acquired").disabled = !canEdit();
    $("detail-acquired-status").textContent = state.busy ? "Saving..." : saved.acquired ? "In collection" : "Missing";
    $("read-only-note").hidden = Boolean(state.client?.canEdit);
    $("last-seen").textContent = `Last seen ${formatDate(card.lastSeenAt)}${card.available ? "" : ` / ${formatMoney(card.currentPriceCents)}`}`;
    const index = state.visible.findIndex(item => item.id === card.id);
    $("previous-card").disabled = index <= 0;
    $("next-card").disabled = index < 0 || index >= state.visible.length - 1;
    renderImage(card);
    renderHistory(card);
    renderTarget(card);
  }

  function render() {
    updateControls();
    renderMetrics();
    renderTable();
    renderDetail();
  }

  function showSnapshot(snapshot) {
    state.prices = snapshot.prices;
    state.settings = snapshot.settings;
    $("repository-label").textContent = `${state.client.config.owner}/${state.client.config.repo} / ${state.client.config.branch}`;
    $("last-checked").textContent = snapshot.prices.lastCheckedAt ? `Checked ${formatDate(snapshot.prices.lastCheckedAt)}` : "Never / partial snapshot";
    renderExpansions();
    render();
  }

  async function refresh() {
    if (!state.client || state.loading || state.busy || !discardDrafts("refresh")) return;
    const client = state.client, session = state.session;
    state.loading = true;
    render();
    notice("Loading repository state...", "loading");
    try {
      const snapshot = await client.load();
      if (session !== state.session) return;
      showSnapshot(snapshot);
      notice(snapshot.prices.lastCheckedAt ? "" : "Partial snapshot. No complete worker check has finished yet.");
    } catch (error) { if (session === state.session) notice(error.message, "error"); }
    finally { if (session === state.session) { state.loading = false; render(); } }
  }

  async function saveCard(id, patch) {
    if (!canEdit()) return;
    const session = state.session, client = state.client;
    state.busy = true;
    render();
    notice("Saving settings...", "loading");
    try {
      const settings = await client.patchSettings(id, patch);
      if (session !== state.session) return;
      state.settings = settings;
      if ("notificationPriceCents" in patch) state.drafts.delete(id);
      notice("Settings saved.");
    } catch (error) {
      if (session === state.session) notice(error.message, "error");
    } finally {
      if (session === state.session) { state.busy = false; render(); }
    }
  }

  function openConnect() {
    if (state.busy || state.loading) return;
    let prefs = {};
    try { prefs = JSON.parse(localStorage.getItem(preferencesKey) || "{}"); } catch (_) { /* Preferences are optional. */ }
    $("repo-owner").value = state.client?.config.owner || (typeof prefs?.owner === "string" ? prefs.owner : "");
    $("repo-name").value = state.client?.config.repo || (typeof prefs?.repo === "string" ? prefs.repo : "");
    $("repo-branch").value = state.client?.config.branch || (typeof prefs?.branch === "string" ? prefs.branch : D.DEFAULT_BRANCH);
    $("repo-token").value = "";
    $("connection-error").hidden = true;
    $("connect-dialog").showModal();
  }

  function connectBusy(value) {
    state.connecting = value;
    $("submit-connect").disabled = value;
    ["repo-owner", "repo-name", "repo-branch", "repo-token"].forEach(id => { $(id).disabled = value; });
    $("submit-connect").lastElementChild.textContent = value ? "Connecting..." : "Connect";
  }

  function closeConnect() {
    state.pendingClient?.disconnect();
    state.pendingClient = null;
    $("repo-token").value = "";
    connectBusy(false);
    $("connect-dialog").close();
  }

  $("connect-form").addEventListener("submit", async event => {
    event.preventDefault();
    if (state.connecting || !discardDrafts("connect")) return;
    let candidate;
    try {
      const config = D.validateConnection({ owner: $("repo-owner").value, repo: $("repo-name").value, branch: $("repo-branch").value });
      candidate = D.createClient(config, $("repo-token").value);
      $("repo-token").value = "";
      state.pendingClient = candidate;
      connectBusy(true);
      $("connection-error").hidden = true;
      const snapshot = await candidate.load();
      if (state.pendingClient !== candidate) return;
      state.client?.disconnect();
      state.client = candidate;
      state.session += 1;
      state.selected = null;
      state.pendingClient = null;
      try { localStorage.setItem(preferencesKey, JSON.stringify(config)); } catch (_) { /* Storage may be disabled. */ }
      showSnapshot(snapshot);
      notice(snapshot.prices.lastCheckedAt ? "" : "Partial snapshot. No complete worker check has finished yet.");
      $("connect-dialog").close();
    } catch (error) {
      candidate?.disconnect();
      if (candidate && state.pendingClient !== candidate) return;
      $("connection-error").textContent = error.message;
      $("connection-error").hidden = false;
    } finally {
      if (!candidate || state.pendingClient === candidate || state.client === candidate) {
        state.pendingClient = null;
        connectBusy(false);
      }
    }
  });

  $("connect-dialog").addEventListener("cancel", event => { event.preventDefault(); closeConnect(); });
  $("close-connect").addEventListener("click", closeConnect);
  $("cancel-connect").addEventListener("click", closeConnect);
  $("connect-button").addEventListener("click", openConnect);
  $("refresh-button").addEventListener("click", refresh);
  $("disconnect-button").addEventListener("click", () => {
    if (!discardDrafts("disconnect")) return;
    state.session += 1;
    state.client?.disconnect();
    state.client = null;
    state.prices = null;
    state.settings = D.emptySettings();
    state.selected = null;
    state.busy = false;
    state.loading = false;
    $("repo-token").value = "";
    $("repository-label").textContent = "No repository connected";
    $("last-checked").textContent = "Not checked";
    renderExpansions();
    notice("");
    render();
  });
  $("search").addEventListener("input", event => { state.filters.search = event.target.value; renderTable(); renderDetail(); });
  $("clear-search").addEventListener("click", () => { $("search").value = ""; state.filters.search = ""; renderTable(); renderDetail(); $("search").focus(); });
  $("expansion").addEventListener("change", event => { state.filters.expansion = event.target.value; renderTable(); renderDetail(); });
  $("sort").addEventListener("change", event => { state.filters.sort = event.target.value; renderTable(); renderDetail(); });
  $("watched").addEventListener("change", event => { state.filters.watched = event.target.checked; renderTable(); renderDetail(); });
  document.querySelectorAll("[data-ownership]").forEach(button => button.addEventListener("click", () => {
    state.filters.ownership = button.dataset.ownership;
    document.querySelectorAll("[data-ownership]").forEach(item => item.setAttribute("aria-pressed", String(item === button)));
    renderTable(); renderDetail();
  }));
  $("empty-action").addEventListener("click", () => {
    if (!state.client) return openConnect();
    if (!state.prices?.cards.length) return refresh();
    state.filters = { search: "", expansion: "", ownership: "all", watched: false, sort: "name" };
    $("search").value = ""; $("expansion").value = ""; $("sort").value = "name"; $("watched").checked = false;
    document.querySelectorAll("[data-ownership]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.ownership === "all")));
    render();
  });
  $("close-detail").addEventListener("click", () => { state.selected = null; renderTable(); renderDetail(); });
  for (const [button, offset] of [["previous-card", -1], ["next-card", 1]]) {
    $(button).addEventListener("click", () => {
      const index = state.visible.findIndex(card => card.id === state.selected);
      const next = state.visible[index + offset];
      if (next) selectCard(next.id, false);
    });
  }
  $("detail-acquired").addEventListener("change", event => { if (state.selected) saveCard(state.selected, { acquired: event.target.checked }); });
  $("target-price").addEventListener("input", event => {
    if (!state.selected || !canEdit()) return;
    const value = event.target.value;
    let matchesSaved = false;
    try { matchesSaved = D.parseTarget(value) === D.setting(state.settings, state.selected).notificationPriceCents; } catch (_) { /* Invalid drafts remain editable. */ }
    if (matchesSaved) state.drafts.delete(state.selected); else state.drafts.set(state.selected, value);
    $("target-error").hidden = true;
    $("draft-status").textContent = state.drafts.has(state.selected) ? "Unsaved" : "";
    $("save-target").disabled = !state.drafts.has(state.selected);
    $("clear-target").disabled = !value && D.setting(state.settings, state.selected).notificationPriceCents === null;
    updateControls();
  });
  $("watch-form").addEventListener("submit", event => {
    event.preventDefault();
    if (!state.selected || !canEdit()) return;
    try { saveCard(state.selected, { notificationPriceCents: D.parseTarget($("target-price").value) }); }
    catch (error) { $("target-error").textContent = error.message; $("target-error").hidden = false; $("target-price").focus(); }
  });
  $("clear-target").addEventListener("click", () => { if (state.selected && canEdit()) saveCard(state.selected, { notificationPriceCents: null }); });
  $("export-button").addEventListener("click", () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(state.settings, null, 2) + "\n"], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = "settings.json";
    document.body.append(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    if (hasDrafts()) notice("Exported saved settings. Unsaved watch prices are not included.");
  });
  window.addEventListener("beforeunload", event => { if (hasDrafts() || state.busy) { event.preventDefault(); event.returnValue = ""; } });
  window.addEventListener("pagehide", () => { state.client?.disconnect(); state.pendingClient?.disconnect(); $("repo-token").value = ""; });
  window.addEventListener("pageshow", event => { if (event.persisted) window.location.reload(); });
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(drawChart).observe($("history-chart"));
  else window.addEventListener("resize", drawChart);
  render();
})();
