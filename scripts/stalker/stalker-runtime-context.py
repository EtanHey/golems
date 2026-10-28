"""Unwired context projection: success never authorizes admission or recording."""
import argparse
import json
from os import getuid
from pathlib import Path
from pwd import getpwuid
import re
import sys


class Invalid(ValueError):
    pass


class AccountError(OSError):
    pass


def canonical_db() -> Path:
    """Project one account-scoped path without opening or creating state."""
    try:
        home = getpwuid(getuid()).pw_dir
        if not isinstance(home, str) or '\x00' in home or not Path(home).is_absolute():
            raise ValueError
        return Path(home).resolve() / '.local/state/golems/stalker/admission.sqlite3'
    except (KeyError, OSError, ValueError, TypeError, RuntimeError, AttributeError):
        raise AccountError('ACCOUNT_ERROR') from None


def capture_identity(platform, channel, metadata) -> dict:
    """Validate supplied live metadata; this does not authenticate the extractor."""
    if (not isinstance(platform, str) or platform not in ('twitch', 'youtube')
            or not isinstance(channel, str) or not re.fullmatch(r'[A-Za-z0-9_]+', channel)
            or not isinstance(metadata, dict)):
        raise Invalid('INVALID_IDENTITY')
    channel = channel.lower()
    if (metadata.get('_type', 'video') != 'video' or 'entries' in metadata
            or metadata.get('is_live') is not True or metadata.get('live_status') != 'is_live'):
        raise Invalid('INVALID_IDENTITY')
    broadcast = metadata.get('id')
    extractor = 'TwitchStream' if platform == 'twitch' else 'Youtube'
    if metadata.get('extractor_key') != extractor or not isinstance(broadcast, str):
        raise Invalid('INVALID_IDENTITY')
    if platform == 'twitch':
        if (not re.fullmatch(r'[0-9]+', broadcast) or not broadcast.strip('0') or broadcast == channel
                or any(not isinstance(metadata.get(k), str) or metadata[k].lower() != channel
                       for k in ('display_id', 'uploader_id'))):
            raise Invalid('INVALID_IDENTITY')
        url = 'https://www.twitch.tv/' + channel
    else:
        handle = metadata.get('uploader_id')
        if (not re.fullmatch(r'[A-Za-z0-9_-]{11}', broadcast)
                or not isinstance(handle, str) or handle.lower() != '@' + channel):
            raise Invalid('INVALID_IDENTITY')
        url = 'https://www.youtube.com/watch?v=' + broadcast
    return dict(platform=platform, channel=channel, broadcastId=broadcast, captureUrl=url)


def result(reason, **fields):
    return dict(contextVersion=1, authorized=False, reason=reason, **fields)


class Parser(argparse.ArgumentParser):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **(kwargs | dict(add_help=False, allow_abbrev=False)))

    def error(self, message):
        raise Invalid('INVALID_ARGUMENTS')


def main():
    try:
        parser = Parser(description=__doc__)
        commands = parser.add_subparsers(dest='action', required=True, parser_class=Parser)
        command = commands.add_parser('prepare-capture')
        command.add_argument('--platform', choices=('twitch', 'youtube'), required=True)
        command.add_argument('--channel', required=True)
        command.add_argument('--metadata', required=True)
        args = parser.parse_args()
        try:
            raw = Path(args.metadata).read_text(encoding='utf-8')
        except UnicodeError:
            raise Invalid('INVALID_JSON') from None
        except (OSError, ValueError):
            print(json.dumps(result('METADATA_IO')), file=sys.stderr)
            return 73
        try:
            metadata = json.loads(raw)
        except (ValueError, RecursionError):
            raise Invalid('INVALID_JSON') from None
        identity = capture_identity(args.platform, args.channel, metadata)
        receipt = result('CONTEXT_ONLY', canonicalDb=str(canonical_db()), identity=identity, coverageStatus='unknown')
        code = 0
    except Invalid as error:
        code, receipt = 64, result(str(error))
    except AccountError:
        code, receipt = 73, result('ACCOUNT_ERROR')
    print(json.dumps(receipt), file=sys.stderr if code else sys.stdout)
    return code


if __name__ == '__main__':
    sys.exit(main())
