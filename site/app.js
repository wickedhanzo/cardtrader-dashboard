(function () {
  "use strict";
  const D = window.CardTraderData;
  const $ = id => document.getElementById(id);
  const money = new Intl.NumberFormat(undefined, { style: "currency", currency: "EUR" });
  const dates = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
  const shortDate = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
  const changeDates = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" });
  const percentages = new Intl.NumberFormat(undefined, { style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: "exceptZero" });
  const compactPercentages = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1, signDisplay: "exceptZero" });
  const preferencesKey = "cardtrader.repository.v1";
  const connectionStore = D.createConnectionStore({
    getItem: key => localStorage.getItem(key),
    setItem: (key, value) => localStorage.setItem(key, value),
    removeItem: key => localStorage.removeItem(key)
  }, new URL(".", window.location.href).pathname);
  const state = {
    client: null, prices: null, settings: D.emptySettings(), selected: null, visible: [],
    filters: { search: "", expansion: "", ownership: "all", watched: false, sort: "name" },
    drafts: new Map(), busy: false, loading: false, session: 0, pendingClient: null, connecting: false,
    view: window.location.hash === "#/changes" ? "changes" : "collection", changes: [],
    changeFilters: { search: "", expansion: "", direction: "all" }, changesPage: 1
  };
  let imageSourceKey = null;
  let focusCardOnNavigation = false;
  let chartPoints = [];
  let chartLayout = null;
  let chartActiveIndex = -1;

  const formatMoney = amount => money.format(amount / 100);
  const formatDate = at => at ? dates.format(new Date(at)) : "Never";
  const targetText = amount => amount === null ? "" : (amount / 100).toFixed(2);
  const canEdit = () => Boolean(state.client?.canEdit) && !state.loading && !state.busy && !state.connecting;
  const hasDrafts = () => state.drafts.size > 0;
  const signedPercent = value => value != null ? percentages.format(value / 100) : "\u2014";
  const compactSignedPercent = value => value != null && Math.abs(value) >= 10000
    ? `${compactPercentages.format(value)}%` : signedPercent(value);
  const fullPercent = drop => signedPercent(drop?.percent != null ? -drop.percent : null);
  const displayPercent = drop => compactSignedPercent(drop?.percent != null ? -drop.percent : null);

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
    $("refresh-button").disabled = !state.client || state.loading || state.busy || state.connecting;
    $("export-button").disabled = !state.prices || state.loading || state.busy;
    $("connect-button").disabled = state.loading || state.busy || state.connecting;
    $("disconnect-button").hidden = !state.client;
    $("connect-label").textContent = state.client ? "Repository" : "Connect repository";
    $("access-badge").hidden = !state.client;
    $("access-badge").textContent = state.client?.canEdit ? "Editable" : "Read only";
    $("connection-dot").classList.toggle("connected", Boolean(state.client));
    $("refresh-icon").classList.toggle("spinning", state.loading);
    $("collection").setAttribute("aria-busy", String(state.loading || state.connecting));
    $("sync-status").textContent = state.busy ? "Saving settings..." : state.connecting ? "Connecting..." : state.loading ? "Refreshing..." :
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
    $("changes-expansion").replaceChildren(new Option("All expansions", ""));
    [...expansions].sort((a, b) => a[1].localeCompare(b[1])).forEach(([id, name]) => $("changes-expansion").add(new Option(name, id)));
    if (!expansions.has(state.changeFilters.expansion)) state.changeFilters.expansion = "";
    $("changes-expansion").value = state.changeFilters.expansion;
  }

  function renderEmpty() {
    const connected = Boolean(state.client);
    const noData = !state.prices?.cards.length;
    $("empty-state").hidden = state.visible.length > 0;
    $("empty-title").textContent = !connected ? "Your collection starts here" : noData ? "No cards in this snapshot" : "No matching cards";
    $("empty-description").textContent = !connected ? "No repository connected." : noData ?
      "Waiting for the worker's first card snapshot." : "No cards match the current search and filters.";
    $("empty-action").replaceChildren(icon(!connected ? "github" : noData ? "refresh-cw" : "x"), document.createTextNode(!connected ? "Connect repository" : noData ? "Refresh" : "Clear filters"));
    $("empty-action").disabled = state.loading || state.busy || state.connecting;
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
      row.addEventListener("click", event => {
        if (!event.target.closest("a, button, input, select, textarea, label")) selectCard(card.id, true);
      });
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
      const mobilePercent = document.createElement("span");
      mobilePercent.className = "mobile-drop-percent " + (drop?.percent == null || drop.percent === 0 ? "muted" : drop.percent > 0 ? "positive" : "negative");
      mobilePercent.textContent = displayPercent(drop);
      mobilePercent.title = `24-hour change: ${fullPercent(drop)}`;
      mobilePercent.setAttribute("aria-label", mobilePercent.title);
      price.append(mobilePercent);
      const dropCell = document.createElement("td");
      dropCell.className = "numeric change-column " + (!drop || drop.dropCents === 0 ? "muted" : drop.dropCents > 0 ? "positive" : "negative");
      dropCell.textContent = drop ? `${drop.dropCents > 0 ? "-" : drop.dropCents < 0 ? "+" : ""}${formatMoney(Math.abs(drop.dropCents))}` : "\u2014";
      const percentage = document.createElement("span");
      percentage.className = "drop-percent" + (drop?.percent == null ? " muted" : "");
      percentage.textContent = displayPercent(drop);
      percentage.title = fullPercent(drop);
      dropCell.append(percentage);
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
    const sources = D.imageSources(card);
    const sourceKey = `${card.id}\n${sources.join("\n")}`;
    if (imageSourceKey === sourceKey) return;
    imageSourceKey = sourceKey;
    const image = $("card-image");
    image.loading = "eager";
    let index = 0;
    image.hidden = true;
    $("image-unavailable").hidden = false;
    image.alt = `${card.name} card image`;
    image.onload = () => { if (imageSourceKey === sourceKey) { image.hidden = false; $("image-unavailable").hidden = true; } };
    image.onerror = () => {
      if (imageSourceKey !== sourceKey) return;
      if (++index < sources.length) image.src = sources[index];
      else { image.hidden = true; $("image-unavailable").hidden = false; }
    };
    if (sources.length) image.src = sources[0];
    else image.removeAttribute("src");
  }

  function renderHistory(card) {
    chartLayout = null;
    chartActiveIndex = -1;
    $("chart-tooltip").hidden = true;
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
    $("history-chart").tabIndex = chartPoints.length ? 0 : -1;
    requestAnimationFrame(drawChart);
  }

  function drawChart() {
    const canvas = $("history-chart");
    chartLayout = null;
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
    chartLayout = { first, last, left, right, width };
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
    const active = chartPoints[chartActiveIndex];
    if (active) {
      ctx.beginPath(); ctx.moveTo(x(active), top); ctx.lineTo(x(active), bottom);
      ctx.strokeStyle = "#93b4a2"; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(x(active), y(active), 4, 0, Math.PI * 2);
      ctx.fillStyle = "#087b57"; ctx.fill(); ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.stroke();
      const tooltip = $("chart-tooltip");
      $("chart-tooltip-price").textContent = formatMoney(active.priceCents);
      $("chart-tooltip-date").textContent = formatDate(active.at);
      tooltip.hidden = false;
      tooltip.style.left = `${Math.max(4, Math.min(width - tooltip.offsetWidth - 4, x(active) - tooltip.offsetWidth / 2))}px`;
      const above = y(active) - tooltip.offsetHeight - 10;
      tooltip.style.top = `${above >= 4 ? above : Math.min(height - tooltip.offsetHeight - 4, y(active) + 10)}px`;
    }
  }

  function inspectChart(event) {
    if (!chartLayout || !chartPoints.length) return;
    const bounds = $("history-chart").getBoundingClientRect();
    const { first, last, left, right, width } = chartLayout;
    const pointerX = (event.clientX - bounds.left) * width / bounds.width;
    const at = first + Math.max(0, Math.min(1, (pointerX - left) / (right - left))) * (last - first);
    let low = 0, high = chartPoints.length - 1;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (Date.parse(chartPoints[middle].at) < at) low = middle + 1;
      else high = middle;
    }
    const index = low > 0 && at - Date.parse(chartPoints[low - 1].at) <= Date.parse(chartPoints[low].at) - at ? low - 1 : low;
    if (index !== chartActiveIndex) showChartPoint(index);
  }

  function showChartPoint(index) {
    if (!chartLayout || !chartPoints.length) return;
    chartActiveIndex = Math.max(0, Math.min(chartPoints.length - 1, index));
    drawChart();
  }

  function hideChartTooltip() {
    if (chartActiveIndex < 0) return;
    chartActiveIndex = -1;
    $("chart-tooltip").hidden = true;
    drawChart();
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
      imageSourceKey = null;
      chartPoints = [];
      chartLayout = null;
      chartActiveIndex = -1;
      $("chart-tooltip").hidden = true;
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
    $("detail-drop-percent").textContent = fullPercent(drop);
    $("detail-drop-percent").className = "detail-drop-percent " + (drop?.percent == null || drop.percent === 0 ? "muted" : drop.percent > 0 ? "positive" : "negative");
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
    const changesView = state.view === "changes";
    $("collection-view").hidden = changesView;
    $("changes-view").hidden = !changesView;
    $("page-title").textContent = changesView ? "Price changes" : "Price tracker";
    document.title = `${changesView ? "Price changes" : "Collection"} | CardTrader`;
    for (const [id, active] of [["collection-link", !changesView], ["changes-link", changesView]]) {
      if (active) $(id).setAttribute("aria-current", "page"); else $(id).removeAttribute("aria-current");
    }
    if (changesView) renderPriceChanges();
    else { renderMetrics(); renderTable(); renderDetail(); }
  }

  function renderPriceChanges() {
    const filtered = D.filterPriceChanges(state.changes, state.changeFilters);
    const page = D.paginatePriceChanges(filtered, state.changesPage);
    state.changesPage = page.page;
    const fragment = document.createDocumentFragment();
    for (const change of page.items) {
      const row = document.createElement("tr");
      row.className = "card-row";
      row.dataset.changedAt = change.at;
      row.dataset.changeId = change.id;
      row.addEventListener("click", event => {
        if (!event.target.closest("a, button, input, select, textarea, label")) openChangedCard(change.card);
      });
      const dateCell = document.createElement("td");
      dateCell.className = "changed-date";
      const time = document.createElement("time");
      time.dateTime = change.at;
      time.textContent = changeDates.format(new Date(change.at));
      time.title = change.at;
      dateCell.append(time);
      const cardCell = document.createElement("td");
      const name = document.createElement("button");
      name.type = "button";
      name.className = "card-title";
      name.textContent = change.card.name;
      name.addEventListener("click", () => openChangedCard(change.card));
      const metadata = document.createElement("span");
      metadata.className = "card-meta";
      metadata.textContent = `${change.card.expansion} / #${change.card.collectorNumber}${change.card.isFoil ? " / Foil" : ""}`;
      const mobileTime = time.cloneNode(true);
      mobileTime.className = "mobile-change-date card-meta";
      cardCell.append(name, metadata, mobileTime);
      const before = document.createElement("td");
      before.className = "numeric previous-price";
      before.textContent = formatMoney(change.beforeCents);
      const after = document.createElement("td");
      after.className = "numeric price";
      after.textContent = formatMoney(change.afterCents);
      const amount = document.createElement("td");
      amount.className = `numeric ${change.changeCents < 0 ? "positive" : "negative"}`;
      amount.textContent = `${change.changeCents < 0 ? "-" : "+"}${formatMoney(Math.abs(change.changeCents))}`;
      const percentage = document.createElement("span");
      percentage.className = "drop-percent" + (change.percent == null ? " muted" : "");
      percentage.textContent = compactSignedPercent(change.percent);
      percentage.title = signedPercent(change.percent);
      amount.append(percentage);
      row.append(dateCell, cardCell, before, after, amount);
      fragment.append(row);
    }
    $("changes-body").replaceChildren(fragment);
    $("changes-count").textContent = `${page.total.toLocaleString()} ${page.total === 1 ? "change" : "changes"}`;
    $("changes-range").textContent = `${(page.total ? page.start + 1 : 0).toLocaleString()}-${page.end.toLocaleString()} of ${page.total.toLocaleString()}`;
    $("changes-page").value = page.page;
    $("changes-page").max = page.totalPages;
    $("changes-total-pages").textContent = `of ${page.totalPages.toLocaleString()}`;
    const disabled = !state.client || state.loading || state.connecting || page.total === 0;
    $("changes-page").disabled = disabled;
    $("changes-first").disabled = disabled || page.page === 1;
    $("changes-previous").disabled = disabled || page.page === 1;
    $("changes-next").disabled = disabled || page.page === page.totalPages;
    $("changes-last").disabled = disabled || page.page === page.totalPages;
    $("clear-changes-search").hidden = !state.changeFilters.search;
    $("changes-empty").hidden = page.total > 0;
    $("changes-empty-title").textContent = !state.client ? "No repository connected" : state.changes.length ? "No matching changes" : "No price changes yet";
    $("changes-empty-action").textContent = !state.client ? "Connect repository" : state.changes.length ? "Clear filters" : "Refresh";
    $("changes-empty-action").disabled = state.loading || state.connecting;
  }

  function resetCollectionFilters(overrides = {}) {
    state.filters = { search: "", expansion: "", ownership: "all", watched: false, sort: "name", ...overrides };
    $("search").value = state.filters.search;
    $("expansion").value = state.filters.expansion;
    $("sort").value = state.filters.sort;
    $("watched").checked = state.filters.watched;
    document.querySelectorAll("[data-ownership]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.ownership === state.filters.ownership)));
  }

  function openChangedCard(card) {
    resetCollectionFilters({ search: String(card.blueprintId), expansion: String(card.expansionId) });
    state.selected = card.id;
    focusCardOnNavigation = true;
    window.location.hash = "#/collection";
  }

  function showSnapshot(snapshot) {
    state.prices = snapshot.prices;
    state.settings = snapshot.settings;
    state.changes = D.priceChanges(snapshot.prices);
    $("repository-label").textContent = `${state.client.config.owner}/${state.client.config.repo} / ${state.client.config.branch}`;
    $("last-checked").textContent = snapshot.prices.lastCheckedAt ? `Checked ${formatDate(snapshot.prices.lastCheckedAt)}` : "Never / partial snapshot";
    renderExpansions();
    render();
  }

  async function refresh() {
    if (!state.client || state.loading || state.busy || state.connecting || !discardDrafts("refresh")) return;
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
    if (state.busy || state.loading || state.connecting) return;
    const remembered = connectionStore.read();
    let prefs = {};
    try { prefs = JSON.parse(localStorage.getItem(preferencesKey) || "{}"); } catch (_) { /* Preferences are optional. */ }
    $("repo-owner").value = state.client?.config.owner || remembered?.config.owner || (typeof prefs?.owner === "string" ? prefs.owner : "");
    $("repo-name").value = state.client?.config.repo || remembered?.config.repo || (typeof prefs?.repo === "string" ? prefs.repo : "");
    $("repo-branch").value = state.client?.config.branch || remembered?.config.branch || (typeof prefs?.branch === "string" ? prefs.branch : D.DEFAULT_BRANCH);
    $("repo-token").value = "";
    $("remember-connection").checked = Boolean(remembered);
    const shownConfig = { owner: $("repo-owner").value, repo: $("repo-name").value, branch: $("repo-branch").value };
    if (remembered && Object.keys(shownConfig).every(key => remembered.config[key] === shownConfig[key]))
      $("repo-token").value = remembered.token;
    $("connection-error").hidden = true;
    $("connect-dialog").showModal();
  }

  function connectBusy(value) {
    state.connecting = value;
    $("submit-connect").disabled = value;
    ["repo-owner", "repo-name", "repo-branch", "repo-token", "remember-connection"].forEach(id => { $(id).disabled = value; });
    $("submit-connect").lastElementChild.textContent = value ? "Connecting..." : "Connect";
  }

  function closeConnect() {
    state.pendingClient?.disconnect();
    state.pendingClient = null;
    $("repo-token").value = "";
    connectBusy(false);
    $("connect-dialog").close();
    render();
  }

  async function connectRepository(input, token, remember, automatic = false) {
    if (state.connecting) return;
    let candidate;
    try {
      const config = D.validateConnection(input);
      token = token.trim();
      candidate = D.createClient(config, token);
      $("repo-token").value = "";
      state.pendingClient = candidate;
      connectBusy(true);
      if (automatic) notice("Reconnecting to your repository...", "loading");
      render();
      $("connection-error").hidden = true;
      const snapshot = await candidate.load();
      if (state.pendingClient !== candidate) return;
      state.client?.disconnect();
      state.client = candidate;
      state.session += 1;
      state.selected = null;
      state.pendingClient = null;
      try { localStorage.setItem(preferencesKey, JSON.stringify(config)); } catch (_) { /* Storage may be disabled. */ }
      const stored = remember ? connectionStore.save(config, token) : connectionStore.clear();
      showSnapshot(snapshot);
      notice(!stored ? "Connected, but browser storage could not be updated. Your connection may not be remembered or forgotten." :
        snapshot.prices.lastCheckedAt ? "" : "Partial snapshot. No complete worker check has finished yet.", !stored ? "error" : undefined);
      $("connect-dialog").close();
    } catch (error) {
      candidate?.disconnect();
      if (candidate && state.pendingClient !== candidate) return;
      if (automatic && error.status === 401) connectionStore.clear();
      const message = automatic && error.status === 401 ? "Your saved token was rejected. Connect again with a valid token." : error.message;
      $("connection-error").textContent = message;
      $("connection-error").hidden = false;
      if (automatic) notice(message, "error");
    } finally {
      token = "";
      if (!candidate || state.pendingClient === candidate || state.client === candidate) {
        state.pendingClient = null;
        connectBusy(false);
        render();
      }
    }
  }

  $("connect-form").addEventListener("submit", event => {
    event.preventDefault();
    if (state.connecting || !discardDrafts("connect")) return;
    connectRepository({ owner: $("repo-owner").value, repo: $("repo-name").value, branch: $("repo-branch").value },
      $("repo-token").value, $("remember-connection").checked);
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
    state.changes = [];
    state.changesPage = 1;
    state.settings = D.emptySettings();
    state.selected = null;
    state.busy = false;
    state.loading = false;
    $("repo-token").value = "";
    $("remember-connection").checked = false;
    const forgotten = connectionStore.clear();
    $("repository-label").textContent = "No repository connected";
    $("last-checked").textContent = "Not checked";
    renderExpansions();
    renderMetrics(); renderTable(); renderDetail(); renderPriceChanges();
    notice(forgotten ? "" : "Disconnected, but this browser could not remove the saved connection. Clear site data to forget it.", forgotten ? undefined : "error");
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
    resetCollectionFilters();
    render();
  });
  function filterChanges() { state.changesPage = 1; renderPriceChanges(); }
  $("changes-search").addEventListener("input", event => { state.changeFilters.search = event.target.value; filterChanges(); });
  $("clear-changes-search").addEventListener("click", () => { $("changes-search").value = ""; state.changeFilters.search = ""; filterChanges(); $("changes-search").focus(); });
  $("changes-expansion").addEventListener("change", event => { state.changeFilters.expansion = event.target.value; filterChanges(); });
  document.querySelectorAll("[data-direction]").forEach(button => button.addEventListener("click", () => {
    state.changeFilters.direction = button.dataset.direction;
    document.querySelectorAll("[data-direction]").forEach(item => item.setAttribute("aria-pressed", String(item === button)));
    filterChanges();
  }));
  for (const [id, target] of [["changes-first", () => 1], ["changes-previous", () => state.changesPage - 1],
    ["changes-next", () => state.changesPage + 1], ["changes-last", () => Number.MAX_SAFE_INTEGER]]) {
    $(id).addEventListener("click", () => changePage(target()));
  }
  function changePage(page) {
    state.changesPage = page;
    renderPriceChanges();
    const table = $("changes-table").parentElement;
    table.scrollTop = 0;
    table.scrollIntoView({ block: "nearest", behavior: "instant" });
    $("changes-body").querySelector("button")?.focus({ preventScroll: true });
  }
  function jumpChangePage() { changePage(Number($("changes-page").value)); }
  $("changes-page").addEventListener("change", jumpChangePage);
  $("changes-page").addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); jumpChangePage(); } });
  $("changes-empty-action").addEventListener("click", () => {
    if (!state.client) return openConnect();
    if (!state.changes.length) return refresh();
    state.changeFilters = { search: "", expansion: "", direction: "all" };
    $("changes-search").value = ""; $("changes-expansion").value = "";
    document.querySelectorAll("[data-direction]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.direction === "all")));
    filterChanges();
  });
  window.addEventListener("hashchange", () => {
    state.view = window.location.hash === "#/changes" ? "changes" : "collection";
    render();
    if (focusCardOnNavigation && state.view === "collection") {
      focusCardOnNavigation = false;
      selectCard(state.selected, true);
    }
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
  $("history-chart").addEventListener("pointermove", inspectChart);
  $("history-chart").addEventListener("pointerdown", inspectChart);
  $("history-chart").addEventListener("pointerleave", event => { if (event.pointerType !== "touch") hideChartTooltip(); });
  $("history-chart").addEventListener("pointercancel", hideChartTooltip);
  $("history-chart").addEventListener("focus", () => showChartPoint(chartActiveIndex < 0 ? chartPoints.length - 1 : chartActiveIndex));
  $("history-chart").addEventListener("blur", hideChartTooltip);
  $("history-chart").addEventListener("keydown", event => {
    if (event.key === "Escape") { hideChartTooltip(); return; }
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = chartActiveIndex < 0 ? chartPoints.length - 1 : chartActiveIndex;
    showChartPoint(event.key === "Home" ? 0 : event.key === "End" ? chartPoints.length - 1 : index + (event.key === "ArrowLeft" ? -1 : 1));
  });
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(drawChart).observe($("history-chart"));
  else window.addEventListener("resize", drawChart);
  render();
  const remembered = connectionStore.read();
  if (remembered) connectRepository(remembered.config, remembered.token, true, true);
})();
