# jev-cu-win

[English](README.en.md) | 日本語

**「jev をComputer Useで使いたい」人のための、Windows向けCodexスキルです。**

Codexに「電卓で計算して」「メモ帳に文字を入力して」と頼むと、**Jev**（TypeSafeのSystem Oneモデル）が次に操作する要素を判断し、Windowsの **UI Automation** でクリックや入力を行います。[Jev-cu](https://github.com/Sac-Y/Jev-cu)のWindows版です。

このスキルは、Windows用CLIをCodexから利用するための手順書です。画面操作には同梱のNode.js・PowerShellコードを使い、CodexのComputer Useツールや `cua_repl` には依存しません。

- Jevに送るのは画面の**文字情報**です。スクリーンショットは送りません
- CLIの既定は**試運転（dry-run）**です。実操作の前にJevの判断を確認します
- **試運転でもTypeSafe APIへの送信と課金が発生し得ます**
- 確認が必要な操作では停止します。AIが確認を省略して実行することはありません

## スキルを入れて使う

### 1. 必要なものを用意する

- Windows 10 / 11
- スキルを利用できるCodex
- [Git](https://git-scm.com/downloads/win)
- [Node.js](https://nodejs.org/ja) 20以上
- [TypeSafeのAPIキー](https://console.typesafe.ai/settings/keys)

PowerShellはWindows標準のものを使います。追加のnpmパッケージは不要で、`npm install` は必要ありません。

**スキルの設置だけでは、Node.jsやAPIキーは設定されません。** 次の準備と設置は、操作したいWindows環境で行ってください。

### 2. 本体を取得してAPIキーを設定する

PowerShellを開き、本体を置いておきたいフォルダで実行します。

```powershell
git clone https://github.com/WorkFrameHub/jev-cu-win.git
cd jev-cu-win
copy .env.example .env.local
notepad .env.local
```

既に本体や `.env.local` がある場合は、新しく複製・上書きせず既存のものを使ってください。

メモ帳で `TYPESAFE_API_KEY=` の後ろにキーを貼り付け、保存します。キーは利用者自身で設定し、チャットやGitHubに貼らないでください。既に環境変数 `TYPESAFE_API_KEY` を設定している場合は、`.env.local` の作成は不要です。

### 3. スキルを設置する

取得した `jev-cu-win` フォルダで実行します。

```powershell
node scripts/install-skill.mjs
```

標準の設置先は `$HOME/.agents/skills/jev-cu-win` です。`SKILL.md` に本体の絶対パスを設定し、ライセンスと管理用ファイルを設置します。API通信や画面操作は行わず、認証情報にも触れません。同名の設置先が既にある場合は、上書きせず停止します。

**設置後も本体のフォルダを移動・削除しないでください。** スキルはそのフォルダのCLIを呼び出します。本体を移動する場合は、移動前にスキルを削除し、移動後に設置し直します。

### 4. Codexで呼び出す

Codexのスキル一覧に `jev-cu-win` が表示されたら使えます。表示されなければCodexを再起動してください。

まず、APIを呼ばない画面確認から始めます。

```text
$jev-cu-win 開いているウィンドウを確認して、電卓の画面を読み取って。
```

次に、操作したい内容を伝えます。電卓を開いた状態で、例えば次のように頼みます。

```text
$jev-cu-win 電卓で12×3を計算して、表示が36になったことを確認して。
電卓の画面文字と目標をTypeSafe APIへ送信し、API利用料が発生することを許可します。
まず試運転で対象を確認してから、計算を実行して。
```

入力する文字も指定できます。メモ帳の空の編集欄を使う例です。

```text
$jev-cu-win メモ帳の空の編集欄に「こんにちは」と入力して、結果を確認して。
メモ帳の画面文字と目標をTypeSafe APIへ送信し、API利用料が発生することを許可します。
```

スキルが見つかっても、Codexから目的のWindowsデスクトップへアクセスできるとは限りません。画面や対象の要素が見えない場合は停止し、利用者のWindowsターミナルへ引き継ぎます。詳しくは下の「実行環境」と「AI経由の実行と確認」を参照してください。

## 送信・費用と操作確認

`windows` / `observe` はTypeSafe APIを使いません。一方、**試運転を含む `run` は、画面の候補要素・文脈、目標、手順のヒント、最近の操作などをTypeSafeへ送信し、費用が発生し得ます。** 機密情報を含む画面は避け、送信する範囲を確認してから実行してください。

非対話型のAIシェルではCLIのy/N確認に回答できず、`confirm` で停止します。チャットで承認してもCLIの確認には入力されません。その場合は、確認を省略するオプションを付けず、利用者の対話型Windowsターミナルで実行して確認します。

## スキルの管理と実行環境

### 実行環境

リポジトリのルートで、API や GUI を使わず確認できます。

```powershell
node --version                         # 20 以上
Get-Command powershell.exe             # 標準の PowerShell
# JEV_CU_POWERSHELL を指定済みなら、その実行ファイルも確認する
node scripts/cli.mjs --help
node scripts/install-skill.mjs --help
```

追加の npm パッケージは不要です。`run` 用の TypeSafe キーは、このプロセスの `TYPESAFE_API_KEY` または checkout 直下の `.env.local` に利用者が用意します。AI に値を取得・表示させないでください。`windows` / `observe` には API キーは不要です。

skill が見つかることと、目的の Windows デスクトップにアクセスできることは別です。[公式 Windows sandbox 文書](https://learn.chatgpt.com/docs/windows/windows-sandbox)では private desktop を使う構成も説明されています。WSL・cloud・sandbox 越しの通常デスクトップ操作は動作確認済みの対応環境ではありません。利用時はまず `windows` / `observe` で対象を確認し、見えなければ停止して利用者の Windows ターミナルへ引き継ぎます。sandbox 無効化を標準手順にはしません。

### プロジェクト内だけで使う

特定プロジェクトだけで使う場合は、そのプロジェクトの `.agents/skills` を指定します。

```powershell
node scripts/install-skill.mjs --skills-dir "C:/path/to/project/.agents/skills"
```

`--skills-dir` は `jev-cu-win` の親ディレクトリです。ユーザー用とプロジェクト用を二重設置しないでください。対象Codexホストの探索先は[公式のスキル文書](https://learn.chatgpt.com/docs/build-skills)も確認してください。

### 更新・削除

同じ checkout で、必要な変更を通常の Git 手順で取得・確認してからコピーを更新します。

```powershell
node scripts/install-skill.mjs --update
node scripts/install-skill.mjs --uninstall
```

独自の `--skills-dir` を使った場合は更新・削除にも同じ値を渡してください。設置元 checkout が一致し、管理対象ファイルが未編集の場合だけ更新・削除します。別 checkout・リンク・追記ファイル・手編集を検出したら停止するので、先に手作業でバックアップ／照合してください。設置先の内容を無条件で再帰削除しません。checkout を移動する場合は移動前に削除し、移動後に設置し直します。削除は skill だけが対象で、CLI・ログ・API キーを削除しません。

### AI 経由の実行と確認

- `windows` / `observe` は TypeSafe API を使いません。一方、**dry-run を含む `run` は画面テキスト・目標などを TypeSafe へ送信し、費用が発生し得ます**。初回の API 実行前に送信と費用の範囲を理解し、許可してください。dry-run は GUI 操作をしないだけで、オフライン検証ではありません。
- 新しい操作はまず dry-run で 1 判断を確認し、許可された範囲でのみ `--execute` を付けます。`--done-when` と操作後の `observe` で結果を確認します。`--text` は利用者の指定内容を渡し、入力欄選択時はクリックと入力が同じステップで起きることに注意してください。
- **非 TTY の AI シェルでは y/N に回答できず、confirmation は false になって `confirm` で停止します（終了コード 2）**。チャットでの承認は CLI の入力にはなりません。AI は具体的な対象・操作・理由を説明し、不足する許可を確認したうえで、`--yes` なしのコマンドを利用者の対話型 Windows ターミナルへ引き継ぎます。利用者は新しい判断と y/N を確認してください。再実行は同じ計画の続きではなく、API が別の操作を選ぶ可能性があります。
- `--yes` の常用、`y` のパイプ、許可リスト拡大やしきい値変更による確認回避はしません。引き継げない場合は停止を維持します。`ask_user` / `stop` / `escalate` / エラー・結果不明でも停止し、現在の画面を確認してから判断します。以前のステップが実行済みの場合があるため、入力やタスク全体を無条件で再実行しないでください。
- `runs/` の JSONL と標準出力には目標・plan・画面ラベル・判断等が含まれ得ます。秘密を画面や引数に含めず、キー・`.env.local`・生ログ・スクリーンショットを PR やチャットに貼らないでください。パスワード欄除外や文字の切り詰めは完全な秘匿化ではありません。

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

## CLIで直接使う

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
npm run p0   # 保存した UI ツリーの評価（TypeSafe API 通信・費用あり、API キー必要）
```

| ファイル | 役割 |
| --- | --- |
| `scripts/cli.mjs` | コマンドラインの入口 |
| `skill/jev-cu-win/SKILL.md` | CLI を利用する Codex 向け手順（設置元） |
| `scripts/install-skill.mjs` | skill のコピー設置・更新・削除（API / GUI 不使用） |
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
| 起動方法 | Codex の `cua_repl` の中で実行 | CodexスキルからCLIを呼び出す／CLIを直接実行 |
| 危険な操作 | 止まって終了 | その場で y/N 確認 |

## 制限

- 管理者として実行中のアプリは、管理者でないターミナルからは操作できません
- ゲームや一部の独自描画アプリは UI Automation に要素を公開しないため、操作できません
- ブラウザのページは要素が多いので、上限（1500 要素）で切り詰められることがあります

## License

[MIT](LICENSE)。元の Jev-cu © 2026 Sac-Y をもとにしています。
