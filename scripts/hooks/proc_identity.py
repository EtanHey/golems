"""Native process observations; no signals or argv/environment decoding.

Darwin birth keys are (seconds, microseconds); Linux keys are (boot_id, ticks).
A birth key is meaningful with its PID, not globally unique across PIDs.
EnvHidden and any ProcIdentityUnavailable mean UNKNOWN: never "not ours",
never grounds for cleanup=ok while an in-scope PID is unknown. Catch the base
class on both platforms. An audit on this Mac observed ~338/762 own-user
processes hiding env (2026-10-27, historical, not a current census): decide
ownership by captured ancestry first, scoped to the suite's observed children.

On macOS the argv/env region is process-writable: an env match is evidence,
NOT sole kill authority. Corroborate with kernel-side lineage: pgid membership
seen while the leader incarnation was alive, or an observed ppid chain with
matching birth keys to the suite's child, born after suite start. Call
same_process immediately before every signal; re-snapshot after TERM before
KILL. Darwin has no pidfd: a residual pid-reuse gap remains between checking
and signaling. On Linux use pinned_process and signal.pidfd_send_signal with
its retained pidfd; a later os.kill(pid) would reopen that gap. If pidfd is
unavailable, pinned_process raises rather than promise a safe numeric-PID signal.
"""
from __future__ import annotations

import ctypes
import os
import sys
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Tuple, Union


StartKey = Union[Tuple[int, int], Tuple[bytes, int]]
# SDK sys/proc_info.h and sys/sysctl.h (fixed-width layouts below).
PROC_PIDTBSDINFO = 3
PROC_PIDT_SHORTBSDINFO = 13
CTL_KERN = 1
KERN_ARGMAX = 8
KERN_PROCARGS2 = 49


class ProcIdentityUnavailable(RuntimeError):
    """Inspection failed or changed mid-read; absence has not been established."""

    def __init__(self, message: str, *, reason: str = "other", uid: int | None = None,
                 ruid: int | None = None):
        super().__init__(message)
        self.reason, self.uid, self.ruid = reason, uid, ruid


class EnvHidden(ProcIdentityUnavailable):
    """The kernel did not expose environment entries (possibly platform protected)."""


@dataclass(frozen=True)
class ProcIdentity:
    pid: int
    ppid: int
    pgid: int
    uid: int
    ruid: int
    start: StartKey

    @property
    def key(self) -> tuple[int, StartKey, int, int]:
        return self.pid, self.start, self.uid, self.ruid


@dataclass(frozen=True)
class Unknown:
    """Ownership could not be verified; never coerces to not-ours/cleanup=ok."""
    reason: str
    uid: int | None = None
    ruid: int | None = None

    def __bool__(self):
        raise TypeError("UNKNOWN ownership must be handled explicitly")


class _ProcBsdInfo(ctypes.Structure):
    # SDK sys/proc_info.h: MAXCOMLEN=16, sizeof(struct proc_bsdinfo)=136.
    _fields_ = [(name, ctypes.c_uint32) for name in (
        "pbi_flags", "pbi_status", "pbi_xstatus", "pbi_pid", "pbi_ppid",
        "pbi_uid", "pbi_gid", "pbi_ruid", "pbi_rgid", "pbi_svuid", "pbi_svgid", "rfu_1",
    )] + [("pbi_comm", ctypes.c_char * 16), ("pbi_name", ctypes.c_char * 32)] + [
        (name, ctypes.c_uint32) for name in
        ("pbi_nfiles", "pbi_pgid", "pbi_pjobc", "e_tdev", "e_tpgid")
    ] + [("pbi_nice", ctypes.c_int32), ("pbi_start_tvsec", ctypes.c_uint64),
         ("pbi_start_tvusec", ctypes.c_uint64)]


assert ctypes.sizeof(_ProcBsdInfo) == 136


class _ProcBsdShortInfo(ctypes.Structure):
    _fields_ = [(name, ctypes.c_uint32) for name in
                ("pbsi_pid", "pbsi_ppid", "pbsi_pgid", "pbsi_status")] + [
        ("pbsi_comm", ctypes.c_char * 16)
    ] + [(name, ctypes.c_uint32) for name in
         ("pbsi_flags", "pbsi_uid", "pbsi_gid", "pbsi_ruid", "pbsi_rgid",
          "pbsi_svuid", "pbsi_svgid", "pbsi_rfu")]


assert ctypes.sizeof(_ProcBsdShortInfo) == 64

