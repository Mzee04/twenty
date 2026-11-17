---
title: Twenty — a shared pause when a conversation runs hot
published: false
tags: presagechallenge
---

*This is a submission for the [Presage SmartSpectra SDK Challenge](https://dev.to/challenges/presage-2026-11-04)*

#presagechallenge

## What I Built

Twenty is a timeout for a conversation that is getting away from the people in it.

John Gottman’s work on couples describes “flooding”: past a point, often talked about as a heart rate near 100 beats per minute, people stop being able to listen, and they need about twenty minutes away before they can come back. Twenty borrows that pause. It does not decide that anyone is flooded, and it does not give health advice.

Each person runs Twenty on their own laptop, in the same room or on a video call, and joins a four-character room code. The camera stays off until a plain-language consent screen. After about a minute of confident pulse readings, each app watches only its own person. If a pulse stays well above that person’s calm minute, or near 100, for about twenty seconds — and only while the SDK is confident and the face is usable — both screens switch to the same soft color and say **Someone needs a break**. They do not say who. A breathing guide runs for twenty minutes, using the SDK’s breathing rate when that reading is confident and the person is quiet. Each person taps **I’m ready**. The room opens again when the time is up and both have tapped. A **Timeout** button works even if the camera is off.

There is a **Solo demo**. The other person is a simulated recording, labeled the whole time. With an API key, the local camera stays live.

It is a wellness cue. It is not a medical device.

## Demo

Record from `DEMO-SCRIPT.md` (about two and a half minutes) and paste the link here before publishing.

Demo video: TODO

The video should show the consent screen, a live pulse number from the SDK, the camera-on indicator, and both screens (or the solo demo, clearly labeled) on the break color. Do not show an API key.

## Code

Repository: TODO (this project was built in private; publish the repo before submitting)

Setup, from a fresh clone, with Node 20 or newer:

```bash
npm install && npm start
```

Copy `.env.example` to `.env` and set `SMARTSPECTRA_API_KEY`. For two laptops, run `npm run relay` on one machine and set `TWENTY_RELAY_URL` on both. Without a key, Solo demo still walks the screens on practice signals, and it says so.

## How I Used the SmartSpectra SDK

SmartSpectra has no browser SDK, so Twenty is Electron plus `@smartspectra/node-sdk` 3.5.0, starting from Presage’s electron-quickstart: `bindSmartSpectraIpc` in the main process, the package preload, and `SmartSpectraSDK` from `@smartspectra/node-sdk/renderer`.

- Requested metrics are the breathing bundle and the cardio bundle. Pulse is the signal for the pause cue: a 12-second average, valid from 40 to 110 BPM, and still meaningful while people talk. Breathing is a 30-second average and is not used to judge the conversation, because talking throws it off. During the quiet pause it can time the guide.
- `validationStatus` pauses the calm minute and the 20-second clock when framing or light is off. Chest-not-visible does not pause pulse.
- Samples count only at confidence 60 or higher on the SDK’s 0–100 scale, with `stable: true`. The first seconds are often confidence 0 while the 12-second window fills. Those seconds wait.
- `enableTelemetry` is false. The app never calls `requestInsight` or `checkDeviceReadiness`.
- The app owns the camera stream and restores continuous exposure, white balance, and focus around the session, because the renderer SDK locks those controls to manual and does not put them back (Presage issue 19).
- A failed key check that surfaces as `kNetworkError` / “Usage verification failed. Status code: 0” (Presage issue 18) is shown as a retry, not a silent loop. If the key cannot read cardio, Twenty says so and still offers Timeout.

A mock adapter runs the same screens and the same cue code without a key, so the tests and the practice UI do not pretend to be a measurement.

## Consent and Data Handling

Twenty was written with help from Cursor, an AI coding agent. Cursor is not part of the running app. The app does not send the camera, pulse, breathing, room code, or API key to Cursor.

The running app talks to two places. It does not call any other AI or cloud model. There is no analytics package.

### Presage SmartSpectra

The dependency is `@smartspectra/node-sdk` 3.5.0. After the consent screen, if a key is present and practice mode is off, `src/live-session.js` opens the camera with `getUserMedia` and passes that stream to `useMediaStream`. Pulse and breathing are read back from the SDK `metrics` event on this computer. Twenty uses pulse for the pause cue and, during the quiet pause only, breathing to time the guide.

The SDK is constructed with `enableTelemetry: false` and `enableAccumulatedOutput: false`. The app never calls `requestInsight` (Presage’s feature that sends a question and measurements to an AI service) and never calls `checkDeviceReadiness`.

What Twenty’s code sends to Presage is the API key, because the SDK constructor requires it and Presage’s documentation says the library contacts Presage to check that key. Presage’s documentation says the measurement itself stays on the device, and that the key check is not an upload of video or measured values. A network connection is required for the check. Twenty adds no other Presage request.

Presage’s telemetry documentation says telemetry is on by default and can send session summaries and device-readiness reports. Those reports can include free text, file paths, and device details. They do not include raw frames or measured vitals. Authenticated requests can be tied to an account. Twenty sets telemetry off. See [SDK Telemetry & Privacy](https://smartspectra.presagetech.com/docs/telemetry-and-privacy).

Practice mode does not construct the SDK. That is the path when there is no key, or when `TWENTY_MOCK=1` is set. The camera stays off and the numbers are scripted in `src/mock-session.js`. The solo partner in `src/sim-peer.js` and `src/traces.js` is generated numbers, not a recording of a person. Those numbers stay on this computer. Only the same break and ready yes/no messages can leave.

### Room relay

`relay/server.js` is a WebSocket relay included in this project. It is not an AI service. By default the Electron app starts it on `127.0.0.1:47221`. Another computer is involved only if you set `TWENTY_RELAY_URL`. This project does not deploy a public relay.

The relay accepts only three messages (`src/protocol.js`):

- `join`: room code and a random connection id
- `break`: a boolean
- `ready`: a boolean

Anything else, including fields named like pulse, breathing, video, name, or who, is rejected. The message sent back to each window is the room code, whether a break is on, whether you are ready, whether the other person is ready, how many people are connected, and when the pause ends. The connection id is not included in that message. The health check returns `{ "ok": true }` and does not list rooms.

### What is stored, where, and for how long

- Camera frames, pulse, breathing, confidence, and the calm-minute baseline are kept in memory. Twenty does not write them to a file. They are dropped when you leave the room or quit.
- An API key you type into the app is written to `twenty.config.json` inside the app’s private settings folder, mode `0600` where the system allows it. On a Mac that folder is `~/Library/Application Support/Twenty/`. On Windows it is `%APPDATA%\Twenty\`. It stays there until you click **Remove saved key**. **Use a different key** opens the box again. The app does not print the key. The window is context-isolated with Node disabled in the page. Sandbox is off only so the SmartSpectra preload can load.
- A key you put in `.env` or in a project `twenty.config.json` stays in that file until you delete it. Both files are gitignored. The shell environment overrides the files. None of these copies are sent to the relay.
- The relay keeps the room in memory and deletes it when the last person disconnects. It has no database.
- There is no account and no session log.

### How to opt out

- Close the window on the consent screen. The camera is not opened.
- **Stop camera** releases the camera. The header shows **Camera off**.
- **Leave room** or quit drops the in-memory session.
- Do not set `TWENTY_RELAY_URL` if the room code should not leave this computer.
- **Remove saved key**, and delete `.env` if you created one. With no key, the app stays in practice mode and does not start the SDK.
- Telemetry is hard-coded off. There is no control that turns it on, and there is no in-app AI feature to disable.

### What this is not

Not a medical device. Not a diagnosis. The twenty minutes and the “near 100” figure are a wellness pause, used only on readings the SDK marks confident and inside 40–110 beats per minute. Either person can call a timeout with no reading, stop the camera, or leave.

## Prize Categories

Best Thoughtful Real-World Use

The need is ordinary: two people in an argument who would both do better with twenty quiet minutes, and who should not have to accuse each other to get them. The app is built around that — consent before the camera, vitals that stay on the laptop, a break that does not name anyone, a manual timeout, and a way to stop the camera in one tap.
