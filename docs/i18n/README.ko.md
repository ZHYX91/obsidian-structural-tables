# Structural Tables

[English](../../README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Deutsch](README.de.md) · [Français](README.fr.md) · [Español](README.es.md) · [Português (Brasil)](README.pt-BR.md) · [Русский](README.ru.md) · [Tiếng Việt](README.vi.md) · [العربية](README.ar.md)

자주 쓰는 표 작업과 주의할 점을 모았습니다. 자세한 내용은 [영문 전체 안내](../../README.md) 또는 [중국어 간체 안내](README.zh-CN.md)를 참고하세요.

Markdown 표에 셀 병합, 여러 줄의 열 머리글, 행 머리글, 열 머리글이 없는 표를 추가합니다. 표를 보는 것만으로 노트의 Markdown 내용이 바뀌지는 않습니다.

## 화면 예시

### 읽기 보기의 삼선표

여러 줄의 머리글과 병합된 셀이 표시되며, 모든 셀에 테두리를 그리지 않아도 그룹을 구분할 수 있습니다.

![읽기 보기의 병합 셀이 포함된 삼선표](../assets/structural-tables-reading-view-en.png)

### 실시간 미리보기 편집

컴퓨터에서는 셀을 클릭하고 터치 화면에서는 두 번 탭하여 바로 편집할 수 있습니다.

![실시간 미리보기에서 셀 편집](../assets/structural-tables-live-preview-en.png)

### 모양 설정

![Structural Tables 모양 설정](../assets/structural-tables-settings-en.png)

모양 설정 이미지는 실제 설정과 표 구성 요소를 브라우저에서 표시한 예시이며, Obsidian 앱의 화면 캡처는 아닙니다.

<!-- section: features -->
## 기능

- Markdown과 HTML 표를 미리 보고 상호 변환하며, 지원하지 않는 내용과 손실되는 서식을 안내합니다.

- `<` 를 입력하면 원본에서 앞선 열과 병합되고, `^` 는 위쪽 셀과 병합됩니다.
- 구분 행의 붙어 있는 `||` 로 행 머리글 열을 지정할 수 있으며 열 머리글을 여러 행으로 만들 수 있습니다.
- 읽기 보기와 실시간 미리보기에서 같은 병합 구조를 표시합니다.
- 행과 열을 추가·이동·삭제하거나 표 전체의 행과 열을 바꿀 수 있습니다.
- HTML, 일반 GFM, TSV, CSV로 복사하고 데스크톱에서는 PNG 이미지로 내보낼 수 있습니다.
- 브라우저와 스프레드시트에서 지원되는 HTML 표를 붙여넣을 수 있습니다.
- 미리보기를 확인하고 표를 Obsidian Base로 변환할 수 있습니다.
- 선택하지 않은 데이터가 사라질 수 있는 쓰기는 거부하지만, 명시적으로 요청한 비우기와 삭제는 허용합니다.

<!-- section: requirements-and-compatibility -->
## 요구 사항과 호환성

Obsidian 1.12.7 이상이 필요하며 데스크톱과 Android를 지원합니다. Base로 변환하려면 Obsidian의 기본 플러그인 Bases를 켜세요.

`<`, `^`, `||` 는 확장 Markdown 문법으로, 다른 편집기에서는 병합 상태가 다르게 보일 수 있습니다. Advanced Tables를 사용할 때는 “표의 Markdown 원문 편집”을 열고 외부 정렬 뒤 내용을 확인하세요.

### 표 호환성에 관한 설명과 사과

*2026-10-31*

