#!/bin/zsh
set -euo pipefail
DATA_DIR="${TEST_PHONE_DATA_DIR:-$HOME/test-phone-data}"
DB="$DATA_DIR/test-phone.db"
BACKUP_DIR="$DATA_DIR/backup"
mkdir -p "$BACKUP_DIR"
[ -f "$DB" ] || exit 0
STAMP="$(date +%Y%m%d)"
# WAL 내용까지 포함해 일관된 복사본을 만들기 위해 sqlite3 백업 명령 사용
sqlite3 "$DB" ".backup '$BACKUP_DIR/test-phone-$STAMP.db'"
find "$BACKUP_DIR" -name 'test-phone-*.db' -mtime +7 -delete
