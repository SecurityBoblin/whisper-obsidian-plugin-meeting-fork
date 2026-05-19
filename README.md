# Whisper + System Audio — Speech-to-text for Obsidian

> **Fork of [nikdanilov/whisper-obsidian-plugin](https://github.com/nikdanilov/whisper-obsidian-plugin)**

Record or upload audio, transcribe with [Whisper](https://openai.com/research/whisper), and optionally post-process the result with an LLM.

**This fork adds system audio capture** — transcribe online meetings, videos, music, and any app audio playing on your computer.

## Why This Fork?

The original plugin only supports microphone input. This fork adds native system audio capture using Electron's `desktopCapturer` API, enabling transcription of:

- Online meetings (Zoom, Teams, Meet, etc.)
- Videos and presentations
- Music and podcasts
- Any app audio

Since this feature requires Electron APIs and changes the core recording flow, I created a fork rather than submitting a PR that would significantly alter the original plugin's scope.

**Changes from upstream:**
- Added system audio capture via `@electron/remote.desktopCapturer`
- Three recording modes via separate hotkeys (no settings toggle needed)
- Desktop-only (mobile not supported)
- Added "Paste at cursor" toggle setting
- Source selector modal with window/screen thumbnails

## Quick Start

1. Install from **Settings → Community Plugins** → search "Whisper + System Audio" (or install manually)
2. Add your API key in the plugin settings
3. Choose your recording mode:
   - **Alt+Q** — Record Microphone + System Audio (for meetings)
   - **Alt+Shift+Q** — Record Microphone only
   - **Alt+Ctrl+Q** — Record System Audio only (for videos/music)
4. Press the hotkey again to stop and transcribe

The transcription appears in a new note file.

## Recording Modes

| Hotkey | Mode | Use Case |
|--------|------|----------|
| `Alt+Q` | Microphone + System Audio | Online meetings where you speak and want to capture others |
| `Alt+Shift+Q` | Microphone only | Voice notes, dictation |
| `Alt+Ctrl+Q` | System Audio only | Transcribing videos, music, or meetings where you don't speak |

Customize these in **Settings → Hotkeys**.

## System Audio Capture

When using system audio modes, you'll see a window picker showing all available windows and screens. Select the one playing audio you want to capture.

**Tips:**
- Select a specific window (browser tab, media player) rather than "Entire Screen" for best results
- Make sure audio is playing when you start recording
- On macOS, you may need to grant screen recording permissions

**Platform Support:**
| Platform | Support |
|----------|---------|
| Windows | Full support |
| macOS 13+ | Supported |
| macOS < 13 | Requires virtual audio device (BlackHole) |
| Linux | Supported via PipeWire |
| Mobile | Not supported (desktop-only plugin) |

## All Features

### Recording
- Three recording modes with dedicated hotkeys
- Pause/resume recordings
- Cancel and discard
- Microphone device selection
- System audio source picker with thumbnails

### Transcription
- Works with OpenAI, Groq, Azure, or any Whisper-compatible API
- Language auto-detection or manual selection
- Custom prompts for better accuracy with specific terms
- Temperature and response format settings

### Post-Processing
- Clean up transcriptions with Claude, GPT, or custom endpoints
- Auto-generate descriptive filenames
- Keep original transcription alongside processed version

### Output
- Save audio files to vault
- Create note files with templates
- Optional paste at cursor position
- Template variables: `{{date}}`, `{{time}}`, `{{datetime}}`, `{{title}}`, `{{transcription}}`, `{{audioFile}}`

## Usage

**Record** — Use hotkeys or command palette.

**Upload** — Command palette → *Upload audio file* (mp3, mp4, m4a, wav, webm, ogg).

**Right-click** — Right-click any audio file → *Transcribe audio file*.

### Automation

Trigger from iOS Shortcuts, Alfred, or any tool that can open URLs:

```
obsidian://whisper                          open controls
obsidian://whisper?command=start            start recording (both)
obsidian://whisper?command=start&mode=mic   start microphone only
obsidian://whisper?command=start&mode=system start system audio only
obsidian://whisper?command=stop             stop and transcribe
obsidian://whisper?command=pause            pause/resume
obsidian://whisper?command=cancel           discard recording
```

## Manual Installation

Download `manifest.json`, `main.js`, `styles.css` from [releases](https://github.com/SecurityBoblin/whisper-obsidian-plugin-meeting-fork/releases) into `.obsidian/plugins/whisper-system-audio/` in your vault.

## Note Templates

When **Create note file** is enabled:

| Variable | Example |
|---|---|
| `{{title}}` | `Meeting Notes` |
| `{{audioFile}}` | `recordings/2026-04-05.webm` |
| `{{transcription}}` | *the transcribed text* |
| `{{date}}` | `2026-04-05` |
| `{{time}}` | `14-30-00` |
| `{{datetime}}` | `2026-04-05 14:30:00` |

Example template:
```
# {{title}}
![[{{audioFile}}]]

{{transcription}}
```

## Credits

This is a fork of [nikdanilov/whisper-obsidian-plugin](https://github.com/nikdanilov/whisper-obsidian-plugin) by [Nik Danilov](https://nikdanilov.com).

The original plugin is excellent for voice transcription. This fork adds system audio capture for a specific use case (transcribing meetings).

---

[Support the original author](https://ko-fi.com/nikdanilov) · [Original repo](https://github.com/nikdanilov/whisper-obsidian-plugin)