if sys.platform == "darwin":
    _libproc = ctypes.CDLL("/usr/lib/libproc.dylib", use_errno=True)
    _libc = ctypes.CDLL(None, use_errno=True)
    _libproc.proc_listallpids.argtypes = [ctypes.c_void_p, ctypes.c_int]
    _libproc.proc_listallpids.restype = ctypes.c_int
    _libproc.proc_pidinfo.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_uint64,
                                    ctypes.c_void_p, ctypes.c_int]
    _libproc.proc_pidinfo.restype = ctypes.c_int
    _libc.sysctl.argtypes = [ctypes.POINTER(ctypes.c_int), ctypes.c_uint,
                           ctypes.c_void_p, ctypes.POINTER(ctypes.c_size_t),
                           ctypes.c_void_p, ctypes.c_size_t]
    _libc.sysctl.restype = ctypes.c_int


def _native_error() -> OSError:
    return OSError(ctypes.get_errno(), "native process inspection failed")


def _read(path: str) -> bytes:
    with open(path, "rb") as stream:
        return stream.read()


def list_pids() -> list[int]:
    """List visible positive PIDs; callers must tolerate exits after enumeration."""
    try:
        if sys.platform == "linux":
            return [int(name) for name in os.listdir("/proc") if name.isdecimal() and int(name) > 0]
        if sys.platform != "darwin":
            raise ProcIdentityUnavailable("unsupported platform")
        count = _libproc.proc_listallpids(None, 0)
        if count <= 0:
            raise _native_error()
        capacity = max(1024, count + 128)
        for _ in range(4):
            buffer = (ctypes.c_int * capacity)()
            count = _libproc.proc_listallpids(buffer, ctypes.sizeof(buffer))
            if count <= 0:
                raise _native_error()
            if count < capacity:
                return list(dict.fromkeys(pid for pid in buffer[:count] if pid > 0))
            capacity *= 2
        raise ProcIdentityUnavailable("PID list kept growing beyond buffer")
    except OSError as error:
        raise ProcIdentityUnavailable("cannot enumerate PIDs") from error


def _linux_identity(pid: int) -> ProcIdentity | None:
    path = f"/proc/{pid}"
    stat = _read(path + "/stat")
    fields = stat[stat.rindex(b")") + 2:].split()
    if fields[0] in (b"Z", b"X", b"x"):
        return None
    uid, ruid = _linux_uids(pid)
    try:
        boot = _read("/proc/sys/kernel/random/boot_id").strip()
    except OSError as error:
        raise ProcIdentityUnavailable("cannot read Linux boot identity", uid=uid, ruid=ruid) from error
    after = _read(path + "/stat")
    if stat[:stat.index(b" ")] != str(pid).encode() or not boot:
        raise ValueError("invalid procfs identity")
    after_fields = after[after.rindex(b")") + 2:].split()
    if after_fields[0] in (b"Z", b"X", b"x"):
        return None
    if fields[19] != after_fields[19]:
        raise ProcIdentityUnavailable(f"PID {pid} changed during identity read",
                                      reason="changed", uid=uid, ruid=ruid)
    return ProcIdentity(pid, int(fields[1]), int(fields[2]), uid, ruid,
                        (boot, int(fields[19])))


def _linux_uids(pid: int) -> tuple[int, int]:
    uids = next(line.split()[1:] for line in _read(f"/proc/{pid}/status").split(b"\n")
                if line.startswith(b"Uid:"))
    return int(uids[1]), int(uids[0])


def _uid_hint(pid: int) -> tuple[int | None, int | None]:
    """Best-effort owner observation, without claiming a birth key or identity."""
    try:
        if sys.platform == "linux":
            return _linux_uids(pid)
        if sys.platform == "darwin":
            info = _ProcBsdShortInfo()
            count = _libproc.proc_pidinfo(pid, PROC_PIDT_SHORTBSDINFO, 0, ctypes.byref(info), ctypes.sizeof(info))
            if count == ctypes.sizeof(info) and info.pbsi_pid == pid:
                return info.pbsi_uid, info.pbsi_ruid
    except (OSError, ValueError, IndexError, StopIteration):
        pass
    return None, None


