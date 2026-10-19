# EviStreams — research frontend

A compact web interface for the extraction workflow in the
[EviStreams paper](https://arxiv.org/abs/2609.27418).

This release is based on **11 July 2026**, source commit
`1e068da10ff8b56f3dd6c34ce007374e071c562e` (the latest available frontend commit
before 25 July 2026). Release preparation on 19 October removed unrelated pages
and replaced the marketing page with a simple entry screen. This is the public
historical research version; the hosted application has continued to evolve.

## Start

Use Node.js 20 or later and start the
[matching backend](https://github.com/karthik-strikes/evistream_backend) first.

```bash
npm ci
cp .env.local.example .env.local
npm run dev
```

Open `http://localhost:3000`, register your own accounts, and create a project.
`NEXT_PUBLIC_API_URL` defaults to `http://localhost:8001`; API requests are proxied
through Next.js. All storage and model credentials belong in the backend.

For a production build:

```bash
npm run build
npm start
```

## Included workflow

- Projects, team membership, and PDF uploads.
- Structured form builder, extraction plan approval, and pilot refinement.
- AI extraction, job progress, source passages, and PDF evidence inspection.
- Independent reviewer entry, conflict adjudication, and final dataset export.

The shared hosted demo is not provisioned by this checkout; `/demo` sends local
users to sign in. Admin, usage dashboards, chat, and unrelated pages are omitted.
The interface uses system fonts, so building it does not fetch Google Fonts.

License: [Apache-2.0](LICENSE). See [RELEASE_NOTES.md](RELEASE_NOTES.md).
