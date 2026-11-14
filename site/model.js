(function (root) {
  "use strict";

  const DEFAULT_BRANCH = "cardtrader-state";
  const ID = /^\d+:\d+:(normal|foil)$/;
  const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
  const cents = value => Number.isSafeInteger(value) && value >= 0;
  const targetCents = value => cents(value) && value <= 2147483647;
  const date = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
  const emptySettings = () => ({ schemaVersion: 1, cards: {} });

  function validateSettings(value) {
    if (!object(value) || value.schemaVersion !== 1 || !object(value.cards)) {
      throw new Error("settings.json must have schemaVersion 1 and a cards object.");
    }
    for (const [id, card] of Object.entries(value.cards)) {
      if (!ID.test(id) || !object(card) ||
          (card.acquired !== undefined && typeof card.acquired !== "boolean") ||
          (card.notificationPriceCents !== undefined && card.notificationPriceCents !== null && !targetCents(card.notificationPriceCents))) {
        throw new Error("settings.json contains an invalid card setting.");
      }
    }
    return value;
  }

  function validatePrices(value) {
    if (!object(value) || value.schemaVersion !== 1 || (value.lastCheckedAt !== null && !date(value.lastCheckedAt)) || !Array.isArray(value.cards)) {
      throw new Error("prices.json must have schemaVersion 1, lastCheckedAt, and a cards array.");
    }
    const seen = new Set();
    for (const card of value.cards) {
      if (!object(card) || !ID.test(card.id) || seen.has(card.id) || !cents(card.blueprintId) || !cents(card.expansionId) ||
          typeof card.isFoil !== "boolean" || typeof card.available !== "boolean" || !cents(card.currentPriceCents) ||
          !date(card.lastSeenAt) || !["name", "expansion", "collectorNumber", "rarity"].every(key => typeof card[key] === "string") ||
          card.id !== `${card.expansionId}:${card.blueprintId}:${card.isFoil ? "foil" : "normal"}` ||
          !Array.isArray(card.history) || card.history.some(point => !object(point) || !date(point.at) || !cents(point.priceCents)) ||
          (card.imageUrl !== undefined && card.imageUrl !== null && typeof card.imageUrl !== "string")) {
        throw new Error("prices.json contains an invalid or duplicate card. Check the worker output.");
      }
      seen.add(card.id);
    }
    return value;
  }

  function setting(settings, id) {
    const card = settings.cards[id] || {};
    return { acquired: card.acquired === true, notificationPriceCents: card.notificationPriceCents ?? null };
  }

  function change24h(card, checkedAt) {
    if (!card.available) return null;
    const reference = card.lastSeenAt || checkedAt;
    if (!date(reference)) return null;
    const cutoff = Date.parse(reference) - 86400000;
    let baseline = null;
    for (const point of card.history) {
      const at = Date.parse(point.at);
      if (at <= cutoff && (!baseline || at > Date.parse(baseline.at))) baseline = point;
    }
    if (!baseline) return null;
    const dropCents = baseline.priceCents - card.currentPriceCents;
    return { baselineCents: baseline.priceCents, dropCents, percent: baseline.priceCents ? dropCents / baseline.priceCents * 100 : null };
  }

  function filterCards(prices, settings, filters) {
    const query = (filters.search || "").trim().toLocaleLowerCase();
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
    const result = prices.cards.filter(card => {
      const saved = setting(settings, card.id);
      const haystack = [card.name, card.expansion, card.collectorNumber, String(card.blueprintId)].join("\n").toLocaleLowerCase();
      return (!query || haystack.includes(query)) && (!filters.expansion || String(card.expansionId) === filters.expansion) &&
        (filters.ownership !== "acquired" || saved.acquired) && (filters.ownership !== "missing" || !saved.acquired) &&
        (!filters.watched || saved.notificationPriceCents !== null);
    });
    return result.sort((a, b) => {
      let comparison = 0;
      if (filters.sort === "price" || filters.sort === "price-desc") {
        if (a.available !== b.available) return a.available ? -1 : 1;
        comparison = (a.currentPriceCents - b.currentPriceCents) * (filters.sort === "price-desc" ? -1 : 1);
      } else if (filters.sort === "drop" || filters.sort === "drop-percent") {
        const left = change24h(a, prices.lastCheckedAt);
        const right = change24h(b, prices.lastCheckedAt);
        const leftValue = filters.sort === "drop-percent" ? left?.percent : left?.dropCents;
        const rightValue = filters.sort === "drop-percent" ? right?.percent : right?.dropCents;
        if ((leftValue != null) !== (rightValue != null)) return leftValue != null ? -1 : 1;
        comparison = (rightValue ?? 0) - (leftValue ?? 0);
      }
      return comparison || collator.compare(a.name, b.name) || collator.compare(a.id, b.id);
    });
  }

  function parseTarget(input) {
    const raw = String(input).trim();
    if (!raw) return null;
    if (!/^\d+(?:[.,]\d{1,2})?$/.test(raw)) throw new Error("Enter a positive EUR amount with up to two decimal places.");
    const [whole, fraction = ""] = raw.split(/[.,]/);
    const amount = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
    if (!targetCents(amount)) throw new Error("Watch price must be between EUR 0.00 and EUR 21,474,836.47.");
    return amount;
  }

  function validateConnection(input) {
    const owner = input.owner.trim();
    const repo = input.repo.trim();
    const branch = input.branch.trim() || DEFAULT_BRANCH;
    if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(owner) || !/^[a-zA-Z0-9_.-]+$/.test(repo) || repo === "." || repo === "..") {
      throw new Error("Enter a valid GitHub owner and repository name.");
    }
    if (/\s|[~^:?*\[\\]|\.\.|@\{|\/\/|\.$|\/$|^\/|^-/.test(branch) || branch.split("/").some(part => part.startsWith(".") || part.endsWith(".lock"))) {
      throw new Error("Enter a valid branch name.");
    }
    return { owner, repo, branch };
  }

  function createConnectionStore(storage, scope = "/") {
    const key = `cardtrader.connection.v1:${scope}`;
    function clear() {
      try { storage.removeItem(key); return true; }
      catch (_) { return false; }
    }
    function read() {
      try {
        const raw = storage.getItem(key);
        if (raw === null) return null;
        const saved = JSON.parse(raw);
        if (!object(saved) || saved.version !== 1 || !object(saved.config) || typeof saved.token !== "string" ||
            saved.token.length > 4096 || /[\x00-\x1f\x7f]/.test(saved.token)) throw new Error("Invalid saved connection.");
        return { config: validateConnection(saved.config), token: saved.token };
      } catch (_) { clear(); return null; }
    }
    function save(connection, token) {
      const config = validateConnection(connection);
      if (typeof token !== "string" || token.length > 4096 || /[\x00-\x1f\x7f]/.test(token)) return false;
      try {
        storage.setItem(key, JSON.stringify({ version: 1, config, token }));
        return true;
      } catch (_) { clear(); return false; }
    }
    return { read, save, clear };
  }

  function encodeContent(value) {
    const bytes = new TextEncoder().encode(JSON.stringify(value, null, 2) + "\n");
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }

  function decodeContent(value) {
    const binary = atob(value.replace(/\s/g, ""));
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(binary, character => character.charCodeAt(0))));
  }

  function createClient(connection, personalToken, transport) {
    const config = validateConnection(connection);
    let token = (personalToken || "").trim();
    let disposed = false;
    const send = transport || root.fetch.bind(root);
    const base = `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}`;
    const controllers = new Set();
    const hasToken = Boolean(token);

    async function request(path, options) {
      if (disposed) throw new Error("Repository disconnected.");
      const controller = new AbortController();
      controllers.add(controller);
      const timeout = setTimeout(() => controller.abort(), 30000);
      const opts = options || {};
      const headers = {
        Accept: opts.raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28"
      };
      if (token) headers.Authorization = `Bearer ${token}`;
      if (opts.body) headers["Content-Type"] = "application/json";
      try {
        const response = await send(base + path, {
          method: opts.method || "GET", headers, body: opts.body ? JSON.stringify(opts.body) : undefined,
          signal: controller.signal, cache: "no-store", credentials: "omit", redirect: "error", referrerPolicy: "no-referrer"
        });
        if (disposed) throw new Error("Repository disconnected.");
        if (!response.ok) {
          let message = `GitHub request failed (${response.status}).`;
          if (response.status === 401) message = "GitHub rejected the token. Reconnect with a valid token.";
          if (response.status === 403 || response.status === 429) message = response.headers?.get("X-RateLimit-Remaining") === "0"
            ? "GitHub's API rate limit was reached. Wait before refreshing."
            : "GitHub denied access. Check token permissions, repository access, or API rate limits.";
          if (response.status === 404) message = "Repository or state file not found. Check access and branch; the worker creates state after its first successful run.";
          const error = new Error(message);
          error.status = response.status;
          throw error;
        }
        try { return await response.json(); }
        catch (_) { throw new Error("GitHub returned invalid JSON. Check the state files."); }
      } catch (error) {
        if (error.name === "AbortError") throw new Error(disposed ? "Repository disconnected." : "GitHub took too long to respond. Try again.");
        if (error instanceof TypeError) throw new Error("Could not reach GitHub. Check your network connection and try again.");
        throw error;
      } finally {
        clearTimeout(timeout);
        controllers.delete(controller);
      }
    }

    const filePath = name => `/contents/${name}?ref=${encodeURIComponent(config.branch)}`;

    async function load() {
      await request("");
      const prices = validatePrices(await request(filePath("prices.json"), { raw: true }));
      let settings;
      try { settings = validateSettings(await request(filePath("settings.json"), { raw: true })); }
      catch (error) { if (error.status !== 404) throw error; settings = emptySettings(); }
      return { prices, settings };
    }

    async function patchSettings(id, changes) {
      if (!hasToken) throw new Error("A repository token is required to save settings.");
      if (!ID.test(id) || !object(changes) || !Object.keys(changes).length ||
          Object.keys(changes).some(key => !["acquired", "notificationPriceCents"].includes(key)) ||
          ("acquired" in changes && typeof changes.acquired !== "boolean") ||
          ("notificationPriceCents" in changes && changes.notificationPriceCents !== null && !targetCents(changes.notificationPriceCents))) {
        throw new Error("Invalid card settings change.");
      }
      // A new SHA and document are read on every attempt, preserving concurrent edits.
      for (let attempt = 0; attempt < 3; attempt += 1) {
        let latest = emptySettings();
        let sha;
        try {
          const metadata = await request(filePath("settings.json"));
          if (typeof metadata.sha !== "string" || typeof metadata.content !== "string" || metadata.encoding !== "base64") {
            throw new Error("Cannot read settings.json metadata for a safe save.");
          }
          latest = validateSettings(decodeContent(metadata.content));
          sha = metadata.sha;
        } catch (error) { if (error.status !== 404) throw error; }
        const next = {
          ...latest,
          cards: { ...latest.cards, [id]: { ...setting(latest, id), ...latest.cards[id], ...changes } }
        };
        const body = { message: "Update CardTrader card settings", content: encodeContent(next), branch: config.branch };
        if (sha) body.sha = sha;
        try {
          await request("/contents/settings.json", { method: "PUT", body });
          return next;
        } catch (error) {
          if (![409, 422].includes(error.status)) throw error;
          if (attempt === 2) throw new Error("Settings changed during saving. Your edit was not saved; try again.");
        }
      }
    }

    return {
      config, canEdit: hasToken, load, patchSettings,
      disconnect() {
        disposed = true;
        token = "";
        controllers.forEach(controller => controller.abort());
        controllers.clear();
      }
    };
  }

  function imageSources(card) {
    const sources = [];
    if (card.imageUrl) {
      try {
        const url = new URL(card.imageUrl);
        if (url.protocol === "https:" && !url.username && !url.password) sources.push(url.href);
      } catch (_) { /* Invalid optional image URLs use the name lookup below. */ }
    }
    sources.push(`https://api.scryfall.com/cards/named?exact=${encodeURIComponent(card.name)}&format=image&version=normal`);
    return [...new Set(sources)];
  }

  const api = { DEFAULT_BRANCH, emptySettings, validateSettings, validatePrices, setting, change24h, filterCards, parseTarget,
    validateConnection, createConnectionStore, encodeContent, decodeContent, createClient, imageSources };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CardTraderData = Object.freeze(api);
})(typeof globalThis !== "undefined" ? globalThis : this);
