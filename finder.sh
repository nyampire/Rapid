# 1. modules の構造確認
echo "=== modules directory ==="
ls -la modules/

# 2. データセット関連文字列の検索
echo "=== dataset search ==="
grep -r "facebook.*road\|microsoft.*building\|esri" modules/ --include="*.js" | head -5

# 3. 設定ファイルの確認
echo "=== config files ==="
find . -name "*.json" -not -path "./node_modules/*" | head -10

# 4. サービス関連ファイル
echo "=== services ==="
ls modules/services/ 2>/dev/null || echo "services directory not found"
