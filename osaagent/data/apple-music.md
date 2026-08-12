# Apple Music - osascript

## What works

### Attempt to play a specific track by Apple Music catalog URL

Look up the track via the iTunes Search API, then open the URL inside the Music app and call play.

```bash
# Find the track URL
curl -s "https://itunes.apple.com/search?term=aphex+twin+xtal&entity=song&limit=3" \
  | jq -r '.results[0].trackViewUrl'
```

```applescript
tell application "Music"
    activate
    open location "https://music.apple.com/us/album/xtal/1668862636?i=1668862649"
    delay 4
    play
end tell
```

`open location` accepted the Apple Music HTTPS URL, and `player state`
later returned `playing`. This did not prove that the requested track
started. In the observed run, Music remained on the search-results page for
`Xtal Aphex Twin`, and the current track was not visible.

### Transport controls

```applescript
tell application "Music"
    play
    pause
    stop
    set player position to 0 -- seek to start
    set sound volume to 50  -- 0-100
end tell
```

### Check player state

```applescript
tell application "Music" to player state as text
-- returns: "playing", "paused", or "stopped"
```
## Capability matrix

| Capability | Result | Evidence |
|---|---|---|
| Read application name | works | returned `Music` |
| Read player state | works | returned `stopped` before the test |
| Search local library | works | returned zero local `Xtal` matches |
| Open catalog URL | partial | URL opened to an `AutoPlay` view, but track selection was not verified |
| Start playback | unverified | `player state` returned `playing`, but the UI showed `AutoPlay` |
| Pause playback | works | test paused playback after the check |
| Read streaming track metadata | fails | `name of current track` failed with `-1700` |
| Play local library track | works | Music played `Xtal` and returned matching metadata |
| Search for `The Infamous` by Mobb Deep | works, no match | Album and artist searches both returned zero local-library tracks |

## Executed test

The test opened the existing Apple Music catalog URL for `Xtal`, waited five
seconds, called `play`, waited three seconds, read `player state`, attempted to
read the current track metadata, and then called `pause`.

Observed result:

- Music opened the catalog URL to an `AutoPlay` view.
- The UI did not show proof that the requested track was selected.
- `player state` returned `playing`, but this was not reliable playback proof.
- Reading the current track failed with `-1700`.
- Playback was paused at the end of the test.

The result does not prove that the requested catalog track started. The
transport operation is not verified for this URL workflow, and AppleScript did
not provide reliable metadata for independent verification.
### Play a local library track

```bash
osascript <<'APPLESCRIPT'
tell application "Music"
  set libraryPlaylist to some library playlist
  set matches to search libraryPlaylist for "Xtal" only songs
  set selectedTrack to first item of matches
  play selectedTrack
  delay 3
  set stateAfterPlay to player state as text
  set currentName to name of current track as text
  set currentAlbum to album of current track as text
  set currentArtist to artist of current track as text
  pause
  return {stateAfterPlay, currentName, currentAlbum, currentArtist}
end tell
APPLESCRIPT
```

Observed result:

```text
playing, Xtal, Selected Ambient Works 85-92, Aphex Twin
```

Playing a track directly from the local library worked. Music returned
metadata matching the selected track, providing independent verification that
the requested song played. The test paused playback before exiting.
### Search for an album in the local library

```bash
osascript <<'APPLESCRIPT'
tell application "Music"
  set libraryPlaylist to some library playlist
  set albumMatches to search libraryPlaylist for "The Infamous" only albums
  set artistMatches to search libraryPlaylist for "Mobb Deep" only artists
  return {count of albumMatches, count of artistMatches}
end tell
APPLESCRIPT
```

Observed result:

```text
0, 0
```

The album and artist were not found in the local Music library. This search
does not search the Apple Music streaming catalog.
## Interactive steering test

The UI search workflow showed that a human can see the `The Infamous` album
result in Music even when `System Events` exposes no matching accessibility
element. This is an important distinction for capability testing:

- AppleScript can bring Music to the front with `activate`.
- AppleScript can type a search query through `System Events`.
- The album result can be visible to a human but unavailable as a semantic
  click target.
- Coordinate clicking would require a screenshot and a native mouse event.
- `screencapture` failed with `could not create image from display`, so the
  screenshot-based click was not tested. Screen Recording permission is
  required for that approach.

The test method should follow a real user workflow: activate the app, perform
one visible action, inspect what the app exposes, and record where human
interaction succeeds but AppleScript automation cannot identify the target.




## What does not work

### Direct library search for streaming-only tracks

```applescript
tell application "Music"
    set matches to search playlist "Library" for "Xtal" only songs
    -- No matching local track was found. The script raised -2700.
end tell
```

The `Library` playlist only contains locally added tracks. Streaming catalog
tracks that have not been added to the library are not queryable this way.

### Getting current track metadata while streaming

```applescript
tell application "Music"
    set t to name of current track as text
end tell
```

The observed request failed with `-1700`. A guarded version returned
`missing value`, even while `player state` returned `playing`. AppleScript
therefore could not verify which streaming track was playing.

### UI scripting search

```applescript
-- Types into search but results are not reliably interactable
tell application "System Events"
    tell process "Music"
        keystroke "f" using command down
        delay 1
        keystroke "Xtal Aphex Twin"
        keystroke return
    end tell
end tell
```

The search field accepted input, but the result cards were not reliably
addressable through accessibility elements. One inspection exposed album and
artist buttons but not the `Xtal` track card. A later inspection found no
elements whose name or description contained `Xtal`. Reading the Music
window position and size also returned malformed accessibility data. A
coordinate click would have been unverified and was not attempted.

### `reveal` on search results

```applescript
-- FAILS: empty search results don't understand reveal
tell application "Music"
    reveal (search library playlist 1 for "Xtal Aphex Twin")
end tell
```

## Recommended approach

1. Use the iTunes Search API to resolve artist and track names to an Apple
   Music URL.
2. Use `open location` to navigate Music to that URL.
3. Wait for the page to load, then call `play`.
4. Do not treat `player state = playing` as proof that the requested track
   started.
5. Verify the title and artist through a separate reliable interface before
   reporting success. AppleScript `current track` and the observed
   accessibility UI did not provide that verification.
