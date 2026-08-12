# Reminders - osascript

## Tested environment

- macOS: Darwin 25.6.0
- Reminders version: 7.0
- Automation: AppleScript through `osascript`
- Test prefix: `osaagent-test-20260811-`

## Permissions

The read and write test completed successfully. No permission error was
observed. The Reminders scripting dictionary declares separate read and
read-write access groups for Reminders data.

## Capability matrix

| Capability | Result | Evidence |
|---|---|---|
| Read application and default list | works | Returned Reminders, list ID, and reminder count |
| Create reminder | works | Returned a reminder URL and test name |
| Read reminder properties | works | Returned the created identifier and name |
| Update reminder body | works | Returned the updated body |
| Complete reminder | works | Returned `true` for `completed` |
| Delete test reminder | works | Direct object deletion succeeded |
| Verify deletion | works | Matching reminder count was `0` |
| UI scripting | untested | Not needed for the dictionary workflow |

## End-to-end CRUD test

```bash
osascript <<'APPLESCRIPT'
tell application "Reminders"
  activate
  set testName to "osaagent-test-20260811-reminders"
  set targetList to default list
  set testReminder to make new reminder at targetList with properties ¬
    {name:testName, body:"Initial test body."}
  set createdId to id of testReminder
  set createdName to name of testReminder
  set body of testReminder to "Updated test body."
  set updatedBody to body of testReminder
  set completed of testReminder to true
  set completedState to completed of testReminder
  delete testReminder
  delay 1
  set remainingCount to count of ¬
    (every reminder of targetList whose name is testName)
  return {createdId as text, createdName as text, updatedBody as text, ¬
    completedState as text, remainingCount as text}
end tell
APPLESCRIPT
```

Observed result:

```text
x-apple-reminder://D9557DED-CE38-4BD7-B33B-B5CBAAE92D91,
osaagent-test-20260811-reminders, Updated test body., true, 0
```

The test used the default Reminders list. It created, read, updated,
completed, deleted, and independently verified deletion of only the
prefixed test reminder.

## Errors and limitations

No errors occurred during the tested workflow. Account selection beyond the
default list and UI scripting remain untested.

## Recommended approach

Use the dictionary workflow with an explicit test prefix. Capture the returned
reminder identifier, verify updates by reading the object, and verify cleanup
by querying the containing list after deletion.
