# Cadence — Feature Checklist

Status legend:

- ✅ **Verified**: implemented and verified by automated tests against real media (`npm test`, `npm run e2e`, `node scripts/e2e-ui.mjs`).
- 🟡 **Limited**: implemented, with the limitation noted.
- 📋 **Planned**: on the roadmap; not in the interface, or listed as unavailable.
- ⛔ **Blocked**: needs a specific dependency or decision.

Last verified: 2026-10-10 on Windows 11, RTX 5070 Ti, Electron 44.7, FFmpeg 9.0.
Suites: 48 unit · 30 workflow (`npm run e2e`) · 11 UI (`scripts/e2e-ui.mjs`) · 14 Phase 2 export (`scripts/e2e-phase2.mjs`) · 9 Phase 2 UI (`scripts/e2e-ui-phase2.mjs`) — all passing.

## Phase 1: core workflow

### Workspace and UI
| Feature | Status | Notes |
|---|---|---|
| Dockable, resizable, tabbed panels | ✅ | dockview. Layout persists across sessions. |
| Saved workspace layouts | 🟡 | Save as New Workspace, Reset, and switching all work. Only the Editing workspace ships built in. |
| Graphite & ice-blue theme from design tokens | ✅ | All colours come from tokens in `theme.css` (canvases read them via `ui/tokens.ts`). Neutral grey monitor surround. Styled tooltips, scrollbars, and focus/hover/pressed/selected/disabled states. |
| Custom title bar and menus | ✅ | Dropdowns excluded from the window drag region (hover/click fix). |
| Configurable keyboard shortcuts | ✅ | Edit → Keyboard Shortcuts: rebind any command, flags conflicts, reset to defaults. |
| Drag and drop | ✅ | Explorer → Project/Timeline, Project → Timeline/Source/Program/bins, Source → Timeline, Effects/Titles → Timeline. UI-tested. |
| Welcome screen and recent projects | ✅ | |

### Project and media
| Feature | Status | Notes |
|---|---|---|
| Import video, audio and stills | ✅ | Dialog, drag-and-drop. Tested: H.264, HEVC 8/10-bit, ProRes, MKV, 10-bit H.264, WAV, MP3, JPG, PNG. |
| Bins, search, list/thumbnail views, metadata columns | ✅ | |
| Background analysis (posters, PCM audio, waveform peaks) | ✅ | Cancellable job queue. Results are cached by content fingerprint. |
| Automatic playable copies (rewrap/transcode) | ✅ | MKV/WebM/TS get rewrapped. ProRes, DNx, 10-bit H.264 and alpha formats get an NVENC transcode. Originals are never modified. |
| Variable frame rate | ✅ | Frames are placed by their real timestamps. Tested with jittered HEVC. |
| Rotation metadata | ✅ | Displayed upright, with correct pillarboxing. |
| HDR / log footage | 🟡 | Plays and exports, but as SDR without tone-mapping. Flagged on import. |
| Alpha channel in video | 🟡 | Alpha is dropped by the playable copy. Stills with alpha (PNG) work. |
| Multi-channel audio | 🟡 | First audio stream only, downmixed to stereo. Flagged on import. |
| Non-square pixels | 🟡 | Shown with square pixels. Flagged on import. |
| Missing media detection and relink | ✅ | Checks the absolute path, then the project-relative path. Relink verifies the fingerprint and auto-relinks other files found in the same folder. |
| Multiple sequences per project | ✅ | Tabs in the Timeline. |
| Multiple projects | 🟡 | One project per window. File → New Window opens another. |

### Timeline editing
| Feature | Status | Notes |
|---|---|---|
| Video/audio tracks: add, delete, rename | ✅ | |
| Split clip at a point (right-click "Split Clip Here", Razor C, Ctrl+K) | ✅ | "Cut" is renamed "Cut to Clipboard" to avoid confusion with splitting. |
| Lock, sync lock, output toggle, mute, solo, track volume, targeting | ✅ | |
| Zoom, scroll, snapping, timecode (incl. drop-frame) | ✅ | Drop-frame round-trip unit-tested. |
| Select, marquee, move (overwrite / Ctrl = insert) | ✅ | UI-tested. |
| Split: Add Edit, razor tool, all tracks | ✅ | UI-tested. |
| Trim; ripple, roll, slip and slide tools | ✅ | Unit-tested. Trim is UI-tested. |
| Delete, ripple delete, ripple delete gap | ✅ | Refuses with a clear message if another sync-locked track would drift. |
| Copy / cut / paste / paste insert | ✅ | |
| Linked A/V, link/unlink, group/ungroup, linked selection | ✅ | |
| Markers, in/out, lift/extract, Mark Clip, Q/W trims | ✅ | |
| Insert/overwrite from Source (three-point editing) | ✅ | |
| Undo/redo (unlimited to 300 steps, History panel) | ✅ | Immutable snapshots. Failed edits never enter history. |

