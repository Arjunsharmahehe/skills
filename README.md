# Agent skills

Skills I publish for coding agents. Install with the [`skills` CLI](https://skills.sh/docs/cli) (works with Claude Code, Cursor, OpenCode, Codex, and more):

```bash
npx skills add <YOUR_GITHUB_USERNAME>/skills --skill <skill-name>
```

> Replace `<YOUR_GITHUB_USERNAME>` with my handle. Check an install resolves first: `npx skills add <YOUR_GITHUB_USERNAME>/skills --skill <skill-name> --list`.

## Skills

| Skill | What it does | Install |
|---|---|---|
| [demo-reel](./demo-reel) | Record client-ready demo videos of web features: the agent drives a real browser with human-like motion, narrates with burned-in captions, and hands back a shareable `proof.mp4`. Chapter-level retakes, error reports with partial footage, no re-recording from scratch. | `npx skills add <YOUR_GITHUB_USERNAME>/skills --skill demo-reel` |

## Adding a skill here

Each skill lives in its own folder with a `SKILL.md` (frontmatter `name` + `description` required), plus optional `references/`, `scripts/`, `assets/`. Keep skills independent — an agent should be able to install any one of them alone.

## License

MIT — see [LICENSE](./LICENSE).
