# 전능아이티 테스트폰 이력관리

사내망에서 테스트폰 대여 현황을 공유하는 Next.js 앱. 데이터는 서버 맥의 SQLite 파일에 저장된다.

## 접속

- iPad/폰/PC (같은 사내 Wi-Fi): `http://ljhs-MacBook-Pro.local:3100`
- `.local`이 안 잡히면 서버 맥의 IP로 `http://<IP>:3100`. 고정이 필요하면 인프라에 DHCP 예약 요청 (Wi-Fi MAC은 서버 맥의 `ifconfig en0 | grep ether`).
- iPad: Safari 공유 → 홈 화면에 추가.

## 서버 실행 (처음 한 번)

서버 맥에서 `shadcn-next` 디렉터리 기준으로 실행한다. 포트는 `ecosystem.config.cjs`의 `PORT`(3100)로 정해진다.

```bash
git checkout server
npm install
npm run build
npm install -g pm2            # pm2가 없을 때만
pm2 start ecosystem.config.cjs
pm2 startup                   # 출력되는 sudo 명령을 복사해 실행
pm2 save
```

macOS 방화벽이 node 수신 허용을 물으면 허용한다.

## 코드 갱신

```bash
git pull
npm install
npm run build
pm2 restart test-phone
```

## 데이터·백업

- DB: `~/test-phone-data/test-phone.db` (`TEST_PHONE_DB_PATH`로 변경 가능)
- 백업: 매일 04:00 `~/test-phone-data/backup/`에 7일 보관. 설치:

```bash
sed "s#__PROJECT_DIR__#$(pwd)#" docs/ops/com.cashdoc.test-phone-backup.plist > ~/Library/LaunchAgents/com.cashdoc.test-phone-backup.plist
launchctl load ~/Library/LaunchAgents/com.cashdoc.test-phone-backup.plist
```

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

## 제약

- 인증 없음. 사내망 누구나 조작 가능.
- 서버 맥이 덮개 닫힘·전원 분리·재부팅 후 로그인 전이면 중단. 데이터는 보존.
