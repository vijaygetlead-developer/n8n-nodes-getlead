# n8n-nodes-getlead

An [n8n](https://n8n.io) community node for **[Getlead CRM](https://getleadcrm.com)**. Create, update and find leads, add notes, and start workflows when a new lead arrives, with no code.

It uses the Getlead V3 API (`https://v3.getleadcrm.com/api/v1`). See the [Getlead Developer Hub](https://getleadcrm.com/developer-hub) for the API itself.

> **Status:** working and tested against the Getlead V3 API. It is **not on npm yet**; publishing waits for the Getlead npm organisation. Until then, install it manually (see [Installation](#installation)).

## Contents

- [Features](#features)
- [Installation](#installation)
- [Credentials](#credentials)
- [Usage](#usage)
- [Operations](#operations)
- [Custom fields](#custom-fields)
- [Development](#development)
- [License](#license)

## Features

- **Getlead Trigger: New Lead**: starts a workflow for every lead created in Getlead.
- **Leads:** Create, Update, **Create or Update** (no duplicates), Find.
- **Notes:** add a note to a lead, found by ID, phone number or email.
- **Live dropdowns** for status, source, agent and purpose, loaded from your Getlead account.
- **All custom field types**, each with a matching input: text, textarea, number, checkbox, select, multi-select, date, date & time, email, phone, URL.
- **Lead picker:** search leads by name, phone or email instead of pasting IDs.
- **Rate limits handled:** on HTTP 429 the node waits the `retry_after` seconds Getlead returns and retries.

## Installation

Requires **n8n 2.x** (self-hosted), which runs on **Node.js 24**.

### Once published to npm

In n8n: **Settings → Community Nodes → Install**, enter `n8n-nodes-getlead`, and confirm. See n8n's [community nodes guide](https://docs.n8n.io/integrations/community-nodes/installation/).

### Until then: manual install

```bash
git clone https://github.com/vijaygetlead-developer/n8n-nodes-getlead.git
cd n8n-nodes-getlead
npm install
npm run build

# link the package into n8n's custom nodes folder
mkdir -p ~/.n8n/custom/node_modules
ln -s "$(pwd)" ~/.n8n/custom/node_modules/n8n-nodes-getlead

n8n start
```

Restart n8n after every `npm run build`. The nodes then appear when you search **Getlead** in the node panel.

## Credentials

The node authenticates with a **Getlead API key** (starts with `ik_`).

1. In **Getlead CRM**, go to **Settings → All Integrations → API Integration → API Keys** and create or copy a key.
2. In **n8n**, go to **Credentials → Create credential → Getlead API** and paste the key.
3. **Save.** n8n tests the key against `GET /meta` and shows *Connection tested successfully*.

Leave **Base URL** at its default unless you are pointing at a staging environment.

## Usage

**Example: website form → Getlead**

```
Webhook (form submission) → Getlead: Create or Update → Getlead: Add Note
```

1. **Webhook** receives `name`, `phone`, `email` and `message`.
2. **Getlead → Create or update a lead**
   - Match On: *Phone Number*, Phone Number: `{{ $json.body.phone }}`
   - Name: `{{ $json.body.name }}`, Additional Fields → Email: `{{ $json.body.email }}`, Source: *Website*
3. **Getlead → Add a note to a lead**
   - Find Lead By: *Lead* → By ID: `{{ $json.lead_id }}`
   - Content: `{{ $('Webhook').item.json.body.message }}`

A new person is **created**. If the same person submits again, their lead is **updated**, with no duplicate and no error.

**Other ideas:** *New Lead* trigger → Slack/Email alert · Facebook Lead Ads → Create or Update · Google Sheets row → Create or Update · Schedule → Find (status = New) → daily summary.

## Operations

### Getlead Trigger

| Event | Behaviour |
| --- | --- |
| **New Lead** | Polls `GET /leads` (sorted by `created_at`) and emits each lead created since the last poll. Optional filters: source, status. On activation it only records the newest lead and never replays existing ones. *Fetch Test Event* returns the most recent lead. |

### Getlead

| Resource | Operation | What it does | API |
| --- | --- | --- | --- |
| Lead | **Create** | Creates a lead. Phone number (E.164, e.g. `+919876543210`) is required. | `POST /leads` |
| Lead | **Update** | Updates a lead picked from the list or by ID. Only the fields you set are changed. | `PATCH /leads/{id}` |
| Lead | **Create or Update** | Updates the lead matching a phone number or email, or creates it if none exists. | `PATCH /leads/by-identifier`, then `POST /leads` on 404 |
| Lead | **Find** | Searches by name, phone or email; filter by status, source, agent; *Return All* follows pagination. | `GET /leads` |
| Note | **Add** | Adds a note (content + optional title) to a lead found by ID, phone or email. | `POST /leads/{id}/notes`, `POST /leads/by-identifier/notes` |

**Output:** Create returns `lead_id`. Update returns `lead_id` and `updated: true`. Create or Update returns `lead_id` and `action: "created"` or `"updated"`. Find returns one item per lead. Add Note returns `note_id`.

**Two kinds of notes:** *Additional Fields → Notes* sets the lead's single notes field, shown under Basic Information and overwritten each time. **Add Note** adds a separate entry to the lead's **Notes** tab and never overwrites.

## Custom fields

Custom fields are loaded live from `GET /meta`, so new fields added in Getlead show up in n8n automatically.

- **Custom Fields:** click *Add custom field to send* and pick a field. Select fields show a dropdown with the labels; the stored value is sent (e.g. "25000" → `_25000`). Values coming from expressions, e.g. a form sending "KOTTAYAM", are mapped to the stored value; unknown values fail with the list of allowed ones.
- **Multi-Select Custom Fields:** multi-select fields (e.g. *hobbies*) live in their own section, because n8n's field mapper has no multi-select input. Pick the field, then tick the values.
- **Dates:** pick with the date picker. Date-only fields are sent as `YYYY-MM-DD`, date & time fields as `YYYY-MM-DDTHH:mm:ss`.

## Development

```bash
npm install
npm run build      # compile TypeScript into dist/
npm run lint       # n8n community-node lint rules
npm run dev        # n8n at http://localhost:5678 with this node loaded (hot reload)
```

```
credentials/GetleadApi.credentials.ts    API key credential, tested against GET /meta
nodes/Getlead/Getlead.node.ts            actions: lead create/update/upsert/find, note add
nodes/Getlead/descriptions.ts            fields shown in the n8n editor
nodes/Getlead/GenericFunctions.ts        API requests (429/5xx retry), pagination, dropdowns, custom field mapping
nodes/GetleadTrigger/GetleadTrigger.node.ts   New Lead polling trigger
```

GitHub Actions runs lint and build on every push to `main`.

**Testing against Getlead (Getlead team):** use the test business's API key, only create leads whose name starts with **ZZ**, and don't delete anything you didn't create.

## License

[MIT](LICENSE.md)
