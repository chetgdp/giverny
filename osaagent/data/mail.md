# Mail - osascript

## Tested environment

- macOS: Darwin 25.6.0
- Mail version: 16.0
- Automation: AppleScript through `osascript`
- Test prefix: `osaagent-test-20260811-`

## Permissions

Mail state and draft composition worked without a permission error. The test
created no recipient and did not send a message.

## Capability matrix

| Capability | Result | Evidence |
|---|---|---|
| Read application state | works | Returned Mail, version, account count, mailbox count, and outgoing count |
| Create draft | works | Created an outgoing message with a test subject and body |
| Read draft properties | works | Returned subject and body |
| Update draft body | works | Returned the updated body |
| Delete test draft directly | partially works | `delete` and `close ... saving no` left the invisible object present |
| Verify cleanup after Mail restart | works | Fresh Mail process returned matching outgoing count `0` |
| Send message | not applicable | No message was sent by design |
| UI scripting | untested | Not needed for the draft workflow |

## End-to-end draft test

```bash
osascript <<'APPLESCRIPT'
tell application "Mail"
  set testSubject to "osaagent-test-20260811-mail"
  set createdDraft to make new outgoing message with properties ¬
    {subject:testSubject, content:"Initial test body."}
  set createdId to id of createdDraft
  set createdSubject to subject of createdDraft
  set content of createdDraft to "Updated test body."
  set updatedContent to content of createdDraft as text
  set visible of createdDraft to false
  return {createdId as text, createdSubject as text, updatedContent}
end tell
APPLESCRIPT
```

Observed result:

```text
0, osaagent-test-20260811-mail, Updated test body.
```

The draft had no recipient and was never sent. A direct `delete` followed by
`close ... saving no` did not remove the invisible outgoing message from
Mail's scripting collection. Quitting Mail without saving, relaunching it, and
querying the test subject returned `0` matching outgoing messages.

## Errors and limitations

Mail exposes outgoing messages as compose objects, but direct deletion did
not provide reliable cleanup in this run. A Mail restart was required to clear
the test object. Sending was intentionally not tested. Account selection,
mailbox mutation, message reading, and UI scripting remain untested.

## Recommended approach

Test Mail with drafts only. Use a unique subject, never add a real recipient,
never call `send`, and verify the draft through its subject and content. If a
script-created invisible outgoing message remains after `delete` and `close`,
quit Mail without saving and relaunch it before confirming cleanup.
