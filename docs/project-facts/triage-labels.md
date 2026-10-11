# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual
label strings used in Linear, this repo's one store for issues (see `linear.md`).

| Label the skills use       | Label in Linear      | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label
string from this table.

## Linear label ids

Created workspace-scoped on 31 August 2026, so they apply across teams.

| Label | Id |
| --- | --- |
| `needs-triage` | `6e276778-2b87-46d2-b7a7-655c009a9a4d` |
| `needs-info` | `a8defb88-ce0d-4931-bedc-3a194fa9767f` |
| `ready-for-agent` | `e29d5384-2c71-4e61-82e5-26a3da19d6ed` |
| `ready-for-human` | `f668ed36-b473-4cfc-8118-a9fc2fde94b6` |
| `wontfix` | `0a5c7c20-7d22-4ae7-9695-6f94bf284c95` |

Apply one with `issueAddLabel`, not `issueUpdate`: `issueUpdate` with `labelIds` replaces the
whole set. See `linear.md`.
