# CardTrader dashboard

Public browser UI for a private CardTraderActions repository. This repository contains only static UI assets and a GitHub Pages workflow. Price history, acquired status, watches, and API secrets belong in the separate private checker repository.

The Collection view includes search, acquired flags, price watches, exact-printing artwork, and 24-hour euro/percentage changes. The Price changes view shows retained changes newest first, 100 per page, with search, expansion, and direction filters. Both views share the same connection.

1. Push this folder to a new public GitHub repository with `main` as the default branch.
2. Under **Settings > Pages > Build and deployment**, choose **GitHub Actions**.
3. Run **Publish dashboard** under Actions, or push a change to `main`.
4. Open the deployed URL and connect to the **private checker repository**, not this public UI repository.
5. Supply a fine-grained personal access token restricted to that private repository, with **Contents: read and write**. Read-only Contents access permits viewing only.

The token stays in browser memory by default. Select **Remember on this device** to save it in that browser's localStorage and reconnect automatically after reloading. Use this only on a trusted browser profile: scripts on the same website origin can access localStorage. **Disconnect** removes a remembered connection. The token is sent only to `api.github.com`; it is never committed or embedded into the site. The public website alone grants no access to your private repository. Only accounts/tokens with repository access can read it, and only those with write access can edit settings.

Treat write access to this public website repository as trusted: its maintainers control the JavaScript served to your browser. Do not give other people write access. You may also open `site/index.html` locally.
