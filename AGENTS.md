<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Required verification after every change

- After implementing or modifying a feature, review the final diff for correctness, security, privacy, accidental regressions, duplicate logic, and unintended files.
- Run targeted lint checks for every changed source file, then run TypeScript checking and a production build when the change can affect runtime behavior.
- Add or run focused tests when the project has a relevant test harness; otherwise document the manual verification that remains for the user.
- Fix issues found by review or verification before declaring the task complete. Clearly report any pre-existing failures separately.
- Never call live third-party APIs, read `.env`, query real database records, or inspect logs/uploads/backups containing real data during verification unless the user explicitly authorizes it.
