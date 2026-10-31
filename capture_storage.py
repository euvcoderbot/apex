"""Local-filesystem durability and OS-held cross-language export locking.

The persistent lock file is never unlinked. The OS releases ownership when
its holder exits. All writers must be upgraded together while exports stop.
This is not a distributed lock or a guarantee about network filesystems.
"""
from contextlib import contextmanager
import json
import os
from pathlib import Path
import sys
import tempfile


@contextmanager
def storage_lock(folder):
    folder=Path(folder);folder.mkdir(parents=True,exist_ok=True)
    if (folder/'index.lock').exists():
        raise RuntimeError('Legacy sentinel lock present; verify and stop the old exporter before migration')
    descriptor=os.open(folder/'index.oslock',os.O_RDWR|os.O_CREAT,0o600)
    acquired=False
    try:
        if os.fstat(descriptor).st_size==0:os.write(descriptor,b' ')
        os.lseek(descriptor,0,os.SEEK_SET)
        try:
            if os.name=='nt':
                import msvcrt
                msvcrt.locking(descriptor,msvcrt.LK_NBLCK,1)
            else:
                import fcntl
                fcntl.flock(descriptor,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except OSError as error:
            raise RuntimeError('Another capture is updating the index; retry after it finishes.') from error
        acquired=True
        # Diagnostic only: never use these bytes to decide whether to steal a lock.
        os.lseek(descriptor,1,os.SEEK_SET)
        owner=json.dumps({'pid':os.getpid(),'protocol':'os-held-v1'}).encode()
        os.write(descriptor,owner);os.ftruncate(descriptor,1+len(owner))
        yield
    finally:
        if acquired:
            os.lseek(descriptor,0,os.SEEK_SET)
            if os.name=='nt':
                import msvcrt
                msvcrt.locking(descriptor,msvcrt.LK_UNLCK,1)
            else:
                import fcntl
                fcntl.flock(descriptor,fcntl.LOCK_UN)
        os.close(descriptor)


def sync_directory(folder):
    if os.name=='nt':return  # Portable Python cannot fsync a Windows directory handle.
    descriptor=os.open(folder,os.O_RDONLY|getattr(os,'O_DIRECTORY',0))
    try:os.fsync(descriptor)
    finally:os.close(descriptor)


@contextmanager
def repository_lock(root,extra_folders=()):
    root=Path(root)
    folders=[root/'assets/data'/name for name in ('local-captures','prerendered','local-telemetry','telemetry','events')]
    if any((root/name).exists() for name in ('.sync-prepared.lock','assets/data/.sync-prepared.lock')) or any((Path(folder)/'index.lock').exists() for folder in [*folders,*extra_folders]):
        raise RuntimeError('Legacy sentinel lock present; stop all old exporters before migration')
    with storage_lock(root/'assets/data/local-captures'):yield


def atomic_bytes(target,body):
    target=Path(target)
    descriptor,temporary=tempfile.mkstemp(prefix=target.name+'.',suffix='.tmp',dir=target.parent)
    try:
        with os.fdopen(descriptor,'wb') as stream:
            stream.write(body);stream.flush();os.fsync(stream.fileno())
        os.replace(temporary,target);sync_directory(target.parent)
    finally:
        Path(temporary).unlink(missing_ok=True)


if __name__=='__main__':
    try:
        root=Path(sys.argv[2]).resolve() if len(sys.argv)>2 else None
        with repository_lock(root) if root else storage_lock(sys.argv[1]):
            print('LOCKED',flush=True)
            # The holder performs commits, not the Node parent. If this helper
            # dies, its parent cannot publish an index after losing ownership.
            for line in sys.stdin.buffer:
                command=json.loads(line)
                target=Path(command['target']).resolve()
                if not root or not target.is_relative_to(root):raise ValueError('Commit target outside export root')
                body=command['body'].encode('utf-8')
                if len(body)>16*1024*1024:raise ValueError('Index exceeds commit budget')
                atomic_bytes(target,body)
                print(json.dumps({'id':command['id'],'ok':True}),flush=True)
    except (OSError,RuntimeError,ValueError,KeyError) as error:
        print(str(error),file=sys.stderr);raise SystemExit(75)
