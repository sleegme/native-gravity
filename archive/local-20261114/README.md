# NTG pre-2.0 consolidated preservation

Created: 2026-11-14
Baseline main commit: `32f0adad3002d70491518fb3ad197de02198da93`
Purpose: preserve seven uploaded local work branch snapshots and their Git histories in a single ref before NTG 2.0 redesign.

## Reading this branch

- The repository **root** is the exact current pre-2.0 `main` code baseline (except this `archive/` directory).
- Each `archive/local-20261114/<folder>/` is the *exact full tree* from one uploaded local work branch, not a patch applied to the current source.
- This consolidation commit has `main` and all seven archived heads as Git parents. Deleting the seven backup branch refs later will not discard their reachable Git history.
- Do **not** merge or deploy the archived trees from this preservation ref as the current implementation. Review/rebase selected changes separately if needed.
- No archived work is silently assumed to be compatible with current `main`.
- `pr15` and `pr26` point to the same file tree but have different commit histories, so both tips are retained.

## Preserved local work

| Folder | Original branch | Commit | Tree | Notes |
| --- | --- | --- | --- | --- |
| [`pr15`](./pr15) | `backup/local-20261114/pr15` | `f2751c02ae0c7ecddbf46ee1b3fd2efe3012a45d` | `dd0a862a0b525983c17372acdf86025f63de82aa` | Original primary Zen completion gate work |
| [`pr15-rebase`](./pr15-rebase) | `backup/local-20261114/pr15-rebase` | `0ce9410e9a2282da3644553da8b4a1cccdedef14` | `f9dd682590428ab6cd42568c4cf8a8d5c17dbca1` | Rebased primary Zen completion gate work |
| [`pr26`](./pr26) | `backup/local-20261114/pr26` | `7b9f2cf32690ed4a2216aef34d9140b1ed7f33d2` | `dd0a862a0b525983c17372acdf86025f63de82aa` | Primary completion gate; same final file tree as pr15 |
| [`pr53`](./pr53) | `backup/local-20261114/pr53` | `049719574c6189d9dc820b5481797009d3a5582e` | `e55ce988d6a94061e5e82f1bb0f3993f9c44e7d2` | Legacy 44D migration docs/role definition work |
| [`pr53-rebase`](./pr53-rebase) | `backup/local-20261114/pr53-rebase` | `88045b507100a35e015b15f6b353fa6698561769` | `1ad6369bc7ffaee7832085c02811a4acfe579c44` | Rebased 44D migration docs/role definition work |
| [`zen-vitest`](./zen-vitest) | `backup/local-20261114/fix/zen-vitest` | `8d48acdb60eef6245855cf8a21f6be5ca6b1cfc1` | `5d9677d66cff4ce65af8132ebdb8e2af946f4447` | Vitest verification guard fix |
| [`44g-92-ledger-lock`](./44g-92-ledger-lock) | `backup/local-20261114/fix/44g-92-ledger-lock` | `e1f5cc72d562f4a8cfa4dd49225e8d7a465d26ec` | `6a8c8bbd1cb6753272b0eb5932168419917ea34f` | Signal forwarding and ledger lock handling fixes |

Archive only; no changes to `main` are made by creating this branch.
