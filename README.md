# Heartbeat countdown (Render)

Realtime heartbeat sound + countdown video, generated in the browser. A controller device starts it remotely.

- `/display.html` - the room screen. Tap once to arm (browsers need a tap before they allow sound), it goes fullscreen.
- `/controller.html` - phone/laptop. Settings, Start in N seconds, Stop.
  A small live preview of the display is pinned in the bottom-right corner (silent, and not counted as a display).
  Tap it to enlarge or shrink it; the choice is remembered. It works on phone and computer.

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

## Settings and track on Render (the free plan forgets them)
A free Render service sleeps after ~15 minutes idle and its disk is wiped when it wakes, so the server loses the settings
and the uploaded track. Two ways to deal with that:

1. **Free, automatic.** The controller keeps a backup in its own browser (settings in localStorage, the track in
   IndexedDB). When it connects to a server that has forgotten them, it puts the settings back and re-uploads the track by
   itself ("Restoring track from this browser…"). So: use the same browser/device for the controller, and open it a few
   minutes before the game (a long track takes a while to upload again). Clearing that browser's site data deletes the
   backup. "Remove" deletes the track from both the server and the backup.
2. **Permanent.** Use a Render instance type that supports a persistent disk, add a disk (for example mounted at
   `/var/data`) and set the environment variable `DATA_DIR=/var/data`. The server then keeps settings and the track
   there and nothing needs restoring. (Paid instances also don't sleep.)
## Hints and locking
- The controller has a **Hint** box. Sending a hint makes the countdown glide up and shrink, then fades the hint in below it
  in large text (it picks the biggest size that fits, up to 300 characters). A new hint fades the old one out and the new
  one in; "Remove hint" fades it out and the countdown eases back to the middle. Hints work any time, also while the
  countdown is running.
- **How obvious** (chosen per hint, remembered in the controller): *Normal*; *Highlighted* (the screen flashes, a white
  border pulses for a few seconds and a "NEW HINT" label shows above the text); or *Full screen* (the hint takes over the
  whole screen in huge text for the chosen number of seconds, with the countdown shrunk at the top, then settles into the
  normal layout below the countdown).
- **Chime**: off, once, or three times, with a level slider. "Replay alert" sends the hint on screen again with the
  current alert settings (or a test hint if there is none). Alerts and chimes only fire for a newly sent hint, not when a
  display reloads while a hint is already showing.
- While the countdown is running (from pressing Start until you press Stop) the settings, import, sound upload and
  sound removal are hidden on the controller, and the server refuses those changes too. Press Stop to edit again.
  Start is also refused while running, so the timer can't be restarted by accident.

## Copy the settings from REAPER
1. Select the track with "Escape Room Heartbeat Timer".
2. Run `Export_Heartbeat_Settings.lua` (Actions -> Show action list -> New action -> Load ReaScript).
3. Paste the JSON into "Import settings" on the controller and press the button.

## Use your own heartbeat track
On the controller, choose the whole heartbeat track (wav/mp3/ogg/m4a, any length) and press "Upload track".
- It starts when you press Start and plays straight through, in sync with the countdown on every display. A display
  that joins or reloads mid-run jumps to the right position. Any start offset must already be in the audio.
- "Use uploaded track" (set to 1) switches between your file and the synthesized sound; the level slider adjusts it.
- The BPM, volume and offset settings then only drive the pulse of the numbers, so set them to match the track.
- Sound arrives later than the picture because of the device's audio output delay (worse over Bluetooth). The display
  plays the sound earlier by the delay the browser reports, and the "Sound earlier than picture (ms)" slider adds to that.
  If the sound still feels late, raise it in steps of 20-50 ms; if it feels early, lower it (it can go negative).
- **Download first, play locally.** As soon as "Use uploaded track" is on, every display downloads the whole file (even
  before it is armed) and keeps it in the browser cache, so a reload doesn't need the server again. At the start time it
  plays that local copy and keeps it locked to the shared clock. Nothing is streamed during the game, and a display that
  already has the track keeps playing it even if the server forgets the file (Render sleeping).
- The controller lists each display ("Display 1: armed · sound ready", "downloading sound 42%", "SOUND BLOCKED") and asks
  before Start if no display is armed or a sound isn't ready.
- If the browser blocks audio (screen locked, tab hidden, page reloaded without a tap) the display shows
  "SOUND OFF - tap the screen" in the corner, reports it to the controller and tries to recover by itself; a tap fixes it.
  With the level at 0 dB or lower the track goes straight to the speakers (not through Web Audio); a boost above 0 dB
  needs Web Audio, which is what can get blocked.
- The file is stored on the server's disk (it is not loaded into memory), so long tracks are fine. On Render's free plan
  the disk is wiped on a restart; the controller restores it (see above). Use mp3/ogg rather than wav to keep the
  download small.

## Run locally
```
npm install
npm start
```
Open http://localhost:3000
