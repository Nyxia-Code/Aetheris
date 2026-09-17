# Aetheris (desktop build)

This turns Aetheris from a single HTML file into a small Electron app, so the
YouTube Music Desktop realtime connection is made from a real Node.js
process instead of from code running inside a browser tab.

## Why this fixes the connection

A browser (including Electron's own renderer/webview) automatically attaches
an `Origin` header to every WebSocket handshake, and there's no way for page
JavaScript to remove it. If Companion Server's realtime endpoint is rejecting
based on that header, wrapping the same page in any kind of "HTML to EXE"
shell doesn't change anything, because it's still a browser tab underneath.

What's different here: the actual `socket.io-client` connection now lives in
`main.js`, which runs in Electron's **main process** — a plain Node.js
process, not a rendered page. Node's socket/WebSocket stack doesn't send a
browser `Origin` header at all, which is exactly why YTM Desktop's own
official Node/C#/TypeScript companion libraries connect fine. `main.js` owns
the socket and forwards `state-update` / `connect` / `disconnect` /
`connect_error` events to the existing control panel over Electron's IPC
(`preload.js` is the bridge). Everything else — Twitch chat, Spotify, the
overlay, all your settings and UI — is the exact same `aetheris.html` as
before, untouched.

The app also still works as a REST-polling fallback (same as it always has)
if the realtime channel still can't connect for some other reason — you'll
see that in the in-app log either way.

## What's in this folder

```
app/
  main.js        Electron main process — owns the real Node socket to Companion Server
  preload.js     IPC bridge exposed to the page as window.ytmdRealtime
  aetheris.html  Your app, with startYtmdRealtime()/stopYtmdRealtime() updated
                 to use window.ytmdRealtime when present, otherwise falling
                 back to the old in-browser Socket.IO client
  package.json   Electron + electron-builder config (builds a Windows .exe)
```

## Building it (on your machine — this needs npm/network, which I don't have here)

1. Install [Node.js](https://nodejs.org) if you don't have it (any recent LTS).
2. Open a terminal in the `app/` folder and run:
   ```
   npm install
   ```
3. To just run it and test the fix, without building an installer yet:
   ```
   npm start
   ```
4. Once it works, build the actual `.exe`:
   ```
   npm run dist
   ```
   This uses `electron-builder` (already listed in `devDependencies`) and
   drops an installer in `app/dist/` — something like
   `Aetheris Setup 1.0.0.exe`. Running that installs Aetheris as a normal
   Windows app with a desktop shortcut.

   (`electron-builder` needs an `icon.ico` referenced in `package.json`'s
   `win.icon` — if you don't have one yet, either delete that `"icon"` line
   from `package.json` or drop any `.ico` file into `app/` under that name;
   it'll build fine without a custom icon too.)

## Using it

Everything works exactly like the browser version — same Settings, same
Twitch/Spotify/YTMD setup, same overlay. Just do the YTM Desktop pairing
(Settings → Integrations → Companion Server, then "Connect" in Aetheris)
from inside this app instead of a browser tab, and watch the connection log:
it should now say "Realtime connected" instead of falling back to polling.

The OBS overlay URL still works exactly as before — OBS's own browser source
still loads it as a plain URL with the credentials embedded in it, nothing
about that changed.

## If it still doesn't connect after this

At that point origin rejection isn't the cause, and it's worth going back to
the basics: is Companion Server actually toggled on in YTMD → Settings →
Integrations, is the host/port right (default `127.0.0.1:9863`), and does
"Test connection" in Aetheris's settings reach it at all. The in-app log
under Settings will say specifically what failed.
