# twoThunder Owner Dashboard

This static site is limited to Supabase connection setup and user access management. It does not configure AI models or store AI provider keys. Extension users enter their own Gemini/Groq keys in the popup; those keys remain in that user's `chrome.storage.local` and are sent directly from the extension service worker to the selected provider.

The site starts in Local Mock Mode. To use Supabase, enter the HTTPS project URL and public anon/publishable key, sign in through Supabase Auth, and use the admin Edge Function.

## Secret handling

Do **not** enter or publish a Supabase service-role key in this GitHub Pages app. Static-site values and browser storage are visible to visitors. If the admin Edge Function needs elevated database access, configure the service-role key as a server-side Edge Function secret. The function must verify the caller's Supabase Auth JWT and enforce owner/admin authorization for every request. Never return the service-role key to this dashboard.

The downloadable extension `config.js` contains only the Edge Function URL and public anon/publishable key. These are public client values, not proof of user identity. The extension sends the locally stored nickname to the config function; enforce roles, bans, and any identity checks server-side.

## Edge Function contract

Functions must handle CORS preflight and return JSON errors with non-2xx HTTP status codes.

`twothunder-config`, called with the public Supabase key:

- `POST { "action": "health" }` returns `{ "ok": true }`.
- `POST { "action": "sync", "nickname": "..." }` returns `{ "role": "user", "banned": false, "featureFlags": { "guiEnabled": true, "autoDetectionEnabled": true } }`. Role values are `owner`, `co_owner`, `admin`, `user`, or `banned`.

`twothunder-admin`, called with an authorized Supabase Auth access token, supports:

- `get_dashboard_state` or `list_users` returns `{ "users": [{ "nickname": "...", "role": "user", "banned": false, "lastSeen": "..." }] }`.
- `set_user_access` accepts `{ "nickname": "...", "role": "admin", "banned": false }` and returns `{ "ok": true }`.

The admin function—not this UI—must verify the JWT, check the caller's database role, validate role changes, and enforce protections for owner accounts. It should use database policies and server-only secrets for privileged work.

## Deploy

1. Deploy both Edge Functions and configure any required service-role secret in the Supabase function environment, never in the dashboard or extension.
2. Publish the repository's `admin/` directory with GitHub Pages.
3. Configure the dashboard with the project URL, public anon/publishable key, and function names.
4. Download `config.js` and use it to configure the extension bootstrap. The Gemini default model is set in the extension to `gemini-3.8-flash`; confirm that model is available for the user's Google AI Studio key.
