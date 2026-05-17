# qBittorrent Local Bridge

This is a local-only helper for adding legal torrents to qBittorrent from a browser page or small HTTP endpoint. It accepts:

- `magnet:?xt=...` links
- Direct `https://.../*.torrent` URLs

It does not scrape ordinary torrent index pages. If you paste a normal website link, including a torrent detail page, it will reject it and ask for a magnet link or direct `.torrent` file instead.

## Internet mode

Do not expose qBittorrent Web UI directly to the internet. Use relay mode instead:

1. Deploy this app publicly with `MODE=relay`, `HOST=0.0.0.0`, and a long random `RELAY_TOKEN`.
2. Keep qBittorrent private on your PC.
3. Run `poll.cmd` on your PC. It polls the public relay and adds queued items to local qBittorrent.

The public site only queues links. Your PC is the only machine that can talk to qBittorrent.

## 1. Enable qBittorrent Web UI

In qBittorrent:

1. Open `Tools -> Options -> Web UI`.
2. Enable `Web User Interface`.
3. Keep the address as `127.0.0.1` or `localhost`.
4. Set a username and password.
5. Apply the settings.

The default Web UI URL is usually `http://127.0.0.1:8080`.

## 2. Configure this bridge

Copy `config.example.json` to `config.json`, then update the qBittorrent username, password, and token.

The token can be any long random string. It prevents random local web pages from adding torrents through your bridge.

```json
{
  "port": 7331,
  "host": "127.0.0.1",
  "qbittorrentUrl": "http://127.0.0.1:8080",
  "username": "admin",
  "password": "your-qbittorrent-password",
  "token": "make-this-long-and-random",
  "relayUrl": "https://your-public-relay.example",
  "relayToken": "same-token-used-by-the-public-relay",
  "pollIntervalSeconds": 20,
  "defaultCategory": "",
  "startPaused": false
}
```

## 3. Run it

From this folder:

```powershell
.\start.ps1
```

Then open:

```text
http://127.0.0.1:7331
```

Keep that PowerShell window open while you use the page. If you close it, the page can remain visible in your browser, but pressing the button will fail because the local bridge is gone.

To run it in the background instead:

```powershell
.\launch.ps1
```

If Windows blocks `.ps1` files on your machine, use:

```powershell
.\launch.cmd
```

Check whether it is running:

```powershell
.\status.ps1
```

Stop it:

```powershell
.\stop.ps1
```

The `.cmd` versions work the same way: `launch.cmd`, `status.cmd`, and `stop.cmd`.

## Deploy the public relay

This repo includes `render.yaml` for Render. Create a new Render Blueprint from this repository and set:

```text
MODE=relay
HOST=0.0.0.0
RELAY_TOKEN=your-long-random-secret
```

After deployment, update local `config.json`:

```json
{
  "relayUrl": "https://your-render-app.onrender.com",
  "relayToken": "your-long-random-secret"
}
```

Then run the local poller:

```powershell
.\poll.cmd
```

Open the public URL in your phone or another PC, paste a magnet/direct `.torrent` URL, enter the relay token, and submit. The local poller will pick it up and send it to qBittorrent.

## WhatsApp workflow

Personal WhatsApp does not provide a local webhook for automatically reading your messages on your PC. The reliable workflow is:

1. Open WhatsApp Desktop or WhatsApp Web.
2. Copy a magnet link or direct `.torrent` URL.
3. Paste it into `http://127.0.0.1:7331`.

If someone sends you a magnet link directly, qBittorrent can usually open it without this bridge if qBittorrent is registered as your default magnet handler.

## HTTP endpoint

You can add one item with:

```text
http://127.0.0.1:7331/add?token=YOUR_TOKEN&url=ENCODED_MAGNET_OR_TORRENT_URL
```

Or POST JSON:

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:7331/api/add `
  -Headers @{ "x-bridge-token" = "YOUR_TOKEN" } `
  -ContentType "application/json" `
  -Body '{ "text": "magnet:?xt=urn:btih:..." }'
```
