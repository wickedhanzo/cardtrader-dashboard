# CardTrader dashboard

Public browser UI for a private CardTraderActions repository. This repository contains only static UI assets, a GitHub Pages workflow, and an asset-versioning helper. Price history, acquired status, watches, and API secrets belong in the separate private checker repository.

The Collection view includes search, acquired flags, independent condition price watches, exact-printing artwork/links, and adjacent NM/SP/MP/PL/HP/PO/M price columns. Detail checkboxes compare condition histories with colored chart observations and hover prices; the bell beside a grade opens its watch editor. CardTrader uses SP, not a separate LP condition. Existing NM history and watches are preserved; other histories begin with their first actual observation. No eligible returned listing displays as a dash, not zero. Marketplace results are capped, so prices describe eligible returned offers rather than all sellers.

The 24-hour euro/percentage changes, Price changes feed and run update totals remain **NM-only**. Checks are grouped newest first, including zero-update runs, with checked/new/update totals and expandable change lists. Runs and their changes use 100-entry pages with search, expansion, and direction filters. Older records stay under Earlier history. All views share the same connection. Deployments give JavaScript/CSS content-versioned URLs so cached assets cannot leave new controls inert.

1. Push this folder to a new public GitHub repository with `main` as the default branch.
2. Under **Settings > Pages > Build and deployment**, choose **GitHub Actions**.
3. Run **Publish dashboard** under Actions, or push a change to `main`.
4. Open the deployed URL and connect to the **private checker repository**, not this public UI repository.
5. Supply a fine-grained personal access token restricted to that private repository, with **Contents: read and write**. Read-only Contents access permits viewing only.

The token stays in browser memory by default. Select **Remember on this device** to save it in that browser's localStorage and reconnect automatically after reloading. Use this only on a trusted browser profile: scripts on the same website origin can access localStorage. **Disconnect** removes a remembered connection. The token is sent only to `api.github.com`; it is never committed or embedded into the site. The public website alone grants no access to your private repository. Only accounts/tokens with repository access can read it, and only those with write access can edit settings.

Treat write access to this public website repository as trusted: its maintainers control the JavaScript served to your browser. Do not give other people write access. You may also open `site/index.html` locally.

The Binder view shows expansions in collector-number order across nine-pocket sheets. Acquired cards use full-color exact artwork; missing cards are grayscale. Search, finish and ownership filters, completion counts, paging and acquired checkboxes share the existing connection. Card images open the collection detail view.

US flags mark the collection's English targets; Japanese flags mark verified Japanese-only printings, including Black Chocobo and the FamilyMart promo tokens. Multilingual promos such as Swords to Plowshares still target English. These flags describe the selected language, not the seller's country.

Overview and detail also show the free daily **Cardmarket general guide**, covering all languages and conditions, with the guide date and separate normal/foil figures. These are not English-specific quotes and never drive CardTrader watches or NM changes. Product links use exact provider IDs and apply the card's English/Japanese and foil filters. Multiple mapped product IDs remain separate references rather than being guessed or averaged. A dash means no quote. Language flag SVGs are from [flag-icons](https://github.com/lipis/flag-icons), with their MIT license in `site/flags/LICENSE.txt`.

The overview shows trend and low per product reference, with ascending/descending sorting by either. Cardmarket sorting uses each card's lowest positive matching reference and keeps unquoted values last. The grade-column picker offers individual price-column checkboxes and a show-all reset; choices are remembered only in this browser and do not change watches, chart selections or repository settings.

**CM Low > CT NM** selects cards whose available, positive CardTrader NM price is strictly below the lowest positive matching Cardmarket Low reference. Equal prices and missing/zero quotes do not match. It works with the other overview filters and sorting, including when grade columns are hidden. Cardmarket values remain a general all-language/all-condition guide, not English NM offers.
