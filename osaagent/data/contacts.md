# Contacts - osascript

## Tested environment

- macOS: Darwin 25.6.0
- Contacts version: 14.0
- Automation: AppleScript through `osascript`
- Test prefix: `osaagent-test-20260811-`

## Permissions

The read and write test completed successfully. No permission error was
observed. Contacts saved each create, update, and delete operation.

## Capability matrix

| Capability | Result | Evidence |
|---|---|---|
| Read application state | works | Returned name, version, people count, group count, and country code |
| Create contact | works | Returned a persistent contact identifier |
| Read contact properties | works | Returned first and last names |
| Update contact | works | Returned the updated organization |
| Delete test contact | works | Deleted the returned person object |
| Verify deletion | works | Matching contact count was `0` |
| UI scripting | untested | Not needed for the dictionary workflow |

## End-to-end contact test

```bash
osascript <<'APPLESCRIPT'
tell application "Contacts"
  set testFirstName to "osaagent-test-20260811-contacts"
  set testLastName to "Test Person"
  set createdPerson to make new person with properties ¬
    {first name:testFirstName, last name:testLastName, organization:"osaagent"}
  save
  set createdId to id of createdPerson
  set createdFirstName to first name of createdPerson
  set createdLastName to last name of createdPerson
  set organization of createdPerson to "osaagent-updated"
  save
  set updatedOrganization to organization of createdPerson
  delete createdPerson
  save
  delay 1
  set remainingCount to count of ¬
    (every person whose first name is testFirstName)
  return {createdId as text, createdFirstName as text, ¬
    createdLastName as text, updatedOrganization as text, ¬
    remainingCount as text}
end tell
APPLESCRIPT
```

Observed result:

```text
938B9643-7696-4724-B732-99F75495C2CA:ABPerson,
osaagent-test-20260811-contacts, Test Person, osaagent-updated, 0
```

A separate cleanup query also returned `0` matching contacts. The test
created, read, updated, saved, deleted, and verified deletion of only the
prefixed contact.

## Errors and limitations

No errors occurred during the tested workflow. Group creation, account
selection, contact photos, contact methods, and UI scripting remain untested.

## Recommended approach

Use a unique test prefix in a contact name, save after each mutation, capture
the returned contact identifier, and verify deletion with a fresh query before
finishing.
