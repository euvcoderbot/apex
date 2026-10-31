# Local storage and request hardening review

These changes are isolated in the local review checkout. They have not updated
the installed PC scheduler, another Claude checkout, GitHub or the hosted site.

## Storage protocol

Node capture, prerender and synchronization writers and Python export writers
now share one repository-wide OS-held lock (`assets/data/local-captures/index.oslock`),
including commits to the telemetry, prerender and calendar manifests. Node
keeps a Python stdlib helper's input pipe open; the helper itself commits each
index and acknowledges completion. Killing that helper prevents its parent
from continuing to commit without ownership. Python uses `msvcrt.locking` on Windows
and `fcntl.flock` on POSIX. Exiting owners release the lock; file age is never
used to steal ownership. Diagnostic PID bytes are not an ownership test.

Payloads are content-addressed and written before their index reference. Writes
use unique same-directory temporary files, flush and fsync before atomic rename.
POSIX additionally syncs the directory. Portable Python/Node implementations do
not promise Windows directory durability or survival of every power-loss mode.
Network/distributed filesystems are not validated by these local tests.

Both languages retain the newer capture when an older computation finishes late.
Telemetry exporters reread and merge the latest manifest under the lock, rather
than overwriting a concurrent writer's newly added entries with a stale copy.

### Rollout requirement

Stop all old export/sync writers before upgrading every writer to this protocol.
Never run legacy sentinel-lock writers concurrently with OS-held-lock writers.
An existing `index.lock` causes an explicit refusal: verify the old owner has
stopped before manually resolving that sentinel. No automatic stale-lock removal
or destructive migration has been installed on the user's PC.

The Node helper needs Python (APEX_LOCK_PYTHON, APEX_PYTHON, the project virtual
environment, or Python on PATH). Missing helpers fail closed before index writes.

## Request budgets

Python and web request parsing enforce streamed byte budgets, 64-level JSON
nesting limits and 15-second body-read deadlines. Encoded/compressed bodies are
rejected rather than decompressed without a budget. Python also rejects NaN,
Infinity and floating-point overflow in incoming JSON. Quoted brackets do not
count as structural nesting. HTTP 408, 413 and 415 remain distinct failures.

The local API additionally checks loopback Host, Origin and browser Fetch
Metadata before dispatching compute. Approved hosted and loopback origins remain
usable; cross-site browser triggers are refused. This is not authentication and
does not protect against malicious programs already running as the PC user.

## Exercised failure paths

- Real Python owner termination, with an artificially old lock-file timestamp.
- Real Node-parent termination and automatic helper EOF/lock release.
- Python and Node contention on the same lock protocol.
- Injected ENOSPC/fsync/replace failures and interruption before index replacement.
- Preservation of the previous complete index and safe later retry.
- Refusal to delete or steal a legacy sentinel.
- Older Python and Node captures cannot replace a newer timestamp.
- Excessive nesting, quoted brackets, non-finite numbers, compressed bodies,
  stalled body reads and untrusted browser request contexts.

Windows tests passed. Actual POSIX execution remains unverified here; the user
asked to keep this branch local, so no Linux CI PR has been opened. This document
is not a full-site audit completion or production deployment sign-off.
