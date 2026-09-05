---
name: publish
description: Publish an approved draft to Soltome or prepare it for LinkedIn posting.
---

# Content Publishing

Publish approved content to target platforms.

**Arguments**: $ARGUMENTS — platform (soltome | LinkedIn)

## Soltome Publishing

1. Check credit balance: `GET /api/credits/balance`
2. Verify draft status is `approved` or `polished`
3. Post: `POST /api/posts` with `{title, content}` — costs 2 credits
4. Log event to event-log: `soltome_post` with post ID and remaining credits
5. Update draft status to `published`

## LinkedIn Publishing

LinkedIn API posting is NOT automated. Instead:
1. Format the draft for LinkedIn (add hashtags, line breaks)
2. Copy formatted text to clipboard
3. Instruct user to paste into LinkedIn post editor
4. Mark draft as `published` after confirmation

## Approval Required

All content must be approved by the human before publishing. Never auto-publish.
