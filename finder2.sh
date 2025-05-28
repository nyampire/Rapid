# 1. MapWithAIServiceの詳細構造
echo "=== MapWithAIService structure ==="
grep -n "class\|constructor\|dataset\|url\|source\|facebook\|microsoft" modules/services/MapWithAIService.js

# 2. データセット配列やオブジェクトの検索
echo "=== Dataset definitions ==="
grep -r "facebook.*road\|microsoft.*building\|msBuildings\|fbRoads" modules/ --include="*.js" | head -5

# 3. UI カタログでのデータセット表示方法
echo "=== Catalog UI structure ==="
grep -n "dataset\|catalog\|esri\|mapwithai" modules/ui/UiRapidCatalog.js | head -10

# 4. 設定ファイルの確認
echo "=== Data directory ==="
ls -la dist/data/
