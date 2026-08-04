# NESCIENT / Real Stupidity

Parody AI web app for Pharos Group LLC — gives confidently wrong, sarcastically
berating answers. Styled as a modern "AI assistant," but every answer is
guaranteed incorrect.

Migrated out of `git-pharos/pharosweb` on 2026-08-01 to decouple NESCIENT's
development/deploy cycle from the main marketing site.

## Architecture

```
Browser
  → nescient.html            (this repo, deployed to Cloudflare Pages
                               as nescient.pharosgrpllc.com)
      → css/brand.css, favicon  (loaded from pharosgrpllc.com — shared
                                  brand assets, not duplicated here)
      → Worker fetch()
  → realstupidity.rapid-recipe-413b.workers.dev  (Cloudflare Worker,
                               Git-connected to this repo — see
                               worker/wrangler.toml)
      → Groq API (llama/gpt-oss model, GROQ_API_KEY secret)
```

## Deploy

- **Pages**: this repo is connected to a Cloudflare Pages project
  (`nescient`) with a custom domain of `nescient.pharosgrpllc.com`.
  Push to `main` and Cloudflare auto-deploys — no build step, static
  assets served from repo root.
- **Worker**: also Git-connected to this repo. Push changes to
  `worker/nescient-worker.js` on `main` and Cloudflare auto-deploys the
  `realstupidity` Worker — no manual wrangler or dashboard step needed.

## Shared brand assets

`nescient.html` references `https://pharosgrpllc.com/css/brand.css` and
`https://pharosgrpllc.com/assets/favicon-64.png` directly (cross-origin
`<link>`/`<img>`, no CORS needed) rather than duplicating them here, so
brand updates on the main site apply automatically. If pharosweb's asset
paths ever change, update the references in `nescient.html`.

## CSP

The Cloudflare Transform Rule enforcing CSP on `nescient.pharosgrpllc.com`
needs `connect-src` to allow `realstupidity.rapid-recipe-413b.workers.dev`.
This is a separate Transform Rule from the one covering the main site.
