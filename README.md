# JPlaylist

최근 발매된 일본 음악과 일본 인기 차트를 분리해 탐색하고, 좋아요 취향을 반영해 추천한 뒤 사용자가 선택한 음악 서비스에서 들을 수 있게 하는 정적 웹사이트입니다.

## Features

- **최근 발매 / 인기 차트 분리**: 최근 발매 후보는 iTunes Search API와 차트의 발매일을 조합하고, 인기곡은 Apple Music Japan 공개 차트를 사용합니다.
- **플랫폼 독립 청취**: YouTube Music, Spotify, YouTube, Apple Music 중 기본 듣기 서비스를 선택합니다. Apple Music은 데이터 출처 중 하나일 뿐 기본 청취 경로가 아닙니다.
- **검색과 필터**: 곡명/아티스트 검색, 전체 장르 태그 필터, 아티스트 내부 탐색을 함께 사용할 수 있습니다.
- **점진 로딩**: 처음에는 24곡만 렌더링하고 `더 보기`로 전체 결과에 접근합니다.
- **지속되는 좋아요**: 좋아요 시 곡 메타데이터를 브라우저에 저장하므로 다음 차트에서 빠져도 컬렉션과 추천 취향에 남습니다.
- **취향 백업/복원**: 로그인 없이 JSON 파일로 좋아요와 기본 플랫폼을 다른 브라우저로 옮길 수 있습니다.
- **추천 다양성**: 최근 추천 이력과 같은 아티스트 반복을 피하고, 좋아요 장르/아티스트와 최신성을 함께 반영합니다.
- **오류 복구**: 데이터 재시도, 브라우저의 마지막 정상 캐시, stale/fresh/error 상태 표시를 지원합니다.
- **접근성**: 충분한 모바일 터치 영역, reduced-motion 대응, 별도 ARIA 상태 알림, 긴 제목 모바일 전체 표시를 적용합니다.

## Data architecture

```text
Apple Music Japan public chart ─┐
                                ├─ GitHub Actions (every 6h)
iTunes Search API ──────────────┘
                 ↓
        scripts/fetch-songs.mjs
                 ↓
        scripts/validate-data.mjs
                 ↓
        data/songs.json snapshot
          ↙                 ↘
   commit to main        Pages artifact
   (last fallback)            ↓
                        GitHub Pages
```

`data/songs.json`은 마지막 정상 데이터 스냅샷으로 저장됩니다. 외부 소스가 일시적으로 실패하면 기존 스냅샷을 `stale` 상태로 유지하고, 사용할 수 있는 스냅샷도 없다면 배포 자체를 실패시켜 빈 사이트가 정상 배포되는 것을 막습니다.

### 최근 발매의 의미

JPlaylist의 `최근 발매`는 Apple의 공개 Search API에서 J-Pop/J-Rock/애니메이션/보컬로이드/邦楽 관련 후보를 수집하고, 일본 인기 차트의 최근 발매곡을 합친 뒤 기본 180일 이내 발매곡을 최신순으로 보여줍니다. 공개 검색 결과가 충분하지 않을 때만 365일까지 범위를 넓힙니다. 이는 Apple Music 전체 카탈로그의 완전한 신보 목록을 의미하지 않으며 UI에도 데이터 기준을 명시합니다.

## Recommendation

추천은 브라우저 안에서 다음 신호를 조합합니다.

- 발매 최신성
- 일본 인기 차트 순위(있는 경우)
- 좋아요한 장르
- 좋아요한 아티스트
- 이미 좋아요한 곡/건너뛴 곡 감점
- 최근 추천 이력과 같은 아티스트 반복 회피

좋아요가 0개면 `오늘의 추천`, 1~2개면 `취향 학습 중`, 3개 이상이면 `FOR YOU`로 표시해 개인화 수준을 과장하지 않습니다.

## GitHub Pages setup

저장소의 **Settings → Pages → Build and deployment → Source**를 **GitHub Actions**로 설정합니다.

배포 URL: `https://6rmkhj.github.io/JPlaylist/`

## Local preview

```bash
python3 -m http.server 8080
```

그 다음 `http://localhost:8080`을 엽니다.

## Validation

```bash
node --check app.js
node --check scripts/fetch-songs.mjs
node --test tests/*.test.mjs
node scripts/validate-data.mjs
```

실제 데이터 수집은 네트워크가 가능한 환경에서 다음으로 실행합니다.

```bash
node scripts/fetch-songs.mjs
```
