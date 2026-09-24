// Texts a member when their racket is marked finished.
//
// This is the only part of the app that can't run in the browser: sending an
// SMS needs the Twilio credentials, and anything the page can read, a member
// can read. So it lives here, watches the order documents, and fires when one
// crosses into "finished".
//
// Deploying it needs the project on the Blaze plan — functions don't run on
// the free tier. Twilio's own costs are about $1.15/month for the number plus
// well under a cent per text.

const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const TWILIO_ACCOUNT_SID = defineSecret("TWILIO_ACCOUNT_SID");
const TWILIO_AUTH_TOKEN = defineSecret("TWILIO_AUTH_TOKEN");
const TWILIO_FROM = defineSecret("TWILIO_FROM");

initializeApp();

exports.notifyRacketReady = onDocumentUpdated(
  {
    document: "stringing_orders/{orderId}",
    secrets: [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM],
    region: "us-central1"
  },
  async event => {
    const before = event.data.before.data();
    const after = event.data.after.data();
    if (!before || !after) return;

    // Only the crossing into finished, and only once. Editing a finished
    // order — fixing a typo in the string name, say — must not text again,
    // which is what notifiedAt guards.
    const justFinished = before.status !== "finished" && after.status === "finished";
    if (!justFinished || after.notifiedAt) return;

    const to = after.memberPhone;
    if (!to) {
      console.error("order has no member phone", event.params.orderId);
      return;
    }

    const first = (after.memberName || "").trim().split(/\s+/)[0];
    const racket = after.racket ? `your ${after.racket}` : "your racket";
    const grip = after.grip && after.grip !== "none" ? " (new grip on too)" : "";
    const body = `${first ? `Hi ${first}, s` : "S"}tringing is complete on ${racket}${grip}. ` +
      "Come pick it up at the club whenever works for you. - LAGCC Racket Stringing";

    const sid = TWILIO_ACCOUNT_SID.value();
    const token = TWILIO_AUTH_TOKEN.value();
    const from = TWILIO_FROM.value();

    const form = new URLSearchParams({ To: to, From: from, Body: body });
    let res;
    try {
      res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: "POST",
        headers: {
          Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: form
      });
    } catch (err) {
      // Recording the failure on the order is what lets a stringer see that
      // the member wasn't actually told, rather than it vanishing into logs.
      console.error("twilio request failed", err);
      await markNotifyResult(event.params.orderId, null, String(err));
      return;
    }

    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error("twilio rejected the message", res.status, payload);
      await markNotifyResult(event.params.orderId, null,
        payload.message || `Twilio returned ${res.status}`);
      return;
    }

    await markNotifyResult(event.params.orderId, Date.now(), null);
  }
);

async function markNotifyResult(orderId, notifiedAt, notifyError) {
  try {
    await getFirestore().collection("stringing_orders").doc(orderId)
      .update({ notifiedAt, notifyError });
  } catch (err) {
    console.error("couldn't record the notify result", err);
  }
}
