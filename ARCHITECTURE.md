# Cadence Architecture

Cadence is an Electron desktop app for Windows. It has three processes:

- The **main process** (Node.js) handles files, FFmpeg jobs, project I/O, and export orchestration.
- The **editor renderer** (Chromium) runs the UI, playback and compositing.
- A **hidden export renderer** renders frames for export.

## Layers

```
src/core/       Pure TypeScript. No DOM, no Node. Unit-tested.
  model.ts        The authoritative project model (plain data)
  time.ts         Rational frame rates, frame↔seconds↔samples, SMPTE timecode
  edit.ts         All timeline edit operations (overwrite, insert, move, trim,
                  ripple, roll, slip, slide, split, ripple delete, paste, …)
  history.ts      Undo/redo over immutable Immer snapshots
  evaluate.ts     "What is visible at frame N": layers, source times, transforms
  mix.ts          Deterministic audio mixer (used by preview AND export)
  effects.ts      Effect/parameter definitions + keyframe evaluation
  serialize.ts    Versioned .cadence format + migrations
src/main/       Electron main: ffmpeg wrapper, job queue, media cache,
                cmedia:// range-request protocol, project I/O, export
src/preload/    The window.cadence API (contract in src/shared/ipc.ts)
src/renderer/src/engine/
  mp4.ts          Own MP4/MOV sample-table demuxer (exact timestamps, edit lists)
  video-reader.ts WebCodecs decoder: frame-exact seeks, decode-ahead playback
  compositor.ts   WebGL2 compositor (motion, opacity, crop, rotation)
  resolve.ts      Layer → pixels (shared by monitors and export)
  playback.ts     Monitor controller following the audio clock
  audio/          Mixer worker → AudioWorklet output (hardware clock)
src/renderer/src/state/   Zustand store, commands/keymap, actions
src/renderer/src/ui/      Panels, timeline, dialogs
```

## Key design decisions

- **One timeline model.** Preview, export and save all read the same `Project` object. The evaluator and mixer are pure functions of it.
- **Integer frame positions.** Timeline positions are integer sequence frames. Source positions are media-time seconds, mapped onto source frames by real timestamps with a 0.1 ms tolerance. This makes VFR footage correct.
- **Media time zero.** Zero is the container start. Audio PCM is padded (`aresample first_pts=0`), and video uses `stream start_time`, so A/V offsets inside files are preserved. Export sync was measured at 0 ms.
- **Playback.** The AudioWorklet plays the exact timeline samples that are due at each render quantum, so late audio is skipped instead of drifting. Video frames are chosen from the audio output timestamp.
- **Export.** The hidden renderer runs the same resolver and compositor as the Program monitor and streams RGBA to FFmpeg over stdin. Audio comes from the same core mixer running in the main process. Progress is the real count of frames written. Output is verified with ffprobe.
- **Unsupported codecs and containers.** These get a background playable copy in the media cache (rewrap, or an NVENC transcode with a short GOP). Originals are never touched.

## Testing

- `npm test`: core unit tests (timecode, every edit operation, history, serialization, mixer sample alignment).
- `npm run gen-media`: generates test clips with a frame-number barcode and flash/beep sync markers.
- `npm run build && npm run e2e`: full workflow against real media. Covers import, analysis, frame-exact seeks, editing, undo/redo, playback rate, save/reopen, export (barcode-verified frames, A/V sync), ProRes export, cancel, and real game-capture footage.
- `node scripts/e2e-ui.mjs`: mouse/keyboard UI test. Covers drag from Project, ruler scrub, Ctrl+K, undo, edge trim, clip move, razor, ripple delete, Space playback, text editing, and the export dialog.
- `node scripts/color-check.mjs`: source vs. export pixel comparison.

## Dependencies and licensing

Electron (MIT), React (MIT), dockview (MIT), Zustand (MIT), Immer (MIT). FFmpeg 9.0 is a GPL build from BtbN's GitHub releases, stored in `vendor/ffmpeg` (not committed). It is used as an external process, and the GPL build is acceptable for personal use. An LGPL build plus hardware encoders would be needed before distributing.
