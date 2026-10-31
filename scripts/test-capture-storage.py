"""Real cross-process locking and injected I/O failures, using disposable data."""
import errno
import json
import os
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import time
import signal
import unittest
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from capture_storage import storage_lock,atomic_bytes


class StorageTests(unittest.TestCase):
    def test_python_owner_death_releases_os_lock_and_preserves_index(self):
        with TemporaryDirectory() as directory:
            target=Path(directory)/'index.json';atomic_bytes(target,b'{"version":1}')
            owner=subprocess.Popen([sys.executable,str(ROOT/'capture_storage.py'),directory],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
            try:
                self.assertEqual(owner.stdout.readline().strip(),b'LOCKED')
                os.utime(Path(directory)/'index.oslock',(1,1))
                with self.assertRaisesRegex(RuntimeError,'Another capture'):
                    with storage_lock(directory):pass
                # A Windows venv executable can be a launcher. Terminate the
                # actual holder, not merely its launcher process.
                with open(Path(directory)/'index.oslock','rb') as stream:
                    stream.seek(1);holder=json.loads(stream.read())['pid']
                os.kill(holder,signal.SIGTERM);owner.wait(timeout=5)
                deadline=time.monotonic()+5
                while True:
                    try:
                        with storage_lock(directory):self.assertEqual(json.loads(target.read_bytes()),{'version':1})
                        break
                    except RuntimeError:
                        if time.monotonic()>deadline:raise
                        time.sleep(.05)
                self.assertTrue((Path(directory)/'index.oslock').exists())
            finally:
                if owner.poll() is None:owner.kill();owner.wait(timeout=5)
                for stream in (owner.stdin,owner.stdout,owner.stderr):stream.close()

    def test_node_parent_death_releases_python_held_lock(self):
        with TemporaryDirectory() as directory:
            script="import {captureLock} from './lib/atomic-json.mjs';await captureLock(process.argv[1],async()=>{process.stdout.write('READY\\n');await new Promise(()=>{});});"
            env={**os.environ,'APEX_LOCK_PYTHON':sys.executable}
            owner=subprocess.Popen(['node','--input-type=module','-e',script,directory],cwd=ROOT,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
            folder=Path(directory)/'assets/data/local-captures'
            try:
                self.assertEqual(owner.stdout.readline().strip(),b'READY')
                with self.assertRaisesRegex(RuntimeError,'Another capture'):
                    with storage_lock(folder):pass
                owner.kill();owner.wait(timeout=5)
                deadline=time.monotonic()+5
                while True:
                    try:
                        with storage_lock(folder):break
                    except RuntimeError:
                        if time.monotonic()>deadline:raise
                        time.sleep(.05)
            finally:
                if owner.poll() is None:owner.kill();owner.wait(timeout=5)
                owner.stdout.close();owner.stderr.close()

    def test_disk_full_and_sync_failure_preserve_complete_index(self):
        with TemporaryDirectory() as directory:
            target=Path(directory)/'index.json';atomic_bytes(target,b'{"version":1}')
            for operation in ('os.fsync','os.replace'):
                with patch(operation,side_effect=OSError(errno.ENOSPC,'simulated disk full')):
                    with self.assertRaises(OSError):atomic_bytes(target,b'{"version":2}')
                self.assertEqual(json.loads(target.read_bytes()),{'version':1})
            (Path(directory)/'index.json.interrupted.tmp').write_bytes(b'{invalid')
            atomic_bytes(target,b'{"version":3}')
            self.assertEqual(json.loads(target.read_bytes()),{'version':3})

    def test_legacy_lock_is_never_deleted_or_stolen(self):
        with TemporaryDirectory() as directory:
            sentinel=Path(directory)/'index.lock';sentinel.write_text('old owner')
            with self.assertRaisesRegex(RuntimeError,'Legacy sentinel'):
                with storage_lock(directory):pass
            self.assertEqual(sentinel.read_text(),'old owner')

    def test_kill_between_flush_and_replace_keeps_previous_index(self):
        with TemporaryDirectory() as directory:
            target=Path(directory)/'index.json';atomic_bytes(target,b'{"version":1}')
            script="import capture_storage as s,sys,time,os; s.os.replace=lambda *args:(print('STAGED '+str(os.getpid()),flush=True),time.sleep(60)); s.atomic_bytes(sys.argv[1],b'{\"version\":2}')"
            owner=subprocess.Popen([sys.executable,'-c',script,str(target)],cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
            try:
                ready=owner.stdout.readline().decode().split()
                self.assertEqual(ready[0],'STAGED')
                os.kill(int(ready[1]),signal.SIGTERM);owner.wait(timeout=5)
                self.assertEqual(json.loads(target.read_bytes()),{'version':1})
                atomic_bytes(target,b'{"version":3}')
                self.assertEqual(json.loads(target.read_bytes()),{'version':3})
            finally:
                if owner.poll() is None:owner.kill();owner.wait(timeout=5)
                owner.stdout.close();owner.stderr.close()

if __name__=='__main__':unittest.main()
