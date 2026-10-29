# Heartbeat countdown (Render)

Realtime heartbeat sound + countdown video, generated in the browser. A controller device starts it remotely.

- `/display.html` - the room screen. Tap once to arm (browsers need a tap before they allow sound), it goes fullscreen.
- `/controller.html` - phone/laptop. Settings, Start in N seconds, Stop.

All devices sync to the server clock, so the display starts exactly at the chosen moment, and a display that
joins (or reloads) mid-run jumps to the right point.

## Deploy on Render
1. Put this folder in a GitHub repo (do not commit `node_modules`).
2. Render dashboard -> New -> Blueprint (uses `render.yaml`) or New -> Web Service:
   build `npm install`, start `npm start`.
3. Open `https://<your-service>.onrender.com/controller.html`.
   There is no password: anyone who knows the URL can start/stop the countdown and upload a sound.

Free plan note: the service sleeps after ~15 min idle and takes up to a minute to wake. Open the controller a few minutes
before the game. Settings saved on the server are lost on a restart (free disk is not persistent); re-import them.

## Copy the settings from REAPER
1. Select the track with "Escape Room Heartbeat Timer".
2. Run `Export_Heartbeat_Settings.lua` (Actions -> Show action list -> New action -> Load ReaScript).
3. Paste the JSON into "Import settings" on the controller and press the button.

## Use your own heartbeat sound
On the controller, choose an audio file (wav/mp3/ogg/m4a) and press "Upload sound". Use a single heartbeat
(one lub-dub) - it is played once per beat, following the BPM and volume curve, with the reverb applied.
"Use uploaded sound" (set to 1) switches between your file and the synthesized sound. The file is kept on the server
(lost on a restart on Render's free plan, so upload it again if needed).

## Run locally
```
npm install
npm start
```
Open http://localhost:3000
