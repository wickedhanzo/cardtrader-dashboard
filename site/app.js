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
  const viewFromHash = () => ({ "#/changes": "changes", "#/binder": "binder" })[window.location.hash] || "collection";
  const connectionStore = D.createConnectionStore({
    getItem: key => localStorage.getItem(key),
    setItem: (key, value) => localStorage.setItem(key, value),
    removeItem: key => localStorage.removeItem(key)
  }, new URL(".", window.location.href).pathname);
  const columnStore = D.createColumnStore({
    getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value)
  }, new URL(".", window.location.href).pathname);
  const state = {
    client: null, prices: null, settings: D.emptySettings(), selected: null, visible: [],
    filters: { search: "", expansion: "", ownership: "all", watched: false, cardmarketLowAboveNm: false, sort: "name" },
    drafts: new Map(), busy: false, loading: false, session: 0, pendingClient: null, connecting: false,
    view: viewFromHash(), runs: [],
    changeFilters: { search: "", expansion: "", direction: "all" }, changesPage: 1,
    expandedRuns: new Set(), runPages: new Map(),
    binderFilters: { search: "", expansion: "", ownership: "all", finish: "all" }, binderPage: 1,
    visibleGrades: new Set(columnStore.read())
  };
  let imageSourceKey = null;
  let focusCardOnNavigation = false;
  let chartPoints = [];
  let chartSeries = [];
  let selectedConditions = new Set(["NM"]);
  let watchCondition = "NM";
  let chartLayout = null;
  let chartActiveIndex = -1;

  const formatMoney = amount => money.format(amount / 100);
  const referenceMoney = amount => amount > 0 ? formatMoney(amount) : "\u2014";
  const formatDate = at => at ? dates.format(new Date(at)) : "Never";
  const targetText = amount => amount === null ? "" : (amount / 100).toFixed(2);
  const canEdit = () => Boolean(state.client?.canEdit) && !state.loading && !state.busy && !state.connecting;
  const hasDrafts = () => state.drafts.size > 0;
  const draftKey = (id, condition = watchCondition) => condition === "NM" ? id : `${id}|${condition}`;
  const watchPatch = amount => watchCondition === "NM" ? { notificationPriceCents: amount } : { conditionWatches: { [watchCondition]: amount } };
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

  function languageFlag(card) {
    const language = D.cardLanguageInfo(card);
    const image = document.createElement("img");
    image.className = "language-flag";
    image.src = language.flag;
    image.alt = image.title = language.name;
    image.width = 20;
    image.height = 14;
    return image;
  }

  function cardmarketLink(card, reference) {
    const link = document.createElement(reference.url ? "a" : "span");
    link.className = "cardmarket-link";
    link.textContent = `#${reference.productId}`;
    if (reference.url) {
      link.href = reference.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.title = `Cardmarket #${reference.productId}: ${D.cardLanguageInfo(card).name}, ${card.isFoil ? "foil" : "non-foil"} listings (opens in a new tab)`;
      link.setAttribute("aria-label", link.title);
      link.append(icon("link"));
    }
    return link;
  }

  function cardmarketCell(card) {
    const cell = document.createElement("td");
    cell.className = "numeric cardmarket-cell";
    const references = D.cardmarketReferences(card);
    cell.title = "Cardmarket general daily trend: all languages and all conditions";
    if (!references.length) {
      cell.textContent = "\u2014";
      cell.classList.add("muted");
      cell.title = "No exact Cardmarket product mapping";
    }
    for (const reference of references) {
      const entry = document.createElement("div");
      entry.className = "cardmarket-reference";
      entry.dataset.productId = reference.productId;
      const amount = document.createElement("span");
      amount.className = "cardmarket-trend" + (reference.quote?.trendCents > 0 ? "" : " muted");
      amount.textContent = referenceMoney(reference.quote?.trendCents);
      amount.title = `General trend / #${reference.productId}${reference.quote ? ` / ${formatDate(reference.quote.updatedAt)}` : " / No guide quote available"}`;
      const low = document.createElement("span");
      low.className = "cardmarket-low" + (reference.quote?.lowCents > 0 ? "" : " muted");
      low.textContent = `Low ${referenceMoney(reference.quote?.lowCents)}`;
      low.title = `General low / #${reference.productId}${reference.quote ? ` / ${formatDate(reference.quote.updatedAt)}` : " / No guide quote available"}`;
      entry.append(cardmarketLink(card, reference), amount, low);
      cell.append(entry);
    }
    return cell;
  }

  function renderCardmarket(card) {
    const references = D.cardmarketReferences(card);
    const entries = document.createDocumentFragment();
    for (const reference of references) {
      const entry = document.createElement("div");
      entry.className = "cardmarket-guide-entry";
      entry.dataset.productId = reference.productId;
      entry.append(cardmarketLink(card, reference));
      const metrics = document.createElement("dl");
      metrics.className = "cardmarket-metrics";
      for (const [key, label] of [["trendCents", "Trend"], ["lowCents", "Low"], ["average7Cents", "7d avg"], ["average30Cents", "30d avg"]]) {
        const metric = document.createElement("div");
        const name = document.createElement("dt");
        name.textContent = label;
        const amount = document.createElement("dd");
        amount.dataset.metric = key;
        amount.textContent = referenceMoney(reference.quote?.[key]);
        amount.classList.toggle("muted", !(reference.quote?.[key] > 0));
        metric.append(name, amount);
        metrics.append(metric);
      }
      const updated = document.createElement("p");
      updated.className = "cardmarket-updated";
      updated.textContent = reference.quote ? `Guide date: ${formatDate(reference.quote.updatedAt)}` : "No guide quote available";
      entry.append(metrics, updated);
      entries.append(entry);
    }
    $("cardmarket-references").replaceChildren(entries);
    $("cardmarket-unmapped").hidden = references.length > 0;
    $("cardmarket-link-filters").hidden = !references.length;
    $("cardmarket-link-filters").textContent = `Listings: ${D.cardLanguageInfo(card).name} / ${card.isFoil ? "Foil" : "Non-foil"}`;
    $("cardmarket-checked-at").textContent = `Guide last checked: ${formatDate(state.prices.cardmarketCheckedAt)}`;
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
      for (const watch of D.watchTargets(state.settings, card.id)) {
        watched += 1;
        const price = D.conditionPrice(card, watch.code);
        if (!saved.acquired && price.available && price.currentPriceCents < watch.thresholdCents) atTarget += 1;
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
    const ordered = [...expansions].sort((a, b) => a[1].localeCompare(b[1]));
    $("binder-expansion").replaceChildren();
    if (!expansions.has(state.binderFilters.expansion)) {
      state.binderFilters.expansion = state.filters.expansion || ordered[0]?.[0] || "";
      state.binderPage = 1;
    }
    if (!ordered.length) $("binder-expansion").add(new Option("No expansions", ""));
    for (const [id, name] of ordered) $("binder-expansion").add(new Option(name, id));
    $("binder-expansion").value = state.binderFilters.expansion;
    $("binder-expansion").disabled = !ordered.length;
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
      metadata.append(" ", languageFlag(card));
      titleCell.append(title, metadata);
      const price = document.createElement("td");
      price.className = "numeric price" + (card.available ? "" : " unavailable");
      price.dataset.gradeColumn = "NM";
      price.hidden = !state.visibleGrades.has("NM");
      price.textContent = card.available ? formatMoney(card.currentPriceCents) : "Unavailable";
      if (!card.available) price.title = D.conditionPrice(card).lastSeenAt ? `NM last seen ${formatDate(card.lastSeenAt)} at ${formatMoney(card.currentPriceCents)}` : "No NM listing observed";
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
      row.append(acquired, titleCell, price);
      for (const condition of D.CONDITIONS.slice(1)) {
        const quote = D.conditionPrice(card, condition.code);
        const cell = document.createElement("td");
        cell.className = "numeric condition-column";
        cell.dataset.condition = condition.code;
        cell.dataset.gradeColumn = condition.code;
        cell.hidden = !state.visibleGrades.has(condition.code);
        const value = document.createElement("button");
        value.type = "button";
        value.className = "condition-value" + (quote.available ? "" : " muted");
        value.textContent = quote.available ? formatMoney(quote.currentPriceCents) : "\u2014";
        value.title = `${condition.name}: ${quote.available ? formatMoney(quote.currentPriceCents) : quote.lastSeenAt ? `last seen ${formatDate(quote.lastSeenAt)} at ${formatMoney(quote.currentPriceCents)}` : quote.checked ? "no eligible listing returned" : "not checked yet"}`;
        value.setAttribute("aria-label", `${condition.code} history: ${card.name}`);
        value.addEventListener("click", () => {
          selectedConditions = new Set([condition.code]);
          watchCondition = condition.code;
          selectCard(card.id, true);
        });
        cell.append(value);
        const threshold = D.watchThreshold(state.settings, card.id, condition.code);
        if (threshold !== null) {
          const target = document.createElement("span");
          target.className = "condition-watch";
          target.classList.toggle("at-target", quote.available && !saved.acquired && quote.currentPriceCents < threshold);
          target.title = `${condition.code} watch: ${formatMoney(threshold)}`;
          target.append(icon("bell"), document.createTextNode(formatMoney(threshold)));
          cell.append(target);
        }
        row.append(cell);
      }
      row.append(cardmarketCell(card), dropCell, watch);
      fragment.append(row);
    }
    $("cards-body").replaceChildren(fragment);
    renderColumnVisibility();
    $("result-count").textContent = `${state.visible.length.toLocaleString()} ${state.visible.length === 1 ? "card" : "cards"}`;
    $("table-summary").textContent = state.prices ? `${state.visible.length.toLocaleString()} of ${state.prices.cards.length.toLocaleString()} cards` : "No snapshot loaded";
    $("clear-search").hidden = !state.filters.search;
    renderEmpty();
  }

  function renderColumnVisibility() {
    document.querySelectorAll("#cards-table [data-grade-column]").forEach(cell => {
      const hidden = !state.visibleGrades.has(cell.dataset.gradeColumn);
      if (cell.hidden !== hidden) cell.hidden = hidden;
    });
    document.querySelectorAll("#grade-column-options input").forEach(input => {
      input.checked = state.visibleGrades.has(input.value);
    });
    $("grade-column-count").textContent = `${state.visibleGrades.size} of ${D.CONDITIONS.length}`;
    $("reset-grade-columns").disabled = state.visibleGrades.size === D.CONDITIONS.length;
    const secondary = [...state.visibleGrades].filter(code => code !== "NM").length;
    $("cards-table").style.setProperty("--collection-table-min-width", `${566 + secondary * 76 + (state.visibleGrades.has("NM") ? 98 : 0)}px`);
    $("cards-table").style.setProperty("--collection-table-mobile-min-width", `${386 + secondary * 74 + (state.visibleGrades.has("NM") ? 82 : 0)}px`);
  }

  function setGradeColumns() {
    columnStore.save([...state.visibleGrades]);
    renderColumnVisibility();
  }

  function initializeGradeColumns() {
    for (const condition of D.CONDITIONS) {
      const label = document.createElement("label");
      label.title = condition.name;
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = condition.code;
      checkbox.setAttribute("aria-label", `Show ${condition.code} column`);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) state.visibleGrades.add(condition.code); else state.visibleGrades.delete(condition.code);
        setGradeColumns();
      });
      const code = document.createElement("span");
      code.className = "condition-code";
      code.style.setProperty("--grade-color", condition.color);
      code.textContent = condition.code;
      const name = document.createElement("span");
      name.textContent = condition.name;
      label.append(checkbox, code, name);
      $("grade-column-options").append(label);
    }
    $("reset-grade-columns").addEventListener("click", () => {
      state.visibleGrades = new Set(D.CONDITIONS.map(condition => condition.code));
      setGradeColumns();
    });
    document.addEventListener("click", event => {
      if (!$("grade-columns-control").contains(event.target)) $("grade-columns-control").open = false;
    });
    $("grade-columns-control").addEventListener("keydown", event => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      $("grade-columns-control").open = false;
      $("grade-columns-button").focus();
    });
    $("grade-columns-control").addEventListener("focusout", event => {
      if (event.relatedTarget && !$("grade-columns-control").contains(event.relatedTarget)) $("grade-columns-control").open = false;
    });
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
    chartSeries = D.conditionSeries(card, selectedConditions);
    chartPoints = chartSeries.flatMap(series => series.points).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    $("history-range").textContent = `${chartPoints.length} ${chartPoints.length === 1 ? "point" : "points"}`;
    $("chart-start").textContent = chartPoints.length ? shortDate.format(new Date(chartPoints[0].at)) : "";
    $("chart-end").textContent = chartPoints.length ? shortDate.format(new Date(chartPoints[chartPoints.length - 1].at)) : "";
    $("chart-empty").hidden = chartPoints.length > 0;
    $("chart-empty").textContent = selectedConditions.size ? "No history for selected conditions" : "No conditions selected";
    const historyBody = document.createDocumentFragment();
    for (const point of chartPoints.slice(-100).reverse()) {
      const row = document.createElement("tr");
      const at = document.createElement("td");
      at.textContent = formatDate(point.at);
      const amount = document.createElement("td");
      amount.className = "numeric";
      amount.textContent = formatMoney(point.priceCents);
      const grade = document.createElement("td");
      grade.className = "history-grade";
      grade.style.color = point.color;
      grade.textContent = point.condition;
      row.append(at, grade, amount);
      historyBody.append(row);
    }
    $("history-body").replaceChildren(historyBody);
    $("history-chart").setAttribute("aria-label", chartPoints.length ?
      `${card.name} ${[...selectedConditions].join(", ")} price history: ${chartPoints.length} points, ${formatMoney(chartPoints[0].priceCents)} to ${formatMoney(chartPoints[chartPoints.length - 1].priceCents)}. History data follows.` : "No price history available");
    $("history-chart").tabIndex = chartPoints.length ? 0 : -1;
    requestAnimationFrame(drawChart);
  }

  function drawChart() {
    const canvas = $("history-chart");
    chartLayout = null;
    if (!state.selected || $("detail-content").hidden) return;
    const width = canvas.clientWidth;
    if (!width) return;
    const height = 170;
    const ratio = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.round(width * ratio);
    canvas.height = height * ratio;
    const ctx = canvas.getContext("2d");
    ctx.scale(ratio, ratio);
    const left = 4, right = width - 5, top = 22, bottom = 161;
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
    chartLayout = { first, last, left, right, width, x, y };
    for (const series of chartSeries) {
      ctx.beginPath();
      series.points.forEach((point, index) => index ? ctx.lineTo(x(point), y(point)) : ctx.moveTo(x(point), y(point)));
      ctx.strokeStyle = series.color;
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      ctx.setLineDash(series.dash);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = series.color;
      for (const point of series.points) {
        ctx.beginPath(); ctx.arc(x(point), y(point), 2.5, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.font = "10px Segoe UI, sans-serif";
    ctx.fillStyle = "#718078";
    ctx.textAlign = "left";
    ctx.fillText(formatMoney(high), left, 11);
    const active = chartPoints[chartActiveIndex];
    if (active) {
      ctx.beginPath(); ctx.moveTo(x(active), top); ctx.lineTo(x(active), bottom);
      ctx.strokeStyle = "#93b4a2"; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(x(active), y(active), 4, 0, Math.PI * 2);
      ctx.fillStyle = active.color; ctx.fill(); ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.stroke();
      const tooltip = $("chart-tooltip");
      $("chart-tooltip-price").textContent = formatMoney(active.priceCents);
      $("chart-tooltip-condition").textContent = active.condition;
      $("chart-tooltip-condition").style.color = active.color;
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
    const { first, last, left, right, width, x, y } = chartLayout;
    const pointerX = (event.clientX - bounds.left) * width / bounds.width;
    const at = first + Math.max(0, Math.min(1, (pointerX - left) / (right - left))) * (last - first);
    const candidates = chartSeries.filter(series => series.points.length).map(series => {
      let low = 0, high = series.points.length - 1;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (Date.parse(series.points[middle].at) < at) low = middle + 1;
        else high = middle;
      }
      return low > 0 && at - Date.parse(series.points[low - 1].at) <= Date.parse(series.points[low].at) - at ? series.points[low - 1] : series.points[low];
    });
    const pointerY = event.clientY - bounds.top;
    const nearest = candidates.reduce((best, point) => !best || Math.hypot(x(point) - pointerX, y(point) - pointerY) < Math.hypot(x(best) - pointerX, y(best) - pointerY) ? point : best, null);
    const index = chartPoints.indexOf(nearest);
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
    const threshold = D.watchThreshold(state.settings, card.id, watchCondition);
    const key = draftKey(card.id);
    $("watch-condition").value = watchCondition;
    $("watch-condition").disabled = state.busy || state.loading || state.connecting;
    $("watch-price-label").textContent = `${watchCondition} watch price (EUR)`;
    $("clear-target").title = `Clear ${watchCondition} price watch`;
    $("clear-target").setAttribute("aria-label", $("clear-target").title);
    $("target-price").value = state.drafts.has(key) ? state.drafts.get(key) : targetText(threshold);
    $("target-price").disabled = !canEdit();
    $("target-error").hidden = true;
    $("draft-status").textContent = state.drafts.has(key) ? "Unsaved" : "";
    $("save-target").disabled = !canEdit() || !state.drafts.has(key);
    $("clear-target").disabled = !canEdit() || (threshold === null && !state.drafts.has(key));
  }

  function renderConditions(card) {
    const rows = document.createDocumentFragment();
    for (const condition of D.CONDITIONS) {
      const price = D.conditionPrice(card, condition.code);
      const threshold = D.watchThreshold(state.settings, card.id, condition.code);
      const row = document.createElement("div");
      row.className = "condition-price-row";
      row.style.setProperty("--grade-color", condition.color);
      const label = document.createElement("label");
      label.className = "condition-price-label";
      label.title = condition.name;
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.dataset.condition = condition.code;
      checkbox.checked = selectedConditions.has(condition.code);
      checkbox.setAttribute("aria-label", `${condition.code} history`);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) selectedConditions.add(condition.code); else selectedConditions.delete(condition.code);
        renderHistory(card);
      });
      const code = document.createElement("span");
      code.className = "condition-code";
      code.textContent = condition.code;
      const amount = document.createElement("span");
      amount.className = "condition-amount" + (price.available ? "" : " muted");
      amount.textContent = price.available ? formatMoney(price.currentPriceCents) : "\u2014";
      amount.title = price.available ? `Cheapest returned ${condition.name} listing` : price.lastSeenAt ? `Last seen ${formatDate(price.lastSeenAt)} at ${formatMoney(price.currentPriceCents)}` : price.checked ? "No eligible listing returned" : "Not checked yet";
      label.append(checkbox, code, amount);
      const watch = document.createElement("button");
      watch.type = "button";
      watch.className = "condition-watch-button" + (threshold !== null ? " has-watch" : "");
      watch.dataset.condition = condition.code;
      watch.title = `${condition.code} watch${threshold !== null ? `: ${formatMoney(threshold)}` : ""}`;
      watch.setAttribute("aria-label", `Edit ${condition.code} watch`);
      watch.disabled = state.busy || state.loading || state.connecting;
      watch.append(icon("bell"));
      if (threshold !== null) watch.append(document.createTextNode(formatMoney(threshold)));
      watch.addEventListener("click", () => {
        watchCondition = condition.code;
        renderTarget(card);
        $("watch-form").scrollIntoView({ block: "nearest", behavior: "instant" });
        $("target-price").focus({ preventScroll: true });
      });
      row.append(label, watch);
      rows.append(row);
    }
    $("condition-prices").replaceChildren(rows);
  }

  function renderDetail() {
    const card = state.prices?.cards.find(item => item.id === state.selected);
    $("detail-empty").hidden = Boolean(card);
    $("detail-content").hidden = !card;
    if (!card) {
      imageSourceKey = null;
      chartPoints = [];
      chartSeries = [];
      chartLayout = null;
      chartActiveIndex = -1;
      $("chart-tooltip").hidden = true;
      $("condition-prices").replaceChildren();
      $("history-body").replaceChildren();
      $("card-image").removeAttribute("src");
      $("cardtrader-link").removeAttribute("href");
      $("detail-language").replaceChildren();
      $("cardmarket-references").replaceChildren();
      return;
    }
    const saved = D.setting(state.settings, card.id);
    const drop = D.change24h(card, state.prices.lastCheckedAt);
    $("detail-name").textContent = card.name;
    $("detail-expansion").textContent = `${card.expansion} / #${card.collectorNumber}`;
    $("detail-rarity").textContent = card.rarity || "Unknown rarity";
    $("detail-finish").textContent = card.isFoil ? "Foil" : "Normal";
    $("detail-blueprint").textContent = `ID ${card.blueprintId}`;
    $("detail-language").replaceChildren(languageFlag(card), document.createTextNode(`CardTrader: ${D.cardLanguageInfo(card).name}`));
    $("cardtrader-link").href = `https://www.cardtrader.com/en/cards/${card.blueprintId}`;
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
    $("last-seen").textContent = D.conditionPrice(card).lastSeenAt ? `NM last seen ${formatDate(card.lastSeenAt)}${card.available ? "" : ` / ${formatMoney(card.currentPriceCents)}`}` : "No NM listing observed";
    const index = state.visible.findIndex(item => item.id === card.id);
    $("previous-card").disabled = index <= 0;
    $("next-card").disabled = index < 0 || index >= state.visible.length - 1;
    renderImage(card);
    renderCardmarket(card);
    renderConditions(card);
    renderHistory(card);
    renderTarget(card);
  }

  function render() {
    updateControls();
    const titles = { collection: "Price tracker", changes: "Price changes", binder: "Collection binder" };
    $("page-title").textContent = titles[state.view];
    document.title = `${state.view === "collection" ? "Collection" : titles[state.view]} | CardTrader`;
    for (const view of ["collection", "binder", "changes"]) {
      $(`${view}-view`).hidden = state.view !== view;
      if (state.view === view) $(`${view}-link`).setAttribute("aria-current", "page");
      else $(`${view}-link`).removeAttribute("aria-current");
    }
    if (state.view === "changes") renderPriceChanges();
    else if (state.view === "binder") renderBinder();
    else { renderMetrics(); renderTable(); renderDetail(); }
  }

  function renderBinder() {
    const page = D.binderPage(state.prices, state.settings, state.binderFilters, state.binderPage);
    state.binderPage = page.page;
    $("binder-content").hidden = page.total === 0;
    $("binder-empty").hidden = page.total > 0;
    $("binder-empty-title").textContent = !state.client ? "No repository connected" : state.prices?.cards.length ? "No matching cards" : "No cards in this snapshot";
    $("binder-empty-action").textContent = !state.client ? "Connect repository" : state.prices?.cards.length ? "Clear filters" : "Refresh";
    $("binder-empty-action").disabled = state.loading || state.busy || state.connecting;
    $("binder-results").textContent = `${page.total.toLocaleString()} ${page.total === 1 ? "card" : "cards"}`;
    $("clear-binder-search").hidden = !state.binderFilters.search;
    $("binder-title").textContent = $("binder-expansion").selectedOptions[0]?.textContent || "";
    $("binder-acquired-count").textContent = `${page.acquired.toLocaleString()} of ${page.expansionTotal.toLocaleString()} acquired`;
    $("binder-progress").max = Math.max(1, page.expansionTotal);
    $("binder-progress").value = page.acquired;
    $("binder-range").textContent = `${page.total ? page.start + 1 : 0}-${page.end} of ${page.total.toLocaleString()}`;
    $("binder-page").value = page.page;
    $("binder-page").max = page.totalPages;
    $("binder-total-pages").textContent = `of ${page.totalPages.toLocaleString()}`;
    $("binder-bottom-page").textContent = `Spread ${page.page.toLocaleString()} of ${page.totalPages.toLocaleString()}`;
    for (const suffix of ["", "-bottom"]) {
      $(`binder-first${suffix}`).disabled = $(`binder-previous${suffix}`).disabled = page.page === 1;
      $(`binder-last${suffix}`).disabled = $(`binder-next${suffix}`).disabled = page.page === page.totalPages;
    }
    const pages = document.createDocumentFragment();
    if (page.total) for (let side = 0; side < 2; side += 1) {
      const sheet = document.createElement("section");
      sheet.className = "binder-sheet";
      const number = (page.page - 1) * 2 + side + 1;
      sheet.setAttribute("aria-label", `Binder page ${number}`);
      const grid = document.createElement("div");
      grid.className = "binder-grid";
      const items = page.items.slice(side * 9, side * 9 + 9);
      sheet.classList.toggle("binder-sheet-empty", items.length === 0);
      for (let slot = 0; slot < 9; slot += 1) {
        const card = items[slot];
        const pocket = document.createElement("div");
        pocket.className = "binder-pocket";
        if (card) {
          const acquired = D.setting(state.settings, card.id).acquired;
          pocket.classList.toggle("is-missing", !acquired);
          pocket.dataset.cardId = card.id;
          const button = document.createElement("button");
          button.type = "button";
          button.className = "binder-card";
          button.title = `${card.name} / #${card.collectorNumber} / ${card.isFoil ? "Foil" : "Normal"} / ${acquired ? "Acquired" : "Missing"}`;
          button.setAttribute("aria-label", button.title);
          button.addEventListener("click", () => openChangedCard(card));
          const art = document.createElement("span");
          art.className = "binder-art";
          const placeholder = document.createElement("span");
          placeholder.className = "binder-image-placeholder";
          placeholder.append(icon("image"));
          const image = document.createElement("img");
          image.className = "binder-image";
          image.alt = `${card.name} card image`;
          image.loading = "lazy";
          image.decoding = "async";
          image.referrerPolicy = "no-referrer";
          image.onload = () => { image.hidden = false; placeholder.hidden = true; };
          image.onerror = () => { image.hidden = true; placeholder.hidden = false; };
          const source = D.imageSources(card)[0];
          if (source) image.src = source;
          else image.hidden = true;
          art.append(image, placeholder);
          const name = document.createElement("span");
          name.className = "binder-card-name";
          name.textContent = card.name;
          button.append(art, name);
          const metadata = document.createElement("div");
          metadata.className = "binder-card-meta";
          const collector = document.createElement("span");
          collector.textContent = `#${card.collectorNumber}`;
          collector.title = `Collector number ${card.collectorNumber}`;
          collector.append(" ", languageFlag(card));
          const finish = document.createElement("span");
          finish.textContent = card.isFoil ? "Foil" : "Normal";
          const checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.checked = acquired;
          checkbox.disabled = !canEdit();
          checkbox.title = "Acquired";
          checkbox.setAttribute("aria-label", `Acquired: ${card.name}, #${card.collectorNumber}, ${card.isFoil ? "foil" : "normal"}`);
          checkbox.addEventListener("change", async () => {
            const focused = document.activeElement === checkbox;
            await saveCard(card.id, { acquired: checkbox.checked });
            if (focused && state.view === "binder")
              document.querySelector(`#binder-pages [data-card-id="${card.id}"] input`)?.focus({ preventScroll: true });
          });
          metadata.append(collector, finish, checkbox);
          pocket.append(button, metadata);
        } else {
          pocket.classList.add("binder-blank");
          pocket.setAttribute("aria-hidden", "true");
        }
        grid.append(pocket);
      }
      const caption = document.createElement("span");
      caption.className = "binder-sheet-number";
      caption.textContent = items.length ? `Page ${number}` : "";
      sheet.append(grid, caption);
      pages.append(sheet);
    }
    $("binder-pages").replaceChildren(pages);
  }

  function renderPriceChanges() {
    const filtered = D.filterCheckRuns(state.runs, state.changeFilters);
    const page = D.paginatePriceChanges(filtered, state.changesPage);
    state.changesPage = page.page;
    const fragment = document.createDocumentFragment();
    for (const run of page.items) {
      const group = document.createElement("details");
      group.className = "run-group";
      group.classList.toggle("run-failed", run.succeeded === false);
      group.dataset.runId = run.id;
      group.dataset.startedAt = run.at;
      const summary = document.createElement("summary");
      const heading = document.createElement("span");
      heading.className = "run-heading";
      const title = document.createElement("strong");
      title.textContent = run.legacy ? "Earlier history" : changeDates.format(new Date(run.startedAt));
      const metadata = document.createElement("span");
      metadata.className = "run-meta";
      metadata.textContent = run.legacy ? "Before run tracking" :
        `${run.checkedCards.toLocaleString()} checked / ${run.newCards.toLocaleString()} new / ${run.succeeded ? "Complete" : "With errors"}`;
      heading.append(title, metadata);
      const count = document.createElement("span");
      count.className = "run-count";
      count.textContent = `${run.totalChanges.toLocaleString()} price ${run.totalChanges === 1 ? "update" : "updates"}`;
      if (run.changes.length !== run.totalChanges) {
        const matching = document.createElement("span");
        matching.className = "run-meta";
        matching.textContent = `${run.changes.length.toLocaleString()} matching`;
        count.append(matching);
      }
      summary.append(icon("chevron-right"), heading, count);
      const contents = document.createElement("div");
      contents.className = "run-content";
      group.append(summary, contents);
      group.open = state.expandedRuns.has(run.id);
      if (group.open) renderRunContents(contents, run);
      group.addEventListener("toggle", () => {
        if (group.open) { state.expandedRuns.add(run.id); renderRunContents(contents, run); }
        else { state.expandedRuns.delete(run.id); contents.replaceChildren(); }
      });
      fragment.append(group);
    }
    $("changes-body").replaceChildren(fragment);
    const actual = filtered.filter(run => !run.legacy).length;
    const totalChanges = filtered.reduce((sum, run) => sum + run.changes.length, 0);
    $("changes-count").textContent = `${actual.toLocaleString()} ${actual === 1 ? "run" : "runs"} / ${totalChanges.toLocaleString()} price updates`;
    $("changes-range").textContent = `${(page.total ? page.start + 1 : 0).toLocaleString()}-${page.end.toLocaleString()} of ${page.total.toLocaleString()} groups`;
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
    $("changes-empty-title").textContent = !state.client ? "No repository connected" : state.runs.length ? "No matching changes" : "No checks recorded yet";
    $("changes-empty-action").textContent = !state.client ? "Connect repository" : state.runs.length ? "Clear filters" : "Refresh";
    $("changes-empty-action").disabled = state.loading || state.connecting;
  }

  function renderRunContents(container, run) {
    const page = D.paginatePriceChanges(run.changes, state.runPages.get(run.id) || 1);
    state.runPages.set(run.id, page.page);
    if (!page.total) {
      const empty = document.createElement("p");
      empty.className = "run-empty";
      empty.textContent = "No price updates in this run.";
      container.replaceChildren(empty);
      return;
    }
    const scroll = document.createElement("div");
    scroll.className = "table-scroll";
    const table = document.createElement("table");
    table.className = "run-changes-table";
    const head = document.createElement("thead"), headRow = document.createElement("tr");
    for (const [label, className] of [["Changed", "changed-date"], ["Card", ""], ["Before", "numeric previous-price"], ["After", "numeric"], ["Change", "numeric"]]) {
      const cell = document.createElement("th");
      cell.scope = "col"; cell.className = className; cell.textContent = label; headRow.append(cell);
    }
    head.append(headRow);
    const body = document.createElement("tbody");
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
      body.append(row);
    }
    table.append(head, body); scroll.append(table);
    const footer = document.createElement("div");
    footer.className = "run-pagination";
    const range = document.createElement("span");
    range.textContent = `${page.start + 1}-${page.end} of ${page.total.toLocaleString()} price ${page.total === 1 ? "update" : "updates"}`;
    footer.append(range);
    if (page.totalPages > 1) {
      for (const [label, image, offset] of [["Previous changes", "chevron-left", -1], ["Next changes", "chevron-right", 1]]) {
        const button = document.createElement("button");
        button.type = "button"; button.className = "icon-button"; button.title = label; button.setAttribute("aria-label", label);
        button.disabled = offset < 0 ? page.page === 1 : page.page === page.totalPages;
        button.append(icon(image));
        button.addEventListener("click", () => {
          state.runPages.set(run.id, page.page + offset);
          renderRunContents(container, run);
          container.querySelector(`button[aria-label="${label}"]:not(:disabled)`)?.focus({ preventScroll: true });
          container.querySelector(".table-scroll").scrollTop = 0;
        });
        footer.append(button);
      }
    }
    container.replaceChildren(scroll, footer);
  }

  function resetCollectionFilters(overrides = {}) {
    state.filters = { search: "", expansion: "", ownership: "all", watched: false, cardmarketLowAboveNm: false, sort: "name", ...overrides };
    $("search").value = state.filters.search;
    $("expansion").value = state.filters.expansion;
    $("sort").value = state.filters.sort;
    $("watched").checked = state.filters.watched;
    $("cardmarket-low-above-nm").checked = state.filters.cardmarketLowAboveNm;
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
    state.runs = D.checkRuns(snapshot.prices);
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
      for (const condition of Object.keys(patch.conditionWatches || {})) state.drafts.delete(draftKey(id, condition));
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
    state.runs = [];
    state.expandedRuns.clear();
    state.runPages.clear();
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
    renderMetrics(); renderTable(); renderDetail(); renderPriceChanges(); renderBinder();
    notice(forgotten ? "" : "Disconnected, but this browser could not remove the saved connection. Clear site data to forget it.", forgotten ? undefined : "error");
    render();
  });
  $("search").addEventListener("input", event => { state.filters.search = event.target.value; renderTable(); renderDetail(); });
  $("clear-search").addEventListener("click", () => { $("search").value = ""; state.filters.search = ""; renderTable(); renderDetail(); $("search").focus(); });
  $("expansion").addEventListener("change", event => { state.filters.expansion = event.target.value; renderTable(); renderDetail(); });
  $("sort").addEventListener("change", event => { state.filters.sort = event.target.value; renderTable(); renderDetail(); });
  $("watched").addEventListener("change", event => { state.filters.watched = event.target.checked; renderTable(); renderDetail(); });
  $("cardmarket-low-above-nm").addEventListener("change", event => { state.filters.cardmarketLowAboveNm = event.target.checked; renderTable(); renderDetail(); });
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
  function filterBinder() { state.binderPage = 1; renderBinder(); }
  $("binder-search").addEventListener("input", event => { state.binderFilters.search = event.target.value; filterBinder(); });
  $("clear-binder-search").addEventListener("click", () => { $("binder-search").value = ""; state.binderFilters.search = ""; filterBinder(); $("binder-search").focus(); });
  $("binder-expansion").addEventListener("change", event => { state.binderFilters.expansion = event.target.value; filterBinder(); });
  $("binder-finish").addEventListener("change", event => { state.binderFilters.finish = event.target.value; filterBinder(); });
  document.querySelectorAll("[data-binder-ownership]").forEach(button => button.addEventListener("click", () => {
    state.binderFilters.ownership = button.dataset.binderOwnership;
    document.querySelectorAll("[data-binder-ownership]").forEach(item => item.setAttribute("aria-pressed", String(item === button)));
    filterBinder();
  }));
  function turnBinderPage(page, scroll = true) {
    state.binderPage = page;
    renderBinder();
    if (scroll) $("binder-content").scrollIntoView({ block: "start", behavior: "instant" });
  }
  for (const [id, target] of [["binder-first", () => 1], ["binder-previous", () => state.binderPage - 1],
    ["binder-next", () => state.binderPage + 1], ["binder-last", () => Number.MAX_SAFE_INTEGER]]) {
    for (const suffix of ["", "-bottom"]) $(id + suffix).addEventListener("click", () => turnBinderPage(target()));
  }
  $("binder-page").addEventListener("change", () => turnBinderPage(Number($("binder-page").value), false));
  $("binder-page").addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); turnBinderPage(Number($("binder-page").value)); } });
  $("binder-empty-action").addEventListener("click", () => {
    if (!state.client) return openConnect();
    if (!state.prices?.cards.length) return refresh();
    state.binderFilters = { ...state.binderFilters, search: "", ownership: "all", finish: "all" };
    $("binder-search").value = ""; $("binder-finish").value = "all";
    document.querySelectorAll("[data-binder-ownership]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.binderOwnership === "all")));
    filterBinder();
  });
  function filterChanges() { state.changesPage = 1; state.runPages.clear(); renderPriceChanges(); }
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
    $("changes-body").querySelector("summary")?.focus({ preventScroll: true });
  }
  function jumpChangePage() { changePage(Number($("changes-page").value)); }
  $("changes-page").addEventListener("change", jumpChangePage);
  $("changes-page").addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); jumpChangePage(); } });
  $("changes-empty-action").addEventListener("click", () => {
    if (!state.client) return openConnect();
    if (!state.runs.length) return refresh();
    state.changeFilters = { search: "", expansion: "", direction: "all" };
    $("changes-search").value = ""; $("changes-expansion").value = "";
    document.querySelectorAll("[data-direction]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.direction === "all")));
    filterChanges();
  });
  window.addEventListener("hashchange", () => {
    state.view = viewFromHash();
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
  $("watch-condition").addEventListener("change", event => {
    watchCondition = event.target.value;
    const card = state.prices?.cards.find(item => item.id === state.selected);
    if (card) renderTarget(card);
  });
  $("target-price").addEventListener("input", event => {
    if (!state.selected || !canEdit()) return;
    const value = event.target.value;
    let matchesSaved = false;
    const key = draftKey(state.selected);
    const threshold = D.watchThreshold(state.settings, state.selected, watchCondition);
    try { matchesSaved = D.parseTarget(value) === threshold; } catch (_) { /* Invalid drafts remain editable. */ }
    if (matchesSaved) state.drafts.delete(key); else state.drafts.set(key, value);
    $("target-error").hidden = true;
    $("draft-status").textContent = state.drafts.has(key) ? "Unsaved" : "";
    $("save-target").disabled = !state.drafts.has(key);
    $("clear-target").disabled = !value && threshold === null;
    updateControls();
  });
  $("watch-form").addEventListener("submit", event => {
    event.preventDefault();
    if (!state.selected || !canEdit()) return;
    try { saveCard(state.selected, watchPatch(D.parseTarget($("target-price").value))); }
    catch (error) { $("target-error").textContent = error.message; $("target-error").hidden = false; $("target-price").focus(); }
  });
  $("clear-target").addEventListener("click", () => { if (state.selected && canEdit()) saveCard(state.selected, watchPatch(null)); });
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
  initializeGradeColumns();
  render();
  const remembered = connectionStore.read();
  if (remembered) connectRepository(remembered.config, remembered.token, true, true);
})();
