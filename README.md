# Aetheris

**Aetheris is an all-in-one Twitch song request manager built to make handling music requests simple, automatic, and customizable.** It connects directly with Twitch, Spotify, and YouTube Music Desktop, letting viewers request songs through chat while Aetheris handles searching, queueing, playback, and transitions behind the scenes.

With Aetheris, you can manage your request queue from a clean desktop dashboard, add songs manually, view what's currently playing and recently played, configure custom Twitch commands and cooldowns, and control how requests behave.

YouTube Music Desktop integration provides realtime playback tracking, automatic request transitions, playlist rejoining, and shuffle support, while Spotify integration allows requests to be sent directly to your active Spotify player.

**Set it up once, start your music, and let Aetheris handle the requests.**

---

## Features

- Twitch chat song requests
- Spotify integration
- YouTube Music Desktop integration
- Realtime playback tracking
- Automatic song request queue
- Automatic playlist rejoining
- Shuffle support
- Manual song requests from the dashboard
- Custom Twitch commands and cooldowns
- Recently played history
- Custom themes and appearance settings
- Customizable OBS overlay
- Full setup export/import
- Customization-only export/import
- Built-in YouTube API setup tutorial
- Automatic update checking

---

## Installation

1. Go to the **Releases** section of the Aetheris GitHub repository.
2. Download the latest Aetheris installer.
3. Run the installer.
4. Open Aetheris and complete the setup for the services you want to use.

> Aetheris requires your own API credentials for certain integrations.

---

## Setup

### Twitch

Connect Aetheris to your Twitch account and configure your song request commands from the app.

You can customize commands, cooldowns, request behavior, and other Twitch settings directly inside Aetheris.

### YouTube Music Desktop

Aetheris uses two components for YouTube Music requests:

**YouTube Data API v3** searches for requested songs.

**YouTube Music Desktop Companion Server** handles playback, realtime tracking, song transitions, playlist rejoining, and shuffle.

Aetheris includes a built-in tutorial showing you how to create your own YouTube API key.

### Spotify

Enter your Spotify Client ID and complete the authorization process from inside Aetheris.

Aetheris uses Spotify's PKCE authentication flow, so a Client Secret is not required.

---

## Usage

Once everything is connected, start playing music and leave Aetheris running.

Your viewers can submit song requests through Twitch chat using your configured request command.

Aetheris will:

1. Find the requested song.
2. Add it to the request queue.
3. Monitor the currently playing song.
4. Automatically transition to the requested song.
5. Continue through additional requests.
6. Return to your playlist when the request queue is finished.

You can also add songs manually from the Aetheris Dashboard.

---

## OBS Overlay

Aetheris includes an OBS-friendly overlay for displaying music information on your stream.

The overlay can be customized separately from the main application, allowing you to adjust its appearance to match your stream.

---

## Backup & Restore

Moving Aetheris to another PC or reinstalling Windows?

Use **Settings → Export All** to create a backup of the information needed to set Aetheris back up.

You can restore it using **Import All** on the new installation.

> Full setup backups can contain API keys and authorization tokens. Keep these files private and never upload them publicly.

A separate customization export/import option is also available if you only want to transfer your appearance and overlay settings.

---

## Updating

Aetheris can automatically check GitHub for new releases.

When an update is available, you can choose whether to install it immediately or wait until later.

You can also manually check for updates from the **About** page.

---

## Support & Feedback

Found a bug, have a suggestion, or need help setting up Aetheris?

**Email:** nyxia.codeservice@gmail.com

You can also use the GitHub repository to report issues and follow new Aetheris releases.

---

## Developer

**CodedByNyxia**

Aetheris is actively developed and improved with a focus on making Twitch song requests easier to manage for both streamers and viewers.