def identity(pid: int) -> ProcIdentity | None:
    """Return metadata, None only for gone PIDs, or a typed inspection failure."""
    if type(pid) is not int or not 0 < pid <= 2**31 - 1:
        raise ValueError("pid must be a positive signed 32-bit integer")
    try:
        if sys.platform == "linux":
            return _linux_identity(pid)
        if sys.platform != "darwin":
            raise ProcIdentityUnavailable("unsupported platform")
        info = _ProcBsdInfo()
        ctypes.set_errno(0)
        count = _libproc.proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, ctypes.byref(info), ctypes.sizeof(info))
        if count <= 0:
            raise _native_error()
        if count != ctypes.sizeof(info) or info.pbi_pid != pid:
            raise ValueError("short or mismatched proc_bsdinfo")
        return ProcIdentity(pid, info.pbi_ppid, info.pbi_pgid, info.pbi_uid, info.pbi_ruid,
                            (info.pbi_start_tvsec, info.pbi_start_tvusec))
    except (FileNotFoundError, ProcessLookupError):
        return None
    except (OSError, ValueError, IndexError, StopIteration) as error:
        uid, ruid = _uid_hint(pid)
        reason = "permission" if isinstance(error, PermissionError) else "other"
        raise ProcIdentityUnavailable(f"cannot inspect PID {pid}", reason=reason,
                                      uid=uid, ruid=ruid) from error