### Playback
| Feature | Status | Notes |
|---|---|---|
| Source and Program monitors | ✅ | |
| Frame-accurate seeking and stepping | ✅ | Barcode-verified, including random backward seeks across GOPs. |
| Real-time playback locked to the audio clock | ✅ | 89 frames in 3.0 s at 30 fps, 0 dropped, on test footage. |
| GPU decode (WebCodecs) and GPU compositing (WebGL2) | ✅ | |
| JKL shuttle | 🟡 | Forward 2×/4×/8× mutes audio. Reverse renders exact frames as fast as it can, which is slow on long-GOP media. |
| Preview resolution Full / ½ / ¼ | ✅ | |
| Audio meters with peak hold and clip indicators | ✅ | |
| Waveforms | ✅ | Logarithmic display. |
| Video thumbnails on clips | ✅ | Filmstrip of up to 120 frames per clip, mapped through speed/reverse. Files over 10 min sample keyframes only. |

### Effects, text, audio
| Feature | Status | Notes |
|---|---|---|
| Motion (position, scale, rotation, anchor), Opacity, Crop | ✅ | Shared by preview and export. |
| Keyframes: stopwatch, add/remove, navigate, drag to retime | ✅ | Effect Controls keyframe lanes. UI-tested. Keyframed opacity export measured at 49.4% at midpoint (expected 50%). |
| Easing: linear, hold, ease in/out, accelerate, decelerate | ✅ | Right-click a keyframe. Unit-tested curves. |
| Clip volume keyframes | 🟡 | Supported by the mixer; edited in Effect Controls (no timeline rubber band yet: Phase 4). |
| Transitions: cross dissolve, dip to black/white, wipe (4 directions) | ✅ | Center/start/end alignment, edge-drag duration, Ctrl+D. Dissolve export matches the mathematical A/B mix (mean error 1.06/255). |
| Audio transitions: constant power, constant gain | ✅ | Ctrl+Shift+D. Constant gain sums to unity (unit-tested). |
| Transitions without enough media handles | 🟡 | The nearest available frame is held; the UI warns. |
| Speed / duration, reverse, ripple option | ✅ | Ctrl+R. Export frames exact at 200% and reversed; A/V sync 0 ms through both. |
| Speed audio | 🟡 | Pitch changes with speed (no pitch preservation yet). |
| Speed ramping (time remapping) | 📋 | Planned. |
| Reverse playback of long-GOP footage | 🟡 | Frame cache makes it real-time on test media (26 frames in 0.9 s, 0 dropped); very long GOPs may drop frames. |
| Nested sequences | ✅ | Nest selection, drag a sequence into the timeline, double-click to open, cycle protection. Video and audio are bit-identical to the un-nested edit (unit-tested), frame-exact on export. Nests play at 100% only. |
| Adjustment layers | ✅ | Effects apply to everything below (crop verified on export). Color effects arrive in Phase 3. |
| Effect bypass / reset / remove | ✅ | |
| Clip gain, track volume, mute/solo mixing | ✅ | Sample-accurate mixer, unit-tested. |
| Text: font, size, weight, italic, color, align, tracking, stroke, shadow, background | ✅ | |
| Title presets (built-in and user-saved) | ✅ | |

### Save and export
| Feature | Status | Notes |
|---|---|---|
| Versioned JSON project format with migration hook | ✅ | `.cadence`, format v1. Newer versions are refused with a clear message. |
| Save, Save As, atomic writes with a `.bak` | ✅ | Save, reopen and exact match verified. |
| Autosave (60 s and on blur) and crash recovery | 🟡 | Implemented. Recovery listing is not yet covered by an automated test. |
| Unsaved-changes prompt on close/open/new | ✅ | |
| Export: H.264, HEVC, AV1 (NVENC or software), ProRes, DNxHR | ✅ | H.264 NVENC and ProRes HQ verified with ffprobe. |
| Export controls: resolution, frame rate, quality/bitrate, speed, audio codec/bitrate/rate | ✅ | |
| Export frame accuracy | ✅ | All 105 frames across cuts barcode-verified. |
| Export A/V sync | ✅ | 0 ms offset measured (flash frames vs. beep onsets). |
| Real progress, ETA, cancel (partial file removed), verified result | ✅ | |
| Color fidelity source → export | 🟡 | No level or gamma shift. Mean error is 0.5/255 in flat areas, higher on sharp saturated edges from the double 4:2:0 ⇄ RGB chroma conversion. Plan: composite in YUV. |
| Export queue | 📋 | Phase 6 |

## Planned phases

| Phase | Scope | Status |
|---|---|---|
| 2 | Keyframes and easing, transitions, speed/reverse, nested sequences, adjustment layers, filmstrips | ✅ (speed ramping remains planned) |
| 3 | Color: exposure/contrast/HSL/temperature, wheels, curves, `.cube` LUT import, waveform/vectorscope/histogram, YUV compositing pipeline | 📋 |
| 4 | Audio mixer panel, pan, audio keyframes/fades, EQ, compressor, limiter, noise reduction, voice-over recording | 📋 |
| 5 | Caption tracks, SRT import/export, text animation. Transcription is optional and will be disclosed (local model download vs. cloud upload) | 📋 |
| 6 | Proxy workflow and cache manager UI, export queue, multicam, masks, blend modes, chroma key, blur/sharpen, HDR tone-mapping | 📋 |

## Known blocked items
| Item | Blocker |
|---|---|
| Distributing builds with x264/x265 | GPL licensing. Fine for personal use; revisit before any distribution. |
| HEVC decode on machines without hardware support | The WebCodecs HEVC path needs a GPU decoder. Falls back to a transcode to H.264. |
