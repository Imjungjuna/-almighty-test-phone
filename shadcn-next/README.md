# 전능아이티 테스트폰 이력관리

사내망에서 테스트폰 대여 현황을 공유하는 Next.js 앱. 데이터는 서버 맥의 SQLite 파일에 저장된다.

## 접속

- iPad/폰/PC (같은 사내 Wi-Fi): `http://ljhs-MacBook-Pro.local:3100`
- `.local`이 안 잡히면 서버 맥의 IP로 `http://<IP>:3100`. 고정이 필요하면 인프라에 DHCP 예약 요청 (Wi-Fi MAC은 서버 맥의 `ifconfig en0 | grep ether`).
- iPad: Safari 공유 → 홈 화면에 추가.

## 서버 실행 (처음 한 번)

서버 맥에서 실행한다. 포트는 `ecosystem.config.cjs`의 `PORT`(3100)로 정해진다.

### macOS 권한(TCC) 주의

재부팅 후 pm2/launchd가 띄운 프로세스는 `~/Desktop`·`~/Documents`·`~/Downloads` 아래 파일을 읽지 못한다("Operation not permitted"). 둘 중 하나를 한다.

- 권장: 서버용 체크아웃을 Desktop/Documents/Downloads 밖에 둔다.

  ```bash
  cd /Users/ljh/Desktop/work/almighty-test-phone
  git switch main            # free the `server` branch for the worktree
  git worktree add ~/test-phone-server server
  cd ~/test-phone-server/shadcn-next
  npm install && npm run build
  ```

  이후 모든 pm2 명령은 `~/test-phone-server/shadcn-next`에서 실행한다.
- 대안: 시스템 설정 → 개인정보 보호 및 보안 → 전체 디스크 접근 권한에 `$(which node)` 경로의 node를 추가한다.

설정을 마친 뒤 실제로 재부팅해 서버가 자동으로 뜨는지 반드시 확인한다.

### pm2 등록

`~/test-phone-server/shadcn-next`(권장 구성) 기준:

```bash
npm install -g pm2            # pm2가 없을 때만
pm2 start ecosystem.config.cjs
pm2 startup                   # 출력되는 sudo 명령을 복사해 실행
pm2 save
```

macOS 방화벽이 node 수신 허용을 물으면 허용한다.

## 코드 갱신

```bash
cd ~/test-phone-server && git pull   # 또는 로컬에서 merge
cd shadcn-next
npm install
npm run build
pm2 restart test-phone
```

## 데이터·백업

- DB: `~/test-phone-data/test-phone.db` (`TEST_PHONE_DB_PATH`로 변경 가능)
- 환경변수: `TEST_PHONE_DB_PATH`는 DB 파일 경로(앱·백업 스크립트 공통), `TEST_PHONE_DATA_DIR`은 백업 스크립트의 기준 폴더(기본 `~/test-phone-data`, 백업은 그 아래 `backup/`, `TEST_PHONE_DB_PATH`가 없을 때 DB도 그 아래 `test-phone.db`).
- 백업: 매일 04:00 `~/test-phone-data/backup/`에 7일 보관. launchd는 Desktop 아래 스크립트를 실행할 수 없으므로(TCC) 스크립트를 데이터 폴더로 복사해 설치한다. `shadcn-next` 디렉터리에서:

```bash
mkdir -p ~/test-phone-data
install -m 755 scripts/backup-db.sh ~/test-phone-data/backup-db.sh
sed "s#__DATA_DIR__#$HOME/test-phone-data#" docs/ops/com.cashdoc.test-phone-backup.plist > ~/Library/LaunchAgents/com.cashdoc.test-phone-backup.plist
launchctl load ~/Library/LaunchAgents/com.cashdoc.test-phone-backup.plist
```

백업 스크립트를 수정했다면 install 줄을 다시 실행한다.

동작 확인: `launchctl start com.cashdoc.test-phone-backup && ls ~/test-phone-data/backup`

## 개발

```bash
TEST_PHONE_DB_PATH=/tmp/tp-dev.db npm run dev
npm test
npm run lint
```

## 되돌리기 (옛 localStorage 버전으로)

- `main` 브랜치가 Vercel에 그대로 배포돼 있다. iPad에서 Vercel 주소를 홈 화면에 다시 추가하면 끝.
- 서버는 `pm2 stop test-phone`으로 멈춘다. DB 파일은 남아 있으므로 다시 켜면 복귀한다.
- 대여자 명단은 두 버전이 공유하지 않는다. 되돌린 뒤에는 옛 버전에 남아 있던 명단을 쓴다.
- Vercel 프로젝트의 Root Directory가 `shadcn-next`인지 대시보드에서 확인 (그래야 `vercel.json`이 적용됨).

## 제약

- 인증 없음. 사내망 누구나 조작 가능.
- 서버 맥이 덮개 닫힘·전원 분리·재부팅 후 로그인 전이면 중단. 데이터는 보존.
- Node 메이저 버전을 바꾸면 `npm rebuild better-sqlite3` 후 다시 빌드·재시작.
- Wi-Fi 클라이언트 격리(AP isolation)가 켜진 망에서는 접속 불가.
