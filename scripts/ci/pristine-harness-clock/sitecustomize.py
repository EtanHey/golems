"""Freeze the ledger clock in pristine hook subprocesses; no output filtering."""

import datetime


class FrozenDateTime(datetime.datetime):
    @classmethod
    def now(cls, tz=None):
        instant = cls(2026, 1, 1, 0, 0, 0, tzinfo=datetime.timezone.utc)
        return instant if tz is None else instant.astimezone(tz)


datetime.datetime = FrozenDateTime
