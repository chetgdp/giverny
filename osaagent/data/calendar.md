# Calendar - osascript

## Tested environment

- macOS: Darwin 25.6.0
- Calendar version: 16.0
- Automation: AppleScript through `osascript`
- Test prefix: `osaagent-test-20260811-`

## Permissions

The event read and write test completed successfully. No permission error was
observed. The Calendar scripting dictionary declares separate read and
read-write access groups.

Some calendar properties were not available in this run. Reading
`calendarIdentifier` and `writable` returned AppleEvent error `-10000`, while
calendar names, event creation, event reads, updates, and deletion worked.

## Capability matrix

| Capability | Result | Evidence |
|---|---|---|
| Read application and calendar count | works | Returned Calendar and `13` calendars |
| Read calendar names | works | Returned the calendar name list |
| Read calendar identifier | fails | Error `-10000` |
| Create event | works | Returned a UID and test summary |
| Read event properties | works | Returned UID and summary |
| Update event description | works | Returned the updated description |
| Delete test event | works | Direct object deletion succeeded |
| Verify deletion | works | Matching event count was `0` |
| UI scripting | untested | Not needed for the dictionary workflow |

## End-to-end event test

```bash
osascript <<'APPLESCRIPT'
tell application "Calendar"
  set testName to "osaagent-test-20260811-calendar"
  set targetCalendar to calendar 1
  set startTime to (current date) + (2 * hours)
  set endTime to startTime + (1 * hours)
  set createdEvent to make new event at end of events of targetCalendar with ¬
    properties {summary:testName, description:"Initial test description.", ¬
    start date:startTime, end date:endTime}
  set createdUid to uid of createdEvent
  set createdSummary to summary of createdEvent
  set description of createdEvent to "Updated test description."
  set updatedDescription to description of createdEvent
  set eventUrl to url of createdEvent
  delete createdEvent
  return {createdUid as text, createdSummary as text, ¬
    updatedDescription as text, eventUrl as text}
end tell
APPLESCRIPT
```

Observed result:

```text
0CB725CE-EEC7-4558-BDF9-1D73A7C05230,
osaagent-test-20260811-calendar, Updated test description., missing value
```

The event was created in calendar 1, read through its returned object,
updated, deleted, and independently verified absent by querying calendar 1.
No invitation was sent and no attendee was added.

## Errors and limitations

The `calendarIdentifier` and `writable` properties returned `-10000` in this
run. Use a known calendar object reference for event CRUD instead of relying
on those properties. Calendar account selection, invitations, alarms, and
recurrence remain untested.

Parsing a date string containing `1:00:00 PM` produced `01:00:00` in this
environment, so the resulting end time was earlier than the start time and
Calendar rejected the event with `-10025`. Construct dates from components
and use `13 * hours` for 1:00 PM.

Calendar UI commands worked without UI scripting:

```bash
osascript <<'APPLESCRIPT'
tell application "Calendar"
  activate
  view calendar at (current date)
  switch view to month view
end tell
APPLESCRIPT
```

Showing a matching event with `show item 1 of matchingEvents` also worked.
This confirms semantic Calendar commands, but not System Events UI scripting.

## Recommended approach

Read the application and calendar count first. Use an explicit calendar object
reference, create only prefixed test events without attendees, verify updates
through the event object, delete the object, and query the same calendar to
confirm cleanup.
