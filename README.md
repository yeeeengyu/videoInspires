# vLLM기반 유튜브 시나리오 생성기

<img width="260" height="260" alt="image" src="https://github.com/user-attachments/assets/5695cbd3-6475-4342-8a6e-7543ed2e5445" />

<br>
로컬 vLLM 서버를 OpenAI 호환 API로 연결해 사용하는 RAG 채팅 웹앱입니다.  
FastAPI 백엔드가 vLLM에 채팅/임베딩 요청을 보내고, FAISS 벡터 DB에 문서를 저장한 뒤, Next.js 프론트엔드에서 SSE 스트리밍으로 답변을 실시간 표시합니다.

이 프로젝트는 AI 교육 영상 시나리오 작성 보조에 맞춰져 있습니다. 사용자가 주제, 대상 학년, 영상 길이 등을 입력하면 학생이 이해하기 쉬운 형태의 시나리오를 생성하고, 필요하면 업로드한 참고 문서를 RAG 컨텍스트로 함께 사용합니다.

## 주요 기능

- vLLM OpenAI-compatible API 연동
- FastAPI 기반 SSE 스트리밍 채팅
- FAISS 기반 로컬 RAG 저장소
- 텍스트 문서 인덱싱, 문서 목록 조회, 벡터 DB 초기화
- 검색된 RAG 컨텍스트 표시
- Markdown 답변 렌더링
- Next.js + Tailwind CSS 프론트엔드

## 프로젝트 사진

<img width="700" height="523" alt="image" src="https://github.com/user-attachments/assets/879da1d8-048c-479b-bb0d-df16d7d19589" />

<br>

<img width="520" height="522" alt="image" src="https://github.com/user-attachments/assets/d0809103-a767-4802-9957-5f847df100a7" />

## 기술 스택

### Frontend

- Next.js 15
- React 19
- Tailwind CSS 4
- lucide-react

### Backend

- FastAPI
- Uvicorn
- httpx
- FAISS CPU
- NumPy
- pydantic-settings

### Model Server

- vLLM
- OpenAI-compatible API
- `/v1/chat/completions`
- `/v1/embeddings`

### vLLM 선택 이유
같은 환경에서 구동하였을 때, 모델 파라미터 수에 따라 VRAM 점유도에 차이가 있었습니다.
- Ollama
  - Qwen2.5-7B-Instruct모델 구동 시 **16GB VRAM 중 12GB 점유**

- vLLM
  - 동일모델 구동 시 **OOM 충돌**
  - vLLM으로 진행 시 4bit Quantization 모델 사용해야 함
    - 이에도 16GB 중 15.5GB 점유하여 효율이 안 좋음

이 이유들로는 **굳이 vLLM을 사용할 이유가 없어**보이지만, <br>
양자화 된 모델과 기본모델의 성능이 체감되는지 테스트해보고 싶어 사용하였습니다.


## 로컬 LLM 서빙 실험 요약

2026년 5월 18일 RTX A4000 16GB 환경에서 오픈소스 LLM 서빙 성능과 하드웨어 메트릭을 측정했습니다. 테스트 환경은 Windows 11 네이티브와 WSL2 Ubuntu 22.04를 함께 사용했으며, NVIDIA 드라이버 12.8.61, CUDA 12.8 기준으로 기본 Idle VRAM은 약 0.5GB였습니다.

### 테스트 환경

| 항목 | 내용 |
| --- | --- |
| GPU | NVIDIA RTX A4000 16GB |
| OS | Windows 11, WSL2 Ubuntu 22.04 |
| NVIDIA 드라이버 | 12.8.61 |
| CUDA | 12.8 |
| Idle VRAM | 약 0.5GB |

### 모델별 측정 결과

| 항목 | Qwen2.5-7B-Instruct BASE | Qwen2.5-7B-Instruct GGUF Q4-K-M |
| --- | --- | --- |
| 파라미터 | 7B | 7B |
| 추론 엔진 | Ollama | Ollama |
| Context Window | 4,096 | 4,096 |
| 모델 로딩 직후 총 VRAM | 약 15GB | 약 15.5GB |
| 순수 모델 점유량 | 약 14GB | 약 7GB |
| 추론 시 Peak VRAM | 약 15.9GB | 약 15.9GB |
| TTFT | 0.3 ~ 1.0초 | 0.5 ~ 1.0초 |
| 평균 추론 속도 | 25 ~ 40 tokens/s | 35 ~ 70 tokens/s |
| 추론 중 최고 온도 | 41°C | 45°C |
| 3명 이상 동시 접속 | 원활 | 원활 |

