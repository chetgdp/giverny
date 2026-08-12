# osascript app testing plan

## Goal

Document how each scriptable macOS app can be used with `osascript`. Record
successful operations, partial behavior, failures, permissions, verification,
and cleanup steps.

Existing app notes use one Markdown file per app, such as `notes.md` and
`apple-music.md`. Keep that format for new app documentation.

## Capability levels

Test and classify each operation as:

- **Read**: query state or metadata.
- **Create**: create an object, such as a note, reminder, event, playlist, or document.
- **Update**: change an existing object.
- **Delete**: remove only test-created objects.
- **Action**: trigger behavior, such as play, pause, send, open, export, or build.
- **UI scripting**: use `System Events` when the app dictionary is insufficient.
- **Verification**: independently prove that the operation succeeded.

Use these result labels:

- `works`
- `partially works`
- `fails`
- `not applicable`
- `untested`

## Shared test protocol

Record the following for every app and operation:

- macOS version
- app version
- AppleScript or JXA
- required permissions
- exact command
- observed output
- independent verification method
- cleanup command
- limitations and error codes

Use a unique prefix for every test run:

```text
osaagent-test-YYYYMMDD-
```

Only modify or delete objects containing the test prefix. Never modify or
remove unrelated user data.

Prefer semantic commands from the target app's own scripting dictionary.
Use `System Events` only when the dictionary does not expose the required
control, and record which control path was used.

Construct date and time values from components when possible. Do not rely on
localized date strings containing AM or PM. Record the timezone and verify
that the end time is later than the start time before creating an event.

Treat cleanup as a tested operation, not an assumption. Some compose or
temporary objects may remain in an application's scripting collection after
`delete` or `close`. If cleanup requires restarting an app, record that
boundary and use a no-save restart only when it will not discard unrelated
user work.

## Central index

Maintain `data/index.md` with one row per app and columns for:

- Read
- Create
- Update
- Delete
- Actions
- UI scripting
- Overall status

## Apps to test

### Data and communication

- Calendar
- Contacts
- Mail
- Messages
- Notes
- Reminders

Test object creation, property reads, updates, deletion, account selection,
and permission failures. Use test-only recipients and do not send real
messages.

### Media

- Music
- Photos
- QuickTime Player
- TV

Test library reads, current state, transport controls, URL opening, metadata,
imports, and exports. For Music, separate local-library behavior from
streaming-catalog behavior. `player state = playing` is not proof that a
requested track played.

### Documents and productivity

- Keynote Creator Studio
- Numbers Creator Studio
- Pages Creator Studio

Test document creation, content insertion, saving to a temporary directory,
reopening, reading content, and deletion. Verify saved files outside the app
when possible.

### Developer and terminal tools

- Terminal
- Xcode
- Instruments
- Simulator
- Console
- Ghostty
- cmux

Test opening windows or sessions, running harmless commands, reading visible
state, opening projects or simulators, and closing only test-created sessions.
Do not run destructive shell commands.

### System and administration

- System Settings
- Screen Sharing
- Shortcuts
- Bluetooth File Exchange
- Brave Browser
- Google Chrome

Test navigation, reading current state, opening URLs, launching shortcuts, and
file transfer workflows. Do not change system settings unless the test restores
the original value.

## Per-app file template

Create one file such as `data/<app>.md`:

```markdown
# <App> - osascript

## Tested environment

## Permissions

## Capability matrix

## What works

### <operation>

```bash
...
```

**Verification:** ...

**Cleanup:** ...

## Partial behavior

## What does not work

## Errors and limitations

## Recommended approach
```

Keep successful examples short and reusable. Keep failed examples because they
document real boundaries.

## Test order

For every app:

