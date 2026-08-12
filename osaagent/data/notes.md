# Apple Notes - osascript

## What works

### Create a note in the iCloud Notes folder

Use `osascript` with an AppleScript `tell application "Notes"` block. Activate Notes, then create the note through the iCloud account and the `Notes` folder.

```bash
osascript -e 'tell application "Notes"' \
  -e 'activate' \
  -e 'tell account "iCloud" to make new note at folder "Notes" with properties {name:"A Small Poem", body:"Morning light\nSpills softly across the room;\nThe day begins."}' \
  -e 'end tell'
```

The command succeeded and returned a Core Data note identifier. Notes opened and the note was created with the requested title and body.
### End-to-end CRUD test

The following test created a uniquely named note in the iCloud `Notes`
folder, read its identifier and title, updated its body, deleted the note by
its object reference, and verified that no note with the test name remained.

```bash
osascript <<'APPLESCRIPT'
tell application "Notes"
  set testName to "osaagent-test-YYYYMMDD-notes"
  tell account "iCloud"
    set targetFolder to folder "Notes"
    set testNote to make new note at targetFolder with properties ¬
      {name:testName, body:"Initial test body."}
    set createdId to id of testNote
    set createdTitle to name of testNote
    set body of testNote to "Updated test body."
    set updatedBody to body of testNote
    delete testNote
    delay 1
    set remainingCount to count of ¬
      (every note of targetFolder whose name is testName)
  end tell
  return {createdId, createdTitle, updatedBody, remainingCount}
end tell
APPLESCRIPT
```

Observed result:

- Create: works.
- Read: works for the Core Data identifier and title.
- Update: works. Notes returns the body as HTML.
- Delete: works when using the returned note object reference.
- Cleanup verification: works. The remaining count was `0`.

The test used the prefix `osaagent-test-20260811-`. No unrelated notes were
modified.

## Capability matrix

| Capability | Result | Evidence |
|---|---|---|
| Read accounts and folders | works | iCloud and the `Notes` folder were returned |
| Create note | works | Core Data identifier returned |
| Read note properties | works | identifier and title returned |
| Update note body | works | updated HTML body returned |
| Delete test note | works | direct object deletion succeeded |
| Verify deletion | works | no matching note remained |

### Reusable template

```bash
osascript -e 'tell application "Notes"' \
  -e 'activate' \
  -e 'tell account "iCloud" to make new note at folder "Notes" with properties {name:"TITLE", body:"BODY"}' \
  -e 'end tell'
```

Replace `TITLE` and `BODY` with the note content. Keep the AppleScript string quoted so the shell passes the complete script to `osascript`.

## Notes

- This method targets the iCloud account explicitly.
- The destination folder is the account's `Notes` folder.
- `activate` opens Notes before the note is created.
