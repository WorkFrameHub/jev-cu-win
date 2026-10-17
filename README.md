# jev-cu-win

[English](README.en.md) | 日本語

[Jev-cu](https://github.com/Sac-Y/Jev-cu) の **Windows 版** です。

Windows アプリの「次にどこを押すか」を **Jev**（TypeSafe の System One モデル）に判断させて、Windows の **UI Automation** で実際に操作します。

- Jev には画面の**文字情報だけ**を送ります（スクリーンショットは送りません）
- 既定は**試運転（dry-run）**です。Jev の判断を表示するだけで、何もクリックしません
- 削除・送信・支払い・ログイン・インストールなどの操作は、実行前に **y/N で確認**します

## 仕組み

```
 ┌─────────────┐  画面の文字   ┌──────────┐  どれを押す？  ┌──────────┐
 │ Windows アプリ │ ───────────▶ │ jev-cu-win │ ─────────────▶ │  Jev API   │
 │ (電卓など)    │ ◀─────────── │ + 安全チェック│ ◀───────────── │ (TypeSafe) │
 └─────────────┘  クリック/入力  └──────────┘  要素・確信度    └──────────┘
```

1. **観測**：PowerShell（`scripts/uia-host.ps1`）が UI Automation でウィンドウ内のボタンや入力欄を一覧にします
2. **判断**：その一覧から候補を選び、Jev に「次に押す要素・操作の種類・完了したか・危険か」を聞きます
3. **関門**：`scripts/policy.mjs` が、許可リスト外のアプリや危険な操作を止めます
4. **実行**：問題なければクリックや入力を行い、1 に戻ります

## 必要なもの

- Windows 10 / 11
- [Node.js](https://nodejs.org/ja) 20 以上（LTS 版をインストールしてください）
- TypeSafe の API キー（https://console.typesafe.ai/settings/keys ）

PowerShell は Windows に最初から入っているものを使います。追加のインストールは不要です。

## セットアップ

PowerShell かコマンド プロンプトを開いて：

```powershell
git clone https://github.com/WorkFrameHub/jev-cu-win.git
cd jev-cu-win
copy .env.example .env.local
notepad .env.local
```

メモ帳が開いたら `TYPESAFE_API_KEY=` の後ろに API キーを貼り付けて保存します。

依存パッケージはありません（`npm install` は不要です）。

## 使い方

### 1. 開いているウィンドウを確認

```powershell
node scripts/cli.mjs windows
```

### 2. アプリの UI を見てみる（Jev は呼びません・無料）

電卓を開いてから：

```powershell
node scripts/cli.mjs observe --app 電卓
```

`32 button 7, ID: num7Button` のように、番号付きで要素が表示されれば成功です。

### 3. 試運転（何もクリックしません）

```powershell
node scripts/cli.mjs run --app 電卓 --goal "enter the digit 7"
```

Jev がどの要素を選んだかが表示されます。**目標（--goal）は英語のほうが正確です。**

### 4. 実際に操作する

```powershell
node scripts/cli.mjs run --app 電卓 --goal "calculate 12 times 3" --execute --max-steps 8
```

### 完了の条件を指定する

Jev が「もう終わった」と判断できずに止まることがあります。`--done-when` で、画面にその文字が出たら完了にできます（`observe` で表示される文字をそのまま使ってください）。

```powershell
node scripts/cli.mjs run --app 電卓 --goal "calculate 12 times 3" --execute --max-steps 8 --done-when "表示は 36 です"
```

### 文字を入力する例（メモ帳）

Jev は文章を作りません。入力する文字は `--text` で渡します。

```powershell
node scripts/cli.mjs run --app メモ帳 --goal "type the text into the editor" --text "こんにちは" --execute
```

### オプション一覧

| オプション | 意味 |
| --- | --- |
| `--execute` | 実際に操作する（付けないと試運転） |
| `--max-steps <n>` | 最大ステップ数（既定 10） |
| `--text <文字>` | 入力する文字（type_text / set_value 用） |
| `--key <キー>` | 押すキー。例：`Enter`、`ctrl+s`、`alt+F4` |
| `--direction <向き>` | スクロール方向 `up` / `down` / `left` / `right` |
| `--at <x,y>` | ウィンドウ左上を原点としたクリック座標 |
| `--from <x,y>` `--to <x,y>` | ドラッグの始点と終点（同じ座標系） |
| `--allow-app <名前>` | 許可リストにアプリを追加（複数回指定可） |
| `--plan <文>` | Jev に渡す手順のヒント（英語推奨） |
| `--done-when <文字>` | 画面にこの文字が出たら完了（複数回指定可） |
| `--yes` | 確認が必要な操作も自動で承認（**非推奨**） |

`--app` には、ウィンドウタイトル（`電卓`、`メモ帳` など。部分一致可）か、プロセス名（`notepad`、`CalculatorApp` など）を指定します。

## 安全のための仕組み

- **既定は試運転**。`--execute` を付けたときだけ操作します
- **許可リスト**（`scripts/policy.mjs` の `DEFAULT_ALLOWED_APPS`）：電卓、メモ帳、ペイント、Edge、Chrome。それ以外のアプリは毎回確認します
- **危険語**（削除・送信・購入・パスワード・インストール・共有など、日本語・英語・中国語）を含む要素や、Jev がリスクありと判断した操作は、実行前に確認します。ゼロ幅スペースなどの見えない文字は、判定の前に取り除きます
- 確信度が低いときは止まります
- パスワード欄の中身は読み取りません
- 1 回の実行で同じ文字を 2 回入力しようとしたら止まります
- 操作の記録は `runs/` フォルダに JSONL で残ります

## 開発者向け

```powershell
npm test     # 単体テスト（API を呼ばない・Windows 以外でも動く）
npm run p0   # オフライン評価：保存した UI ツリーで Jev の正解率を測る（API キー必要）
```

| ファイル | 役割 |
| --- | --- |
| `scripts/cli.mjs` | コマンドラインの入口 |
| `scripts/loop.mjs` | 観測 → 判断 → 関門 → 実行 のループ |
| `scripts/jev-decide.mjs` | Jev API 呼び出し |
| `scripts/policy.mjs` | 安全チェック（許可リスト・危険語・しきい値） |
| `scripts/uia-driver.mjs` | Node.js ⇔ PowerShell の通信 |
| `scripts/uia-host.ps1` | UI Automation で画面を読み取り、操作する（PowerShell 5.1 / 7 対応） |
| `fixtures/uia/` | テスト用の UI ツリー（Windows 11 日本語版の電卓・メモ帳を模したもの） |
| `TESTING.md` | Windows 実機でのテスト手順 |

PowerShell を別のもの（例：PowerShell 7）にしたい場合は、環境変数 `JEV_CU_POWERSHELL=pwsh.exe` を設定してください。

## 元の Jev-cu との違い

| | Jev-cu（元） | jev-cu-win |
| --- | --- | --- |
| OS | macOS | Windows |
| 画面の読み取り・操作 | Codex デスクトップアプリの Computer Use | Windows UI Automation（PowerShell） |
| 起動方法 | Codex の `cua_repl` の中で実行 | 普通のコマンドライン |
| 危険な操作 | 止まって終了 | その場で y/N 確認 |

## 制限

- 管理者として実行中のアプリは、管理者でないターミナルからは操作できません
- ゲームや一部の独自描画アプリは UI Automation に要素を公開しないため、操作できません
- ブラウザのページは要素が多いので、上限（1500 要素）で切り詰められることがあります

## License

[MIT](LICENSE)。元の Jev-cu © 2026 Sac-Y をもとにしています。
