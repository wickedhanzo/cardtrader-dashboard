# CardTrader dashboard

Public browser UI for a private CardTraderActions repository. This repository contains only static UI assets and a GitHub Pages workflow. Price history, acquired status, watches, and API secrets belong in the separate private checker repository.

1. Push this folder to a new public GitHub repository with `main` as the default branch.
2. Under **Settings > Pages > Build and deployment**, choose **GitHub Actions**.
3. Run **Publish dashboard** under Actions, or push a change to `main`.
4. Open the deployed URL and connect to the **private checker repository**, not this public UI repository.
5. Supply a fine-grained personal access token restricted to that private repository, with **Contents: read and write**. Read-only Contents access permits viewing only.

The token stays in browser memory and must be entered again after reloading. It is sent only to `api.github.com`; it is never committed, embedded into the site, or saved in local storage. The public website alone grants no access to your private repository. Only accounts/tokens with repository access can read it, and only those with write access can edit settings.

Treat write access to this public website repository as trusted: its maintainers control the JavaScript served to your browser. Do not give other people write access. You may also open `site/index.html` locally.
