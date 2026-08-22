# LAGCC Racket Stringing Log

Members request a stringing and see their own rackets. Stringers see the whole
queue, move a racket from waiting to the bench to finished, and the member gets
a text when it's ready.

`index.html` is the entire app — Firebase phone sign-in plus Firestore, no
build step, the same shape as the court schedule. `functions/` holds the one
piece that can't run in a browser: sending the text.

## Who sees what

**Members** — anyone who signs in with a phone number. They place orders in
their own name and see only their own rackets. No roster has to be maintained;
a member record is created the first time someone signs in. Staff can also add
a member ahead of time so their name reads correctly from their first visit.

**Stringers** — a document in the `stringing_staff` collection is the staff
list, the same way `lagcc_allowed` gates the court schedule.

```
Collection:   stringing_staff
Document ID:  +15551234567        (E.164)
Field:        name (string)       e.g. "Anjali"
```

Add a stringer by creating that document; remove one by deleting it. Because
only an admin can set `name` there, nobody can relabel whose work a racket was
strung under.

## An order

```
stringing_orders/{id}
  memberPhone, memberName      who it's for
  racket, stringName           what it is and what goes in it
  tension, tensionCross        lbs; crosses null when they match
  dropOffDate                  the day they said they'd bring it
  notes                        free text, optional
  status                       requested -> in_progress -> finished
  createdAt
  startedAt, startedByName     who picked it up off the queue
  finishedAt, strungByName     who actually strung it, and when
  notifiedAt, notifyError      whether the text got through
```

`notifiedAt` is what stops a member being texted twice — editing a finished
order doesn't re-fire the message. Reopening a finished racket clears it, so
the text goes again when it's genuinely done.

## Setup

### 1. Firestore rules

Firebase console → Firestore Database → Rules → paste `firestore.rules` →
Publish.

**Add your own number to `stringing_staff` before publishing**, or you'll have
no staff view. The console itself always keeps working.

> A Firebase project has one rules file covering every collection in it. This
> file is written for a project of its own. Publishing it to the project that
> runs the court schedule would replace that app's rules and lock every coach
> out — if the two ever share a project, the rule sets have to be merged into
> one file first.

### 2. Texts

Sending SMS needs the project on the **Blaze** plan (functions don't run on the
free tier) and a Twilio account. Costs are about $1.15/month for the number and
under a cent per text.

Set the credentials as secrets — they never go in this repository:

```
firebase functions:secrets:set TWILIO_ACCOUNT_SID
firebase functions:secrets:set TWILIO_AUTH_TOKEN
firebase functions:secrets:set TWILIO_FROM
```

Each prompts for the value. `TWILIO_FROM` is the Twilio number in E.164, e.g.
`+15551234567`.

Then:

```
cd functions && npm install && cd ..
firebase deploy --only functions
```

### 3. Authorised domains

Firebase console → Authentication → Settings → Authorised domains → add
whatever host the site is served from, or phone sign-in is refused there.

## Deploying the site

Any static host works — it's one file. `firebase deploy --only hosting` uses
the config here.

## Notes

The sign-in handling is deliberately stubborn: only pressing **Log out** ends a
session. A refused read, a token that expired while a phone slept, or the SDK
not having finished reading its own store all get waited out and retried,
because none of them mean the person is no longer allowed in. The login screen
carries a build stamp and a note of how the last session ended, which is there
to make "it logged me out again" diagnosable rather than a guess.
