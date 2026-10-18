# Backup recording (labeled)

These are recordings and captures of **real** runs on the deployed build, not mockups. Every browser clip carries an on-screen
"Recorded rehearsal · <label> · <phase> · <UTC time>" stamp. Use them only as a labeled backup if a live step is slow or fails
on stage. Never present them as live.

| File | What it shows | Run |
|---|---|---|
| `rehearsal-1-before.webm` / `.png` | Storefront after the real-agent weekend launch and activity (jacket $108, shoe $139 by operator, clearance 20% off, premium tile), pick list, UNDO overview | Rehearsal 1, build c0754e6, 2026-10-18 03:19Z |
| `rehearsal-1-after.webm` / `.png` | Same pages after the owner-approved recovery: premium prices/copy/tile restored, shoe $139 kept, clearance and navigation kept, orders unchanged, recovery listed | Rehearsal 1, 03:2xZ |
| `rehearsal-3-receipt.png` | RecoveryReceipt MCP App (undo_verify) rendered from the deployed server: 8 restored, shoe kept by owner decision, unselected launch changes kept, independent sizing edits preserved, order impact, owner messages delivered | Rehearsal 3, build 8fcc5c5 |
| `../app-view/pouch-retirement-plan.png` | RecoveryReceipt plan (undo_preview) for the free-pouch experiment: 10 set aside, 4 kept on accepted orders, 6 releasable | Live pouch run, 2026-10-18 01:12Z |
| `../app-view/recovery-plan-deployed.png` | Earlier plan view with the shoe price conflict | Live run 1 |

The phone side (owner texts, approval code, completion summary, the voice call) happened on the owner's real phone. Its
evidence is the provider message and call ids with delivery states in `../runs/*.json`. If the owner made an iPhone screen
recording during a rehearsal, add it here as `rehearsal-N-phone.mov`.

Suggested backup cut (about 90 s): before clip, then the plan screenshot with the conflict, then (phone) the conflict question,
"Keep $139", plan and code, "YES ####", completion, then the after clip, then the receipt screenshot, then the customer email
answer (`../runs/rehearsal-*.json` customer messages).
