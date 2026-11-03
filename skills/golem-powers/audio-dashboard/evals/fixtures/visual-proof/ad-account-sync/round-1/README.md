# Round 1 account-sync proof

Reviewed head: `236ac25fad57ea890ae7a90bd8c00c605d6407fe`.
The before images are the parent folder's `*-dark-after.png` files from that head;
`capture.json` names each one. These six new after images and six amplified pixel
diffs cover 1280×900 and 390×900, decision-flow list/story and cinema classic.
The neutral fixture is unchanged. No animation was added.

Both templates are dark-only: light = dark for the rendered palette. The recorder
checks text, background and border colors under both system preferences and keeps
one image set, avoiding duplicate pairs. Byte identity is not asserted because
browser edge antialiasing can vary between captures.

Fallback status now uses the warning color. Cinema's lede is neutral, the notes
bar has separate sentences, and per-note “See save status above” flashes are gone.
The save status carries storage-mode truth. The browser tests exercise the account
mode, visible load retries and field-save recovery separately.