### 관찰 내용

- 양자화 모델은 평균 추론 속도가 더 빠르게 측정되었지만, 출력이 길어질수록 중국어가 섞여 나오는 현상이 더 자주 발생했습니다.
- BASE 모델에서도 비슷한 현상이 일부 보였지만, 양자화 모델보다 지속 시간이 짧았습니다.
- GPU 온도는 45°C 이상으로 올라가지 않아 서멀 스로틀링으로 인한 속도 저하는 관찰되지 않았습니다.
- 양자화 모델 추론 시 온도가 약 3~5°C 더 증가하는 경향이 있었습니다.
- Ollama는 vLLM 대비 부하가 상대적으로 낮게 느껴졌고, 같은 환경에서는 Ollama에 BASE 모델을 올리는 방식이 vLLM보다 VRAM 부담이 적었습니다.

### 트러블슈팅

배포 이후 외부 접속이 차단되는 문제가 있었고, 원인은 학교 내부망에 의한 접속 제한으로 판단했습니다. 최종적으로 ngrok 터널링을 사용해 외부 접속을 활성화했습니다.

## 폴더 구조

```text
.
├── backend
│   ├── app
│   │   ├── config.py      # 환경변수 설정
│   │   ├── main.py        # FastAPI 엔드포인트
│   │   ├── rag.py         # FAISS RAG 저장소
│   │   ├── schemas.py     # API 스키마
│   │   └── vllm.py        # vLLM 클라이언트
│   ├── .env.example
│   └── requirements.txt
├── frontend
│   ├── app
│   │   ├── page.tsx       # 채팅 UI
│   │   ├── layout.tsx
│   │   └── globals.css
│   └── package.json
└── README.md
```

## 사전 준비

다음 프로그램이 필요합니다.

- Python 3.11 이상 권장
- Node.js 20 이상 권장
- NVIDIA GPU + CUDA 환경
- vLLM 실행 환경

Windows에서는 vLLM을 보통 WSL Ubuntu에서 실행하는 것을 권장합니다.

## 1. vLLM 서버 실행

먼저 vLLM을 OpenAI 호환 서버로 띄웁니다. 예시는 AWQ 모델을 `8081` 포트로 실행하는 명령입니다.

```bash
vllm serve /home/pc/vllm-test/Qwen2.5-7B-Instruct-AWQ \
  --served-model-name Qwen/Qwen2.5-7B-Instruct-AWQ \
  --host 0.0.0.0 \
  --port 8081 \
  --dtype float16 \
  --quantization awq \
  --gpu-memory-utilization 0.90 \
  --max-model-len 2048
```

서버 확인:

```powershell
Invoke-WebRequest http://127.0.0.1:8081/v1/models -UseBasicParsing
```

API 키를 걸고 실행했다면:

```bash
vllm serve <MODEL_PATH_OR_ID> \
  --host 0.0.0.0 \
  --port 8081 \
  --api-key your-api-key
```

이 경우 `backend/.env`의 `VLLM_API_KEY`에도 같은 값을 넣어야 합니다.

## 2. 백엔드 실행

```powershell
cd backend
copy .env.example .env
..\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

`backend/.env`를 vLLM 서버에 맞게 수정합니다.

```env
VLLM_BASE_URL=http://127.0.0.1:8081/v1
VLLM_API_KEY=
VLLM_CHAT_MODEL=Qwen/Qwen2.5-7B-Instruct-AWQ
VLLM_EMBED_MODEL=Qwen/Qwen2.5-7B-Instruct-AWQ
FAISS_PATH=./faiss_db
RAG_TOP_K=4
CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
```

백엔드 서버 실행:

```powershell
..\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

헬스체크:

```powershell
Invoke-WebRequest http://127.0.0.1:8000/health -UseBasicParsing
```

## 3. 프론트엔드 실행

새 터미널에서 실행합니다.

```powershell
cd frontend
npm.cmd install
npm.cmd run dev
```

브라우저에서 접속:

```text
http://localhost:3000
```

프론트엔드는 기본적으로 백엔드를 `http://127.0.0.1:8000`으로 호출합니다.  
다른 주소를 쓰려면 `frontend/.env.local`에 다음 값을 설정할 수 있습니다.

