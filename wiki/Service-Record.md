# Service Record

The **Service Record** is the player profile you can actually see. Open it from the title screen to
inspect the statistics, campaign medals and cosmetic honours already stored in your local profile.
It updates when progression changes; it is not a static summary assembled only at launch.

---

## Commander identity

The dossier uses the commander name saved from **Multiplayer setup**; before one is entered it reads
**Commander**. Multiplayer carries the same name into room lists, army labels, chat, end screens
and new replay headers. It is a local handle rather than an account: VOLTMARCH has no login, public
profile URL or server-side social identity.

The large crest shows the most recently earned honour. Up to four recent honours also appear as
ribbons beside it.

---

## Career summary

Six cards turn the saved progression ledger into a readable career:

| Card | What it reads |
| --- | --- |
| **Matches** | Matches played, victories and defeats |
| **Win rate** | Lifetime wins divided by matches played |
| **Current streak** | Consecutive wins now, with the best streak underneath |
| **Missions** | Completed profile mission chains out of the current catalogue |
| **Operations** | Campaign operations with a medal, including the gold count |
| **Honours** | Earned insignia and decals out of the current collection |

The faction record below those cards shows victories credited to Allied Forces, Soviet Union,
Meridian Pact and The Reclamation. The bars are relative to your own best faction; they are not a
global ranking.

Campaign medals and skirmish progression are deliberately separate systems. Operations appear in
the Service Record, but campaign play does not advance the profile mission chains. See
[Campaign](/avihaymenahem/voltmarch/wiki/Campaign).

---

## Honours collection

The shipped collection contains **seventeen honours: ten command insignia and seven field decals**.
Each card is a real vector mark rather than reward text with nowhere to go.

- An earned card names the mission that awarded it and is available to the dossier crest.
- A locked card names its paying mission and shows live progress toward the target.
- A completed-but-not-yet-claimed card reads **Awaiting debrief** until the reward is granted.
- The collection is presentation only. Honours do not change unit statistics, paint a vehicle or
  alter multiplayer rules.

The **Missions** button at the bottom opens the complete progression catalogue and returns to the
Service Record when closed. That is the quickest route from a locked honour to the rule that pays
it.

---

## Persistence and backups

The record renders the same versioned profile used by unlocks and missions. Installed desktop
builds store it in Electron's app-data directory rather than IndexedDB or localStorage. Browser and
desktop profiles are separate and browser data is not migrated automatically.

Use **Settings → Gameplay → Profile** to export a portable JSON backup, import one, or reset all
progress. Import validates the file before replacing anything; reset requires a second confirmation.

**See also:** [Settings and Accessibility](/avihaymenahem/voltmarch/wiki/Settings-and-Accessibility) ·
[Campaign](/avihaymenahem/voltmarch/wiki/Campaign) ·
[How to Play](/avihaymenahem/voltmarch/wiki/How-to-Play)
