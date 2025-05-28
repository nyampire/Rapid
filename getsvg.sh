# 元のRapidリポジトリを一時的にクローン
cd /tmp
git clone https://github.com/facebook/Rapid.git rapid-temp
find rapid-temp -name "*sprite*.svg" -exec ls -la {} \;

# 見つかったファイルをコピー
cp rapid-temp/svg/*sprite*.svg ~/git/Rapid/img/ 2>/dev/null
cp rapid-temp/img/*sprite*.svg ~/git/Rapid/img/ 2>/dev/null

# 元のディレクトリに戻る
cd ~/git/Rapid
ls -la img/*sprite*.svg
