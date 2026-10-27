"""Native process snapshots; no signals, ps text, or argv/environment decoding.

Darwin birth keys are (seconds, microseconds); Linux keys are (boot_id, ticks),
preserving the kernel's full clock-tick precision rather than wall-clock time.
Snapshots describe observations, not authority to signal a PID later.
"""
import ctypes
import os
import sys


StartKey = tuple[int, int] | tuple[bytes, int]


class ProcIdentityUnavailable(RuntimeError):
    """Inspection failed or changed mid-read; absence has not been established."""

    def __init__(self, message: str, *, reason: str = "other", uid: int | None = None,
                 ruid: int | None = None):
        super().__init__(message)
        self.reason, self.uid, self.ruid = reason, uid, ruid


class EnvHidden(ProcIdentityUnavailable):
    """The kernel did not expose environment entries (possibly platform protected)."""


class ProcIdentity:
    __slots__ = ("pid", "ppid", "pgid", "uid", "ruid", "start")
    pid: int
    ppid: int
    pgid: int
    uid: int
    ruid: int
    start: StartKey

    def __init__(self, pid: int, ppid: int, pgid: int, uid: int, ruid: int, start: StartKey):
        self.pid, self.ppid, self.pgid = pid, ppid, pgid
        self.uid, self.ruid, self.start = uid, ruid, start


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


def _linux_identity(pid: int) -> ProcIdentity:
    path = f"/proc/{pid}"
    stat = _read(path + "/stat")
    fields = stat[stat.rindex(b")") + 2:].split()
    uid, ruid = _linux_uids(pid)
    try:
        boot = _read("/proc/sys/kernel/random/boot_id").strip()
    except OSError as error:
        raise ProcIdentityUnavailable("cannot read Linux boot identity") from error
    after = _read(path + "/stat")
    if stat[:stat.index(b" ")] != str(pid).encode() or not boot:
        raise ValueError("invalid procfs identity")
    if fields[19] != after[after.rindex(b")") + 2:].split()[19]:
        raise ProcIdentityUnavailable(f"PID {pid} changed during identity read")
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
            count = _libproc.proc_pidinfo(pid, 13, 0, ctypes.byref(info), ctypes.sizeof(info))
            if count == ctypes.sizeof(info) and info.pbsi_pid == pid:
                return info.pbsi_uid, info.pbsi_ruid
    except (OSError, ValueError, IndexError, StopIteration):
        pass
    return None, None


def identity(pid: int) -> ProcIdentity | None:
    """Return metadata, None only for gone PIDs, or a typed inspection failure."""
    if not isinstance(pid, int) or not 0 < pid <= 2**31 - 1:
        raise ValueError("pid must be a positive signed 32-bit integer")
    try:
        if sys.platform == "linux":
            return _linux_identity(pid)
        if sys.platform != "darwin":
            raise ProcIdentityUnavailable("unsupported platform")
        info = _ProcBsdInfo()
        ctypes.set_errno(0)
        count = _libproc.proc_pidinfo(pid, 3, 0, ctypes.byref(info), ctypes.sizeof(info))
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


def _darwin_args(pid: int) -> tuple[list[bytes], list[bytes]]:
    # KERN_ARGMAX bounds the response even when exec changes argv between calls.
    argmax, size = ctypes.c_int(), ctypes.c_size_t(ctypes.sizeof(ctypes.c_int))
    mib = (ctypes.c_int * 2)(1, 8)  # CTL_KERN, KERN_ARGMAX
    if _libc.sysctl(mib, 2, ctypes.byref(argmax), ctypes.byref(size), None, 0) != 0:
        raise _native_error()
    if argmax.value <= 0:
        raise ValueError("invalid KERN_ARGMAX")
    buffer = ctypes.create_string_buffer(argmax.value)
    size = ctypes.c_size_t(ctypes.sizeof(buffer))
    mib = (ctypes.c_int * 3)(1, 49, pid)  # CTL_KERN, KERN_PROCARGS2, pid
    if _libc.sysctl(mib, 3, buffer, ctypes.byref(size), None, 0) != 0:
        raise _native_error()
    data = buffer.raw[:size.value]
    argc = int.from_bytes(data[:4], sys.byteorder, signed=True)
    if len(data) < 4 or argc < 1:
        raise ValueError("missing argc")
    offset = data.index(b"\0", 4) + 1  # exec path, then alignment padding
    while offset < len(data) and data[offset] == 0:
        offset += 1
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
    return arguments, entries


