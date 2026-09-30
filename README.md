# n8n-nodes-getlead

n8n community node for [Getlead CRM](https://getleadcrm.com), built on the Getlead V3 API
(`https://v3.getleadcrm.com/api/v1`, see the [Developer Hub](https://getleadcrm.com/developer-hub)).

> Not published to npm yet (`"private": true` in `package.json` guards against an accidental publish).
> Publishing waits for the Getlead npm organisation.

## Nodes

### Getlead Trigger

| Event | How it works |
| --- | --- |
| **New Lead** | Polls `GET /leads?sort_by=created_at` and emits each lead created since the last poll. Optional filters: source, status. |

On activation the trigger only records the newest lead; it never replays existing leads. "Fetch Test Event" returns the most recent lead.

### Getlead

| Resource | Operation | API |
| --- | --- | --- |
| Lead | Create | `POST /leads` |
| Lead | Update | `PATCH /leads/{lead_id}` |
| Lead | Create or Update | `PATCH /leads/by-identifier` (phone or email), then `POST /leads` on a 404 |
| Lead | Find | `GET /leads?search=` (cursor pagination, optional status/source/assignee filters) |
| Note | Add | `POST /leads/{lead_id}/notes` or `POST /leads/by-identifier/notes` |

The Status, Source, Assigned To, and Purpose dropdowns load live from `GET /meta`.

**Custom fields** also come from `GET /meta`, each with a matching input: a dropdown for select, a toggle for boolean, a date picker for date and date & time, and text for text, textarea, email, phone and URL. Multi-select fields (e.g. hobbies) are set in the separate **Multi-Select Custom Fields** section. Select values given as labels (e.g. from a form) are mapped to their stored value, and invalid values fail with the list of allowed ones.

**Update** and **Add Note** pick the lead from a searchable list (name, phone or email), or take a lead ID.

### Getlead API behaviour the node works around

- `PATCH` replaces a lead's whole `custom_fields` set, so the node merges in the lead's current values before updating custom fields.
- On create, date-only custom fields accept only `YYYY-MM-DD`, so the node looks up field types in `/meta` and sends date-only values without a time.
- `/meta` has no field labels, so field names are built from their keys (`location_2` → "Location 2").

Every request goes through one helper that retries HTTP 429 after the `retry_after` seconds the API returns (max 3 retries, max 120 s wait), and retries 5xx with exponential backoff.

## Credentials

**Getlead API**: an API key (`ik_...`) created in Getlead CRM under
*Settings → All Integrations → API Integration → API Keys*. The credential test calls `GET /meta`.
The optional *Base URL* field is only for pointing at a test/staging environment.

## Local development

```bash
npm install
npm run build
npm run lint
npm run dev    # starts n8n at http://localhost:5678 with this node loaded (via ~/.n8n-node-cli)
```

To load it into an existing n8n instead:

```bash
npm run build
mkdir -p ~/.n8n/custom/node_modules
ln -s "$(pwd)" ~/.n8n/custom/node_modules/n8n-nodes-getlead
n8n start
```

## Testing rules

- Only create test leads whose name starts with **ZZ**.
- Don't delete anything you didn't create.
- Use a key from the **test business**. Never create API keys on the live business for testing.

## License

MIT
