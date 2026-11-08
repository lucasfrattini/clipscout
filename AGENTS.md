# Agent guide: clipscout

Read [docs/SPEC.md](docs/SPEC.md) first, then the matching section of [docs/FEATURES.md](docs/FEATURES.md).

## Change flow (spec-driven)

1. Find or add the requirement in `docs/SPEC.md`.
2. Write the test. 3. Implement the minimum. 4. `npm run check` must pass; bump the version.
3. Update the README (public, in English) if user-visible behaviour changes.

## Commands

```bash
npm run check                  # lint + format + tests
docker compose up -d --build   # front-end files are baked into the image
```

## Rules

- Before redeploying, make sure no search or crawl is running.
- No `innerHTML` in `public/`. Constants belong in `src/config/`. New strings go in both `es.js` and `en.js`.
- Code comments are in Spanish and explain why.
- Everything tracked stays generic: example domains only, no real site names, nothing that hints at what anyone uses it for. `data/` and site extensions stay out of git.
- A protocol change means updating `docs/CREW.md` and all three apps together.
