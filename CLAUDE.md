# HelioDX

For any UI work, read design/CLAUDE.md first. For agent console work, read design/agent-console/CLAUDE.md first.

- `web/`: the web client (React + Vite), cards W1–W11. `npm --prefix web run dev`; `npm run build:web` builds it into `dist/` for Hosting.
- `types/`, `utils/`: shared by web and functions.
- `functions/`: Cloud Functions, rules tests under `functions/test/rules`.
- Public repository: never commit keys, project ids, numbers, regions or bucket names beyond what is already in config.
