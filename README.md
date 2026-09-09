# JPlaylist

일본 음악 데이터를 자동으로 수집하고, 최근 발매일과 사용자의 좋아요 취향을 반영해 음악을 추천하는 정적 웹사이트입니다. 데이터 출처와 청취 플랫폼을 분리해 특정 스트리밍 서비스에 종속되지 않도록 설계합니다.

## Features

- Apple Music Japan Top Songs 공개 RSS를 GitHub Actions에서 6시간마다 수집
- 일본어 문자/일본 음악 장르 휴리스틱으로 J-Music 우선 필터링
- 최근 발매일 + 차트 순위 + 좋아요 장르/아티스트 기반 브라우저 내 추천
- YouTube Music / Spotify / YouTube / Apple Music 중 기본 듣기 플랫폼 선택
- 선택한 듣기 플랫폼과 좋아요는 `localStorage`에 저장
- YouTube Music / Spotify / YouTube는 `아티스트 + 곡명` 검색으로 연결하고, Apple Music은 수집된 직접 링크를 우선 사용
- 별도 서버와 API Secret 없이 GitHub Pages에 배포
- 모바일 반응형 UI

## Architecture

```text
Apple Music RSS (metadata source)
      ↓
GitHub Actions (every 6h)
      ↓
scripts/fetch-songs.mjs
      ↓
data/songs.json
      ↓
Static JPlaylist UI
      ↓
User-selected listening platform
```

## Listening platform

JPlaylist에서 Apple Music은 현재 음악 메타데이터 수집 소스 중 하나일 뿐, 기본 청취 목적지가 아닙니다. 사용자가 처음 `듣기`를 누르면 원하는 서비스를 선택하고 이후 곡에도 같은 서비스가 적용됩니다. 언제든 UI에서 기본 플랫폼을 변경할 수 있습니다.

## GitHub Pages setup

저장소의 **Settings → Pages → Build and deployment → Source**를 **GitHub Actions**로 설정하세요. 이후 `main` push, 수동 실행, 또는 6시간 주기 schedule마다 데이터를 새로 수집해 Pages를 배포합니다.

배포 URL: `https://6rmkhj.github.io/JPlaylist/`

## Local preview

정적 파일이므로 간단한 로컬 서버에서 실행할 수 있습니다.

```bash
python3 -m http.server 8080
```

그 다음 `http://localhost:8080`을 엽니다.

최신 데이터 수집 테스트:

```bash
node scripts/fetch-songs.mjs
```

## Data note

일본 스토어 차트에는 해외 음악도 포함될 수 있습니다. JPlaylist는 일본어 문자와 J-Pop/J-Rock/Anime 등의 장르 정보를 사용해 일본 음악을 우선적으로 골라냅니다. 필터 결과가 너무 적을 경우 사이트가 비는 것을 방지하기 위해 일본 스토어 차트 전체로 자동 폴백합니다.
