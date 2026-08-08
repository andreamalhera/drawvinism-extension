# DrawVinism 🧬

Persistent, per-file version control for [draw.io](https://app.diagrams.net) models. Snapshot ("Evolve") the full multi-tab diagram — plus native draw.io comments, when the file's backend supports them — to a JSON history file in a GitHub repo of your choice, and revert to any prior snapshot later.

Ships as two builds from the same source:

| Build | File | Where it runs |
|---|---|---|
| Chrome / Firefox / Edge extension | `content.js` + `manifest.json` | Loaded as an unpacked extension |
| Safari userscript | `drawvinism.user.js` | Loaded via a userscript manager |

Both are generated from [`src/drawvinism-core.js`](src/drawvinism-core.js) — see [Maintaining the Chrome ↔ Safari sync](#maintaining-the-chrome--safari-sync) before editing either generated file directly.

## Installation — Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select this repo's folder (the one containing `manifest.json`).
4. Open [app.diagrams.net](https://app.diagrams.net), and check the **Extras** menu for a **DrawVinism 🧬** submenu.

This also works unmodified in Firefox (`about:debugging` → *This Firefox* → *Load Temporary Add-on*, pointing at `manifest.json`) and Chromium-based browsers like Edge or Brave via their own `chrome://extensions`-equivalent page.

## Installation — Safari

Safari doesn't support unpacked Manifest V3 extensions the same way, and Tampermonkey no longer supports Safari, so `drawvinism.user.js` is installed via a **userscript manager** extension instead.

1. Install [**Userscripts**](https://apps.apple.com/us/app/userscripts/id1463298887) by quoid (free, open source) from the App Store.
2. Launch **Userscripts.app** once and pick a scripts folder when prompted.
3. Go to **Safari → Settings → Extensions**, enable **Userscripts**, and grant it permission for `app.diagrams.net` (or "All Websites" while testing).
4. Add `drawvinism.user.js` to it — drop the file into the scripts folder you picked, or use Userscripts' own "add script" UI.
5. Open [app.diagrams.net](https://app.diagrams.net) in Safari and check the **Extras** menu for the **DrawVinism 🧬** submenu.

Once a script is added this way, Userscripts checks the script's `@updateURL` and offers/pulls new versions automatically whenever the version published there is higher than what's installed — see below for how that gets kept current.

> Native comment capture/restore (as opposed to tab/history snapshotting, which always works) currently only functions on **Google Drive-backed** diagrams — that's the only storage backend draw.io itself wires up for real comment storage.

## Maintaining the Chrome ↔ Safari sync

`content.js` and `drawvinism.user.js` are **generated files** — don't hand-edit them; edits get overwritten on the next build. The actual plugin logic lives in one place:

```
src/drawvinism-core.js   ← edit this
version.json             ← bump this when you want Safari users to see an update
        │
        ▼  scripts/build.js
        │
        ├── content.js            (core + extension banner comment)
        └── drawvinism.user.js    (core + userscript metadata header,
                                    including @updateURL/@downloadURL)
```

**Local workflow:**

```sh
node scripts/build.js   # or: npm run build
```

regenerates both files from `src/drawvinism-core.js` + `version.json`.

**Automatic on commit:** a pre-commit git hook runs the build and re-stages `content.js`/`drawvinism.user.js` before every commit, so they can't drift out of sync with the source or with each other. It's already installed in this checkout; on a fresh clone, install it once with:

```sh
sh scripts/install-hooks.sh   # or: npm install (runs it via postinstall)
```

**Shipping an update to Safari users:** bump `"version"` in `version.json`, edit `src/drawvinism-core.js` as needed, commit (the hook rebuilds both files), and push to `main`. Userscripts' auto-update check re-fetches:

```
https://raw.githubusercontent.com/andreamalhera/drawvinism-extension/main/drawvinism.user.js
```

compares the `@version` in the header against what's installed, and pulls the new copy automatically once it's higher. Chrome users just need to reload the unpacked extension (`chrome://extensions` → refresh icon) to pick up the new `content.js`.
