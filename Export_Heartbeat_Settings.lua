-- Reads the settings of "Escape Room Heartbeat Timer" on the selected track and prints
-- one JSON line you can paste into the controller page's "Import settings" box.
-- Run: Actions -> Show action list -> New action -> Load ReaScript.

local tr = reaper.GetSelectedTrack(0, 0)
if not tr then reaper.ShowMessageBox("Select the track with the heartbeat plugin first.", "Export heartbeat", 0) return end

local fx
for i = 0, reaper.TrackFX_GetCount(tr) - 1 do
  local _, name = reaper.TrackFX_GetFXName(tr, i, "")
  if name:lower():find("escape room heartbeat") then fx = i break end
end
if not fx then reaper.ShowMessageBox("No 'Escape Room Heartbeat Timer' on this track.", "Export heartbeat", 0) return end

-- plugin parameter index (0-based) = slider number - 1
local map = {
  dur = 0, bpm0 = 1, bpm1 = 2, db0 = 3, db1 = 4, bpmC = 5, dbC = 6,
  pitch = 7, drop = 8, decay = 9, dub = 10, gap = 11, body = 12,
  endMode = 13, offs = 14, trim = 15, rev = 16, revLen = 17, revDamp = 18,
}
local order = { "dur","bpm0","bpm1","db0","db1","bpmC","dbC","pitch","drop","decay","dub","gap","body","endMode","offs","trim","rev","revLen","revDamp" }

local parts = {}
for _, k in ipairs(order) do
  local v = reaper.TrackFX_GetParam(tr, fx, map[k])
  parts[#parts + 1] = string.format('"%s":%s', k, tostring(math.floor(v * 10000 + 0.5) / 10000))
end
local json = "{" .. table.concat(parts, ",") .. "}"

if reaper.CF_SetClipboard then
  reaper.CF_SetClipboard(json)
  reaper.ShowMessageBox("Settings copied to the clipboard. Paste them into the controller's Import box.", "Export heartbeat", 0)
else
  reaper.ShowConsoleMsg(json .. "\n")
  reaper.ShowMessageBox("Settings were printed in the REAPER console (View > Show console output). Select the line and copy it.", "Export heartbeat", 0)
end
