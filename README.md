# Ecommerce and Social-Commerce Platform

Storefront, admin, AI assistant, social inbox, marketing and giveaway platform for a fashion-accessories store (women's bags, men's wallets, watches, jewelry, accessories), designed to become a multi-tenant SaaS.

**Status:** the shop, checkout (cash on delivery), back office, AI assistant, marketing desk, research and reports are built; launch hardening is in progress. See [PROJECT_STATUS.md](PROJECT_STATUS.md).

## Start here

| If you want to | Read |
| --- | --- |
| Resume work on any computer | [PROJECT_STATUS.md](PROJECT_STATUS.md), then [NEXT_STEPS.md](NEXT_STEPS.md) |
| Understand the business idea and workflows (no code knowledge needed) | [docs/BUSINESS_BLUEPRINT.md](docs/BUSINESS_BLUEPRINT.md) |
| See the full plan from one shop to a platform you sell, and where it stands | [docs/PLATFORM_ROADMAP.md](docs/PLATFORM_ROADMAP.md) |
| Understand scope, phases, risks, backlog | [PROJECT_PLAN.md](PROJECT_PLAN.md) |
| Understand how the system is built | [ARCHITECTURE.md](ARCHITECTURE.md) |
| See what was decided and what is still open | [DECISIONS.md](DECISIONS.md) |
| See the database design | [docs/DATA_MODEL.md](docs/DATA_MODEL.md) |
| See the API plan | [docs/API_SPECIFICATION.md](docs/API_SPECIFICATION.md) |
| See security risks and checklist | [docs/SECURITY_THREAT_MODEL.md](docs/SECURITY_THREAT_MODEL.md) |
| See legal and platform-policy obligations | [docs/COMPLIANCE.md](docs/COMPLIANCE.md) |

## Resuming on another computer

1. Install Git, Node.js 26, pnpm and Docker Desktop.
2. Clone https://github.com/Cizaro/Ecom.
3. Copy `.env.example` to `.env` and fill in values. Never commit `.env`.
4. Follow the commands in [PROJECT_STATUS.md](PROJECT_STATUS.md).

## Working from two computers

The project is built from more than one computer, through GitHub. At the start of every session, on whichever computer:

```
pnpm sync
```

It pulls the latest `main`, installs packages if they changed, adds new settings from `.env.example` to `.env`, starts the local services, and updates the development and test databases. It changes nothing and says why if there are uncommitted changes or both computers changed `main`. At the end of every session, commit and push, so the other computer can pick up the work. Each computer keeps its own local data; only code and database structure travel through GitHub.

Diagrams are written in Mermaid and render on GitHub, in VS Code (with a Mermaid extension) and in most Markdown viewers.
