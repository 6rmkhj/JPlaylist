# JPlaylist

J-POP, K-POP, POP을 오가며 내 취향의 위치를 보고, 매일 세 곡과 5단계 Rabbit Hole로 다음 취향을 탐험하는 정적 음악 발견 웹사이트입니다. 각 음악 씬은 독립된 카탈로그와 취향 기록을 사용하고, 사용자가 선택한 음악 서비스에서 실제 청취로 이어집니다.

## Features

- **세 개의 독립 음악 씬**: J-POP / K-POP / POP 전환 시 카탈로그, Taste Map, 오늘의 3곡, Rabbit Hole, 좋아요와 탐색 기록이 함께 전환됩니다.
- **씬별 시각 공간**: J-POP은 핑크·바이올렛의 부드러운 bloom, K-POP은 시안·인디고의 stage/grid, POP은 골드·코랄의 warm poster 톤으로 배경·카드·Taste Map·control 형태까지 구분합니다.
- **Taste Map**: 좋아요와 실제 탐색 기록을 바탕으로 차트 중심↔딥컷, 익숙한 취향↔새 아티스트 탐험 축에서 현재 위치를 보여줍니다.
- **오늘의 3곡**: 안전픽 / 한 발 밖 / 딥 다이브 역할로 매일 세 곡을 추천하고, 각 추천 이유를 설명합니다.
- **Rabbit Hole**: 한 곡에서 시작해 더 깊게 / 더 새롭게 / 더 낯설게 방향으로 5단계 탐험 경로를 만듭니다.
- **플랫폼 독립 청취**: YouTube Music, Spotify, YouTube, Apple Music 중 기본 듣기 서비스를 선택합니다. 데이터 출처와 청취 플랫폼을 분리합니다.
- **검색과 필터**: 곡명·아티스트 검색, 장르, 아티스트, 릴리스, 정렬, deep-link 상태를 함께 사용할 수 있습니다.
- **지속되는 좋아요**: 좋아요 시 곡 메타데이터를 브라우저에 저장하므로 다음 차트에서 빠져도 컬렉션과 추천 취향에 남습니다.
- **씬별 취향 격리**: J-POP/K-POP/POP의 좋아요·추천 기록·캐시는 서로 섞이지 않고, 기본 듣기 플랫폼만 공통으로 유지합니다.
- **취향 백업/복원**: 로그인 없이 JSON 파일로 좋아요와 기본 플랫폼을 다른 브라우저로 옮길 수 있습니다.
- **오류 복구**: 데이터 timeout, 재시도, 마지막 정상 캐시, stale/fresh/degraded/error 상태를 지원합니다.
- **접근성**: 충분한 모바일 터치 영역, reduced-motion 대응, 키보드 radio 조작, ARIA 상태 알림, 긴 제목 표시를 적용합니다.

## Music scenes

| Scene | Data basis | Visual space |
| --- | --- | --- |
| J-POP | Japan 공개 차트 + JP 카탈로그 검색 + 발매일 인덱스 보완 | Pink / violet, soft bloom, round surfaces |
| K-POP | Korea 공개 차트 + KR 카탈로그 검색 | Cyan / indigo, stage light + grid, sharp surfaces |
| POP | US 공개 차트 + US 카탈로그 검색, K-POP/J-POP 제외 | Gold / coral, warm poster + sunset, bold rounded surfaces |

## Data architecture

```text
Japan chart + JP catalog + release index ──> scripts/fetch-songs.mjs ──> data/songs.json
Korea chart + KR catalog ──────────────────> scripts/fetch-scene.mjs ──> data/songs-kpop.json
US chart + US catalog ─────────────────────> scripts/fetch-scene.mjs ──> data/songs-pop.json

                         GitHub Actions (every 6h / deploy)
                                      ↓
                         validate all scene datasets
                                      ↓
                     last-success snapshots + Pages artifact
                                      ↓
                                GitHub Pages
```

외부 소스가 일시적으로 실패하면 가능한 정상 스냅샷을 유지하고 상태를 명시합니다. 사용할 수 있는 데이터가 없으면 빈 사이트를 정상 배포하지 않도록 validation 단계에서 차단합니다.

## Personalization

추천은 브라우저 안에서 다음 신호를 조합합니다.

- 좋아요한 장르와 아티스트
- 실제 곡 탐색·미리듣기·외부 듣기 기록
- 발매 최신성
- 지역별 인기 차트 순위
- 이미 좋아요한 곡/관심 없음 피드백
- 최근 추천 이력과 같은 아티스트 반복 회피
- 사용자가 선택한 `취향 중심 / 균형 / 새로움 우선` 탐험 강도

씬별 취향 데이터는 별도 localStorage namespace로 저장되어 K-POP의 행동이 POP Taste Map을 바꾸지 않습니다.

## GitHub Pages setup

저장소의 **Settings → Pages → Build and deployment → Source**를 **GitHub Actions**로 설정합니다.

배포 URL: `https://6rmkhj.github.io/JPlaylist/`

## Local preview

```bash
python3 -m http.server 8080
```

그 다음 `http://localhost:8080`을 엽니다. K-POP은 `?scene=kpop`, POP은 `?scene=pop`으로 바로 열 수 있습니다.

## Validation

```bash
node --check app.js
node --check bootstrap.js
node --check experience-core.mjs
node --check scripts/fetch-songs.mjs
node --check scripts/fetch-scene.mjs
node --test tests/*.test.mjs
npx playwright test --config=playwright.config.mjs
node scripts/validate-data.mjs
node scripts/validate-scene-data.mjs
```

실제 데이터 수집은 네트워크가 가능한 환경에서 실행합니다.

```bash
node scripts/fetch-songs.mjs
node scripts/fetch-scene.mjs kpop
node scripts/fetch-scene.mjs pop
```
