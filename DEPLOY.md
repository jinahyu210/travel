# 카드 없는 무료 구성: Vercel + Supabase

사이트/API는 Vercel Hobby, 데이터베이스/사진은 Supabase Free를 사용합니다. 각 서비스의 현재 무료 한도와 이용 조건이 적용됩니다. 가입 과정의 실제 조건은 서비스 화면에서 확인하세요. 유료 Render Blueprint는 만들 필요가 없습니다. 기존 `render.yaml`은 별도 선택지입니다.

## 1. Supabase 프로젝트

1. https://supabase.com/dashboard 에서 로그인하고 Free 조직에 프로젝트를 만듭니다. 가까운 지역을 선택하고 데이터베이스 비밀번호를 안전한 곳에 보관하세요.
2. Connect에서 **Transaction pooler** 연결 문자열을 복사합니다(포트 6543). `[YOUR-PASSWORD]`를 실제 데이터베이스 비밀번호로 바꿉니다. 특수 문자가 있으면 URL 인코딩이 필요합니다.
3. Project Settings → API 또는 Data API에서 Project URL을, API Keys에서 서버용 `service_role` 키를 확인합니다. `anon`/publishable 키를 대신 쓰지 마세요. 이 값은 채팅이나 GitHub에 올리지 않습니다.

## 2. Vercel 프로젝트

1. https://vercel.com/new 에 GitHub로 로그인하고 `jinahyu210/travel`을 Import합니다.
2. 개인 무료 Hobby 계정을 사용합니다. Framework는 Other로 두고, 빌드/출력 경로는 별도로 덮어쓰지 않습니다. 저장소의 `vercel.json`이 Python API와 정적 파일을 배포합니다.
3. Environment Variables에 아래 네 값을 추가합니다. 공개용 접두사(`NEXT_PUBLIC_` 등)를 붙이지 마세요.

| 이름 | 값 |
| --- | --- |
| `SUPABASE_DB_URL` | 비밀번호를 채운 Transaction pooler 연결 문자열 |
| `SUPABASE_URL` | Supabase Project URL (`https://프로젝트.supabase.co`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase 서버용 service_role 키 |
| `GALLERY_ADMIN_PASSWORD` | 갤러리 작품 등록/편집에 사용할 별도 관리자 비밀번호 |

4. Deploy를 누릅니다. 배포 성공 후 프로젝트의 Production 주소(`…vercel.app`)를 공유합니다. 실제 주소는 대시보드에서 확인합니다.
5. 첫 API 호출에서 테이블을 만들고 공개 DB 접근을 차단합니다. 첫 작품 등록 시 `gallery-artworks` 공개 이미지 버킷을 만듭니다. 작품 이미지만 공개되며, 방문객 메모는 관리자 API 인증 후에만 읽습니다.

## 운영과 확인

- 작품·전시 사진은 JPG/PNG/WebP/HEIC **10MB 이하**입니다. 3MB를 넘으면 관리자 인증으로 발급한 서명 URL로 비공개 `gallery-uploads` 버킷에 직접 전송하므로 Vercel 함수 요청 한도에 걸리지 않습니다. 서버가 사진을 확인하고 HEIC를 변환한 뒤 공개 이미지로 저장하며 임시 파일을 정리합니다. 두 버킷의 10MB 한도는 서버가 설정합니다.
- 작품·전시 편집 화면의 삭제 버튼과 관리자 메모함의 메모 삭제 버튼은 관리자 인증 및 확인 후 동작합니다. 작품 삭제는 해당 작품만 삭제하며 시리즈 작가노트는 보존합니다.
- 관리자에서 저장한 작품·작가노트·전시 정보는 같은 공개 주소에 반영됩니다. 코드 변경은 GitHub `main`에 올리면 Vercel 연동을 통해 재배포됩니다.
- 배포 후 테스트 작품 등록 → 새로고침 → 다른 브라우저로 확인 → 작품 정보 편집을 확인하세요. Contact 메모가 관리자 비밀번호 없이 조회되지 않는지도 확인하세요.
- Supabase 무료 프로젝트는 장기간 비활성 상태일 때 일시 중지될 수 있습니다. 대시보드에서 재개할 수 있습니다. 무료 저장량/전송량을 초과하면 정책에 따라 제한될 수 있습니다.
- 기존 파일 미리보기의 브라우저 자료는 자동 이전되지 않습니다. 미리보기를 닫기 전에 작품 백업을 다운로드해 보관하세요. 공개 서버로 가져오기는 별도 이전 작업이 필요합니다.
- 아직 계정/프로젝트를 연결하지 않았다면 실제 Supabase 연결 및 Vercel 배포 검증은 완료되지 않은 상태입니다.

로컬 개발에서는 `python3 server.py`가 기존 SQLite 저장을 그대로 사용합니다. Supabase 모드를 로컬에서 검증하려면 `pip install -r requirements.txt` 후 위 네 환경 변수를 서버 프로세스에 설정하세요.
