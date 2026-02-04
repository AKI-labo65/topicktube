# YouTube Comment Map MVP

YouTubeのコメント欄から論点を抽出し、マップ形式で可視化するツールのMVP版です。  
現在はダミーデータを使用していますが、非同期ジョブ処理の基盤が完成しています。

## 解決する課題

YouTubeのコメント欄は長くなると全体像が把握しづらい。  
このツールは、コメントをクラスタリングして「どんな意見がどれくらいあるか」を一目で把握できるようにします。

## 3画面構成

1. **入力画面** (`/`) - YouTube URLを入力して解析開始
2. **全体像画面** (`/videos/{id}`) - クラスターのマップと一覧
3. **詳細画面** (`/clusters/{id}`) - 各クラスターの代表コメント

## 技術スタック

| レイヤー | 技術 |
|---------|-----|
| Frontend | Next.js 14, TypeScript |
| Backend | FastAPI, SQLAlchemy, Pydantic |
| Queue | Redis + RQ (Python) |
| Database | SQLite (MVP用) |
| Container | Docker Compose |

## セットアップ

### 1. Redis を起動

```bash
docker compose up -d
```

### 2. Backend の仮想環境を作成

```bash
cd backend
python3.10 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

### 3. Worker の仮想環境を作成

```bash
cd worker
python3.10 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

### 4. Frontend の依存をインストール

```bash
cd frontend
npm install
```

## 起動手順

4つのターミナルを使用します。

```bash
# ターミナル① Redis（既に起動済みなら不要）
docker compose up -d

# ターミナル② Backend
cd backend
.venv/bin/uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

# ターミナル③ Worker（プロジェクトルートから実行）
cd /path/to/topicktube
PYTHONPATH=. worker/.venv/bin/python -m worker.process

# ターミナル④ Frontend
cd frontend
npm run dev
```

ブラウザで http://localhost:3000 を開きます。

## 使い方

1. トップページで YouTube URL を入力し「**解析を開始**」を押す
2. ジョブが `done` になると自動で `/videos/{id}` に遷移
3. 論点マップとクラスタカードが表示される
4. カードをクリックすると詳細ページへ

## 現在の状態（v0.1 MVP）

- ✅ 非同期ジョブキュー（Redis + RQ）
- ✅ 3画面の基本フロー
- ✅ ポーリングによるステータス監視
- ⏳ YouTube API 連携（未実装・ダミーデータ）
- ⏳ LLM によるクラスタリング・要約（未実装）

## 今後の拡張予定

1. YouTube Data API v3 で実コメント取得
2. Embedding + クラスタリングで意見分類
3. LLM で各クラスタの要約生成
4. UI/UX の改善（アニメーション、レスポンシブ対応）

## メモ

- DB は `backend/app.db`（SQLite）に作成されます
- 再起動すると DB はリセットされます（`app.db` を削除で初期化）
- **初回解析時は AI モデル（約80MB）のダウンロードがあるため、完了まで時間がかかります**
- Python 3.10 を推奨（3.13 は SQLAlchemy 2.0.27 と非互換）

## 手動メンテナンス（開発者向け）

### DBマイグレーション（カラム追加）

既存のデータベース (`app.db`) を維持したまま新しい機能を有効にするには、以下のSQLを実行してください。

```bash
# 動画タイトル保存用カラムの追加
sqlite3 backend/app.db "ALTER TABLE videos ADD COLUMN hash_version TEXT;"
sqlite3 backend/app.db "ALTER TABLE videos ADD COLUMN overall_summary TEXT;"
```