[Number Suite](https://github.com/ZHYX91/obsidian-number-suite) 와 마찬가지로 Structural Tables도 처음에는 제가 Obsidian에서 논문 관련 작업을 편하게 하려고 만든 작은 도구였습니다. LaTeX에서 실제로 필요한 기능은 많지 않았기에 Markdown 문법을 조금 확장하면 대신할 수 있다고 생각했습니다. 초기에는 제 사용 방식에 집중하다 보니 다른 사용자와 Markdown 편집기에서의 호환성을 충분히 고려하지 못했습니다.

기존의 열 머리글 없는 표와 행 머리글 확장 구문은 GFM 표 구조에 맞지 않습니다. 그래서 일부 Markdown 편집기에서 표를 올바르게 인식하거나 표시하지 못했습니다. 설계할 때 제가 놓친 부분입니다. 읽기, 공유, 이전 과정에서 불편을 드려 죄송합니다.

이를 개선하기 위해 Markdown과 HTML 표의 양방향 변환을 추가했습니다. 확장 Markdown 표를 HTML로 바꿀 때 복잡한 머리글과 병합을 유지하고, 지원되는 HTML 표를 Markdown으로 돌릴 수도 있습니다. 일반 GFM으로 충분하면 그 문법을 쓰고 필요한 경우에만 기존 확장 문법을 사용합니다. 교체 전에 원본과 내용·서식의 차이를 미리 볼 수 있습니다.

<!-- section: installation -->
## 설치

Obsidian의 “설정 → 커뮤니티 플러그인 → 탐색”에서 Structural Tables를 검색해 설치하고 활성화하세요.

직접 설치하려면 `structural-tables-<version>.zip`을 `Vault/.obsidian/plugins/`에 풀고 Obsidian을 다시 불러온 다음 플러그인을 활성화하세요.

[GitHub Releases](https://github.com/ZHYX91/obsidian-structural-tables/releases/latest).

<!-- section: usage -->
## 사용법

텍스트를 선택하지 않은 상태에서 빈 줄에 커서를 놓고 명령 팔레트의 **구조화 표 삽입**을 실행하면 예제 표가 바로 삽입됩니다. 실시간 미리보기에서 커서를 표 밖으로 옮기거나 읽기 보기로 전환해 결과를 확인하세요. 아래 예제도 같은 구조이므로 내용을 바꿔 사용할 수 있습니다.

```markdown
| 지역 | 매출 | < |
| 분기 | Q1 | Q2 |
| --- || --- | --- |
| 북부 | 10 | 12 |
| ^ | 8 | 11 |
```

`<` 는 원본 순서에서 앞선 열과 합치고, `^` 는 위쪽 셀과 합칩니다. 구분 행의 `||` 는 행 머리글 경계를 나타내며 열을 추가하지 않습니다.

표시가 예상과 다르면 **현재 노트의 구조화 표 검사** 명령으로 문법 문제를 확인하세요. 검사는 Markdown을 수정하지 않습니다.

실시간 미리보기에서 셀을 클릭하면 편집할 수 있습니다. Enter는 저장 후 이동, Shift+Enter는 줄바꿈, Escape는 취소입니다. 행이나 열 손잡이를 끌어서 위치를 바꿀 수 있습니다.

셀 범위를 선택했을 때 Delete/Backspace는 글자만 지우고 행·열·병합 구조를 유지합니다. 행, 열, 표 삭제는 오른쪽 클릭 메뉴를 사용하며 Undo로 되돌릴 수 있습니다.

셀 범위를 복사하거나 잘라낼 수 있습니다. 붙여넣을 때는 병합 구조가 같은 직사각형 범위 또는 왼쪽 위 시작점으로 쓸 병합되지 않은 셀 하나를 선택하세요. 셀 하나를 시작점으로 선택하면 표가 오른쪽과 아래로 확장될 수 있습니다. 기존 병합 셀의 일부만 덮어쓸 수는 없습니다. 모바일에서 재시작하거나 클립보드 내용을 바꾸면 이전 병합 정보는 더 이상 쓸 수 없습니다.

데스크톱에서는 표 전체를 PNG로 미리 보거나 복사·저장할 수 있습니다. 저장하지 않은 셀 편집은 이미지에 포함되지 않습니다. 모바일은 PNG 내보내기를 지원하지 않습니다.

Base로 변환하기 전에 노트를 저장하고 인용문이나 목록 속 표를 최상위로 옮기세요. 병합 구조는 펼쳐지며 원본 표를 복원해도 이미 만든 레코드 노트는 남습니다.

데이터 영역에 병합된 셀이 있다면 Base로 변환하기 전에 분할해야 합니다. 변환 후에는 Base 블록 안에 커서를 놓고 **현재 Base에 레코드 만들기** 명령으로 빈 레코드를 추가할 수 있습니다.

### 일반 Markdown 표

일반 GFM 표는 기본적으로 Obsidian 원래의 표 편집기를 사용합니다. “일반 Markdown 표도 편집”을 켜야 이 플러그인의 편집 도구를 사용할 수 있습니다. 본문의 한 행에 머리글보다 많은 원본 셀이 있으면 일부 데이터가 숨겨질 수 있습니다. 구조를 변경하기 전에 “표의 Markdown 원문 편집”에서 추가 셀을 처리하세요.

### 수식과 줄바꿈

Shift+Enter로 입력한 표시용 줄바꿈은 지원되는 `<br>` 형태로 저장됩니다. 수식 안의 이스케이프되지 않은 `|`는 표 구분자로 해석될 수 있으므로, 플러그인은 임시 편집을 유지하고 위험한 저장을 거부합니다. 수식의 뜻에 따라 TeX 명령 `\lvert`, `\rvert`, `\mid`를 사용하세요.

### 붙여넣기와 복사

HTML 표의 구조를 안전하게 보존할 수 있을 때만 Markdown으로 변환합니다. 서식을 그대로 보존할 수 없다면 클립보드의 전체 일반 텍스트를 붙여넣거나 Obsidian 원래 붙여넣기에 맡깁니다. 일반 텍스트는 병합과 서식을 보존하지 못합니다. 일반 GFM으로 변환했다면 다른 편집기에서 최종 표시를 확인하세요.

### 일반 GFM으로 변환

표를 오른쪽 클릭하고 “일반 GFM 표로 변환…”를 선택하세요. 편집기에서 표 소스 안에 커서를 놓고 일반 GFM 변환 명령으로 열 수도 있습니다.

행 머리글만 있는 표는 행과 열을 맞바꾸어 맨 위 머리글 행으로 만드는 것을 권장합니다. 열 머리글 없이 원래 방향을 유지하면 맨 위에 빈 머리글 행을 추가하고 기존 데이터 행을 모두 보존합니다.

병합된 셀은 개별 셀로 나뉘며 병합 범위의 모든 위치에 같은 내용이 반복됩니다. 여러 머리글 행은 하나로 합쳐지고 각 단계의 머리글은 “ / ”로 연결됩니다. 옆쪽에 남는 행 머리글은 일반 셀이 됩니다. GFM은 해당 행 머리글 역할을 유지하지 못합니다.

결과 미리 보기와 Markdown 소스를 전환한 뒤 현재 결과를 복사하거나 원본 표를 바꿀 수 있습니다. 읽기 보기에서는 복사만 가능합니다. 바꾸기는 한 번의 변경이며 한 번의 실행 취소로 복원됩니다. 창을 닫으면 소스는 바뀌지 않습니다. 셀 편집을 먼저 완료하고 원본 표나 파일이 바뀌면 미리 보기를 다시 여세요. 일반 GFM 빠른 복사 명령은 권장 방향을 사용합니다.

### PNG 제한과 Base 복원

PNG 이미지 제한은 한 변 8192픽셀 또는 총 1600만 픽셀입니다. 표 전체를 담을 수 없다면 잘린 이미지를 만들지 않습니다. Base로 변환할 때 레코드 노트와 `_promotion.json` 복원 기록을 만듭니다. 원래 표를 복원해도 이후 Base 레코드 수정 내용은 포함되지 않으며 생성된 노트는 삭제하지 않습니다.

### Markdown과 HTML 표 변환

Markdown 표에 커서를 놓고 **현재 Markdown 표를 HTML로 변환…** 명령을 실행하세요. HTML을 다시 변환하려면 Markdown 소스 편집기의 완전하고 독립적인 `<table>…</table>` 블록 안에 커서를 놓고 **현재 HTML 표를 Markdown으로 변환…** 를 실행하세요. 두 변환 모두 미리보기 확인 후 한 번의 실행 취소가 가능한 편집으로 교체합니다.

일반 GFM으로 표현할 수 있는 구조는 GFM을 쓰고, 필요할 때만 `<`, `^`, `||`를 사용합니다. 지원하지 않는 링크, 수식, 복잡한 서식은 변환하지 않습니다. HTML의 색상과 너비 등이 사라지면 별도 동의가 필요합니다. HTML로 변환한 표는 플러그인의 시각적 셀 편집 대상이 아니므로, 구조를 편집하려면 Markdown으로 되돌리세요.

<!-- section: settings -->
## 설정

“일반”: 언어, HTML 붙여넣기, 충돌 알림. “보기”: 읽기 보기, 실시간 미리보기, 진단, 일반 GFM 표 편집. “모양”: 스타일, 너비, 간격, 번갈아 행 배경색.

테마 따르기, 격자, 삼선표 중에서 고를 수 있습니다. 모양이나 인터페이스 언어를 바꿔도 Markdown 내용과 노트의 문자 방향은 바뀌지 않습니다.

“선과 배경”, “배치와 간격” 아래의 예제 표에서 변경 결과를 바로 확인할 수 있습니다. 예제는 고정된 텍스트만 사용하며 노트를 읽거나 수정하지 않습니다. 설정은 보관함 전체의 표에 적용되고 자동으로 저장됩니다.

<!-- section: limitations -->
## 제한 사항

스프레드시트 계산기가 아니므로 수식을 계산하지 않습니다. 셀별 스타일, 표 캡션, 셀 안의 블록 Markdown, 원본 여러 줄 셀은 지원하지 않습니다.

가져온 HTML은 일반 텍스트와 지원되는 `<br>` 줄바꿈으로 변환됩니다. 일반 GFM은 모든 병합 구조를 유지할 수 없으며 Base 변환 과정에서는 머리글 구조가 단순화됩니다.

<!-- section: privacy-and-security -->
## 개인정보 보호와 보안

표는 기기에서 처리하며 노트 내용을 업로드하거나 사용 통계를 수집하지 않습니다. 보기만 할 때 Markdown을 바꾸지 않습니다.

외부 이미지와 글꼴의 네트워크 사용은 Obsidian과 테마의 정책을 따릅니다. 개인 노트와 파일 경로를 공개 이슈에 게시하지 마세요.

<!-- section: development -->
## 개발

Node 24.19.0과 npm 11.17.0을 사용합니다. 의존성을 설치하고 검사를 실행하세요.

```bash
npm ci
npm run check
```

[Architecture](https://github.com/ZHYX91/obsidian-structural-tables/blob/main/docs/architecture.en.md) · [Contributing](https://github.com/ZHYX91/obsidian-structural-tables/blob/main/CONTRIBUTING.md) · [Changelog](https://github.com/ZHYX91/obsidian-structural-tables/blob/main/CHANGELOG.md)

<!-- section: support -->
## 지원

질문은 Q&A, 개선 아이디어는 Ideas, 재현 가능한 오류는 GitHub Issues에 남겨 주세요. Obsidian 버전, 테마, 표 Markdown, 기대한 결과와 실제 결과를 알려 주세요.

[Q&A](https://github.com/ZHYX91/obsidian-structural-tables/discussions/categories/q-a) · [Ideas](https://github.com/ZHYX91/obsidian-structural-tables/discussions/categories/ideas) · [GitHub Issues](https://github.com/ZHYX91/obsidian-structural-tables/issues/new/choose) · [Private security reporting](https://github.com/ZHYX91/obsidian-structural-tables/security/advisories/new)

보안 취약점은 공개하지 말고 비공개 보안 신고 기능을 이용하세요.

<!-- section: license -->
## 라이선스

[MIT](https://github.com/ZHYX91/obsidian-structural-tables/blob/main/LICENSE) © ZhengYX
