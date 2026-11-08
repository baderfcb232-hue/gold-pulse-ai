# NABD phase 11 — private Telegram live-readiness diagnostics

An admin-only **GET /api/admin/subscriber-telegram-readiness** endpoint is protected by the existing admin role + session MFA. It calls Telegram `getMe` and `getWebhookInfo` from the Render server, without returning bot token, Telegram chat IDs, or webhook secret.

Possible states:
- `NOT_CONFIGURED`: dedicated bot token, username, secret, or HTTPS base not set
- `BOT_IDENTITY_MISMATCH`: bot username from Telegram does not match configured username
- `WEBHOOK_URL_MISMATCH`: Telegram webhook not registered at `https://gold-pulse-ai.onrender.com/api/telegram/subscriber-webhook`
- `WEBHOOK_BACKLOG`, `WEBHOOK_RECENT_ERROR`, `WEBHOOK_CUSTOM_CERTIFICATE`, `TELEGRAM_API_UNAVAILABLE`: needs operational investigation
- `API_READY`: the bot identity and Telegram's webhook URL are confirmed

**API_READY is not proof of end-to-end delivery.** Telegram does not return the webhook secret through `getWebhookInfo`, nor does it prove a particular member completed `/start` and received a message. Verify a real opt-in member by logging in, linking Telegram, pressing Start in private chat and sending the test message from the onboarding page.

The public channel bot is separate; do not use its existing token in this private bot feature.

**Do not enable** `NABD_SUBSCRIBER_TELEGRAM_AUTO_SIGNALS=true` until real-member test and consent succeed. Account trading remains unaffected.

This endpoint exposes a status to authenticated administrators only, not to the public web dashboard.