1. Confirm the application name and launch it.
2. Read a harmless property, such as `name`, `version`, or object count.
3. Inspect the dictionary with `sdef`.
4. Test one read operation.
5. Test one create operation using the test prefix.
6. Read the created object back.
7. Update it.
8. Read it back again.
9. Delete it.
10. Verify that deletion succeeded.
11. Repeat ambiguous cases with independent verification.
12. Record required Automation, Accessibility, Files and Folders, Contacts,
    Calendar, or other permissions.

## Interactive user-control workflow

For complex apps, test the workflow a real user would follow instead of
testing isolated dictionary commands only. The purpose is to discover what a
person can visibly do and what automation can reliably reproduce.

Run each step as an isolated action when possible:

1. Bring the app to the front with `activate`.
2. Prefer one semantic command from the app dictionary, such as switching a
   Calendar view, before attempting UI scripting.
3. Perform one visible action, such as opening a view or entering a search.
4. Inspect the app's AppleScript dictionary and `System Events` tree.
5. Record visible targets that have no semantic accessibility element.
6. Capture a screenshot when visual confirmation is needed.
7. Use coordinate interaction only if semantic UI scripting cannot identify the
   target.
8. Verify the result through the app, the filesystem, or another independent
   interface.
9. Stop and record the boundary when permissions or app behavior prevents the
   next step.

Distinguish these outcomes:

- **Semantic control**: AppleScript or Accessibility identifies and activates
  the target by name or role.
- **Visible-only control**: a human can see the target, but automation exposes
  no usable element.
- **Coordinate control**: a screenshot supplies a location for a native mouse
  event. Record that this depends on window position, display scaling, and UI
  state.
- **Unavailable control**: neither semantic nor coordinate control can be
  verified.

Record permission boundaries explicitly. `System Events` UI scripting normally
needs Accessibility permission. `screencapture` needs Screen Recording
permission. A screenshot failure must not be reported as an app failure.

The Music search test is the reference workflow: a human could see the
`The Infamous` album result, while Music exposed no matching Accessibility
element. The screenshot-based click was not completed because
`screencapture` could not capture the display without Screen Recording
permission.

## Session handoff

Before starting a new session, leave the durable test method in this file and
the app-specific evidence in `data/<app>.md`. The next session should continue
from the recorded boundary, not repeat unrelated tests.

The key goal is to discover the full control path:

```text
activate -> visible action -> inspect -> screenshot if needed ->
semantic or coordinate interaction -> independent verification
```

Do not combine extra tests with a specifically requested isolated action.
Record only the command, observed result, permission boundary, and next
action required.


## Verification rules

A successful process exit is not enough. Use a second mechanism where possible:

- Notes: query the note after creation.
- Reminders: query the reminder after creation and completion.
- Calendar: query the event after creation.
- Mail and Messages: verify drafts, not delivery.
- Music: compare multiple metadata sources and document streaming limits.
- Pages, Numbers, and Keynote: reopen the saved file.
- Terminal and Ghostty: run a command that writes a known temporary marker.
- Browser: inspect the current URL or page title.
- Photos: verify the imported asset through the dictionary and source file.

## Reusable test scripts

Keep app-specific scripts in `scripts/` or `data/scripts/`, for example:

```text
scripts/test-notes.sh
scripts/test-reminders.sh
scripts/test-calendar.sh
```

Each runner should print the app and operation, run one test at a time, capture
stdout and stderr, preserve the exit status, use the shared test prefix, and
avoid cleanup unless explicitly requested.

## Execution phases

1. Document the protocol, matrix, and permissions.
2. Finish Notes, Reminders, Calendar, Contacts, and Mail.
3. Document Music's local-versus-streaming limits.
4. Test Photos, QuickTime Player, TV, and browsers.
5. Test Pages, Numbers, Keynote, Terminal, Ghostty, cmux, and developer tools.
6. Test system apps and UI scripting.
7. Run the complete matrix, confirm cleanup, and update `data/index.md`.

The final documentation must distinguish reliable capabilities from partial or
unverified behavior. Music must not be marked simply as working because its
transport commands work.
