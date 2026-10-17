# jev-cu-win 実機テスト手順

Windows の実機で、jev-cu-win の機能を順番に確かめるための手順書です。
人が手で進めても、Windows 上の AI エージェント（Claude Code など）に渡して進めてもらっても構いません。

- 各テストには **やること**・**コマンド**・**期待する結果** があります
- 終わったら、最後の「結果の報告」の表を埋めて、うまくいかなかったテストの出力を貼ってください
- `--execute` を付けたテストだけが実際にクリック・入力します。それ以外は何も操作しません

## 0. 準備

```powershell
cd C:\Users\<ユーザー名>\jev-cu-win
git pull
npm test
```

**期待する結果**：最後に `# pass 21`（以上）、`# fail 0` が出る。

> エージェントへの注意：テスト中に開くアプリ（電卓・メモ帳・Edge）は、**最小化せず、画面に見える状態**にしておくこと。
> 確認の質問（`[y/N]`）が出たら、各テストの指示どおりに答えること。指示が無ければ **N** と答えること。

---

## A. 基本（確認済みのものの再確認）

### A1. ウィンドウ一覧

```powershell
node scripts/cli.mjs windows
```

**期待する結果**：開いているウィンドウのタイトルと、カッコ内にプロセス名が並ぶ。

### A2. 見つからないアプリ

電卓を**閉じた状態**で：

```powershell
node scripts/cli.mjs observe --app 電卓
```

**期待する結果**：`window not found: "電卓"` と出て終わる。ターミナル自身の中身が表示されたら NG。

### A3. 電卓の連続操作

電卓を開いて「C」でクリアしてから：

```powershell
node scripts/cli.mjs run --app 電卓 --goal "calculate 12 times 3" --execute --max-steps 8 --done-when "表示は 36 です"
```

**期待する結果**：`終了：done`、電卓に 36。

---

## B. メモ帳：文字入力

新しいメモ帳を開く（中身は空）。

### B1. 画面の読み取り

```powershell
node scripts/cli.mjs observe --app メモ帳
```

**期待する結果**：`document テキスト エディター` のような行があり、その番号をメモしておく。

### B2. 文字の入力

```powershell
node scripts/cli.mjs run --app メモ帳 --goal "type the text into the text editor" --text "こんにちは jev-cu-win" --execute --max-steps 3 --done-when "こんにちは jev-cu-win"
```

**期待する結果**：メモ帳に「こんにちは jev-cu-win」と入り、`終了：done`。
**確認すること**：日本語が文字化けしていないか。同じ文字が 2 回以上入っていないか。

### B3. 長い文章の準備（スクロール用）

メモ帳の中身を全部消してから：

```powershell
node scripts/cli.mjs run --app メモ帳 --goal "type the text into the text editor" --text "1`n2`n3`n4`n5`n6`n7`n8`n9`n10`n11`n12`n13`n14`n15`n16`n17`n18`n19`n20`n21`n22`n23`n24`n25`n26`n27`n28`n29`n30`n31`n32`n33`n34`n35`n36`n37`n38`n39`n40`n41`n42`n43`n44`n45`n46`n47`n48`n49`n50`n51`n52`n53`n54`n55`n56`n57`n58`n59`n60" --execute --max-steps 2
```

（PowerShell では `` `n `` が改行になります。コマンド プロンプトでは改行を渡せないので、PowerShell で実行してください）

**期待する結果**：メモ帳に 1〜60 が 1 行ずつ入る。

### B4. スクロール

メモ帳の先頭（1 行目）が見える状態にしてから：

```powershell
node scripts/cli.mjs run --app メモ帳 --goal "scroll the text editor down" --direction down --execute --max-steps 1
```

**期待する結果**：Jev が `scroll` を選び、メモ帳が下にスクロールする。
**確認すること**：Jev が選んだ操作の種類（`scroll` 以外を選んだら、それも記録する）。

### B5. キー操作

```powershell
node scripts/cli.mjs run --app メモ帳 --goal "press a key to select all text in the editor" --key ctrl+a --execute --max-steps 1
```

**期待する結果**：Jev が `press_key` を選び、メモ帳の文字が全選択される。
**確認すること**：Jev が選んだ操作の種類。

---

## C. 安全装置

### C1. 試運転では何もしない

メモ帳を開いたまま：

```powershell
node scripts/cli.mjs run --app メモ帳 --goal "open the File menu"
```

**期待する結果**：`試運転：次は click_element → i… (ファイル…)` と出る。メモ帳のメニューは**開かない**。

### C2. 危険な操作で止まる（N と答える）

メモ帳の文字を全選択した状態で：

```powershell
node scripts/cli.mjs run --app メモ帳 --goal "open the Edit menu and choose Delete to remove the selected text" --execute --max-steps 4
```

**期待する結果**：「編集」メニューが開いたあと、「削除」を押す前に `⚠確認が必要です` と `[y/N]` が出る。**N** と答えると、何も消えずに `終了：confirm` になる。
**確認すること**：確認なしに削除されたら NG。

### C3. 許可リストにないアプリ

Slack など、許可リストにないアプリを開いた状態で（`windows` の一覧に出ている名前を使う）：

```powershell
node scripts/cli.mjs run --app Slack --goal "open the search box"
```

**期待する結果**：`アプリ「Slack」は許可リストにありません` と出て `終了：confirm`。何も操作しない。

---

## D. ブラウザ（読み取りと試運転だけ）

Edge で https://example.com を開いておく。

### D1. 読み取り

```powershell
node scripts/cli.mjs observe --app "Microsoft Edge"
```

**期待する結果**：アドレスバー（`text field` など）やページ内のリンク（`link`）が並ぶ。
**確認すること**：出力の最後に `(tree truncated at 1500 elements)` が出たか。表示までにかかった秒数（目安でよい）。

### D2. 試運転

```powershell
node scripts/cli.mjs run --app "Microsoft Edge" --goal "click the More information link on the page"
```

**期待する結果**：`試運転：次は click_element → i… (More information… / 詳細情報…)` のように、ページ内のリンクが選ばれる。

---

## 結果の報告

下の表を埋めて返してください。NG・△ のテストは、ターミナルの出力（または画面のスクリーンショット）も貼ってください。

| テスト | 結果（OK / NG / △） | メモ（Jev が選んだ操作、気づいたこと） |
| --- | --- | --- |
| 0 npm test | | |
| A1 ウィンドウ一覧 | | |
| A2 見つからないアプリ | | |
| A3 電卓の連続操作 | | |
| B1 メモ帳の読み取り | | |
| B2 文字の入力 | | |
| B3 長い文章 | | |
| B4 スクロール | | |
| B5 キー操作 | | |
| C1 試運転 | | |
| C2 危険な操作で停止 | | |
| C3 許可リスト外 | | |
| D1 Edge の読み取り | | |
| D2 Edge の試運転 | | |

操作の詳しい記録は `runs\` フォルダの `.jsonl` ファイルにあります。気になる結果があれば、そのファイルも添付してください。
