# Bundled Web App Files

This folder should contain copies of the web app files from the root project:

- `index.html` — from `../../../index.html`
- `app.js` — from `../../../app.js`
- `style.css` — from `../../../style.css`
- `base.css` — from `../../../base.css`

## How to update

Copy the latest web app files from the root of the repository:

```bash
cp ../../index.html ../../app.js ../../style.css ../../base.css ios/Folio/WebApp/
```

These files are used when `AppConfig.serverURL` is set to `nil` (bundled/offline mode).
For production use, set `AppConfig.serverURL` to your deployed backend URL and these files are not used.