def _parse_procargs2(data: bytes) -> tuple[list[bytes], list[bytes]]:
    """Pure Darwin layout parser. Unexplained trailing entries mean ambiguity.

    An empty env string ends the scan, indistinguishable from kernel padding.
    Known apple strings may follow padding; other tails cannot certify absence.
    """
    try:
        argc = int.from_bytes(data[:4], sys.byteorder, signed=True)
        if len(data) < 4 or argc < 1:
            raise ValueError("missing argc")
        path_end = data.index(b"\0", 4) + 1
        offset = 4 + ((path_end - 4 + 7) // 8) * 8
        if offset > len(data) or any(data[path_end:offset]):
            raise ValueError("non-NUL exec path alignment padding")
        arguments = []
        for _ in range(argc):
            end = data.index(b"\0", offset)
            arguments.append(data[offset:end])
            offset = end + 1
        entries = []
        while offset < len(data) and data[offset] != 0:
            end = data.index(b"\0", offset)
            entries.append(data[offset:end])
            offset = end + 1
        # Protected binaries can end immediately after argv. Otherwise each
        # apple string must be terminated and recognizable, never env evidence.
        apple_keys = (b"ptr_munge=", b"main_stack=", b"executable_file=",
                      b"dyld_file=", b"executable_cdhash=", b"executable_boothash=", b"th_port=",
                      b"security_config=", b"stack_guard=", b"malloc_entropy=")
        tail = data[offset:]
        if tail and not tail.endswith(b"\0"):
            raise ValueError("unterminated trailing region")
        if any(entry and not entry.startswith(apple_keys) for entry in tail.split(b"\0")):
            raise ValueError("unrecognized entries after env terminator")
        if any(entry.startswith(apple_keys) for entry in entries):
            raise ValueError("apple string crossed environment boundary")
        return arguments, entries
    except (ValueError, IndexError) as error:
        raise ProcIdentityUnavailable("ambiguous PROCARGS2 layout", reason="ambiguous") from error


def _darwin_args(pid: int) -> tuple[list[bytes], list[bytes]]:
    argmax, size = ctypes.c_int(), ctypes.c_size_t(ctypes.sizeof(ctypes.c_int))
    mib = (ctypes.c_int * 2)(CTL_KERN, KERN_ARGMAX)
    if _libc.sysctl(mib, 2, ctypes.byref(argmax), ctypes.byref(size), None, 0) != 0:
        raise _native_error()
    if argmax.value <= 0:
        raise ValueError("invalid KERN_ARGMAX")
    mib = (ctypes.c_int * 3)(CTL_KERN, KERN_PROCARGS2, pid)
    size = ctypes.c_size_t()
    if _libc.sysctl(mib, 3, None, ctypes.byref(size), None, 0) != 0:
        raise _native_error()
    # ARG_MAX excludes the argc header, executable path and extra apple data.
    # Darwin PATH_MAX=1024; reserve more than that plus a page of slack. The
    # size query alone can return ARG_MAX rather than the full copied region.
    slack = 4096
    allocation = max(size.value, 4 + 1024 + argmax.value) + slack
    # XNU sysctl_procargsx rejects buflen > ARG_MAX after subtracting argc.
    # A size query beyond that cap cannot be fetched completely on this kernel.
    limit = argmax.value + 4
    if size.value > limit:
        raise ProcIdentityUnavailable("complete PROCARGS2 response exceeds kernel cap", reason="incomplete")
    capacity = min(limit, size.value + slack)
    for _ in range(4):
        buffer = ctypes.create_string_buffer(max(allocation, capacity))
        size = ctypes.c_size_t(capacity)
        if _libc.sysctl(mib, 3, buffer, ctypes.byref(size), None, 0) != 0:
            error = _native_error()
            if error.errno == 12:  # ENOMEM: concurrent response growth.
                if capacity == limit:
                    break
                capacity = min(limit, capacity * 2)
                continue
            raise error
        if size.value >= capacity - slack:
            if capacity == limit:
                break
            capacity = min(limit, capacity * 2)
            continue
        return _parse_procargs2(buffer.raw[:size.value])
    raise ProcIdentityUnavailable("cannot establish complete PROCARGS2 response", reason="incomplete")


def _linux_env_bounds(pid: int) -> tuple[int, int]:
    stat = _read(f"/proc/{pid}/stat")
    fields = stat[stat.rindex(b")") + 2:].split()
    start, end = int(fields[47]), int(fields[48])  # fields 50/51: env_start/env_end
    if start <= 0 or end <= start:
        raise EnvHidden("kernel environment range not exposed", reason="hidden")
    return start, end


def _recheck(snapshot: ProcIdentity) -> ProcIdentity | None:
    try:
        return identity(snapshot.pid)
    except ProcIdentityUnavailable as error:
        if error.uid is None:
            error.uid = snapshot.uid
        if error.ruid is None:
            error.ruid = snapshot.ruid
        raise


def _entries(pid: int, environment: bool) -> list[bytes] | None:
    before = identity(pid)
    if before is None:
        return None
    if (before.uid, before.ruid) != (os.geteuid(), os.getuid()):
        raise ProcIdentityUnavailable(f"PID {pid} has another UID", reason="other-uid",
                                      uid=before.uid, ruid=before.ruid)
    try:
        if sys.platform == "darwin":
            args, env = _darwin_args(pid)
            entries = env if environment else args
        else:
            bounds = _linux_env_bounds(pid) if environment else None
            data = _read(f"/proc/{pid}/{'environ' if environment else 'cmdline'}")
            if environment and (bounds != _linux_env_bounds(pid) or len(data) != bounds[1] - bounds[0]):
                raise EnvHidden("incomplete Linux environment range", reason="hidden")
            if data and not data.endswith(b"\0"):
                raise ValueError("unterminated procfs entries")
            entries = data[:-1].split(b"\0") if data else []
    except (OSError, ValueError, IndexError, ProcIdentityUnavailable) as error:
        after = _recheck(before)
        if after is None or before.start != after.start:
            return None  # The incarnation being read is gone, including on EINVAL.
        hidden = isinstance(error, EnvHidden) or (environment and isinstance(error, PermissionError))
        reason = ("permission" if isinstance(error, PermissionError) else
                  error.reason if isinstance(error, ProcIdentityUnavailable) else "other")
        failure = EnvHidden if hidden else ProcIdentityUnavailable
        raise failure(f"cannot read PID {pid} entries: {error}", reason=reason,
                      uid=before.uid, ruid=before.ruid) from error
    after = _recheck(before)
    if after is None:
        return None
    if before.key != after.key:
        raise ProcIdentityUnavailable(f"PID {pid} changed during entry read", reason="changed",
                                      uid=after.uid, ruid=after.ruid)
    if environment and not entries:
        raise EnvHidden(f"PID {pid} environment is not exposed", reason="hidden",
                        uid=before.uid, ruid=before.ruid)
    return entries


def environ(pid: int) -> dict[bytes, bytes] | None:
    """First occurrence of each byte name; gone returns None, errors mean UNKNOWN.

    On Darwin an empty env string ends the scan (indistinguishable from kernel
    padding); unexplained trailing entries raise unavailable, never partial env.
    macOS argv/env is process-writable: matches are evidence, NOT sole kill authority.
    Require pgid membership observed while its leader incarnation was alive, or
    an observed ppid chain with matching birth keys to the suite's child, born
    after suite start. EnvHidden/unavailable is UNKNOWN, never not-ours or cleanup=ok.
    """
    entries = _entries(pid, True)
    if entries is None:
        return None
    result = {}
    for entry in entries:
        if b"=" in entry:
            name, value = entry.split(b"=", 1)
            result.setdefault(name, value)
    return result


def argv(pid: int) -> list[bytes] | None:
    """NUL-delimited arguments, preserving empty arguments and arbitrary bytes."""
    return _entries(pid, False)


def _validate_env(name: bytes, value: bytes) -> None:
    if not isinstance(name, bytes) or not isinstance(value, bytes):
        raise TypeError("environment name and value must be bytes")
    if not name or b"=" in name or b"\0" in name or b"\0" in value:
        raise ValueError("invalid environment name or value")


def has_env(pid: int, name: bytes, value: bytes) -> bool:
    """Match the FIRST occurrence; gone returns False; failures raise UNKNOWN.

    macOS argv/env is process-writable: a match is evidence, NOT sole kill authority.
    Require pgid membership observed while its leader incarnation was alive, or
    an observed ppid chain with matching birth keys to the suite's child, born
    after suite start. EnvHidden/unavailable is UNKNOWN, never not-ours or cleanup=ok.
    """
    _validate_env(name, value)
    env = environ(pid)
    return env is not None and env.get(name) == value


def same_process(snapshot: ProcIdentity) -> bool:
    """Recheck pid + birth key + UIDs immediately before a signal; failures raise UNKNOWN."""
    current = _recheck(snapshot)
    return current is not None and current.key == snapshot.key


@contextmanager
def pinned_process(snapshot: ProcIdentity):
    """Retain a Linux pidfd for a caller's later pidfd_send_signal; the context closes it on exit.

    Darwin yields None after a same-process check; its numeric-PID signaling
    retains the residual race documented in the module header. Never signal on
    inspection failure. Opening the handle precedes checking the snapshot key.
    """
    handle = None
    try:
        if sys.platform == "linux":
            if not hasattr(os, "pidfd_open"):
                raise ProcIdentityUnavailable("pidfd_open unavailable", reason="unsupported",
                                              uid=snapshot.uid, ruid=snapshot.ruid)
            try:
                handle = os.pidfd_open(snapshot.pid, 0)
            except OSError as error:
                raise ProcIdentityUnavailable("cannot pin process", reason="pidfd",
                                              uid=snapshot.uid, ruid=snapshot.ruid) from error
        if not same_process(snapshot):
            raise ProcIdentityUnavailable("process changed before pin", reason="changed",
                                          uid=snapshot.uid, ruid=snapshot.ruid)
        yield handle
    finally:
        if handle is not None:
            os.close(handle)


def owned(pid: int, name: bytes, value: bytes) -> Union[bool, Unknown]:
    """Bracket an env match with the same incarnation; Unknown never means not-ours.

    This is marker evidence subject to the module's lineage requirement, not
    permission to kill. For a later Linux signal retain pinned_process(snapshot).
    """
    _validate_env(name, value)
    try:
        before = identity(pid)
        if before is None:
            return False
        with pinned_process(before):
            env = environ(pid)
            if not same_process(before):
                return Unknown("changed", before.uid, before.ruid)
            return env is not None and env.get(name) == value
    except ProcIdentityUnavailable as error:
        return Unknown(error.reason, error.uid, error.ruid)


class ChildrenSnapshot(dict[int, tuple[int, int, StartKey, int, int]]):
    """Partial edges plus explicit failures; unknown/same-UID failures leave coverage unverified."""

    def __bool__(self):
        raise TypeError("inspect entries and unavailable explicitly")

    def __init__(self):
        super().__init__()
        self.unavailable: dict[int, ProcIdentityUnavailable] = {}


def children_snapshot() -> ChildrenSnapshot:
    """One enumeration, one identity per PID; each PID is in exactly one map.

    Unavailable records carry reason (permission/gone/other), uid and ruid. UID
    hints are independent observations, without a verified birth key. Callers
    must inspect unavailable explicitly; truth-value testing always raises.
    Entries are (ppid, pgid, start, uid, ruid).
    """
    result = ChildrenSnapshot()
    for pid in list_pids():
        try:
            observed = identity(pid)
        except ProcIdentityUnavailable as error:
            if error.uid is None or error.ruid is None:
                uid, ruid = _uid_hint(pid)
                if error.uid is None:
                    error.uid = uid
                if error.ruid is None:
                    error.ruid = ruid
            result.unavailable[pid] = error
        else:
            if observed is None:
                result.unavailable[pid] = ProcIdentityUnavailable("process vanished", reason="gone")
                continue
            result[pid] = (observed.ppid, observed.pgid, observed.start, observed.uid, observed.ruid)
    return result
