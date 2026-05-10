# 文化祭3Dプリント レジ

文化祭で3Dプリンター作品を販売するための、HTML/CSS/JavaScriptだけで動くレジサイトです。商品管理と注文データ保存には Firebase Authentication と Cloud Firestore を使います。

## 機能

- 商品一覧からカートへ追加
- 現金、PayPay、その他の支払い方法を記録
- 注文保存時に Firestore へ保存し、在庫を自動で減算
- 管理者ログイン
- 管理者の商品追加、編集、削除、販売停止
- 管理者の当日売上と注文履歴確認

## Firebase設定

1. Firebase Consoleでプロジェクトを作成します。
2. Authenticationで「メール/パスワード」を有効にします。
3. Firestore Databaseを作成します。
4. `firebase-config.example.js` を `firebase-config.js` にコピーして、WebアプリのFirebase設定値を入れます。
5. `firestore.rules` の内容を Firestore Rules に貼り付けて公開します。
6. 管理者にしたいユーザーをAuthenticationで作成します。
7. Firestoreで `admins/{ユーザーUID}` ドキュメントを作成します。中身は `{ "role": "admin" }` などで大丈夫です。

## ローカル実行

ブラウザのモジュール読み込みの都合で、ローカルサーバーから開いてください。

```powershell
python -m http.server 8080
```

その後、[http://localhost:8080](http://localhost:8080) を開きます。

## Firestoreコレクション

- `products`: 商品データ
- `orders`: 会計データ
- `admins`: 管理者UIDの許可リスト

## 参考

Firebaseの初期化とFirestore操作は、Firebase公式ドキュメントのWebモジュラーSDK形式に沿っています。

- [Add Firebase to your JavaScript project](https://firebase.google.com/docs/web/setup)
- [Get started with Cloud Firestore](https://firebase.google.com/docs/firestore/quickstart)