```env
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000
```

## 환경변수

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `VLLM_BASE_URL` | `http://127.0.0.1:8080/v1` | vLLM OpenAI-compatible API 주소 |
| `VLLM_API_KEY` | 빈 값 | vLLM을 `--api-key`로 실행한 경우 설정 |
| `VLLM_CHAT_MODEL` | `Qwen/Qwen2.5-7B-Instruct` | 채팅에 사용할 모델명 |
| `VLLM_EMBED_MODEL` | `Qwen/Qwen2.5-7B-Instruct` | 임베딩에 사용할 모델명 |
| `FAISS_PATH` | `./faiss_db` | FAISS 인덱스와 메타데이터 저장 경로 |
| `RAG_TOP_K` | `4` | 채팅 시 검색할 문서 청크 수 |
| `CORS_ORIGINS` | `http://localhost:3000,http://127.0.0.1:3000` | 허용할 프론트엔드 Origin |

## API

### `GET /health`

백엔드와 vLLM 연결 설정을 확인합니다.

### `POST /api/ingest/text`

텍스트를 청크로 나누고 vLLM 임베딩을 생성한 뒤 FAISS에 저장합니다.

```json
{
  "title": "문서 제목",
  "source": "출처 또는 메모",
  "text": "인덱싱할 본문"
}
```

### `GET /api/documents`

인덱싱된 문서 목록을 반환합니다.

### `DELETE /api/documents`

FAISS 인덱스와 문서 메타데이터를 초기화합니다.

### `POST /api/chat/stream`

SSE 방식으로 채팅 답변을 스트리밍합니다.

```json
{
  "messages": [
    {
      "role": "user",
      "content": "중학생 대상 생성형 AI 소개 영상 시나리오를 만들어줘"
    }
  ],
  "use_rag": true,
  "top_k": 4,
  "temperature": 0.3
}
```

SSE 이벤트:

| 이벤트 | 설명 |
| --- | --- |
| `context` | 검색된 RAG 청크 |
| `token` | 스트리밍 토큰 |
| `done` | 완료 |
| `error` | 오류 |

## RAG 사용 시 주의사항

문서 인덱싱은 vLLM의 `/v1/embeddings` 엔드포인트를 사용합니다.  
따라서 `VLLM_EMBED_MODEL`에는 임베딩을 지원하는 모델을 지정해야 합니다.

채팅 모델이 임베딩을 지원하지 않는 경우:

- RAG 토글을 끄고 채팅만 사용하거나
- 별도의 임베딩 모델을 vLLM으로 실행한 뒤 `VLLM_EMBED_MODEL`을 해당 모델명으로 설정하세요.

## 자주 나는 문제

### `401 Unauthorized`

vLLM을 `--api-key`로 실행했는데 `backend/.env`의 `VLLM_API_KEY`가 비어 있거나 값이 다를 때 발생합니다.

해결:

```env
VLLM_API_KEY=your-api-key
```

수정 후 백엔드를 재시작해야 합니다.

### `model not found`

vLLM 실행 시 `--served-model-name`으로 지정한 이름과 `VLLM_CHAT_MODEL` 또는 `VLLM_EMBED_MODEL` 값이 다를 때 발생합니다.

예를 들어 vLLM을 다음처럼 실행했다면:

```bash
--served-model-name Qwen/Qwen2.5-7B-Instruct-AWQ
```

`.env`도 다음처럼 맞춰야 합니다.

```env
VLLM_CHAT_MODEL=Qwen/Qwen2.5-7B-Instruct-AWQ
```

### `8080` 포트 충돌

다른 프로세스가 `8080` 포트를 사용 중이면 vLLM을 `8081` 같은 다른 포트로 실행하고 `VLLM_BASE_URL`도 함께 바꾸세요.

```env
VLLM_BASE_URL=http://127.0.0.1:8081/v1
```

### Next.js 개발 서버 500 오류

개발 중 `.next` 캐시가 꼬이면 다음 순서로 정리합니다.

```powershell
cd frontend
Remove-Item .next -Recurse -Force
npm.cmd run dev
```

## 개발용 명령

Frontend:

```powershell
cd frontend
npm.cmd run dev
npm.cmd run build
```

Backend:

```powershell
cd backend
..\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```