def _entries(pid: int, environment: bool) -> list[bytes] | None:
    before = identity(pid)
    if before is None:
        return None
    if (before.uid, before.ruid) != (os.geteuid(), os.getuid()):
        raise ProcIdentityUnavailable(f"PID {pid} has another UID")
    try:
        if sys.platform == "darwin":
            args, env = _darwin_args(pid)
            entries = env if environment else args
        else:
            data = _read(f"/proc/{pid}/{'environ' if environment else 'cmdline'}")
            if data and not data.endswith(b"\0"):
                raise ValueError("unterminated procfs entries")
            entries = data[:-1].split(b"\0") if data else []
    except (FileNotFoundError, ProcessLookupError):
        if identity(pid) is None:
            return None
        raise ProcIdentityUnavailable(f"PID {pid} entries disappeared") from None
    except (OSError, ValueError) as error:
        if environment and sys.platform == "darwin" and isinstance(error, PermissionError):
            raise EnvHidden(f"PID {pid} environment access denied", reason="permission",
                            uid=before.uid, ruid=before.ruid) from error
        raise ProcIdentityUnavailable(f"cannot read PID {pid} entries") from error
    after = identity(pid)
    if after is None:
        return None
    if (before.start, before.uid, before.ruid) != (after.start, after.uid, after.ruid):
        raise ProcIdentityUnavailable(f"PID {pid} changed during entry read")
    if environment and sys.platform == "darwin" and not entries:
        raise EnvHidden(f"PID {pid} environment is not exposed")
    return entries


def environ(pid: int) -> dict[bytes, bytes] | None:
    """Exact byte entries; Darwin's hidden/indistinguishably empty env raises EnvHidden."""
    entries = _entries(pid, True)
    return None if entries is None else dict(entry.split(b"=", 1) for entry in entries if b"=" in entry)


def argv(pid: int) -> list[bytes] | None:
    """NUL-delimited arguments, preserving empty arguments and arbitrary bytes."""
    return _entries(pid, False)


def has_env(pid: int, name: bytes, value: bytes) -> bool:
    """Match a whole environment entry; hidden/failed reads raise, gone returns False."""
    if not isinstance(name, bytes) or not isinstance(value, bytes):
        raise TypeError("environment name and value must be bytes")
    if not name or b"=" in name or b"\0" in name or b"\0" in value:
        raise ValueError("invalid environment name or value")
    entries = _entries(pid, True)
    return entries is not None and name + b"=" + value in entries


class ChildrenSnapshot(dict[int, tuple[int, int, StartKey]]):
    """Partial edges plus explicit failures; unknown/same-UID failures leave coverage unverified."""

    def __init__(self):
        super().__init__()
        self.unavailable: dict[int, ProcIdentityUnavailable] = {}


def children_snapshot() -> ChildrenSnapshot:
    """One enumeration, one identity per PID; each PID is in exactly one map.

    Unavailable records carry reason (permission/gone/other), uid and ruid. UID
    hints are independent observations, without a verified birth key. Callers
    must inspect unavailable, including when the edges dict is empty/falsy.
    """
    result = ChildrenSnapshot()
    for pid in list_pids():
        try:
            observed = identity(pid)
        except ProcIdentityUnavailable as error:
            result.unavailable[pid] = error
        else:
            if observed is None:
                result.unavailable[pid] = ProcIdentityUnavailable("process vanished", reason="gone")
                continue
            result[pid] = (observed.ppid, observed.pgid, observed.start)
    return result
